/**
 * ===========================================
 * File: index.js (executor)
 * Purpose: Action Executor module - generates and executes browser automation code
 * Main entry point for Task B functionality
 * Dependencies: LLMClient.js, retry.js, logger.js
 * ===========================================
 */

// Import retry logic for multiple attempts
import { executeWithRetry } from '../utils/retry.js';
// Import logger for debugging and tracking
import { Logger } from '../utils/logger.js';
// Import HTML diff utility for change detection
import { hasChanged } from '../utils/diff.js';

const CHANGE_POLL_TIMEOUT_MS = 4000;
const CHANGE_POLL_INTERVAL_MS = 300;
const POST_ACTION_SETTLE_MS = 500;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id ? tab.id : null;
}

async function getPageHTML(tabId) {
  if (!tabId) return '';

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.body.outerHTML
  });

  return results && results[0] ? results[0].result : '';
}

async function waitForDomChange(tabId, htmlBefore) {
  let latestHtml = htmlBefore || '';

  // Small settle delay before starting the polling loop
  if (POST_ACTION_SETTLE_MS > 0) {
    await sleep(POST_ACTION_SETTLE_MS);
  }

  const startTime = Date.now();
  while (Date.now() - startTime < CHANGE_POLL_TIMEOUT_MS) {
    try {
      latestHtml = await getPageHTML(tabId);
      if (latestHtml && hasChanged(htmlBefore, latestHtml)) {
        return { changed: true, htmlAfter: latestHtml };
      }
    } catch (error) {
      Logger.warn('[waitForDomChange] Failed to poll HTML:', error);
      break;
    }

    await sleep(CHANGE_POLL_INTERVAL_MS);
  }

  // Final comparison using the last HTML snapshot
  return {
    changed: hasChanged(htmlBefore, latestHtml),
    htmlAfter: latestHtml
  };
}

/**
 * Execute a WebAction in the page context
 * @param {string} actionName - Name of the action to execute
 * @param {Array} params - Parameters for the action
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
async function executeWebAction(actionName, params) {
  Logger.info('[executeWebAction] Executing web action:', actionName);
  Logger.debug('[executeWebAction] Params:', params);

  try {
    Logger.debug('[executeWebAction] Getting active tab...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      Logger.error('[executeWebAction] No active tab found');
      return { success: false, error: 'No active tab found' };
    }

    Logger.info(`[executeWebAction] Found tab ${tab.id}, executing action in MAIN world`);

    // Execute the action in the page's MAIN world
    // We pass the action name and params as arguments, then reconstruct the action in the page context
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (actionName, ...params) => {
        try {
          // Define all WebActions inline in the page context
          const WebActions = {
            click: (selector) => {
              const element = document.querySelector(selector);
              if (!element) throw new Error(`Element not found: ${selector}`);
              element.click();
              return { success: true, message: `Clicked element: ${selector}` };
            },
            fill: (selector, value) => {
              const element = document.querySelector(selector);
              if (!element) throw new Error(`Input element not found: ${selector}`);
              element.value = value;
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, message: `Filled ${selector} with: ${value}` };
            },
            select: (selector, value) => {
              const element = document.querySelector(selector);
              if (!element || element.tagName !== 'SELECT') throw new Error(`Select element not found: ${selector}`);
              let found = false;
              for (const option of element.options) {
                if (option.value === value || option.text === value) {
                  option.selected = true;
                  found = true;
                  break;
                }
              }
              if (!found) throw new Error(`Option not found in select: ${value}`);
              element.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, message: `Selected ${value} in ${selector}` };
            },
            check: (selector, checked = true) => {
              const element = document.querySelector(selector);
              if (!element || element.type !== 'checkbox') throw new Error(`Checkbox not found: ${selector}`);
              element.checked = checked;
              element.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, message: `${checked ? 'Checked' : 'Unchecked'} ${selector}` };
            },
            scroll: (target, direction = 'vertical') => {
              if (typeof target === 'string') {
                const element = document.querySelector(target);
                if (!element) throw new Error(`Element not found: ${target}`);
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return { success: true, message: `Scrolled to ${target}` };
              } else if (typeof target === 'number') {
                if (direction === 'horizontal') {
                  window.scrollBy({ left: target, behavior: 'smooth' });
                } else {
                  window.scrollBy({ top: target, behavior: 'smooth' });
                }
                return { success: true, message: `Scrolled ${direction} by ${target}px` };
              }
              throw new Error('Invalid scroll target');
            },
            hover: (selector) => {
              const element = document.querySelector(selector);
              if (!element) throw new Error(`Element not found: ${selector}`);
              element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
              element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              return { success: true, message: `Hovered over ${selector}` };
            },
            submit: (selector) => {
              const element = document.querySelector(selector);
              if (!element || element.tagName !== 'FORM') throw new Error(`Form not found: ${selector}`);
              element.submit();
              return { success: true, message: `Submitted form: ${selector}` };
            },
            navigate: (url) => {
              window.location.href = url;
              return { success: true, message: `Navigating to ${url}` };
            },
            clickLink: (text, exact = false) => {
              const links = Array.from(document.querySelectorAll('a'));
              const link = links.find(a => exact ? a.textContent.trim() === text : a.textContent.includes(text));
              if (!link) throw new Error(`Link not found with text: ${text}`);
              link.click();
              return { success: true, message: `Clicked link: ${text}` };
            },
            clickButton: (text, exact = false) => {
              const normalize = (str) => (str || '').replace(/\s+/g, ' ').trim().toLowerCase();
              const target = normalize(text);
              const candidates = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'));

              const button = candidates.find(b => {
                const label = normalize(b.textContent);
                const value = normalize(b.value);
                const aria = normalize(b.getAttribute('aria-label'));
                const title = normalize(b.getAttribute('title'));

                if (exact) {
                  return label === target || value === target || aria === target || title === target;
                }

                return (label && label.includes(target)) ||
                       (value && value.includes(target)) ||
                       (aria && aria.includes(target)) ||
                       (title && title.includes(target));
              });

              if (!button) throw new Error(`Button not found with text: ${text}`);
              button.click();
              return { success: true, message: `Clicked button: ${text}` };
            },
            waitForElement: (selector, timeout = 5000) => {
              return new Promise((resolve, reject) => {
                const startTime = Date.now();
                const checkInterval = 100;

                const checkElement = () => {
                  const element = document.querySelector(selector);
                  if (element) {
                    resolve({ success: true, message: `Element found: ${selector}` });
                  } else if (Date.now() - startTime >= timeout) {
                    reject(new Error(`Timeout waiting for element: ${selector}`));
                  } else {
                    setTimeout(checkElement, checkInterval);
                  }
                };

                checkElement();
              });
            },
            getText: (selector) => {
              const element = document.querySelector(selector);
              if (!element) throw new Error(`Element not found: ${selector}`);
              const text = element.textContent.trim();
              return { success: true, message: `Text: ${text}`, data: text };
            },
            getValue: (selector) => {
              const element = document.querySelector(selector);
              if (!element) throw new Error(`Element not found: ${selector}`);
              const value = element.value;
              return { success: true, message: `Value: ${value}`, data: value };
            },
            clear: (selector) => {
              const element = document.querySelector(selector);
              if (!element) throw new Error(`Input element not found: ${selector}`);
              element.value = '';
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, message: `Cleared ${selector}` };
            },
            focus: (selector) => {
              const element = document.querySelector(selector);
              if (!element) throw new Error(`Element not found: ${selector}`);
              element.focus();
              return { success: true, message: `Focused on ${selector}` };
            },
            pressKey: (key, selector = null) => {
              const target = selector ? document.querySelector(selector) : document.activeElement;
              if (!target) throw new Error(selector ? `Element not found: ${selector}` : 'No active element');
              target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
              target.dispatchEvent(new KeyboardEvent('keypress', { key, bubbles: true }));
              target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
              return { success: true, message: `Pressed key: ${key}` };
            },
            openNewTab: (url) => {
              window.open(url, '_blank');
              return { success: true, message: `Opened new tab: ${url}` };
            },
            reload: () => {
              window.location.reload();
              return { success: true, message: 'Page reloaded' };
            },
            goBack: () => {
              window.history.back();
              return { success: true, message: 'Navigated back' };
            },
            goForward: () => {
              window.history.forward();
              return { success: true, message: 'Navigated forward' };
            }
          };

          // Execute the requested action
          if (!WebActions[actionName]) {
            throw new Error(`Unknown action: ${actionName}`);
          }

          return WebActions[actionName](...params);

        } catch (error) {
          return { success: false, error: error.message };
        }
      },
      args: [actionName, ...params]
    });

    Logger.debug('[executeWebAction] Script execution completed, processing results...');
    Logger.debug('[executeWebAction] Results:', results);

    if (results && results[0]) {
      const result = results[0].result;
      Logger.debug('[executeWebAction] Result from page:', result);

      // Check for errors
      if (result && typeof result === 'object') {
        if (result.error) {
          Logger.error('[executeWebAction] Action error:', result.error);
          return { success: false, error: result.error };
        }

        // Success
        if (result.success !== undefined) {
          return result;
        }
      }
    }

    // Default success
    Logger.info('[executeWebAction] Action executed successfully');
    return { success: true };

  } catch (error) {
    Logger.error('[executeWebAction] Action execution failed:', error);
    Logger.error('[executeWebAction] Error message:', error.message);
    Logger.error('[executeWebAction] Error stack:', error.stack);
    return { success: false, error: error.message };
  }
}


/**
 * Main entry point - execute an action on the page using WebActions
 * @param {Object} action - Action to perform
 * @param {string} action.name - Name of the WebAction to execute
 * @param {Object} action.params - Parameters for the action
 * @returns {Promise<{success: boolean, message: string}>} - Execution result
 */
async function executeAction(action) {
  // Log the action being executed
  Logger.info('[executeAction] Starting action execution');
  Logger.info('[executeAction] Action details:', JSON.stringify(action, null, 2));

  // Validate action object has required fields
  if (!action || !action.name || !action.params) {
    Logger.error('[executeAction] Invalid action: missing name or params');
    Logger.error('[executeAction] Action received:', action);
    // Return early with validation error
    return { success: false, message: 'Invalid action: missing name or params' };
  }

  Logger.debug('[executeAction] Action validation passed');
  Logger.debug('[executeAction] Action name:', action.name);
  Logger.debug('[executeAction] Action params:', action.params);
  
  // Extract parameters from action.params as an array for WebActions
  const paramValues = Object.values(action.params);

  Logger.info('[executeAction] Preparing to execute WebAction...');
  Logger.debug('[executeAction] Action name:', action.name);
  Logger.debug('[executeAction] Param values:', paramValues);

  try {
    // Execute the action with retry logic
    Logger.info('[executeAction] Starting retry wrapper (max 3 attempts)');
    const result = await executeWithRetry(async (attempt) => {
      Logger.info(`[executeAction] Attempt ${attempt}: Executing ${action.name}...`);

      const tabId = await getActiveTabId();
      if (!tabId) {
        Logger.error('[executeAction] No active tab found');
        return { success: false, message: 'No active tab found' };
      }

      // Get HTML before action
      let htmlBefore = '';
      try {
        htmlBefore = await getPageHTML(tabId);
      } catch (error) {
        Logger.warn(`[executeAction] Attempt ${attempt}: Failed to get HTML before:`, error);
      }

      // Execute the action
      const execResult = await executeWebAction(action.name, paramValues);
      Logger.info(`[executeAction] Attempt ${attempt}: Execution result:`, execResult);

      // Check if execution succeeded
      if (!execResult.success) {
        Logger.error(`[executeAction] Attempt ${attempt}: Action failed:`, execResult.error);
        return { success: false, message: execResult.error || 'Action execution failed' };
      }

      // Skip HTML change check for simple fill actions to avoid false negatives
      if (action.name === 'fill') {
        return {
          success: true,
          message: execResult.message || 'Action fill executed successfully'
        };
      }

      // Get HTML after action
      const { changed, htmlAfter } = await waitForDomChange(tabId, htmlBefore);
      Logger.info(`[executeAction] Attempt ${attempt}: HTML change detected:`, changed);

      // Some actions don't change HTML (scroll, hover, navigate, fill, etc.)
      // fill is included because input values are DOM properties, not HTML attributes
      const noChangeExpected = ['scroll', 'hover', 'navigate', 'reload', 'goBack', 'goForward', 'openNewTab', 'focus', 'pressKey', 'fill', 'clear'];

      if (changed) {
        Logger.info(`[executeAction] Attempt ${attempt}: Action successful - page changed`);
        return {
          success: true,
          message: execResult.message || 'Action executed successfully'
        };
      } else if (noChangeExpected.includes(action.name)) {
        Logger.info(`[executeAction] Attempt ${attempt}: Action '${action.name}' doesn't require HTML change`);
        return {
          success: true,
          message: execResult.message || `Action ${action.name} executed successfully`
        };
      } else {
        Logger.warn(`[executeAction] Attempt ${attempt}: No HTML change detected, will retry`);
        return {
          success: false,
          message: 'Action executed but no page change detected'
        };
      }
    });

    Logger.info('[executeAction] Retry wrapper completed');
    Logger.info('[executeAction] Final result:', result);
    // Return the final result from retry wrapper
    return result;

  } catch (error) {
    Logger.error('[executeAction] Failed to create or execute WebAction:', error);
    Logger.error('[executeAction] Error message:', error.message);
    Logger.error('[executeAction] Error stack:', error.stack);
    return {
      success: false,
      message: `Failed to execute action: ${error.message}`
    };
  }
}

// Export functions for ES6 modules
export { executeAction, executeWebAction };

