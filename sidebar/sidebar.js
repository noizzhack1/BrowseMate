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

    // Skip freezing for protected browser pages
    // Chrome doesn't allow script injection into these pages
    if (tab.url && (tab.url.startsWith('chrome://') ||
                    tab.url.startsWith('chrome-extension://') ||
                    tab.url.startsWith('edge://') ||
                    tab.url.startsWith('about:'))) {
      console.warn('[setPageFrozen] Cannot freeze protected page:', tab.url);
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
 * Find the next assistant message wrapper after a given user message wrapper
 * @param {HTMLElement} userMessageWrapper - The user message wrapper element
 * @returns {HTMLElement | null} The next assistant message wrapper, or null if not found
 */
function findNextAssistantMessage(userMessageWrapper) {
  if (!userMessageWrapper || !chatMessagesEl) return null;
  
  // Get all message wrappers
  const allWrappers = Array.from(chatMessagesEl.children);
  const currentIndex = allWrappers.indexOf(userMessageWrapper);
  
  if (currentIndex === -1) return null;
  
  // Look for the next assistant message
  for (let i = currentIndex + 1; i < allWrappers.length; i++) {
    const wrapper = allWrappers[i];
    if (wrapper.classList.contains('message-wrapper--assistant')) {
      return wrapper;
    }
    // Stop if we hit another user message (means no assistant response yet)
    if (wrapper.classList.contains('message-wrapper--user')) {
      return null;
    }
  }
  
  return null;
}

/**
 * Find ALL assistant message wrappers after a given user message wrapper
 * This includes all assistant responses that were generated from the user message
 * @param {HTMLElement} userMessageWrapper - The user message wrapper element
 * @returns {HTMLElement[]} Array of all assistant message wrappers after the user message
 */
function findAllAssistantMessagesAfter(userMessageWrapper) {
  if (!userMessageWrapper || !chatMessagesEl) return [];
  
  // Get all message wrappers
  const allWrappers = Array.from(chatMessagesEl.children);
  const currentIndex = allWrappers.indexOf(userMessageWrapper);
  
  if (currentIndex === -1) return [];
  
  const assistantWrappers = [];
  
  // Collect all assistant messages until we hit another user message
  for (let i = currentIndex + 1; i < allWrappers.length; i++) {
    const wrapper = allWrappers[i];
    if (wrapper.classList.contains('message-wrapper--assistant')) {
      assistantWrappers.push(wrapper);
    } else if (wrapper.classList.contains('message-wrapper--user')) {
      // Stop when we hit another user message (conversation thread boundary)
      break;
    }
  }
  
  return assistantWrappers;
}

/**
 * Find ALL message wrappers (both user and assistant) after a given message wrapper
 * This is used when editing a message to remove all subsequent messages (conversation rewind)
 * @param {HTMLElement} messageWrapper - The message wrapper element to rewind from
 * @returns {HTMLElement[]} Array of all message wrappers after the given message
 */
function findAllMessagesAfter(messageWrapper) {
  if (!messageWrapper || !chatMessagesEl) return [];
  
  // Get all message wrappers
  const allWrappers = Array.from(chatMessagesEl.children);
  const currentIndex = allWrappers.indexOf(messageWrapper);
  
  if (currentIndex === -1) return [];
  
  // Return all messages after this one (both user and assistant)
  return allWrappers.slice(currentIndex + 1);
}

/**
 * Remove a message and its associated memory entry
 * @param {HTMLElement} messageWrapper - The message wrapper to remove
 * @param {string} role - The role of the message ('user' or 'assistant')
 * @param {string} content - The content of the message to remove from memory
 */
async function removeMessageAndMemory(messageWrapper, role, content) {
  // Remove from DOM
  if (messageWrapper && messageWrapper.parentNode) {
    messageWrapper.parentNode.removeChild(messageWrapper);
  }
  
  // Remove from memory if memory manager is available
  if (memoryManager && content) {
    try {
      // Get all messages
      const allMessages = memoryManager.getAllMessages();
      // Find and remove the matching message
      const index = allMessages.findIndex(msg => 
        msg.role === role && msg.content === content
      );
      if (index !== -1) {
        // Remove from array
        allMessages.splice(index, 1);
        // Save back to storage
        await memoryManager.save();
        console.log(`[removeMessageAndMemory] Removed ${role} message from memory`);
      }
    } catch (error) {
      console.error('[removeMessageAndMemory] Failed to remove from memory:', error);
    }
  }
}

/**
 * Resend a user message and replace ALL assistant responses that came after it
 * @param {string} editedText - The edited user message text
 * @param {HTMLElement} userMessageWrapper - The user message wrapper element
 * @param {HTMLElement[]} oldAssistantWrappers - Array of all old assistant message wrappers to replace
 * @param {string} oldUserContent - The original user message content (before editing) for memory removal
 * @param {boolean} skipMemoryCleanup - If true, skip memory cleanup (already done by caller)
 */
async function resendMessageAndReplace(editedText, userMessageWrapper, oldAssistantWrappers = [], oldUserContent = '', skipMemoryCleanup = false) {
  if (!chatMessagesEl || isRequestInProgress) {
    console.warn('[resendMessageAndReplace] Cannot resend: chat not ready or request in progress');
    return;
  }
  
  // Remove ALL old assistant messages from DOM (if any remain)
  // Note: These may have already been removed by the caller, but we'll try anyway
  let removedFromDOM = 0;
  for (const wrapper of oldAssistantWrappers) {
    if (wrapper && wrapper.parentNode) {
      wrapper.remove();
      removedFromDOM++;
    }
  }
  if (removedFromDOM > 0) {
    console.log(`[resendMessageAndReplace] Removed ${removedFromDOM} assistant message(s) from DOM`);
  }
  
  // Skip memory cleanup if already done by caller
  if (skipMemoryCleanup) {
    console.log('[resendMessageAndReplace] Skipping memory cleanup (already done by caller)');
  } else {
    // If oldUserContent not provided, try to get it from the message body
    if (!oldUserContent) {
      const userBody = userMessageWrapper.querySelector('.message__body');
      oldUserContent = userBody ? (userBody.textContent || userBody.innerText || '') : '';
    }
    
    // Collect all old assistant message contents for memory removal
    const oldAssistantContents = [];
    for (const wrapper of oldAssistantWrappers) {
      if (wrapper && wrapper.parentNode) {
        const oldBody = wrapper.querySelector('.message__body');
        if (oldBody) {
          const content = oldBody.textContent || oldBody.innerText || '';
          if (content) {
            oldAssistantContents.push(content);
          }
        }
      }
    }
    
    console.log(`[resendMessageAndReplace] Removing ${oldAssistantContents.length} assistant response(s) from memory`);
    
    // Remove ALL old messages from memory
    if (memoryManager) {
      try {
        const allMessages = memoryManager.getAllMessages();
        let removedCount = 0;
        
        // Remove ALL assistant messages that match any of the old assistant contents
        for (let i = allMessages.length - 1; i >= 0; i--) {
          const msg = allMessages[i];
          if (msg.role === 'assistant' && oldAssistantContents.includes(msg.content)) {
            allMessages.splice(i, 1);
            removedCount++;
            console.log(`[resendMessageAndReplace] Removed assistant message from memory: ${msg.content.substring(0, 50)}...`);
          }
        }
        
        console.log(`[resendMessageAndReplace] Removed ${removedCount} assistant message(s) from memory`);
        
        // Remove the old user message (search from end to find the most recent match)
        if (oldUserContent) {
          for (let i = allMessages.length - 1; i >= 0; i--) {
            if (allMessages[i].role === 'user' && allMessages[i].content === oldUserContent) {
              allMessages.splice(i, 1);
              console.log('[resendMessageAndReplace] Removed old user message from memory');
              break;
            }
          }
        }
        
        // Save updated messages
        await memoryManager.save();
        console.log('[resendMessageAndReplace] Memory cleanup complete. Remaining messages:', allMessages.length);
      } catch (error) {
        console.error('[resendMessageAndReplace] Failed to remove messages from memory:', error);
      }
    }
  }
  
  // Prevent multiple simultaneous requests
  isRequestInProgress = true;
  
  // Create abort controller for this request
  currentAbortController = new AbortController();
  const abortSignal = currentAbortController.signal;
  
  // Update UI: show Stop button, hide Send button
  if (chatStopBtn) chatStopBtn.style.display = "inline-flex";
  if (chatSendBtn) chatSendBtn.style.display = "none";
  
  // Show loading indicator
  appendMessage("assistant", "Thinking...", false);
  
  let reply;
  let progressMessageEl = null;
  let progressContainer = null;
  let streamingMessageEl = null;
  let isPageFrozen = false;
  
  try {
    // Check if page context should be included
    const includeContext = includePageContextCheckbox?.checked || false;
    
    // Create callbacks (same as handleChatSubmit)
    const onStreamChunk = (chunk) => {
      if (abortSignal.aborted) return;
      
      if (chatMessagesEl && chatMessagesEl.lastChild) {
        const lastMsg = chatMessagesEl.lastChild.querySelector('.message__body');
        if (lastMsg && lastMsg.textContent === "Thinking...") {
          chatMessagesEl.removeChild(chatMessagesEl.lastChild);
        }
      }
      
      if (!streamingMessageEl) {
        const streamingMsg = createStreamingMessage("assistant");
        if (streamingMsg) {
          streamingMessageEl = streamingMsg.body;
        }
      }
      
      if (streamingMessageEl) {
        updateStreamingMessage(streamingMessageEl, chunk, true);
      }
    };
    
    const onProgress = (taskList, currentStep, totalSteps, status) => {
      if (abortSignal.aborted) return;
      
      if (!isPageFrozen) {
        setPageFrozen(true);
        isPageFrozen = true;
      }
      
      if (chatMessagesEl && chatMessagesEl.lastChild) {
        const lastMsg = chatMessagesEl.lastChild.querySelector('.message__body');
        if (lastMsg && lastMsg.textContent === "Thinking...") {
          chatMessagesEl.removeChild(chatMessagesEl.lastChild);
        }
      }
      
      if (!progressMessageEl) {
        const progressWrapper = document.createElement("div");
        progressWrapper.className = "message-wrapper";
        
        progressContainer = document.createElement("div");
        progressContainer.className = "message message--assistant bg-white text-slate-800 border border-slate-200";
        progressMessageEl = document.createElement("div");
        progressMessageEl.className = "message__body";
        progressContainer.appendChild(progressMessageEl);
        
        progressWrapper.appendChild(progressContainer);
        
        const iconsWrapper = createMessageIcons(progressContainer, progressMessageEl, "assistant", null);
        progressWrapper.appendChild(iconsWrapper);
        
        chatMessagesEl.appendChild(progressWrapper);
      }
      
      const header = `Executing actions (${currentStep}/${totalSteps})...\n\n`;
      progressMessageEl.textContent = header + taskList;
      
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    };
    
    const onInteraction = async (question) => {
      console.log('[resendMessageAndReplace] onInteraction called with question:', question);
      
      if (isPageFrozen) {
        await setPageFrozen(false);
      }
      
      appendMessage("assistant", question);
      
      return new Promise((resolve) => {
        const handleInteractionResponse = async (event) => {
          event.preventDefault();
          event.stopPropagation();
          
          if (!chatInputEl) {
            resolve('');
            return;
          }
          
          const response = chatInputEl.value.trim();
          if (!response) {
            return;
          }
          
          console.log('[resendMessageAndReplace] User response:', response);
          
          appendMessage("user", response);
          
          chatInputEl.value = "";
          autoResizeTextArea(chatInputEl);
          
          chatFormEl.removeEventListener("submit", handleInteractionResponse);
          chatFormEl.addEventListener("submit", handleChatSubmit);
          
          if (!isPageFrozen) {
            await setPageFrozen(true);
            isPageFrozen = true;
          }
          
          resolve(response);
        };
        
        chatFormEl.removeEventListener("submit", handleChatSubmit);
        chatFormEl.addEventListener("submit", handleInteractionResponse);
      });
    };
    
    // Call LLM API with edited text
    reply = await callLLMAPI(editedText, includeContext, onProgress, abortSignal, onInteraction);
  } catch (error) {
    if (abortSignal.aborted || error.message === 'Request cancelled by user') {
      if (chatMessagesEl && chatMessagesEl.lastChild) {
        const lastMsg = chatMessagesEl.lastChild.querySelector('.message__body');
        if (lastMsg && lastMsg.textContent === "Thinking...") {
          chatMessagesEl.removeChild(chatMessagesEl.lastChild);
        }
      }
      if (progressMessageEl) {
        progressMessageEl.textContent = "Don't stop me nowww, Cause Im having a good time, having a good time";
        if (memoryManager) {
          memoryManager.addMessage("assistant", "Don't stop me nowww, Cause Im having a good time, having a good time").catch(console.error);
        }
      } else {
        appendMessage("assistant", "Don't stop me nowww, Cause Im having a good time, having a good time");
      }
      reply = null;
    } else {
      throw error;
    }
  } finally {
    if (isPageFrozen) {
      await setPageFrozen(false);
    }
    
    isRequestInProgress = false;
    currentAbortController = null;
    
    if (chatStopBtn) chatStopBtn.style.display = "none";
    if (chatSendBtn) chatSendBtn.style.display = "inline-flex";
  }
  
  // Clean up "Thinking..." message
  if (!progressMessageEl && !streamingMessageEl && chatMessagesEl && chatMessagesEl.lastChild) {
    const lastMsg = chatMessagesEl.lastChild.querySelector('.message__body');
    if (lastMsg && lastMsg.textContent === "Thinking...") {
      chatMessagesEl.removeChild(chatMessagesEl.lastChild);
    }
  }
  
  // Update or create assistant response
  if (progressMessageEl && reply && reply.trim()) {
    progressMessageEl.textContent = reply;
    if (memoryManager) {
      memoryManager.addMessage("assistant", reply).catch(error => {
        console.error('[resendMessageAndReplace] Failed to save assistant reply to memory:', error);
      });
    }
  } else if (streamingMessageEl) {
    if (memoryManager && reply && reply.trim()) {
      memoryManager.addMessage("assistant", reply).catch(error => {
        console.error('[resendMessageAndReplace] Failed to save streaming reply to memory:', error);
      });
    }
  } else if (reply && reply.trim()) {
    appendMessage("assistant", reply);
  }
}

/**
 * Create copy and edit icons for a message (shown on hover, at the end of message)
 * @param {HTMLElement} container - The message container element
 * @param {HTMLElement} body - The message body element (for getting text)
 * @param {string} role - The message role ("user" or "assistant")
 * @param {string} originalText - The original message text (for editing, null for streaming messages)
 * @returns {HTMLElement} The icons wrapper element
 */
function createMessageIcons(container, body, role, originalText = null) {
  // Create wrapper for icons (copy and edit)
  const iconsWrapper = document.createElement("div");
  iconsWrapper.className = "message__icons";
  iconsWrapper.dataset.index = memoryManager.getAllMessages().length;
  
  // Copy button
  const copyBtn = document.createElement("button");
  copyBtn.className = "message__icon message__icon--copy";
  copyBtn.type = "button";
  copyBtn.setAttribute("aria-label", "Copy message");
  copyBtn.title = "Copy message";
  
  // Copy icon SVG - store as constant for reuse
  const copyIconSVG = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><path d="M5.5 3.5V1.5C5.5 1.22386 5.72386 1 6 1H12.5C12.7761 1 13 1.22386 13 1.5V8.5C13 8.77614 12.7761 9 12.5 9H10.5V11.5C10.5 11.7761 10.2761 12 10 12H3.5C3.22386 12 3 11.7761 3 11.5V4.5C3 4.22386 3.22386 4 3.5 4H5.5V3.5ZM6 2V4.5C6 4.77614 6.22386 5 6.5 5H10V8H12V2H6ZM4 5H9.5V11H4V5Z" fill-rule="evenodd" clip-rule="evenodd" fill="currentColor"/></svg>`;
  
  // Checkmark icon SVG
  const checkmarkIconSVG = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/></svg>`;
  
  // Set initial copy icon
  copyBtn.innerHTML = copyIconSVG;
  
  // Edit button (only for user messages)
  let editBtn = null;
  if (role === "user" && originalText !== null) {
    editBtn = document.createElement("button");
    editBtn.className = "message__icon message__icon--edit";
    editBtn.type = "button";
    editBtn.setAttribute("aria-label", "Edit message");
    editBtn.title = "Edit message";
    
    // Edit icon SVG
    editBtn.innerHTML = `
      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14">
        <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.249.249 0 00.108-.064l6.286-6.286z" fill="currentColor"/>
      </svg>
    `;
  }
  
  iconsWrapper.appendChild(copyBtn);
  if (editBtn) {
    iconsWrapper.appendChild(editBtn);
  }
  
  // Copy functionality
  copyBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Get text content (handle both textContent and innerHTML for streaming messages)
    let textToCopy = '';
    
    // Try to get text content first (works for both plain text and HTML)
    if (body.textContent) {
      textToCopy = body.textContent;
    } else if (body.innerText) {
      textToCopy = body.innerText;
    } else if (body.innerHTML) {
      // For HTML content, extract text while preserving structure
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = body.innerHTML;
      textToCopy = tempDiv.textContent || tempDiv.innerText || '';
    }
    
    // Clean up extra whitespace but preserve line breaks
    textToCopy = textToCopy.trim();
    
    if (!textToCopy) {
      return; // Nothing to copy
    }
    
    // Function to show checkmark and revert to copy icon
    const showCheckmark = () => {
      // Change icon to checkmark
      copyBtn.innerHTML = checkmarkIconSVG;
      
      // Revert to copy icon after 2 seconds
      setTimeout(() => {
        copyBtn.innerHTML = copyIconSVG;
      }, 2000);
    };
    
    try {
      await navigator.clipboard.writeText(textToCopy);
      showCheckmark();
    } catch (err) {
      console.error('Failed to copy text:', err);
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = textToCopy;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        const successful = document.execCommand('copy');
        if (successful) {
          showCheckmark();
        }
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
      }
      document.body.removeChild(textArea);
    }
  });
  
  // Edit functionality (only for user messages) - inline editing
  if (editBtn && originalText !== null) {
    let isEditing = false;
    let savedOriginalText = originalText;
    
    // Create Save & Resend and Cancel buttons (initially hidden)
    const saveBtn = document.createElement("button");
    saveBtn.className = "message__icon message__icon--save";
    saveBtn.type = "button";
    saveBtn.setAttribute("aria-label", "Save and resend message");
    saveBtn.title = "Save & Resend";
    saveBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" fill="currentColor"/></svg>`;
    saveBtn.style.display = 'none';
    
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "message__icon message__icon--cancel";
    cancelBtn.type = "button";
    cancelBtn.setAttribute("aria-label", "Cancel editing");
    cancelBtn.title = "Cancel";
    cancelBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" width="14" height="14"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" fill="currentColor"/></svg>`;
    cancelBtn.style.display = 'none';
    
    // Add Save and Cancel buttons to icons wrapper
    iconsWrapper.appendChild(saveBtn);
    iconsWrapper.appendChild(cancelBtn);
    
    // Function to enter edit mode
    const enterEditMode = () => {
      if (isEditing) return;
      isEditing = true;
      
      // Store current text as original (in case user cancels)
      savedOriginalText = body.textContent || body.innerText || '';
      
      // Make body contentEditable
      body.contentEditable = 'true';
      body.style.outline = 'none';
      // Use appropriate border color based on message type
      const borderColor = role === 'user' ? 'rgba(255, 255, 255, 0.5)' : '#2563eb';
      body.style.border = `1px solid ${borderColor}`;
      body.style.borderRadius = '4px';
      body.style.padding = '4px 6px';
      body.style.minHeight = '20px';
      body.style.backgroundColor = role === 'user' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(37, 99, 235, 0.05)';
      
      // Hide edit button, show Save and Cancel
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-flex';
      cancelBtn.style.display = 'inline-flex';
      
      // Focus and select text in the editable area
      body.focus();
      const range = document.createRange();
      range.selectNodeContents(body);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };
    
    // Function to exit edit mode
    const exitEditMode = () => {
      if (!isEditing) return;
      isEditing = false;
      
      // Remove contentEditable and styling
      body.contentEditable = 'false';
      body.style.border = '';
      body.style.borderRadius = '';
      body.style.padding = '';
      body.style.minHeight = '';
      body.style.backgroundColor = '';
      
      // Show edit button, hide Save and Cancel
      editBtn.style.display = 'inline-flex';
      saveBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
    };
    
    // Function to save changes and resend
    const saveAndResend = async () => {
      const newText = body.textContent || body.innerText || '';
      const trimmedText = newText.trim();
      if (!trimmedText) {
        // If empty, restore original and don't resend
        body.textContent = savedOriginalText;
        exitEditMode();
        return;
      }
      
      // Get the old content BEFORE updating (for finding the message in memory)
      const oldUserContent = savedOriginalText;
      
      // Find the message wrapper (parent of container)
      let messageWrapper = container.parentElement;
      if (!messageWrapper || !messageWrapper.classList.contains('message-wrapper')) {
        messageWrapper = container.closest('.message-wrapper');
      }
      
      if (!messageWrapper) {
        console.error('[saveAndResend] Could not find message wrapper');
        exitEditMode();
        return;
      }
      
      // Find ALL messages after this one (both user and assistant) - conversation rewind
      const allMessagesAfter = findAllMessagesAfter(messageWrapper);
      console.log(`[saveAndResend] Found ${allMessagesAfter.length} message(s) to remove (conversation rewind)`);
      
      // Find the index of the edited message in memory by matching old content
      let messageIndex = -1;
      if (memoryManager && oldUserContent) {
        const allMessages = memoryManager.getAllMessages();
        // Search from end to find the most recent match
        for (let i = allMessages.length - 1; i >= 0; i--) {
          if (allMessages[i].role === 'user' && allMessages[i].content === oldUserContent) {
            messageIndex = i;
            break;
          }
        }
      }
      
      // Remove all messages after the edited one from DOM
      for (const wrapper of allMessagesAfter) {
        wrapper.remove();
      }
      console.log(`[saveAndResend] Removed ${allMessagesAfter.length} message(s) from DOM`);
      
      // Update the message content in place
      body.textContent = trimmedText;
      // Update saved original text for future edits
      savedOriginalText = trimmedText;
      
      // Exit edit mode
      exitEditMode();
      
      // Update memory: edit the message and remove all subsequent messages
      if (memoryManager && messageIndex >= 0) {
        try {
          // Edit the message content
          await memoryManager.editMessage(messageIndex, trimmedText);
          // Remove all messages after this one (conversation rewind)
          await memoryManager.removeMessagesAfter(messageIndex);
          console.log(`[saveAndResend] Memory updated: edited message at index ${messageIndex}, removed all subsequent messages`);
        } catch (error) {
          console.error('[saveAndResend] Failed to update memory:', error);
        }
      }
      
      // Now resend the edited message
      // Since we've already removed all subsequent messages from DOM and memory,
      // we pass skipMemoryCleanup=true to avoid duplicate cleanup
      const allAssistantWrappers = findAllAssistantMessagesAfter(messageWrapper);
      
      // Resend the message - this will generate a new assistant response
      // Skip memory cleanup since we've already done it above
      await resendMessageAndReplace(trimmedText, messageWrapper, allAssistantWrappers, oldUserContent, true);
    };
    
    // Function to cancel editing
    const cancelEditing = () => {
      // Restore original text
      body.textContent = savedOriginalText;
      exitEditMode();
    };
    
    // Edit button click handler
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      enterEditMode();
    });
    
    // Save & Resend button click handler
    saveBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await saveAndResend();
    });
    // Cancel button click handler
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      cancelEditing();
    });
    
    // Handle Enter key to save & resend, Escape to cancel
    body.addEventListener("keydown", async (e) => {
      if (!isEditing) return;
      
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        await saveAndResend();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEditing();
      }
    });
  }
  
  // Function to check if message has content
  const hasContent = () => {
    const text = body.textContent || body.innerText || '';
    return text.trim().length > 0;
  };
  
  // Find the message wrapper - it's the parent of the container
  // Note: At the time createMessageIcons is called, container is already in messageWrapper
  let messageWrapper = container.parentElement;
  
  // If parentElement doesn't have the class, try closest (for safety)
  if (!messageWrapper || !messageWrapper.classList.contains('message-wrapper')) {
    messageWrapper = container.closest('.message-wrapper');
  }
  
  // Hide icons if message is empty
  const updateVisibility = () => {
    if (hasContent()) {
      // Icons are shown via CSS hover, ensure they're in the layout
      iconsWrapper.style.display = 'flex';
      // CRITICAL: Remove any inline opacity - let CSS/JS hover handle it
      iconsWrapper.style.removeProperty('opacity');
      iconsWrapper.style.removeProperty('pointer-events');
    } else {
      // Hide completely if no content
      iconsWrapper.style.display = 'none';
    }
  };
  
  // Add JavaScript hover handlers to ensure it works for both message types
  // This provides a reliable fallback that works regardless of CSS specificity
  if (messageWrapper && messageWrapper.classList.contains('message-wrapper')) {
    // Mouse enter - show icons
    const handleMouseEnter = () => {
      if (hasContent() && iconsWrapper.style.display !== 'none') {
        iconsWrapper.style.opacity = '1';
        iconsWrapper.style.pointerEvents = 'auto';
        iconsWrapper.style.visibility = 'visible';
      }
    };
    
    // Mouse leave - hide icons
    const handleMouseLeave = () => {
      iconsWrapper.style.opacity = '0';
      iconsWrapper.style.pointerEvents = 'none';
      // Keep visibility visible so element can still be hovered
      iconsWrapper.style.visibility = 'visible';
    };
    
    // Attach to wrapper (covers entire message area)
    messageWrapper.addEventListener('mouseenter', handleMouseEnter);
    messageWrapper.addEventListener('mouseleave', handleMouseLeave);
    
    // Also attach to the message bubble itself for extra reliability
    // This ensures hover works even if wrapper hover doesn't trigger
    container.addEventListener('mouseenter', handleMouseEnter);
    container.addEventListener('mouseleave', handleMouseLeave);
    
    // Set initial hidden state
    if (hasContent()) {
      handleMouseLeave();
    }
  }
  
  // Initial visibility check
  updateVisibility();
  
  // For streaming messages, check content periodically
  if (body.innerHTML || body.textContent) {
    const observer = new MutationObserver(() => {
      updateVisibility();
    });
    observer.observe(body, { childList: true, subtree: true, characterData: true });
  }
  
  return iconsWrapper;
}

/**
 * Append a chat message bubble to the messages area.
 * @param {"user" | "assistant"} role
 * @param {string} text
 * @param {boolean} saveToMemory - Whether to save this message to memory (default: true)
 * @returns {HTMLElement} The message body element for potential streaming updates
 */
function appendMessage(role, text, saveToMemory = true) {
  if (!chatMessagesEl) return null;

  // Create wrapper for message and copy icon (copy icon outside message border)
  const messageWrapper = document.createElement("div");
  messageWrapper.className = `message-wrapper message-wrapper--${role}`;

  const container = document.createElement("div");
  // Add Tailwind classes based on message role
  const roleClasses = role === 'user'
    ? 'bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-500 text-white'
    : 'bg-white text-slate-800 border border-slate-200';
  container.className = `message message--${role} ${roleClasses}`;

  const body = document.createElement("div");
  body.className = "message__body";
  body.textContent = text;

  container.appendChild(body);

  // Add message to wrapper
  messageWrapper.appendChild(container);

  // Add icons outside message border (at the end of message)
  const iconsWrapper = createMessageIcons(container, body, role, text);
  messageWrapper.appendChild(iconsWrapper);

  chatMessagesEl.appendChild(messageWrapper);

  // Auto-scroll to bottom
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  // Save to memory (skip temporary messages like "Thinking...")
  if (saveToMemory && memoryManager && text !== "Thinking...") {
    memoryManager.addMessage(role, text).catch(error => {
      console.error('[appendMessage] Failed to save message to memory:', error);
    });
  }

  return body;
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
 * Create a streaming message element that can be updated progressively.
 * @param {"user" | "assistant"} role
 * @returns {{container: HTMLElement, body: HTMLElement}} The container and body elements
 */
function createStreamingMessage(role) {
  if (!chatMessagesEl) return null;

  // Create wrapper for message and copy icon (copy icon outside message border)
  const messageWrapper = document.createElement("div");
  messageWrapper.className = `message-wrapper message-wrapper--${role}`;

  const container = document.createElement("div");
  // Add Tailwind classes based on message role
  const roleClasses = role === 'user'
    ? 'bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-500 text-white'
    : 'bg-white text-slate-800 border border-slate-200';
  container.className = `message message--${role} ${roleClasses}`;

  const body = document.createElement("div");
  body.className = "message__body";
  body.textContent = "";

  container.appendChild(body);

  // Add message to wrapper
  messageWrapper.appendChild(container);

  // Add icons outside message border (at the end of message)
  // Note: For streaming messages, we don't have original text, so edit won't be available
  const iconsWrapper = createMessageIcons(container, body, role, null);
  messageWrapper.appendChild(iconsWrapper);

  chatMessagesEl.appendChild(messageWrapper);

  // Auto-scroll to bottom
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  return { container, body };
}

/**
 * Simple markdown to HTML converter for basic formatting
 * Handles bold, lists, and preserves structure
 * @param {string} markdown - Markdown text
 * @returns {string} HTML string
 */
function markdownToHTML(markdown) {
  if (!markdown) return '';

  // Escape HTML first to prevent XSS
  let html = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert **bold** to <strong>
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Split into lines for list processing
  const lines = html.split('\n');
  const processedLines = [];
  let inList = false;
  let listType = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for numbered list (1. item)
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) processedLines.push(`</${listType}>`);
        processedLines.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      processedLines.push(`<li>${numberedMatch[2]}</li>`);
      continue;
    }

    // Check for bullet list (- item, but not * which might be italic)
    const bulletMatch = line.match(/^-\s+(.+)$/);
    if (bulletMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) processedLines.push(`</${listType}>`);
        processedLines.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      processedLines.push(`<li>${bulletMatch[1]}</li>`);
      continue;
    }

    // Regular line - close list if we were in one
    if (inList) {
      processedLines.push(`</${listType}>`);
      inList = false;
      listType = null;
    }

    // Preserve empty lines as breaks
    if (line.trim() === '') {
      processedLines.push('<br>');
    } else {
      processedLines.push(line);
    }
  }

  // Close any open list
  if (inList) {
    processedLines.push(`</${listType}>`);
  }

  html = processedLines.join('\n');

  // Convert remaining line breaks to <br>
  html = html.replace(/\n/g, '<br>');

  return html;
}

/**
 * Update a streaming message with new content.
 * @param {HTMLElement} messageBody - The message body element to update
 * @param {string} newContent - The new content to append or set
 * @param {boolean} append - Whether to append (true) or replace (false) content
 */
function updateStreamingMessage(messageBody, newContent, append = true) {
  if (!messageBody) return;

  if (append) {
    // For streaming, we need to accumulate the full text and re-render
    const currentText = messageBody.textContent || '';
    const fullText = currentText + newContent;
    messageBody.innerHTML = markdownToHTML(fullText);
  } else {
    messageBody.innerHTML = markdownToHTML(newContent);
  }

  // Auto-scroll to bottom
  if (chatMessagesEl) {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
}

/**
 * Call Task A orchestrator to process user request
 * This replaces the direct LLM call with the full Task A + Task B flow
 * @param {string} userText
 * @param {boolean} includeContext
 * @param {Function} onProgress - Optional callback for progress updates
 * @param {AbortSignal} abortSignal - Signal to cancel the request
 * @param {Function} onInteraction - Optional callback for user interactions (question) => Promise<answer>
 * @param {Function} onStreamChunk - Optional callback for streaming answer chunks
 * @returns {Promise<string>}
 */
async function callLLMAPI(userText, includeContext = false, onProgress = null, abortSignal = null, onInteraction = null, onStreamChunk = null) {
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
    const result = await processRequest(context, userText, onProgress, abortSignal, conversationHistory, onInteraction, onStreamChunk);
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
      // Sequential execution completed - show message only
      console.log('[callLLMAPI] Returning execution result');
      return result.message;
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
  let streamingMessageEl = null; // For streaming question answers
  let isPageFrozen = false; // Track if we've frozen the page

  try {
    // Create a callback for streaming answer chunks (for questions)
    const onStreamChunk = (chunk) => {
      // Check if request was aborted
      if (abortSignal.aborted) {
        return;
      }

      // Freeze page when actions start (first time onProgress is called)
      if (!isPageFrozen) {
        setPageFrozen(true);
        isPageFrozen = true;
      }

      // Remove "Thinking..." message if still there
      if (chatMessagesEl && chatMessagesEl.lastChild) {
        const lastMsg = chatMessagesEl.lastChild.querySelector('.message__body');
        if (lastMsg && lastMsg.textContent === "Thinking...") {
          chatMessagesEl.removeChild(chatMessagesEl.lastChild);
        }
      }

      // Create streaming message if it doesn't exist
      if (!streamingMessageEl) {
        const streamingMsg = createStreamingMessage("assistant");
        if (streamingMsg) {
          streamingMessageEl = streamingMsg.body;
        }
      }

      // Update streaming message with new chunk
      if (streamingMessageEl) {
        updateStreamingMessage(streamingMessageEl, chunk, true);
      }
    };

    // Create a callback for progress updates
    const onProgress = (taskList, currentStep, totalSteps, status) => {
      // Check if request was aborted
      if (abortSignal.aborted) {
        return;
      }

      // Freeze page when actions start (first time onProgress is called)
      if (!isPageFrozen) {
        setPageFrozen(true);
        isPageFrozen = true;
      }

      // Remove "Thinking..." message if still there
      if (chatMessagesEl && chatMessagesEl.lastChild) {
        const lastMsg = chatMessagesEl.lastChild.querySelector('.message__body');
        if (lastMsg && lastMsg.textContent === "Thinking...") {
          chatMessagesEl.removeChild(chatMessagesEl.lastChild);
        }
      }

      // Create progress message if it doesn't exist
      if (!progressMessageEl) {
        // Create wrapper for message and copy icon
        const progressWrapper = document.createElement("div");
        progressWrapper.className = "message-wrapper";
        
        progressContainer = document.createElement("div");
        progressContainer.className = "message message--assistant bg-white text-slate-800 border border-slate-200";
        progressMessageEl = document.createElement("div");
        progressMessageEl.className = "message__body";
        progressContainer.appendChild(progressMessageEl);
        
        // Add message to wrapper
        progressWrapper.appendChild(progressContainer);
        
        // Add icons outside message border (at the end of message)
        // Progress messages are assistant messages, so no edit icon
        const iconsWrapper = createMessageIcons(progressContainer, progressMessageEl, "assistant", null);
        progressWrapper.appendChild(iconsWrapper);
        
        chatMessagesEl.appendChild(progressWrapper);
        chatMessagesEl.appendChild(progressContainer);
      }

      // Update the message with the current task list
      const header = `Executing actions (${currentStep}/${totalSteps})...\n\n`;
      progressMessageEl.textContent = header + taskList;

      // Auto-scroll to bottom
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    };

    // Create a callback for user interactions (asking questions during execution)
    const onInteraction = async (question) => {
      console.log('[handleChatSubmit] onInteraction called with question:', question);

      // Temporarily unfreeze the page so user can see the question
      if (isPageFrozen) {
        await setPageFrozen(false);
      }

      // Show the question as an assistant message
      appendMessage("assistant", question);

      // Wait for user's response by returning a Promise
      return new Promise((resolve) => {
        // Create a one-time event handler for the next form submission
        const handleInteractionResponse = async (event) => {
          event.preventDefault();
          event.stopPropagation();

          if (!chatInputEl) {
            resolve('');
            return;
          }

          const response = chatInputEl.value.trim();
          if (!response) {
            return; // Don't accept empty responses
          }

          console.log('[handleChatSubmit] User response:', response);

          // Show user's response in chat
          appendMessage("user", response);

          // Clear input
          chatInputEl.value = "";
          autoResizeTextArea(chatInputEl);

          // Remove the temporary event listener
          chatFormEl.removeEventListener("submit", handleInteractionResponse);

          // Restore the original submit handler
          chatFormEl.addEventListener("submit", handleChatSubmit);

          // Re-freeze the page before continuing execution
          if (!isPageFrozen) {
            await setPageFrozen(true);
            isPageFrozen = true;
          }

          // Resolve the promise with the user's response
          resolve(response);
        };

        // Remove the normal submit handler temporarily
        chatFormEl.removeEventListener("submit", handleChatSubmit);

        // Add the interaction response handler
        chatFormEl.addEventListener("submit", handleInteractionResponse);
      });
    };

    reply = await callLLMAPI(value, includeContext, onProgress, abortSignal, onInteraction);
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
        progressMessageEl.textContent = "Don't stop me nowww, Cause Im having a good time, having a good time";
        // Save cancellation message to memory
        if (memoryManager) {
          memoryManager.addMessage("assistant", "Don't stop me nowww, Cause Im having a good time, having a good time").catch(console.error);
        }
      } else {
        appendMessage("assistant", "Don't stop me nowww, Cause Im having a good time, having a good time");
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

  // If we only showed "Thinking..." and no progress/streaming, remove it
  if (!progressMessageEl && !streamingMessageEl && chatMessagesEl && chatMessagesEl.lastChild) {
    const lastMsg = chatMessagesEl.lastChild.querySelector('.message__body');
    if (lastMsg && lastMsg.textContent === "Thinking...") {
      chatMessagesEl.removeChild(chatMessagesEl.lastChild);
    }
  }

  // If we have a progress message, update it with the final result
  if (progressMessageEl && reply && reply.trim()) {
    progressMessageEl.textContent = reply;
    // Save the final reply to memory
    if (memoryManager) {
      memoryManager.addMessage("assistant", reply).catch(error => {
        console.error('[handleChatSubmit] Failed to save assistant reply to memory:', error);
      });
    }
  } else if (streamingMessageEl) {
    // Streaming message already updated, nothing to do
    // The reply contains the full message but it's already displayed
    // Save the streaming reply to memory
    if (memoryManager && reply && reply.trim()) {
      memoryManager.addMessage("assistant", reply).catch(error => {
        console.error('[handleChatSubmit] Failed to save streaming reply to memory:', error);
      });
    }
  } else if (reply && reply.trim()) {
    // Only append new message if we didn't have progress updates or streaming
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
  if (chatMessagesEl) {
    chatMessagesEl.innerHTML = "";
  }
  if (chatInputEl) {
    chatInputEl.value = "";
    autoResizeTextArea(chatInputEl);
  }

  // Show welcome message (and save to memory)
  appendMessage(
    "assistant",
    "Hi, I'm BrowseMate Chat living in your sidebar. Type a message below to start a conversation."
  );
}

/**
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
  }

  if (chatStopBtn) {
    chatStopBtn.addEventListener("click", handleStopClick);
  }

  if (memoryStatsBtn) {
    memoryStatsBtn.addEventListener("click", handleMemoryStatsClick);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChat);
} else {
  initChat();
}
