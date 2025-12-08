/**
 * ===========================================
 * File: retry.js
 * Purpose: Retry logic for action execution
 * Wraps execution with configurable retry attempts
 * Dependencies: logger.js
 * ===========================================
 */

// Import logger for tracking retry attempts
import { Logger } from '../utils/logger.js';

// Default maximum retry attempts before giving up
const MAX_ATTEMPTS = 3;

/**
 * Execute a function with retry logic
 * Keeps trying until success or max attempts reached
 * @param {Function} executeFn - Async function to execute, receives attempt number, should return {success: boolean, message: string}
 * @param {number} maxAttempts - Maximum number of attempts (default: 3)
 * @returns {Promise<{success: boolean, message: string, attempts: number}>} - Result with attempt count
 */
async function executeWithRetry(executeFn, maxAttempts = MAX_ATTEMPTS) {
  // Array to track all error messages for final report
  const errors = [];
  
  // Attempt execution up to maxAttempts times
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Log current attempt number
    Logger.info(`Execution attempt ${attempt}/${maxAttempts}`);
    
    try {
      // Call the execution function with current attempt number
      // This allows executeFn to adjust strategy on retries
      const result = await executeFn(attempt);
      
      // If execution was successful, return immediately with success
      if (result.success) {
        // Log success message
        Logger.info(`Action succeeded on attempt ${attempt}`);
        // Return result with attempt count added
        return { ...result, attempts: attempt };
      }
      
      // If not successful, log the failure and store error message
      Logger.warn(`Attempt ${attempt} failed: ${result.message}`);
      // Add error to array for final report
      errors.push(`Attempt ${attempt}: ${result.message}`);
      
    } catch (error) {
      // Handle unexpected errors (exceptions thrown by executeFn)
      Logger.error(`Attempt ${attempt} threw error:`, error);
      // Add error message to array
      errors.push(`Attempt ${attempt}: ${error.message}`);
    }
  }
  
  // All attempts failed - log final failure
  Logger.error(`All ${maxAttempts} attempts failed`);
  
  // Return failure result with all accumulated error messages
  return {
    // Mark as failed
    success: false,
    // Combine all error messages into final message
    message: `Failed after ${maxAttempts} attempts:\n${errors.join('\n')}`,
    // Include total attempt count
    attempts: maxAttempts
  };
}

// Export for ES6 modules
export { executeWithRetry, MAX_ATTEMPTS };

