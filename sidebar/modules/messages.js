/**
 * Message management utilities
 * @module messages
 */

import { markdownToHTML, textToHTML } from './markdown.js';

/**
 * Find the next assistant message wrapper after a given user message wrapper
 * @param {HTMLElement} userMessageWrapper - The user message wrapper element
 * @param {HTMLElement} chatMessagesEl - Chat messages container
 * @returns {HTMLElement | null}
 */
export function findNextAssistantMessage(userMessageWrapper, chatMessagesEl) {
  if (!userMessageWrapper || !chatMessagesEl) return null;

  const allWrappers = Array.from(chatMessagesEl.children);
  const currentIndex = allWrappers.indexOf(userMessageWrapper);

  if (currentIndex === -1) return null;

  for (let i = currentIndex + 1; i < allWrappers.length; i++) {
    const wrapper = allWrappers[i];
    if (wrapper.classList.contains('message-wrapper--assistant')) {
      return wrapper;
    }
    if (wrapper.classList.contains('message-wrapper--user')) {
      return null;
    }
  }

  return null;
}

/**
 * Find ALL assistant message wrappers after a given user message wrapper
 * @param {HTMLElement} userMessageWrapper - The user message wrapper element
 * @param {HTMLElement} chatMessagesEl - Chat messages container
 * @returns {HTMLElement[]}
 */
export function findAllAssistantMessagesAfter(userMessageWrapper, chatMessagesEl) {
  if (!userMessageWrapper || !chatMessagesEl) return [];

  const allWrappers = Array.from(chatMessagesEl.children);
  const currentIndex = allWrappers.indexOf(userMessageWrapper);

  if (currentIndex === -1) return [];

  const assistantWrappers = [];

  for (let i = currentIndex + 1; i < allWrappers.length; i++) {
    const wrapper = allWrappers[i];
    if (wrapper.classList.contains('message-wrapper--assistant')) {
      assistantWrappers.push(wrapper);
    } else if (wrapper.classList.contains('message-wrapper--user')) {
      break;
    }
  }

  return assistantWrappers;
}

/**
 * Find ALL message wrappers after a given message wrapper
 * @param {HTMLElement} messageWrapper - The message wrapper element
 * @param {HTMLElement} chatMessagesEl - Chat messages container
 * @returns {HTMLElement[]}
 */
export function findAllMessagesAfter(messageWrapper, chatMessagesEl) {
  if (!messageWrapper || !chatMessagesEl) return [];

  const allWrappers = Array.from(chatMessagesEl.children);
  const currentIndex = allWrappers.indexOf(messageWrapper);

  if (currentIndex === -1) return [];

  return allWrappers.slice(currentIndex + 1);
}

/**
 * Remove a message and its associated memory entry
 * @param {HTMLElement} messageWrapper - The message wrapper to remove
 * @param {string} role - The role of the message
 * @param {string} content - The content of the message
 * @param {Object} memoryManager - Memory manager instance
 */
export async function removeMessageAndMemory(messageWrapper, role, content, memoryManager) {
  if (messageWrapper && messageWrapper.parentNode) {
    messageWrapper.parentNode.removeChild(messageWrapper);
  }

  if (memoryManager && content) {
    try {
      const allMessages = memoryManager.getAllMessages();
      const index = allMessages.findIndex(msg =>
        msg.role === role && msg.content === content
      );
      if (index !== -1) {
        allMessages.splice(index, 1);
        await memoryManager.save();
        console.log(`[removeMessageAndMemory] Removed ${role} message from memory`);
      }
    } catch (error) {
      console.error('[removeMessageAndMemory] Failed to remove from memory:', error);
    }
  }
}

/**
 * Append a chat message bubble to the messages area
 * @param {string} role - 'user' or 'assistant'
 * @param {string} text - Message text
 * @param {HTMLElement} chatMessagesEl - Chat messages container
 * @param {Object} memoryManager - Memory manager instance (optional)
 * @param {Function} createMessageIconsFn - Function to create message icons
 * @param {boolean} saveToMemory - Whether to save to memory
 * @returns {HTMLElement} The message body element
 */
export function appendMessage(role, text, chatMessagesEl, memoryManager, createMessageIconsFn, saveToMemory = true) {
  if (!chatMessagesEl) return null;

  const messageWrapper = document.createElement("div");
  messageWrapper.className = `message-wrapper message-wrapper--${role}`;

  const container = document.createElement("div");
  const roleClasses = role === 'user'
    ? 'bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-500 text-white'
    : 'bg-white text-slate-800 border border-slate-200';
  container.className = `message message--${role} ${roleClasses}`;

  const body = document.createElement("div");
  body.className = "message__body";

  if (role === 'assistant') {
    body.innerHTML = markdownToHTML(text);
  } else {
    body.textContent = text;
  }

  container.appendChild(body);
  messageWrapper.appendChild(container);

  if (createMessageIconsFn) {
    const iconsWrapper = createMessageIconsFn(container, body, role, text);
    messageWrapper.appendChild(iconsWrapper);
  }

  chatMessagesEl.appendChild(messageWrapper);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  if (saveToMemory && memoryManager && text !== "Thinking...") {
    memoryManager.addMessage(role, text).catch(error => {
      console.error('[appendMessage] Failed to save message to memory:', error);
    });
  }

  return body;
}

/**
 * Create a streaming message element
 * @param {string} role - 'user' or 'assistant'
 * @param {HTMLElement} chatMessagesEl - Chat messages container
 * @param {Function} createMessageIconsFn - Function to create message icons
 * @returns {{container: HTMLElement, body: HTMLElement}}
 */
export function createStreamingMessage(role, chatMessagesEl, createMessageIconsFn) {
  const messageWrapper = document.createElement("div");
  messageWrapper.className = `message-wrapper message-wrapper--${role}`;

  const container = document.createElement("div");
  const roleClasses = role === 'user'
    ? 'bg-gradient-to-br from-purple-500 via-blue-500 to-cyan-500 text-white'
    : 'bg-white text-slate-800 border border-slate-200';
  container.className = `message message--${role} ${roleClasses}`;

  const body = document.createElement("div");
  body.className = "message__body";

  container.appendChild(body);
  messageWrapper.appendChild(container);

  if (createMessageIconsFn) {
    const iconsWrapper = createMessageIconsFn(container, body, role, null);
    messageWrapper.appendChild(iconsWrapper);
  }

  chatMessagesEl.appendChild(messageWrapper);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  return { container, body };
}

/**
 * Update a streaming message with new content
 * @param {HTMLElement} messageBody - The message body element
 * @param {string} newContent - New content to add
 * @param {boolean} append - Whether to append or replace
 * @param {HTMLElement} chatMessagesEl - Chat messages container for scrolling
 */
export function updateStreamingMessage(messageBody, newContent, append = true, chatMessagesEl = null) {
  if (!messageBody) return;

  if (append) {
    const currentText = messageBody.textContent || '';
    const fullText = currentText + newContent;
    messageBody.innerHTML = markdownToHTML(fullText);
  } else {
    messageBody.innerHTML = markdownToHTML(newContent);
  }

  if (chatMessagesEl) {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
}

/**
 * Load conversation history from memory and display it
 * @param {Object} memoryManager - Memory manager instance
 * @param {HTMLElement} chatMessagesEl - Chat messages container
 * @param {Function} createMessageIconsFn - Function to create message icons
 */
export async function loadConversationHistory(memoryManager, chatMessagesEl, createMessageIconsFn) {
  if (!memoryManager || !chatMessagesEl) {
    console.warn('[loadConversationHistory] Missing memoryManager or chatMessagesEl');
    return;
  }

  try {
    await memoryManager.load();
    const messages = memoryManager.getAllMessages();

    if (messages.length === 0) {
      appendMessage(
        "assistant",
        "Hi, I'm BrowseMate Chat living in your sidebar. Type a message below to start a conversation.",
        chatMessagesEl,
        memoryManager,
        createMessageIconsFn
      );
      return;
    }

    console.log(`[loadConversationHistory] Restoring ${messages.length} messages`);

    for (const msg of messages) {
      appendMessage(msg.role, msg.content, chatMessagesEl, null, createMessageIconsFn, false);
    }
  } catch (error) {
    console.error('[loadConversationHistory] Failed to load history:', error);
    appendMessage(
      "assistant",
      "Hi, I'm BrowseMate Chat living in your sidebar. Type a message below to start a conversation.",
      chatMessagesEl,
      memoryManager,
      createMessageIconsFn
    );
  }
}
