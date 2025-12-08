/**
 * ===========================================
 * File: action-sequencer.js
 * Purpose: Sequential action executor with progress tracking
 * Executes actions one at a time and reports progress to the user
 * Dependencies: LLMClient.js, action-executor.js, logger.js
 * ===========================================
 */

// Import LLM client for executor calls
import { LLMClient } from './llm-client.js';
// Import action executor for actual web actions
import { executeAction } from './action-executor.js';
// Import logger for debugging
import { Logger } from '../utils/logger.js';

// LLM client instance
let llmClient = null;

/**
 * Get or create LLM client instance (singleton pattern)
 * @returns {LLMClient} - The LLM client instance
 */
function getLLMClient() {
  if (!llmClient) {
    llmClient = new LLMClient();
  }
  return llmClient;
}

/**
 * Get current page context (HTML)
 * @returns {Promise<string>} - Page HTML
 */
async function getPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      Logger.error('[getPageContext] No active tab found');
      return '';
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.outerHTML
    });

    return results && results[0] ? results[0].result : '';
  } catch (error) {
    Logger.error('[getPageContext] Failed to get page context:', error);
    return '';
  }
}

/**
 * Format task list with checked/unchecked states
 * @param {Array} actions - Array of actions with status
 * @param {Array<string>} descriptions - Array of descriptions
 * @param {Array<string>} statuses - Array of statuses ('pending', 'in_progress', 'completed', 'failed')
 * @returns {string} - Formatted task list
 */
function formatTaskList(actions, statuses) {
  return actions.map((action, index) => {
    const status = statuses[index] || 'pending';
    let icon;
    switch (status) {
      case 'completed':
        icon = '●'; // Filled circle for completed
        break;
      case 'in_progress':
        icon = '◐'; // Half-filled circle for in progress
        break;
      case 'failed':
        icon = '✗'; // X for failed
        break;
      default:
        icon = '○'; // Empty circle for pending
    }
    return `${icon} ${action.description}`;
  }).join('\n');
}

/**
 * Execute actions sequentially with progress tracking
 * @param {string} context - Initial page context
 * @param {Array<{action: string, description: string}>} actions - Array of actions to execute
 * @param {Function} onProgress - Callback for progress updates (taskList, currentStep, totalSteps, status)
 * @returns {Promise<{success: boolean, message: string, results: Array}>}
 */
export async function executeActionsSequentially(context, actions, onProgress = null) {
  Logger.info('[executeActionsSequentially] Starting sequential execution');
  Logger.info('[executeActionsSequentially] Total actions:', actions.length);
  Logger.debug('[executeActionsSequentially] Actions:', actions);

  if (!actions || actions.length === 0) {
    Logger.warn('[executeActionsSequentially] No actions to execute');
    return {
      success: true,
      message: 'No actions to execute',
      results: []
    };
  }

  const llm = getLLMClient();
  const statuses = new Array(actions.length).fill('pending');
  const results = [];

  // Initial progress update
  if (onProgress) {
    const taskList = formatTaskList(actions, statuses);
    onProgress(taskList, 0, actions.length, 'starting');
  }

  // Execute each action sequentially
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    Logger.info(`[executeActionsSequentially] Executing action ${i + 1}/${actions.length}`);
    Logger.info(`[executeActionsSequentially] Action:`, action);

    // Mark as in progress
    statuses[i] = 'in_progress';
    if (onProgress) {
      const taskList = formatTaskList(actions, statuses);
      onProgress(taskList, i + 1, actions.length, 'in_progress');
    }

    try {
      // Get current page context (may have changed since last action)
      const currentContext = await getPageContext();
      Logger.debug(`[executeActionsSequentially] Context length: ${currentContext.length}`);

      // Call executor LLM to interpret the action
      Logger.info(`[executeActionsSequentially] Calling executor LLM for action ${i}`);
      const executorResult = await llm.executorCall(currentContext, action, i);
      Logger.info(`[executeActionsSequentially] Executor result:`, executorResult);

      // Store result
      results.push({
        action: action,
        status: executorResult.status,
        reason: executorResult.reason,
        observation: executorResult.observation
      });

      // Update status based on executor result
      if (executorResult.status === 'success') {
        statuses[i] = 'completed';
        Logger.info(`[executeActionsSequentially] Action ${i} completed successfully`);
      } else if (executorResult.status === 'failed' || executorResult.status === 'skipped') {
        statuses[i] = 'failed';
        Logger.warn(`[executeActionsSequentially] Action ${i} failed/skipped: ${executorResult.reason}`);
      }

      // Progress update after completion
      if (onProgress) {
        const taskList = formatTaskList(actions, statuses);
        onProgress(taskList, i + 1, actions.length, statuses[i]);
      }

      // Small delay between actions
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      Logger.error(`[executeActionsSequentially] Error executing action ${i}:`, error);
      statuses[i] = 'failed';
      results.push({
        action: action,
        status: 'failed',
        reason: error.message,
        observation: 'Execution error'
      });

      // Progress update for error
      if (onProgress) {
        const taskList = formatTaskList(actions, statuses);
        onProgress(taskList, i + 1, actions.length, 'failed');
      }

      // Continue to next action even if this one failed
      continue;
    }
  }

  // Final summary
  const completedCount = statuses.filter(s => s === 'completed').length;
  const failedCount = statuses.filter(s => s === 'failed').length;

  Logger.info('[executeActionsSequentially] Execution complete');
  Logger.info('[executeActionsSequentially] Completed:', completedCount);
  Logger.info('[executeActionsSequentially] Failed:', failedCount);

  const success = completedCount > 0 && failedCount === 0;
  const message = success
    ? `All ${completedCount} actions completed successfully`
    : `Completed ${completedCount}/${actions.length} actions (${failedCount} failed)`;

  return {
    success,
    message,
    results
  };
}
