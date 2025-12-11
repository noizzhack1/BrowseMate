// content.js - injected into pages
// Handles global spacebar transcription events

(function () {
  if (window.__browseMateChatButtonInjected) return;
  window.__browseMateChatButtonInjected = true;

  console.log("[BrowseMate] content script loaded");

  let spacebarPressed = false;
  let spacebarHandled = false;
  let spacebarPressTimer = null;
  const SPACEBAR_LONG_PRESS_TIME = 1000; // 1 second in milliseconds

  /**
   * Send message to sidebar to start/stop transcription
   * @param {string} action - 'start' or 'stop'
   */
  function sendTranscriptionMessage(action) {
    try {
      chrome.runtime.sendMessage({
        type: 'spacebar-transcription',
        action: action,
        timestamp: Date.now()
      }, (response) => {
        if (chrome.runtime.lastError) {
          // Sidebar might not be open, that's okay
          console.log('[BrowseMate] Sidebar not available:', chrome.runtime.lastError.message);
        }
      });
    } catch (error) {
      console.error('[BrowseMate] Error sending transcription message:', error);
    }
  }

  /**
   * Handle spacebar keydown - start long press timer
   */
  function handleSpacebarDown(event) {
    // Only handle Spacebar key
    if (event.code !== 'Space') {
      return;
    }

    // Mark spacebar as pressed
    if (!spacebarPressed) {
      spacebarPressed = true;
      spacebarHandled = false; // Not handled yet, waiting for long press
      
      // Prevent default on initial press to prevent space insertion
      // We'll manually insert space if it turns out to be a short press
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      
      // Start timer for long press detection
      spacebarPressTimer = setTimeout(function() {
        // Long press detected - mark as handled and start transcription
        spacebarHandled = true;
        
        // Send message to sidebar to start transcription
        sendTranscriptionMessage('start');
        
        console.log('[BrowseMate] Spacebar long press detected - starting transcription');
      }, SPACEBAR_LONG_PRESS_TIME);
    } else if (spacebarHandled) {
      // Spacebar is still held after long press was detected, prevent default to avoid repeated spaces
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    } else {
      // Spacebar is still pressed but timer hasn't fired yet
      // Continue preventing default to avoid space insertion
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }

  /**
   * Handle spacebar keyup - stop transcription or allow normal behavior for short press
   */
  function handleSpacebarUp(event) {
    // Only handle Spacebar key
    if (event.code !== 'Space') {
      return;
    }

    // Clear the long press timer if spacebar is released before threshold
    if (spacebarPressTimer) {
      clearTimeout(spacebarPressTimer);
      spacebarPressTimer = null;
    }

    // If we handled the keydown (long press), also handle keyup
    if (spacebarPressed && spacebarHandled) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      
      // Reset state
      spacebarPressed = false;
      spacebarHandled = false;
      
      // Send message to sidebar to stop transcription and send text
      sendTranscriptionMessage('stop');
      
      console.log('[BrowseMate] Spacebar released - stopping transcription');
    } else if (spacebarPressed) {
      // Spacebar was pressed but released before long press threshold (short press)
      // Simulate a space keypress to restore normal behavior
      spacebarPressed = false;
      spacebarHandled = false;
      
      // Don't prevent default - allow the keyup to proceed normally
      // The space was already prevented in keydown, so we need to manually insert it
      // if the user is in an input field
      const activeElement = document.activeElement;
      if (activeElement && (
        activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' || 
        activeElement.isContentEditable
      )) {
        // Insert a space character at the cursor position
        if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
          const start = activeElement.selectionStart;
          const end = activeElement.selectionEnd;
          const value = activeElement.value;
          activeElement.value = value.substring(0, start) + ' ' + value.substring(end);
          activeElement.selectionStart = activeElement.selectionEnd = start + 1;
          // Trigger input event
          activeElement.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (activeElement.isContentEditable) {
          // For contentEditable elements
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(' ');
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }
      // For other cases (scrolling, etc.), the default behavior was prevented
      // which is acceptable for a short press that we intercepted
    }
  }

  // Add global event listeners with capture phase to intercept before other handlers
  // Use capture phase to ensure we get the event first
  document.addEventListener('keydown', handleSpacebarDown, true);
  document.addEventListener('keyup', handleSpacebarUp, true);
  
  // Also listen on window for better coverage
  window.addEventListener('keydown', handleSpacebarDown, true);
  window.addEventListener('keyup', handleSpacebarUp, true);

  console.log('[BrowseMate] Global spacebar transcription listeners registered');
})();

