// Browser-compatible LLM client for Chrome extension
// Merged version: keeps functionality from both branches
// - Supports lib/llm-config.json + config/config.json
// - Supports promptFile loading
// - Supports custom LLMs
// - Has planner/executor model selection
// - Planner can return question/action/plan
// - Actions call uses executor model + optional model-specific prompt

class LLMClient {
  constructor() {
    this.config = null;
    this.currentLLM = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Try primary config path (Branch B), fallback to older path (Branch A)
      let configJson = null;

      const tryLoadConfig = async (path) => {
        const url = chrome.runtime.getURL(path);
        const resp = await fetch(url);
        if (!resp.ok) return null;
        return await resp.json();
      };

      configJson = await tryLoadConfig('config/config-llm.json');
      if (!configJson) {
        configJson = await tryLoadConfig('config/config-llm.json');
      }

      if (!configJson) {
        throw new Error('Failed to load LLM config from lib/llm-config.json or config/config.json');
      }

      this.config = configJson;

      // Merge in any custom models the user has added previously (Branch B)
      const customStored = await chrome.storage.sync.get('browsemate_custom_llms');
      const customLlms = Array.isArray(customStored.browsemate_custom_llms)
        ? customStored.browsemate_custom_llms
        : [];

      if (Array.isArray(this.config.llms)) {
        this.config.llms = this.config.llms.concat(customLlms);
      } else {
        this.config.llms = customLlms;
      }

      // Load user settings from storage to get selected models and token
      // If a promptFile is configured for an LLM, load its contents as the prompt text
      if (Array.isArray(this.config.llms)) {
        for (const llm of this.config.llms) {
          if (llm.promptFile && !llm.prompt) {
            try {
              const promptUrl = chrome.runtime.getURL(llm.promptFile);
              const promptResp = await fetch(promptUrl);
              if (promptResp.ok) {
                llm.prompt = await promptResp.text();
              } else {
                console.warn(
                  '[LLMClient.initialize] Failed to load prompt file',
                  llm.promptFile,
                  promptResp.status
                );
              }
            } catch (e) {
              console.warn('[LLMClient.initialize] Error loading prompt file', llm.promptFile, e);
            }
          }
        }
      }

      // Load user settings from storage to get selected models and token
      const result = await chrome.storage.sync.get('browsemate_settings');
      const settings = result.browsemate_settings || {};

      // Determine a reasonable default model to select initially (Branch B logic)
      const defaultName =
        settings.plannerModel ||
        settings.executorModel ||
        settings.selectedLLM ||
        (this.config.llms && this.config.llms[0] ? this.config.llms[0].name : null);

      if (defaultName) {
        this.selectLLM(defaultName);
      }

      // Override token if user has set it in settings
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

    // Update settings
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
      promptFile: l.promptFile || null
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

  /**
   * Select a model based on settings key (e.g. "plannerModel" or "executorModel")
   * falling back to a reasonable default if needed, and apply the stored token.
   * (From Branch B)
   * @param {string} settingsKey
   */
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

  async generateCompletion(prompt, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.currentLLM) {
      throw new Error('No LLM configured');
    }

    if (!this.currentLLM.token || this.currentLLM.token === 'add-token-here') {
      throw new Error('Please configure your API token in Settings');
    }

    const {
      temperature = 0.7,
      maxTokens = 1024,
      messages = null
    } = options;

    const messagesList = messages || [{ role: 'user', content: prompt }];

    const requestBody = {
      model: this.currentLLM.MODEL,
      messages: messagesList,
      temperature,
      max_tokens: maxTokens
    };

    try {
      const response = await fetch(
        `${this.currentLLM.baseURL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.currentLLM.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.choices && data.choices.length > 0) {
        return data.choices[0].message.content || "No response generated.";
      } else {
        return JSON.stringify(data);
      }

    } catch (error) {
      console.error('LLM API Error:', error);
      throw error;
    }
  }

  async streamCompletion(prompt, onChunk, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.currentLLM) {
      throw new Error('No LLM configured');
    }

    if (!this.currentLLM.token || this.currentLLM.token === 'add-token-here') {
      throw new Error('Please configure your API token in Settings');
    }

    const {
      temperature = 0.7,
      maxTokens = 1024,
      messages = null
    } = options;

    const messagesList = messages || [{ role: 'user', content: prompt }];

    const requestBody = {
      model: this.currentLLM.MODEL,
      messages: messagesList,
      temperature,
      max_tokens: maxTokens,
      stream: true
    };

    try {
      const response = await fetch(
        `${this.currentLLM.baseURL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.currentLLM.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullContent += content;
                if (onChunk) {
                  onChunk(content);
                }
              }
            } catch (e) {
              console.warn('Failed to parse SSE chunk:', e);
            }
          }
        }
      }

      return fullContent;

    } catch (error) {
      console.error('LLM Stream Error:', error);
      throw error;
    }
  }

  async chat(messages, options = {}) {
    return await this.generateCompletion(null, { ...options, messages });
  }

  /**
   * Parse context object to extract structured data
   * @param {string|Object} context - Page context
   * @returns {Object} - Parsed context with url, title, html, text
   */
  _parseContext(context) {
    if (typeof context === 'string') {
      return { url: '', title: '', html: '', text: context };
    }

    if (context && typeof context === 'object') {
      return {
        url: context.url || '',
        title: context.title || '',
        html: context.html || '',
        text: context.text || ''
      };
    }

    return { url: '', title: '', html: '', text: '' };
  }

  /**
   * Task A: Planner LLM call - determines intent (question vs action vs plan)
   * Uses JSON-based tool planning with optional native tool calls.
   * This merges both branches:
   * - Branch B: tool planning & planner-prompt.js
   * - Branch A: "plan" intent & planner-prompt.txt fallback
   *
   * @param {string} context - Page context (HTML + text)
   * @param {string} userPrompt - User's question or request
   * @param {Array} tools - Array of available tools/actions
   * @returns {Promise<{intent: string, answer?: string, toolCalls?: Array, plan?: any}>}
   */
  async plannerCall(context, userPrompt, tools = null) {
    console.log('[LLMClient.plannerCall] Starting planner call');
    console.log('[LLMClient.plannerCall] User prompt:', userPrompt);
    console.log('[LLMClient.plannerCall] Context length:', context?.length || 0);
    console.log('[LLMClient.plannerCall] Tools provided:', tools ? tools.length : 0);

    if (!this.isInitialized) {
      console.log('[LLMClient.plannerCall] Not initialized, initializing...');
      await this.initialize();
      console.log('[LLMClient.plannerCall] Initialization complete');
    }

    // Ensure we are using the configured planner model (Branch B)
    await this._selectModelFromSettings('plannerModel');

    // For HF-style models, we often prefer JSON-based over native tools
    const useNativeTools = false;

    let systemMessage;
    let userMessage;
    let requestBody;

    if (useNativeTools && tools && tools.length > 0) {
      // Native tool calling approach (OpenAI-style)
      systemMessage = `You are a browser automation assistant. Your job is to either ANSWER questions OR PERFORM actions by calling tools.`;

      userMessage = `Page Context (first 8000 chars):
${context.substring(0, 8000)}

User Request: ${userPrompt}`;

      requestBody = {
        model: this.currentLLM.MODEL,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 512,
        tools: tools,
        tool_choice: 'auto'
      };
    } else {
      // JSON-based approach with planner-prompt.js or planner-prompt.txt fallback
      const parsedContext = this._parseContext(context);

      let systemFromGenerator = null;
      let userFromGenerator = null;
      let generatorLoaded = false;

      try {
        // Try the JS prompt generator (Branch B)
        const { generatePlannerSystemPrompt, generatePlannerUserMessage } = await import('./planner-prompt.js');
        systemFromGenerator = generatePlannerSystemPrompt(parsedContext, tools);
        userFromGenerator = generatePlannerUserMessage(userPrompt);
        generatorLoaded = true;
      } catch (e) {
        console.warn('[LLMClient.plannerCall] Failed to load planner-prompt.js, will fallback to txt prompt if available.', e);
      }

      if (generatorLoaded) {
        systemMessage = systemFromGenerator;
        userMessage = userFromGenerator;
      } else {
        // Fallback to Branch A-style static planner prompt file
        try {
          const promptUrl = chrome.runtime.getURL('config/planner-prompt.txt');
          const promptResponse = await fetch(promptUrl);
          if (!promptResponse.ok) {
            throw new Error(`Failed to load planner prompt: ${promptResponse.status}`);
          }
          systemMessage = await promptResponse.text();
          userMessage = `USER PROMPT: ${userPrompt}`;
        } catch (e) {
          console.warn('[LLMClient.plannerCall] Failed to load planner-prompt.txt fallback. Using generic system prompt.', e);
          systemMessage = 'You are a browser automation planner. Return ONLY valid JSON.';
          userMessage = `USER PROMPT: ${userPrompt}`;
        }
      }

      requestBody = {
        model: this.currentLLM.MODEL,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 1024
      };
    }

    try {
      console.log('[LLMClient.plannerCall] Calling API...');
      console.log('[LLMClient.plannerCall] Using native tools:', useNativeTools);

      const response = await fetch(
        `${this.currentLLM.baseURL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.currentLLM.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      console.log('[LLMClient.plannerCall] Response received:', data);

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from LLM');
      }

      const choice = data.choices[0];
      const message = choice.message;

      console.log('[LLMClient.plannerCall] Message:', message);

      // Native tool calls path
      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log('[LLMClient.plannerCall] Native tool calls detected:', message.tool_calls);
        return {
          intent: 'action',
          toolCalls: message.tool_calls
        };
      }

      if (message.content) {
        console.log('[LLMClient.plannerCall] Content received:', message.content);

        let jsonStr = message.content.trim();

        // Remove markdown code blocks if present
        if (jsonStr.includes('```')) {
          const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
          if (jsonMatch) {
            jsonStr = jsonMatch[1];
          }
        }

        // Find JSON object in response
        const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonObjMatch) {
          jsonStr = jsonObjMatch[0];
        }

        try {
          const parsed = JSON.parse(jsonStr);
          console.log('[LLMClient.plannerCall] Parsed JSON:', parsed);

          // Branch A + B unified intents

          // Question intent
          if (parsed.intent === 'question' && parsed.answer) {
            return {
              intent: 'question',
              answer: parsed.answer
            };
          }

          // Plan intent (Branch A format)
          if (parsed.intent === 'plan' && parsed.plan) {
            return {
              intent: 'plan',
              plan: parsed.plan
            };
          }

          // Action intent with multi-step plan (Branch B format)
          if (parsed.intent === 'action' && parsed.plan && Array.isArray(parsed.plan)) {
            console.log('[LLMClient.plannerCall] Multi-step plan detected with', parsed.plan.length, 'steps');
            return {
              intent: 'action',
              toolCalls: parsed.plan.map(step => ({
                step: step.step,
                description: step.description,
                function: {
                  name: step.function,
                  arguments: JSON.stringify(step.params)
                }
              }))
            };
          }

          // Action intent with single function/params
          if (parsed.intent === 'action' && parsed.function && parsed.params) {
            return {
              intent: 'action',
              toolCalls: [{
                function: {
                  name: parsed.function,
                  arguments: JSON.stringify(parsed.params)
                }
              }]
            };
          }

        } catch (parseError) {
          console.warn('[LLMClient.plannerCall] Failed to parse JSON, treating as plain answer:', parseError);
        }

        // Fallback: treat as text answer
        return {
          intent: 'question',
          answer: message.content
        };
      }

      throw new Error('Invalid response from LLM');

    } catch (error) {
      console.error('[LLMClient.plannerCall] Planner LLM call failed:', error);
      console.error('[LLMClient.plannerCall] Error message:', error.message);
      console.error('[LLMClient.plannerCall] Error stack:', error.stack);
      return {
        intent: 'question',
        answer: 'I encountered an error processing your request. Please try rephrasing it.'
      };
    }
  }

  /**
   * Task B: Actions LLM call - generates structured action parameters
   * Merged:
   * - Uses executor model selection (Branch B)
   * - Uses currentLLM.prompt as system prompt when provided (Branch A)
   * - Returns {selector, actionType, value, explanation}
   *
   * @param {string} context - Page HTML context
   * @param {{type: string, target: string, value?: string}} action - Action to perform
   * @returns {Promise<{selector: string, actionType: string, value: string, explanation: string}>}
   */
  async actionsCall(context, action) {
    console.log('[LLMClient.actionsCall] Starting actions call');
    console.log('[LLMClient.actionsCall] Action:', JSON.stringify(action, null, 2));
    console.log('[LLMClient.actionsCall] Context length:', context?.length || 0);

    if (!this.isInitialized) {
      console.log('[LLMClient.actionsCall] Not initialized, initializing...');
      await this.initialize();
      console.log('[LLMClient.actionsCall] Initialization complete');
    }

    // Ensure we are using the configured executor model (Branch B)
    await this._selectModelFromSettings('executorModel');

    // Use model-specific prompt if available (Branch A), otherwise generic
    const systemPrompt =
      this.currentLLM.prompt ||
      'You are a browser automation assistant that returns ONLY valid JSON describing how to act on the page.';

    const userMessage = `Page HTML (first 10000 chars):
${context.substring(0, 10000)}

Action to perform:
- Type: ${action.type}
- Target: ${action.target}
${action.value ? `- Value: ${action.value}` : ''}

Analyze the HTML and identify the unique CSS selector for the target element.

Return a JSON object in this exact format:
{
  "selector": "unique CSS selector for the target element",
  "actionType": "click | fill | scroll | hover",
  "value": "value to type (for fill actions) or "top"/"bottom" for scroll, or empty string for click/hover",
  "explanation": "brief explanation of what will be done"
}

Return ONLY valid JSON, no other text.`;

    try {
      console.log('[LLMClient.actionsCall] Calling generateCompletion with system + user messages...');
      const response = await this.generateCompletion(null, {
        temperature: 0.2,
        maxTokens: 512,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      });

      console.log('[LLMClient.actionsCall] Response received, length:', response?.length || 0);
      console.log('[LLMClient.actionsCall] Raw response:', response);

      let jsonStr = response.trim();

      // Remove markdown code fences if present
      if (jsonStr.startsWith('```')) {
        const lines = jsonStr.split('\n');
        jsonStr = lines.slice(1, -1).join('\n').trim();
      }

      // Extract JSON object
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      console.log('[LLMClient.actionsCall] Parsing JSON...');
      const result = JSON.parse(jsonStr);
      console.log('[LLMClient.actionsCall] JSON parsed successfully:', result);

      if (!result.selector || !result.actionType) {
        console.error('[LLMClient.actionsCall] Missing required fields in result');
        throw new Error('LLM response missing selector or actionType');
      }

      console.log('[LLMClient.actionsCall] Actions call successful, returning result');

      return {
        selector: result.selector,
        actionType: result.actionType,
        value: result.value || '',
        explanation: result.explanation || 'Action prepared'
      };
    } catch (error) {
      console.error('[LLMClient.actionsCall] Actions LLM call failed:', error);
      console.error('[LLMClient.actionsCall] Error message:', error.message);
      console.error('[LLMClient.actionsCall] Error stack:', error.stack);
      throw new Error(`Failed to generate action parameters: ${error.message}`);
    }
  }
}

// Export the class for ES6 modules
export { LLMClient };

// Create a singleton instance for backward compatibility (used by script.js)
const llmClient = new LLMClient();

// Export singleton for non-module scripts
if (typeof window !== 'undefined') {
  window.llmClient = llmClient;
}