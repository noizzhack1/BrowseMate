/**
 * ===========================================
 * File: diff.js
 * Purpose: HTML change detection - compares HTML before and after action execution
 * Dependencies: logger.js
 * ===========================================
 */

// Import logger for debugging
import { Logger } from '../utils/logger.js';

/**
 * Normalize HTML string for comparison
 * Removes whitespace differences and normalizes attributes
 * @param {string} html - HTML string to normalize
 * @returns {string} - Normalized HTML
 */
function normalizeHTML(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }

  // Remove extra whitespace and normalize line breaks
  let normalized = html
    .replace(/\s+/g, ' ')           // Replace multiple whitespace with single space
    .replace(/>\s+</g, '><')        // Remove whitespace between tags
    .trim();

  // Remove common dynamic attributes that change but don't indicate meaningful change
  // These are attributes that browsers add dynamically (like data-reactid, etc.)
  normalized = normalized.replace(/\s+data-react[-\w]*="[^"]*"/gi, '');
  normalized = normalized.replace(/\s+data-v-[-\w]*="[^"]*"/gi, '');
  
  // Normalize attribute order (optional - can be expensive for large HTML)
  // For now, we'll do a simpler comparison

  return normalized;
}

/**
 * Check if HTML has changed between two snapshots
 * Uses normalization to ignore minor differences (whitespace, dynamic attributes)
 * @param {string} before - HTML before action
 * @param {string} after - HTML after action
 * @returns {boolean} - True if meaningful change detected
 */
function hasChanged(before, after) {
  // Handle null/undefined cases
  if (!before && !after) {
    return false;
  }
  if (!before || !after) {
    return true; // One is missing, consider it a change
  }

  // Normalize both HTML strings
  const normalizedBefore = normalizeHTML(before);
  const normalizedAfter = normalizeHTML(after);

  // Compare normalized versions
  const changed = normalizedBefore !== normalizedAfter;

  if (changed) {
    // Calculate similarity percentage for logging
    const similarity = calculateSimilarity(normalizedBefore, normalizedAfter);
    Logger.debug(`HTML changed detected. Similarity: ${(similarity * 100).toFixed(2)}%`);
    
    // Log a snippet of the difference for debugging
    if (normalizedBefore.length > 0 && normalizedAfter.length > 0) {
      const beforeLength = normalizedBefore.length;
      const afterLength = normalizedAfter.length;
      Logger.debug(`HTML length: ${beforeLength} -> ${afterLength} (${afterLength - beforeLength > 0 ? '+' : ''}${afterLength - beforeLength})`);
    }
  } else {
    Logger.debug('No HTML change detected');
  }

  return changed;
}

/**
 * Calculate similarity between two strings (simple character-based)
 * Returns a value between 0 and 1 (1 = identical, 0 = completely different)
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity score (0-1)
 */
function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;

  const len1 = str1.length;
  const len2 = str2.length;
  const maxLen = Math.max(len1, len2);
  
  if (maxLen === 0) return 1.0;

  // Simple Levenshtein-like comparison (simplified)
  // Count matching characters in same positions
  let matches = 0;
  const minLen = Math.min(len1, len2);
  
  for (let i = 0; i < minLen; i++) {
    if (str1[i] === str2[i]) {
      matches++;
    }
  }

  // Factor in length difference
  const lengthPenalty = Math.abs(len1 - len2) / maxLen;
  const similarity = (matches / maxLen) * (1 - lengthPenalty * 0.5);

  return Math.max(0, Math.min(1, similarity));
}

// Export functions for ES6 modules
export { hasChanged, normalizeHTML, calculateSimilarity };
