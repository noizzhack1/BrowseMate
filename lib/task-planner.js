/**
 * ===========================================
 * File: index.js (Task A - Orchestrator)
 * Purpose: Main orchestrator module - routes user requests to questions or actions
 * Dependencies: LLMClient.js, executor/index.js, mcp-client.js
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
// Import context extractor for HTML processing
import { extractHTMLContext } from './context-extractor.js';
// Import MCP client for external tool integration
import { mcpClient } from './mcp-client.js';

// LLM client instance - lazy initialized
let llmClient = null;

/**
 * Get or create LLM client instance (singleton pattern)
 * @returns {LLMClient} - The LLM client instance
 */
function getLLMClient() {
  // Create new instance if not exists
  if (!llmClient) {
    llmClient = new LLMClient();
  }
  // Return the singleton instance
  return llmClient;
}

/**
 * Get merged tools from web actions and enabled MCP servers
 * Combines local browser action tools with external MCP server tools
 * @returns {Promise<Array>} - Combined array of all available tools
 */
async function getMergedTools() {
  // Log the start of tool merging
  Logger.info('[getMergedTools] Merging web action tools with MCP tools');

  // Get local web action tools
  const webActionTools = getActionTools();
  Logger.info(`[getMergedTools] Loaded ${webActionTools.length} web action tools`);

  // Get MCP tools from all enabled servers (on-demand connection)
  let mcpTools = [];
  try {
    // Attempt to discover tools from all enabled MCP servers
    mcpTools = await mcpClient.getAllEnabledServerTools();
    Logger.info(`[getMergedTools] Loaded ${mcpTools.length} MCP tools`);
  } catch (error) {
    // Log error but continue with web actions only
    Logger.warn('[getMergedTools] Failed to load MCP tools:', error);
    Logger.warn('[getMergedTools] Continuing with web action tools only');
  }

  // Combine both tool arrays (web actions first, then MCP tools)
  const mergedTools = [...webActionTools, ...mcpTools];
  Logger.info(`[getMergedTools] Total merged tools: ${mergedTools.length}`);

  // Return the combined tools array
  return mergedTools;
}

/**
 * Call Planner LLM to determine intent (question vs action) with tool calling
 * Includes both web action tools and MCP tools from enabled servers
 * @param {string} context - Page context (text or HTML)
 * @param {string} prompt - User's question or request
 * @param {AbortSignal} abortSignal - Signal to cancel the request
 * @param {Array} conversationHistory - Recent conversation history [{role, content}, ...]
 * @returns {Promise<{intent: string, answer?: string, toolCalls?: Array}>}
 */
async function callPlannerLLM(context, prompt, abortSignal = null, conversationHistory = []) {
  Logger.info('[callPlannerLLM] Starting planner LLM call');
  Logger.debug('[callPlannerLLM] Prompt:', prompt);
  Logger.debug('[callPlannerLLM] Context type:', typeof context);

  // Get LLM client singleton instance
  const llm = getLLMClient();
  Logger.debug('[callPlannerLLM] LLM client obtained');

  // Get merged tools (web actions + MCP tools from enabled servers)
  const tools = await getMergedTools();
  Logger.info('[callPlannerLLM] Merged tools loaded:', tools.length);

  // Prepare context string (combine text, extracted elements, and HTML if available)
  let contextStr = '';
  let extractedContext = null;

  if (typeof context === 'string') {
    contextStr = context;
  } else if (context && typeof context === 'object') {
    // If context is an object with url, title, text, html
    contextStr = `URL: ${context.url || ''}\nTitle: ${context.title || ''}\n\n`;

    // Extract interactive elements from HTML for better action targeting
    if (context.html) {
      try {
        extractedContext = extractHTMLContext(context.html, {
          maxElements: 100,
          includeLinks: true,
          includeForms: true
        });
        Logger.info('[callPlannerLLM] Extracted interactive elements:', extractedContext.summary);

        // Add extracted elements (more useful than raw HTML for actions)
        contextStr += `${extractedContext.formatted}\n\n`;
      } catch (error) {
        Logger.warn('[callPlannerLLM] Failed to extract HTML context:', error);
      }
    }

    // Add visible text (useful for answering questions)
    if (context.text) {
      contextStr += `Page Text (first 3000 chars):\n${context.text.substring(0, 3000)}\n\n`;
    }

    // Add raw HTML as fallback (reduced size since we have extracted elements)
    if (context.html && !extractedContext) {
      contextStr += `Page HTML (first 5000 chars):\n${context.html.substring(0, 5000)}`;
    } else if (context.html) {
      // Include smaller HTML snippet for edge cases where selectors need verification
      contextStr += `Page HTML snippet (first 2000 chars):\n${context.html.substring(0, 2000)}`;
    }
  }

  try {
    // Check if request was aborted
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Request cancelled by user');
    }

    Logger.info('[callPlannerLLM] Calling llm.plannerCall with tools...');
    Logger.debug('[callPlannerLLM] Context string length:', contextStr.length);
    Logger.debug('[callPlannerLLM] Conversation history length:', conversationHistory.length);
    const result = await llm.plannerCall(contextStr, prompt, tools, abortSignal, conversationHistory);
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
 * @param {Array} conversationHistory - Recent conversation history [{role, content}, ...]
 * @param {Function} onInteraction - Optional callback for user interactions (question) => Promise<answer>
 * @param {Function} onStreamChunk - Optional callback for streaming answer chunks (for questions)
 * @returns {Promise<{type: string, message: string, success: boolean, streaming?: boolean}>}
 */
async function processRequest(context, prompt, onProgress = null, abortSignal = null, conversationHistory = [], onInteraction = null, onStreamChunk = null) {
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
    Logger.debug('[processRequest] Conversation history length:', conversationHistory.length);
    const plannerResult = await callPlannerLLM(context, prompt, abortSignal, conversationHistory);
    Logger.info('[processRequest] Planner LLM result:', plannerResult);
    
    // Check if request was aborted after planner call
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Request cancelled by user');
    }
    
    // Step 2: Route based on intent
    Logger.info(`[processRequest] Step 2: Routing based on intent: ${plannerResult.intent}`);

    if (plannerResult.intent === 'question') {
      // Stream answer with structured thinking
      Logger.info('[processRequest] Intent: question - streaming answer');

      // Prepare context string for streaming (use extracted elements for better context)
      let contextStr = '';
      if (typeof context === 'string') {
        contextStr = context;
      } else if (context && typeof context === 'object') {
        contextStr = `URL: ${context.url || ''}\nTitle: ${context.title || ''}\n\n`;

        // Extract interactive elements for context
        if (context.html) {
          try {
            const extracted = extractHTMLContext(context.html, {
              maxElements: 50, // Fewer elements for questions
              includeLinks: true,
              includeForms: false
            });
            contextStr += `${extracted.formatted}\n\n`;
          } catch (error) {
            Logger.warn('[processRequest] Failed to extract context for streaming:', error);
          }
        }

        if (context.text) {
          contextStr += `Page Text (first 3000 chars):\n${context.text.substring(0, 3000)}\n\n`;
        }
        if (context.html) {
          contextStr += `Page HTML snippet (first 2000 chars):\n${context.html.substring(0, 2000)}`;
        }
      }

      // If no streaming callback provided and we have a short answer, return directly
      if (!onStreamChunk && plannerResult.answer && plannerResult.answer.length < 200) {
        // Short answer without streaming callback, return directly
        Logger.info('[processRequest] Short answer (no streaming callback), returning directly');
        return {
          type: 'answer',
          message: plannerResult.answer,
          success: true,
          streaming: false
        };
      }

      // Stream the answer (always stream when callback is provided for better UX)
      const llm = getLLMClient();
      let fullAnswer = '';

      try {
        fullAnswer = await llm.streamQuestionAnswer(
          contextStr,
          prompt,
          (chunk) => {
            // Stream each chunk to the callback
            if (onStreamChunk) {
              onStreamChunk(chunk);
            }
            fullAnswer += chunk;
          },
          abortSignal
        );

        Logger.info('[processRequest] Streaming completed');
        return {
          type: 'answer',
          message: fullAnswer,
          success: true,
          streaming: true
        };
      } catch (error) {
        Logger.error('[processRequest] Streaming error:', error);
        // Fallback to planner answer if available
        if (plannerResult.answer) {
          return {
            type: 'answer',
            message: plannerResult.answer,
            success: true,
            streaming: false
          };
        }
        throw error;
      }
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
          abortSignal, // Pass abort signal to sequencer
          onInteraction // Pass interaction callback for user questions
        );

        Logger.info('[processRequest] Sequential execution completed');
        Logger.info('[processRequest] Result:', executionResult);

        return {
          type: 'execution',
          message: executionResult.message,
          taskList: executionResult.results.map((r) => {
            // Use appropriate icon based on status
            const icon = r.status === 'success' ? '●' : r.status === 'failed' ? '✗' : '○';
            // Build the task line with description
            let taskLine = `${icon} ${r.action.description}`;
            // Include the result/reason if available (contains MCP tool results)
            if (r.reason && r.status === 'success') {
              // Add the result on a new line with indentation for readability
              taskLine += `\n   → ${r.reason}`;
            } else if (r.reason && r.status === 'failed') {
              // Show failure reason
              taskLine += `\n   ✗ ${r.reason}`;
            }
            return taskLine;
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
export { processRequest, callPlannerLLM, delegateToTaskB, getMergedTools, mcpClient };
