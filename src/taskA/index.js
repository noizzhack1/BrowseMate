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
 * Call Planner LLM to determine intent (question vs action)
 * @param {string} context - Page context (text or HTML)
 * @param {string} prompt - User's question or request
 * @returns {Promise<{intent: string, answer?: string, action?: {type: string, target: string, value?: string}}>}
 */
async function callPlannerLLM(context, prompt) {
  Logger.info('[callPlannerLLM] Starting planner LLM call');
  Logger.debug('[callPlannerLLM] Prompt:', prompt);
  Logger.debug('[callPlannerLLM] Context type:', typeof context);
  
  const llm = getLLMClient();
  Logger.debug('[callPlannerLLM] LLM client obtained');
  
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
    Logger.info('[callPlannerLLM] Calling llm.plannerCall...');
    Logger.debug('[callPlannerLLM] Context string length:', contextStr.length);
    const result = await llm.plannerCall(contextStr, prompt);
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
 * @returns {Promise<{type: string, message: string, success: boolean}>}
 */
async function processRequest(context, prompt) {
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
      // Delegate to Task B
      Logger.info('[processRequest] Intent: action - delegating to Task B');
      
      const actions = plannerResult.actions || (plannerResult.action ? [plannerResult.action] : []);
      Logger.debug('[processRequest] Actions to execute:', actions);
      
      if (actions.length === 0) {
        Logger.error('[processRequest] Action intent but no action details provided');
        return {
          type: 'action_result',
          message: 'LLM identified an action but did not provide action details.',
          success: false
        };
      }
      
      // Execute actions sequentially
      let lastResult = { success: true, message: 'No actions executed' };
      const results = [];
      
      for (const [index, action] of actions.entries()) {
        Logger.info(`[processRequest] Executing action ${index + 1}/${actions.length}`);
        
        try {
            const result = await delegateToTaskB(action);
            results.push(result);
            lastResult = result;
            
            if (!result.success) {
                Logger.warn(`[processRequest] Action ${index + 1} failed, stopping execution sequence.`);
                break;
            }
        } catch (error) {
            Logger.error(`[processRequest] Error executing action ${index + 1}:`, error);
            lastResult = { success: false, message: `Error executing action ${index + 1}: ${error.message}` };
            break;
        }
      }
      
      return {
        type: 'action_result',
        message: lastResult.message || `Completed ${results.length} actions.`,
        success: lastResult.success
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
