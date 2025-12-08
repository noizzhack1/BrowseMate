// content.js - injected into pages
// Currently only used for lightweight page init hooks.

(function () {
  if (window.__browseMateChatButtonInjected) return;
  window.__browseMateChatButtonInjected = true;

  // Simple hook so you can confirm the content script is running, without UI.
  console.log("[BrowseMate] content script loaded");
})();

