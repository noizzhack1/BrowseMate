/**
 * ===========================================
 * File: context-extractor.js
 * Purpose: Extract interactive elements from HTML for LLM context
 *
 * This module parses HTML and identifies actionable elements (buttons, links,
 * inputs, forms, etc.) with their labels, creating a compact representation
 * that helps the LLM understand what actions are available on the page.
 * ===========================================
 */

import { Logger } from '../utils/logger.js';

/**
 * @typedef {Object} InteractiveElement
 * @property {number} id - Unique identifier for this element
 * @property {string} type - Element type (button, link, input, select, etc.)
 * @property {string} label - Human-readable label for the element
 * @property {string} selector - CSS selector to find this element
 * @property {string} [value] - Current value (for inputs)
 * @property {string} [placeholder] - Placeholder text (for inputs)
 * @property {string[]} [options] - Available options (for selects)
 * @property {boolean} [checked] - Checked state (for checkboxes/radios)
 * @property {boolean} [disabled] - Whether element is disabled
 * @property {string} [role] - ARIA role if present
 * @property {string} [href] - Link URL (for links)
 */

/**
 * @typedef {Object} ExtractedContext
 * @property {InteractiveElement[]} elements - All interactive elements
 * @property {Object} summary - Summary counts by type
 * @property {string} formatted - Pre-formatted string for LLM
 */

/**
 * Generate a unique CSS selector for an element
 * @param {Element} element - DOM element
 * @param {Document} doc - Document reference
 * @returns {string} CSS selector
 */
function generateSelector(element, doc) {
  // Priority 1: ID (most reliable)
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Priority 2: Name attribute (for form elements)
  if (element.name) {
    const tagName = element.tagName.toLowerCase();
    const selector = `${tagName}[name="${CSS.escape(element.name)}"]`;
    if (doc.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Priority 3: Unique data attributes
  for (const attr of element.attributes) {
    if (attr.name.startsWith('data-') && attr.value) {
      const selector = `[${attr.name}="${CSS.escape(attr.value)}"]`;
      if (doc.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }
  }

  // Priority 4: aria-label
  if (element.getAttribute('aria-label')) {
    const ariaLabel = element.getAttribute('aria-label');
    const tagName = element.tagName.toLowerCase();
    const selector = `${tagName}[aria-label="${CSS.escape(ariaLabel)}"]`;
    if (doc.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Priority 5: Unique class combination
  if (element.classList.length > 0) {
    const classes = Array.from(element.classList).slice(0, 3).join('.');
    const tagName = element.tagName.toLowerCase();
    const selector = `${tagName}.${classes}`;
    if (doc.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Priority 6: Text content for buttons/links (use contains)
  const textContent = element.textContent?.trim().slice(0, 50);
  if (textContent && ['BUTTON', 'A'].includes(element.tagName)) {
    return `text:${textContent}`;
  }

  // Priority 7: nth-child selector as fallback
  const tagName = element.tagName.toLowerCase();
  let index = 1;
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === element.tagName) index++;
    sibling = sibling.previousElementSibling;
  }

  const parent = element.parentElement;
  if (parent && parent.id) {
    return `#${CSS.escape(parent.id)} > ${tagName}:nth-of-type(${index})`;
  }

  return `${tagName}:nth-of-type(${index})`;
}

/**
 * Convert camelCase, snake_case, or kebab-case to human-readable text
 * @param {string} str - String to convert
 * @returns {string} Human-readable string
 */
function humanizeString(str) {
  if (!str) return '';
  return str
    .replace(/([A-Z])/g, ' $1') // camelCase
    .replace(/[_-]+/g, ' ')      // snake_case and kebab-case
    .replace(/\s+/g, ' ')        // collapse multiple spaces
    .trim()
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase()); // Capitalize first letter
}

/**
 * Extract a human-readable label for an element
 * @param {Element} element - DOM element
 * @param {Document} doc - Document reference
 * @returns {string} Human-readable label
 */
function extractLabel(element, doc) {
  const labels = [];

  // Check for associated label element
  if (element.id) {
    const labelEl = doc.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (labelEl) {
      labels.push(labelEl.textContent?.trim());
    }
  }

  // Check for wrapping label
  const parentLabel = element.closest('label');
  if (parentLabel) {
    const labelText = parentLabel.textContent?.trim();
    if (labelText && labelText !== element.value) {
      labels.push(labelText);
    }
  }

  // aria-label (highest priority for accessibility)
  if (element.getAttribute('aria-label')) {
    labels.push(element.getAttribute('aria-label'));
  }

  // aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = doc.getElementById(labelledBy);
    if (labelEl) {
      labels.push(labelEl.textContent?.trim());
    }
  }

  // aria-describedby (can provide context)
  const describedBy = element.getAttribute('aria-describedby');
  if (describedBy && labels.length === 0) {
    const descEl = doc.getElementById(describedBy);
    if (descEl) {
      labels.push(descEl.textContent?.trim());
    }
  }

  // title attribute
  if (element.title) {
    labels.push(element.title);
  }

  // placeholder (for inputs)
  if (element.placeholder) {
    labels.push(element.placeholder);
  }

  // data-testid - extract meaningful label (common in modern frameworks)
  const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id');
  if (testId && labels.length === 0) {
    // Convert testId to readable form: "submit-button" -> "Submit button"
    const humanized = humanizeString(testId);
    if (humanized.length > 2) {
      labels.push(humanized);
    }
  }

  // data-vc (Atlassian) - extract component name
  const vcAttr = element.getAttribute('data-vc');
  if (vcAttr && labels.length === 0) {
    const humanized = humanizeString(vcAttr);
    if (humanized.length > 2) {
      labels.push(humanized);
    }
  }

  // Text content (for buttons, links)
  const textContent = element.textContent?.trim();
  if (textContent && textContent.length < 100 && textContent.length > 0) {
    // Remove extra whitespace and newlines
    const cleanText = textContent.replace(/\s+/g, ' ').trim();
    if (cleanText.length > 0) {
      labels.push(cleanText);
    }
  }

  // Value (for submit buttons)
  if (element.value && element.type === 'submit') {
    labels.push(element.value);
  }

  // Alt text (for images)
  if (element.alt) {
    labels.push(element.alt);
  }

  // Check for nested img alt text or svg title
  if (labels.length === 0) {
    const img = element.querySelector('img[alt]');
    if (img && img.alt) {
      labels.push(img.alt);
    }
    const svgTitle = element.querySelector('svg title');
    if (svgTitle && svgTitle.textContent) {
      labels.push(svgTitle.textContent.trim());
    }
  }

  // Name attribute as fallback
  if (element.name && labels.length === 0) {
    labels.push(humanizeString(element.name));
  }

  // ID as last resort fallback
  if (element.id && labels.length === 0) {
    const humanized = humanizeString(element.id);
    if (humanized.length > 2) {
      labels.push(humanized);
    }
  }

  // Filter out empty and duplicate labels
  const uniqueLabels = [...new Set(labels.filter(l => l && l.length > 0))];

  return uniqueLabels[0] || element.tagName.toLowerCase();
}

/**
 * Check if an element is visible and not hidden
 * @param {Element} element - DOM element
 * @returns {boolean} Whether element is visible
 */
function isElementVisible(element) {
  // Check for hidden attribute
  if (element.hidden) return false;

  // Check for display:none or visibility:hidden via style attribute
  const style = element.getAttribute('style') || '';
  const styleLower = style.toLowerCase();
  if (styleLower.includes('display: none') || styleLower.includes('display:none')) return false;
  if (styleLower.includes('visibility: hidden') || styleLower.includes('visibility:hidden')) return false;
  if (styleLower.includes('opacity: 0') || styleLower.includes('opacity:0')) return false;

  // Check for aria-hidden (but allow if element has interactive role)
  const ariaHidden = element.getAttribute('aria-hidden');
  const role = element.getAttribute('role');
  const isInteractive = role && ['button', 'link', 'menuitem', 'tab', 'option', 'combobox'].includes(role);
  if (ariaHidden === 'true' && !isInteractive) return false;

  // Check for type="hidden"
  if (element.type === 'hidden') return false;

  // Check for disabled state (but still include in extraction, just mark as disabled)
  // Don't filter out disabled elements - they're still visible

  // Check for common hidden classes
  const classList = element.className || '';
  const classLower = classList.toLowerCase ? classList.toLowerCase() : '';
  if (classLower.includes('hidden') && !classLower.includes('unhidden')) {
    // But allow if it has aria-expanded or similar indicating it might be toggled
    if (!element.getAttribute('aria-expanded') && !element.getAttribute('aria-selected')) {
      return false;
    }
  }
  if (classLower.includes('sr-only') || classLower.includes('visually-hidden')) return false;

  // Check if element has zero dimensions (approximation without computed styles)
  // Be more lenient - many interactive elements use CSS transforms
  if (element.offsetWidth === 0 && element.offsetHeight === 0) {
    // Allow elements that might be positioned or have tabindex
    if (!element.getAttribute('tabindex') && !element.getAttribute('role')) return false;
  }

  // Check parent visibility (one level up only for performance)
  const parent = element.parentElement;
  if (parent) {
    const parentStyle = parent.getAttribute('style') || '';
    const parentStyleLower = parentStyle.toLowerCase();
    if (parentStyleLower.includes('display: none') || parentStyleLower.includes('display:none')) return false;
  }

  return true;
}

/**
 * Extract buttons from the document
 * @param {Document} doc - Document reference
 * @param {number} startId - Starting ID for elements
 * @returns {{elements: InteractiveElement[], nextId: number}}
 */
function extractButtons(doc, startId) {
  const elements = [];
  let id = startId;
  const seenSelectors = new Set();

  // Comprehensive button detection including Atlassian/Jira components
  // Includes ARIA roles, data attributes, and common UI framework patterns
  const buttonSelectors = [
    // Standard buttons
    'button',
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="reset"]',
    // ARIA roles for interactive elements
    '[role="button"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="option"]',
    '[role="treeitem"]',
    '[role="gridcell"]',
    // Atlassian/Jira specific patterns
    '[data-testid]',
    '[data-test-id]',
    '[data-vc]',
    '[data-ds--button]',
    '[data-ds--dropdown-item--container]',
    // Common UI framework class patterns
    '[class*="btn"]',
    '[class*="Button"]',
    '[class*="button"]',
    '[class*="clickable"]',
    '[class*="Clickable"]',
    '[class*="action"]',
    '[class*="Action"]',
    // Links that act as buttons
    'a[role="button"]',
    'a[role="menuitem"]',
    // Interactive div/span elements
    'div[tabindex="0"]',
    'span[tabindex="0"]',
    'div[tabindex="-1"][role]',
    'span[tabindex="-1"][role]',
    // Elements with explicit click handlers in attributes
    '[onclick]',
    '[ng-click]',
    '[\\@click]', // Vue shorthand attributes need escaping to be valid selectors
    '[v-on\\:click]'
  ];

  const buttons = doc.querySelectorAll(buttonSelectors.join(', '));
  Logger.debug(`[extractButtons] Found ${buttons.length} button elements`);

  for (const button of buttons) {
    if (!isElementVisible(button)) continue;

    const selector = generateSelector(button, doc);

    // Skip duplicates (same element matched by multiple selectors)
    if (seenSelectors.has(selector)) continue;
    seenSelectors.add(selector);

    const label = extractLabel(button, doc);

    // Skip elements with no meaningful label (likely decorative)
    if (!label || label.length < 1 || label === button.tagName.toLowerCase()) {
      Logger.debug(`[extractButtons] Skipping element with no label: ${selector}`);
      continue;
    }

    Logger.debug(`[extractButtons] Button [${id}]: "${label}" -> ${selector}`);

    elements.push({
      id: id++,
      type: 'button',
      label: label,
      selector: selector,
      disabled: button.disabled || button.getAttribute('aria-disabled') === 'true',
      role: button.getAttribute('role') || undefined
    });
  }

  Logger.info(`[extractButtons] Extracted ${elements.length} visible buttons`);
  return { elements, nextId: id };
}

/**
 * Extract links from the document (native and custom)
 * @param {Document} doc - Document reference
 * @param {number} startId - Starting ID
 * @returns {{elements: InteractiveElement[], nextId: number}}
 */
function extractLinks(doc, startId) {
  const elements = [];
  let id = startId;
  const seenSelectors = new Set();

  // Native links and elements with link role
  const linkSelectors = [
    'a[href]',
    'a[role="link"]',
    '[role="link"]',
    'a[onclick]',
    'a[ng-click]',
    // Navigation items
    '[role="navigation"] a',
    'nav a',
    // Breadcrumb links
    '[role="navigation"] [role="listitem"]',
    '[aria-label*="breadcrumb"] a',
    '[class*="breadcrumb"] a'
  ];

  const links = doc.querySelectorAll(linkSelectors.join(', '));
  Logger.debug(`[extractLinks] Found ${links.length} link elements`);

  for (const link of links) {
    if (!isElementVisible(link)) continue;

    const selector = generateSelector(link, doc);
    if (seenSelectors.has(selector)) continue;
    seenSelectors.add(selector);

    const label = extractLabel(link, doc);
    // Skip empty or very short links (likely icons)
    if (!label || label.length < 2) continue;

    // Skip javascript:void(0) and # links that have no meaning
    const href = link.getAttribute('href');
    const isNavigable = href && href !== '#' && !href.startsWith('javascript:');

    elements.push({
      id: id++,
      type: 'link',
      label: label,
      selector: selector,
      href: isNavigable ? href : undefined
    });
  }

  Logger.info(`[extractLinks] Extracted ${elements.length} visible links`);
  return { elements, nextId: id };
}

/**
 * Extract text inputs from the document
 * @param {Document} doc - Document reference
 * @param {number} startId - Starting ID
 * @returns {{elements: InteractiveElement[], nextId: number}}
 */
function extractTextInputs(doc, startId) {
  const elements = [];
  let id = startId;

  const textInputTypes = ['text', 'email', 'password', 'search', 'tel', 'url', 'number'];
  const inputs = doc.querySelectorAll(
    textInputTypes.map(t => `input[type="${t}"]`).join(', ') +
    ', input:not([type]), textarea'
  );
  Logger.debug(`[extractTextInputs] Found ${inputs.length} text input elements`);

  for (const input of inputs) {
    if (!isElementVisible(input)) continue;

    const inputType = input.type || 'text';
    const label = extractLabel(input, doc);
    Logger.debug(`[extractTextInputs] Input [${id}]: "${label}" (${inputType})`);

    elements.push({
      id: id++,
      type: input.tagName === 'TEXTAREA' ? 'textarea' : `input:${inputType}`,
      label: label,
      selector: generateSelector(input, doc),
      value: input.value || undefined,
      placeholder: input.placeholder || undefined,
      disabled: input.disabled
    });
  }

  Logger.info(`[extractTextInputs] Extracted ${elements.length} visible text inputs`);
  return { elements, nextId: id };
}

/**
 * Extract select dropdowns from the document (native and custom)
 * @param {Document} doc - Document reference
 * @param {number} startId - Starting ID
 * @returns {{elements: InteractiveElement[], nextId: number}}
 */
function extractSelects(doc, startId) {
  const elements = [];
  let id = startId;
  const seenSelectors = new Set();

  // Native select elements
  const selects = doc.querySelectorAll('select');
  Logger.debug(`[extractSelects] Found ${selects.length} native select elements`);

  for (const select of selects) {
    if (!isElementVisible(select)) continue;

    const selector = generateSelector(select, doc);
    if (seenSelectors.has(selector)) continue;
    seenSelectors.add(selector);

    // Get options (limit to first 10 for token efficiency)
    const options = Array.from(select.options)
      .slice(0, 10)
      .map(opt => opt.text?.trim() || opt.value)
      .filter(opt => opt);

    const label = extractLabel(select, doc);
    Logger.debug(`[extractSelects] Select [${id}]: "${label}" with ${options.length} options`);

    elements.push({
      id: id++,
      type: 'select',
      label: label,
      selector: selector,
      value: select.value || undefined,
      options: options,
      disabled: select.disabled
    });
  }

  // Custom dropdown elements (Jira, Atlassian, React Select, etc.)
  const customDropdownSelectors = [
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="menu"]',
    '[role="dropdown"]',
    '[data-ds--dropdown]',
    '[data-ds--select]',
    '[class*="dropdown"]',
    '[class*="Dropdown"]',
    '[class*="select"]',
    '[class*="Select"]',
    '[class*="combobox"]',
    '[class*="Combobox"]',
    '[aria-haspopup="listbox"]',
    '[aria-haspopup="menu"]',
    '[aria-haspopup="true"]'
  ];

  const customDropdowns = doc.querySelectorAll(customDropdownSelectors.join(', '));
  Logger.debug(`[extractSelects] Found ${customDropdowns.length} custom dropdown elements`);

  for (const dropdown of customDropdowns) {
    if (!isElementVisible(dropdown)) continue;

    const selector = generateSelector(dropdown, doc);
    if (seenSelectors.has(selector)) continue;
    seenSelectors.add(selector);

    const label = extractLabel(dropdown, doc);

    // Skip elements with no meaningful label
    if (!label || label.length < 1 || label === dropdown.tagName.toLowerCase()) {
      continue;
    }

    // Try to find options within the dropdown
    const optionElements = dropdown.querySelectorAll('[role="option"], [role="menuitem"], option, li');
    const options = Array.from(optionElements)
      .slice(0, 10)
      .map(opt => opt.textContent?.trim())
      .filter(opt => opt && opt.length > 0);

    Logger.debug(`[extractSelects] Custom dropdown [${id}]: "${label}" with ${options.length} options`);

    elements.push({
      id: id++,
      type: 'dropdown',
      label: label,
      selector: selector,
      options: options.length > 0 ? options : undefined,
      disabled: dropdown.getAttribute('aria-disabled') === 'true',
      role: dropdown.getAttribute('role') || undefined
    });
  }

  Logger.info(`[extractSelects] Extracted ${elements.length} visible selects/dropdowns`);
  return { elements, nextId: id };
}

/**
 * Extract checkboxes and radio buttons from the document
 * @param {Document} doc - Document reference
 * @param {number} startId - Starting ID
 * @returns {{elements: InteractiveElement[], nextId: number}}
 */
function extractCheckboxesAndRadios(doc, startId) {
  const elements = [];
  let id = startId;

  const inputs = doc.querySelectorAll('input[type="checkbox"], input[type="radio"]');
  Logger.debug(`[extractCheckboxesAndRadios] Found ${inputs.length} checkbox/radio elements`);

  for (const input of inputs) {
    if (!isElementVisible(input)) continue;

    const label = extractLabel(input, doc);
    Logger.debug(`[extractCheckboxesAndRadios] ${input.type} [${id}]: "${label}" (checked: ${input.checked})`);

    elements.push({
      id: id++,
      type: input.type,
      label: label,
      selector: generateSelector(input, doc),
      checked: input.checked,
      disabled: input.disabled
    });
  }

  Logger.info(`[extractCheckboxesAndRadios] Extracted ${elements.length} visible checkboxes/radios`);
  return { elements, nextId: id };
}

/**
 * Extract forms from the document (high-level form info)
 * @param {Document} doc - Document reference
 * @param {number} startId - Starting ID
 * @returns {{elements: InteractiveElement[], nextId: number}}
 */
function extractForms(doc, startId) {
  const elements = [];
  let id = startId;

  const forms = doc.querySelectorAll('form');
  Logger.debug(`[extractForms] Found ${forms.length} form elements`);

  for (const form of forms) {
    // Get form info
    const formFields = form.querySelectorAll('input, select, textarea');
    const visibleFields = Array.from(formFields).filter(isElementVisible).length;

    if (visibleFields === 0) continue;

    const action = form.getAttribute('action') || '';
    const method = form.getAttribute('method') || 'get';
    const label = form.name || form.id || `Form with ${visibleFields} fields`;
    Logger.debug(`[extractForms] Form [${id}]: "${label}" (${method.toUpperCase()} ${action})`);

    elements.push({
      id: id++,
      type: 'form',
      label: label,
      selector: generateSelector(form, doc),
      value: `${method.toUpperCase()} ${action}`.trim()
    });
  }

  Logger.info(`[extractForms] Extracted ${elements.length} visible forms`);
  return { elements, nextId: id };
}

/**
 * Extract all interactive elements from HTML string
 * @param {string} html - HTML string to parse
 * @param {Object} options - Extraction options
 * @param {number} [options.maxElements=100] - Maximum elements to extract
 * @param {boolean} [options.includeLinks=true] - Whether to include links
 * @param {boolean} [options.includeForms=true] - Whether to include form metadata
 * @returns {ExtractedContext} Extracted context
 */
export function extractHTMLContext(html, options = {}) {
  Logger.info('[extractHTMLContext] Starting HTML context extraction');
  Logger.debug(`[extractHTMLContext] HTML length: ${html?.length || 0} chars`);
  Logger.debug(`[extractHTMLContext] Options:`, options);

  const {
    maxElements = 100,
    includeLinks = true,
    includeForms = true
  } = options;

  // Parse HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  Logger.debug('[extractHTMLContext] HTML parsed successfully');

  // Remove script and style elements
  const removedElements = doc.querySelectorAll('script, style, noscript, svg, template');
  Logger.debug(`[extractHTMLContext] Removing ${removedElements.length} non-interactive elements`);
  removedElements.forEach(el => el.remove());

  let allElements = [];
  let nextId = 1;

  // Extract buttons first (most important for actions)
  const buttons = extractButtons(doc, nextId);
  allElements.push(...buttons.elements);
  nextId = buttons.nextId;

  // Extract text inputs
  const textInputs = extractTextInputs(doc, nextId);
  allElements.push(...textInputs.elements);
  nextId = textInputs.nextId;

  // Extract selects
  const selects = extractSelects(doc, nextId);
  allElements.push(...selects.elements);
  nextId = selects.nextId;

  // Extract checkboxes and radios
  const checkboxes = extractCheckboxesAndRadios(doc, nextId);
  allElements.push(...checkboxes.elements);
  nextId = checkboxes.nextId;

  // Extract links if enabled
  if (includeLinks) {
    const links = extractLinks(doc, nextId);
    allElements.push(...links.elements);
    nextId = links.nextId;
  } else {
    Logger.debug('[extractHTMLContext] Links extraction skipped (disabled)');
  }

  // Extract forms if enabled
  if (includeForms) {
    const forms = extractForms(doc, nextId);
    allElements.push(...forms.elements);
  } else {
    Logger.debug('[extractHTMLContext] Forms extraction skipped (disabled)');
  }

  // Limit total elements
  const originalCount = allElements.length;
  if (allElements.length > maxElements) {
    allElements = allElements.slice(0, maxElements);
    Logger.warn(`[extractHTMLContext] Truncated elements from ${originalCount} to ${maxElements}`);
  }

  // Generate summary
  const summary = allElements.reduce((acc, el) => {
    const type = el.type.split(':')[0]; // Normalize input types
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  Logger.info(`[extractHTMLContext] Extraction complete. Summary:`, summary);
  Logger.info(`[extractHTMLContext] Total elements extracted: ${allElements.length}`);

  // Format for LLM
  const formatted = formatContextForLLM(allElements, summary);
  Logger.debug(`[extractHTMLContext] Formatted output length: ${formatted.length} chars`);

  return {
    elements: allElements,
    summary,
    formatted
  };
}

/**
 * Format extracted context as a string for LLM consumption
 * @param {InteractiveElement[]} elements - Extracted elements
 * @param {Object} summary - Summary counts
 * @returns {string} Formatted string
 */
export function formatContextForLLM(elements, summary) {
  if (elements.length === 0) {
    return 'No interactive elements found on this page.';
  }

  const lines = [];

  // Add summary header
  const summaryParts = Object.entries(summary)
    .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
    .join(', ');
  lines.push(`Interactive Elements (${summaryParts}):`);
  lines.push('');

  // Group elements by type for better organization
  const grouped = {
    button: [],
    input: [],
    textarea: [],
    select: [],
    dropdown: [],
    checkbox: [],
    radio: [],
    link: [],
    form: []
  };

  for (const el of elements) {
    const baseType = el.type.split(':')[0];
    if (grouped[baseType]) {
      grouped[baseType].push(el);
    } else {
      // Put in input category for unknown input types
      grouped.input.push(el);
    }
  }

  // Format each group
  const formatElement = (el) => {
    let desc = `[${el.id}] ${el.label}`;

    if (el.disabled) desc += ' (disabled)';
    if (el.checked !== undefined) desc += el.checked ? ' [checked]' : ' [unchecked]';
    if (el.value && el.type !== 'form') desc += ` = "${el.value}"`;
    if (el.placeholder) desc += ` (placeholder: "${el.placeholder}")`;
    if (el.options) desc += ` options: [${el.options.slice(0, 5).join(', ')}${el.options.length > 5 ? '...' : ''}]`;
    if (el.href) desc += ` -> ${el.href}`;

    return desc;
  };

  // Output buttons
  if (grouped.button.length > 0) {
    lines.push('Buttons:');
    grouped.button.forEach(el => lines.push(`  ${formatElement(el)}`));
    lines.push('');
  }

  // Output inputs
  const allInputs = [...grouped.input, ...grouped.textarea];
  if (allInputs.length > 0) {
    lines.push('Input Fields:');
    allInputs.forEach(el => lines.push(`  ${formatElement(el)}`));
    lines.push('');
  }

  // Output selects and custom dropdowns
  const allDropdowns = [...grouped.select, ...grouped.dropdown];
  if (allDropdowns.length > 0) {
    lines.push('Dropdowns:');
    allDropdowns.forEach(el => lines.push(`  ${formatElement(el)}`));
    lines.push('');
  }

  // Output checkboxes and radios
  const toggles = [...grouped.checkbox, ...grouped.radio];
  if (toggles.length > 0) {
    lines.push('Checkboxes/Radios:');
    toggles.forEach(el => lines.push(`  ${formatElement(el)}`));
    lines.push('');
  }

  // Output links (limit to 20 most important)
  if (grouped.link.length > 0) {
    const importantLinks = grouped.link.slice(0, 20);
    lines.push(`Links (${importantLinks.length}${grouped.link.length > 20 ? ` of ${grouped.link.length}` : ''}):`);
    importantLinks.forEach(el => lines.push(`  ${formatElement(el)}`));
    lines.push('');
  }

  // Output forms
  if (grouped.form.length > 0) {
    lines.push('Forms:');
    grouped.form.forEach(el => lines.push(`  ${formatElement(el)}`));
  }

  return lines.join('\n');
}

/**
 * Find an element by its extracted ID
 * @param {InteractiveElement[]} elements - Extracted elements
 * @param {number} id - Element ID to find
 * @returns {InteractiveElement|null} Found element or null
 */
export function findElementById(elements, id) {
  return elements.find(el => el.id === id) || null;
}

/**
 * Get selector for an element by ID
 * @param {InteractiveElement[]} elements - Extracted elements
 * @param {number} id - Element ID
 * @returns {string|null} CSS selector or null
 */
export function getSelectorById(elements, id) {
  const element = findElementById(elements, id);
  return element ? element.selector : null;
}

/**
 * Extract context directly from a live document (for in-page execution)
 * This is used when running in content script context with access to live DOM
 * @param {Document} doc - Live document reference
 * @param {Object} options - Extraction options
 * @returns {ExtractedContext} Extracted context
 */
export function extractFromDocument(doc, options = {}) {
  Logger.info('[extractFromDocument] Starting live document context extraction');
  Logger.debug(`[extractFromDocument] Document URL: ${doc.location?.href || 'unknown'}`);
  Logger.debug(`[extractFromDocument] Options:`, options);

  const {
    maxElements = 100,
    includeLinks = true,
    includeForms = true
  } = options;

  let allElements = [];
  let nextId = 1;

  // Extract buttons first (most important for actions)
  const buttons = extractButtons(doc, nextId);
  allElements.push(...buttons.elements);
  nextId = buttons.nextId;

  // Extract text inputs
  const textInputs = extractTextInputs(doc, nextId);
  allElements.push(...textInputs.elements);
  nextId = textInputs.nextId;

  // Extract selects
  const selects = extractSelects(doc, nextId);
  allElements.push(...selects.elements);
  nextId = selects.nextId;

  // Extract checkboxes and radios
  const checkboxes = extractCheckboxesAndRadios(doc, nextId);
  allElements.push(...checkboxes.elements);
  nextId = checkboxes.nextId;

  // Extract links if enabled
  if (includeLinks) {
    const links = extractLinks(doc, nextId);
    allElements.push(...links.elements);
    nextId = links.nextId;
  } else {
    Logger.debug('[extractFromDocument] Links extraction skipped (disabled)');
  }

  // Extract forms if enabled
  if (includeForms) {
    const forms = extractForms(doc, nextId);
    allElements.push(...forms.elements);
  } else {
    Logger.debug('[extractFromDocument] Forms extraction skipped (disabled)');
  }

  // Limit total elements
  const originalCount = allElements.length;
  if (allElements.length > maxElements) {
    allElements = allElements.slice(0, maxElements);
    Logger.warn(`[extractFromDocument] Truncated elements from ${originalCount} to ${maxElements}`);
  }

  // Generate summary
  const summary = allElements.reduce((acc, el) => {
    const type = el.type.split(':')[0];
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  Logger.info(`[extractFromDocument] Extraction complete. Summary:`, summary);
  Logger.info(`[extractFromDocument] Total elements extracted: ${allElements.length}`);

  // Format for LLM
  const formatted = formatContextForLLM(allElements, summary);
  Logger.debug(`[extractFromDocument] Formatted output length: ${formatted.length} chars`);

  return {
    elements: allElements,
    summary,
    formatted
  };
}
