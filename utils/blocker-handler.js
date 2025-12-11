/**
 * ===========================================
 * File: blocker-handler.js
 * Purpose: Detect and auto-dismiss popups, cookie banners, and overlays
 * Dependencies: logger.js
 * ===========================================
 */

import { Logger } from './logger.js';

/**
 * Common patterns for popup/blocker detection and dismissal
 */
const BLOCKER_PATTERNS = {
  // Cookie consent banners
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
      // Common cookie banner class names
      '.cookie-notice',
      '.cookie-consent',
      '.cookie-banner',
      '#cookie-banner',
      '#cookie-notice'
    ],
    dismissButtonTexts: [
      'accept',
      'accept all',
      'accept all cookies',
      'agree',
      'agree and close',
      'allow',
      'allow all',
      'allow cookies',
      'ok',
      'got it',
      'i agree',
      'i understand',
      'continue',
      'close',
      'dismiss'
    ]
  },

  // Modal dialogs
  modals: {
    containerSelectors: [
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[aria-modal="true"]',
      '.modal[style*="display: block"]',
      '.modal.show',
      '[class*="modal"][class*="open" i]',
      '[id*="modal"][style*="display: block"]'
    ],
    dismissSelectors: [
      'button[aria-label*="close" i]',
      'button[title*="close" i]',
      '[class*="close" i][class*="button" i]',
      '[class*="modal" i] button[class*="close" i]',
      '[aria-label*="dismiss" i]'
    ]
  },

  // Overlays that block interaction
  overlays: {
    containerSelectors: [
      '[class*="overlay" i][style*="display: block"]',
      '[class*="overlay" i][style*="visible"]',
      '[id*="overlay" i][style*="display: block"]',
      '[class*="backdrop" i][style*="display: block"]',
      'div[style*="position: fixed"][style*="z-index"]'
    ]
  },

  // Newsletter/signup popups
  signupPopups: {
    containerSelectors: [
      '[class*="newsletter" i][class*="popup" i]',
      '[class*="signup" i][class*="modal" i]',
      '[id*="newsletter" i][id*="popup" i]',
      '[aria-label*="newsletter" i][role="dialog"]',
      '[aria-label*="subscribe" i][role="dialog"]'
    ],
    dismissButtonTexts: [
      'no thanks',
      'not now',
      'maybe later',
      'skip',
      'close',
      'dismiss'
    ],
    dismissSelectors: [
      'button[aria-label*="close" i]',
      'button[aria-label*="dismiss" i]',
      'button[aria-label*="no thanks" i]'
    ]
  }
};

/**
 * Check if an element is visible and blocking interactions
 */
function isBlockingElement(element) {
  if (!element) return false;

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  // Check if element is displayed and has size
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (rect.width === 0 || rect.height === 0) return false;

  // Check if element has high z-index (likely overlay)
  const zIndex = parseInt(style.zIndex, 10);
  if (zIndex > 100) return true;

  // Check if element covers significant viewport area
  const viewportArea = window.innerWidth * window.innerHeight;
  const elementArea = rect.width * rect.height;
  if (elementArea > viewportArea * 0.3) return true; // Covers >30% of viewport

  return true;
}

/**
 * Try to find and click a dismiss button by text content
 */
function findAndClickDismissButton(container, buttonTexts) {
  const normalize = (str) => (str || '').replace(/\s+/g, ' ').trim().toLowerCase();

  // Find all buttons, links, and clickable elements within the container
  const candidates = container.querySelectorAll(
    'button, a, [role="button"], input[type="button"], input[type="submit"]'
  );

  for (const buttonText of buttonTexts) {
    const target = normalize(buttonText);

    for (const candidate of candidates) {
      const text = normalize(candidate.textContent);
      const aria = normalize(candidate.getAttribute('aria-label'));
      const title = normalize(candidate.getAttribute('title'));
      const value = normalize(candidate.value);

      if (text === target || aria === target || title === target || value === target ||
          text.includes(target) || aria.includes(target) || title.includes(target)) {
        Logger.info(`[blocker-handler] Found dismiss button with text: "${buttonText}"`);
        candidate.click();
        return true;
      }
    }
  }

  return false;
}

/**
 * Detect and dismiss blockers on the page
 * @returns {Promise<{dismissed: boolean, blocker: string|null}>}
 */
export async function detectAndDismissBlockers() {
  Logger.info('[blocker-handler] Checking for blockers...');

  try {
    // Check for cookie banners
    for (const selector of BLOCKER_PATTERNS.cookieBanners.containerSelectors) {
      const container = document.querySelector(selector);
      if (container && isBlockingElement(container)) {
        Logger.info(`[blocker-handler] Found cookie banner: ${selector}`);

        if (findAndClickDismissButton(container, BLOCKER_PATTERNS.cookieBanners.dismissButtonTexts)) {
          Logger.info('[blocker-handler] Dismissed cookie banner');
          return { dismissed: true, blocker: 'cookie-banner' };
        }
      }
    }

    // Check for signup/newsletter popups
    for (const selector of BLOCKER_PATTERNS.signupPopups.containerSelectors) {
      const container = document.querySelector(selector);
      if (container && isBlockingElement(container)) {
        Logger.info(`[blocker-handler] Found signup popup: ${selector}`);

        // Try dismiss button texts first
        if (findAndClickDismissButton(container, BLOCKER_PATTERNS.signupPopups.dismissButtonTexts)) {
          Logger.info('[blocker-handler] Dismissed signup popup via button text');
          return { dismissed: true, blocker: 'signup-popup' };
        }

        // Try dismiss button selectors
        for (const dismissSelector of BLOCKER_PATTERNS.signupPopups.dismissSelectors) {
          const dismissBtn = container.querySelector(dismissSelector);
          if (dismissBtn) {
            Logger.info(`[blocker-handler] Found dismiss button: ${dismissSelector}`);
            dismissBtn.click();
            return { dismissed: true, blocker: 'signup-popup' };
          }
        }
      }
    }

    // Check for generic modals
    for (const selector of BLOCKER_PATTERNS.modals.containerSelectors) {
      const container = document.querySelector(selector);
      if (container && isBlockingElement(container)) {
        Logger.info(`[blocker-handler] Found modal dialog: ${selector}`);

        // Try dismiss button selectors
        for (const dismissSelector of BLOCKER_PATTERNS.modals.dismissSelectors) {
          const dismissBtn = container.querySelector(dismissSelector);
          if (dismissBtn) {
            Logger.info(`[blocker-handler] Found dismiss button: ${dismissSelector}`);
            dismissBtn.click();
            return { dismissed: true, blocker: 'modal-dialog' };
          }
        }

        // Try Escape key
        Logger.info('[blocker-handler] Trying Escape key to dismiss modal');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true }));
        return { dismissed: true, blocker: 'modal-dialog' };
      }
    }

    // Check for blocking overlays
    for (const selector of BLOCKER_PATTERNS.overlays.containerSelectors) {
      const overlay = document.querySelector(selector);
      if (overlay && isBlockingElement(overlay)) {
        Logger.info(`[blocker-handler] Found blocking overlay: ${selector}`);

        // Try to hide or remove the overlay
        overlay.style.display = 'none';
        Logger.info('[blocker-handler] Hidden blocking overlay');
        return { dismissed: true, blocker: 'overlay' };
      }
    }

    Logger.info('[blocker-handler] No blockers detected');
    return { dismissed: false, blocker: null };

  } catch (error) {
    Logger.error('[blocker-handler] Error detecting/dismissing blockers:', error);
    return { dismissed: false, blocker: null };
  }
}

/**
 * Wait for an element to appear with polling
 * @param {string} selector - CSS selector to wait for
 * @param {number} timeout - Maximum time to wait in ms
 * @param {number} interval - Polling interval in ms
 * @returns {Promise<Element|null>}
 */
export async function waitForElement(selector, timeout = 5000, interval = 100) {
  Logger.info(`[blocker-handler] Waiting for element: ${selector}`);

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector);
    if (element) {
      Logger.info(`[blocker-handler] Element found: ${selector}`);
      return element;
    }

    await new Promise(resolve => setTimeout(resolve, interval));
  }

  Logger.warn(`[blocker-handler] Element not found after ${timeout}ms: ${selector}`);
  return null;
}