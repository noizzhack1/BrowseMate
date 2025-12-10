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

    const parrotCursor = chrome.runtime.getURL('icons/logo_loader.gif'); // Resolve the extension URL for the parrot.gif cursor so it can be used safely inside the injected script

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (shouldFreeze, parrotCursor) => {
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

          const overlay = document.createElement("div"); // Create an overlay element that will visually freeze the page
          overlay.id = OVERLAY_ID; // Assign a stable ID so we can detect and remove this overlay later
          overlay.className = "commet-freeze-border"; // Apply the animated border class defined in the injected style element
          Object.assign(overlay.style, { // Apply layout and interaction styles to the overlay
            position: "fixed", // Pin overlay to the viewport so it covers the entire visible page
            inset: "0", // Stretch overlay from edge to edge
            zIndex: "2147483646", // Keep overlay above almost all page content while still below browser UI
            pointerEvents: "auto", // Ensure the overlay intercepts pointer events to effectively freeze the page
            cursor: "none", // Hide the native cursor so we can render a fake animated cursor instead
            background: "rgba(15, 23, 42, 0.03)" // Use a subtle tint to visually indicate the frozen state
          });

          const parrotCursorImg = document.createElement("img"); // Create an image element that will act as the fake animated cursor
          parrotCursorImg.src = parrotCursor; // Point the image to the extension-hosted parrot.gif URL
          parrotCursorImg.alt = ""; // Empty alt text since this is a purely decorative cursor element
          Object.assign(parrotCursorImg.style, { // Style the fake cursor image
            position: "fixed", // Position relative to the viewport so it follows the pointer accurately
            width: "70px", // Set an explicit width so the cursor size is predictable
            height: "70px", // Set an explicit height to match the visual cursor dimensions
            pointerEvents: "none", // Ensure the fake cursor does not block clicks or hovers
            zIndex: "2147483647", // Keep the fake cursor above the freeze overlay for visibility
            left: "0px", // Initial left position; will be updated on mousemove
            top: "0px", // Initial top position; will be updated on mousemove
            transform: "translate(-16px, -16px)" // Offset the image so its center (16,16) aligns roughly with the pointer hotspot
          });

          const handleParrotMove = (event) => { // Handler to move the fake cursor image with the mouse
            parrotCursorImg.style.left = event.clientX + "px"; // Align fake cursor horizontally with the current mouse X coordinate
            parrotCursorImg.style.top = event.clientY + "px"; // Align fake cursor vertically with the current mouse Y coordinate
          };

          overlay.addEventListener("mousemove", handleParrotMove); // Update the fake cursor position whenever the mouse moves over the overlay
          overlay.appendChild(parrotCursorImg); // Attach the fake cursor image to the overlay so it is rendered on top of the page

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
      args: [freeze, parrotCursor]
    });
  } catch (error) {
    console.error("Error freezing page:", error);
  }
}
