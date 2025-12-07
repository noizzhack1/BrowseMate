// BrowseMate Chat - simple in-panel chat UI (no external API calls)

// =========================
// DOM references
// =========================

/** @type {HTMLDivElement | null} */
const chatMessagesEl = document.getElementById("chatMessages");
/** @type {HTMLFormElement | null} */
const chatFormEl = document.getElementById("chatForm");
/** @type {HTMLTextAreaElement | null} */
const chatInputEl = document.getElementById("chatInput");
/** @type {HTMLButtonElement | null} */
const chatToggleBtn = document.getElementById("chatToggle");
/** @type {HTMLButtonElement | null} */
const settingsBtn = document.getElementById("settingsBtn");
/** @type {HTMLInputElement | null} */
const includePageContextCheckbox = document.getElementById("includePageContext");
/** @type {HTMLDivElement | null} */
const sidebarRootEl = document.querySelector(".sidebar-root");

// =========================
// Page Context & Freeze helpers
// =========================

/**
 * Get the current page context (URL, title, visible text, and HTML structure)
 * @returns {Promise<{url: string, title: string, text: string, html: string}>}
 */
async function getPageContext() {
  // Query the active tab in the current window
  try {
    // Get reference to the currently active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Return empty context if no valid tab is found
    if (!tab || !tab.id) return { url: "", title: "", text: "", html: "" };

    // Execute script in the context of the active tab to extract page information
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Clone the body to extract text without modifying the actual DOM
        const clone = document.body.cloneNode(true);
        
        // Remove script, style, and noscript elements from the clone (not needed for text extraction)
        const scripts = clone.querySelectorAll("script, style, noscript");
        scripts.forEach((el) => el.remove());

        // Extract visible text content, normalize whitespace (no character limit)
        const text = clone.innerText.replace(/\s+/g, " ").trim();

        // Get the full HTML structure for action execution (selectors, element identification)
        const html = document.body.outerHTML;

        // Return comprehensive page context object
        return {
          url: window.location.href,   // Current page URL
          title: document.title,        // Page title
          text,                         // Visible text content (cleaned)
          html                          // Full HTML structure for Task B actions
        };
      }
    });

    // Return the result if valid, otherwise return empty context
    return results && results[0] && results[0].result
      ? results[0].result
      : { url: "", title: "", text: "", html: "" };
  } catch (error) {
    // Log error and return empty context on failure
    console.error("Error getting page context:", error);
    return { url: "", title: "", text: "", html: "" };
  }
}

/**
 * Freeze or unfreeze the current page with a blue border overlay,
 * using the same pattern as getPageContext (runs in the page context).
 * @param {boolean} freeze
 */
async function setPageFrozen(freeze) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (shouldFreeze) => {
        const OVERLAY_ID = "__browsemate_page_freeze_overlay";
        const STYLE_ID = "__browsemate_freeze_style";
        const body = document.body;
        if (!body) return;

        if (shouldFreeze) {
          if (document.getElementById(OVERLAY_ID)) return;

          // Inject Comet-style animated border CSS once
          if (!document.getElementById(STYLE_ID)) {
            const styleEl = document.createElement("style");
            styleEl.id = STYLE_ID;
            styleEl.textContent =
              ".commet-freeze-border{" +
              "position:relative;border-radius:12px;overflow:hidden;" +
              "}" +
              ".commet-freeze-border::after{" +
              'content:"";position:absolute;inset:0;border-radius:inherit;padding:2px;' +
              "background:linear-gradient(90deg,#6a5dfc,#b05bff,#ff5cf1,#ff6b8d,#ffb85c,#6a5dfc) 0 0/300% 100%;" +
              "animation:commetBorderAnim 3s linear infinite;" +
              "-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);" +
              "-webkit-mask-composite:xor;mask-composite:exclude;" +
              "}" +
              "@keyframes commetBorderAnim{" +
              "0%{background-position:0% 0;}" +
              "100%{background-position:-300% 0;}" +
              "}";
            (document.head || document.documentElement).appendChild(styleEl);
          }

          const overlay = document.createElement("div");
          overlay.id = OVERLAY_ID;
          overlay.className = "commet-freeze-border";
          Object.assign(overlay.style, {
            position: "fixed",
            inset: "0",
            zIndex: "2147483646",
            pointerEvents: "auto",
            cursor: "wait",
            background: "rgba(15, 23, 42, 0.03)"
          });

          body.style.pointerEvents = "none";
          body.style.userSelect = "none";
          document.documentElement.style.overflow = "hidden";

          document.body.appendChild(overlay);
        } else {
          const overlay = document.getElementById(OVERLAY_ID);
          if (overlay) overlay.remove();
          body.style.pointerEvents = "";
          body.style.userSelect = "";
          document.documentElement.style.overflow = "";
        }
      },
      args: [freeze]
    });
  } catch (error) {
    console.error("Error freezing page:", error);
  }
}

// =========================
// Message helpers
// =========================

/**
 * Append a chat message bubble to the messages area.
 * @param {"user" | "assistant"} role
 * @param {string} text
 */
function appendMessage(role, text) {
  if (!chatMessagesEl) return;
  const container = document.createElement("div");
  container.className = `message message--${role}`;

  const body = document.createElement("div");
  body.className = "message__body";
  body.textContent = text;

  container.appendChild(body);
  chatMessagesEl.appendChild(container);

  // Auto-scroll to bottom
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

/**
 * Call LLM API with the user's message using the unified LLM client
 * @param {string} userText
 * @param {boolean} includeContext
 * @returns {Promise<string>}
 */
async function callLLMAPI(userText, includeContext = false) {
  try {
    // Initialize LLM client if not already done
    if (!llmClient.isInitialized) {
      await llmClient.initialize();
    }

    // Prepare the message content
    let messageContent = userText;

    // Add page context if requested
    if (includeContext) {
      const context = await getPageContext();
      if (context.url || context.text) {
        messageContent = `Page Context:
URL: ${context.url}
Title: ${context.title}

Page Content (first 3000 chars):
${context.text}

---

User Question: ${userText}`;
      }
    }

    // Load settings from storage for temperature and maxTokens
    const result = await chrome.storage.sync.get('browsemate_settings');
    const settings = result.browsemate_settings || {};

    // Generate completion using the LLM client
    const response = await llmClient.generateCompletion(messageContent, {
      temperature: settings.temperature || 0.7,
      maxTokens: settings.maxTokens || 1024
    });

    return response;

  } catch (error) {
    console.error('LLM API Error:', error);

    if (error.message.includes('token')) {
      return "Please configure your API token in Settings (click ⚙️ button).";
    }

    return `Error: ${error.message}\n\nPlease check your settings and try again.`;
  }
}

// =========================
// Event handlers
// =========================

/**
 * Handle user submitting a chat message.
 * @param {SubmitEvent} event
 */
async function handleChatSubmit(event) {
  event.preventDefault();
  if (!chatInputEl) return;

  const value = chatInputEl.value.trim();
  if (!value) {
    return;
  }

  // Show user message
  appendMessage("user", value);

  // Clear input
  chatInputEl.value = "";
  autoResizeTextArea(chatInputEl);

  // Check if page context should be included
  const includeContext = includePageContextCheckbox?.checked || false;

  // Freeze page and show loading indicator
  await setPageFrozen(true);
  appendMessage("assistant", "Thinking...");

  let reply;
  try {
    reply = await callLLMAPI(value, includeContext);
  } finally {
    // Always unfreeze, even if the API errors
    await setPageFrozen(false);
  }

  // Remove the "Thinking..." message
  if (chatMessagesEl && chatMessagesEl.lastChild) {
    chatMessagesEl.removeChild(chatMessagesEl.lastChild);
  }

  // Show actual response
  appendMessage("assistant", reply);
}

/**
 * Auto-resize textarea height to fit content up to a max.
 * @param {HTMLTextAreaElement} textarea
 */
function autoResizeTextArea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 80) + "px";
}

/**
 * Toggle chat open/closed.
 */
function toggleChatPanel() {
  if (!sidebarRootEl || !chatToggleBtn) return;
  const isCollapsed = sidebarRootEl.classList.toggle("sidebar-root--collapsed");

  chatToggleBtn.setAttribute("aria-pressed", String(!isCollapsed));
  chatToggleBtn.title = isCollapsed ? "Show chat" : "Hide chat";
}

/**
 * Open settings page in a new tab
 */
function openSettings() {
  const settingsUrl = chrome.runtime.getURL('settings.html');
  chrome.tabs.create({ url: settingsUrl }).catch((error) => {
    console.error('Error opening settings:', error);
    // Fallback: try to open in current window
    window.open(settingsUrl, '_blank');
  });
}

// =========================
// Initialisation
// =========================

function initChat() {
  if (chatFormEl) {
    chatFormEl.addEventListener("submit", handleChatSubmit);
  }

  if (chatInputEl) {
    chatInputEl.addEventListener("input", () => autoResizeTextArea(chatInputEl));

    // Submit on Enter, allow Shift+Enter for newline
    chatInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (chatFormEl) {
          chatFormEl.requestSubmit();
        }
      }
    });

    // Initial sizing
    autoResizeTextArea(chatInputEl);
  }

  // Seed with a friendly assistant welcome message
  appendMessage(
    "assistant",
    "Hi, I’m BrowseMate Chat living in your sidebar. Type a message below to start a conversation."
  );

  if (chatToggleBtn) {
    chatToggleBtn.addEventListener("click", toggleChatPanel);
  }

  if (settingsBtn) {
    settingsBtn.addEventListener("click", openSettings);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChat);
} else {
  initChat();
}

