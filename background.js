// Make the extension action (toolbar icon) open the side panel in one click.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// Messages:
// - "open-sidepanel" from content.js → opens the side panel.
// - { type: "chat-message-sent" } from sidebar → alerts the page's HTML.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message === "open-sidepanel") {
    if (sender.tab && sender.tab.windowId !== undefined) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
    }
    return;
  }

  if (message && message.type === "chat-message-sent") {
    const senderTabId = sender.tab && sender.tab.id;

    const runAlert = (tabId) => {
      if (tabId === undefined) return;
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          alert(document.documentElement.outerHTML);
        }
      });
    };

    if (senderTabId !== undefined) {
      runAlert(senderTabId);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const [activeTab] = tabs;
        if (!activeTab || activeTab.id === undefined) return;
        runAlert(activeTab.id);
      });
    }
  }
});

