/**
 * ===========================================
 * File: react-agent.js
 * Purpose: ReAct (Reasoning + Acting) Agent for browser automation
 * Implements the Observe -> Think -> Act loop with scratchpad
 * ===========================================
 */

import { Scratchpad } from './scratchpad.js';
import { executeAction } from './action-executor.js';
import { extractHTMLContext } from './context-extractor.js';
import { Logger } from '../utils/logger.js';
import { mcpClient } from './mcp-client.js';

// Maximum number of steps before giving up
const MAX_STEPS = 15;

// Delay between steps to allow page to stabilize
const STEP_DELAY_MS = 300;

// Delay after action to allow DOM to update
const POST_ACTION_DELAY_MS = 500;

/**
 * ReAct Agent - Runs the observe-think-act loop
 */
class ReactAgent {
  /**
   * Create a new ReAct Agent
   * @param {Object} llmClient - The LLM client for making API calls
   * @param {Object} options - Agent options
   */
  constructor(llmClient, options = {}) {
    this.llmClient = llmClient;
    this.maxSteps = options.maxSteps || MAX_STEPS;
    this.stepDelay = options.stepDelay || STEP_DELAY_MS;
    this.postActionDelay = options.postActionDelay || POST_ACTION_DELAY_MS;
    this.systemPrompt = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the agent (load prompts, etc.)
   */
  async initialize() {
    if (this.isInitialized) return;

    // Load the ReAct agent prompt
    try {
      const promptUrl = chrome.runtime.getURL('config/react-agent-prompt.txt');
      const response = await fetch(promptUrl);
      if (response.ok) {
        this.systemPrompt = await response.text();
      } else {
        throw new Error('Failed to load prompt');
      }
    } catch (error) {
      Logger.warn('[ReactAgent] Failed to load prompt, using fallback');
      this.systemPrompt = this._getFallbackPrompt();
    }

    this.isInitialized = true;
  }

  /**
   * Run the agent to complete a task
   * @param {string} goal - The user's goal/request
   * @param {Object} initialContext - Initial page context {url, title, html, text}
   * @param {Object} callbacks - Callback functions
   * @param {Function} callbacks.onThinking - Called when agent is thinking (thought) => void
   * @param {Function} callbacks.onAction - Called when taking action (action, description) => void
   * @param {Function} callbacks.onResult - Called after action result (success, message) => void
   * @param {Function} callbacks.onObservation - Called when observing (observation) => void
   * @param {Function} callbacks.onComplete - Called when complete (answer, scratchpad) => void
   * @param {Function} callbacks.onProgress - Called with progress update (scratchpad, step, maxSteps) => void
   * @param {AbortSignal} abortSignal - Signal to cancel the agent
   * @returns {Promise<{success: boolean, answer: string, scratchpad: Scratchpad}>}
   */
  async run(goal, initialContext, callbacks = {}, abortSignal = null) {
    Logger.info('[ReactAgent] Starting agent run');
    Logger.info('[ReactAgent] Goal:', goal);

    if (!this.isInitialized) {
      await this.initialize();
    }

    // Create scratchpad
    const scratchpad = new Scratchpad(goal);

    // Get current page context
    let currentContext = initialContext || await this._getPageContext();

    // Add initial observation
    const initialObservation = this._formatObservation(currentContext);
    scratchpad.addObservation(initialObservation, currentContext);

    if (callbacks.onObservation) {
      callbacks.onObservation(initialObservation);
    }

    // Main agent loop
    let stepCount = 0;
    while (stepCount < this.maxSteps && !scratchpad.isComplete) {
      // Check for abort
      if (abortSignal?.aborted) {
        Logger.info('[ReactAgent] Aborted by user');
        scratchpad.addThought('Task cancelled by user');
        scratchpad.complete('Task was cancelled', 'user_cancelled');
        break;
      }

      stepCount++;
      scratchpad.nextStep();

      Logger.info(`[ReactAgent] Step ${stepCount}/${this.maxSteps}`);

      // Progress callback
      if (callbacks.onProgress) {
        callbacks.onProgress(scratchpad, stepCount, this.maxSteps);
      }

      try {
        // THINK: Get next action from LLM
        const decision = await this._think(currentContext, scratchpad, abortSignal);

        if (abortSignal?.aborted) break;

        // Add thought to scratchpad
        scratchpad.addThought(decision.thought);

        if (callbacks.onThinking) {
          callbacks.onThinking(decision.thought);
        }

        // Check if complete
        if (decision.complete) {
          Logger.info('[ReactAgent] Agent declared task complete');
          const status = decision.status || 'success';
          scratchpad.complete(decision.answer, status === 'failed' ? 'failed' : 'goal_achieved');

          if (callbacks.onComplete) {
            callbacks.onComplete(decision.answer, scratchpad);
          }

          return {
            success: status !== 'failed',
            answer: decision.answer,
            scratchpad
          };
        }

        // ACT: Execute the action
        if (decision.action) {
          const actionDescription = decision.description || this._describeAction(decision.action);

          scratchpad.addAction(actionDescription, decision.action);

          if (callbacks.onAction) {
            callbacks.onAction(decision.action, actionDescription);
          }

          // Execute the action
          const result = await this._executeAction(decision.action);

          // Add result to scratchpad
          scratchpad.addResult(result.success, result.message, result);

          if (callbacks.onResult) {
            callbacks.onResult(result.success, result.message);
          }

          // Wait for page to stabilize
          await this._sleep(this.postActionDelay);

          // OBSERVE: Get new page state
          currentContext = await this._getPageContext();
          const newObservation = this._formatObservation(currentContext, result);
          scratchpad.addObservation(newObservation, currentContext);

          if (callbacks.onObservation) {
            callbacks.onObservation(newObservation);
          }
        }

        // Small delay before next step
        await this._sleep(this.stepDelay);

      } catch (error) {
        Logger.error('[ReactAgent] Error in step:', error);
        scratchpad.addError(error.message);

        // Continue unless it's a critical error
        if (error.message.includes('cancelled') || error.message.includes('aborted')) {
          scratchpad.complete('Task was cancelled', 'user_cancelled');
          break;
        }
      }
    }

    // Max steps reached without completion
    if (!scratchpad.isComplete) {
      Logger.warn('[ReactAgent] Max steps reached without completing goal');
      scratchpad.complete(
        `I've taken ${this.maxSteps} steps but couldn't fully complete the task. ${scratchpad.getSummary()}`,
        'max_steps_reached'
      );
    }

    return {
      success: scratchpad.completionReason === 'goal_achieved',
      answer: scratchpad.finalAnswer,
      scratchpad
    };
  }

  /**
   * Think step - get next action from LLM
   * @private
   */
  async _think(context, scratchpad, abortSignal) {
    Logger.info('[ReactAgent._think] Getting next action from LLM');

    // Build the context for the LLM
    const contextStr = this._buildContextForLLM(context, scratchpad);

    // Ensure LLM client is initialized and select planner model
    if (!this.llmClient.isInitialized) {
      await this.llmClient.initialize();
    }

    // Select the planner model
    if (this.llmClient._selectModelFromSettings) {
      await this.llmClient._selectModelFromSettings('plannerModel');
    }

    // Check if we have a valid LLM configured
    if (!this.llmClient.currentLLM) {
      throw new Error('No LLM configured. Please configure an LLM in settings.');
    }

    // Build messages
    const messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: contextStr }
    ];

    // Make LLM call
    const requestBody = {
      model: this.llmClient.currentLLM.MODEL,
      messages: messages,
      temperature: 0.3,
      max_tokens: 1024
    };

    try {
      if (abortSignal?.aborted) {
        throw new Error('Request cancelled by user');
      }

      const response = await fetch(
        `${this.llmClient.currentLLM.baseURL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.llmClient.currentLLM.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: abortSignal || undefined
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from LLM');
      }

      const content = data.choices[0].message.content;
      return this._parseDecision(content);

    } catch (error) {
      if (error.name === 'AbortError' || (abortSignal?.aborted)) {
        throw new Error('Request cancelled by user');
      }
      Logger.error('[ReactAgent._think] LLM call failed:', error);
      throw error;
    }
  }

  /**
   * Parse the LLM's decision from JSON response
   * @private
   */
  _parseDecision(content) {
    Logger.debug('[ReactAgent._parseDecision] Parsing:', content);

    let jsonStr = content.trim();

    // Remove markdown code blocks if present
    if (jsonStr.includes('```')) {
      const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
    }

    // Extract JSON object
    const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonObjMatch) {
      jsonStr = jsonObjMatch[0];
    }

    try {
      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      if (!parsed.thought) {
        parsed.thought = 'Processing...';
      }

      return {
        thought: parsed.thought,
        action: parsed.action || null,
        description: parsed.description || null,
        complete: parsed.complete || false,
        answer: parsed.answer || null,
        status: parsed.status || 'success'
      };
    } catch (error) {
      Logger.error('[ReactAgent._parseDecision] Failed to parse JSON:', error);
      Logger.error('[ReactAgent._parseDecision] Content was:', content);

      // Return a fallback decision that asks for retry
      return {
        thought: 'I had trouble processing the response. Let me try again.',
        action: null,
        complete: false
      };
    }
  }

  /**
   * Build context string for LLM
   * @private
   */
  _buildContextForLLM(context, scratchpad) {
    const parts = [];

    // Current page state
    parts.push('=== CURRENT PAGE STATE ===');
    parts.push(`URL: ${context.url || 'unknown'}`);
    parts.push(`Title: ${context.title || 'unknown'}`);

    // Extract interactive elements
    if (context.html) {
      try {
        const extracted = extractHTMLContext(context.html, {
          maxElements: 60,
          includeLinks: true,
          includeForms: true
        });
        parts.push('');
        parts.push('Interactive Elements:');
        parts.push(extracted.formatted);
      } catch (error) {
        Logger.warn('[ReactAgent] Failed to extract context:', error);
      }
    }

    // Page text (truncated)
    if (context.text) {
      parts.push('');
      parts.push('Page Text (first 2000 chars):');
      parts.push(context.text.substring(0, 2000));
    }

    // Scratchpad
    parts.push('');
    parts.push(scratchpad.formatForLLM());

    // Instructions
    parts.push('');
    parts.push('=== YOUR TASK ===');
    parts.push('Based on the current page state and your scratchpad, decide on your next action.');
    parts.push('Respond with valid JSON as specified in your instructions.');

    return parts.join('\n');
  }

  /**
   * Execute an action
   * @private
   */
  async _executeAction(action) {
    Logger.info('[ReactAgent._executeAction] Executing:', action);

    try {
      // Check if this is an MCP tool
      if (action.name && mcpClient.isMCPTool(action.name)) {
        Logger.info('[ReactAgent._executeAction] MCP tool detected');
        const result = await mcpClient.executeMCPTool(action.name, action.params || {});
        return {
          success: result.success,
          message: result.message || (result.success ? 'MCP tool executed' : 'MCP tool failed')
        };
      }

      // Regular browser action
      const result = await executeAction({
        name: action.name,
        params: action.params || {}
      });

      return result;
    } catch (error) {
      Logger.error('[ReactAgent._executeAction] Error:', error);
      return {
        success: false,
        message: `Action failed: ${error.message}`
      };
    }
  }

  /**
   * Get current page context
   * @private
   */
  async _getPageContext() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.id) {
        return { url: '', title: '', html: '', text: '' };
      }

      // Get page HTML
      let html = '';
      let text = '';

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            html: document.body.outerHTML,
            text: document.body.innerText
          })
        });

        if (results && results[0]) {
          html = results[0].result.html || '';
          text = results[0].result.text || '';
        }
      } catch (e) {
        Logger.warn('[ReactAgent._getPageContext] Failed to get page content:', e);
      }

      return {
        url: tab.url || '',
        title: tab.title || '',
        html,
        text
      };
    } catch (error) {
      Logger.error('[ReactAgent._getPageContext] Error:', error);
      return { url: '', title: '', html: '', text: '' };
    }
  }

  /**
   * Format observation for scratchpad
   * @private
   */
  _formatObservation(context, lastResult = null) {
    const parts = [];

    parts.push(`Page: ${context.title || 'Untitled'}`);
    parts.push(`URL: ${context.url || 'unknown'}`);

    if (lastResult) {
      const status = lastResult.success ? 'succeeded' : 'failed';
      parts.push(`Last action ${status}: ${lastResult.message}`);
    }

    // Add key visible elements summary
    if (context.html) {
      try {
        const extracted = extractHTMLContext(context.html, {
          maxElements: 10,
          includeLinks: true,
          includeForms: true
        });

        if (extracted.summary) {
          const summary = extracted.summary;
          const elementCounts = [];
          if (summary.buttons) elementCounts.push(`${summary.buttons} buttons`);
          if (summary.links) elementCounts.push(`${summary.links} links`);
          if (summary.inputs) elementCounts.push(`${summary.inputs} inputs`);

          if (elementCounts.length > 0) {
            parts.push(`Visible elements: ${elementCounts.join(', ')}`);
          }
        }
      } catch (error) {
        // Ignore extraction errors for observation
      }
    }

    return parts.join(' | ');
  }

  /**
   * Describe an action for display
   * @private
   */
  _describeAction(action) {
    if (!action || !action.name) return 'Unknown action';

    const name = action.name;
    const params = action.params || {};

    switch (name) {
      case 'navigate':
        return `Navigate to ${params.url}`;
      case 'click':
        return `Click on ${params.selector}`;
      case 'clickLink':
        return `Click link "${params.text}"`;
      case 'clickButton':
        return `Click button "${params.text}"`;
      case 'fill':
        return `Fill "${params.selector}" with "${params.value}"`;
      case 'fillAndSubmit':
        return `Fill and submit "${params.value}"`;
      case 'findSearchInput':
        return `Search for "${params.value}"`;
      case 'select':
        return `Select "${params.value}" in ${params.selector}`;
      case 'scroll':
        return `Scroll ${params.direction || 'down'} by ${params.target}px`;
      case 'pressKey':
        return `Press ${params.key} key`;
      case 'goBack':
        return 'Go back';
      case 'goForward':
        return 'Go forward';
      case 'reload':
        return 'Reload page';
      default:
        return `${name}: ${JSON.stringify(params)}`;
    }
  }

  /**
   * Sleep helper
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get fallback prompt if loading fails
   * @private
   */
  _getFallbackPrompt() {
    return `You are a ReAct web browser agent. Observe the page, think about what to do, and take ONE action at a time.

Respond with JSON:
- For actions: {"thought": "your reasoning", "action": {"name": "actionName", "params": {...}}, "description": "what this does"}
- When complete: {"thought": "why complete", "complete": true, "answer": "result for user"}

Available actions: navigate, click, clickLink, clickButton, fill, fillAndSubmit, findSearchInput, select, scroll, pressKey, goBack, goForward, reload, hover, waitForElement

Always think step by step and adapt based on what you observe.`;
  }
}

/**
 * Create and run a ReAct agent for a task
 * @param {Object} llmClient - The LLM client
 * @param {string} goal - The user's goal
 * @param {Object} context - Initial page context
 * @param {Object} callbacks - Callback functions
 * @param {AbortSignal} abortSignal - Abort signal
 * @returns {Promise<{success: boolean, answer: string, scratchpad: Scratchpad}>}
 */
async function runReactAgent(llmClient, goal, context, callbacks = {}, abortSignal = null) {
  const agent = new ReactAgent(llmClient);
  return agent.run(goal, context, callbacks, abortSignal);
}

export { ReactAgent, runReactAgent, Scratchpad };
