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
// Page Context helpers
// =========================

/**
 * Get the current page context (URL, title, and visible text)
 * @returns {Promise<{url: string, title: string, text: string}>}
 */
async function getPageContext() {
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      return { url: '', title: '', text: '' };
    }

    // Execute script to get page content
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Get visible text content, excluding scripts and styles
        const clone = document.body.cloneNode(true);
        const scripts = clone.querySelectorAll('script, style, noscript');
        scripts.forEach(el => el.remove());

        // Get text and clean it up
        const text = clone.innerText
          .replace(/\s+/g, ' ')  // Normalize whitespace
          .trim()
          .slice(0, 3000);  // Limit to first 3000 characters

        return {
          url: window.location.href,
          title: document.title,
          text: text
        };
      }
    });

    return results && results[0] && results[0].result
      ? results[0].result
      : { url: '', title: '', text: '' };
  } catch (error) {
    console.error('Error getting page context:', error);
    return { url: '', title: '', text: '' };
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
 * Call Hugging Face API with the user's message
 * @param {string} userText
 * @param {boolean} includeContext
 * @returns {Promise<string>}
 */
async function callHuggingFaceAPI(userText, includeContext = false) {
  try {
    // Load settings from storage
    const result = await chrome.storage.sync.get('browsemate_settings');
    const settings = result.browsemate_settings;

    if (!settings || !settings.hfToken) {
      return "Please configure your Hugging Face API token in Settings (click ⚙️ button).";
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

    // Use OpenAI-compatible chat completion format
    const response = await fetch(
      'https://router.huggingface.co/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: settings.hfModel,
          messages: [
            {
              role: 'user',
              content: messageContent
            }
          ],
          max_tokens: settings.maxTokens || 1024,
          temperature: settings.temperature || 0.7
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    // Handle OpenAI-compatible response format
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].message.content || "No response generated.";
    } else {
      return JSON.stringify(data);
    }

  } catch (error) {
    console.error('Hugging Face API Error:', error);
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

  // Show loading indicator
  appendMessage("assistant", "Thinking...");

  // Check if page context should be included
  const includeContext = includePageContextCheckbox?.checked || false;

  // Call Hugging Face API
  const reply = await callHuggingFaceAPI(value, includeContext);

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

