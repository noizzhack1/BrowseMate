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
 * Execute actions sequentially with progress tracking and adaptive re-planning
 * @param {Array<{action: string, description: string}>} actions - Array of actions to execute
 * @param {Function} onProgress - Callback for progress updates (taskList, currentStep, totalSteps, status)
 * @param {string} originalUserPrompt - Original user request (used for re-planning)
 * @param {boolean} enableAdaptivePlanning - Whether to re-evaluate remaining steps after each action (default: true)
 * @param {AbortSignal} abortSignal - Signal to cancel the request
 * @returns {Promise<{success: boolean, message: string, results: Array}>}
 */
export async function executeActionsSequentially(actions, onProgress = null, originalUserPrompt = '', enableAdaptivePlanning = true, abortSignal = null) {
  Logger.info('[executeActionsSequentially] Starting sequential execution');
  Logger.info('[executeActionsSequentially] Total actions:', actions.length);
  Logger.info('[executeActionsSequentially] Adaptive planning enabled:', enableAdaptivePlanning);
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
  let currentActions = [...actions]; // Mutable copy that can be updated by re-planning
  let statuses = new Array(currentActions.length).fill('pending');
  const results = [];

  // Initial progress update
  if (onProgress) {
    const taskList = formatTaskList(currentActions, statuses);
    onProgress(taskList, 0, currentActions.length, 'starting');
  }

  // Execute each action sequentially
  let i = 0;
  while (i < currentActions.length) {
    // Check if request was aborted before each action
    if (abortSignal && abortSignal.aborted) {
      Logger.info('[executeActionsSequentially] Request cancelled by user');
      // Mark remaining actions as cancelled
      while (i < currentActions.length) {
        statuses[i] = 'cancelled';
        results.push({
          action: currentActions[i],
          status: 'cancelled',
          reason: 'Request cancelled by user',
          observation: 'Execution stopped'
        });
        i++;
      }
      break;
    }

    const action = currentActions[i];
    Logger.info(`[executeActionsSequentially] Executing action ${i + 1}/${currentActions.length}`);
    Logger.info(`[executeActionsSequentially] Action:`, action);

    // Mark as in progress
    statuses[i] = 'in_progress';
    if (onProgress) {
      const taskList = formatTaskList(currentActions, statuses);
      onProgress(taskList, i + 1, currentActions.length, 'in_progress');
    }

    try {
      // Get current page context (may have changed since last action)
      const currentContext = await getPageContext();
      Logger.debug(`[executeActionsSequentially] Context length: ${currentContext.length}`);

      // Try executing the action with retries (max 3 attempts)
      const MAX_RETRIES = 3;
      let executionResult = null;
      let lastError = null;
      let attemptHistory = [];

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        Logger.info(`[executeActionsSequentially] Attempt ${attempt}/${MAX_RETRIES} for action ${i}`);

        // Check if request was aborted before executor call
        if (abortSignal && abortSignal.aborted) {
          Logger.info('[executeActionsSequentially] Request cancelled during execution');
          // Mark current and remaining actions as cancelled
          statuses[i] = 'cancelled';
          results.push({
            action: action,
            status: 'cancelled',
            reason: 'Request cancelled by user',
            observation: 'Execution stopped'
          });
          i++;
          while (i < currentActions.length) {
            statuses[i] = 'cancelled';
            results.push({
              action: currentActions[i],
              status: 'cancelled',
              reason: 'Request cancelled by user',
              observation: 'Execution stopped'
            });
            i++;
          }
          break;
        }

        // Call executor LLM to get the web action to execute
        // Include failure feedback for retry attempts
        const executorResult = await llm.executorCall(
          currentContext,
          action,
          i,
          attempt > 1 ? {
            previousAttempts: attemptHistory,
            lastError: lastError
          } : null,
          abortSignal
        );
        
        // Check again after executor call
        if (abortSignal && abortSignal.aborted) {
          Logger.info('[executeActionsSequentially] Request cancelled after executor call');
          // Mark remaining actions as cancelled
          i++;
          while (i < currentActions.length) {
            statuses[i] = 'cancelled';
            results.push({
              action: currentActions[i],
              status: 'cancelled',
              reason: 'Request cancelled by user',
              observation: 'Execution stopped'
            });
            i++;
          }
          break;
        }
        Logger.info(`[executeActionsSequentially] Executor returned:`, executorResult);

        // Execute the web action
        Logger.info(`[executeActionsSequentially] Executing web action: ${executorResult.webAction.name}`);
        const actionToExecute = {
          name: executorResult.webAction.name,
          params: executorResult.webAction.params
        };

        executionResult = await executeAction(actionToExecute);
        Logger.info(`[executeActionsSequentially] Execution result:`, executionResult);

        // Track this attempt
        attemptHistory.push({
          attempt: attempt,
          webAction: executorResult.webAction,
          result: executionResult
        });

        // If successful, break out of retry loop
        if (executionResult.success) {
          Logger.info(`[executeActionsSequentially] Action ${i} succeeded on attempt ${attempt}`);
          break;
        } else {
          lastError = executionResult.message || 'Unknown error';
          Logger.warn(`[executeActionsSequentially] Attempt ${attempt} failed: ${lastError}`);

          // Don't wait after the last attempt
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      // Store result
      const status = executionResult.success ? 'success' : 'failed';
      results.push({
        action: action,
        status: status,
        reason: executionResult.message || 'Execution completed',
        observation: `Completed in ${attemptHistory.length} attempt(s)`,
        attempts: attemptHistory.length
      });

      // Update status based on execution result
      if (executionResult.success) {
        statuses[i] = 'completed';
        Logger.info(`[executeActionsSequentially] Action ${i} completed successfully`);
      } else {
        statuses[i] = 'failed';
        Logger.warn(`[executeActionsSequentially] Action ${i} failed after ${MAX_RETRIES} attempts`);
      }

      // Progress update after completion
      if (onProgress) {
        const taskList = formatTaskList(currentActions, statuses);
        onProgress(taskList, i + 1, currentActions.length, statuses[i]);
      }

      // ADAPTIVE RE-PLANNING: After each action (success OR failure), ask planner to re-evaluate
      // For failures, the planner can suggest alternative approaches
      if (enableAdaptivePlanning && i < currentActions.length - 1) {
        Logger.info('[executeActionsSequentially] Re-evaluating remaining steps with planner...');
        Logger.info(`[executeActionsSequentially] Current action status: ${statuses[i]}`);

        try {
          // Get fresh page context after action
          const updatedContext = await getPageContext();

          // Build summary of what's been done so far, including failure reasons
          const completedActions = currentActions.slice(0, i + 1).map((a, idx) => ({
            description: a.description,
            status: statuses[idx],
            reason: results[idx]?.reason || '' // Include why it failed/succeeded
          }));

          // Check if request was aborted before re-planning
          if (abortSignal && abortSignal.aborted) {
            Logger.info('[executeActionsSequentially] Request cancelled before re-planning');
            // Mark remaining actions as cancelled
            i++;
            while (i < currentActions.length) {
              statuses[i] = 'cancelled';
              results.push({
                action: currentActions[i],
                status: 'cancelled',
                reason: 'Request cancelled by user',
                observation: 'Execution stopped'
              });
              i++;
            }
            break;
          }

          // Ask planner to re-evaluate remaining steps
          const replanResult = await llm.replanCall(
            updatedContext,
            originalUserPrompt,
            completedActions,
            currentActions.slice(i + 1), // Remaining planned actions
            abortSignal
          );
          
          // Check again after re-planning
          if (abortSignal && abortSignal.aborted) {
            Logger.info('[executeActionsSequentially] Request cancelled after re-planning');
            // Mark remaining actions as cancelled
            i++;
            while (i < currentActions.length) {
              statuses[i] = 'cancelled';
              results.push({
                action: currentActions[i],
                status: 'cancelled',
                reason: 'Request cancelled by user',
                observation: 'Execution stopped'
              });
              i++;
            }
            break;
          }

          Logger.info('[executeActionsSequentially] Re-plan result:', replanResult);

          // Update remaining actions if planner suggests changes
          if (replanResult && replanResult.updatedActions) {
            Logger.info('[executeActionsSequentially] Planner updated remaining actions');
            Logger.info('[executeActionsSequentially] Old remaining actions:', currentActions.slice(i + 1));
            Logger.info('[executeActionsSequentially] New remaining actions:', replanResult.updatedActions);

            // Replace remaining actions with updated ones
            const completedPortion = currentActions.slice(0, i + 1);
            currentActions = [...completedPortion, ...replanResult.updatedActions];

            // Update statuses array to match new action count
            const completedStatuses = statuses.slice(0, i + 1);
            statuses = [...completedStatuses, ...new Array(replanResult.updatedActions.length).fill('pending')];

            Logger.info('[executeActionsSequentially] Actions updated. New total:', currentActions.length);

            // Update progress UI with new task list
            if (onProgress) {
              const taskList = formatTaskList(currentActions, statuses);
              onProgress(taskList, i + 1, currentActions.length, 'replanned');
            }
          } else {
            Logger.info('[executeActionsSequentially] Planner kept remaining actions unchanged');
          }
        } catch (replanError) {
          Logger.error('[executeActionsSequentially] Re-planning failed, continuing with original plan:', replanError);
          // Continue with original plan if re-planning fails
        }
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
        const taskList = formatTaskList(currentActions, statuses);
        onProgress(taskList, i + 1, currentActions.length, 'failed');
      }

      // Continue to next action even if this one failed
    }

    i++; // Move to next action
  }

  // Final summary
  const completedCount = statuses.filter(s => s === 'completed').length;
  const failedCount = statuses.filter(s => s === 'failed').length;

  Logger.info('[executeActionsSequentially] Execution complete');
  Logger.info('[executeActionsSequentially] Completed:', completedCount);
  Logger.info('[executeActionsSequentially] Failed:', failedCount);

  const success = completedCount > 0 && failedCount === 0;

  // Build user-friendly message
  let message = '';

  if (success) {
    message = `✅ Task completed successfully`;
  } else if (completedCount > 0 && failedCount > 0) {
    // Partial success - create user-friendly message
    message = `⚠️ Task partially completed\n\n`;

    const successfulActions = results.filter(r => r.status === 'success');
    const failedActions = results.filter(r => r.status === 'failed');

    // Create a friendly summary of what was accomplished
    let accomplishmentSummary = '';
    if (successfulActions.length > 0) {
      const firstAction = successfulActions[0].action.description.toLowerCase();

      // Detect what type of task was accomplished
      if (firstAction.includes('search') || firstAction.includes('fill')) {
        if (firstAction.includes('google')) {
          accomplishmentSummary = 'I searched for you in Google';
        } else if (firstAction.includes('youtube')) {
          accomplishmentSummary = 'I searched for you in YouTube';
        } else {
          accomplishmentSummary = 'I searched for you';
        }
      } else if (firstAction.includes('navigate') || firstAction.includes('go to')) {
        accomplishmentSummary = 'I navigated to the page';
      } else {
        accomplishmentSummary = 'I completed some actions for you';
      }
    }

    message += `✅ ${accomplishmentSummary}\n`;

    // Show what failed with user-friendly guidance
    if (failedActions.length > 0) {
      message += `❌ What I couldn't do:\n`;
      failedActions.forEach(r => {
        // Create user-friendly message for each failure
        const actionDescription = r.action.description.toLowerCase();
        let friendlyMessage = r.action.description;

        // Customize message based on action type
        if (actionDescription.includes('click') && actionDescription.includes('video')) {
          friendlyMessage = `I couldn't click the video automatically, but I found it for you on the screen. Feel free to click it yourself!`;
        } else if (actionDescription.includes('click') && actionDescription.includes('search result')) {
          friendlyMessage = `I couldn't click the first search result automatically. You can try clicking it yourself.`;
        } else if (actionDescription.includes('click')) {
          friendlyMessage = `I couldn't click "${r.action.description}" automatically. You can try clicking it yourself.`;
        } else if (actionDescription.includes('fill') || actionDescription.includes('type')) {
          friendlyMessage = `I couldn't fill in "${r.action.description}" automatically. You might want to try entering it manually.`;
        } else if (actionDescription.includes('navigate') || actionDescription.includes('go to')) {
          friendlyMessage = `I couldn't navigate to that page. You might need to go there manually.`;
        } else {
          friendlyMessage = `I couldn't complete: ${r.action.description}. You can try doing this step manually.`;
        }

        message += `• ${friendlyMessage}\n`;
      });
    }
  } else {
    message = `❌ Task failed - ${failedCount} actions could not be completed`;
  }

  return {
    success,
    message,
    results
  };
}
