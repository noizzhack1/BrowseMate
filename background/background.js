// Import LLM client for translation
import { LLMClient } from '../lib/llm-client.js';

// Make the extension action (toolbar icon) open the side panel in one click.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// Messages:
// - "open-sidepanel" from content.js → opens the side panel.
// - "TRANSLATE_PAGE" from action-executor.js → translates the page content
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[background] Received message:', message);

  if (message === "open-sidepanel") {
    if (sender.tab && sender.tab.windowId !== undefined) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
    }
  } else if (message.type === "TRANSLATE_PAGE") {
    console.log('[background] TRANSLATE_PAGE message received');
    console.log('[background] Target language:', message.targetLanguage);
    console.log('[background] Tab ID from message:', message.tabId);
    console.log('[background] Sender tab:', sender.tab);

    // Get tab from message.tabId (sent by action-executor) or sender.tab (if sent from content script)
    const tabId = message.tabId || sender.tab?.id;
    console.log('[background] Using tab ID:', tabId);

    if (!tabId) {
      console.error('[background] No tab ID available!');
      sendResponse({ success: false, error: 'No tab ID available' });
      return true;
    }

    console.log('[background] Calling handleTranslatePageRequest...');
    handleTranslatePageRequest(message, tabId)
      .then(response => {
        console.log('[background] handleTranslatePageRequest resolved with:', response);
        sendResponse(response);
      })
      .catch(error => {
        console.error('[background] handleTranslatePageRequest error:', error);
        sendResponse({ success: false, error: error.message || 'Translation failed' });
      });
    return true; // Keep the message channel open for async response
  }
});

/**
 * Handle page translation request
 * @param {Object} message - Message containing targetLanguage
 * @param {number} tabId - Chrome tab ID
 */
async function handleTranslatePageRequest(message, tabId) {
  console.log('[background] handleTranslatePageRequest called');
  console.log('[background] Message:', JSON.stringify(message));
  console.log('[background] Tab ID:', tabId);

  try {
    const { targetLanguage } = message;

    console.log('[background] Translating page to:', targetLanguage);
    console.log('[background] Tab ID for executeScript:', tabId);

    // Get the page content
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // Get all text nodes in the document
        function getTextNodes(element) {
          const textNodes = [];
          const walk = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: (node) => {
                // Skip script, style, and empty text nodes
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
                  return NodeFilter.FILTER_REJECT;
                }
                if (node.textContent.trim() === '') {
                  return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
              }
            }
          );

          while (walk.nextNode()) {
            textNodes.push(walk.currentNode);
          }
          return textNodes;
        }

        const textNodes = getTextNodes(document.body);
        const textsToTranslate = textNodes.map(node => node.textContent.trim());

        return {
          texts: textsToTranslate,
          nodeCount: textNodes.length
        };
      }
    });

    const { texts, nodeCount } = result.result;
    console.log('[background] Found', nodeCount, 'text nodes to translate');
    console.log('[background] First 10 text samples:', texts.slice(0, 10));

    if (nodeCount === 0) {
      return {
        success: false,
        error: 'No text nodes found to translate'
      };
    }

    // Batch texts to translate (to avoid too many API calls)
    // Combine texts with a special separator that won't appear in normal text
    const SEPARATOR = '|||BROWSEMATE_SEP|||';
    const batchedText = texts.join(SEPARATOR);

    console.log('[background] Batched text length:', batchedText.length);
    console.log('[background] First 500 chars:', batchedText.substring(0, 500));
    console.log('[background] Total segments to translate:', texts.length);

    // Use the LLM to translate
    console.log('[background] Creating LLM client...');
    const llmClient = new LLMClient();
    console.log('[background] LLM client created, initializing...');
    await llmClient.initialize();
    console.log('[background] LLM client initialized successfully');

    console.log('[background] Calling LLM for translation...');
    console.log('[background] LLM request timestamp:', new Date().toISOString());

    const translationPrompt = `You are a professional translator. Translate the following text segments to ${targetLanguage}. The segments are separated by "${SEPARATOR}". Return the translated segments in the same order, also separated by "${SEPARATOR}".

IMPORTANT:
- Preserve the exact number of segments
- Preserve HTML entities and special characters
- Keep numbers, URLs, and technical terms as-is unless they need translation
- Maintain the separator "${SEPARATOR}" between segments

Text to translate:
${batchedText}

Return ONLY the translated text with the same separator, no additional explanation.`;

    console.log('[background] Prompt length:', translationPrompt.length);
    console.log('[background] Sending request to LLM...');

    const translatedText = await llmClient.generateCompletion(translationPrompt, {
      temperature: 0.3,
      maxTokens: 4096
    });

    console.log('[background] LLM response timestamp:', new Date().toISOString());
    console.log('[background] Translation received, length:', translatedText.length);
    console.log('[background] First 500 chars of translation:', translatedText.substring(0, 500));

    // Split the translated text back into segments
    const translatedTexts = translatedText.split(SEPARATOR).map(t => t.trim());

    console.log('[background] Translated', translatedTexts.length, 'segments');
    console.log('[background] Expected', texts.length, 'segments');
    console.log('[background] First 10 translated samples:', translatedTexts.slice(0, 10));

    if (translatedTexts.length !== texts.length) {
      console.warn('[background] Segment count mismatch! Original:', texts.length, 'Translated:', translatedTexts.length);
    }

    // Apply translations to the page
    console.log('[background] Starting to apply translations to page...');
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (translations) => {
        // Get text nodes again (in the same order)
        function getTextNodes(element) {
          const textNodes = [];
          const walk = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: (node) => {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
                  return NodeFilter.FILTER_REJECT;
                }
                if (node.textContent.trim() === '') {
                  return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
              }
            }
          );

          while (walk.nextNode()) {
            textNodes.push(walk.currentNode);
          }
          return textNodes;
        }

        const textNodes = getTextNodes(document.body);

        // Apply translations
        let updated = 0;
        for (let i = 0; i < Math.min(textNodes.length, translations.length); i++) {
          if (translations[i]) {
            console.log(`[translatePage] Updating node ${i}: "${textNodes[i].textContent.substring(0, 50)}" -> "${translations[i].substring(0, 50)}"`);
            textNodes[i].textContent = translations[i];
            updated++;
          }
        }

        console.log('[translatePage] Updated', updated, 'text nodes');
        return { updated: updated };
      },
      args: [translatedTexts]
    });

    console.log('[background] Translation complete');

    return {
      success: true,
      message: `Translated ${nodeCount} text segments to ${targetLanguage}`
    };

  } catch (error) {
    console.error('[background] Translation error:', error);
    return {
      success: false,
      error: error.message || 'Translation failed'
    };
  }
}
