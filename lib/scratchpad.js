/**
 * ===========================================
 * File: scratchpad.js
 * Purpose: Working memory for ReAct agent - tracks observations, thoughts, and actions
 * The scratchpad provides a structured way to record the agent's reasoning process
 * ===========================================
 */

/**
 * Scratchpad entry types
 * @typedef {'observation' | 'thought' | 'action' | 'result' | 'error' | 'goal'} EntryType
 */

/**
 * Single scratchpad entry
 * @typedef {Object} ScratchpadEntry
 * @property {EntryType} type - Type of entry
 * @property {string} content - The content of the entry
 * @property {number} step - Step number when this entry was created
 * @property {number} timestamp - Unix timestamp when created
 * @property {Object} [metadata] - Optional additional data
 */

/**
 * Scratchpad class - Working memory for the ReAct agent
 * Tracks the agent's reasoning process including observations, thoughts, and actions
 */
class Scratchpad {
  /**
   * Create a new Scratchpad
   * @param {string} goal - The original user goal/request
   * @param {number} maxEntries - Maximum entries to keep (older ones are summarized)
   */
  constructor(goal, maxEntries = 50) {
    /** @type {string} */
    this.goal = goal;

    /** @type {number} */
    this.maxEntries = maxEntries;

    /** @type {ScratchpadEntry[]} */
    this.entries = [];

    /** @type {number} */
    this.currentStep = 0;

    /** @type {boolean} */
    this.isComplete = false;

    /** @type {string | null} */
    this.finalAnswer = null;

    /** @type {string | null} */
    this.completionReason = null;

    /** @type {number} */
    this.startTime = Date.now();

    // Add goal as first entry
    this.addEntry('goal', goal);
  }

  /**
   * Add an entry to the scratchpad
   * @param {EntryType} type - Type of entry
   * @param {string} content - Content of the entry
   * @param {Object} [metadata] - Optional metadata
   * @returns {ScratchpadEntry} The created entry
   */
  addEntry(type, content, metadata = null) {
    const entry = {
      type,
      content,
      step: this.currentStep,
      timestamp: Date.now(),
      metadata
    };

    this.entries.push(entry);

    // Trim old entries if exceeding max (keep goal and recent entries)
    if (this.entries.length > this.maxEntries) {
      // Keep the goal entry and the most recent entries
      const goalEntry = this.entries[0];
      const recentEntries = this.entries.slice(-this.maxEntries + 1);
      this.entries = [goalEntry, ...recentEntries];
    }

    return entry;
  }

  /**
   * Add an observation (what the agent sees on the page)
   * @param {string} observation - The observation content
   * @param {Object} [pageContext] - Optional page context metadata
   */
  addObservation(observation, pageContext = null) {
    return this.addEntry('observation', observation, {
      pageContext,
      url: pageContext?.url,
      title: pageContext?.title
    });
  }

  /**
   * Add a thought (agent's reasoning)
   * @param {string} thought - The thought content
   */
  addThought(thought) {
    return this.addEntry('thought', thought);
  }

  /**
   * Add an action (what the agent decided to do)
   * @param {string} actionDescription - Human-readable action description
   * @param {Object} actionDetails - The action object with name and params
   */
  addAction(actionDescription, actionDetails = null) {
    return this.addEntry('action', actionDescription, { actionDetails });
  }

  /**
   * Add an action result
   * @param {boolean} success - Whether the action succeeded
   * @param {string} message - Result message
   * @param {Object} [details] - Optional result details
   */
  addResult(success, message, details = null) {
    return this.addEntry('result', message, { success, details });
  }

  /**
   * Add an error
   * @param {string} error - Error message
   * @param {Object} [details] - Optional error details
   */
  addError(error, details = null) {
    return this.addEntry('error', error, { details });
  }

  /**
   * Increment the step counter
   */
  nextStep() {
    this.currentStep++;
  }

  /**
   * Mark the task as complete
   * @param {string} answer - The final answer/result
   * @param {string} reason - Why the task is complete
   */
  complete(answer, reason = 'goal_achieved') {
    this.isComplete = true;
    this.finalAnswer = answer;
    this.completionReason = reason;
    this.addEntry('thought', `Task complete: ${reason}`);
  }

  /**
   * Get entries by type
   * @param {EntryType} type - Type to filter by
   * @returns {ScratchpadEntry[]}
   */
  getEntriesByType(type) {
    return this.entries.filter(e => e.type === type);
  }

  /**
   * Get the last entry of a specific type
   * @param {EntryType} type - Type to get
   * @returns {ScratchpadEntry | null}
   */
  getLastEntry(type) {
    const filtered = this.getEntriesByType(type);
    return filtered.length > 0 ? filtered[filtered.length - 1] : null;
  }

  /**
   * Get the last N entries
   * @param {number} n - Number of entries to get
   * @returns {ScratchpadEntry[]}
   */
  getRecentEntries(n = 10) {
    return this.entries.slice(-n);
  }

  /**
   * Get all actions taken so far
   * @returns {ScratchpadEntry[]}
   */
  getActions() {
    return this.getEntriesByType('action');
  }

  /**
   * Get success/failure statistics
   * @returns {{total: number, successful: number, failed: number}}
   */
  getStats() {
    const results = this.getEntriesByType('result');
    const successful = results.filter(r => r.metadata?.success).length;
    const failed = results.filter(r => !r.metadata?.success).length;

    return {
      total: results.length,
      successful,
      failed,
      steps: this.currentStep,
      duration: Date.now() - this.startTime
    };
  }

  /**
   * Format the scratchpad for display in the UI
   * @param {boolean} includeMetadata - Whether to include metadata
   * @returns {string}
   */
  formatForDisplay(includeMetadata = false) {
    const lines = [];
    lines.push(`**Goal:** ${this.goal}`);
    lines.push('');

    for (const entry of this.entries.slice(1)) { // Skip goal entry (already shown)
      const prefix = this._getEntryPrefix(entry.type);
      const stepInfo = entry.step > 0 ? `[Step ${entry.step}] ` : '';

      if (entry.type === 'observation') {
        // Truncate long observations
        const content = entry.content.length > 200
          ? entry.content.substring(0, 200) + '...'
          : entry.content;
        lines.push(`${prefix} ${stepInfo}${content}`);
      } else if (entry.type === 'result') {
        const icon = entry.metadata?.success ? '✓' : '✗';
        lines.push(`${prefix} ${icon} ${entry.content}`);
      } else {
        lines.push(`${prefix} ${stepInfo}${entry.content}`);
      }
    }

    if (this.isComplete) {
      lines.push('');
      lines.push(`**Status:** Complete (${this.completionReason})`);
    }

    return lines.join('\n');
  }

  /**
   * Format the scratchpad for the LLM context
   * This provides a structured view for the agent to reason about
   * @returns {string}
   */
  formatForLLM() {
    const lines = [];
    lines.push('=== SCRATCHPAD (Working Memory) ===');
    lines.push(`GOAL: ${this.goal}`);
    lines.push(`CURRENT STEP: ${this.currentStep}`);
    lines.push('');

    // Group entries by step for clarity
    const stepGroups = new Map();
    for (const entry of this.entries) {
      if (entry.type === 'goal') continue;

      if (!stepGroups.has(entry.step)) {
        stepGroups.set(entry.step, []);
      }
      stepGroups.get(entry.step).push(entry);
    }

    for (const [step, entries] of stepGroups) {
      if (step > 0) {
        lines.push(`--- Step ${step} ---`);
      }

      for (const entry of entries) {
        const label = entry.type.toUpperCase();
        if (entry.type === 'result') {
          const status = entry.metadata?.success ? 'SUCCESS' : 'FAILED';
          lines.push(`${label} (${status}): ${entry.content}`);
        } else {
          lines.push(`${label}: ${entry.content}`);
        }
      }
      lines.push('');
    }

    const stats = this.getStats();
    lines.push(`--- Statistics ---`);
    lines.push(`Actions taken: ${stats.total} (${stats.successful} succeeded, ${stats.failed} failed)`);
    lines.push(`Duration: ${Math.round(stats.duration / 1000)}s`);
    lines.push('=== END SCRATCHPAD ===');

    return lines.join('\n');
  }

  /**
   * Get a summary of what's been done so far
   * @returns {string}
   */
  getSummary() {
    const actions = this.getActions();
    const results = this.getEntriesByType('result');
    const stats = this.getStats();

    if (actions.length === 0) {
      return 'No actions taken yet.';
    }

    const actionList = actions.map((a, i) => {
      const result = results[i];
      const status = result?.metadata?.success ? '✓' : (result ? '✗' : '○');
      return `${status} ${a.content}`;
    }).join('\n');

    return `Progress (${stats.successful}/${stats.total} successful):\n${actionList}`;
  }

  /**
   * Check if the last action failed
   * @returns {boolean}
   */
  lastActionFailed() {
    const lastResult = this.getLastEntry('result');
    return lastResult && !lastResult.metadata?.success;
  }

  /**
   * Get the prefix icon for an entry type
   * @private
   */
  _getEntryPrefix(type) {
    switch (type) {
      case 'observation': return '👁️';
      case 'thought': return '💭';
      case 'action': return '⚡';
      case 'result': return '📋';
      case 'error': return '❌';
      case 'goal': return '🎯';
      default: return '•';
    }
  }

  /**
   * Serialize the scratchpad to JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      goal: this.goal,
      entries: this.entries,
      currentStep: this.currentStep,
      isComplete: this.isComplete,
      finalAnswer: this.finalAnswer,
      completionReason: this.completionReason,
      startTime: this.startTime
    };
  }

  /**
   * Create a scratchpad from JSON
   * @param {Object} json
   * @returns {Scratchpad}
   */
  static fromJSON(json) {
    const scratchpad = new Scratchpad(json.goal);
    scratchpad.entries = json.entries;
    scratchpad.currentStep = json.currentStep;
    scratchpad.isComplete = json.isComplete;
    scratchpad.finalAnswer = json.finalAnswer;
    scratchpad.completionReason = json.completionReason;
    scratchpad.startTime = json.startTime;
    return scratchpad;
  }
}

export { Scratchpad };
