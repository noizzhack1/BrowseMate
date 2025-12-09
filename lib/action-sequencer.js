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
 * Detect if user prompt is a research/knowledge question
 * These questions require searching and extracting information
 * @param {string} prompt - User's original prompt
 * @returns {boolean} - True if it's a research question
 */
function isResearchQuestion(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return false;
  }

  const lowerPrompt = prompt.toLowerCase().trim();

  // Check for question indicators
  const questionPatterns = [
    /^how (to|do|does|can|should|would)/,
    /^what (is|are|does|do)/,
    /^why (is|are|does|do)/,
    /^when (to|should|does|do)/,
    /^where (to|can|should|does|do)/,
    /^which (is|are)/,
    /^who (is|are)/,
    /\?$/ // Ends with question mark
  ];

  // Check if prompt matches any question pattern
  const matchesQuestionPattern = questionPatterns.some(pattern => pattern.test(lowerPrompt));

  // Exclude greetings and casual conversation
  const greetings = ['hey', 'hello', 'hi', 'thanks', 'thank you', 'ok', 'okay'];
  const isGreeting = greetings.some(greeting => lowerPrompt === greeting);

  // Exclude questions about current page (these don't require research)
  const currentPageIndicators = [
    'this page',
    'this article',
    'this site',
    'this website',
    'the page',
    'the article'
  ];
  const isAboutCurrentPage = currentPageIndicators.some(indicator =>
    lowerPrompt.includes(indicator)
  );

  // It's a research question if:
  // 1. It matches a question pattern
  // 2. It's NOT a greeting
  // 3. It's NOT about the current page
  return matchesQuestionPattern && !isGreeting && !isAboutCurrentPage;
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
 * Detect error messages on the page
 * @param {string} htmlContext - HTML context of the page
 * @returns {{hasError: boolean, errorMessage: string}}
 */
function detectErrorMessages(htmlContext) {
  try {
    const contextLower = htmlContext.toLowerCase();

    // Common error message patterns
    const errorPatterns = [
      { pattern: /something went wrong.*validate.*credentials/i, message: 'Incorrect credentials' },
      { pattern: /invalid.*credentials/i, message: 'Invalid credentials' },
      { pattern: /incorrect.*username.*password/i, message: 'Incorrect username or password' },
      { pattern: /authentication.*failed/i, message: 'Authentication failed' },
      { pattern: /login.*failed/i, message: 'Login failed' },
      { pattern: /wrong.*password/i, message: 'Wrong password' },
      { pattern: /username.*not.*found/i, message: 'Username not found' },
      { pattern: /email.*not.*found/i, message: 'Email not found' },
      { pattern: /account.*locked/i, message: 'Account locked' },
      { pattern: /too many.*attempts/i, message: 'Too many login attempts' },
      { pattern: /password.*expired/i, message: 'Password expired' },
      { pattern: /session.*expired/i, message: 'Session expired' },
      { pattern: /access.*denied/i, message: 'Access denied' },
      { pattern: /unauthorized/i, message: 'Unauthorized access' }
    ];

    // Check for error indicators in HTML classes and IDs
    const hasErrorClass = contextLower.includes('class="error"') ||
                         contextLower.includes('class=\'error\'') ||
                         contextLower.includes('error-message') ||
                         contextLower.includes('alert-error') ||
                         contextLower.includes('alert-danger') ||
                         contextLower.includes('validation-error');

    // Try to extract actual error message from the page
    if (hasErrorClass) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContext, 'text/html');

      const errorElements = doc.querySelectorAll('.error, .error-message, .alert-error, .alert-danger, [role="alert"], .validation-error');

      for (const el of errorElements) {
        const errorText = el.textContent.trim();
        if (errorText && errorText.length > 0 && errorText.length < 200) {
          return {
            hasError: true,
            errorMessage: errorText
          };
        }
      }
    }

    // Check for pattern matches in the content
    for (const { pattern, message } of errorPatterns) {
      if (pattern.test(htmlContext)) {
        return {
          hasError: true,
          errorMessage: message
        };
      }
    }

    return {
      hasError: false,
      errorMessage: ''
    };
  } catch (error) {
    Logger.error('[detectErrorMessages] Error detecting error messages:', error);
    return {
      hasError: false,
      errorMessage: ''
    };
  }
}

/**
 * Detect if page has empty form fields that need user input
 * @param {string} htmlContext - HTML context of the page
 * @returns {Promise<{hasEmptyFields: boolean, fieldCount: number, fields: Array}>}
 */
async function detectMissingFormData(htmlContext) {
  try {
    // Parse HTML to extract form fields
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContext, 'text/html');

    // Find all input fields (text, email, password, tel, etc.)
    const inputFields = Array.from(doc.querySelectorAll('input[type="text"], input[type="email"], input[type="password"], input[type="tel"], input[type="number"], input:not([type])'))
      .filter(input => {
        // Filter out hidden fields
        const style = input.getAttribute('style') || '';
        const isHidden = input.type === 'hidden' ||
                       input.hasAttribute('hidden') ||
                       style.includes('display: none') ||
                       style.includes('display:none');
        return !isHidden;
      })
      .map(input => {
        // Extract field information
        const type = input.type || 'text';
        const name = input.name || input.id || '';
        const placeholder = input.placeholder || '';
        const ariaLabel = input.getAttribute('aria-label') || '';
        const value = input.value || '';

        // Find associated label
        let label = '';
        if (input.id) {
          const labelEl = doc.querySelector(`label[for="${input.id}"]`);
          if (labelEl) label = labelEl.textContent.trim();
        }
        // Check for wrapping label
        if (!label) {
          const parentLabel = input.closest('label');
          if (parentLabel) label = parentLabel.textContent.trim();
        }

        // Use the best available descriptor
        const fieldLabel = label || ariaLabel || placeholder || name || type;

        return {
          type,
          name,
          label: fieldLabel,
          placeholder,
          value,
          isEmpty: !value || value.trim() === ''
        };
      });

    // Check if there are any empty fields
    const emptyFields = inputFields.filter(field => field.isEmpty);

    return {
      hasEmptyFields: emptyFields.length > 0,
      fieldCount: emptyFields.length,
      fields: emptyFields
    };
  } catch (error) {
    Logger.error('[detectMissingFormData] Error detecting form fields:', error);
    return {
      hasEmptyFields: false,
      fieldCount: 0,
      fields: []
    };
  }
}

/**
 * Request user input for each field and create fill actions
 * @param {Array} fields - Array of field objects with label, type, placeholder, etc.
 * @param {Function} onInteraction - Callback to ask user for input
 * @returns {Promise<Array>} Array of fill actions
 */
async function requestUserInputForFields(fields, onInteraction) {
  const fillActions = [];
  const userInputs = {};

  for (const field of fields) {
    const fieldPrompt = `${field.label || field.placeholder || field.name || 'Field'}:`;

    const userValue = await onInteraction(fieldPrompt, {
      type: field.type,
      name: field.name,
      label: field.label,
      placeholder: field.placeholder
    });

    if (userValue && userValue.trim()) {
      userInputs[field.name || field.label] = userValue.trim();

      fillActions.push({
        action: 'fill',
        description: field.label || field.name,
        fieldInfo: {
          type: field.type,
          name: field.name,
          label: field.label,
          value: userValue.trim()
        }
      });
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(document.body.innerHTML, 'text/html');
  const submitButton = doc.querySelector('button[type="submit"], input[type="submit"], button');

  if (submitButton) {
    const buttonText = submitButton.textContent || submitButton.value || submitButton.getAttribute('aria-label') || '';
    if (buttonText) {
      fillActions.push({
        action: 'click',
        description: buttonText
      });
    }
  }

  if (Object.keys(userInputs).length > 0) {
    if (!global.userCredentials) {
      global.userCredentials = {};
    }
    Object.assign(global.userCredentials, userInputs);
  }

  return fillActions;
}

/**
 * Execute actions sequentially with progress tracking and adaptive re-planning
 * @param {Array<{action: string, description: string}>} actions - Array of actions to execute
 * @param {Function} onProgress - Callback for progress updates (taskList, currentStep, totalSteps, status)
 * @param {string} originalUserPrompt - Original user request (used for re-planning)
 * @param {boolean} enableAdaptivePlanning - Whether to re-evaluate remaining steps after each action (default: true)
 * @param {AbortSignal} abortSignal - Signal to cancel the request
 * @param {Function} onInteraction - Callback for user interactions (question) => Promise<answer>
 * @returns {Promise<{success: boolean, message: string, results: Array}>}
 */
export async function executeActionsSequentially(actions, onProgress = null, originalUserPrompt = '', enableAdaptivePlanning = true, abortSignal = null, onInteraction = null) {
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
      // USER INTERACTION: Auto-fill default URLs for common services BEFORE execution
      // Try default first, only ask if it fails
      if (action.action === 'navigate') {
        Logger.info('[executeActionsSequentially] Checking if navigate action needs default URL...');

        // Detect if description mentions services that require user-specific URLs
        const descriptionLower = action.description.toLowerCase();
        const requiresDefaultURL =
          (descriptionLower.includes('jira') && !descriptionLower.includes('http')) ||
          (descriptionLower.includes('confluence') && !descriptionLower.includes('http')) ||
          (descriptionLower.includes('notion') && !descriptionLower.includes('http')) ||
          (descriptionLower.includes('sharepoint') && !descriptionLower.includes('http')) ||
          (descriptionLower.includes('salesforce') && !descriptionLower.includes('http'));

        if (requiresDefaultURL) {
          // Determine what service we're trying to access
          let serviceName = '';
          if (descriptionLower.includes('jira')) serviceName = 'Jira';
          else if (descriptionLower.includes('confluence')) serviceName = 'Confluence';
          else if (descriptionLower.includes('notion')) serviceName = 'Notion';
          else if (descriptionLower.includes('sharepoint')) serviceName = 'SharePoint';
          else if (descriptionLower.includes('salesforce')) serviceName = 'Salesforce';

          // Default URLs for common services
          const defaultURLs = {
            'Jira': 'https://id.atlassian.com/',
            'Confluence': 'https://id.atlassian.com/',
            'Notion': 'https://www.notion.so/',
            'SharePoint': 'https://login.microsoftonline.com/',
            'Salesforce': 'https://login.salesforce.com/'
          };

          const defaultURL = defaultURLs[serviceName];

          if (defaultURL) {
            Logger.info('[executeActionsSequentially] Using default URL for', serviceName, ':', defaultURL);

            // Update the action description to include the default URL
            action.description = `Navigate to ${defaultURL}`;
            currentActions[i] = action;

            // Store the service name for potential retry with custom URL
            if (!global.serviceURLAttempts) global.serviceURLAttempts = {};
            global.serviceURLAttempts[serviceName] = { attempted: true, serviceName };
          }
        }
      }

      // Get current page context (may have changed since last action)
      let currentContext = await getPageContext();
      Logger.debug(`[executeActionsSequentially] Context length (original): ${currentContext.length}`);

      // Truncate context if too large to fit within model's 8192 token limit
      // Estimate: 1 token ≈ 4 chars, so 4000 tokens ≈ 16000 chars (leaving room for output and prompts)
      const MAX_CONTEXT_CHARS = 16000;
      if (currentContext.length > MAX_CONTEXT_CHARS) {
        Logger.warn(`[executeActionsSequentially] Context too large (${currentContext.length} chars), truncating to ${MAX_CONTEXT_CHARS} chars`);
        currentContext = currentContext.substring(0, MAX_CONTEXT_CHARS) + '\n\n[... context truncated due to length ...]';
      }
      Logger.debug(`[executeActionsSequentially] Context length (after truncation): ${currentContext.length}`);

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
        // Handle truncated responses by retrying with increased max_tokens
        let executorResult;
        let currentMaxTokens = 1000; // Start conservative to leave room for large system prompt
        const MAX_TOKENS_LIMIT = 2000; // Keep reasonable to avoid exceeding model's 8192 total token limit

        while (currentMaxTokens <= MAX_TOKENS_LIMIT) {
          try {
            executorResult = await llm.executorCall(
              currentContext,
              action,
              i,
              attempt > 1 ? {
                previousAttempts: attemptHistory,
                lastError: lastError
              } : null,
              abortSignal,
              currentMaxTokens
            );
            break; // Success - exit the retry loop
          } catch (error) {
            // Check if this is a truncation error
            if (error.message && error.message.startsWith('TRUNCATED_RESPONSE:')) {
              const previousMaxTokens = parseInt(error.message.split(':')[1]);
              currentMaxTokens = previousMaxTokens * 2; // Double the tokens
              Logger.warn(`[executeActionsSequentially] Response truncated at ${previousMaxTokens} tokens, retrying with ${currentMaxTokens}`);

              if (currentMaxTokens > MAX_TOKENS_LIMIT) {
                throw new Error(`Response still truncated even at max token limit (${MAX_TOKENS_LIMIT})`);
              }
              // Continue to next iteration with increased tokens
            } else {
              // Not a truncation error - rethrow
              throw error;
            }
          }
        }
        
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

        // If this was a failed navigation to a service with default URL, ask for custom URL
        if (onInteraction && action.action === 'navigate' && global.serviceURLAttempts) {
          const descriptionLower = action.description.toLowerCase();
          let serviceName = null;

          if (descriptionLower.includes('jira')) serviceName = 'Jira';
          else if (descriptionLower.includes('confluence')) serviceName = 'Confluence';
          else if (descriptionLower.includes('notion')) serviceName = 'Notion';
          else if (descriptionLower.includes('sharepoint')) serviceName = 'SharePoint';
          else if (descriptionLower.includes('salesforce')) serviceName = 'Salesforce';

          if (serviceName && global.serviceURLAttempts[serviceName] && !global.serviceURLAttempts[serviceName].askedForCustom) {
            Logger.info('[executeActionsSequentially] Default URL failed, asking for custom URL');

            const customURL = await onInteraction(`Default ${serviceName} URL failed. Please provide your specific ${serviceName} URL:`);

            if (customURL && customURL.trim()) {
              Logger.info('[executeActionsSequentially] User provided custom URL, retrying navigation');

              // Mark that we asked for custom URL
              global.serviceURLAttempts[serviceName].askedForCustom = true;

              // Update action with custom URL and retry
              action.description = `Navigate to ${customURL.trim()}`;
              currentActions[i] = action;
              statuses[i] = 'pending';

              // Remove failed result
              results.pop();

              // Retry this action (don't increment i)
              continue;
            }
          }
        }
      }

      // Progress update after completion
      if (onProgress) {
        const taskList = formatTaskList(currentActions, statuses);
        onProgress(taskList, i + 1, currentActions.length, statuses[i]);
      }

      // USER INTERACTION: Request missing data or approval from user
      // This happens after ANY action (success or failure)
      if (onInteraction) {
        Logger.info('[executeActionsSequentially] Checking if user interaction is needed...');

        try {
          // Get current page context to analyze
          const currentContext = await getPageContext();

          // Check for error messages on the page (authentication failures, validation errors, etc.)
          const hasError = detectErrorMessages(currentContext);

          // Check if there are empty form fields that need user input
          const needsUserInput = await detectMissingFormData(currentContext);

          // PRIORITY 1: Handle error messages (login failures, etc.)
          if (hasError.hasError && needsUserInput.hasEmptyFields) {
            Logger.info('[executeActionsSequentially] Detected error message on page:', hasError.errorMessage);

            // Show error to user and re-ask for credentials
            await onInteraction(hasError.errorMessage);

            // Request user input for each field and create fill actions
            const fillActions = await requestUserInputForFields(needsUserInput.fields, onInteraction);

            if (fillActions.length > 0) {
              Logger.info('[executeActionsSequentially] User inputs collected for retry, adding form fill actions...');

              // Remove any remaining failed fill actions
              const afterActions = currentActions.slice(i + 1).filter(a => a.action !== 'fill');

              // Insert form fill actions after current action
              const beforeActions = currentActions.slice(0, i + 1);
              currentActions = [...beforeActions, ...fillActions, ...afterActions];

              // Update statuses array
              const beforeStatuses = statuses.slice(0, i + 1);
              statuses = [...beforeStatuses, ...new Array(fillActions.length).fill('pending'), ...new Array(afterActions.length).fill('pending')];

              Logger.info('[executeActionsSequentially] Retry actions added. New total:', currentActions.length);

              // Update progress UI
              if (onProgress) {
                const taskList = formatTaskList(currentActions, statuses);
                onProgress(taskList, i + 1, currentActions.length, 'interaction');
              }
            }
          }
          // PRIORITY 2: Handle empty form fields (initial login attempt)
          else if (needsUserInput.hasEmptyFields && executionResult.success) {
            Logger.info('[executeActionsSequentially] Detected form with empty fields requiring user input');

            // Request user input for each field and create fill actions
            const fillActions = await requestUserInputForFields(needsUserInput.fields, onInteraction);

            if (fillActions.length > 0) {
              Logger.info('[executeActionsSequentially] User inputs collected, adding form fill actions...');

              // Remove any remaining failed fill actions from the queue
              const afterActions = currentActions.slice(i + 1).filter(a => a.action !== 'fill');

              // Insert form fill actions after current action
              const beforeActions = currentActions.slice(0, i + 1);
              currentActions = [...beforeActions, ...fillActions, ...afterActions];

              // Update statuses array
              const beforeStatuses = statuses.slice(0, i + 1);
              statuses = [...beforeStatuses, ...new Array(fillActions.length).fill('pending'), ...new Array(afterActions.length).fill('pending')];

              Logger.info('[executeActionsSequentially] Form fill actions added. New total:', currentActions.length);

              // Update progress UI
              if (onProgress) {
                const taskList = formatTaskList(currentActions, statuses);
                onProgress(taskList, i + 1, currentActions.length, 'interaction');
              }
            }
          }
        } catch (interactionError) {
          Logger.error('[executeActionsSequentially] User interaction failed:', interactionError);
          // Continue with normal execution if interaction fails
        }
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

    // CHECK IF WE SHOULD CONTINUE: After each action, if we've reached the end of planned actions,
    // check if goal is achieved and auto-continue if needed
    if (i >= currentActions.length && enableAdaptivePlanning && originalUserPrompt && onInteraction) {
      Logger.info('[executeActionsSequentially] Reached end of planned actions - checking if goal achieved...');

      try {
        const currentContext = await getPageContext();

        // Quick check: are there empty form fields we can fill?
        const needsUserInput = await detectMissingFormData(currentContext);

        if (needsUserInput.hasEmptyFields) {
          Logger.info('[executeActionsSequentially] Goal not yet achieved - detected empty form fields');
          Logger.info('[executeActionsSequentially] Requesting user input to continue...');

          // Request user input for each field and create fill actions
          const fillActions = await requestUserInputForFields(needsUserInput.fields, onInteraction);

          if (fillActions.length > 0) {
            Logger.info('[executeActionsSequentially] Adding', fillActions.length, 'new actions to continue toward goal');

            // Add fill actions to continue execution
            currentActions = [...currentActions, ...fillActions];
            statuses = [...statuses, ...new Array(fillActions.length).fill('pending')];

            // Update progress UI
            if (onProgress) {
              const taskList = formatTaskList(currentActions, statuses);
              onProgress(taskList, i, currentActions.length, 'interaction');
            }

            // Loop will continue automatically since i < currentActions.length now
          }
        }
      } catch (autoContinueError) {
        Logger.error('[executeActionsSequentially] Auto-continue check failed:', autoContinueError);
        // Continue with normal flow
      }
    }
  }

  // Final summary
  const completedCount = statuses.filter(s => s === 'completed').length;
  const failedCount = statuses.filter(s => s === 'failed').length;

  Logger.info('[executeActionsSequentially] Execution complete');
  Logger.info('[executeActionsSequentially] Completed:', completedCount);
  Logger.info('[executeActionsSequentially] Failed:', failedCount);

  let success = completedCount > 0 && failedCount === 0;

  // GOAL VERIFICATION: Check if the actual user goal was achieved
  // Only verify if at least some actions completed successfully
  let goalAchieved = false;
  let verificationMessage = '';
  let nextSteps = [];
  let extractedAnswer = null;

  if (completedCount > 0 && originalUserPrompt) {
    Logger.info('[executeActionsSequentially] Running goal verification...');
    try {
      // Get final page context after all actions
      const finalContext = await getPageContext();

      // Check if request was aborted before verification
      if (abortSignal && abortSignal.aborted) {
        Logger.info('[executeActionsSequentially] Request cancelled before goal verification');
      } else {
        // Call verifyGoalCall to check if the goal was actually achieved
        const verificationResult = await llm.verifyGoalCall(
          finalContext,
          originalUserPrompt,
          results,
          abortSignal
        );

        Logger.info('[executeActionsSequentially] Goal verification result:', verificationResult);

        goalAchieved = verificationResult.achieved;
        verificationMessage = verificationResult.message || '';

        // ANSWER EXTRACTION: If this was a research question and goal was achieved, extract the answer
        if (goalAchieved && isResearchQuestion(originalUserPrompt)) {
          Logger.info('[executeActionsSequentially] Research question detected - extracting answer from page...');
          try {
            const answerResult = await llm.answerExtractionCall(
              finalContext,
              originalUserPrompt,
              results,
              abortSignal
            );

            if (answerResult.success) {
              Logger.info('[executeActionsSequentially] ✅ Answer extracted successfully');
              extractedAnswer = answerResult.answer;
            } else {
              Logger.warn('[executeActionsSequentially] Answer extraction returned failure:', answerResult.answer);
              extractedAnswer = answerResult.answer; // Still use the error message
            }
          } catch (extractError) {
            Logger.error('[executeActionsSequentially] Answer extraction failed:', extractError);
            // Don't fail the entire task, just note we couldn't extract
            extractedAnswer = 'I found relevant information but had trouble extracting a clear answer. Please check the page that\'s now open.';
          }
        }

        // If goal not achieved, analyze what went wrong and suggest next steps
        if (!goalAchieved) {
          Logger.warn('[executeActionsSequentially] Goal was NOT achieved despite action success');
          Logger.info('[executeActionsSequentially] Analyzing what went wrong...');

          // Use LLM's suggestion if available
          if (verificationResult.whatsMissing) {
            Logger.info('[executeActionsSequentially] LLM suggests:', verificationResult.whatsMissing);
            nextSteps.push(verificationResult.whatsMissing);
          }

          // Analyze the results to suggest next steps
          const failedActions = results.filter(r => r.status === 'failed');
          const lastAction = results[results.length - 1];

          // Build actionable suggestions based on what happened
          if (failedActions.length > 0) {
            // Some actions failed - suggest manual intervention or retry
            const failedActionTypes = failedActions.map(f => f.action.action).join(', ');
            nextSteps.push(`Some actions failed (${failedActionTypes}). You can try doing these manually.`);
          }

          if (lastAction && lastAction.status === 'success') {
            // Last action succeeded but goal not achieved - might need one more step
            if (originalUserPrompt.toLowerCase().includes('play') &&
                lastAction.action.description.toLowerCase().includes('search')) {
              nextSteps.push(`I found search results but didn't click to play. Try: "click the first video"`);
            } else if (originalUserPrompt.toLowerCase().includes('open') &&
                      lastAction.action.description.toLowerCase().includes('search')) {
              nextSteps.push(`I found search results. Try: "click the first result to open it"`);
            } else {
              nextSteps.push(`The page is ready but needs one more step. Please specify what to do next.`);
            }
          }

          // Check if we're on a different page than expected
          if (finalContext.url && originalUserPrompt.toLowerCase().includes('youtube') &&
              !finalContext.url.includes('youtube.com')) {
            nextSteps.push(`Not on YouTube yet. Try: "go to YouTube" first`);
          } else if (finalContext.url && originalUserPrompt.toLowerCase().includes('google') &&
                    !finalContext.url.includes('google.com')) {
            nextSteps.push(`Not on Google yet. Try: "go to Google" first`);
          }

          success = false;
        } else {
          Logger.info('[executeActionsSequentially] ✅ Goal was achieved!');
        }
      }
    } catch (verifyError) {
      Logger.error('[executeActionsSequentially] Goal verification failed:', verifyError);
      // Don't fail the entire task if verification fails, just log it
    }
  }

  // Build user-friendly message
  let message = '';

  if (success && goalAchieved) {
    // True success - actions completed AND goal achieved
    // If this was a research question with an extracted answer, use that as the message
    if (extractedAnswer) {
      Logger.info('[executeActionsSequentially] Using extracted answer as final message');
      message = extractedAnswer;
    } else {
      message = `✅ Task completed successfully`;
      if (verificationMessage) {
        message += `\n\n${verificationMessage}`;
      }
    }
  } else if (!goalAchieved && completedCount > 0) {
    // Actions succeeded but goal not achieved - provide feedback loop
    message = `⚠️ Actions completed but goal not fully achieved\n\n`;

    if (verificationMessage) {
      message += `${verificationMessage}\n\n`;
    }

    // Add actionable next steps
    if (nextSteps.length > 0) {
      message += `💡 **What to do next:**\n`;
      nextSteps.forEach((step, idx) => {
        message += `${idx + 1}. ${step}\n`;
      });
    } else {
      message += `The actions were executed successfully, but the final result doesn't match what you asked for. You may need to try a different approach or provide more specific instructions.`;
    }
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
    results,
    goalAchieved,
    nextSteps: nextSteps.length > 0 ? nextSteps : null
  };
}
