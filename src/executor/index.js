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
 * Execute action safely using chrome.scripting.executeScript
 * This replaces the unsafe 'eval'/'new Function' approach
 * @param {Object} params - Action parameters
 * @param {string} params.selector - CSS selector for the target element
 * @param {string} params.actionType - Type of action (click, fill, scroll, hover)
 * @param {string} [params.value] - Value for inputs or scroll direction
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function executeSafeAction(params) {
  Logger.info('[executeSafeAction] Starting safe action execution');
  Logger.debug('[executeSafeAction] Params:', params);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      Logger.error('[executeSafeAction] No active tab found');
      return { success: false, error: 'No active tab found' };
    }

    Logger.info(`[executeSafeAction] Found tab ${tab.id}, injecting script...`);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (selector, actionType, value) => {
        console.log(`[BrowseMate] Executing action: ${actionType} on ${selector}`);
        
        try {
          // Helper to find element by CSS or XPath
          const getElement = (sel) => {
            if (!sel) return null;
            if (sel.startsWith('//') || sel.startsWith('(')) {
              // XPath
              try {
                const result = document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return result.singleNodeValue;
              } catch (e) {
                console.warn(`Invalid XPath: ${sel}`, e);
                return null;
              }
            } else {
              // CSS
              try {
                return document.querySelector(sel);
              } catch (e) {
                console.warn(`Invalid CSS selector: ${sel}`, e);
                return null;
              }
            }
          };

          const element = getElement(selector);
          if (!element && actionType !== 'scroll' && actionType !== 'keypress') {
            throw new Error(`Element not found: ${selector}`);
          }

          // Helper to simulate events
          const dispatchEvent = (el, eventType, options = {}) => {
            const event = new Event(eventType, { bubbles: true, cancelable: true, ...options });
            el.dispatchEvent(event);
          };

          switch (actionType.toLowerCase()) {
            case 'click':
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Slight delay to allow scroll
                element.click();
                dispatchEvent(element, 'mousedown');
                dispatchEvent(element, 'mouseup');
              }
              break;
              
            case 'fill':
            case 'input':
            case 'type':
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                element.focus();
                // Handle different input types
                if (element.getAttribute('contenteditable') === 'true') {
                  element.innerText = value;
                } else {
                  element.value = value;
                }
                dispatchEvent(element, 'input');
                dispatchEvent(element, 'change');
                element.blur();
              }
              break;

            case 'select':
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                element.focus();
                element.value = value;
                dispatchEvent(element, 'change');
                dispatchEvent(element, 'input');
                element.blur();
              }
              break;

            case 'check':
            case 'checkbox':
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Determine boolean value from string/boolean input
                const shouldCheck = String(value).toLowerCase() === 'true' || 
                                   String(value).toLowerCase() === 'on' || 
                                   String(value).toLowerCase() === 'checked' || 
                                   value === true;
                
                if (element.checked !== shouldCheck) {
                    element.click(); // Click usually triggers the right events for checkboxes
                }
                
                // Force state just in case
                element.checked = shouldCheck;
                dispatchEvent(element, 'change');
              }
              break;
              
            case 'scroll':
              if (value === 'bottom') {
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
              } else if (value === 'top') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              } else if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
              break;

            case 'hover':
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                dispatchEvent(element, 'mouseover');
                dispatchEvent(element, 'mouseenter');
                dispatchEvent(element, 'mousemove');
              }
              break;

            case 'submit':
              if (element) {
                if (element.tagName === 'FORM') {
                    element.submit();
                } else if (element.form) {
                    element.form.submit();
                } else {
                    // Try clicking as fallback
                    element.click();
                }
              }
              break;

            case 'keypress':
              const target = element || document.activeElement || document.body;
              target.focus();
              const key = value; // e.g., 'Enter', 'Escape'
              const keyOptions = {
                  key: key,
                  code: key,
                  bubbles: true,
                  cancelable: true,
                  view: window
              };
              target.dispatchEvent(new KeyboardEvent('keydown', keyOptions));
              target.dispatchEvent(new KeyboardEvent('keypress', keyOptions));
              target.dispatchEvent(new KeyboardEvent('keyup', keyOptions));
              break;

            case 'focus':
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                element.focus();
                dispatchEvent(element, 'focus');
              }
              break;

            default:
              throw new Error(`Unknown action type: ${actionType}`);
          }
          
          return { success: true };
        } catch (error) {
          console.error('[BrowseMate] Action failed:', error);
          return { success: false, error: error.message };
        }
      },
      args: [params.selector, params.actionType, params.value || '']
    });

    Logger.debug('[executeSafeAction] Script execution completed, results:', results);

    if (results && results[0] && results[0].result) {
      return results[0].result;
    } else {
      return { success: false, error: 'No result returned from script execution' };
    }

  } catch (error) {
    Logger.error('[executeSafeAction] Execution failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Main entry point - execute an action on the page
 * Generates structured action parameters via LLM and executes safely
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
            const scripts = clone.querySelectorAll("script, style, noscript, iframe, svg");
            scripts.forEach((el) => el.remove());
            const text = clone.innerText.replace(/\s+/g, " ").trim();
            return {
              url: window.location.href,
              title: document.title,
              text: text,
              html: clone.outerHTML
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
    
    // Validate we got HTML content
    if (!context.html) {
      Logger.error(`[executeAction] Attempt ${attempt}: No HTML content in context`);
      return { success: false, message: 'Failed to get page HTML' };
    }
    
    // Store HTML before action execution
    const htmlBefore = context.html;
    Logger.debug(`[executeAction] Attempt ${attempt}: HTML before action (length: ${htmlBefore.length})`);
    
    // Generate structured action parameters via LLM
    Logger.info(`[executeAction] Attempt ${attempt}: Calling LLM to generate action parameters...`);
    let llmResponse;
    try {
      Logger.debug(`[executeAction] Attempt ${attempt}: Calling llm.actionsCall with HTML (${context.html.length} chars) and action:`, action);
      llmResponse = await llm.actionsCall(context.html, action);
      Logger.info(`[executeAction] Attempt ${attempt}: LLM response received`);
    } catch (error) {
      Logger.error(`[executeAction] Attempt ${attempt}: LLM actionsCall failed:`, error);
      Logger.error(`[executeAction] Attempt ${attempt}: Error message:`, error.message);
      return { success: false, message: `LLM call failed: ${error.message}` };
    }
    
    // Validate LLM returned parameters
    if (!llmResponse || !llmResponse.selector || !llmResponse.actionType) {
      Logger.error(`[executeAction] Attempt ${attempt}: LLM response invalid:`, llmResponse);
      return { success: false, message: 'LLM failed to generate valid action parameters' };
    }
    
    Logger.info(`[executeAction] Attempt ${attempt}: Parameters generated successfully`);
    Logger.debug(`[executeAction] Attempt ${attempt}: Params:`, llmResponse);
    
    // Execute the action safely
    Logger.info(`[executeAction] Attempt ${attempt}: Executing safe action...`);
    const execResult = await executeSafeAction(llmResponse);
    Logger.info(`[executeAction] Attempt ${attempt}: Action execution completed:`, execResult);
    
    // Check if execution succeeded
    if (!execResult.success) {
      Logger.error(`[executeAction] Attempt ${attempt}: Action execution failed:`, execResult.error);
      return { success: false, message: `Action execution failed: ${execResult.error}` };
    }
    
    Logger.debug(`[executeAction] Attempt ${attempt}: Action executed successfully, waiting for DOM updates...`);
    // Wait a bit for DOM changes to propagate
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Get HTML after action execution to check for changes
    Logger.debug(`[executeAction] Attempt ${attempt}: Getting HTML after action execution...`);
    let htmlAfter;
    try {
      if (typeof getPageContext === 'function') {
        const contextAfter = await getPageContext();
        htmlAfter = contextAfter.html;
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const clone = document.body.cloneNode(true);
              const scripts = clone.querySelectorAll("script, style, noscript, iframe, svg");
              scripts.forEach((el) => el.remove());
              return clone.outerHTML;
            }
          });
          htmlAfter = results && results[0] ? results[0].result : null;
        }
      }
    } catch (error) {
      Logger.warn(`[executeAction] Attempt ${attempt}: Failed to get HTML after execution:`, error);
      htmlAfter = htmlBefore;
    }
    
    // Check if HTML changed
    const changed = htmlAfter && hasChanged(htmlBefore, htmlAfter);
    Logger.info(`[executeAction] Attempt ${attempt}: HTML change check result:`, changed);
    
    if (changed) {
      return { 
        success: true, 
        message: llmResponse.explanation || 'Action executed successfully and page changed' 
      };
    } else {
      Logger.warn(`[executeAction] Attempt ${attempt}: No HTML change detected after action execution`);
      
      if (action.type === 'scroll' || action.type === 'hover') {
        return { 
          success: true, 
          message: llmResponse.explanation || 'Action executed successfully (no HTML change expected)' 
        };
      }
      
      return { 
        success: false, 
        message: 'Action executed but no page change detected. The element might not exist or the action had no effect.' 
      };
    }
  });
  
  Logger.info('[executeAction] Retry wrapper completed');
  Logger.info('[executeAction] Final result:', result);
  return result;
}

// Export functions for ES6 modules
export { executeAction };
