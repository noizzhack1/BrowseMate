// Make the extension action (toolbar icon) open the side panel in one click.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// Messages:
// - "open-sidepanel" from content.js → opens the side panel.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message === "open-sidepanel") {
    if (sender.tab && sender.tab.windowId !== undefined) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
    }
    return;
  }

  // Handle other messages here if needed in the future
});

