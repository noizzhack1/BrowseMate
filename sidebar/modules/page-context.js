/**
 * Page context and interaction utilities
 * @module page-context
 */

/**
 * Get the current page context (URL, title, visible text, and HTML structure)
 * @returns {Promise<{url: string, title: string, text: string, html: string}>}
 */
export async function getPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

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

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const clone = document.body.cloneNode(true);
        const scripts = clone.querySelectorAll("script, style, noscript");
        scripts.forEach((el) => el.remove());

        const text = clone.innerText.replace(/\s+/g, " ").trim();
        const html = document.body.outerHTML;

        return {
          url: window.location.href,
          title: document.title,
          text,
          html
        };
      }
    });

    return results && results[0] && results[0].result
      ? results[0].result
      : { url: "", title: "", text: "", html: "" };
  } catch (error) {
    console.error("Error getting page context:", error);
    return { url: "", title: "", text: "", html: "" };
  }
}

/**
 * Freeze or unfreeze the current page with a blue border overlay
 * @param {boolean} freeze - Whether to freeze or unfreeze the page
 */
export async function setPageFrozen(freeze) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

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
