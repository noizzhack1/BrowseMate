// BrowseMate Chat - simple in-panel chat UI with Task A orchestrator integration
// Import Task A orchestrator for processing user requests
import { processRequest } from '../lib/task-planner.js';
// Import LLMClient for backward compatibility and settings
import { LLMClient } from '../lib/llm-client.js';
// Import memory manager for conversation history
import { getMemoryManager } from '../lib/memory-manager.js';

// Import modular utilities
import { markdownToHTML, textToHTML } from './modules/markdown.js';
import {
  autoResizeTextArea,
  toggleSettings,
  toggleChatPanel as toggleChatPanelBase,
  handleStopClick as handleStopClickBase,
  updateButtonClasses as updateButtonClassesBase
} from './modules/ui-utils.js';
import { getPageContext, setPageFrozen } from './modules/page-context.js';
import {
  handleMemoryStatsClick as handleMemoryStatsClickBase,
  startNewChat as startNewChatBase
} from './modules/memory-stats.js';
// Import speech-to-text service
import { SpeechToTextService } from './modules/speech-to-text.js';

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
/** @type {HTMLButtonElement | null} */
const chatMicBtn = document.getElementById("chatMic");

// =========================
// Request cancellation state
// =========================

/** @type {AbortController | null} */
let currentAbortController = null;
/** @type {boolean} */
let isRequestInProgress = false;

/**
 * Update send/stop button classes based on request state
 * @param {boolean} isResponding - Whether a request is in progress
 */
function updateButtonClasses(isResponding) {
  updateButtonClassesBase(isResponding, chatStopBtn, chatSendBtn);
}

// =========================
// Memory manager instance
// =========================

/** @type {import('../lib/memory-manager.js').MemoryManager | null} */
let memoryManager = null;

// Page Context & Freeze helpers are imported from ./modules/page-context.js

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
  // Update button classes based on state
  updateButtonClasses(true);
  
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
        progressWrapper.className = "message-wrapper flex justify-start";
        
        progressContainer = document.createElement("div");
        progressContainer.className = "message message--assistant max-w-[80%] px-4 py-2 rounded-lg bg-white text-slate-800 border border-slate-200";
        progressMessageEl = document.createElement("div");
        progressMessageEl.className = "message__body text-sm";
        progressContainer.appendChild(progressMessageEl);
        
        progressWrapper.appendChild(progressContainer);
        
        const iconsWrapper = createMessageIcons(progressContainer, progressMessageEl, "assistant", null);
        progressWrapper.appendChild(iconsWrapper);
        
        chatMessagesEl.appendChild(progressWrapper);
      }
      
      const header = `Executing actions (${currentStep}/${totalSteps})...\n\n`;
      progressMessageEl.innerHTML = textToHTML(header + taskList);
      
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
        progressMessageEl.innerHTML = textToHTML("Don't stop me nowww, Cause Im having a good time, having a good time");
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
    // Update button classes based on state
    updateButtonClasses(false);
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
    progressMessageEl.innerHTML = markdownToHTML(reply);
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
  // Switch agent activity to minimal view after final response is rendered
  setAgentActivityMinimal(true);
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
      
      if (e.key === 'Enter' && !e.shiftKey) {
        // Enter (without Shift) saves and exits edit mode
        e.preventDefault();
        await saveAndResend();
      } else if (e.key === 'Escape') {
        // Escape cancels editing
        e.preventDefault();
        cancelEditing();
      }
      // Shift+Enter allows newlines in the editable content
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
  // Add flex and justify classes based on role (user: justify-end, assistant: justify-start)
  const wrapperFlexClass = role === 'user' ? 'flex justify-end' : 'flex justify-start';
  messageWrapper.className = `message-wrapper message-wrapper--${role} ${wrapperFlexClass}`;

  const container = document.createElement("div");
  // Add Tailwind classes based on message role
  const roleClasses = role === 'user'
    ? 'bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-500 text-white'
    : 'bg-white text-slate-800 border border-slate-200';
  container.className = `message message--${role} max-w-[80%] px-4 py-2 rounded-lg ${roleClasses}`;

  const body = document.createElement("div");
  body.className = "message__body text-sm";
  // Render markdown for assistant messages, plain text for user messages
  if (role === 'assistant') {
    body.innerHTML = markdownToHTML(text);
  } else {
  body.textContent = text;
  }

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
  // Add flex and justify classes based on role (user: justify-end, assistant: justify-start)
  const wrapperFlexClass = role === 'user' ? 'flex justify-end' : 'flex justify-start';
  messageWrapper.className = `message-wrapper message-wrapper--${role} ${wrapperFlexClass}`;
  
  const container = document.createElement("div");
  // Add Tailwind classes based on message role
  const roleClasses = role === 'user'
    ? 'bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-500 text-white'
    : 'bg-white text-slate-800 border border-slate-200';
  container.className = `message message--${role} max-w-[80%] px-4 py-2 rounded-lg ${roleClasses}`;

  const body = document.createElement("div");
  body.className = "message__body text-sm";
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

// markdownToHTML and textToHTML are imported from ./modules/markdown.js

/**
 * Update a streaming message with new content.
 * @param {HTMLElement} messageBody - The message body element to update
 * @param {string} newContent - The new content to append or set
 * @param {boolean} append - Whether to append (true) or replace (false) content
 */
function updateStreamingMessage(messageBody, newContent, append = true) {
  if (!messageBody) return;

  if (append) {
    // Use a data attribute to store raw text, since textContent loses markdown formatting
    const currentRawText = messageBody.dataset.rawText || '';
    const fullText = currentRawText + newContent;
    messageBody.dataset.rawText = fullText;
    messageBody.innerHTML = markdownToHTML(fullText);
  } else {
    messageBody.dataset.rawText = newContent;
    messageBody.innerHTML = markdownToHTML(newContent);
  }

  // Auto-scroll to bottom
  if (chatMessagesEl) {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
}

// Agent activity container reference (for grouping all thoughts and actions)
let agentActivityContainer = null;
let agentActivityBody = null;
let agentActivityStepCount = 0;

/**
 * Toggle minimal styling on the current agent activity container
 * @param {boolean} isMinimal
 */
function setAgentActivityMinimal(isMinimal) {
  if (!agentActivityContainer) return;
  agentActivityContainer.classList.toggle('agent-activity--minimal', isMinimal);
}

/**
 * Get or create the agent activity container
 * This is a single collapsible container that groups all thinking and actions
 * @returns {HTMLElement} The agent activity container
 */
function getOrCreateAgentActivityContainer() {
  if (agentActivityContainer && chatMessagesEl.contains(agentActivityContainer)) {
    return agentActivityContainer;
  }

  // Create wrapper
  const wrapper = document.createElement("div");
  wrapper.className = "message-wrapper message-wrapper--agent-activity flex justify-start";

  const container = document.createElement("div");
  container.className = "message message--agent-activity";

  // Create collapsible header
  const header = document.createElement("button");
  header.className = "agent-activity-header";
  header.setAttribute("aria-expanded", "false");
  header.innerHTML = `
    <span class="agent-activity-icon">🤖</span>
    <span class="agent-activity-label">Agent Activity</span>
    <span class="agent-activity-count">(0 steps)</span>
    <span class="agent-activity-arrow">▶</span>
  `;

  // Create collapsible body
  const body = document.createElement("div");
  body.className = "agent-activity-body collapsed";

  // Add click handler for toggle
  header.addEventListener("click", () => {
    const isExpanded = header.getAttribute("aria-expanded") === "true";
    header.setAttribute("aria-expanded", String(!isExpanded));

    const arrow = header.querySelector(".agent-activity-arrow");
    if (isExpanded) {
      body.classList.add("collapsed");
      body.classList.remove("expanded");
      arrow.classList.remove("expanded");
    } else {
      body.classList.remove("collapsed");
      body.classList.add("expanded");
      arrow.classList.add("expanded");
    }
  });

  container.appendChild(header);
  container.appendChild(body);
  wrapper.appendChild(container);

  chatMessagesEl.appendChild(wrapper);

  agentActivityContainer = wrapper;
  agentActivityBody = body;
  agentActivityStepCount = 0;
  setAgentActivityMinimal(false);

  return wrapper;
}

/**
 * Add a thinking entry to the agent activity container
 * @param {string} thought - The thought content
 */
function addThinkingToActivity(thought) {
  if (!chatMessagesEl) return;

  getOrCreateAgentActivityContainer();

  // Create thinking entry
  const entry = document.createElement("div");
  entry.className = "activity-entry activity-entry--thinking";
  entry.innerHTML = `
    <div class="activity-entry-header">
      <span class="activity-entry-icon">💭</span>
      <span class="activity-entry-label">Thinking</span>
    </div>
    <div class="activity-entry-content">${escapeHtml(thought)}</div>
  `;

  agentActivityBody.appendChild(entry);
  agentActivityStepCount++;
  updateActivityCount();

  // Auto-scroll
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

/**
 * Add an action entry to the agent activity container
 * @param {string} action - The action description
 * @param {string} status - Status: 'in_progress', 'success', 'failed'
 */
function addActionToActivity(action, status = 'in_progress') {
  if (!chatMessagesEl) return;

  getOrCreateAgentActivityContainer();

  // Status icons and classes
  let icon, statusClass;
  switch (status) {
    case 'success':
      icon = '✓';
      statusClass = 'activity-entry--success';
      break;
    case 'failed':
      icon = '✗';
      statusClass = 'activity-entry--failed';
      break;
    default:
      icon = '⚡';
      statusClass = 'activity-entry--in-progress';
  }

  // Create action entry
  const entry = document.createElement("div");
  entry.className = `activity-entry activity-entry--action ${statusClass}`;
  entry.innerHTML = `
    <div class="activity-entry-header">
      <span class="activity-entry-icon">${icon}</span>
      <span class="activity-entry-label">Action</span>
      ${status === 'in_progress' ? '<span class="activity-spinner">⟳</span>' : ''}
    </div>
    <div class="activity-entry-content">${escapeHtml(action)}</div>
  `;

  agentActivityBody.appendChild(entry);
  agentActivityStepCount++;
  updateActivityCount();

  // Auto-scroll
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  return entry;
}

/**
 * Update the last action entry with new status
 * @param {string} status - 'success' or 'failed'
 * @param {string} message - Optional updated message
 */
function updateLastActionInActivity(status, message = null) {
  if (!agentActivityBody) return;

  const actionEntries = agentActivityBody.querySelectorAll('.activity-entry--action');
  if (actionEntries.length === 0) return;

  const lastEntry = actionEntries[actionEntries.length - 1];

  // Remove spinner
  const spinner = lastEntry.querySelector('.activity-spinner');
  if (spinner) spinner.remove();

  // Update status class
  lastEntry.classList.remove('activity-entry--in-progress');
  if (status === 'success') {
    lastEntry.classList.add('activity-entry--success');
    const icon = lastEntry.querySelector('.activity-entry-icon');
    if (icon) icon.textContent = '✓';
  } else if (status === 'failed') {
    lastEntry.classList.add('activity-entry--failed');
    const icon = lastEntry.querySelector('.activity-entry-icon');
    if (icon) icon.textContent = '✗';
  }

  // Update message if provided
  if (message) {
    const content = lastEntry.querySelector('.activity-entry-content');
    if (content) content.textContent = message;
  }
}

/**
 * Update the step count in the header
 */
function updateActivityCount() {
  if (!agentActivityContainer) return;

  const countEl = agentActivityContainer.querySelector('.agent-activity-count');
  if (countEl) {
    countEl.textContent = `(${agentActivityStepCount} step${agentActivityStepCount !== 1 ? 's' : ''})`;
  }
}

/**
 * Reset the agent activity container for a new request
 */
function resetAgentActivity() {
  agentActivityContainer = null;
  agentActivityBody = null;
  agentActivityStepCount = 0;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
 * @param {Function} onThinking - Optional callback for agent thinking updates
 * @returns {Promise<string>}
 */
async function callLLMAPI(userText, includeContext = false, onProgress = null, abortSignal = null, onInteraction = null, onStreamChunk = null, onThinking = null) {
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
    const result = await processRequest(context, userText, onProgress, abortSignal, conversationHistory, onInteraction, onStreamChunk, onThinking);
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

  // Reset agent activity container for new request
  resetAgentActivity();

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
  // Update button classes based on state
  updateButtonClasses(true);

  // Show loading indicator (but don't freeze page yet - only freeze when actions start)
  // Don't save "Thinking..." to memory
  appendMessage("assistant", "Thinking...", false);

  let reply;
  let progressMessageEl = null;
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
    const onProgress = (taskList, _currentStep, _totalSteps, _status) => {
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

      // Check if this is an action progress update (starts with icon)
      if (typeof taskList === 'string' && (taskList.startsWith('⚡') || taskList.startsWith('✓') || taskList.startsWith('✗'))) {
        const actionText = taskList.substring(2).trim(); // Remove icon and space

        if (taskList.startsWith('⚡')) {
          // New action starting - add to activity container
          addActionToActivity(actionText, 'in_progress');
        } else if (taskList.startsWith('✓')) {
          // Action succeeded - update last action in activity
          updateLastActionInActivity('success', actionText);
        } else if (taskList.startsWith('✗')) {
          // Action failed - update last action in activity
          updateLastActionInActivity('failed', actionText);
        }
        return;
      }

      // For scratchpad display updates, we ignore them since we track individually
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

    // Create a callback for agent thinking updates (ReAct agent)
    const onThinking = (thought) => {
      // Check if request was aborted
      if (abortSignal.aborted) {
        return;
      }

      // Freeze page when agent starts thinking
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

      // Add thinking to the agent activity container
      addThinkingToActivity(thought);
    };

    reply = await callLLMAPI(value, includeContext, onProgress, abortSignal, onInteraction, onStreamChunk, onThinking);
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
        progressMessageEl.innerHTML = textToHTML("Don't stop me nowww, Cause Im having a good time, having a good time");
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
    // Update button classes based on state
    updateButtonClasses(false);
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
    progressMessageEl.innerHTML = markdownToHTML(reply);
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
  // Switch agent activity to minimal view after final response is rendered
  setAgentActivityMinimal(true);
}

// =========================
// Speech-to-text functionality
// =========================

// Create STT service instance
const sttService = new SpeechToTextService();

// Track recording state
let isRecording = false;
let currentTranscript = ''; // Store current transcript for finalization
let micPermissionErrorEl = null; // Persistent error message element near mic button
let shouldUpdateInput = true; // Flag to prevent callbacks from updating input after recording stops

/**
 * Replace "noise" with "noizz" in text (case-insensitive)
 * Uses word boundary to match whole words only
 * @param {string} text - The text to process
 * @returns {string} The text with "noise" replaced by "noizz"
 */
function replaceNoiseWithNoizz(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  // Use regex with word boundary (\b) to match whole words only
  // 'gi' flags: g = global (all occurrences), i = case-insensitive
  return text.replace(/\bnoise\b/gi, 'noizz');
}

/**
 * Show error message in UI (non-intrusive toast notification)
 * @param {string} message - Error message to display
 */
function showSTTError(message) {
  // Remove any existing error messages first
  const existingErrors = document.querySelectorAll('.stt-error-message');
  existingErrors.forEach(el => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  });

  // Create a temporary error message element (non-intrusive toast)
  const errorEl = document.createElement('div');
  errorEl.className = 'stt-error-message';
  errorEl.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #dc2626; color: white; padding: 12px 16px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 10000; font-size: 14px; max-width: 300px; animation: slideIn 0.3s ease-out;';
  errorEl.textContent = message;
  
  // Add slide-in animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  if (!document.head.querySelector('style[data-stt-error]')) {
    style.setAttribute('data-stt-error', 'true');
    document.head.appendChild(style);
  }
  
  document.body.appendChild(errorEl);
  
  // Remove after 5 seconds with fade-out
  setTimeout(() => {
    if (errorEl.parentNode) {
      errorEl.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
      errorEl.style.opacity = '0';
      errorEl.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (errorEl.parentNode) {
          errorEl.parentNode.removeChild(errorEl);
        }
      }, 300);
    }
  }, 5000);
}

/**
 * Update microphone button visual state
 * @param {boolean} recording - Whether currently recording
 */
function updateMicButtonState(recording) {
  if (!chatMicBtn) return;
  
  if (recording) {
    // Recording state - add pulsing animation class
    chatMicBtn.classList.add('recording');
    chatMicBtn.setAttribute('aria-label', 'Stop voice input');
    chatMicBtn.title = 'Stop voice input';
  } else {
    // Idle state - remove recording class
    chatMicBtn.classList.remove('recording');
    chatMicBtn.setAttribute('aria-label', 'Start voice input');
    chatMicBtn.title = 'Start voice input';
  }
}

/**
 * Open Chrome microphone settings page
 * Attempts to open Chrome's microphone settings using chrome.tabs API
 * Falls back to showing instructions if direct opening is not possible
 */
function openMicrophoneSettings() {
  // Try to open Chrome's microphone settings page using chrome.tabs API
  // Chrome extensions with "tabs" permission can open chrome:// URLs
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    // Use chrome.tabs.create to open settings in a new tab
    chrome.tabs.create({
      url: 'chrome://settings/content/microphone'
    }, (tab) => {
      // Check if tab creation was successful
      if (chrome.runtime.lastError) {
        console.warn('[openMicrophoneSettings] Could not open Chrome settings directly:', chrome.runtime.lastError.message);
        // Show instructions as fallback
        showSTTError('Please go to Chrome Settings > Privacy and security > Site settings > Microphone to enable access.');
      } else {
        console.log('[openMicrophoneSettings] Opened Chrome microphone settings');
      }
    });
  } else {
    // Chrome API not available - show instructions
    console.warn('[openMicrophoneSettings] Chrome tabs API not available');
    showSTTError('Please go to Chrome Settings > Privacy and security > Site settings > Microphone to enable access.');
  }
}

/**
 * Show persistent error message near microphone button with link to settings
 * @param {string} message - Error message to display
 */
function showMicPermissionError(message) {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    console.log("microphone allowed");
  }).catch(error => {
    console.error('[SpeechToTextService] Failed to get microphone permission:', error);
    this.permissionState = null;
    return 'prompt';
  });
  // Remove existing error message if any
  hideMicPermissionError();
  
  if (!chatMicBtn) return;
  
  // Create error message container
  micPermissionErrorEl = document.createElement('div');
  micPermissionErrorEl.className = 'mic-permission-error';
  micPermissionErrorEl.style.cssText = 'position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); margin-bottom: 8px; background: #dc2626; color: white; padding: 10px 14px; border-radius: 6px; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); z-index: 1000; pointer-events: auto; max-width: 250px; text-align: center;';
  
  // Create message text
  const messageText = document.createElement('div');
  messageText.style.cssText = 'margin-bottom: 8px; line-height: 1.4;';
  messageText.textContent = message || 'Please allow microphone access in your browser settings.';
  
  // Create clickable link/button to open settings
  const settingsLink = document.createElement('button');
  settingsLink.textContent = 'Click here to open settings';
  settingsLink.style.cssText = 'background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.3); color: white; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 500; transition: background 0.2s; width: 100%;';
  settingsLink.addEventListener('mouseenter', () => {
    settingsLink.style.background = 'rgba(255, 255, 255, 0.3)';
  });
  settingsLink.addEventListener('mouseleave', () => {
    settingsLink.style.background = 'rgba(255, 255, 255, 0.2)';
  });
  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMicrophoneSettings();
  });
  
  // Assemble error message
  micPermissionErrorEl.appendChild(messageText);
  micPermissionErrorEl.appendChild(settingsLink);
  
  // Position relative to mic button
  const micBtnParent = chatMicBtn.parentElement;
  if (micBtnParent) {
    // Ensure parent has relative positioning
    const parentPosition = window.getComputedStyle(micBtnParent).position;
    if (parentPosition === 'static') {
      micBtnParent.style.position = 'relative';
    }
    
    micBtnParent.appendChild(micPermissionErrorEl);
  }
}

/**
 * Hide persistent error message near microphone button
 */
function hideMicPermissionError() {
  if (micPermissionErrorEl && micPermissionErrorEl.parentNode) {
    micPermissionErrorEl.parentNode.removeChild(micPermissionErrorEl);
    micPermissionErrorEl = null;
  }
}

/**
 * Handle microphone button click - start/stop recording
 */
async function handleMicClick() {
  // Don't allow recording if a request is in progress
  if (isRequestInProgress) {
    showSTTError('Please wait for the current request to complete');
    return;
  }

  // Check if STT is supported
  if (!sttService.isAvailable()) {
    showSTTError('Speech recognition is not supported in this browser');
    return;
  }

  if (isRecording) {
    // Prevent callbacks from updating input after we stop
    shouldUpdateInput = false;
    
    // Stop recording
    sttService.stopRecording();
    isRecording = false;
    updateMicButtonState(false);
    
    // Re-enable send button
    if (chatSendBtn) {
      chatSendBtn.disabled = false;
    }
    
    // If we have a final transcript, send it
    if (currentTranscript.trim() && chatInputEl) {
      let textToSend = currentTranscript.trim();
      
      // Replace "noise" with "noizz" before sending
      textToSend = replaceNoiseWithNoizz(textToSend);
      
      // Clear input field BEFORE setting value to prevent race conditions
      chatInputEl.value = '';
      autoResizeTextArea(chatInputEl);
      
      // Set the value for form submission (with replacement applied)
      chatInputEl.value = textToSend;
      autoResizeTextArea(chatInputEl);
      
      // Auto-send the message (same as pressing Send button)
      if (chatFormEl && textToSend) {
        chatFormEl.requestSubmit();
        
        // Clear input field immediately after submission
        // handleChatSubmit will also clear it, but this ensures it's cleared
        if (chatInputEl) {
          chatInputEl.value = '';
          autoResizeTextArea(chatInputEl);
        }
      }
    } else {
      // No transcript to send, but clear input field anyway
      if (chatInputEl) {
        chatInputEl.value = '';
        autoResizeTextArea(chatInputEl);
      }
    }
    
    // Reset transcript
    currentTranscript = '';
  } else {
    // Start recording - check permission first
    try {
      // Check microphone permission status before attempting to record
      // This prevents unnecessary permission prompts if already denied
      const permissionStatus = await sttService.checkMicrophonePermission();
      
      // If permission is denied, show persistent message and don't try to request again
      if (permissionStatus === 'denied' || sttService.getPermissionState() === 'denied') {
        // showMicPermissionError('Please allow microphone access in your browser settings.');
        // Don't try to request permission again - user needs to enable it manually
        return;
      }
      
      // Clear any existing error message (permission might have been granted)
      hideMicPermissionError();
      
      // Clear input field
      if (chatInputEl) {
        chatInputEl.value = '';
        autoResizeTextArea(chatInputEl);
      }
      
      // Disable send button while recording
      if (chatSendBtn) {
        chatSendBtn.disabled = true;
      }
      
      // Reset transcript
      currentTranscript = '';
      
      // Reset flag to allow input updates
      shouldUpdateInput = true;
      
      // Start recording with callbacks
      await sttService.startRecording({
        // Live transcript updates - update input field as user speaks
        onTranscriptUpdate: (interimText) => {
          // Only update if recording is still active and we should update input
          if (shouldUpdateInput && isRecording && chatInputEl) {
            // Update input with current transcript + interim text
            chatInputEl.value = currentTranscript + interimText;
            autoResizeTextArea(chatInputEl);
          }
        },
        
        // Final transcript chunks - accumulate into currentTranscript
        onFinalTranscript: (finalText) => {
          // Only update if recording is still active and we should update input
          if (shouldUpdateInput && isRecording) {
            // Add final text to current transcript
            currentTranscript += finalText + ' ';
            
            // Update input field
            if (chatInputEl) {
              chatInputEl.value = currentTranscript.trim();
              autoResizeTextArea(chatInputEl);
            }
          }
        },
        
        // Error handling
        onError: (error) => {
          console.error('[handleMicClick] STT error:', error);
          
          // Check if it's a permission error
          if (error.message && error.message.includes('permission denied')) {
            // Show persistent error message near mic button with link to settings
            // showMicPermissionError('Please allow microphone access in your browser settings.');
            // Update permission state
            sttService.permissionState = 'denied';
          } else {
            // Show temporary toast for other errors
            showSTTError(error.message || 'Speech recognition error');
          }
          
          // Reset state
          shouldUpdateInput = false;
          isRecording = false;
          updateMicButtonState(false);
          
          // Re-enable send button
          if (chatSendBtn) {
            chatSendBtn.disabled = false;
          }
          
          // Clear input field on error
          if (chatInputEl) {
            chatInputEl.value = '';
            autoResizeTextArea(chatInputEl);
          }
        }
      });
      
      isRecording = true;
      updateMicButtonState(true);
      
    } catch (error) {
      console.error('[handleMicClick] Failed to start recording:', error);
      
      // Check if it's a permission error
      // This handles cases where getUserMedia throws NotAllowedError even after permission check
      if (error.message && (error.message.includes('permission denied') || error.message.includes('NotAllowedError'))) {
        // Mark permission as denied to prevent future requests
        sttService.permissionState = 'denied';
        // Show persistent error message near mic button with link to settings
        // showMicPermissionError('Please allow microphone access in your browser settings.');
      } else {
        // Show temporary toast for other errors
        showSTTError(error.message || 'Failed to start recording');
      }
      
      // Reset state
      isRecording = false;
      updateMicButtonState(false);
      
      // Re-enable send button
      if (chatSendBtn) {
        chatSendBtn.disabled = false;
      }
    }
  }
}

// autoResizeTextArea is imported from ./modules/ui-utils.js

/**
 * Toggle chat open/closed.
 */
function toggleChatPanel() {
  toggleChatPanelBase(sidebarRootEl, chatToggleBtn);
}

/**
 * Start a brand-new chat session:
 * - Clear all existing messages
 * - Clear conversation history from memory
 * - Reset the input field
 * - Show the initial welcome message again
 */
async function startNewChat() {
  await startNewChatBase(memoryManager, chatMessagesEl, chatInputEl, autoResizeTextArea, appendMessage);
}

/**
 * Handle Stop button click - cancel the current request
 */
function handleStopClick() {
  handleStopClickBase(currentAbortController, isRequestInProgress);
}

/**
 * Handle Memory Stats button click - show conversation memory statistics
 */
function handleMemoryStatsClick() {
  handleMemoryStatsClickBase(memoryManager);
}

// toggleSettings is imported from ./modules/ui-utils.js

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
    // Don't submit if currently recording (let STT handle it)
    chatInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        // Don't submit if recording - let STT handle stopping and sending
        if (isRecording) {
          return;
        }
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

  // Speech-to-text microphone button
  if (chatMicBtn) {
    chatMicBtn.addEventListener("click", handleMicClick);
    
    // Hide microphone button if STT is not supported
    if (!sttService.isAvailable()) {
      chatMicBtn.style.display = 'none';
    }
  }
  
  // =========================
  // Spacebar hold-to-record functionality
  // =========================
  
  let spacebarPressed = false;
  let spacebarRecordingStarted = false;
  let wasRecordingWhenSpacebarPressed = false;
  
  /**
   * Check if spacebar recording should be active
   * Returns false if user is typing in input field or if a request is in progress
   */
  function shouldActivateSpacebarRecording() {
    // Don't activate if user is typing in input field
    if (chatInputEl && document.activeElement === chatInputEl) {
      return false;
    }
    
    // Don't activate if a request is in progress
    if (isRequestInProgress) {
      return false;
    }
    
    // Don't activate if STT is not supported
    if (!sttService.isAvailable()) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Start recording on spacebar press
   */
  async function startSpacebarRecording() {
    // Check if we should activate
    if (!shouldActivateSpacebarRecording()) {
      return;
    }
    
    // If already recording, don't start another session
    // But allow spacebar to stop existing recording on release
    if (isRecording) {
      return;
    }
    
    try {
      // Check microphone permission status before attempting to record
      const permissionStatus = await sttService.checkMicrophonePermission();
      
      // If permission is denied, don't try to request again
      if (permissionStatus === 'denied' || sttService.getPermissionState() === 'denied') {
        return;
      }
      
      // Clear any existing error message
      hideMicPermissionError();
      
      // Clear input field
      if (chatInputEl) {
        chatInputEl.value = '';
        autoResizeTextArea(chatInputEl);
      }
      
      // Disable send button while recording
      if (chatSendBtn) {
        chatSendBtn.disabled = true;
      }
      
      // Reset transcript
      currentTranscript = '';
      
      // Reset flag to allow input updates
      shouldUpdateInput = true;
      
      // Start recording with callbacks
      await sttService.startRecording({
        // Live transcript updates - update input field as user speaks
        onTranscriptUpdate: (interimText) => {
          // Only update if recording is still active and we should update input
          if (shouldUpdateInput && isRecording && chatInputEl) {
            // Update input with current transcript + interim text
            chatInputEl.value = currentTranscript + interimText;
            autoResizeTextArea(chatInputEl);
          }
        },
        
        // Final transcript chunks - accumulate into currentTranscript
        onFinalTranscript: (finalText) => {
          // Only update if recording is still active and we should update input
          if (shouldUpdateInput && isRecording) {
            // Add final text to current transcript
            currentTranscript += finalText + ' ';
            
            // Update input field
            if (chatInputEl) {
              chatInputEl.value = currentTranscript.trim();
              autoResizeTextArea(chatInputEl);
            }
          }
        },
        
        // Error handling
        onError: (error) => {
          console.error('[startSpacebarRecording] STT error:', error);
          
          // Check if it's a permission error
          if (error.message && error.message.includes('permission denied')) {
            // Update permission state
            sttService.permissionState = 'denied';
          } else {
            // Show temporary toast for other errors (only if not a no-speech error)
            if (error.message && !error.message.includes('no-speech')) {
              showSTTError(error.message || 'Speech recognition error');
            }
          }
          
          // Reset state
          shouldUpdateInput = false;
          isRecording = false;
          spacebarRecordingStarted = false;
          updateMicButtonState(false);
          
          // Re-enable send button
          if (chatSendBtn) {
            chatSendBtn.disabled = false;
          }
          
          // Clear input field on error
          if (chatInputEl) {
            chatInputEl.value = '';
            autoResizeTextArea(chatInputEl);
          }
        }
      });
      
      isRecording = true;
      spacebarRecordingStarted = true;
      updateMicButtonState(true);
      
    } catch (error) {
      console.error('[startSpacebarRecording] Failed to start recording:', error);
      
      // Check if it's a permission error
      if (error.message && (error.message.includes('permission denied') || error.message.includes('NotAllowedError'))) {
        // Mark permission as denied to prevent future requests
        sttService.permissionState = 'denied';
      } else {
        // Show temporary toast for other errors
        showSTTError(error.message || 'Failed to start recording');
      }
      
      // Reset state
      isRecording = false;
      spacebarRecordingStarted = false;
      updateMicButtonState(false);
      
      // Re-enable send button
      if (chatSendBtn) {
        chatSendBtn.disabled = false;
      }
    }
  }
  
  /**
   * Stop recording and send text on spacebar release
   */
  function stopSpacebarRecordingAndSend() {
    // Only stop if we're currently recording
    if (!isRecording) {
      return;
    }
    
    try {
      // Prevent callbacks from updating input after we stop
      shouldUpdateInput = false;
      
      // Stop recording
      sttService.stopRecording();
      isRecording = false;
      const wasSpacebarRecording = spacebarRecordingStarted;
      spacebarRecordingStarted = false;
      updateMicButtonState(false);
      
      // Re-enable send button
      if (chatSendBtn) {
        chatSendBtn.disabled = false;
      }
      
      // Auto-send if:
      // 1. Recording was started via spacebar (spacebarRecordingStarted was true)
      // 2. OR recording was already active when spacebar was pressed (user wants to stop and send)
      if (wasSpacebarRecording || wasRecordingWhenSpacebarPressed) {
        let textToSend = '';
        
        if (currentTranscript.trim() && chatInputEl) {
          textToSend = currentTranscript.trim();
          // Replace "noise" with "noizz" before sending
          textToSend = replaceNoiseWithNoizz(textToSend);
          chatInputEl.value = textToSend;
          autoResizeTextArea(chatInputEl);
        } else if (chatInputEl && chatInputEl.value.trim()) {
          // If there's any text in the input (from interim results), use it
          textToSend = chatInputEl.value.trim();
          // Replace "noise" with "noizz" before sending
          textToSend = replaceNoiseWithNoizz(textToSend);
        }
        
        // Auto-send the message (same as pressing Send button)
        if (textToSend && chatFormEl) {
          // Clear input field BEFORE submission to prevent any race conditions
          if (chatInputEl) {
            chatInputEl.value = '';
            autoResizeTextArea(chatInputEl);
          }
          
          // Set the value temporarily for form submission (with replacement applied)
          chatInputEl.value = textToSend;
          chatFormEl.requestSubmit();
          
          // Clear input field immediately after submission
          // handleChatSubmit will also clear it, but this ensures it's cleared
          if (chatInputEl) {
            chatInputEl.value = '';
            autoResizeTextArea(chatInputEl);
          }
        } else {
          // No text to send, but clear input field anyway
          if (chatInputEl) {
            chatInputEl.value = '';
            autoResizeTextArea(chatInputEl);
          }
        }
      } else {
        // Not auto-sending, but clear input field anyway
        if (chatInputEl) {
          chatInputEl.value = '';
          autoResizeTextArea(chatInputEl);
        }
      }
      
      // Reset transcript
      currentTranscript = '';
      wasRecordingWhenSpacebarPressed = false;
      
    } catch (error) {
      console.error('[stopSpacebarRecordingAndSend] Error stopping recording:', error);
      
      // Ensure state is reset even on error
      shouldUpdateInput = false;
      isRecording = false;
      spacebarRecordingStarted = false;
      updateMicButtonState(false);
      wasRecordingWhenSpacebarPressed = false;
      
      // Re-enable send button
      if (chatSendBtn) {
        chatSendBtn.disabled = false;
      }
      
      // Clear input field on error
      if (chatInputEl) {
        chatInputEl.value = '';
        autoResizeTextArea(chatInputEl);
      }
      
      // Show error if it's not just a normal stop
      if (error.message && !error.message.includes('aborted')) {
        showSTTError('Error stopping transcription: ' + (error.message || 'Unknown error'));
      }
    }
  }
  
  // Add spacebar keydown event listener (for sidebar context)
  document.addEventListener('keydown', async (event) => {
    // Only handle Spacebar key
    if (event.code !== 'Space') {
      return;
    }
    
    // Prevent default spacebar behavior (scrolling) when recording
    // But only if we're not in an input field
    if (!chatInputEl || document.activeElement !== chatInputEl) {
      // Mark spacebar as pressed
      if (!spacebarPressed) {
        spacebarPressed = true;
        
        // Track if we were already recording when spacebar was pressed
        wasRecordingWhenSpacebarPressed = isRecording;
        
        // Start recording if not already recording
        if (!isRecording) {
          await startSpacebarRecording();
        }
      }
      
      // Prevent default to avoid scrolling when holding spacebar
      event.preventDefault();
    }
  });
  
  // Add spacebar keyup event listener (for sidebar context)
  document.addEventListener('keyup', (event) => {
    // Only handle Spacebar key
    if (event.code !== 'Space') {
      return;
    }
    
    // Reset spacebar pressed state
    if (spacebarPressed) {
      spacebarPressed = false;
      
      // Stop recording and send text
      stopSpacebarRecordingAndSend();
    }
  });
  
  // Listen for messages from content script (global page spacebar events)
  // Set up inside initChat so it has access to startSpacebarRecording and stopSpacebarRecordingAndSend
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'spacebar-transcription') {
      if (message.action === 'start') {
        // Start transcription when spacebar is pressed on the page
        if (!isRecording && !isRequestInProgress) {
          startSpacebarRecording().catch(error => {
            console.error('[BrowseMate] Error starting transcription from content script:', error);
          });
        }
        sendResponse({ success: true });
      } else if (message.action === 'stop') {
        // Stop transcription when spacebar is released on the page
        if (isRecording) {
          stopSpacebarRecordingAndSend();
        }
        sendResponse({ success: true });
      }
      return true; // Keep channel open for async response
    }
  });
  
  // Initialize button classes (not responding initially)
  updateButtonClasses(false);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChat);
} else {
  initChat();
}
