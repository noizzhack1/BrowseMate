/**
 * ===========================================
 * File: retry.js
 * Purpose: Retry logic for action execution with blocker detection
 * Wraps execution with configurable retry attempts and auto-dismisses popups/banners
 * Dependencies: logger.js
 * ===========================================
 */

// Import logger for tracking retry attempts
import { Logger } from '../utils/logger.js';

// Default maximum retry attempts before giving up
const MAX_ATTEMPTS = 3;

// Delay between retry attempts (ms)
const RETRY_DELAY_MS = 1000;

/**
 * Execute blocker dismissal in page context via chrome.scripting
 * This function is injected into the page, so it needs to be self-contained
 */
async function dismissBlockersInPage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        // Self-contained blocker detection and dismissal
        // All dependencies are defined inline since this runs in page context

        console.log('[retry] Checking for blockers...');

        const patterns = {
          cookieBanners: {
            containerSelectors: [
              '[class*="cookie" i][class*="banner" i]',
              '[id*="cookie" i][id*="banner" i]',
              '[class*="cookie" i][class*="consent" i]',
              '[id*="cookie" i][id*="consent" i]',
              '[class*="gdpr" i]',
              '[id*="gdpr" i]',
              '[aria-label*="cookie" i]',
              '[role="dialog"][aria-label*="cookie" i]',
              '[role="dialog"][aria-label*="consent" i]',
              '.cookie-notice',
              '.cookie-consent',
              '.cookie-banner',
              '#cookie-banner',
              '#cookie-notice'
            ],
            dismissButtonTexts: [
              'accept', 'accept all', 'accept all cookies', 'agree', 'agree and close',
              'allow', 'allow all', 'allow cookies', 'ok', 'got it', 'i agree',
              'i understand', 'continue', 'close', 'dismiss'
            ]
          },
          signupPopups: {
            containerSelectors: [
              '[class*="newsletter" i][class*="popup" i]',
              '[class*="signup" i][class*="modal" i]',
              '[id*="newsletter" i][id*="popup" i]',
              '[aria-label*="newsletter" i][role="dialog"]',
              '[aria-label*="subscribe" i][role="dialog"]'
            ],
            dismissButtonTexts: ['no thanks', 'not now', 'maybe later', 'skip', 'close', 'dismiss']
          },
          modals: {
            containerSelectors: [
              '[role="dialog"]',
              '[role="alertdialog"]',
              '[aria-modal="true"]',
              '.modal[style*="display: block"]',
              '.modal.show',
              '[class*="modal"][class*="open" i]'
            ],
            dismissSelectors: [
              'button[aria-label*="close" i]',
              'button[title*="close" i]',
              '[class*="close" i][class*="button" i]',
              '[class*="modal" i] button[class*="close" i]',
              '[aria-label*="dismiss" i]'
            ]
          }
        };

        // Helper: check if element is visible
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };

        // Helper: find and click dismiss button
        const findAndClick = (container, texts) => {
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const buttons = container.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');

          for (const text of texts) {
            const target = norm(text);
            for (const btn of buttons) {
              const btnText = norm(btn.textContent);
              const aria = norm(btn.getAttribute('aria-label'));
              const title = norm(btn.getAttribute('title'));

              if (btnText === target || aria === target || title === target ||
                  btnText.includes(target) || aria.includes(target) || title.includes(target)) {
                console.log(`[retry] Found dismiss button: "${text}"`);
                btn.click();
                return true;
              }
            }
          }
          return false;
        };

        try {
          // Check cookie banners
          for (const sel of patterns.cookieBanners.containerSelectors) {
            const container = document.querySelector(sel);
            if (container && isVisible(container)) {
              console.log(`[retry] Found cookie banner: ${sel}`);
              if (findAndClick(container, patterns.cookieBanners.dismissButtonTexts)) {
                console.log('[retry] Dismissed cookie banner');
                return true;
              }
            }
          }

          // Check signup popups
          for (const sel of patterns.signupPopups.containerSelectors) {
            const container = document.querySelector(sel);
            if (container && isVisible(container)) {
              console.log(`[retry] Found signup popup: ${sel}`);
              if (findAndClick(container, patterns.signupPopups.dismissButtonTexts)) {
                console.log('[retry] Dismissed signup popup');
                return true;
              }
            }
          }

          // Check modals
          for (const sel of patterns.modals.containerSelectors) {
            const container = document.querySelector(sel);
            if (container && isVisible(container)) {
              console.log(`[retry] Found modal: ${sel}`);

              // Try dismiss button selectors
              for (const dismissSel of patterns.modals.dismissSelectors) {
                const btn = container.querySelector(dismissSel);
                if (btn) {
                  console.log(`[retry] Clicking dismiss: ${dismissSel}`);
                  btn.click();
                  return true;
                }
              }

              // Try Escape key
              console.log('[retry] Trying Escape key');
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
              return true;
            }
          }

          console.log('[retry] No blockers detected');
          return false;
        } catch (error) {
          console.error('[retry] Error dismissing blockers:', error);
          return false;
        }
      }
    });

    return results && results[0] && results[0].result;
  } catch (error) {
    Logger.error('[retry] Failed to execute blocker dismissal:', error);
    return false;
  }
}

/**
 * Execute a function with retry logic
 * Keeps trying until success or max attempts reached
 * @param {Function} executeFn - Async function to execute, receives attempt number, should return {success: boolean, message: string}
 * @param {number} maxAttempts - Maximum number of attempts (default: 3)
 * @returns {Promise<{success: boolean, message: string, attempts: number}>} - Result with attempt count
 */
async function executeWithRetry(executeFn, maxAttempts = MAX_ATTEMPTS) {
  // Array to track all error messages for final report
  const errors = [];

  // Attempt execution up to maxAttempts times
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Log current attempt number
    Logger.info(`Execution attempt ${attempt}/${maxAttempts}`);

    try {
      // Call the execution function with current attempt number
      // This allows executeFn to adjust strategy on retries
      const result = await executeFn(attempt);

      // If execution was successful, return immediately with success
      if (result.success) {
        // Log success message
        Logger.info(`Action succeeded on attempt ${attempt}`);
        // Return result with attempt count added
        return { ...result, attempts: attempt };
      }

      // If not successful, log the failure and store error message
      Logger.warn(`Attempt ${attempt} failed: ${result.message}`);
      // Add error to array for final report
      errors.push(`Attempt ${attempt}: ${result.message}`);

      // Check if this is a "not found" error that might be caused by blockers
      const isNotFoundError = result.message && (
        result.message.includes('not found') ||
        result.message.includes('Element not found') ||
        result.message.includes('Button not found') ||
        result.message.includes('Link not found')
      );

      // Check if this is a non-retryable error (page errors, no active tab)
      const isNonRetryable = result.message && (
        result.message.includes('error page') ||
        result.message.includes('No active tab')
      );

      if (isNonRetryable) {
        Logger.info('Non-retryable error - skipping retry attempts');
        break;
      }

      // If "not found" error and we have retries left, try to dismiss blockers
      if (isNotFoundError && attempt < maxAttempts) {
        Logger.info('[retry] Element not found - checking for blockers before retry');

        try {
          // Get active tab ID
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.id) {
            // Try to dismiss blockers
            const blockerDismissed = await dismissBlockersInPage(tab.id);

            if (blockerDismissed) {
              Logger.info('[retry] Blocker dismissed - will retry action');
              // Wait a bit for page to settle after dismissal
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            } else {
              // No blocker found, wait before retry anyway (element might be loading)
              Logger.info('[retry] No blocker found - waiting before retry');
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            }
          }
        } catch (dismissError) {
          Logger.warn('[retry] Error during blocker dismissal:', dismissError);
          // Continue with retry anyway
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      } else if (attempt < maxAttempts) {
        // Wait before next retry
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }

    } catch (error) {
      // Handle unexpected errors (exceptions thrown by executeFn)
      Logger.error(`Attempt ${attempt} threw error:`, error);
      // Add error message to array
      errors.push(`Attempt ${attempt}: ${error.message}`);

      // Check for non-retryable errors
      if (error.message && (
        error.message.includes('error page') ||
        error.message.includes('No active tab')
      )) {
        Logger.info('Non-retryable error - skipping retry attempts');
        break;
      }

      // Wait before retry
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  
  // All attempts failed - log final failure
  const actualAttempts = errors.length;
  Logger.error(`All ${actualAttempts} attempts failed`);

  // Return failure result with all accumulated error messages
  return {
    // Mark as failed
    success: false,
    // Combine all error messages into final message
    // If only one attempt, show simpler message
    message: actualAttempts === 1
      ? errors[0].replace(/^Attempt \d+: /, '')
      : `Failed after ${actualAttempts} attempts:\n${errors.join('\n')}`,
    // Include actual attempt count
    attempts: actualAttempts
  };
}

// Export for ES6 modules
export { executeWithRetry, MAX_ATTEMPTS };

