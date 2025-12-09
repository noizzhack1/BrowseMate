/**
 * Memory statistics display utilities
 * @module memory-stats
 */

/**
 * Format a timestamp for display
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Formatted time string
 */
function formatTime(timestamp) {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Handle Memory Stats button click - show conversation memory statistics
 * @param {Object} memoryManager - Memory manager instance
 */
export function handleMemoryStatsClick(memoryManager) {
  if (!memoryManager) {
    alert('Memory manager not initialized');
    return;
  }

  try {
    const stats = memoryManager.getStats();

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
 * Start a new chat session - clear memory and UI
 * @param {Object} memoryManager - Memory manager instance
 * @param {HTMLElement} chatMessagesEl - Chat messages container
 * @param {HTMLElement} chatInputEl - Chat input element
 * @param {Function} autoResizeTextArea - Function to resize textarea
 * @param {Function} appendMessage - Function to append messages
 */
export async function startNewChat(memoryManager, chatMessagesEl, chatInputEl, autoResizeTextArea, appendMessage) {
  console.log('[startNewChat] Starting new chat session');

  if (memoryManager) {
    try {
      await memoryManager.clearHistory();
      console.log('[startNewChat] Conversation history cleared from memory');
    } catch (error) {
      console.error('[startNewChat] Failed to clear memory:', error);
    }
  }

  if (chatMessagesEl) {
    chatMessagesEl.innerHTML = "";
  }

  if (chatInputEl) {
    chatInputEl.value = "";
    if (autoResizeTextArea) {
      autoResizeTextArea(chatInputEl);
    }
  }

  if (appendMessage) {
    appendMessage(
      "assistant",
      "Hi, I'm BrowseMate Chat living in your sidebar. Type a message below to start a conversation."
    );
  }
}
