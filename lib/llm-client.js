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

      configJson = await tryLoadConfig('config/config.json');
      if (!configJson) {
        configJson = await tryLoadConfig('config/config-llm.json');
      }

      if (!configJson) {
        throw new Error('Failed to load LLM config from config/config.json or config/config-llm.json');
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

      // Load user settings from storage to get selected LLM and token
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
   * @param {AbortSignal} abortSignal - Signal to cancel the request
   * @param {Array} conversationHistory - Recent conversation history [{role, content}, ...]
   * @returns {Promise<{intent: string, answer?: string, toolCalls?: Array, plan?: any}>}
   */
  async plannerCall(context, userPrompt, tools = null, abortSignal = null, conversationHistory = []) {
    console.log('[LLMClient.plannerCall] Starting planner call (planning mode only)');
    console.log('[LLMClient.plannerCall] User prompt:', userPrompt);
    console.log('[LLMClient.plannerCall] Context length:', context?.length || 0);
    console.log('[LLMClient.plannerCall] Tools provided for reference:', tools ? tools.length : 0);
    console.log('[LLMClient.plannerCall] Conversation history length:', conversationHistory.length);

    if (!this.isInitialized) {
      console.log('[LLMClient.plannerCall] Not initialized, initializing...');
      await this.initialize();
      console.log('[LLMClient.plannerCall] Initialization complete');
    }

    // Ensure we are using the configured planner model (Branch B)
    await this._selectModelFromSettings('plannerModel');

    // For HF-style models, we often prefer JSON-based over native tools
    const useNativeTools = false;

    // Declare variables before conditional blocks
    let systemMessage;
    let userMessage;
    let requestBody;

    if (useNativeTools && tools && tools.length > 0) {
      // Native tool calling approach (OpenAI-style)
      systemMessage = `You are a browser automation assistant. Your job is to either ANSWER questions OR PERFORM actions by calling tools.`;

      userMessage = `Page Context (first 8000 chars):
${context.substring(0, 8000)}

User Request: ${userPrompt}`;

      // Build messages array with conversation history
      const messages = [{ role: 'system', content: systemMessage }];

      // Add conversation history (excluding the most recent user message which is in userPrompt)
      if (conversationHistory && conversationHistory.length > 0) {
        messages.push(...conversationHistory);
      }

      // Add current user message
      messages.push({ role: 'user', content: userMessage });

      requestBody = {
        model: this.currentLLM.MODEL,
        messages: messages,
        temperature: 0.3,
        max_tokens: 512,
        tools: tools,
        tool_choice: 'auto'
      };
    } else {
      // Load planner prompt from txt file
      let systemFromGenerator = null;
      let userFromGenerator = null;
      let generatorLoaded = false;

      // Load planner prompt from txt file
      try {
        const promptUrl = chrome.runtime.getURL('config/planner-prompt.txt');
        const promptResponse = await fetch(promptUrl);
        if (promptResponse.ok) {
          systemFromGenerator = await promptResponse.text();
          // Include context in user message so planner knows current page state
          userFromGenerator = `CURRENT PAGE CONTEXT (first 8000 chars):
${context.substring(0, 8000)}

USER PROMPT: ${userPrompt}`;
          generatorLoaded = true;
        }
      } catch (e) {
        console.warn('[LLMClient.plannerCall] Failed to load planner-prompt.txt', e);
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
          // Include context in user message
          userMessage = `CURRENT PAGE CONTEXT (first 8000 chars):
${context.substring(0, 8000)}

USER PROMPT: ${userPrompt}`;
        } catch (e) {
          console.warn('[LLMClient.plannerCall] Failed to load planner-prompt.txt fallback. Using generic system prompt.', e);
          systemMessage = 'You are a browser automation planner. Analyze the page context and user prompt, then decide to either answer questions or create action plans. Return ONLY valid JSON.';
          userMessage = `CURRENT PAGE CONTEXT (first 8000 chars):
${context.substring(0, 8000)}

USER PROMPT: ${userPrompt}`;
        }
      }

      // Build messages array with conversation history
      const messages = [{ role: 'system', content: systemMessage }];

      // Add conversation history (excluding the most recent user message which is in userPrompt)
      if (conversationHistory && conversationHistory.length > 0) {
        messages.push(...conversationHistory);
      }

      // Add current user message
      messages.push({ role: 'user', content: userMessage });

      requestBody = {
        model: this.currentLLM.MODEL,
        messages: messages,
        temperature: 0.3,
        max_tokens: 1024
      };
    }

    try {
      // Check if request was aborted
      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user');
      }

      console.log('[LLMClient.plannerCall] Calling API in planner mode...');

      const response = await fetch(
        `${this.currentLLM.baseURL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.currentLLM.token}`,
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

      // Handle JSON-based response
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

          // Handle actions array format (new planner prompt)
          if (parsed.actions && Array.isArray(parsed.actions)) {
            console.log('[LLMClient.plannerCall] Actions detected:', parsed.actions);

            // Generate user-friendly task list with unchecked radio buttons
            const taskList = parsed.actions.map((action) => {
              return `○ ${action.description}`;
            }).join('\n');

            const displayMessage = parsed.actions.length > 0
              ? `I've planned the following steps:\n\n${taskList}`
              : 'No actions needed for this request.';

            // Log actions array to console
            console.log('=== ACTIONS LIST ===');
            console.log('Total actions:', parsed.actions.length);
            parsed.actions.forEach((action, index) => {
              console.log(`\nAction ${index + 1}:`);
              console.log('  Type:', action.action);
              console.log('  Description:', action.description);
            });
            console.log('===================');

            return {
              intent: 'plan',
              taskList: displayMessage,
              actions: parsed.actions
            };
          }

          // Handle question intent (fallback for backward compatibility)
          if (parsed.intent === 'question' && parsed.answer) {
            return {
              intent: 'question',
              answer: parsed.answer
            };
          }

          // Handle plan intent (old format - backward compatibility)
          if (parsed.intent === 'plan' && parsed.plan) {
            console.log('[LLMClient.plannerCall] Plan detected:', parsed.plan);
            return {
              intent: 'plan',
              plan: parsed.plan
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
      // Check if request was aborted
      if (error.name === 'AbortError' || (abortSignal && abortSignal.aborted)) {
        throw new Error('Request cancelled by user');
      }
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
   * Get LLM by type (planner, executor, etc.)
   * @param {string} type - LLM type to select
   * @returns {Object|null} - LLM configuration or null if not found
   */
  getLLMByType(type) {
    if (!this.config || !this.config.llms) {
      console.warn('[getLLMByType] Config not loaded');
      return null;
    }
    return this.config.llms.find(llm => llm.type === type) || null;
  }

  /**
   * Executor LLM call - translates a high-level action into a specific WebAction tool call
   * Uses the executor model (smaller, faster) with function calling
   * @param {string} context - Page HTML context
   * @param {Object} action - Action to execute with {action: string, description: string}
   * @param {number} actionIndex - Index of the action in the list
   * @param {Object} retryContext - Optional retry context with {previousAttempts: Array, lastError: string}
   * @param {AbortSignal} abortSignal - Signal to cancel the request
   * @returns {Promise<{webAction: {name: string, params: Object}, explanation: string}>}
   */
  async executorCall(context, action, actionIndex, retryContext = null, abortSignal = null) {
    console.log('[LLMClient.executorCall] Starting executor call');
    console.log('[LLMClient.executorCall] Action:', JSON.stringify(action, null, 2));
    console.log('[LLMClient.executorCall] Action index:', actionIndex);
    console.log('[LLMClient.executorCall] Context length:', context?.length || 0);
    console.log('[LLMClient.executorCall] Retry context:', retryContext ? 'Yes' : 'No');

    if (!this.isInitialized) {
      console.log('[LLMClient.executorCall] Not initialized, initializing...');
      await this.initialize();
      console.log('[LLMClient.executorCall] Initialization complete');
    }

    // Get the executor LLM
    const executorLLM = this.getLLMByType('executor');
    if (!executorLLM) {
      throw new Error('No executor LLM configured in config.json');
    }

    console.log('[LLMClient.executorCall] Using executor LLM:', executorLLM.name);

    // Import action tools for function calling
    const { getActionTools } = await import('./action-tools.js');
    const tools = getActionTools();
    console.log('[LLMClient.executorCall] Loaded', tools.length, 'action tools for function calling');

    // Load the executor prompt from the text file
    const promptUrl = chrome.runtime.getURL('config/executor-prompt.txt');
    const promptResponse = await fetch(promptUrl);
    if (!promptResponse.ok) {
      throw new Error(`Failed to load executor prompt: ${promptResponse.status}`);
    }
    const systemMessage = await promptResponse.text();
    console.log('[LLMClient.executorCall] Executor prompt loaded from txt file');

    // Generate user message with context and action
    let userMessage = `Page Context (first 5000 chars):
${context.substring(0, 5000)}

Action to execute:
Type: ${action.action}
Description: ${action.description}
`;

    // Determine temperature based on retry context
    // Higher temperature for retries to encourage different approaches
    let temperature = 0.2;

    // Add retry information if this is a retry attempt
    if (retryContext && retryContext.previousAttempts && retryContext.previousAttempts.length > 0) {
      temperature = 0.5; // Increase temperature for retries to get more creative solutions

      userMessage += `\n${'='.repeat(60)}\n`;
      userMessage += `⚠️⚠️⚠️ CRITICAL: THIS IS RETRY ATTEMPT ${retryContext.previousAttempts.length + 1} ⚠️⚠️⚠️\n`;
      userMessage += `${'='.repeat(60)}\n`;
      userMessage += `\nPREVIOUS ATTEMPTS FAILED! You MUST try something COMPLETELY DIFFERENT!\n`;
      userMessage += `Last error: ${retryContext.lastError}\n\n`;
      userMessage += `❌ FAILED ATTEMPTS (DO NOT REPEAT THESE):\n`;
      retryContext.previousAttempts.forEach((attempt) => {
        userMessage += `\n--- Attempt ${attempt.attempt} (FAILED) ---\n`;
        userMessage += `  ❌ Tool: ${attempt.webAction.name}\n`;
        userMessage += `  ❌ Params: ${JSON.stringify(attempt.webAction.params)}\n`;
        userMessage += `  ❌ Error: ${attempt.result.message}\n`;
      });
      userMessage += `\n${'='.repeat(60)}\n`;
      userMessage += `🔄 REQUIRED: Use a DIFFERENT tool or DIFFERENT selectors!\n`;
      userMessage += `💡 Suggestions:\n`;

      // Check if the error is about button not found with clickButton - common mistake!
      const lastAttempt = retryContext.previousAttempts[retryContext.previousAttempts.length - 1];
      if (lastAttempt.webAction.name === 'clickButton' &&
          (retryContext.lastError.includes('Button not found') || retryContext.lastError.includes('not found'))) {
        userMessage += `   ⚠️⚠️ CRITICAL: You used clickButton but got "Button not found"!\n`;
        userMessage += `   → This likely means it's an <a> tag (link), NOT a <button>!\n`;
        userMessage += `   → CHECK THE HTML and use clickLink instead!\n`;
        userMessage += `   → Navigation menus and tabs are ALWAYS links (<a> tags)!\n`;
      } else if (lastAttempt.webAction.name === 'clickLink' &&
                 (retryContext.lastError.includes('Link not found') || retryContext.lastError.includes('not found'))) {
        userMessage += `   ⚠️⚠️ CRITICAL: You used clickLink but got "Link not found"!\n`;
        userMessage += `   → Maybe it's actually a <button>, not an <a> tag?\n`;
        userMessage += `   → CHECK THE HTML and try clickButton or click with selector!\n`;
      }

      userMessage += `   - If clickButton failed → Try clickLink (element might be <a> tag)\n`;
      userMessage += `   - If selector-based tool failed → Try text-based tool (clickButton, clickLink)\n`;
      userMessage += `   - If text-based tool failed → Try selector-based tool (click with CSS selector)\n`;
      userMessage += `   - If specific selector failed → Try more generic selector or different attributes\n`;
      userMessage += `   - Try looking for similar elements with different selectors\n`;
      userMessage += `   - Consider if the element might be in a different location than expected\n`;
      userMessage += `${'='.repeat(60)}\n\n`;
    }

    userMessage += `\nSelect the appropriate web action tool and provide parameters.`;
    if (retryContext && retryContext.previousAttempts && retryContext.previousAttempts.length > 0) {
      userMessage += `\n⚠️ REMINDER: Your answer MUST be different from the failed attempts above!`;
    }

    const requestBody = {
      model: executorLLM.MODEL,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      tools: tools,
      tool_choice: 'required',
      temperature: temperature,
      max_tokens: 512
    };

    try {
      console.log('[LLMClient.executorCall] Calling executor API...');

      const response = await fetch(
        `${executorLLM.baseURL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${executorLLM.token}`,
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
      console.log('[LLMClient.executorCall] Response received:', data);

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from executor LLM');
      }

      const message = data.choices[0].message;
      console.log('[LLMClient.executorCall] Message:', message);

      // Check for tool calls (function calling response)
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        console.log('[LLMClient.executorCall] Tool call received:', toolCall);

        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        console.log('[LLMClient.executorCall] Function:', functionName);
        console.log('[LLMClient.executorCall] Arguments:', functionArgs);

        return {
          webAction: {
            name: functionName,
            params: functionArgs
          },
          explanation: `Executing ${functionName} with params: ${JSON.stringify(functionArgs)}`
        };
      }

      // Fallback: if no tool call, throw error
      throw new Error('Executor LLM did not return a tool call');

    } catch (error) {
      // Check if request was aborted
      if (error.name === 'AbortError' || (abortSignal && abortSignal.aborted)) {
        throw new Error('Request cancelled by user');
      }
      console.error('[LLMClient.executorCall] Executor call failed:', error);
      console.error('[LLMClient.executorCall] Error message:', error.message);
      console.error('[LLMClient.executorCall] Error stack:', error.stack);
      throw error;
    }
  }

  /**
   * Re-planner LLM call - Re-evaluates remaining actions after each step
   * @param {string} context - Current page HTML context
   * @param {string} originalUserPrompt - Original user request
   * @param {Array} completedActions - Array of completed actions with status
   * @param {Array} remainingActions - Array of remaining planned actions
   * @param {AbortSignal} abortSignal - Signal to cancel the request
   * @returns {Promise<{updatedActions: Array|null, reasoning: string}>}
   */
  async replanCall(context, originalUserPrompt, completedActions, remainingActions, abortSignal = null) {
    console.log('[LLMClient.replanCall] Starting re-plan call');
    console.log('[LLMClient.replanCall] Original prompt:', originalUserPrompt);
    console.log('[LLMClient.replanCall] Completed actions:', completedActions.length);
    console.log('[LLMClient.replanCall] Remaining actions:', remainingActions.length);
    console.log('[LLMClient.replanCall] Context length:', context?.length || 0);

    if (!this.isInitialized) {
      await this.initialize();
    }

    // Use planner LLM for re-planning (same strategic thinking required)
    // If no planner type is configured, fall back to current LLM
    const plannerLLM = this.getLLMByType('planner') || this.currentLLM;
    console.log('[LLMClient.replanCall] Using LLM:', plannerLLM.name);

    // Load the re-planner prompt
    const promptUrl = chrome.runtime.getURL('config/replanner-prompt.txt');
    let systemMessage;
    try {
      const promptResponse = await fetch(promptUrl);
      if (!promptResponse.ok) {
        throw new Error(`Failed to load replanner prompt: ${promptResponse.status}`);
      }
      systemMessage = await promptResponse.text();
      console.log('[LLMClient.replanCall] Re-planner prompt loaded from txt file');
    } catch (error) {
      console.warn('[LLMClient.replanCall] Could not load replanner-prompt.txt, using default');
      // Fallback prompt if file doesn't exist yet
      systemMessage = `You are a task re-planner. After each action execution, you evaluate whether the remaining planned actions are still relevant or need adjustment.

Your job:
1. Review what's been completed so far
2. Check the current page state
3. Decide if the remaining actions are still appropriate
4. Update the plan if needed

Output valid JSON:
{
  "updatedActions": [/* array of action objects, or null if no changes */],
  "reasoning": "Brief explanation of why you kept or changed the plan"
}

If the remaining actions are still good, return {"updatedActions": null, "reasoning": "Plan is still valid"}`;
    }

    // Build summary of completed actions with failure reasons
    const completedSummary = completedActions.map((a, idx) => {
      let line = `${idx + 1}. ${a.description} - Status: ${a.status}`;
      if (a.reason) {
        line += ` (Reason: ${a.reason})`;
      }
      return line;
    }).join('\n');

    // Build summary of remaining actions
    const remainingSummary = remainingActions.map((a, idx) =>
      `${idx + 1}. ${a.description}`
    ).join('\n');

    const userMessage = `Original User Request: "${originalUserPrompt}"

Completed Actions:
${completedSummary}

Current Page Context (first 5000 chars):
${context.substring(0, 5000)}

Remaining Planned Actions:
${remainingSummary}

Should these remaining actions be kept, modified, or replaced? Output your decision as JSON.`;

    const requestBody = {
      model: plannerLLM.MODEL,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 1024
    };

    try {
      // Check if request was aborted
      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user');
      }

      console.log('[LLMClient.replanCall] Calling API...');

      const response = await fetch(
        `${plannerLLM.baseURL}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${plannerLLM.token}`,
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
      console.log('[LLMClient.replanCall] Response received:', data);

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from LLM');
      }

      const message = data.choices[0].message;

      if (message.content) {
        // Try to extract JSON from response
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
          console.log('[LLMClient.replanCall] Parsed result:', parsed);

          return {
            updatedActions: parsed.updatedActions,
            reasoning: parsed.reasoning || 'No reasoning provided'
          };
        } catch (parseError) {
          console.warn('[LLMClient.replanCall] Failed to parse JSON:', parseError);
          // If parse fails, keep original plan
          return {
            updatedActions: null,
            reasoning: 'Failed to parse re-plan response, keeping original plan'
          };
        }
      }

      // Fallback: keep original plan
      return {
        updatedActions: null,
        reasoning: 'No valid response, keeping original plan'
      };

    } catch (error) {
      // Check if request was aborted
      if (error.name === 'AbortError' || (abortSignal && abortSignal.aborted)) {
        throw new Error('Request cancelled by user');
      }
      console.error('[LLMClient.replanCall] Re-plan call failed:', error);
      // On error, keep original plan
      return {
        updatedActions: null,
        reasoning: `Re-plan error: ${error.message}, keeping original plan`
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

    try {
      console.log('[LLMClient.actionsCall] Building messages from config prompt + context...');

      // Use the LLM's configured prompt (from llm-config.json) as the system message,
      // and send the concrete HTML + action details as the user message.
      const systemPrompt = this.currentLLM.prompt || 'You are a browser automation assistant that returns ONLY valid JSON.';

      const userMessage = `Page HTML (first 10000 chars):
${context.substring(0, 10000)}

Action to perform:
- Type: ${action.type}
- Target: ${action.target}
${action.value ? `- Value: ${action.value}` : ''}

Return ONLY valid JSON describing how to execute this action on the page.`;

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

  /**
   * Goal Verification: Check if the user's actual goal was achieved
   * Called after all actions complete to verify the final page state matches the user's intent
   *
   * @param {string} context - Final page HTML context after all actions
   * @param {string} originalUserPrompt - The original user request/goal
   * @param {Array} executedActions - Array of actions that were executed with their results
   * @param {AbortSignal} abortSignal - Signal to cancel the request
   * @returns {Promise<{achieved: boolean, message: string}>}
   */
  async verifyGoalCall(context, originalUserPrompt, executedActions, abortSignal = null) {
    console.log('[LLMClient.verifyGoalCall] Starting goal verification');
    console.log('[LLMClient.verifyGoalCall] Original goal:', originalUserPrompt);
    console.log('[LLMClient.verifyGoalCall] Actions executed:', executedActions?.length || 0);
    console.log('[LLMClient.verifyGoalCall] Context length:', context?.length || 0);

    if (!this.isInitialized) {
      console.log('[LLMClient.verifyGoalCall] Not initialized, initializing...');
      await this.initialize();
      console.log('[LLMClient.verifyGoalCall] Initialization complete');
    }

    try {
      // Build summary of executed actions
      const actionsSummary = executedActions.map((result, index) => {
        return `${index + 1}. ${result.action?.description || 'Action'} - Status: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
      }).join('\n');

      // Use planner model for verification (more capable)
      const plannerLLM = (this.config && this.config.llms)
        ? this.config.llms.find(llm => llm.type === 'planner')
        : null;
      const selectedLLM = plannerLLM || this.currentLLM;
      console.log('[LLMClient.verifyGoalCall] Using model:', selectedLLM ? selectedLLM.name : 'default');

      const systemPrompt = `You are a goal verification assistant. Your job is to check if a user's goal was actually achieved after executing web actions, and provide helpful feedback.

CRITICAL RULES:
1. Focus on the USER'S ORIGINAL GOAL, not just whether actions succeeded
2. Check the FINAL PAGE CONTEXT to see if it matches what the user wanted
3. Return JSON format: {"achieved": true/false, "message": "explanation", "whatsMissing": "optional - what's needed to complete the goal"}

Examples:
- User goal: "Play Coldplay songs" → Check if a Coldplay video is actually PLAYING (not just search results showing)
  - If on search results: achieved=false, whatsMissing="Need to click on a video to start playing"
- User goal: "Search for cats" → Check if search results for "cats" are VISIBLE on screen
  - If results showing: achieved=true
- User goal: "Go to YouTube" → Check if the current page is actually YouTube
  - If on youtube.com: achieved=true

Be strict but fair. If the page shows the right content but user needs one more click, return achieved: false and explain what's missing.

Your response MUST be valid JSON in this exact format:
{
  "achieved": true or false,
  "message": "Clear explanation of current state and whether goal is achieved",
  "whatsMissing": "If achieved=false, explain what specific action is still needed"
}`;


      const userMessage = `USER'S ORIGINAL GOAL:
${originalUserPrompt}

ACTIONS THAT WERE EXECUTED:
${actionsSummary}

CURRENT PAGE STATE (first 8000 chars of HTML):
${context.substring(0, 8000)}

TASK: Analyze if the user's ORIGINAL GOAL was achieved. Look at the current page HTML and determine:
1. Does the page content match what the user wanted?
2. Is the user's goal ACTUALLY complete, or are there more steps needed?
3. Consider the user's intent, not just technical success
4. If NOT achieved, identify EXACTLY what action is still missing

Return ONLY valid JSON in this exact format:
{
  "achieved": true or false,
  "message": "Brief explanation of current state and whether goal was achieved",
  "whatsMissing": "If achieved=false, specific action needed to complete the goal (e.g., 'Click on the first video', 'Submit the form', etc.)"
}`;

      console.log('[LLMClient.verifyGoalCall] Calling LLM for verification...');

      // Check abort before API call
      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user');
      }

      const response = await this.generateCompletion(null, {
        temperature: 0.1, // Low temperature for consistent verification
        maxTokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      });

      // Check abort after API call
      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user');
      }

      console.log('[LLMClient.verifyGoalCall] Response received:', response);

      // Parse JSON response
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

      console.log('[LLMClient.verifyGoalCall] Parsing JSON...');
      const result = JSON.parse(jsonStr);
      console.log('[LLMClient.verifyGoalCall] Parsed result:', result);

      // Validate result structure
      if (typeof result.achieved !== 'boolean') {
        console.error('[LLMClient.verifyGoalCall] Invalid result structure - missing achieved boolean');
        throw new Error('Invalid verification result: missing "achieved" field');
      }

      console.log('[LLMClient.verifyGoalCall] Verification complete - Goal achieved:', result.achieved);
      if (result.whatsMissing) {
        console.log('[LLMClient.verifyGoalCall] What\'s missing:', result.whatsMissing);
      }

      return {
        achieved: result.achieved,
        message: result.message || (result.achieved ? 'Goal achieved' : 'Goal not achieved'),
        whatsMissing: result.whatsMissing || null
      };
    } catch (error) {
      console.error('[LLMClient.verifyGoalCall] Goal verification failed:', error);
      console.error('[LLMClient.verifyGoalCall] Error message:', error.message);

      // On error, assume goal was not verified (fail safe)
      return {
        achieved: false,
        message: `Could not verify goal completion: ${error.message}`
      };
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