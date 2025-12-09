/**
 * ===========================================
 * File: index.js (Task A - Orchestrator)
 * Purpose: Main orchestrator module - routes user requests to questions or actions
 * Dependencies: LLMClient.js, executor/index.js
 * ===========================================
 */

// Import LLM client for planner calls
import { LLMClient } from './llm-client.js';
// Import Task B executor for action execution
import { executeAction } from './action-executor.js';
// Import sequential action executor
import { executeActionsSequentially } from './action-sequencer.js';
// Import logger for debugging
import { Logger } from '../utils/logger.js';
// Import action tools for LLM function calling
import { getActionTools } from './action-tools.js';

// LLM client instance - lazy initialized
let llmClient = null;

/**
 * Get or create LLM client instance (singleton pattern)
 * @returns {LLMClient} - The LLM client instance
 */
function getLLMClient() {
  if (!llmClient) {
    llmClient = new LLMClient();
  }
  return llmClient;
}

/**
 * Call Planner LLM to determine intent (question vs action) with tool calling
 * @param {string} context - Page context (text or HTML)
 * @param {string} prompt - User's question or request
 * @param {AbortSignal} abortSignal - Signal to cancel the request
 * @returns {Promise<{intent: string, answer?: string, toolCalls?: Array}>}
 */
async function callPlannerLLM(context, prompt, abortSignal = null) {
  Logger.info('[callPlannerLLM] Starting planner LLM call');
  Logger.debug('[callPlannerLLM] Prompt:', prompt);
  Logger.debug('[callPlannerLLM] Context type:', typeof context);

  const llm = getLLMClient();
  Logger.debug('[callPlannerLLM] LLM client obtained');

  // Get available action tools for function calling
  const tools = getActionTools();
  Logger.info('[callPlannerLLM] Action tools loaded:', tools.length);

  // Prepare context string (combine text and HTML if available)
  let contextStr = '';
  if (typeof context === 'string') {
    contextStr = context;
  } else if (context && typeof context === 'object') {
    // If context is an object with url, title, text, html
    contextStr = `URL: ${context.url || ''}\nTitle: ${context.title || ''}\n\n`;
    if (context.text) {
      contextStr += `Page Text (first 3000 chars):\n${context.text.substring(0, 3000)}\n\n`;
    }
    if (context.html) {
      contextStr += `Page HTML (first 5000 chars):\n${context.html.substring(0, 5000)}`;
    }
  }

  try {
    // Check if request was aborted
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Request cancelled by user');
    }

    Logger.info('[callPlannerLLM] Calling llm.plannerCall with tools...');
    Logger.debug('[callPlannerLLM] Context string length:', contextStr.length);
    const result = await llm.plannerCall(contextStr, prompt, tools, abortSignal);
    Logger.info('[callPlannerLLM] Planner LLM result received');
    Logger.debug('[callPlannerLLM] Result:', result);
    
    // Check again after the call
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Request cancelled by user');
    }
    
    return result;
  } catch (error) {
    Logger.error('[callPlannerLLM] Planner LLM call failed:', error);
    Logger.error('[callPlannerLLM] Error message:', error.message);
    Logger.error('[callPlannerLLM] Error stack:', error.stack);
    // Fallback to question intent on error
    return {
      intent: 'question',
      answer: 'I encountered an error processing your request. Please try again.'
    };
  }
}

/**
 * Delegate action to Task B (executor)
 * @param {{type: string, target: string, value?: string}} action - Action to perform
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function delegateToTaskB(action) {
  Logger.info('[delegateToTaskB] Delegating action to Task B');
  Logger.info('[delegateToTaskB] Action:', JSON.stringify(action, null, 2));
  
  try {
    // Task B's executeAction uses getPageContext() internally, so we don't need to pass context
    Logger.info('[delegateToTaskB] Calling executeAction...');
    const result = await executeAction(action);
    Logger.info('[delegateToTaskB] Task B execution completed');
    Logger.info('[delegateToTaskB] Result:', result);
    return result;
  } catch (error) {
    Logger.error('[delegateToTaskB] Task B execution failed:', error);
    Logger.error('[delegateToTaskB] Error message:', error.message);
    Logger.error('[delegateToTaskB] Error stack:', error.stack);
    return {
      success: false,
      message: `Action execution failed: ${error.message}`
    };
  }
}

/**
 * Main entry point - process user request
 * Routes to question answering or action execution based on LLM analysis
 * @param {string|Object} context - Page context (string or {url, title, text, html})
 * @param {string} prompt - User's question or request
 * @param {Function} onProgress - Optional callback for progress updates (step, total, description, result)
 * @param {AbortSignal} abortSignal - Signal to cancel the request
 * @returns {Promise<{type: string, message: string, success: boolean}>}
 */
async function processRequest(context, prompt, onProgress = null, abortSignal = null) {
  Logger.info('[processRequest] Starting request processing');
  Logger.info('[processRequest] Prompt:', prompt);
  Logger.info('[processRequest] Has context:', !!context);
  Logger.debug('[processRequest] Context type:', typeof context);
  
  try {
    // Check if request was aborted before starting
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Request cancelled by user');
    }

    // Step 1: Call Planner LLM to determine intent
    Logger.info('[processRequest] Step 1: Calling Planner LLM...');
    const plannerResult = await callPlannerLLM(context, prompt, abortSignal);
    Logger.info('[processRequest] Planner LLM result:', plannerResult);
    
    // Check if request was aborted after planner call
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Request cancelled by user');
    }
    
    // Step 2: Route based on intent
    Logger.info(`[processRequest] Step 2: Routing based on intent: ${plannerResult.intent}`);

    if (plannerResult.intent === 'question') {
      // Return answer directly
      Logger.info('[processRequest] Intent: question - returning answer');
      const answer = plannerResult.answer || 'I could not generate an answer.';
      Logger.debug('[processRequest] Answer:', answer);
      return {
        type: 'answer',
        message: answer,
        success: true
      };
    } else if (plannerResult.intent === 'plan') {
      // LLM created a plan (planner mode - no execution)
      Logger.info('[processRequest] Intent: plan - returning plan description');

      // Handle new format with taskList and actions
      if (plannerResult.taskList && plannerResult.actions) {
        Logger.info('[processRequest] Task list format detected');
        Logger.info('[processRequest] Starting sequential execution of actions');

        // Check if request was aborted before execution
        if (abortSignal && abortSignal.aborted) {
          throw new Error('Request cancelled by user');
        }

        // Execute actions sequentially with progress tracking and adaptive re-planning
        const executionResult = await executeActionsSequentially(
          plannerResult.actions,
          (taskList, currentStep, totalSteps, status) => {
            // Check if request was aborted during progress update
            if (abortSignal && abortSignal.aborted) {
              return;
            }

            // Progress callback - log to console
            Logger.info(`[processRequest] Progress: ${currentStep}/${totalSteps} - Status: ${status}`);
            console.log('\n=== TASK PROGRESS ===');
            console.log(taskList);
            console.log(`\nStep ${currentStep}/${totalSteps}`);
            console.log('====================\n');

            // Call the onProgress callback if provided (for UI updates)
            if (onProgress) {
              onProgress(taskList, currentStep, totalSteps, status);
            }
          },
          prompt, // Pass original user prompt for re-planning
          true, // Enable adaptive planning
          abortSignal // Pass abort signal to sequencer
        );

        Logger.info('[processRequest] Sequential execution completed');
        Logger.info('[processRequest] Result:', executionResult);

        return {
          type: 'execution',
          message: executionResult.message,
          taskList: executionResult.results.map((r) => {
            const icon = r.status === 'success' ? '●' : r.status === 'failed' ? '✗' : '○';
            return `${icon} ${r.action.description}`;
          }).join('\n'),
          results: executionResult.results,
          success: executionResult.success
        };
      }

      // Handle old format with plan object (backward compatibility)
      if (!plannerResult.plan) {
        Logger.error('[processRequest] Plan intent but no plan or taskList provided');
        return {
          type: 'plan',
          message: 'LLM identified this as an action request but did not provide a plan.',
          success: false
        };
      }

      // Format the plan for display (old format)
      const plan = plannerResult.plan;
      let planMessage = `**Plan: ${plan.summary}**\n\n`;

      if (plan.steps && Array.isArray(plan.steps)) {
        planMessage += '**Steps:**\n';
        plan.steps.forEach((step, index) => {
          planMessage += `${step.step}. ${step.description}\n`;
          if (step.suggestedAction) {
            planMessage += `   → Suggested action: ${step.suggestedAction}\n`;
          }
          if (step.reasoning) {
            planMessage += `   → Reasoning: ${step.reasoning}\n`;
          }
          planMessage += '\n';
        });
      }

      if (plan.expectedOutcome) {
        planMessage += `**Expected Outcome:**\n${plan.expectedOutcome}`;
      }

      Logger.info('[processRequest] Plan formatted:', planMessage);

      return {
        type: 'plan',
        message: planMessage,
        plan: plan,
        success: true
      };
    } else {
      // Unknown intent
      Logger.warn('[processRequest] Unknown intent from planner:', plannerResult.intent);
      return {
        type: 'answer',
        message: 'I could not determine what you want me to do. Please try rephrasing your request.',
        success: false
      };
    }
  } catch (error) {
    Logger.error('[processRequest] Error processing request:', error);
    Logger.error('[processRequest] Error message:', error.message);
    Logger.error('[processRequest] Error stack:', error.stack);
    return {
      type: 'answer',
      message: `An error occurred: ${error.message}`,
      success: false
    };
  }
}

// Export functions for ES6 modules
export { processRequest, callPlannerLLM, delegateToTaskB };
