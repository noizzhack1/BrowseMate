/**
 * ===========================================
 * File: llm-client.js (Simplified)
 * Purpose: LLM Client for ReAct Agent
 * Provides configuration and initialization for LLM API calls
 * Dependencies: None (standalone)
 * ===========================================
 */

/**
 * Unified LLMClient for ReAct Agent
 * Handles configuration, model selection, and basic initialization
 */
class LLMClient {
  constructor() {
    this.config = null;
    this.currentLLM = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Try primary config path, fallback to older path
      let configJson = null;

      const tryLoadConfig = async (path) => {
        const url = chrome.runtime.getURL(path);
        const resp = await fetch(url);
        if (!resp.ok) return null;
        return await resp.json();
      };

      configJson = await tryLoadConfig('config/config.json');
      if (!configJson) {
        configJson = await tryLoadConfig('config/config-llm.json');
      }

      if (!configJson) {
        throw new Error('Failed to load LLM config from config/config.json or config/config-llm.json');
      }

      this.config = configJson;

      // Merge in any custom models the user has added previously
      const customStored = await chrome.storage.sync.get('browsemate_custom_llms');
      const customLlms = Array.isArray(customStored.browsemate_custom_llms)
        ? customStored.browsemate_custom_llms
        : [];

      if (Array.isArray(this.config.llms)) {
        this.config.llms = this.config.llms.concat(customLlms);
      } else {
        this.config.llms = customLlms;
      }

      // Load prompt files for LLMs that have them configured
      if (Array.isArray(this.config.llms)) {
        for (const llm of this.config.llms) {
          if (llm.promptFile && !llm.prompt) {
            try {
              const promptUrl = chrome.runtime.getURL(llm.promptFile);
              const promptResp = await fetch(promptUrl);
              if (promptResp.ok) {
                llm.prompt = await promptResp.text();
              } else {
                console.warn('[LLMClient.initialize] Failed to load prompt file', llm.promptFile, promptResp.status);
              }
            } catch (e) {
              console.warn('[LLMClient.initialize] Error loading prompt file', llm.promptFile, e);
            }
          }
        }
      }

      // Load user settings from storage
      const result = await chrome.storage.sync.get('browsemate_settings');
      const settings = result.browsemate_settings || {};

      // Determine default model
      const defaultName =
        settings.plannerModel ||
        settings.executorModel ||
        settings.selectedLLM ||
        (this.config.llms && this.config.llms[0] ? this.config.llms[0].name : null);

      if (defaultName) {
        this.selectLLM(defaultName);
      }

      // Override token if user has set it
      if (settings.hfToken && this.currentLLM) {
        this.currentLLM.token = settings.hfToken;
      }

      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize LLM client:', error);
      throw error;
    }
  }

  selectLLM(llmName) {
    if (!this.config || !this.config.llms) {
      throw new Error('Config not loaded. Call initialize() first.');
    }

    this.currentLLM = this.config.llms.find(
      l => l.name.toLowerCase() === llmName.toLowerCase()
    );

    if (!this.currentLLM) {
      const available = this.config.llms.map(l => l.name).join(', ');
      throw new Error(`LLM "${llmName}" not found. Available: ${available}`);
    }
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
    if (!this.config || !this.config.llms) {
      console.warn('[getLLMByType] Config not loaded');
      return null;
    }
    return this.config.llms.find(llm => llm.type === type) || null;
  }

  async _selectModelFromSettings(settingsKey) {
    const stored = await chrome.storage.sync.get('browsemate_settings');
    const settings = stored.browsemate_settings || {};

    const fallbackName =
      settings.plannerModel ||
      settings.executorModel ||
      settings.selectedLLM ||
      (this.config && this.config.llms && this.config.llms[0]
        ? this.config.llms[0].name
        : null);

    const targetName = settings[settingsKey] || fallbackName;
    if (!targetName) return;

    this.selectLLM(targetName);

    if (settings.hfToken && this.currentLLM) {
      this.currentLLM.token = settings.hfToken;
    }
  }
}

// Export class
export { LLMClient };

// Create singleton instance for backward compatibility
const llmClient = new LLMClient();

// Export singleton for non-module scripts
if (typeof window !== 'undefined') {
  window.llmClient = llmClient;
}
