/**
 * Markdown and text rendering utilities
 * @module markdown
 */

/**
 * Simple markdown to HTML converter for basic formatting
 * Handles bold, italic, lists, headers, inline code, and preserves structure
 * @param {string} markdown - Markdown text
 * @returns {string} HTML string
 */
export function markdownToHTML(markdown) {
  if (!markdown) return '';

  // Normalize line endings and trim
  let text = markdown.replace(/\r\n/g, '\n').trim();

  // Escape HTML first to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert **bold** to <strong>
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Convert *italic* or _italic_ to <em> (but not inside words)
  html = html.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '<em>$1</em>');
  html = html.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '<em>$1</em>');

  // Convert `inline code` to <code>
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Split into lines for list and header processing
  const lines = html.split('\n');
  const processedLines = [];
  let inList = false;
  let listType = null;
  let lastWasEmpty = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip multiple consecutive empty lines
    if (trimmedLine === '') {
      if (!lastWasEmpty && processedLines.length > 0) {
        // Only add break if not after a block element
        const lastLine = processedLines[processedLines.length - 1];
        if (!lastLine.endsWith('>')) {
          processedLines.push('<br>');
        }
      }
      lastWasEmpty = true;
      continue;
    }
    lastWasEmpty = false;

    // Check for headers (## Header)
    const h2Match = trimmedLine.match(/^##\s+(.+)$/);
    if (h2Match) {
      if (inList) {
        processedLines.push(`</${listType}>`);
        inList = false;
        listType = null;
      }
      processedLines.push(`<div style="font-weight:600;font-size:1.1em;margin:4px 0 2px;">${h2Match[1]}</div>`);
      continue;
    }

    const h3Match = trimmedLine.match(/^###\s+(.+)$/);
    if (h3Match) {
      if (inList) {
        processedLines.push(`</${listType}>`);
        inList = false;
        listType = null;
      }
      processedLines.push(`<div style="font-weight:600;margin:3px 0 1px;">${h3Match[1]}</div>`);
      continue;
    }

    // Check for numbered list (1. item)
    const numberedMatch = trimmedLine.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) processedLines.push(`</${listType}>`);
        processedLines.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      processedLines.push(`<li>${numberedMatch[2]}</li>`);
      continue;
    }

    // Check for bullet list (- item or * item)
    const bulletMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) processedLines.push(`</${listType}>`);
        processedLines.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      processedLines.push(`<li>${bulletMatch[1]}</li>`);
      continue;
    }

    // Check for indented list items (  - item)
    const indentedBulletMatch = line.match(/^\s{2,}[-*]\s+(.+)$/);
    if (indentedBulletMatch && inList) {
      processedLines.push(`<li style="margin-left:12px;">${indentedBulletMatch[1]}</li>`);
      continue;
    }

    // Regular line - close list if we were in one
    if (inList) {
      processedLines.push(`</${listType}>`);
      inList = false;
      listType = null;
    }

    // Regular text line - add as paragraph for proper spacing
    if (trimmedLine) {
      processedLines.push(`<p style="margin:4px 0;">${trimmedLine}</p>`);
    }
  }

  // Close any open list
  if (inList) {
    processedLines.push(`</${listType}>`);
  }

  // Join all processed lines
  html = processedLines.join('');

  return html;
}

/**
 * Convert plain text to HTML (escape HTML and convert newlines to <br>)
 * Use this for progress messages and other non-markdown content
 * @param {string} text - Plain text
 * @returns {string} HTML string
 */
export function textToHTML(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}
