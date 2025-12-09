/**
 * ===========================================
 * File: index.js (executor)
 * Purpose: Action Executor module - generates and executes browser automation code
 * Main entry point for Task B functionality
 * Dependencies: LLMClient.js, retry.js, logger.js, mcp-client.js
 * ===========================================
 */

// Import retry logic for multiple attempts
import { executeWithRetry } from '../utils/retry.js';
// Import logger for debugging and tracking
import { Logger } from '../utils/logger.js';
// Import HTML diff utility for change detection
import { hasChanged } from '../utils/diff.js';
// Import MCP client for external tool execution
import { mcpClient } from './mcp-client.js';

const CHANGE_POLL_TIMEOUT_MS = 4000;
const CHANGE_POLL_INTERVAL_MS = 300;
const POST_ACTION_SETTLE_MS = 500;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return null;

  // Check if this is a protected Chrome URL where script injection is not allowed
  if (tab.url && (tab.url.startsWith('chrome://') ||
                  tab.url.startsWith('chrome-extension://') ||
                  tab.url.startsWith('edge://') ||
                  tab.url.startsWith('about:'))) {
    Logger.warn('[getActiveTabId] Cannot execute actions on protected page:', tab.url);
    throw new Error(`Cannot interact with protected browser pages (${tab.url.split(':')[0]}://). Please navigate to a regular website first.`);
  }

  return tab.id;
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
 * Execute zoom action using chrome.tabs API
 * @param {number|string} level - Zoom level (number like 1.5, percentage like "150%", or relative like "+10%"/"-20%")
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
async function executeZoomAction(level) {
  Logger.info('[executeZoomAction] Setting zoom level:', level);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab found' };
    }

    let zoomFactor;

    if (typeof level === 'number') {
      // Direct zoom factor (e.g., 1.0, 1.5, 2.0)
      zoomFactor = level;
      Logger.info(`[executeZoomAction] Using direct zoom factor: ${zoomFactor}`);
    } else if (typeof level === 'string') {
      const trimmedLevel = level.trim();

      // Handle percentage format
      if (trimmedLevel.includes('%')) {
        const num = parseFloat(trimmedLevel);

        if (trimmedLevel.startsWith('+') || trimmedLevel.startsWith('-')) {
          // Relative zoom (e.g., "+10%", "-20%")
          const currentZoom = await chrome.tabs.getZoom(tab.id);
          const delta = num / 100; // Convert percentage to decimal
          zoomFactor = currentZoom + delta;
          Logger.info(`[executeZoomAction] Relative zoom: current=${currentZoom}, delta=${delta}, new=${zoomFactor}`);
        } else {
          // Absolute percentage (e.g., "150%", "100%")
          zoomFactor = num / 100;
          Logger.info(`[executeZoomAction] Absolute percentage: ${num}% = ${zoomFactor}`);
        }
      } else {
        // Try to parse as number
        const num = parseFloat(trimmedLevel);
        if (!isNaN(num)) {
          zoomFactor = num;
          Logger.info(`[executeZoomAction] Parsed as number: ${zoomFactor}`);
        } else {
          return { success: false, error: `Invalid zoom level: ${level}` };
        }
      }
    } else {
      return { success: false, error: `Invalid zoom level type: ${typeof level}` };
    }

    // Clamp zoom factor to reasonable range (Chrome supports 0.25 to 5.0)
    zoomFactor = Math.max(0.25, Math.min(5.0, zoomFactor));

    // Set the zoom
    await chrome.tabs.setZoom(tab.id, zoomFactor);
    Logger.info(`[executeZoomAction] Successfully set zoom to ${zoomFactor} (${Math.round(zoomFactor * 100)}%)`);

    return {
      success: true,
      message: `Zoom set to ${Math.round(zoomFactor * 100)}%`
    };

  } catch (error) {
    Logger.error('[executeZoomAction] Failed to set zoom:', error);
    return {
      success: false,
      error: error.message || 'Failed to set zoom'
    };
  }
}

/**
 * Execute changeTab action using chrome.tabs API
 * @param {number|string} identifier - Tab identifier (index, ID, "next", "previous", or search text)
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
async function executeChangeTabAction(identifier) {
  Logger.info('[executeChangeTabAction] Switching tab:', identifier);

  try {
    let targetTabId;
    let matchedTabTitle;

    if (typeof identifier === 'number') {
      // Could be tab ID or index
      const tabs = await chrome.tabs.query({ currentWindow: true });

      // Try as index first (0-based)
      if (identifier >= 0 && identifier < tabs.length) {
        targetTabId = tabs[identifier].id;
        matchedTabTitle = tabs[identifier].title;
        Logger.info(`[executeChangeTabAction] Using tab at index ${identifier}, ID: ${targetTabId}`);
      } else {
        // Try as direct tab ID
        targetTabId = identifier;
        Logger.info(`[executeChangeTabAction] Using direct tab ID: ${targetTabId}`);
      }
    } else if (identifier === 'next') {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const currentTab = tabs.find(t => t.active);
      if (!currentTab) {
        return { success: false, error: 'No active tab found' };
      }
      const currentIndex = tabs.indexOf(currentTab);
      const nextIndex = (currentIndex + 1) % tabs.length;
      targetTabId = tabs[nextIndex].id;
      matchedTabTitle = tabs[nextIndex].title;
      Logger.info(`[executeChangeTabAction] Switching to next tab, index: ${nextIndex}, ID: ${targetTabId}`);
    } else if (identifier === 'previous' || identifier === 'prev') {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const currentTab = tabs.find(t => t.active);
      if (!currentTab) {
        return { success: false, error: 'No active tab found' };
      }
      const currentIndex = tabs.indexOf(currentTab);
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      targetTabId = tabs[prevIndex].id;
      matchedTabTitle = tabs[prevIndex].title;
      Logger.info(`[executeChangeTabAction] Switching to previous tab, index: ${prevIndex}, ID: ${targetTabId}`);
    } else if (typeof identifier === 'string') {
      // Search by tab title or URL (case-insensitive partial match)
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const searchText = identifier.toLowerCase();

      Logger.info(`[executeChangeTabAction] Searching for tab matching: "${identifier}"`);
      Logger.debug(`[executeChangeTabAction] Available tabs:`, tabs.map(t => ({ title: t.title, url: t.url })));

      // Find tab that matches title or URL
      const matchedTab = tabs.find(tab => {
        const titleMatch = tab.title && tab.title.toLowerCase().includes(searchText);
        const urlMatch = tab.url && tab.url.toLowerCase().includes(searchText);
        return titleMatch || urlMatch;
      });

      if (!matchedTab) {
        // List available tabs for debugging
        const tabList = tabs.map((t, i) => `[${i}] ${t.title}`).join(', ');
        Logger.warn(`[executeChangeTabAction] No tab found matching "${identifier}". Available tabs: ${tabList}`);
        return {
          success: false,
          error: `No tab found matching "${identifier}". Available tabs: ${tabList}`
        };
      }

      targetTabId = matchedTab.id;
      matchedTabTitle = matchedTab.title;
      Logger.info(`[executeChangeTabAction] Found matching tab: "${matchedTab.title}" (ID: ${targetTabId})`);
    } else {
      return { success: false, error: `Invalid tab identifier: ${identifier}` };
    }

    // Activate the tab
    await chrome.tabs.update(targetTabId, { active: true });
    Logger.info(`[executeChangeTabAction] Successfully switched to tab ${targetTabId}`);

    return {
      success: true,
      message: matchedTabTitle
        ? `Switched to tab: ${matchedTabTitle}`
        : `Switched to tab ${identifier}`
    };

  } catch (error) {
    Logger.error('[executeChangeTabAction] Failed to change tab:', error);
    return {
      success: false,
      error: error.message || 'Failed to change tab'
    };
  }
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
            fillAndSubmit: (selector, value) => {
              // Debug: Log the selector value
              console.log('[fillAndSubmit] Received selector:', JSON.stringify(selector));
              console.log('[fillAndSubmit] Selector type:', typeof selector);
              console.log('[fillAndSubmit] Selector length:', selector ? selector.length : 'N/A');

              if (!selector || selector.trim() === '') {
                throw new Error(`The provided selector is empty. Selector value: "${selector}"`);
              }

              const element = document.querySelector(selector);
              if (!element) throw new Error(`Input element not found: ${selector}`);

              // Focus the element first (important for some sites)
              element.focus();
              console.log('[fillAndSubmit] Focused on input');

              // Clear any existing value
              element.value = '';

              // Try to get React's native input/textarea value setter
              let nativeInputValueSetter = null;
              try {
                // Check if it's a textarea or input and get the appropriate prototype
                const proto = element.tagName === 'TEXTAREA'
                  ? window.HTMLTextAreaElement.prototype
                  : window.HTMLInputElement.prototype;
                const valueDesc = Object.getOwnPropertyDescriptor(proto, 'value');
                if (valueDesc && valueDesc.set) {
                  nativeInputValueSetter = valueDesc.set;
                }
              } catch (e) {
                console.log('[fillAndSubmit] Could not get native setter:', e);
              }

              // Simulate typing character by character for better compatibility
              console.log('[fillAndSubmit] Typing value character by character:', value);
              for (let i = 0; i < value.length; i++) {
                const char = value[i];

                // Add the character using native setter if available (for React)
                if (nativeInputValueSetter) {
                  nativeInputValueSetter.call(element, element.value + char);
                } else {
                  element.value += char;
                }

                // Dispatch input event for each character
                const inputEvent = new InputEvent('input', {
                  bubbles: true,
                  cancelable: true,
                  data: char,
                  inputType: 'insertText'
                });
                element.dispatchEvent(inputEvent);

                // Also dispatch a React-specific event
                const reactEvent = new Event('input', { bubbles: true });
                Object.defineProperty(reactEvent, 'target', { writable: false, value: element });
                element.dispatchEvent(reactEvent);
              }

              console.log('[fillAndSubmit] Finished typing. Input value:', element.value);
              console.log('[fillAndSubmit] Input value visible check:', element.value === value);

              // Dispatch change event
              element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

              // Press Enter key to submit with full event sequence
              console.log('[fillAndSubmit] Pressing Enter to submit...');
              const enterEventDown = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true,
                composed: true,
                view: window
              });
              element.dispatchEvent(enterEventDown);

              const enterEventPress = new KeyboardEvent('keypress', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true,
                composed: true,
                view: window
              });
              element.dispatchEvent(enterEventPress);

              const enterEventUp = new KeyboardEvent('keyup', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true,
                composed: true,
                view: window
              });
              element.dispatchEvent(enterEventUp);

              // If it's inside a form, try to submit the form as well
              const form = element.closest('form');
              if (form) {
                console.log('[fillAndSubmit] Also trying form.submit()');
                try {
                  form.submit();
                } catch (e) {
                  console.log('[fillAndSubmit] form.submit() failed:', e.message);
                }
              }

              return { success: true, message: `Filled ${selector} with "${value}" and pressed Enter` };
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
            },
            drag: (sourceSelector, targetSelector) => {
              // Helper function to find element in main document or iframes
              const findElement = (selector) => {
                // Try main document first
                let element = document.querySelector(selector);
                if (element) return { element, doc: document };

                // Try all iframes
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of iframes) {
                  try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                    if (iframeDoc) {
                      element = iframeDoc.querySelector(selector);
                      if (element) return { element, doc: iframeDoc };
                    }
                  } catch (e) {
                    // Skip iframes we can't access due to cross-origin restrictions
                    continue;
                  }
                }
                return null;
              };

              const sourceResult = findElement(sourceSelector);
              const targetResult = findElement(targetSelector);

              if (!sourceResult) {
                // Debug: List available IDs
                const mainIds = Array.from(document.querySelectorAll('*')).filter(el => el.id).map(el => `#${el.id}`);
                throw new Error(`Source element not found: ${sourceSelector}. Available IDs in main document: ${mainIds.join(', ') || 'none'}. Try looking in iframes.`);
              }
              if (!targetResult) {
                const mainIds = Array.from(document.querySelectorAll('*')).filter(el => el.id).map(el => `#${el.id}`);
                throw new Error(`Target element not found: ${targetSelector}. Available IDs in main document: ${mainIds.join(', ') || 'none'}. Try looking in iframes.`);
              }

              const source = sourceResult.element;
              const target = targetResult.element;

              // Get positions for realistic event coordinates
              const sourceRect = source.getBoundingClientRect();
              const targetRect = target.getBoundingClientRect();

              const sourceCenterX = sourceRect.left + sourceRect.width / 2;
              const sourceCenterY = sourceRect.top + sourceRect.height / 2;
              const targetCenterX = targetRect.left + targetRect.width / 2;
              const targetCenterY = targetRect.top + targetRect.height / 2;

              // Create a DataTransfer object
              const dataTransfer = new DataTransfer();

              // 1. Fire dragstart event on source
              const dragStartEvent = new DragEvent('dragstart', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dataTransfer,
                clientX: sourceCenterX,
                clientY: sourceCenterY,
                screenX: sourceCenterX,
                screenY: sourceCenterY
              });
              source.dispatchEvent(dragStartEvent);

              // 2. Fire drag event on source
              const dragEvent = new DragEvent('drag', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dataTransfer,
                clientX: sourceCenterX,
                clientY: sourceCenterY
              });
              source.dispatchEvent(dragEvent);

              // 3. Fire dragenter event on target
              const dragEnterEvent = new DragEvent('dragenter', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dataTransfer,
                clientX: targetCenterX,
                clientY: targetCenterY,
                screenX: targetCenterX,
                screenY: targetCenterY
              });
              target.dispatchEvent(dragEnterEvent);

              // 4. Fire dragover event on target
              const dragOverEvent = new DragEvent('dragover', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dataTransfer,
                clientX: targetCenterX,
                clientY: targetCenterY,
                screenX: targetCenterX,
                screenY: targetCenterY
              });
              target.dispatchEvent(dragOverEvent);

              // 5. Fire drop event on target
              const dropEvent = new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dataTransfer,
                clientX: targetCenterX,
                clientY: targetCenterY,
                screenX: targetCenterX,
                screenY: targetCenterY
              });
              target.dispatchEvent(dropEvent);

              // 6. Fire dragend event on source
              const dragEndEvent = new DragEvent('dragend', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dataTransfer,
                clientX: targetCenterX,
                clientY: targetCenterY
              });
              source.dispatchEvent(dragEndEvent);

              return { success: true, message: `Dragged ${sourceSelector} to ${targetSelector}` };
            },
            uploadFile: (selector, filePath) => {
              console.log('[uploadFile] Received selector:', selector);
              console.log('[uploadFile] File path:', filePath);

              const fileInput = document.querySelector(selector);
              if (!fileInput) throw new Error(`File input not found: ${selector}`);
              if (fileInput.type !== 'file') throw new Error(`Element is not a file input: ${selector}`);

              // Note: For security reasons, we cannot programmatically set file input values
              // The browser prevents JavaScript from setting the value of file inputs
              // This action will trigger a click to open the file picker dialog
              console.log('[uploadFile] Triggering file input click to open file picker...');

              fileInput.focus();
              fileInput.click();

              return {
                success: true,
                message: `Opened file picker for ${selector}. Note: File selection must be done manually for security reasons.`,
                data: {
                  selector: selector,
                  requestedPath: filePath,
                  note: 'Browsers prevent programmatic file selection for security. User must select file manually.'
                }
              };
            },
            findSearchInput: (value) => {
              // Smart search input detection - tries multiple strategies
              const strategies = [
                // Strategy 1: Common search input patterns by role/type
                () => {
                  const searchInputs = document.querySelectorAll('input[type="search"], input[role="searchbox"], input[aria-label*="search" i], input[placeholder*="search" i]');
                  return searchInputs[0];
                },
                // Strategy 2: Textarea with search indicators (like Google)
                () => {
                  const textareas = document.querySelectorAll('textarea[name="q"], textarea[aria-label*="search" i], textarea[title*="search" i]');
                  return textareas[0];
                },
                // Strategy 3: Input by name (common patterns)
                () => {
                  const commonNames = ['q', 'query', 'search', 's', 'search-input', 'search_query', 'searchbox'];
                  for (const name of commonNames) {
                    const input = document.querySelector(`input[name="${name}"], textarea[name="${name}"]`);
                    if (input) return input;
                  }
                  return null;
                },
                // Strategy 4: Input by ID (common patterns)
                () => {
                  const commonIds = ['search', 'q', 'query', 'search-input', 'search-box', 'searchbox', 'search_input'];
                  for (const id of commonIds) {
                    const input = document.querySelector(`#${id}`);
                    if (input && (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA')) return input;
                  }
                  return null;
                },
                // Strategy 5: Look for visible input in search form
                () => {
                  const searchForms = document.querySelectorAll('form[role="search"], form[class*="search" i], form[id*="search" i]');
                  for (const form of searchForms) {
                    const input = form.querySelector('input:not([type="hidden"]), textarea');
                    if (input) return input;
                  }
                  return null;
                },
                // Strategy 6: First prominent input at top of page
                () => {
                  const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea'));
                  // Filter for visible inputs in top 30% of viewport
                  const topInputs = inputs.filter(input => {
                    const rect = input.getBoundingClientRect();
                    return rect.top < window.innerHeight * 0.3 && rect.width > 100;
                  });
                  return topInputs[0];
                }
              ];

              // Try each strategy in order
              for (const strategy of strategies) {
                try {
                  const input = strategy();
                  if (input) {
                    // Build selector for this input
                    let selector = '';
                    if (input.id) {
                      selector = `#${input.id}`;
                    } else if (input.name) {
                      selector = `${input.tagName.toLowerCase()}[name="${input.name}"]`;
                    } else if (input.type === 'search') {
                      selector = 'input[type="search"]';
                    } else if (input.getAttribute('role') === 'searchbox') {
                      selector = 'input[role="searchbox"]';
                    } else {
                      // Use aria-label or placeholder if available
                      const ariaLabel = input.getAttribute('aria-label');
                      if (ariaLabel) {
                        selector = `${input.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
                      } else {
                        selector = `${input.tagName.toLowerCase()}[placeholder="${input.placeholder}"]`;
                      }
                    }

                    console.log('[findSearchInput] Found input:', selector);
                    console.log('[findSearchInput] Filling with value:', value);

                    // If value is provided, fill and submit the input
                    if (value) {
                      console.log('[findSearchInput] Starting fill and submit process...');

                      // Focus the element
                      input.focus();
                      console.log('[findSearchInput] Focused on input');

                      // Clear any existing value first
                      input.value = '';

                      // Try to get React's native input/textarea value setter
                      let nativeInputValueSetter = null;
                      try {
                        // Check if it's a textarea or input and get the appropriate prototype
                        const proto = input.tagName === 'TEXTAREA'
                          ? window.HTMLTextAreaElement.prototype
                          : window.HTMLInputElement.prototype;
                        const valueDesc = Object.getOwnPropertyDescriptor(proto, 'value');
                        if (valueDesc && valueDesc.set) {
                          nativeInputValueSetter = valueDesc.set;
                        }
                      } catch (e) {
                        console.log('[findSearchInput] Could not get native setter:', e);
                      }

                      // Simulate typing character by character for better compatibility
                      console.log('[findSearchInput] Typing value character by character:', value);
                      for (let i = 0; i < value.length; i++) {
                        const char = value[i];

                        // Add the character using native setter if available (for React)
                        if (nativeInputValueSetter) {
                          nativeInputValueSetter.call(input, input.value + char);
                        } else {
                          input.value += char;
                        }

                        // Dispatch input event for each character (like real typing)
                        const inputEvent = new InputEvent('input', {
                          bubbles: true,
                          cancelable: true,
                          data: char,
                          inputType: 'insertText'
                        });
                        input.dispatchEvent(inputEvent);

                        // Also dispatch a React-specific event
                        const reactEvent = new Event('input', { bubbles: true });
                        Object.defineProperty(reactEvent, 'target', { writable: false, value: input });
                        input.dispatchEvent(reactEvent);
                      }

                      console.log('[findSearchInput] Finished typing. Input value:', input.value);
                      console.log('[findSearchInput] Input value visible check:', input.value === value);

                      // Dispatch change event after all typing is complete
                      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                      console.log('[findSearchInput] Dispatched final change event');

                      // Submit immediately (no delay needed - the retry mechanism will handle failures)
                      console.log('[findSearchInput] Attempting to submit...');

                      // Press Enter to submit (more reliable than clicking buttons)
                      console.log('[findSearchInput] Pressing Enter on input to submit...');

                      // Dispatch Enter key with full event sequence
                      const enterEventDown = new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        view: window
                      });
                      const downResult = input.dispatchEvent(enterEventDown);
                      console.log('[findSearchInput] keydown dispatched, not prevented:', downResult);

                      const enterEventPress = new KeyboardEvent('keypress', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        view: window
                      });
                      const pressResult = input.dispatchEvent(enterEventPress);
                      console.log('[findSearchInput] keypress dispatched, not prevented:', pressResult);

                      const enterEventUp = new KeyboardEvent('keyup', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        view: window
                      });
                      const upResult = input.dispatchEvent(enterEventUp);
                      console.log('[findSearchInput] keyup dispatched, not prevented:', upResult);

                      // Also try clicking submit button as backup
                      const form = input.closest('form');
                      if (form) {
                        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button[aria-label*="search" i], button[title*="search" i]');
                        if (submitBtn) {
                          console.log('[findSearchInput] Also trying to click submit button as backup');

                          // Try mousedown + mouseup + click sequence
                          submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                          submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                          submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                          submitBtn.click();
                        }

                        // Try form submit as last resort
                        console.log('[findSearchInput] Also trying form.submit() as last resort');
                        try {
                          form.submit();
                        } catch (e) {
                          console.log('[findSearchInput] form.submit() failed:', e.message);
                        }
                      }

                      return {
                        success: true,
                        message: `Found search input ${selector}, filled with "${value}" and submitted`
                      };
                    }

                    // If no value provided, just return the selector info
                    return {
                      success: true,
                      message: `Found search input: ${selector}`,
                      data: {
                        selector: selector || '',
                        tagName: input.tagName || '',
                        type: input.type || '',
                        id: input.id || '',
                        name: input.name || '',
                        placeholder: input.placeholder || '',
                        ariaLabel: input.getAttribute('aria-label') || ''
                      }
                    };
                  }
                } catch (e) {
                  continue;
                }
              }

              throw new Error('No search input found on page. Available inputs: ' +
                Array.from(document.querySelectorAll('input, textarea'))
                  .slice(0, 5)
                  .map(i => `${i.tagName}${i.id ? '#' + i.id : ''}${i.name ? '[name="' + i.name + '"]' : ''}`)
                  .join(', '));
            },
            showFireworks: (duration = 2000) => {
              console.log('[showFireworks] Starting fireworks animation!');

              // Start the animation asynchronously - return immediately
              setTimeout(() => {
                console.log('[showFireworks] Creating animation elements...');

                // Create fireworks container
                const container = document.createElement('div');
                container.id = 'browsemate-fireworks-container';
                container.style.cssText = `
                  position: fixed;
                  top: 0;
                  left: 0;
                  width: 100vw;
                  height: 100vh;
                  pointer-events: none;
                  z-index: 999999;
                  overflow: hidden;
                `;
                document.body.appendChild(container);

                // Firework particle class
                class Particle {
                  constructor(x, y, hue) {
                    this.x = x;
                    this.y = y;
                    this.hue = hue;
                    this.brightness = Math.random() * 30 + 50;
                    this.alpha = 1;
                    this.decay = Math.random() * 0.015 + 0.015;
                    this.velocity = {
                      x: (Math.random() - 0.5) * 8,
                      y: (Math.random() - 0.5) * 8
                    };
                    this.gravity = 0.1;
                  }

                  update() {
                    this.velocity.y += this.gravity;
                    this.x += this.velocity.x;
                    this.y += this.velocity.y;
                    this.alpha -= this.decay;
                  }
                }

                // Balloon class
                class Balloon {
                  constructor() {
                    this.x = Math.random() * window.innerWidth;
                    this.y = window.innerHeight + 50;
                    this.size = 30 + Math.random() * 30;
                    this.color = `hsl(${Math.random() * 360}, 70%, 60%)`;
                    this.speed = 1 + Math.random() * 2;
                    this.sway = Math.random() * Math.PI * 2;
                    this.swaySpeed = 0.02 + Math.random() * 0.02;
                  }

                  update() {
                    this.y -= this.speed;
                    this.sway += this.swaySpeed;
                    this.x += Math.sin(this.sway) * 0.5;
                  }

                  isOffScreen() {
                    return this.y < -100;
                  }
                }

                // Create canvas for drawing
                const canvas = document.createElement('canvas');
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
                canvas.style.cssText = 'position: absolute; top: 0; left: 0; background: rgba(0, 0, 0, 0.3);';
                container.appendChild(canvas);

                const ctx = canvas.getContext('2d');
                let particles = [];
                let balloons = [];
                let animationId;

                // Clear canvas with transparent background initially
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // Create a firework burst
                function createFirework(x, y) {
                  const hue = Math.random() * 360;
                  const particleCount = 50 + Math.random() * 50;
                  for (let i = 0; i < particleCount; i++) {
                    particles.push(new Particle(x, y, hue));
                  }
                }

                // Draw a balloon
                function drawBalloon(balloon) {
                  const x = balloon.x;
                  const y = balloon.y;
                  const size = balloon.size;

                  // Draw balloon body
                  ctx.fillStyle = balloon.color;
                  ctx.beginPath();
                  ctx.ellipse(x, y, size * 0.7, size, 0, 0, Math.PI * 2);
                  ctx.fill();

                  // Draw balloon highlight
                  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                  ctx.beginPath();
                  ctx.ellipse(x - size * 0.2, y - size * 0.3, size * 0.25, size * 0.35, -0.3, 0, Math.PI * 2);
                  ctx.fill();

                  // Draw balloon knot
                  ctx.fillStyle = balloon.color;
                  ctx.filter = 'brightness(0.8)';
                  ctx.beginPath();
                  ctx.ellipse(x, y + size, size * 0.15, size * 0.2, 0, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.filter = 'none';

                  // Draw string
                  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  ctx.moveTo(x, y + size + size * 0.2);
                  for (let i = 0; i < 5; i++) {
                    const stringY = y + size + size * 0.2 + (i * 15);
                    const stringX = x + Math.sin(balloon.sway + i * 0.5) * 3;
                    ctx.lineTo(stringX, stringY);
                  }
                  ctx.stroke();
                }

                // Animation loop
                function animate() {
                  // Clear canvas for each frame (no fade effect)
                  ctx.clearRect(0, 0, canvas.width, canvas.height);

                  // Update and draw balloons
                  balloons = balloons.filter(balloon => {
                    balloon.update();
                    if (balloon.isOffScreen()) return false;
                    drawBalloon(balloon);
                    return true;
                  });

                  // Update and draw particles
                  particles = particles.filter(particle => {
                    particle.update();

                    if (particle.alpha <= 0) return false;

                    ctx.beginPath();
                    ctx.arc(particle.x, particle.y, 3, 0, Math.PI * 2);
                    ctx.fillStyle = `hsla(${particle.hue}, 100%, ${particle.brightness}%, ${particle.alpha})`;
                    ctx.fill();

                    return true;
                  });

                  animationId = requestAnimationFrame(animate);
                }

                // Create balloons periodically
                const balloonInterval = setInterval(() => {
                  if (balloons.length < 50) {
                    balloons.push(new Balloon());
                  }
                }, 150);

                // Launch fireworks at random intervals
                let launchCount = 0;
                const maxLaunches = Math.floor(duration / 300); // Launch every ~300ms

                const launchInterval = setInterval(() => {
                  if (launchCount >= maxLaunches) {
                    clearInterval(launchInterval);
                    return;
                  }

                  // Random position in upper 2/3 of screen
                  const x = Math.random() * canvas.width;
                  const y = Math.random() * (canvas.height * 0.6);
                  createFirework(x, y);
                  launchCount++;
                }, 300);

                // Start animation
                animate();
                console.log('[showFireworks] Animation started!');

                // Clean up after duration
                setTimeout(() => {
                  clearInterval(launchInterval);
                  clearInterval(balloonInterval);
                  cancelAnimationFrame(animationId);

                  // Fade out and remove
                  setTimeout(() => {
                    container.remove();
                    console.log('[showFireworks] Animation cleaned up!');
                  }, 1000);
                }, duration);
              }, 0);

              // Return immediately so the script doesn't block
              return {
                success: true,
                message: `Fireworks display started for ${duration}ms!`
              };
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

  // Log to console for easier debugging
  console.log('=== EXECUTE ACTION ===');
  console.log('Action name:', action.name);
  console.log('Action params:', JSON.stringify(action.params));
  console.log('Is MCP tool?', mcpClient.isMCPTool(action.name));
  console.log('======================');

  // Check if this is an MCP tool call (prefixed with mcp_)
  if (mcpClient.isMCPTool(action.name)) {
    // Route to MCP client for execution
    Logger.info('[executeAction] Detected MCP tool call, routing to MCP client');
    Logger.info(`[executeAction] MCP tool name: ${action.name}`);
    Logger.debug('[executeAction] MCP tool params:', JSON.stringify(action.params));

    try {
      // Execute the MCP tool via the MCP client
      const mcpResult = await mcpClient.executeMCPTool(action.name, action.params);
      Logger.info('[executeAction] MCP tool execution result:', mcpResult);

      // Return the result in the expected format
      return {
        success: mcpResult.success,
        message: mcpResult.message || (mcpResult.success ? 'MCP tool executed successfully' : 'MCP tool execution failed'),
        result: mcpResult.result,
        error: mcpResult.error
      };
    } catch (mcpError) {
      // Log and return MCP execution error
      Logger.error('[executeAction] MCP tool execution failed:', mcpError);
      return {
        success: false,
        message: `MCP tool execution failed: ${mcpError.message}`
      };
    }
  }
  
  // Extract parameters from action.params as an array for WebActions
  const paramValues = Object.values(action.params);

  Logger.info('[executeAction] Preparing to execute WebAction...');
  Logger.debug('[executeAction] Action name:', action.name);
  Logger.debug('[executeAction] Action params object:', JSON.stringify(action.params));
  Logger.debug('[executeAction] Param values:', paramValues);
  Logger.debug('[executeAction] Param values stringified:', JSON.stringify(paramValues));

  try {
    // Special handling for chrome API actions that can't run in page context
    if (action.name === 'changeTab') {
      Logger.info('[executeAction] Executing chrome.tabs action: changeTab');
      return await executeChangeTabAction(paramValues[0]);
    }

    // Special handling for navigate - use chrome.tabs.update instead of script injection
    // This allows navigation from protected pages (chrome://, chrome-extension://, etc.)
    if (action.name === 'navigate') {
      Logger.info('[executeAction] Executing chrome.tabs action: navigate');
      const url = paramValues[0];

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          return { success: false, message: 'No active tab found' };
        }

        Logger.info(`[executeAction] Navigating tab ${tab.id} to: ${url}`);
        await chrome.tabs.update(tab.id, { url: url });

        return {
          success: true,
          message: `Navigating to ${url}`
        };
      } catch (error) {
        Logger.error('[executeAction] Navigation failed:', error);
        return {
          success: false,
          message: `Navigation failed: ${error.message}`
        };
      }
    }


    // Special handling for translatePage - needs to run in extension context to communicate with background
    if (action.name === 'translatePage') {
      Logger.info('[executeAction] Executing translatePage action from extension context');
      const targetLanguage = paramValues[0];

      // Get the active tab ID
      Logger.info('[executeAction] Getting active tab...');
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      Logger.info('[executeAction] Active tab:', activeTab);

      if (!activeTab) {
        throw new Error('No active tab found');
      }

      Logger.info('[executeAction] Sending message to background script...');
      Logger.info('[executeAction] Message:', { type: 'TRANSLATE_PAGE', targetLanguage, tabId: activeTab.id });

      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'TRANSLATE_PAGE',
          targetLanguage: targetLanguage,
          tabId: activeTab.id  // Include tab ID in the message
        }, (response) => {
          Logger.info('[executeAction] Received response from background:', response);
          if (chrome.runtime.lastError) {
            Logger.error('[executeAction] translatePage error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response) {
            Logger.error('[executeAction] No response from background script');
            reject(new Error('No response from background script'));
            return;
          }

          if (response.success) {
            Logger.info('[executeAction] translatePage successful');
            resolve({
              success: true,
              message: response.message || `Page translated to ${targetLanguage}`
            });
          } else {
            Logger.error('[executeAction] translatePage failed:', response.error);
            reject(new Error(response.error || 'Translation failed'));
          }
        });
      });
    }

    if (action.name === 'zoom') {
      Logger.info('[executeAction] Executing chrome.tabs action: zoom');
      return await executeZoomAction(paramValues[0]);
    }

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
      // NOTE: findSearchInput is NOT in this list because it submits the search, which should cause a page change
      // translatePage is included because the translation happens asynchronously in background script
      // and the success/failure is determined by the background script response, not DOM changes
      // showFireworks is included because it only adds a visual overlay without modifying page HTML
      const noChangeExpected = ['scroll', 'hover', 'navigate', 'reload', 'goBack', 'goForward', 'openNewTab', 'focus', 'pressKey', 'fill', 'clear', 'getText', 'getValue', 'translatePage', 'showFireworks'];

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

