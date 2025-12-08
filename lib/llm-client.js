class LLMClient {
  constructor() {
    this.config = null;
    this.currentLLM = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Fetch the config.json file from the config folder
      // This file defines all available LLMs and their roles (planner / executor)
      const configUrl = chrome.runtime.getURL('config/config.json');
      const response = await fetch(configUrl);

      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.status}`);
      }

      this.config = await response.json();

      // Load user settings from storage to get selected LLM and token
      const result = await chrome.storage.sync.get('browsemate_settings');
      const settings = result.browsemate_settings || {};

      // Determine which LLM to use
      const llmName = settings.selectedLLM || this.config.llms[0]?.name;
      this.selectLLM(llmName);

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

    return {
      name: this.currentLLM.name,
      model: this.currentLLM.MODEL,
      baseURL: this.currentLLM.baseURL,
      type: this.currentLLM.type || 'general',
      promptFile: this.currentLLM.promptFile || null
    };
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
   * Task A: Planner LLM call - determines intent (question vs action) using tool calling
   * @param {string} context - Page context (HTML + text)
   * @param {string} userPrompt - User's question or request
   * @param {Array} tools - Array of available tools/actions
   * @returns {Promise<{intent: string, answer?: string, toolCalls?: Array}>}
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

    // For models that may not support native tool calling, use JSON output instead
    const useNativeTools = false; // Set to false for better compatibility with HuggingFace models

    let systemMessage, userMessage, requestBody;

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
      // JSON-based approach (more compatible)
      // Import the prompt generator
      const { generatePlannerSystemPrompt, generatePlannerUserMessage } = await import('./planner-prompt.js');

      // Parse context to structured format
      const parsedContext = this._parseContext(context);

      // Generate enhanced system prompt
      systemMessage = generatePlannerSystemPrompt(parsedContext, tools);

      // Generate user message
      userMessage = generatePlannerUserMessage(userPrompt);

      requestBody = {
        model: this.currentLLM.MODEL,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 1024  // Increased to allow for multi-step plans
      };
    }

    try {
      console.log('[LLMClient.plannerCall] Calling API...');
      console.log('[LLMClient.plannerCall] Using native tools:', useNativeTools);

      // Make the API call
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

      // Handle native tool calls (if supported)
      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log('[LLMClient.plannerCall] Native tool calls detected:', message.tool_calls);
        return {
          intent: 'action',
          toolCalls: message.tool_calls
        };
      }

      // Handle JSON-based response
      if (message.content) {
        console.log('[LLMClient.plannerCall] Content received:', message.content);

        // Try to extract JSON from the response
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

          if (parsed.intent === 'question' && parsed.answer) {
            return {
              intent: 'question',
              answer: parsed.answer
            };
          } else if (parsed.intent === 'action' && parsed.plan && Array.isArray(parsed.plan)) {
            // Multi-step action plan
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
          } else if (parsed.intent === 'action' && parsed.function && parsed.params) {
            // Single action - convert to tool call format
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

        // If we couldn't parse as JSON, treat the whole content as an answer
        return {
          intent: 'question',
          answer: message.content
        };
      }

      // Fallback
      throw new Error('Invalid response from LLM');

    } catch (error) {
      console.error('[LLMClient.plannerCall] Planner LLM call failed:', error);
      console.error('[LLMClient.plannerCall] Error message:', error.message);
      console.error('[LLMClient.plannerCall] Error stack:', error.stack);
      // Fallback: treat as question if error occurs
      return {
        intent: 'question',
        answer: 'I encountered an error processing your request. Please try rephrasing it.'
      };
    }
  }

  /**
   * Task B: Actions LLM call - generates structured action parameters
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

    console.log('[LLMClient.actionsCall] Building action prompt...');
    const actionPrompt = `You are a browser automation assistant. Determine the precise CSS selector and action parameters to perform the requested action on the page.

Page HTML (first 10000 chars):
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
  "value": "value to type (for fill actions) or 'bottom'/'top' (for scroll)",
  "explanation": "brief explanation of what will be done"
}

Return ONLY valid JSON, no other text.`;

    try {
      console.log('[LLMClient.actionsCall] Calling generateCompletion...');
      const response = await this.generateCompletion(actionPrompt, {
        temperature: 0.2,
        maxTokens: 512
      });
      console.log('[LLMClient.actionsCall] Response received, length:', response?.length || 0);
      console.log('[LLMClient.actionsCall] Response:', response);

      // Try to extract JSON from response
      console.log('[LLMClient.actionsCall] Extracting JSON from response...');
      let jsonStr = response.trim();
      
      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```')) {
        const lines = jsonStr.split('\n');
        jsonStr = lines.slice(1, -1).join('\n').trim();
      }
      
      // Find JSON object in response
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      console.log('[LLMClient.actionsCall] Parsing JSON...');
      const result = JSON.parse(jsonStr);
      console.log('[LLMClient.actionsCall] JSON parsed successfully');
      console.log('[LLMClient.actionsCall] Selector:', result.selector);
      
      // Validate result structure
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
