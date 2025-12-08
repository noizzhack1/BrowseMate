// BrowseMate Chat - simple in-panel chat UI with Task A orchestrator integration

// Import Task A orchestrator for processing user requests

import { processRequest } from '../lib/task-planner.js';

// Import LLMClient for backward compatibility and settings

import { LLMClient } from '../lib/llm-client.js';



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

const settingsBtn = document.getElementById("settingsBtn");

/** @type {HTMLInputElement | null} */

const includePageContextCheckbox = document.getElementById("includePageContext");

/** @type {HTMLDivElement | null} */

const sidebarRootEl = document.querySelector(".sidebar-root");



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

 * Call Task A orchestrator to process user request

 * This replaces the direct LLM call with the full Task A + Task B flow

 * @param {string} userText

 * @param {boolean} includeContext

 * @param {Function} onProgress - Optional callback for progress updates

 * @returns {Promise<string>}

 */

async function callLLMAPI(userText, includeContext = false, onProgress = null) {

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



    // Use Task A orchestrator to process the request

    // Task A will determine if it's a question or action and route accordingly

    console.log('[callLLMAPI] Calling processRequest...');

    const result = await processRequest(context, userText, onProgress);

    console.log('[callLLMAPI] ProcessRequest completed');

    console.log('[callLLMAPI] Result type:', result.type);

    console.log('[callLLMAPI] Result:', result);



    // Format the response based on result type

    if (result.type === 'answer') {

      // Direct answer to a question

      console.log('[callLLMAPI] Returning answer:', result.message);

      return result.message;

    } else if (result.type === 'action_result') {

      // Action was executed

      const status = result.success ? '' : '';

      const formattedMessage = `${status} ${result.message}`;

      console.log('[callLLMAPI] Returning action result:', formattedMessage);

      return formattedMessage;

    } else {

      // Unknown type

      console.warn('[callLLMAPI] Unknown result type:', result.type);

      return result.message || 'Unknown response type';

    }



  } catch (error) {

    console.error('[callLLMAPI] Task A processing error:', error);

    console.error('[callLLMAPI] Error message:', error.message);

    console.error('[callLLMAPI] Error stack:', error.stack);



    if (error.message && error.message.includes('token')) {

      return "Please configure your API token in Settings (click  button).";

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



  // Show user message

  appendMessage("user", value);



  // Clear input

  chatInputEl.value = "";

  autoResizeTextArea(chatInputEl);



  // Check if page context should be included

  const includeContext = includePageContextCheckbox?.checked || false;



  // Freeze page and show loading indicator

  await setPageFrozen(true);

  appendMessage("assistant", "Thinking...");



  let reply;

  let progressMessageEl = null;



  try {

    // Create a callback for progress updates

    const onProgress = (progress) => {

      // Remove "Thinking..." message if still there

      if (chatMessagesEl && chatMessagesEl.lastChild && chatMessagesEl.lastChild.textContent === "Thinking...") {

        chatMessagesEl.removeChild(chatMessagesEl.lastChild);

      }



      // Create or update progress message

      if (!progressMessageEl) {

        const container = document.createElement("div");

        container.className = "message message--assistant";

        const body = document.createElement("div");

        body.className = "message__body";

        container.appendChild(body);

        chatMessagesEl.appendChild(container);

        progressMessageEl = body;

      }



      // Format progress update

      const statusIcon = progress.status === 'completed' ? '' :

                        progress.status === 'failed' ? '' : '';

      const stepText = `Step ${progress.step}/${progress.total}: ${progress.description} ${statusIcon}`;



      // Update or append to progress message

      const lines = progressMessageEl.textContent.split('\n').filter(l => l.trim());



      if (progress.status === 'executing') {

        // Add new step

        lines.push(stepText);

      } else {

        // Update last line with completion status

        lines[lines.length - 1] = stepText;

      }



      progressMessageEl.textContent = lines.join('\n');

      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

    };



    reply = await callLLMAPI(value, includeContext, onProgress);

  } finally {

    // Always unfreeze, even if the API errors

    await setPageFrozen(false);

  }



  // If we only showed "Thinking..." and no progress, remove it

  if (!progressMessageEl && chatMessagesEl && chatMessagesEl.lastChild) {

    const lastMsg = chatMessagesEl.lastChild.querySelector('.message__body');

    if (lastMsg && lastMsg.textContent === "Thinking...") {

      chatMessagesEl.removeChild(chatMessagesEl.lastChild);

    }

  }



  // Show actual response (only if it's not empty and different from progress)

  if (reply && reply.trim()) {

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

 * Start a brand-new chat session:

 * - Clear all existing messages

 * - Reset the input field

 * - Show the initial welcome message again

 */

function startNewChat() {

  if (chatMessagesEl) {

    chatMessagesEl.innerHTML = "";

  }

  if (chatInputEl) {

    chatInputEl.value = "";

    autoResizeTextArea(chatInputEl);

  }



  appendMessage(

    "assistant",

    "Hi, Im BrowseMate Chat living in your sidebar. Type a message below to start a conversation."

  );

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

    "Hi, Im BrowseMate Chat living in your sidebar. Type a message below to start a conversation."

  );



  if (newChatBtn) {

    newChatBtn.addEventListener("click", startNewChat);

  }



  if (settingsBtn) {

    settingsBtn.addEventListener("click", toggleSettings);

  }

}



if (document.readyState === "loading") {

  document.addEventListener("DOMContentLoaded", initChat);

} else {

  initChat();

}

