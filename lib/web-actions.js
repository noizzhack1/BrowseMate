/**
 * ===========================================
 * File: web-actions.js
 * Purpose: Defines all available web browser actions as executable functions
 * These actions replace eval() with safe, predefined browser automation primitives
 * ===========================================
 */

/**
 * WebActions class - provides safe, structured browser automation actions
 * Each action returns a function that can be executed in the page context
 */
export class WebActions {

  /**
   * Click an element
   * @param {string} selector - CSS selector for the element to click
   * @returns {Function} Function to execute in page context
   */
  static click(selector) {
    return function() {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
      element.click();
      return { success: true, message: `Clicked element: ${selector}` };
    };
  }

  /**
   * Fill an input field with text
   * @param {string} selector - CSS selector for the input element
   * @param {string} value - Value to enter
   * @returns {Function} Function to execute in page context
   */
  static fill(selector, value) {
    return function() {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Input element not found: ${selector}`);
      }

      // Set value and trigger events
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      return { success: true, message: `Filled ${selector} with: ${value}` };
    };
  }

  /**
   * Select an option from a dropdown
   * @param {string} selector - CSS selector for the select element
   * @param {string} value - Value or text of the option to select
   * @returns {Function} Function to execute in page context
   */
  static select(selector, value) {
    return function() {
      const element = document.querySelector(selector);
      if (!element || element.tagName !== 'SELECT') {
        throw new Error(`Select element not found: ${selector}`);
      }

      // Try to select by value first, then by text
      let found = false;
      for (const option of element.options) {
        if (option.value === value || option.text === value) {
          option.selected = true;
          found = true;
          break;
        }
      }

      if (!found) {
        throw new Error(`Option not found in select: ${value}`);
      }

      element.dispatchEvent(new Event('change', { bubbles: true }));

      return { success: true, message: `Selected ${value} in ${selector}` };
    };
  }

  /**
   * Check or uncheck a checkbox
   * @param {string} selector - CSS selector for the checkbox
   * @param {boolean} checked - Whether to check or uncheck
   * @returns {Function} Function to execute in page context
   */
  static check(selector, checked = true) {
    return function() {
      const element = document.querySelector(selector);
      if (!element || element.type !== 'checkbox') {
        throw new Error(`Checkbox not found: ${selector}`);
      }

      element.checked = checked;
      element.dispatchEvent(new Event('change', { bubbles: true }));

      return { success: true, message: `${checked ? 'Checked' : 'Unchecked'} ${selector}` };
    };
  }

  /**
   * Scroll to an element or by amount
   * @param {string|number} target - CSS selector or scroll amount in pixels
   * @param {string} direction - 'vertical' or 'horizontal' (for numeric scrolls)
   * @returns {Function} Function to execute in page context
   */
  static scroll(target, direction = 'vertical') {
    return function() {
      if (typeof target === 'string') {
        // Scroll to element
        const element = document.querySelector(target);
        if (!element) {
          throw new Error(`Element not found: ${target}`);
        }
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { success: true, message: `Scrolled to ${target}` };
      } else if (typeof target === 'number') {
        // Scroll by amount
        if (direction === 'horizontal') {
          window.scrollBy({ left: target, behavior: 'smooth' });
        } else {
          window.scrollBy({ top: target, behavior: 'smooth' });
        }
        return { success: true, message: `Scrolled ${direction} by ${target}px` };
      } else {
        throw new Error('Invalid scroll target');
      }
    };
  }

  /**
   * Hover over an element
   * @param {string} selector - CSS selector for the element
   * @returns {Function} Function to execute in page context
   */
  static hover(selector) {
    return function() {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      // Trigger mouse events
      element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

      return { success: true, message: `Hovered over ${selector}` };
    };
  }

  /**
   * Submit a form
   * @param {string} selector - CSS selector for the form
   * @returns {Function} Function to execute in page context
   */
  static submit(selector) {
    return function() {
      const element = document.querySelector(selector);
      if (!element || element.tagName !== 'FORM') {
        throw new Error(`Form not found: ${selector}`);
      }

      element.submit();
      return { success: true, message: `Submitted form: ${selector}` };
    };
  }

  /**
   * Navigate to a URL
   * @param {string} url - URL to navigate to
   * @returns {Function} Function to execute in page context
   */
  static navigate(url) {
    return function() {
      window.location.href = url;
      return { success: true, message: `Navigating to ${url}` };
    };
  }

  /**
   * Click a link by text content
   * @param {string} text - Text content of the link
   * @param {boolean} exact - Whether to match exact text or partial
   * @returns {Function} Function to execute in page context
   */
  static clickLink(text, exact = false) {
    return function() {
      const links = Array.from(document.querySelectorAll('a'));
      const link = links.find(a =>
        exact ? a.textContent.trim() === text : a.textContent.includes(text)
      );

      if (!link) {
        throw new Error(`Link not found with text: ${text}`);
      }

      link.click();
      return { success: true, message: `Clicked link: ${text}` };
    };
  }

  /**
   * Click a button by text content
   * @param {string} text - Text content of the button
   * @param {boolean} exact - Whether to match exact text or partial
   * @returns {Function} Function to execute in page context
   */
  static clickButton(text, exact = false) {
    return function() {
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

      if (!button) {
        throw new Error(`Button not found with text: ${text}`);
      }

      button.click();
      return { success: true, message: `Clicked button: ${text}` };
    };
  }

  /**
   * Wait for an element to appear
   * @param {string} selector - CSS selector for the element
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Function} Function to execute in page context
   */
  static waitForElement(selector, timeout = 5000) {
    return function() {
      return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const checkElement = () => {
          const element = document.querySelector(selector);
          if (element) {
            resolve({ success: true, message: `Element found: ${selector}` });
          } else if (Date.now() - startTime > timeout) {
            reject(new Error(`Timeout waiting for element: ${selector}`));
          } else {
            setTimeout(checkElement, 100);
          }
        };

        checkElement();
      });
    };
  }

  /**
   * Get text content from an element
   * @param {string} selector - CSS selector for the element
   * @returns {Function} Function to execute in page context
   */
  static getText(selector) {
    return function() {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      const text = element.textContent.trim();
      return { success: true, message: `Text: ${text}`, data: text };
    };
  }

  /**
   * Get value from an input element
   * @param {string} selector - CSS selector for the input
   * @returns {Function} Function to execute in page context
   */
  static getValue(selector) {
    return function() {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      const value = element.value;
      return { success: true, message: `Value: ${value}`, data: value };
    };
  }

  /**
   * Clear an input field
   * @param {string} selector - CSS selector for the input
   * @returns {Function} Function to execute in page context
   */
  static clear(selector) {
    return function() {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Input element not found: ${selector}`);
      }

      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      return { success: true, message: `Cleared ${selector}` };
    };
  }

  /**
   * Focus on an element
   * @param {string} selector - CSS selector for the element
   * @returns {Function} Function to execute in page context
   */
  static focus(selector) {
    return function() {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      element.focus();
      return { success: true, message: `Focused on ${selector}` };
    };
  }

  /**
   * Press a keyboard key
   * @param {string} key - Key to press (e.g., 'Enter', 'Escape', 'Tab')
   * @param {string} selector - Optional: CSS selector for element to press key on
   * @returns {Function} Function to execute in page context
   */
  static pressKey(key, selector = null) {
    return function() {
      const target = selector ? document.querySelector(selector) : document.activeElement;

      if (!target) {
        throw new Error(selector ? `Element not found: ${selector}` : 'No active element');
      }

      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keypress', { key, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));

      return { success: true, message: `Pressed key: ${key}` };
    };
  }

  /**
   * Open a new tab
   * @param {string} url - URL to open in new tab
   * @returns {Function} Function to execute in page context
   */
  static openNewTab(url) {
    return function() {
      window.open(url, '_blank');
      return { success: true, message: `Opened new tab: ${url}` };
    };
  }

  /**
   * Reload the page
   * @returns {Function} Function to execute in page context
   */
  static reload() {
    return function() {
      window.location.reload();
      return { success: true, message: 'Page reloaded' };
    };
  }

  /**
   * Go back in browser history
   * @returns {Function} Function to execute in page context
   */
  static goBack() {
    return function() {
      window.history.back();
      return { success: true, message: 'Navigated back' };
    };
  }

  /**
   * Go forward in browser history
   * @returns {Function} Function to execute in page context
   */
  static goForward() {
    return function() {
      window.history.forward();
      return { success: true, message: 'Navigated forward' };
    };
  }

  /**
   * Get all available action names
   * @returns {string[]} Array of action names
   */
  static getAvailableActions() {
    return [
      'click', 'fill', 'select', 'check', 'scroll', 'hover', 'submit',
      'navigate', 'clickLink', 'clickButton', 'waitForElement', 'getText',
      'getValue', 'clear', 'focus', 'pressKey', 'openNewTab', 'reload',
      'goBack', 'goForward'
    ];
  }

  /**
   * Execute an action by name with parameters
   * @param {string} actionName - Name of the action
   * @param {any[]} params - Parameters for the action
   * @returns {Function} Function to execute in page context
   */
  static executeAction(actionName, ...params) {
    if (!this[actionName] || typeof this[actionName] !== 'function') {
      throw new Error(`Unknown action: ${actionName}`);
    }

    return this[actionName](...params);
  }
}
