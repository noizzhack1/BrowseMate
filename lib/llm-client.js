// Browser-compatible LLM client for Chrome extension
// Reads configuration from llm-config.json and provides unified interface

class LLMClient {
  constructor() {
    this.config = null;
    this.currentLLM = null;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Fetch the main LLM config file (extension root -> config folder)
      const configUrl = chrome.runtime.getURL('config/config.json');
      const response = await fetch(configUrl);

      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.status}`);
      }

      this.config = await response.json();

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
   * Task A: Planner LLM call - determines intent (question vs plan)
   * NOTE: This is a PLANNER ONLY - it creates plans but does NOT execute actions
   * @param {string} context - Page context (HTML + text)
   * @param {string} userPrompt - User's question or request
   * @param {Array} tools - Array of available tools/actions (for reference only)
   * @returns {Promise<{intent: string, answer?: string, plan?: Object}>}
   */
  async plannerCall(context, userPrompt, tools = null) {
    console.log('[LLMClient.plannerCall] Starting planner call (planning mode only)');
    console.log('[LLMClient.plannerCall] User prompt:', userPrompt);
    console.log('[LLMClient.plannerCall] Context length:', context?.length || 0);
    console.log('[LLMClient.plannerCall] Tools provided for reference:', tools ? tools.length : 0);

    if (!this.isInitialized) {
      console.log('[LLMClient.plannerCall] Not initialized, initializing...');
      await this.initialize();
      console.log('[LLMClient.plannerCall] Initialization complete');
    }

    // Load the planner prompt from the text file
    const promptUrl = chrome.runtime.getURL('config/planner-prompt.txt');
    const promptResponse = await fetch(promptUrl);
    if (!promptResponse.ok) {
      throw new Error(`Failed to load planner prompt: ${promptResponse.status}`);
    }
    const systemMessage = await promptResponse.text();
    console.log('[LLMClient.plannerCall] systemMessage loaded from txt file');

    // Generate user message with the user's prompt
    const userMessage = `USER PROMPT: ${userPrompt}`;

    const requestBody = {
      model: this.currentLLM.MODEL,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 1024
      // NOTE: No tools parameter - planner does not execute, only describes
    };

    try {
      console.log('[LLMClient.plannerCall] Calling API in planner mode...');

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
   * Executor LLM call - executes a single action and returns status
   * Uses the executor model (smaller, faster) to interpret and execute one action
   * @param {string} context - Page HTML context
   * @param {Object} action - Action to execute with {action: string, description: string}
   * @param {number} actionIndex - Index of the action in the list
   * @returns {Promise<{status: string, reason: string, observation: string}>}
   */
  async executorCall(context, action, actionIndex) {
    console.log('[LLMClient.executorCall] Starting executor call');
    console.log('[LLMClient.executorCall] Action:', JSON.stringify(action, null, 2));
    console.log('[LLMClient.executorCall] Action index:', actionIndex);
    console.log('[LLMClient.executorCall] Context length:', context?.length || 0);

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

    // Load the executor prompt from the text file
    const promptUrl = chrome.runtime.getURL('config/executor-prompt.txt');
    const promptResponse = await fetch(promptUrl);
    if (!promptResponse.ok) {
      throw new Error(`Failed to load executor prompt: ${promptResponse.status}`);
    }
    const systemMessage = await promptResponse.text();
    console.log('[LLMClient.executorCall] Executor prompt loaded from txt file');

    // Generate user message with context and action
    const userMessage = `Page Context (first 5000 chars):
${context.substring(0, 5000)}

Action to execute:
ID: ${actionIndex}
Type: ${action.action}
Description: ${action.description}

Execute this single action and report the result.`;

    const requestBody = {
      model: executorLLM.MODEL,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.2,
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

      if (message.content) {
        console.log('[LLMClient.executorCall] Content received:', message.content);

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
          console.log('[LLMClient.executorCall] Parsed JSON:', parsed);

          // Extract the result for this specific action
          if (parsed.executed_actions && parsed.executed_actions.length > 0) {
            const actionResult = parsed.executed_actions[0];
            return {
              status: actionResult.status || 'unknown',
              reason: actionResult.reason || 'No reason provided',
              observation: actionResult.observation || 'No observation',
              done: parsed.done || false,
              overall_observation: parsed.overall_observation || '',
              challenges: parsed.challenges || '',
              next_hint: parsed.next_hint_for_planner || ''
            };
          } else {
            throw new Error('No executed_actions in response');
          }
        } catch (parseError) {
          console.warn('[LLMClient.executorCall] Failed to parse JSON:', parseError);
          throw new Error(`Failed to parse executor response: ${parseError.message}`);
        }
      }

      throw new Error('Invalid response from executor LLM');

    } catch (error) {
      console.error('[LLMClient.executorCall] Executor call failed:', error);
      console.error('[LLMClient.executorCall] Error message:', error.message);
      console.error('[LLMClient.executorCall] Error stack:', error.stack);
      throw error;
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
