/**
 * UI utility functions
 * @module ui-utils
 */

/**
 * Update button classes based on responding state
 * @param {boolean} isResponding - Whether the assistant is currently responding
 * @param {HTMLElement} chatStopBtn - Stop button element
 * @param {HTMLElement} chatSendBtn - Send button element
 */
export function updateButtonClasses(isResponding, chatStopBtn, chatSendBtn) {
  const baseClasses = 'w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed';

  if (chatStopBtn) {
    const stopClasses = isResponding
      ? `${baseClasses} bg-red-500 hover:bg-red-600 text-white`
      : baseClasses;
    chatStopBtn.className = `primary-button chat-input__stop ${stopClasses}`;
  }

  if (chatSendBtn) {
    const sendClasses = !isResponding
      ? `${baseClasses} bg-blue-600 hover:bg-blue-700 text-white`
      : baseClasses;
    chatSendBtn.className = `primary-button chat-input__send ${sendClasses}`;
  }
}

/**
 * Auto-resize textarea to fit content
 * @param {HTMLTextAreaElement} textarea - Textarea element to resize
 * @param {number} [maxHeight=80] - Maximum height in pixels
 */
export function autoResizeTextArea(textarea, maxHeight = 80) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + "px";
}

/**
 * Toggle chat panel open/closed
 * @param {HTMLElement} sidebarRootEl - Sidebar root element
 * @param {HTMLElement} chatToggleBtn - Toggle button element
 */
export function toggleChatPanel(sidebarRootEl, chatToggleBtn) {
  if (!sidebarRootEl || !chatToggleBtn) return;
  const isCollapsed = sidebarRootEl.classList.toggle("sidebar-root--collapsed");

  chatToggleBtn.setAttribute("aria-pressed", String(!isCollapsed));
  chatToggleBtn.title = isCollapsed ? "Show chat" : "Hide chat";
}

/**
 * Toggle the Settings page as a separate tab.
 * If a Settings tab is already open, close it; otherwise open it.
 */
export async function toggleSettings() {
  const settingsUrl = chrome.runtime.getURL('settings/settings.html');
  try {
    // Look for any existing Settings tabs
    const tabs = await chrome.tabs.query({ url: `${settingsUrl}*` });

    if (tabs && tabs.length > 0) {
      // Delegate closing & focus restoration to the background script so that
      // both the Settings icon and the in-page Back link use identical logic.
      chrome.runtime.sendMessage({ type: 'BROWSEMATE_CLOSE_SETTINGS' });
      return;
    }

    // No existing Settings tab, remember the currently active tab then open Settings
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && typeof activeTab.id === 'number') {
        await chrome.storage.session.set({ browsemate_last_active_tab: activeTab.id });
      }
    } catch (activeErr) {
      console.warn('Error capturing last active tab before opening Settings:', activeErr);
    }

    // Pass the origin tab ID via query string so this particular Settings instance
    // always knows which tab to return focus to when "Back" is clicked.
    let urlWithOrigin = settingsUrl;
    try {
      const stored = await chrome.storage.session.get('browsemate_last_active_tab');
      if (typeof stored.browsemate_last_active_tab === 'number') {
        const originId = stored.browsemate_last_active_tab;
        const u = new URL(settingsUrl);
        u.searchParams.set('originTabId', String(originId));
        urlWithOrigin = u.toString();
      }
    } catch (err) {
      console.warn('Error attaching originTabId to settings URL:', err);
    }

    await chrome.tabs.create({ url: urlWithOrigin });
  } catch (error) {
    console.error('Error toggling settings:', error);
    // Fallback: try to open in current window
    try {
      window.open(settingsUrl, '_blank');
    } catch (_) {
      // ignore
    }
  }
}

/**
 * Handle Stop button click - cancel the current request
 * @param {AbortController} currentAbortController - Current abort controller
 * @param {boolean} isRequestInProgress - Whether a request is in progress
 */
export function handleStopClick(currentAbortController, isRequestInProgress) {
  if (currentAbortController && isRequestInProgress) {
    currentAbortController.abort();
    console.log('[handleStopClick] Request cancelled by user');
  }
}
