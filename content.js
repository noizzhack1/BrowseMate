// content.js - injected into pages
// Renders a floating "Chat" button that opens the extension's side panel.

(function () {
  if (window.__browseMateChatButtonInjected) return;
  window.__browseMateChatButtonInjected = true;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Chat";

  Object.assign(btn.style, {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    zIndex: "2147483647",
    padding: "8px 12px",
    borderRadius: "999px",
    border: "none",
    background: "#2563eb",
    color: "#ffffff",
    fontSize: "12px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.35)"
  });

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "#1d4ed8";
  });

  btn.addEventListener("mouseleave", () => {
    btn.style.background = "#2563eb";
  });

  btn.addEventListener("click", () => {
    chrome.runtime.sendMessage("open-sidepanel");
  });

  if (document.body) {
    document.body.appendChild(btn);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.body) document.body.appendChild(btn);
    });
  }
})();

