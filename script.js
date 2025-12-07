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
/** @type {HTMLDivElement | null} */
const sidebarRootEl = document.querySelector(".sidebar-root");

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
 * Very simple placeholder "AI" reply.
 * Replace this with a real API call if needed.
 * @param {string} userText
 * @returns {string}
 */
function buildAssistantReply(userText) {
  const trimmed = userText.trim();
  if (!trimmed) {
    return "I'm here in your sidebar. Ask me anything or describe what you're working on.";
  }

  return `You said: "${trimmed}"\n\nThis is a demo reply. Wire this chat up to your backend or an API to make it truly smart.`;
}

// =========================
// Event handlers
// =========================

/**
 * Handle user submitting a chat message.
 * @param {SubmitEvent} event
 */
function handleChatSubmit(event) {
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

  // Simulate assistant response (synchronous for now)
  const reply = buildAssistantReply(value);
  appendMessage("assistant", reply);

  // Notify background script that a chat message was sent (for global actions).
  if (chrome?.runtime?.sendMessage) {
    chrome.runtime.sendMessage({
      type: "chat-message-sent",
      text: value
    });
  }
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChat);
} else {
  initChat();
}

