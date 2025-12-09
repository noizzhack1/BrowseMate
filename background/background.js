// Make the extension action (toolbar icon) open the side panel in one click.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// Messages:
// - "open-sidepanel" from content.js → opens the side panel.
// - { type: 'BROWSEMATE_CLOSE_SETTINGS' } → close Settings tab(s) and restore original tab.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message === "open-sidepanel") {
    if (sender.tab && sender.tab.windowId !== undefined) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
    }
    return;
  }

  if (message && message.type === 'BROWSEMATE_CLOSE_SETTINGS') {
    (async () => {
      try {
        const settingsUrl = chrome.runtime.getURL('settings/settings.html');
        const tabs = await chrome.tabs.query({ url: `${settingsUrl}*` });

        if (tabs && tabs.length > 0) {
          const idsToClose = tabs
            .map((t) => t.id)
            .filter((id) => typeof id === 'number');
          if (idsToClose.length > 0) {
            await chrome.tabs.remove(idsToClose);
          }
        }

        try {
          const stored = await chrome.storage.session.get('browsemate_last_active_tab');
          const targetId = stored.browsemate_last_active_tab;
          if (typeof targetId === 'number') {
            await chrome.tabs.update(targetId, { active: true });
          }
        } catch (restoreError) {
          console.warn('[background] Error restoring original tab focus after closing Settings:', restoreError);
        }
      } catch (error) {
        console.error('[background] Error handling BROWSEMATE_CLOSE_SETTINGS:', error);
      } finally {
        if (typeof sendResponse === 'function') {
          sendResponse();
        }
      }
    })();
    return true; // keep message channel open for async sendResponse
  }
});
