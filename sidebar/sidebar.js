// BrowseMate Chat - simple in-panel chat UI with Task A orchestrator integration
// Import Task A orchestrator for processing user requests
import { processRequest } from '../lib/task-planner.js';
// Import LLMClient for backward compatibility and settings
import { LLMClient } from '../lib/llm-client.js';
// Import memory manager for conversation history
import { getMemoryManager } from '../lib/memory-manager.js';

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
const newChatBtn = document.getElementById("newChatBtn");
/** @type {HTMLButtonElement | null} */
const chatToggleBtn = document.getElementById("chatToggle");
/** @type {HTMLButtonElement | null} */
const settingsBtn = document.getElementById("settingsBtn");
/** @type {HTMLInputElement | null} */
const includePageContextCheckbox = document.getElementById("includePageContext");
/** @type {HTMLDivElement | null} */
const sidebarRootEl = document.querySelector(".sidebar-root");
/** @type {HTMLButtonElement | null} */
const chatStopBtn = document.getElementById("chatStop");
/** @type {HTMLButtonElement | null} */
const chatSendBtn = document.getElementById("chatSend");
/** @type {HTMLButtonElement | null} */
const memoryStatsBtn = document.getElementById("memoryStatsBtn");

// =========================
// Request cancellation state
// =========================

/** @type {AbortController | null} */
let currentAbortController = null;
/** @type {boolean} */
let isRequestInProgress = false;

// =========================
// Memory manager instance
// =========================

/** @type {import('../lib/memory-manager.js').MemoryManager | null} */
let memoryManager = null;

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

    // Check if this is a protected Chrome URL where script injection is not allowed
    if (tab.url && (tab.url.startsWith('chrome://') ||
                    tab.url.startsWith('chrome-extension://') ||
                    tab.url.startsWith('edge://') ||
                    tab.url.startsWith('about:'))) {
      console.warn('[getPageContext] Cannot inject scripts into protected page:', tab.url);
      return {
        url: tab.url,
        title: tab.title || "",
        text: `This is a protected browser page (${tab.url}). BrowseMate cannot interact with chrome://, edge://, about: or extension pages due to browser security restrictions.`,
        html: ""
      };
    }

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

<<<<<<< HEAD
<<<<<<< HEAD
    // Skip freezing for protected browser pages
    // Chrome doesn't allow script injection into these pages
    if (tab.url && (tab.url.startsWith('chrome://') ||
                    tab.url.startsWith('chrome-extension://') ||
                    tab.url.startsWith('edge://') ||
                    tab.url.startsWith('about:'))) {
      console.warn('[setPageFrozen] Cannot freeze protected page:', tab.url);
=======
    // Skip freezing for extension pages (chrome-extension:// URLs)
    // Chrome doesn't allow script injection into extension pages
    if (tab.url && tab.url.startsWith('chrome-extension://')) {
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
=======
    // Skip freezing for extension pages (chrome-extension:// URLs)
    // Chrome doesn't allow script injection into extension pages
    if (tab.url && tab.url.startsWith('chrome-extension://')) {
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
      return;
    }

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
 * @param {boolean} saveToMemory - Whether to save this message to memory (default: true)
 */
function appendMessage(role, text, saveToMemory = true) {
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

  // Save to memory (skip temporary messages like "Thinking...")
  if (saveToMemory && memoryManager && text !== "Thinking...") {
    memoryManager.addMessage(role, text).catch(error => {
      console.error('[appendMessage] Failed to save message to memory:', error);
    });
  }
}

/**
 * Load conversation history from memory and display it
 * @returns {Promise<void>}
 */
async function loadConversationHistory() {
  if (!memoryManager || !chatMessagesEl) return;

  try {
    // Get all messages from memory
    const messages = memoryManager.getAllMessages();
    console.log(`[loadConversationHistory] Loading ${messages.length} messages from memory`);

    // Clear current messages
    chatMessagesEl.innerHTML = "";

    // If there are messages, display them
    if (messages.length > 0) {
      messages.forEach(msg => {
        // Don't save back to memory when loading (avoid duplicates)
        appendMessage(msg.role, msg.content, false);
      });
    } else {
      // Show welcome message if no history
      appendMessage(
        "assistant",
        "Hi, I'm BrowseMate Chat living in your sidebar. Type a message below to start a conversation.",
        false
      );
    }
  } catch (error) {
    console.error('[loadConversationHistory] Failed to load conversation history:', error);
    // Show welcome message on error
    appendMessage(
      "assistant",
      "Hi, I'm BrowseMate Chat living in your sidebar. Type a message below to start a conversation.",
      false
    );
  }
}

/**
 * Call Task A orchestrator to process user request
 * This replaces the direct LLM call with the full Task A + Task B flow
 * @param {string} userText
 * @param {boolean} includeContext
 * @param {Function} onProgress - Optional callback for progress updates
 * @param {AbortSignal} abortSignal - Signal to cancel the request
 * @returns {Promise<string>}
 */
async function callLLMAPI(userText, includeContext = false, onProgress = null, abortSignal = null) {
  console.log('[callLLMAPI] Starting LLM API call');
  console.log('[callLLMAPI] User text:', userText);
  console.log('[callLLMAPI] Include context:', includeContext);

  try {
    // Get page context if requested
    let context = null;
    if (includeContext) {
      console.log('[callLLMAPI] Getting page context...');
      context = await getPageContext();
      console.log('[callLLMAPI] Context retrieved:', {
        url: context.url,
        title: context.title,
        textLength: context.text?.length || 0,
        htmlLength: context.html?.length || 0
      });
    } else {
      console.log('[callLLMAPI] Context not requested, skipping');
    }

    // Get recent conversation history from memory
    let conversationHistory = [];
    if (memoryManager) {
      try {
        // Get recent messages (excluding the current user message which we're about to send)
        conversationHistory = memoryManager.getRecentMessages(10);
        console.log('[callLLMAPI] Retrieved conversation history:', conversationHistory.length, 'messages');
      } catch (error) {
        console.error('[callLLMAPI] Failed to get conversation history:', error);
        conversationHistory = [];
      }
    }

    // Use Task A orchestrator to process the request
    // Task A will determine if it's a question or action and route accordingly
    console.log('[callLLMAPI] Calling processRequest...');
    const result = await processRequest(context, userText, onProgress, abortSignal, conversationHistory);
    console.log('[callLLMAPI] ProcessRequest completed');
    
    // Check if request was aborted
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Request cancelled by user');
    }
    console.log('[callLLMAPI] Result type:', result.type);
    console.log('[callLLMAPI] Result:', result);

    // Format the response based on result type
    if (result.type === 'answer') {
      // Direct answer to a question
      console.log('[callLLMAPI] Returning answer:', result.message);
      return result.message;
    } else if (result.type === 'action_result') {
      // Action was executed
      const status = result.success ? '✓' : '✗';
      const formattedMessage = `${status} ${result.message}`;
      console.log('[callLLMAPI] Returning action result:', formattedMessage);
      return formattedMessage;
    } else if (result.type === 'execution') {
<<<<<<< HEAD
<<<<<<< HEAD
      // Sequential execution completed - show message only
      console.log('[callLLMAPI] Returning execution result');
      return result.message;
=======
=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
      // Sequential execution completed - show task list
      console.log('[callLLMAPI] Returning execution result with task list');
      const header = result.message + '\n\n';
      const taskList = result.taskList || 'No tasks to display';
      return header + taskList;
<<<<<<< HEAD
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
    } else if (result.type === 'plan') {
      // Plan created (old format backward compatibility)
      console.log('[callLLMAPI] Returning plan');
      return result.message;
    } else {
      // Unknown type
      console.warn('[callLLMAPI] Unknown result type:', result.type);
      return result.message || 'Unknown response type';
    }

  } catch (error) {
    console.error('[callLLMAPI] Task A processing error:', error);
    console.error('[callLLMAPI] Error message:', error.message);
    console.error('[callLLMAPI] Error stack:', error.stack);

    // Re-throw cancellation errors so they can be handled in handleChatSubmit
    if (error.message === 'Request cancelled by user') {
      throw error;
    }

    if (error.message && error.message.includes('token')) {
      return "Please configure your API token in Settings (click ⚙️ button).";
    }

    return `Error: ${error.message || 'Unknown error'}\n\nPlease check your settings and try again.`;
  }
}

// Create LLMClient singleton instance for backward compatibility
// (in case other parts of the code still reference it)
const llmClient = new LLMClient();

// Make getPageContext available globally for Task B executor
// (Task B executor uses it internally)
if (typeof window !== 'undefined') {
  window.getPageContext = getPageContext;
  window.llmClient = llmClient;
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

  // Prevent multiple simultaneous requests
  if (isRequestInProgress) {
    return;
  }

  // Show user message
  appendMessage("user", value);

  // Clear input
  chatInputEl.value = "";
  autoResizeTextArea(chatInputEl);

  // Check if page context should be included
  const includeContext = includePageContextCheckbox?.checked || false;

  // Create abort controller for this request
  currentAbortController = new AbortController();
  const abortSignal = currentAbortController.signal;
  isRequestInProgress = true;

  // Update UI: show Stop button, hide Send button
  if (chatStopBtn) chatStopBtn.style.display = "inline-flex";
  if (chatSendBtn) chatSendBtn.style.display = "none";

  // Show loading indicator (but don't freeze page yet - only freeze when actions start)
  // Don't save "Thinking..." to memory
  appendMessage("assistant", "Thinking...", false);

  let reply;
  let progressMessageEl = null;
  let progressContainer = null;
<<<<<<< HEAD
<<<<<<< HEAD
  let isPageFrozen = false; // Track if we've frozen the page
=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2

  try {
    // Create a callback for progress updates
    const onProgress = (taskList, currentStep, totalSteps, status) => {
<<<<<<< HEAD
<<<<<<< HEAD
      // Check if request was aborted
      if (abortSignal.aborted) {
        return;
      }

      // Freeze page when actions start (first time onProgress is called)
      if (!isPageFrozen) {
        setPageFrozen(true);
        isPageFrozen = true;
      }

=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
      // Remove "Thinking..." message if still there
      if (chatMessagesEl && chatMessagesEl.lastChild) {
        const lastMsg = chatMessagesEl.lastChild.querySelector('.message__body');
        if (lastMsg && lastMsg.textContent === "Thinking...") {
          chatMessagesEl.removeChild(chatMessagesEl.lastChild);
        }
      }

      // Create progress message if it doesn't exist
      if (!progressMessageEl) {
        progressContainer = document.createElement("div");
        progressContainer.className = "message message--assistant";
        progressMessageEl = document.createElement("div");
        progressMessageEl.className = "message__body";
        progressContainer.appendChild(progressMessageEl);
        chatMessagesEl.appendChild(progressContainer);
      }

      // Update the message with the current task list
      const header = `Executing actions (${currentStep}/${totalSteps})...\n\n`;
      progressMessageEl.textContent = header + taskList;

      // Auto-scroll to bottom
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    };

    reply = await callLLMAPI(value, includeContext, onProgress, abortSignal);
  } catch (error) {
    // Handle cancellation gracefully
    if (abortSignal.aborted || error.message === 'Request cancelled by user') {
      // Remove "Thinking..." message if still there
      if (chatMessagesEl && chatMessagesEl.lastChild) {
        const lastMsg = chatMessagesEl.lastChild.querySelector('.message__body');
        if (lastMsg && lastMsg.textContent === "Thinking...") {
          chatMessagesEl.removeChild(chatMessagesEl.lastChild);
        }
      }
      // Update progress message if it exists
      if (progressMessageEl) {
        progressMessageEl.textContent = "Got it. What next?";
        // Save cancellation message to memory
        if (memoryManager) {
          memoryManager.addMessage("assistant", "Got it. What next?").catch(console.error);
        }
      } else {
        appendMessage("assistant", "Got it. What next?");
      }
      reply = null; // Don't show error message for cancellation
    } else {
      // Re-throw other errors to be handled by existing error handling
      throw error;
    }
  } finally {
    // Always unfreeze if we froze the page, even if the API errors
    if (isPageFrozen) {
      await setPageFrozen(false);
    }
    
    // Reset request state
    isRequestInProgress = false;
    currentAbortController = null;
    
    // Update UI: hide Stop button, show Send button
    if (chatStopBtn) chatStopBtn.style.display = "none";
    if (chatSendBtn) chatSendBtn.style.display = "inline-flex";
  }

  // If we only showed "Thinking..." and no progress, remove it
  if (!progressMessageEl && chatMessagesEl && chatMessagesEl.lastChild) {
    const lastMsg = chatMessagesEl.lastChild.querySelector('.message__body');
    if (lastMsg && lastMsg.textContent === "Thinking...") {
      chatMessagesEl.removeChild(chatMessagesEl.lastChild);
    }
  }

  // If we have a progress message, update it with the final result
  if (progressMessageEl && reply && reply.trim()) {
    progressMessageEl.textContent = reply;
<<<<<<< HEAD
<<<<<<< HEAD
    // Save the final reply to memory
    if (memoryManager) {
      memoryManager.addMessage("assistant", reply).catch(error => {
        console.error('[handleChatSubmit] Failed to save assistant reply to memory:', error);
      });
    }
=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
  } else if (reply && reply.trim()) {
    // Only append new message if we didn't have progress updates
    appendMessage("assistant", reply);
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

/**
 * Start a brand-new chat session:
 * - Clear all existing messages
<<<<<<< HEAD
<<<<<<< HEAD
 * - Clear conversation history from memory
 * - Reset the input field
 * - Show the initial welcome message again
 */
async function startNewChat() {
  console.log('[startNewChat] Starting new chat session');

  // Clear memory
  if (memoryManager) {
    try {
      await memoryManager.clearHistory();
      console.log('[startNewChat] Conversation history cleared from memory');
    } catch (error) {
      console.error('[startNewChat] Failed to clear memory:', error);
    }
  }

  // Clear UI
=======
 * - Reset the input field
 * - Show the initial welcome message again
 */
function startNewChat() {
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
=======
 * - Reset the input field
 * - Show the initial welcome message again
 */
function startNewChat() {
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
  if (chatMessagesEl) {
    chatMessagesEl.innerHTML = "";
  }
  if (chatInputEl) {
    chatInputEl.value = "";
    autoResizeTextArea(chatInputEl);
  }

<<<<<<< HEAD
<<<<<<< HEAD
  // Show welcome message (and save to memory)
  appendMessage(
    "assistant",
    "Hi, I'm BrowseMate Chat living in your sidebar. Type a message below to start a conversation."
=======
  appendMessage(
    "assistant",
    "Hi, I’m BrowseMate Chat living in your sidebar. Type a message below to start a conversation."
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
=======
  appendMessage(
    "assistant",
    "Hi, I’m BrowseMate Chat living in your sidebar. Type a message below to start a conversation."
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
  );
}

/**
<<<<<<< HEAD
<<<<<<< HEAD
 * Handle Stop button click - cancel the current request
 */
function handleStopClick() {
  if (currentAbortController && isRequestInProgress) {
    // Abort the current request
    currentAbortController.abort();
    console.log('[handleStopClick] Request cancelled by user');
  }
}

/**
 * Handle Memory Stats button click - show conversation memory statistics
 */
function handleMemoryStatsClick() {
  if (!memoryManager) {
    alert('Memory manager not initialized');
    return;
  }

  try {
    const stats = memoryManager.getStats();

    // Format time
    const formatTime = (timestamp) => {
      if (!timestamp) return 'Never';
      const date = new Date(timestamp);
      return date.toLocaleString();
    };

    // Build stats message
    const statsMessage = `Conversation Memory Stats:

Total messages: ${stats.totalMessages}
User messages: ${stats.userMessages}
Assistant messages: ${stats.assistantMessages}

First message: ${formatTime(stats.firstMessageTime)}
Last message: ${formatTime(stats.lastMessageTime)}

Memory is automatically saved to browser storage.
Use "New Chat" button to clear conversation history.`;

    alert(statsMessage);
  } catch (error) {
    console.error('[handleMemoryStatsClick] Failed to get memory stats:', error);
    alert('Error retrieving memory stats');
  }
}

/**
=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
 * Toggle the Settings page as a separate tab.
 * If a Settings tab is already open, close it; otherwise open it.
 */
async function toggleSettings() {
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

// =========================
// Initialisation
// =========================

async function initChat() {
  console.log('[initChat] Initializing chat...');

  // Initialize memory manager
  memoryManager = getMemoryManager();
  try {
    await memoryManager.initialize();
    console.log('[initChat] Memory manager initialized');

    // Load conversation history from memory
    await loadConversationHistory();
  } catch (error) {
    console.error('[initChat] Failed to initialize memory manager:', error);
    // Show welcome message as fallback
    appendMessage(
      "assistant",
      "Hi, I'm BrowseMate Chat living in your sidebar. Type a message below to start a conversation.",
      false
    );
  }

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

  if (chatToggleBtn) {
    chatToggleBtn.addEventListener("click", toggleChatPanel);
  }

  if (newChatBtn) {
    newChatBtn.addEventListener("click", startNewChat);
  }

  if (settingsBtn) {
    settingsBtn.addEventListener("click", toggleSettings);
<<<<<<< HEAD
<<<<<<< HEAD
  }

  if (chatStopBtn) {
    chatStopBtn.addEventListener("click", handleStopClick);
  }

  if (memoryStatsBtn) {
    memoryStatsBtn.addEventListener("click", handleMemoryStatsClick);
=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
=======
>>>>>>> 8cb838b821c7fc636a407753965378630f2d30f2
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChat);
} else {
  initChat();
}
