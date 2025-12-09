// LLM Client - Unified facade for planner and executor clients
// Re-exports individual clients for backward compatibility

import { LLMPlannerClient } from './llm-planner.js';
import { LLMExecutorClient } from './llm-executor.js';

/**
 * Unified LLMClient that combines planner and executor functionality
 * Maintains backward compatibility with existing code
 */
class LLMClient {
  constructor() {
    this.plannerClient = new LLMPlannerClient();
    this.executorClient = new LLMExecutorClient();
    this.config = null;
    this.currentLLM = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    // Initialize both clients
    await this.plannerClient.initialize();
    await this.executorClient.initialize();

    // Sync state for backward compatibility
    this.config = this.plannerClient.config;
    this.currentLLM = this.plannerClient.currentLLM;
    this.isInitialized = true;
  }

  selectLLM(llmName) {
    this.plannerClient.selectLLM(llmName);
    this.executorClient.selectLLM(llmName);
    this.currentLLM = this.plannerClient.currentLLM;
  }

  async switchLLM(llmName) {
    this.selectLLM(llmName);

    const result = await chrome.storage.sync.get('browsemate_settings');
    const settings = result.browsemate_settings || {};
    settings.selectedLLM = llmName;
    await chrome.storage.sync.set({ browsemate_settings: settings });
  }

  getAvailableLLMs() {
    if (!this.config) return [];

    // Superset of both branches: include type + promptFile when present
    return this.config.llms.map(l => ({
      name: l.name,
      model: l.MODEL,
      baseURL: l.baseURL,
      type: l.type || 'general',
      promptFile: l.promptFile || null,
    }));
  }

  getCurrentLLMInfo() {
    if (!this.currentLLM) {
      throw new Error('No LLM selected');
    }

    // Superset of both branches
    return {
      name: this.currentLLM.name,
      model: this.currentLLM.MODEL,
      baseURL: this.currentLLM.baseURL,
      type: this.currentLLM.type || 'general',
      promptFile: this.currentLLM.promptFile || null,
      defaultPrompt: this.currentLLM.prompt || null
    };
  }

  getLLMByType(type) {
    return this.plannerClient.getLLMByType(type);
  }

  // Delegate to planner client
  async generateCompletion(prompt, options = {}) {
    if (!this.isInitialized) await this.initialize();
    return this.plannerClient.generateCompletion(prompt, options);
  }

  async streamCompletion(prompt, onChunk, options = {}) {
    if (!this.isInitialized) await this.initialize();
    // Use streaming from planner (same implementation)
    return this.plannerClient.streamCompletion?.(prompt, onChunk, options);
  }

  async chat(messages, options = {}) {
    return await this.generateCompletion(null, { ...options, messages });
  }

  // Planner methods
  async plannerCall(context, userPrompt, tools = null, abortSignal = null, conversationHistory = []) {
    if (!this.isInitialized) await this.initialize();
    return this.plannerClient.plannerCall(context, userPrompt, tools, abortSignal, conversationHistory);
  }

  async streamQuestionAnswer(context, userPrompt, onChunk, abortSignal = null) {
    if (!this.isInitialized) await this.initialize();
    return this.plannerClient.streamQuestionAnswer(context, userPrompt, onChunk, abortSignal);
  }

  async replanCall(context, originalUserPrompt, completedActions, remainingActions, abortSignal = null) {
    if (!this.isInitialized) await this.initialize();
    return this.plannerClient.replanCall(context, originalUserPrompt, completedActions, remainingActions, abortSignal);
  }

  async verifyGoalCall(context, originalUserPrompt, executedActions, abortSignal = null) {
    if (!this.isInitialized) await this.initialize();
    return this.plannerClient.verifyGoalCall(context, originalUserPrompt, executedActions, abortSignal);
  }

  async answerExtractionCall(context, originalUserQuestion, executedActions, abortSignal = null) {
    if (!this.isInitialized) await this.initialize();
    return this.plannerClient.answerExtractionCall(context, originalUserQuestion, executedActions, abortSignal);
  }

  // Executor methods
  async executorCall(context, action, actionIndex, retryContext = null, abortSignal = null, maxTokens = 1000) {
    if (!this.isInitialized) await this.initialize();
    return this.executorClient.executorCall(context, action, actionIndex, retryContext, abortSignal, maxTokens);
  }

  async actionsCall(context, action) {
    if (!this.isInitialized) await this.initialize();
    return this.executorClient.actionsCall(context, action);
  }

  // Helper methods (delegated)
  _buildContextString(html, options = {}) {
    return this.plannerClient._buildContextString(html, options);
  }

  _truncateContext(str, maxChars, label) {
    return this.plannerClient._truncateContext(str, maxChars, label);
  }
}

// Export classes
export { LLMClient, LLMPlannerClient, LLMExecutorClient };

// Create singleton instance for backward compatibility
const llmClient = new LLMClient();

// Export singleton for non-module scripts
if (typeof window !== 'undefined') {
  window.llmClient = llmClient;
}
