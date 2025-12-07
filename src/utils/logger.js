/**
 * ===========================================
 * File: logger.js
 * Purpose: Simple logging utility for BrowseMate extension
 * Provides console-based logging with levels and [BrowseMate] prefix
 * Dependencies: None
 * ===========================================
 */

// Log levels enum for filtering
const LOG_LEVELS = {
  // Most verbose - shows everything
  DEBUG: 0,
  // General information
  INFO: 1,
  // Warnings that don't stop execution
  WARN: 2,
  // Errors that need attention
  ERROR: 3
};

/**
 * Logger class - provides structured console logging
 * All methods are static - no instantiation needed
 */
class Logger {
  // Default log level (can be changed at runtime)
  static level = LOG_LEVELS.DEBUG;

  // Prefix for all log messages - makes filtering easy in console
  static PREFIX = '[BrowseMate]';

  /**
   * Set the minimum log level
   * Messages below this level will not be logged
   * @param {number} level - LOG_LEVELS value (DEBUG=0, INFO=1, WARN=2, ERROR=3)
   */
  static setLevel(level) {
    // Update the static level property
    Logger.level = level;
  }

  /**
   * Debug level logging - for development and troubleshooting
   * Only shows when level is DEBUG (0)
   * @param {...any} args - Arguments to log
   */
  static debug(...args) {
    // Check if current level allows debug messages
    if (Logger.level <= LOG_LEVELS.DEBUG) {
      // Use console.debug for debug-level messages
      console.debug(Logger.PREFIX, '[DEBUG]', ...args);
    }
  }

  /**
   * Info level logging - for general information
   * Shows when level is INFO (1) or lower
   * @param {...any} args - Arguments to log
   */
  static info(...args) {
    // Check if current level allows info messages
    if (Logger.level <= LOG_LEVELS.INFO) {
      // Use console.info for info-level messages
      console.info(Logger.PREFIX, '[INFO]', ...args);
    }
  }

  /**
   * Warning level logging - for non-critical issues
   * Shows when level is WARN (2) or lower
   * @param {...any} args - Arguments to log
   */
  static warn(...args) {
    // Check if current level allows warning messages
    if (Logger.level <= LOG_LEVELS.WARN) {
      // Use console.warn for warning-level messages
      console.warn(Logger.PREFIX, '[WARN]', ...args);
    }
  }

  /**
   * Error level logging - for critical issues
   * Always shows unless level is set higher than ERROR
   * @param {...any} args - Arguments to log
   */
  static error(...args) {
    // Check if current level allows error messages
    if (Logger.level <= LOG_LEVELS.ERROR) {
      // Use console.error for error-level messages
      console.error(Logger.PREFIX, '[ERROR]', ...args);
    }
  }
}

// Export for ES6 modules
export { Logger, LOG_LEVELS };

