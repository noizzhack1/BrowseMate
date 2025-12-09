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
  } else if (message && message.type === 'BROWSEMATE_CLOSE_SETTINGS') {
    (async () => {
      try {
        const settingsUrl = chrome.runtime.getURL('settings/settings.html');
        const tabs = await chrome.tabs.query({ url: `${settingsUrl}*` });

        if (tabs && tabs.length > 0) {
          const idsToClose = tabs
            .map((t) => t.id)
            .filter((id) => typeof id === 'number');
          if (idsToClose.length > 0) {
            await chrome.tabs.remove(idsToClose);
          }
        }

        try {
          const stored = await chrome.storage.session.get('browsemate_last_active_tab');
          const targetId = stored.browsemate_last_active_tab;
          if (typeof targetId === 'number') {
            await chrome.tabs.update(targetId, { active: true });
          }
        } catch (restoreError) {
          console.warn('[background] Error restoring original tab focus after closing Settings:', restoreError);
        }
      } catch (error) {
        console.error('[background] Error handling BROWSEMATE_CLOSE_SETTINGS:', error);
      } finally {
        if (typeof sendResponse === 'function') {
          sendResponse();
        }
      }
    })();
    return true; // keep message channel open for async sendResponse
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
        const textsToTranslate = textNodes.map(node => node.textContent); // Don't trim - preserves spacing

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

    // Split texts into chunks for parallel translation
    const SEPARATOR = '|||BROWSEMATE_SEP|||';
    const CHUNK_SIZE = 100; // Process 100 text segments per chunk (increased for faster translation)
    const chunks = [];

    for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
      chunks.push(texts.slice(i, i + CHUNK_SIZE));
    }

    console.log('[background] Split into', chunks.length, 'chunks for parallel translation');
    console.log('[background] Chunk sizes:', chunks.map(c => c.length));
    console.log('[background] Total segments to translate:', texts.length);

    // Create LLM client once
    console.log('[background] Creating LLM client...');
    const llmClient = new LLMClient();
    console.log('[background] LLM client created, initializing...');
    await llmClient.initialize();
    console.log('[background] LLM client initialized successfully');

    console.log('[background] Starting incremental batch translation of', chunks.length, 'chunks...');
    console.log('[background] Translation start timestamp:', new Date().toISOString());

    // Translate chunks in batches and update page incrementally
    const BATCH_SIZE = 5;
    const allTranslatedChunks = [];
    let processedSegments = 0;

    for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
      const batchChunks = chunks.slice(batchStart, batchEnd);

      console.log(`[background] Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (chunks ${batchStart + 1}-${batchEnd})`);

      const batchPromises = batchChunks.map(async (chunk, batchIndex) => {
        const chunkIndex = batchStart + batchIndex;
        const batchedText = chunk.join(SEPARATOR);

        const translationPrompt = `You are a professional translator. Translate the following text segments to ${targetLanguage}. The segments are separated by "${SEPARATOR}". Return the translated segments in the same order, also separated by "${SEPARATOR}".

IMPORTANT:
- Preserve the exact number of segments
- Preserve leading and trailing whitespace in each segment (very important for spacing)
- Preserve HTML entities and special characters
- Keep numbers, URLs, and technical terms as-is unless they need translation
- Maintain the separator "${SEPARATOR}" between segments
- DO NOT add or remove spaces at the start or end of each segment

Text to translate:
${batchedText}

Return ONLY the translated text with the same separator, no additional explanation.`;

        console.log(`[background] Chunk ${chunkIndex + 1}/${chunks.length}: Translating ${chunk.length} segments (${batchedText.length} chars)`);

    const translatedText = await llmClient.generateCompletion(translationPrompt, {
      temperature: 0.3,
      maxTokens: 4096
    });

        console.log(`[background] Chunk ${chunkIndex + 1}/${chunks.length}: Received translation (${translatedText.length} chars)`);

        // Split and return translated segments (preserve whitespace)
        const translatedSegments = translatedText.split(SEPARATOR);

        return {
          chunkIndex,
          translatedSegments,
          startIndex: chunkIndex * CHUNK_SIZE
        };
      });

      // Wait for this batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Sort by chunk index to maintain order
      batchResults.sort((a, b) => a.chunkIndex - b.chunkIndex);

      // Apply translations incrementally to the page
      for (const result of batchResults) {
        allTranslatedChunks.push(result.translatedSegments);

        // Update page with this chunk's translations
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (translations, startIndex) => {
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

            // Apply translations for this chunk
            let updated = 0;
            for (let i = 0; i < translations.length; i++) {
              const nodeIndex = startIndex + i;
              if (nodeIndex < textNodes.length && translations[i]) {
                textNodes[nodeIndex].textContent = translations[i];
                updated++;
              }
            }

            console.log(`[translatePage] Incrementally updated ${updated} nodes (starting from index ${startIndex})`);
            return { updated: updated };
          },
          args: [result.translatedSegments, result.startIndex]
        });

        processedSegments += result.translatedSegments.length;
        console.log(`[background] Applied chunk ${result.chunkIndex + 1} translation (${processedSegments}/${texts.length} segments done)`);
      }

      console.log(`[background] Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} completed and applied`);
    }

    const translatedChunks = allTranslatedChunks;

    console.log('[background] Translation end timestamp:', new Date().toISOString());
    console.log('[background] All chunks translated successfully');

    // Flatten chunks back into single array for logging
    const translatedTexts = translatedChunks.flat();

    console.log('[background] Final stats: Translated', translatedTexts.length, 'segments');
    console.log('[background] Expected', texts.length, 'segments');

    if (translatedTexts.length !== texts.length) {
      console.warn('[background] Segment count mismatch! Original:', texts.length, 'Translated:', translatedTexts.length);
    }

    console.log('[background] Incremental translation complete - all chunks applied');

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
