/**
 * ===========================================
 * File: memory-manager.js
 * Purpose: Manages conversation history and memory for the chat
 * Stores messages in chrome.storage.local for persistence
 * ===========================================
 */

import { Logger } from '../utils/logger.js';

// Storage key for conversation history
const STORAGE_KEY = 'browsemate_conversation_history';

// Maximum number of messages to keep in memory (older messages will be removed)
const MAX_MESSAGES = 100;

// Maximum number of recent messages to include in LLM context
const CONTEXT_WINDOW = 10;

/**
 * Memory Manager class for handling conversation history
 */
export class MemoryManager {
  constructor() {
    this.messages = [];
    this.isInitialized = false;
  }

  /**
   * Initialize the memory manager by loading history from storage
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    Logger.info('[MemoryManager] Initializing memory manager...');

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      this.messages = result[STORAGE_KEY] || [];
      Logger.info(`[MemoryManager] Loaded ${this.messages.length} messages from storage`);
      this.isInitialized = true;
    } catch (error) {
      Logger.error('[MemoryManager] Failed to load conversation history:', error);
      this.messages = [];
      this.isInitialized = true;
    }
  }

  /**
   * Add a message to the conversation history
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content - Message content
   * @param {Object} metadata - Optional metadata (timestamp, page context, etc.)
   * @returns {Promise<void>}
   */
  async addMessage(role, content, metadata = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const message = {
      role,
      content,
      timestamp: Date.now(),
      ...metadata
    };

    this.messages.push(message);

    // Keep only the last MAX_MESSAGES
    if (this.messages.length > MAX_MESSAGES) {
      const removed = this.messages.length - MAX_MESSAGES;
      this.messages = this.messages.slice(-MAX_MESSAGES);
      Logger.info(`[MemoryManager] Trimmed ${removed} old messages, keeping last ${MAX_MESSAGES}`);
    }

    // Save to storage
    await this.save();
    Logger.debug(`[MemoryManager] Added ${role} message:`, content.substring(0, 100));
  }

  /**
   * Get recent conversation history for LLM context
   * @param {number} limit - Number of recent messages to retrieve (default: CONTEXT_WINDOW)
   * @returns {Array<{role: string, content: string}>} - Array of messages
   */
  getRecentMessages(limit = CONTEXT_WINDOW) {
    if (!this.isInitialized) {
      Logger.warn('[MemoryManager] Not initialized, returning empty history');
      return [];
    }

    const recent = this.messages.slice(-limit);
    Logger.debug(`[MemoryManager] Retrieved ${recent.length} recent messages`);

    // Return in OpenAI format (role + content)
    return recent.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  /**
   * Get all conversation messages
   * @returns {Array} - All messages
   */
  getAllMessages() {
    if (!this.isInitialized) {
      Logger.warn('[MemoryManager] Not initialized, returning empty history');
      return [];
    }

    return [...this.messages];
  }

  /**
   * Clear all conversation history
   * @returns {Promise<void>}
   */
  async clearHistory() {
    Logger.info('[MemoryManager] Clearing conversation history');
    this.messages = [];
    await this.save();
  }

  /**
   * Save current messages to chrome.storage.local
   * @returns {Promise<void>}
   */
  async save() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: this.messages });
      Logger.debug(`[MemoryManager] Saved ${this.messages.length} messages to storage`);
    } catch (error) {
      Logger.error('[MemoryManager] Failed to save conversation history:', error);
    }
  }

  /**
   * Get conversation summary for context
   * Returns a formatted string of recent conversation
   * @param {number} limit - Number of recent messages (default: 5)
   * @returns {string} - Formatted conversation summary
   */
  getConversationSummary(limit = 5) {
    if (!this.isInitialized || this.messages.length === 0) {
      return '';
    }

    const recent = this.messages.slice(-limit);
    let summary = 'Recent conversation:\n';

    recent.forEach(msg => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const content = msg.content.length > 200
        ? msg.content.substring(0, 200) + '...'
        : msg.content;
      summary += `${role}: ${content}\n`;
    });

    return summary;
  }

  /**
   * Get statistics about the conversation
   * @returns {Object} - Stats object
   */
  getStats() {
    return {
      totalMessages: this.messages.length,
      userMessages: this.messages.filter(m => m.role === 'user').length,
      assistantMessages: this.messages.filter(m => m.role === 'assistant').length,
      firstMessageTime: this.messages.length > 0 ? this.messages[0].timestamp : null,
      lastMessageTime: this.messages.length > 0 ? this.messages[this.messages.length - 1].timestamp : null
    };
  }
}

// Create singleton instance
let memoryManagerInstance = null;

/**
 * Get the singleton memory manager instance
 * @returns {MemoryManager}
 */
export function getMemoryManager() {
  if (!memoryManagerInstance) {
    memoryManagerInstance = new MemoryManager();
  }
  return memoryManagerInstance;
}
