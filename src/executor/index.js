/**
 * ===========================================
 * File: index.js (executor)
 * Purpose: Action Executor module - generates and executes browser automation code
 * Main entry point for Task B functionality
 * Dependencies: LLMClient.js, retry.js, logger.js
 * ===========================================
 */

// Import LLM client for generating action code
import { LLMClient } from '../llm/LLMClient.js';
// Import retry logic for multiple attempts
import { executeWithRetry } from './retry.js';
// Import logger for debugging and tracking
import { Logger } from '../utils/logger.js';
// Import HTML diff utility for change detection
import { hasChanged } from './diff.js';

// LLM client instance - lazy initialized on first use
let llmClient = null;

/**
 * Get or create LLM client instance (singleton pattern)
 * Ensures only one LLMClient exists throughout the extension
 * @returns {LLMClient} - The LLM client instance
 */
function getLLMClient() {
  // Create new instance if none exists
  if (!llmClient) {
    llmClient = new LLMClient();
  }
  // Return existing or newly created instance
  return llmClient;
}

/**
 * Execute generated JavaScript code in the page context
 * Uses chrome.scripting.executeScript() with world: 'MAIN' to execute in page context
 * This bypasses extension CSP and uses the page's CSP instead
 * @param {string} code - JavaScript code to execute
 * @returns {Promise<{success: boolean, error?: string}>} - Execution result
 */
async function runCode(code) {
  Logger.info('[runCode] Starting code execution');
  Logger.debug('[runCode] Code to execute:', code);
  
  try {
    Logger.debug('[runCode] Getting active tab...');
    // Get the active tab to execute code in
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      Logger.error('[runCode] No active tab found');
      return { success: false, error: 'No active tab found' };
    }

    Logger.info(`[runCode] Found tab ${tab.id}, executing code in MAIN world`);
    
    // Execute the code in the page's MAIN world (bypasses extension CSP)
    // Trusted Types blocks Function constructor, eval, script.textContent, and iframe.srcdoc IN THE PAGE CONTEXT
    // Solution: Use new Function() in the EXTENSION context to create the function,
    // then inject that pre-compiled function into the page
    // Since the function is already compiled, Trusted Types won't block it
    
    Logger.debug('[runCode] Creating function from code in extension context...');
    // Create the function in extension context (not blocked by page's Trusted Types)
    const executeFunc = new Function(`
      console.log('[Page Context] Executing injected code');
      try {
        // Execute the code directly - it's already compiled as part of this function
        ${code}
        
        console.log('[Page Context] Code execution completed successfully');
        return { __success: true };
      } catch (error) {
        console.error('[Page Context] Code execution error:', error);
        return { 
          __error: error.message, 
          __stack: error.stack, 
          __name: error.name 
        };
      }
    `);
    
    Logger.debug('[runCode] Function created, injecting into page...');
    // Inject the pre-compiled function into the page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN', // Execute in page's main world, not isolated world
      func: executeFunc
    });

    Logger.debug('[runCode] Script execution completed, processing results...');
    Logger.debug('[runCode] Results:', results);

    // Check for execution errors
    if (results && results[0]) {
      const result = results[0].result;
      Logger.debug('[runCode] Result from page:', result);
      
      // Check if there was an error
      if (result && typeof result === 'object' && result.__error) {
        Logger.error('[runCode] Code execution error detected:', result.__error);
        Logger.error('[runCode] Error stack:', result.__stack);
        return { success: false, error: result.__error };
      }
      
      // If result is a promise, await it
      if (result instanceof Promise) {
        Logger.debug('[runCode] Result is a Promise, awaiting...');
        try {
          const promiseResult = await result;
          Logger.debug('[runCode] Promise resolved:', promiseResult);
        } catch (error) {
          Logger.error('[runCode] Promise execution error:', error);
          return { success: false, error: error.message };
        }
      }
    } else {
      Logger.warn('[runCode] No results returned from script execution');
    }
    
    // Log successful execution
    Logger.info('[runCode] Code executed successfully');
    // Return success result
    return { success: true };
    
  } catch (error) {
    // Log the execution error
    Logger.error('[runCode] Code execution failed with exception:', error);
    Logger.error('[runCode] Error message:', error.message);
    Logger.error('[runCode] Error stack:', error.stack);
    // Return failure with error message
    return { success: false, error: error.message };
  }
}

/**
 * Main entry point - execute an action on the page
 * Generates code via LLM and executes with retry logic
 * @param {Object} action - Action to perform
 * @param {string} action.type - Type of action (click, fill, scroll, etc.)
 * @param {string} action.target - Description of target element
 * @param {string} [action.value] - Optional value for fill/select actions
 * @returns {Promise<{success: boolean, message: string}>} - Execution result
 */
async function executeAction(action) {
  // Log the action being executed
  Logger.info('[executeAction] Starting action execution');
  Logger.info('[executeAction] Action details:', JSON.stringify(action, null, 2));
  
  // Validate action object has required fields
  if (!action || !action.type || !action.target) {
    Logger.error('[executeAction] Invalid action: missing type or target');
    Logger.error('[executeAction] Action received:', action);
    // Return early with validation error
    return { success: false, message: 'Invalid action: missing type or target' };
  }
  
  Logger.debug('[executeAction] Action validation passed');
  Logger.debug('[executeAction] Getting LLM client instance...');
  // Get the LLM client instance
  const llm = getLLMClient();
  Logger.debug('[executeAction] LLM client obtained');
  
  Logger.info('[executeAction] Starting retry wrapper (max 3 attempts)');
  // Use retry wrapper for the execution (default 3 attempts)
  const result = await executeWithRetry(async (attempt) => {
    Logger.info(`[executeAction] Attempt ${attempt}: Starting execution`);
    
    // Get fresh page context for each attempt
    // This uses the existing getPageContext() from script.js (available globally)
    Logger.debug(`[executeAction] Attempt ${attempt}: Getting page context...`);
    let context;
    try {
      // Try to call getPageContext if available globally
      if (typeof getPageContext === 'function') {
        Logger.debug(`[executeAction] Attempt ${attempt}: Using global getPageContext()`);
        context = await getPageContext();
        Logger.debug(`[executeAction] Attempt ${attempt}: Context retrieved via global function`);
      } else {
        Logger.debug(`[executeAction] Attempt ${attempt}: getPageContext not available, using chrome.scripting fallback`);
        // Fallback: getPageContext might not be available in module context
        // We need to get it via chrome.scripting.executeScript
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          return { success: false, message: 'Failed to get active tab' };
        }
        
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const clone = document.body.cloneNode(true);
            const scripts = clone.querySelectorAll("script, style, noscript");
            scripts.forEach((el) => el.remove());
            const text = clone.innerText.replace(/\s+/g, " ").trim();
            return {
              url: window.location.href,
              title: document.title,
              text: text,
              html: document.body.outerHTML
            };
          }
        });
        
        context = results && results[0] && results[0].result
          ? results[0].result
          : { url: "", title: "", text: "", html: "" };
        Logger.debug(`[executeAction] Attempt ${attempt}: Context retrieved via chrome.scripting`);
      }
    } catch (error) {
      Logger.error(`[executeAction] Attempt ${attempt}: Failed to get page context:`, error);
      Logger.error(`[executeAction] Attempt ${attempt}: Error details:`, error.message, error.stack);
      return { success: false, message: `Failed to get page context: ${error.message}` };
    }
    
    Logger.debug(`[executeAction] Attempt ${attempt}: Context retrieved:`, {
      url: context.url,
      title: context.title,
      textLength: context.text?.length || 0,
      htmlLength: context.html?.length || 0
    });
    
    // Validate we got HTML content
    if (!context.html) {
      Logger.error(`[executeAction] Attempt ${attempt}: No HTML content in context`);
      return { success: false, message: 'Failed to get page HTML' };
    }
    
    // Store HTML before action execution
    const htmlBefore = context.html;
    Logger.debug(`[executeAction] Attempt ${attempt}: HTML before action (length: ${htmlBefore.length})`);
    
    // Generate code via LLM using the page HTML and action details
    Logger.info(`[executeAction] Attempt ${attempt}: Calling LLM to generate code...`);
    let llmResponse;
    try {
      Logger.debug(`[executeAction] Attempt ${attempt}: Calling llm.actionsCall with HTML (${context.html.length} chars) and action:`, action);
      llmResponse = await llm.actionsCall(context.html, action);
      Logger.info(`[executeAction] Attempt ${attempt}: LLM response received`);
    } catch (error) {
      Logger.error(`[executeAction] Attempt ${attempt}: LLM actionsCall failed:`, error);
      Logger.error(`[executeAction] Attempt ${attempt}: Error message:`, error.message);
      Logger.error(`[executeAction] Attempt ${attempt}: Error stack:`, error.stack);
      return { success: false, message: `LLM call failed: ${error.message}` };
    }
    
    // Validate LLM returned code
    if (!llmResponse || !llmResponse.code) {
      Logger.error(`[executeAction] Attempt ${attempt}: LLM response invalid:`, llmResponse);
      return { success: false, message: 'LLM failed to generate code' };
    }
    
    // Log the generated code and explanation
    Logger.info(`[executeAction] Attempt ${attempt}: Code generated successfully`);
    Logger.debug(`[executeAction] Attempt ${attempt}: Generated code:`, llmResponse.code);
    Logger.debug(`[executeAction] Attempt ${attempt}: Explanation:`, llmResponse.explanation);
    
    // Execute the generated code in the page context
    Logger.info(`[executeAction] Attempt ${attempt}: Executing generated code...`);
    const execResult = await runCode(llmResponse.code);
    Logger.info(`[executeAction] Attempt ${attempt}: Code execution completed:`, execResult);
    
    // Check if execution succeeded
    if (!execResult.success) {
      Logger.error(`[executeAction] Attempt ${attempt}: Code execution failed:`, execResult.error);
      return { success: false, message: `Code execution failed: ${execResult.error}` };
    }
    
    Logger.debug(`[executeAction] Attempt ${attempt}: Code executed successfully, waiting for DOM updates...`);
    // Wait a bit for DOM changes to propagate (some actions trigger async updates)
    await new Promise(resolve => setTimeout(resolve, 500));
    Logger.debug(`[executeAction] Attempt ${attempt}: DOM update wait completed`);
    
    // Get HTML after action execution to check for changes
    Logger.debug(`[executeAction] Attempt ${attempt}: Getting HTML after action execution...`);
    let htmlAfter;
    try {
      if (typeof getPageContext === 'function') {
        Logger.debug(`[executeAction] Attempt ${attempt}: Using global getPageContext() for after HTML`);
        const contextAfter = await getPageContext();
        htmlAfter = contextAfter.html;
      } else {
        Logger.debug(`[executeAction] Attempt ${attempt}: Using chrome.scripting for after HTML`);
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.body.outerHTML
          });
          htmlAfter = results && results[0] ? results[0].result : null;
        }
      }
      Logger.debug(`[executeAction] Attempt ${attempt}: HTML after action retrieved (length: ${htmlAfter?.length || 0})`);
    } catch (error) {
      Logger.warn(`[executeAction] Attempt ${attempt}: Failed to get HTML after execution:`, error);
      // For some actions (like scroll), HTML might not change, so we'll allow success
      // if code executed without error
      htmlAfter = htmlBefore; // Use same HTML to avoid false positives
      Logger.debug(`[executeAction] Attempt ${attempt}: Using htmlBefore as htmlAfter due to error`);
    }
    
    // Check if HTML changed (indicates action had an effect)
    Logger.debug(`[executeAction] Attempt ${attempt}: Checking for HTML changes...`);
    const changed = htmlAfter && hasChanged(htmlBefore, htmlAfter);
    Logger.info(`[executeAction] Attempt ${attempt}: HTML change check result:`, changed);
    
    if (changed) {
      Logger.info(`[executeAction] Attempt ${attempt}: HTML change detected - action successful`);
      return { 
        success: true, 
        message: llmResponse.explanation || 'Action executed successfully and page changed' 
      };
    } else {
      // Some actions might not change HTML (e.g., scroll, hover)
      // For these, we'll consider it successful if code executed without error
      // But log a warning that no change was detected
      Logger.warn(`[executeAction] Attempt ${attempt}: No HTML change detected after action execution`);
      
      // For scroll actions, this is expected - consider it success
      if (action.type === 'scroll' || action.type === 'hover') {
        Logger.info(`[executeAction] Attempt ${attempt}: Action type '${action.type}' doesn't require HTML change, considering success`);
        return { 
          success: true, 
          message: llmResponse.explanation || 'Action executed successfully (no HTML change expected)' 
        };
      }
      
      // For other actions, no change might indicate failure
      // Return failure so retry can try a different approach
      Logger.warn(`[executeAction] Attempt ${attempt}: Action executed but no change detected, will retry`);
      return { 
        success: false, 
        message: 'Action executed but no page change detected. The element might not exist or the action had no effect.' 
      };
    }
  });
  
  Logger.info('[executeAction] Retry wrapper completed');
  Logger.info('[executeAction] Final result:', result);
  // Return the final result from retry wrapper
  return result;
}

// Export functions for ES6 modules
export { executeAction, runCode };

