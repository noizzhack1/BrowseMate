// Executor LLM Client - handles action execution and web interactions
// Split from llm-client.js for better separation of concerns

import { extractHTMLContext } from './context-extractor.js';
// Import MCP client for external tool integration in executor
import { mcpClient } from './mcp-client.js';

class LLMExecutorClient {
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
                console.warn('[LLMExecutorClient.initialize] Failed to load prompt file', llm.promptFile, promptResp.status);
              }
            } catch (e) {
              console.warn('[LLMExecutorClient.initialize] Error loading prompt file', llm.promptFile, e);
            }
          }
        }
      }

      // Load user settings from storage
      const result = await chrome.storage.sync.get('browsemate_settings');
      const settings = result.browsemate_settings || {};

      // Determine default model
      const defaultName =
        settings.executorModel ||
        settings.plannerModel ||
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
      console.error('Failed to initialize LLM executor client:', error);
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

  getLLMByType(type) {
    if (!this.config || !this.config.llms) {
      console.warn('[getLLMByType] Config not loaded');
      return null;
    }
    return this.config.llms.find(llm => llm.type === type) || null;
  }

  _truncateContext(str, maxChars, label) {
    if (!str) return '';
    if (str.length <= maxChars) return str;

    const notice = `\n\n[${label} truncated to ${maxChars} characters to fit the model limit]`;
    const slicePoint = Math.max(0, maxChars - notice.length);
    return `${str.slice(0, slicePoint)}${notice}`;
  }

  _buildContextString(html, options = {}) {
    const {
      maxElements = 80,
      includeLinks = true,
      includeForms = true,
      htmlSnippetChars = 2000,
      budgetChars = 18000,
      label = 'context'
    } = options;

    let formatted = '';
    let summary = null;

    try {
      const extracted = extractHTMLContext(html, {
        maxElements,
        includeLinks,
        includeForms
      });
      formatted = extracted.formatted;
      summary = extracted.summary;
    } catch (error) {
      console.warn(`[LLMExecutorClient._buildContextString] Context extraction failed:`, error);
      formatted = '';
    }

    const snippet = html
      ? `\n\nPage HTML snippet (first ${htmlSnippetChars} chars):\n${html.substring(0, htmlSnippetChars)}`
      : '';

    const combined = (formatted && snippet) ? `${formatted}\n${snippet}` : `${formatted}${snippet}`;
    const safeContext = this._truncateContext(combined, budgetChars, label);

    return { context: safeContext, summary };
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

  /**
   * Executor LLM call - translates a high-level action into a specific WebAction tool call
   * Uses the executor model with function calling
   */
  async executorCall(context, action, actionIndex, retryContext = null, abortSignal = null, maxTokens = 1000) {
    console.log('[LLMExecutorClient.executorCall] Starting executor call');
    console.log('[LLMExecutorClient.executorCall] Action:', JSON.stringify(action, null, 2));
    console.log('[LLMExecutorClient.executorCall] Action index:', actionIndex);
    console.log('[LLMExecutorClient.executorCall] Context length:', context?.length || 0);

    if (!this.isInitialized) {
      await this.initialize();
    }

    // Get the executor LLM
    const executorLLM = this.getLLMByType('executor');
    if (!executorLLM) {
      throw new Error('No executor LLM configured in config.json');
    }

    console.log('[LLMExecutorClient.executorCall] Using executor LLM:', executorLLM.name);

    // Import action tools for function calling
    const { getActionTools } = await import('./action-tools.js');
    const webActionTools = getActionTools();
    console.log('[LLMExecutorClient.executorCall] Loaded', webActionTools.length, 'web action tools');

    // Get MCP tools from all enabled servers (same as planner)
    // This allows executor to use MCP tools when the planner chooses them
    let mcpTools = [];
    try {
      mcpTools = await mcpClient.getAllEnabledServerTools();
      console.log('[LLMExecutorClient.executorCall] Loaded', mcpTools.length, 'MCP tools');
    } catch (error) {
      console.warn('[LLMExecutorClient.executorCall] Failed to load MCP tools:', error);
      console.warn('[LLMExecutorClient.executorCall] Continuing with web action tools only');
    }

    // Combine both tool arrays (web actions first, then MCP tools)
    const tools = [...webActionTools, ...mcpTools];
    console.log('[LLMExecutorClient.executorCall] Total tools available:', tools.length);

    // Load the executor prompt from the text file
    const promptUrl = chrome.runtime.getURL('config/executor-prompt.txt');
    const promptResponse = await fetch(promptUrl);
    if (!promptResponse.ok) {
      throw new Error(`Failed to load executor prompt: ${promptResponse.status}`);
    }
    const systemMessage = await promptResponse.text();

    // Extract interactive elements + compact HTML snippet
    const { context: contextStr, summary: executorSummary } = this._buildContextString(context, {
      maxElements: 70,
      includeLinks: true,
      includeForms: true,
      htmlSnippetChars: 1200,
      budgetChars: 16000,
      label: 'executor context'
    });
    if (executorSummary) {
      console.log('[LLMExecutorClient.executorCall] Extracted elements:', executorSummary);
    }

    // Generate user message with extracted context and action
    let userMessage = `Page Context:
${contextStr}

Action to execute:
Type: ${action.action}
Description: ${action.description}
`;

    // Determine temperature based on retry context
    let temperature = 0.1;

    // Add retry information if this is a retry attempt
    if (retryContext && retryContext.previousAttempts && retryContext.previousAttempts.length > 0) {
      temperature = 0.3;

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

      const lastAttempt = retryContext.previousAttempts[retryContext.previousAttempts.length - 1];
      if (lastAttempt.webAction.name === 'clickButton' &&
          (retryContext.lastError.includes('Button not found') || retryContext.lastError.includes('not found'))) {
        userMessage += `   ⚠️⚠️ CRITICAL: You used clickButton but got "Button not found"!\n`;
        userMessage += `   → This likely means it's an <a> tag (link), NOT a <button>!\n`;
        userMessage += `   → CHECK THE HTML and use clickLink instead!\n`;
      } else if (lastAttempt.webAction.name === 'clickLink' &&
                 (retryContext.lastError.includes('Link not found') || retryContext.lastError.includes('not found'))) {
        userMessage += `   ⚠️⚠️ CRITICAL: You used clickLink but got "Link not found"!\n`;
        userMessage += `   → Maybe it's actually a <button>, not an <a> tag?\n`;
        userMessage += `   → CHECK THE HTML and try clickButton or click with selector!\n`;
      }

      userMessage += `   - If clickButton failed → Try clickLink (element might be <a> tag)\n`;
      userMessage += `   - If selector-based tool failed → Try text-based tool\n`;
      userMessage += `   - If text-based tool failed → Try selector-based tool\n`;
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
      max_tokens: maxTokens
    };

    try {
      console.log('[LLMExecutorClient.executorCall] Calling executor API...');

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
      console.log('[LLMExecutorClient.executorCall] Response received');

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from executor LLM');
      }

      const message = data.choices[0].message;
      const finishReason = data.choices[0].finish_reason;

      // Check if response was truncated
      if (finishReason === 'length') {
        console.warn('[LLMExecutorClient.executorCall] Response truncated');
        throw new Error(`TRUNCATED_RESPONSE:${requestBody.max_tokens}`);
      }

      // Check for tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const functionName = toolCall.function.name;

        let functionArgs;
        try {
          functionArgs = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          console.error('[LLMExecutorClient.executorCall] Failed to parse arguments:', parseError);
          if (parseError.message.includes('EOF') || parseError.message.includes('Unexpected end')) {
            throw new Error(`TRUNCATED_RESPONSE:${requestBody.max_tokens}`);
          }
          throw new Error(`Failed to parse function arguments: ${parseError.message}`);
        }

        return {
          webAction: {
            name: functionName,
            params: functionArgs
          },
          explanation: `Executing ${functionName} with params: ${JSON.stringify(functionArgs)}`
        };
      }

      throw new Error('Executor LLM did not return a tool call');

    } catch (error) {
      if (error.name === 'AbortError' || (abortSignal && abortSignal.aborted)) {
        throw new Error('Request cancelled by user');
      }
      console.error('[LLMExecutorClient.executorCall] Failed:', error);
      throw error;
    }
  }

  /**
   * Actions LLM call - generates structured action parameters (legacy method)
   */
  async actionsCall(context, action) {
    console.log('[LLMExecutorClient.actionsCall] Starting actions call');
    console.log('[LLMExecutorClient.actionsCall] Action:', JSON.stringify(action, null, 2));

    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const systemPrompt = this.currentLLM.prompt || 'You are a browser automation assistant that returns ONLY valid JSON.';

      const { context: contextStr } = this._buildContextString(context, {
        maxElements: 80,
        includeLinks: true,
        includeForms: true,
        htmlSnippetChars: 1500,
        budgetChars: 16000,
        label: 'actions context'
      });

      const userMessage = `${contextStr}

Action to perform:
- Type: ${action.type}
- Target: ${action.target}
${action.value ? `- Value: ${action.value}` : ''}

Return ONLY valid JSON describing how to execute this action on the page.`;

      const response = await this.generateCompletion(null, {
        temperature: 0.2,
        maxTokens: 1200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      });

      let jsonStr = response.trim();

      if (jsonStr.startsWith('```')) {
        const lines = jsonStr.split('\n');
        jsonStr = lines.slice(1, -1).join('\n').trim();
      }

      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const result = JSON.parse(jsonStr);

      if (!result.selector || !result.actionType) {
        throw new Error('LLM response missing selector or actionType');
      }

      return {
        selector: result.selector,
        actionType: result.actionType,
        value: result.value || '',
        explanation: result.explanation || 'Action prepared'
      };
    } catch (error) {
      console.error('[LLMExecutorClient.actionsCall] Failed:', error);
      throw new Error(`Failed to generate action parameters: ${error.message}`);
    }
  }
}

export { LLMExecutorClient };
