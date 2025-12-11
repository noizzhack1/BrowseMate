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
 * Execute a function with a single primary attempt and one optional alternate approach
 * If the primary attempt fails, we optionally try an alternate strategy once.
 * @param {Function} executeFn - Async function to execute, receives (attempt, context), should return {success: boolean, message: string}
 * @param {Object|number} options - Options object or legacy maxAttempts number (legacy value is ignored; kept for compatibility)
 * @param {Function} [options.alternateApproach] - Optional alternate approach function, receives (attempt, context)
 * @returns {Promise<{success: boolean, message: string, attempts: number}>} - Result with attempt count
 */
async function executeWithRetry(executeFn, options = {}) {
  const alternateApproach = typeof options === 'number'
    ? null
    : options?.alternateApproach;

  const errors = [];

  const runAttempt = async (runner, attempt, useAlternateApproach, previousErrors) => {
    return runner(attempt, {
      attempt,
      maxAttempts: 1,
      previousErrors: [...previousErrors],
      useAlternateApproach,
      isFinalAttempt: true
    });
  };

  // Primary attempt
  Logger.info('Execution attempt 1/1 (primary)');
  try {
    const result = await runAttempt(executeFn, 1, false, errors);
    if (result.success) {
      Logger.info('Action succeeded on attempt 1');
      return { ...result, attempts: 1 };
    }

    Logger.warn(`Attempt 1 failed: ${result.message}`);
    errors.push(`Attempt 1: ${result.message}`);

    const isNotFoundError = result.message && (
      result.message.includes('not found') ||
      result.message.includes('Element not found') ||
      result.message.includes('Button not found') ||
      result.message.includes('Link not found')
    );

    const isNonRetryable = result.message && (
      result.message.includes('error page') ||
      result.message.includes('No active tab')
    );

    // If non-retryable, bail immediately
    if (isNonRetryable) {
      Logger.info('Non-retryable error - not attempting alternate approach');
      return {
        success: false,
        message: errors[0].replace(/^Attempt \d+: /, ''),
        attempts: 1
      };
    }

    // If not found, try dismissing blockers before alternate approach
    if (isNotFoundError) {
      Logger.info('[retry] Element not found - checking for blockers before alternate approach');
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
          const blockerDismissed = await dismissBlockersInPage(tab.id);
          if (blockerDismissed) {
            Logger.info('[retry] Blocker dismissed - pausing before alternate approach');
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          }
        }
      } catch (dismissError) {
        Logger.warn('[retry] Error during blocker dismissal:', dismissError);
      }
    }

  } catch (error) {
    Logger.error('Attempt 1 threw error:', error);
    errors.push(`Attempt 1: ${error.message}`);
  }

  // Alternate approach attempt (only once)
  if (typeof alternateApproach === 'function') {
    Logger.info('[alternate] Execution attempt 2/2');
    try {
      const altResult = await runAttempt(alternateApproach, 2, true, errors);
      if (altResult.success) {
        Logger.info('Alternate approach succeeded on attempt 2');
        return { ...altResult, attempts: 2 };
      }

      Logger.warn(`Alternate approach failed: ${altResult.message}`);
      errors.push(`Attempt 2: ${altResult.message}`);
    } catch (altError) {
      Logger.error('Alternate approach threw error:', altError);
      errors.push(`Attempt 2: ${altError.message}`);
    }
  }

  // Final failure
  const attemptCount = errors.length || 1;
  Logger.error(`All ${attemptCount} attempts failed`);
  return {
    success: false,
    message: attemptCount === 1
      ? errors[0].replace(/^Attempt \d+: /, '')
      : `Failed after ${attemptCount} attempts:\n${errors.join('\n')}`,
    attempts: attemptCount
  };
}

// Export for ES6 modules
export { executeWithRetry, MAX_ATTEMPTS };
