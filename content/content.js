// content.js - injected into pages
// Handles global spacebar transcription events

(function () {
  if (window.__browseMateChatButtonInjected) return;
  window.__browseMateChatButtonInjected = true;

  console.log("[BrowseMate] content script loaded");

  let spacebarPressed = false;
  let spacebarHandled = false;

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
   * Handle spacebar keydown - start transcription
   */
  function handleSpacebarDown(event) {
    // Only handle Spacebar key
    if (event.code !== 'Space') {
      return;
    }

    // Mark spacebar as pressed and handled
    if (!spacebarPressed) {
      spacebarPressed = true;
      spacebarHandled = true;
      
      // Prevent default spacebar behavior globally (scrolling, inserting spaces, etc.)
      // This allows transcription to take priority over all other behaviors
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      
      // Send message to sidebar to start transcription
      sendTranscriptionMessage('start');
      
      console.log('[BrowseMate] Spacebar pressed - starting transcription');
    } else if (spacebarHandled) {
      // Spacebar is still held, prevent default to avoid repeated spaces
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }

  /**
   * Handle spacebar keyup - stop transcription
   */
  function handleSpacebarUp(event) {
    // Only handle Spacebar key
    if (event.code !== 'Space') {
      return;
    }

    // If we handled the keydown, also handle keyup
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
      // Spacebar was pressed but we didn't handle it, just reset
      spacebarPressed = false;
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

