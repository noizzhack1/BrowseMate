/**
 * ===========================================
 * File: index.js (Task A - Orchestrator)
 * Purpose: Main orchestrator module - routes user requests to questions or actions
 * Dependencies: LLMClient.js, executor/index.js
 * ===========================================
 */

// Import LLM client for planner calls
import { LLMClient } from '../llm/LLMClient.js';
// Import Task B executor for action execution
import { executeAction } from '../executor/index.js';
// Import logger for debugging
import { Logger } from '../utils/logger.js';
// Import action tools for LLM function calling
import { getActionTools } from '../actions/ActionTools.js';

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
 * @returns {Promise<{intent: string, answer?: string, toolCalls?: Array}>}
 */
async function callPlannerLLM(context, prompt) {
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
    Logger.info('[callPlannerLLM] Calling llm.plannerCall with tools...');
    Logger.debug('[callPlannerLLM] Context string length:', contextStr.length);
    const result = await llm.plannerCall(contextStr, prompt, tools);
    Logger.info('[callPlannerLLM] Planner LLM result received');
    Logger.debug('[callPlannerLLM] Result:', result);
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
 * @returns {Promise<{type: string, message: string, success: boolean}>}
 */
async function processRequest(context, prompt, onProgress = null) {
  Logger.info('[processRequest] Starting request processing');
  Logger.info('[processRequest] Prompt:', prompt);
  Logger.info('[processRequest] Has context:', !!context);
  Logger.debug('[processRequest] Context type:', typeof context);
  
  try {
    // Step 1: Call Planner LLM to determine intent
    Logger.info('[processRequest] Step 1: Calling Planner LLM...');
    const plannerResult = await callPlannerLLM(context, prompt);
    Logger.info('[processRequest] Planner LLM result:', plannerResult);
    
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
    } else if (plannerResult.intent === 'action') {
      // LLM requested to call tools (actions)
      Logger.info('[processRequest] Intent: action - processing tool calls');

      if (!plannerResult.toolCalls || plannerResult.toolCalls.length === 0) {
        Logger.error('[processRequest] Action intent but no tool calls provided');
        return {
          type: 'action_result',
          message: 'LLM identified an action but did not provide tool calls.',
          success: false
        };
      }

      // Execute each tool call (action)
      Logger.info(`[processRequest] Processing ${plannerResult.toolCalls.length} tool call(s)...`);
      const results = [];
      const totalSteps = plannerResult.toolCalls.length;

      for (let i = 0; i < plannerResult.toolCalls.length; i++) {
        const toolCall = plannerResult.toolCalls[i];
        const stepNumber = i + 1;

        Logger.info('[processRequest] Tool call:', toolCall);

        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);
        const stepDescription = toolCall.description || `${functionName}`;

        Logger.info(`[processRequest] Step ${stepNumber}/${totalSteps}: ${stepDescription}`);

        // Send progress update if callback provided
        if (onProgress) {
          onProgress({
            step: stepNumber,
            total: totalSteps,
            description: stepDescription,
            status: 'executing'
          });
        }

        // Convert tool call to action format for Task B
        const action = {
          name: functionName,
          params: functionArgs
        };

        // Execute action via Task B
        Logger.info('[processRequest] Calling delegateToTaskB...');
        const actionResult = await delegateToTaskB(action);
        Logger.info('[processRequest] Task B result:', actionResult);

        results.push(actionResult);

        // Send completion update
        if (onProgress) {
          onProgress({
            step: stepNumber,
            total: totalSteps,
            description: stepDescription,
            status: actionResult.success ? 'completed' : 'failed',
            message: actionResult.message
          });
        }

        // If any action fails, stop and return error
        if (!actionResult.success) {
          return {
            type: 'action_result',
            message: actionResult.message || 'Action failed',
            success: false
          };
        }
      }

      // All actions succeeded
      const messages = results.map(r => r.message).join('\n');
      return {
        type: 'action_result',
        message: messages || 'Actions completed successfully',
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
