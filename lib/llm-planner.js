// Planner LLM Client - handles planning, question answering, and goal verification
// Split from llm-client.js for better separation of concerns

import { extractHTMLContext } from './context-extractor.js';

class LLMPlannerClient {
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
                console.warn('[LLMPlannerClient.initialize] Failed to load prompt file', llm.promptFile, promptResp.status);
              }
            } catch (e) {
              console.warn('[LLMPlannerClient.initialize] Error loading prompt file', llm.promptFile, e);
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
      console.error('Failed to initialize LLM planner client:', error);
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
      console.warn(`[LLMPlannerClient._buildContextString] Context extraction failed:`, error);
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
   * Planner LLM call - determines intent (question vs action vs plan)
   */
  async plannerCall(context, userPrompt, tools = null, abortSignal = null, conversationHistory = []) {
    console.log('[LLMPlannerClient.plannerCall] Starting planner call');
    console.log('[LLMPlannerClient.plannerCall] User prompt:', userPrompt);
    console.log('[LLMPlannerClient.plannerCall] Context length:', context?.length || 0);

    if (!this.isInitialized) {
      await this.initialize();
    }

    await this._selectModelFromSettings('plannerModel');

    let systemMessage;
    let userMessage;

    // Load planner prompt from txt file
    try {
      const promptUrl = chrome.runtime.getURL('config/planner-prompt.txt');
      const promptResponse = await fetch(promptUrl);
      if (promptResponse.ok) {
        systemMessage = await promptResponse.text();
        userMessage = `CURRENT PAGE CONTEXT (first 8000 chars):
${context.substring(0, 8000)}

USER PROMPT: ${userPrompt}`;
      } else {
        throw new Error('Failed to load prompt');
      }
    } catch (e) {
      console.warn('[LLMPlannerClient.plannerCall] Failed to load planner-prompt.txt, using fallback');
      systemMessage = 'You are a browser automation planner. Analyze the page context and user prompt, then decide to either answer questions or create action plans. Return ONLY valid JSON.';
      userMessage = `CURRENT PAGE CONTEXT (first 8000 chars):
${context.substring(0, 8000)}

USER PROMPT: ${userPrompt}`;
    }

    // Build messages array with conversation history
    const messages = [{ role: 'system', content: systemMessage }];

    if (conversationHistory && conversationHistory.length > 0) {
      messages.push(...conversationHistory);
    }

    messages.push({ role: 'user', content: userMessage });

    const requestBody = {
      model: this.currentLLM.MODEL,
      messages: messages,
      temperature: 0.3,
      max_tokens: 1024
    };

    try {
      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user');
      }

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

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from LLM');
      }

      const choice = data.choices[0];
      const message = choice.message;

      if (message.content) {
        let jsonStr = message.content.trim();

        // Remove markdown code blocks if present
        if (jsonStr.includes('```')) {
          const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
          if (jsonMatch) {
            jsonStr = jsonMatch[1];
          }
        }

        const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonObjMatch) {
          jsonStr = jsonObjMatch[0];
        }

        try {
          const parsed = JSON.parse(jsonStr);

          // Handle actions array format
          if (parsed.actions && Array.isArray(parsed.actions)) {
            const taskList = parsed.actions.map((action) => {
              return `○ ${action.description}`;
            }).join('\n');

            const displayMessage = parsed.actions.length > 0
              ? `I've planned the following steps:\n\n${taskList}`
              : 'No actions needed for this request.';

            return {
              intent: 'plan',
              taskList: displayMessage,
              actions: parsed.actions
            };
          }

          // Handle question intent
          if (parsed.intent === 'question' && parsed.answer) {
            return {
              intent: 'question',
              answer: parsed.answer
            };
          }

          // Handle plan intent (old format)
          if (parsed.intent === 'plan' && parsed.plan) {
            return {
              intent: 'plan',
              plan: parsed.plan
            };
          }

        } catch (parseError) {
          console.warn('[LLMPlannerClient.plannerCall] Failed to parse JSON:', parseError);
        }

        // Fallback: treat as text answer
        return {
          intent: 'question',
          answer: message.content
        };
      }

      throw new Error('Invalid response from LLM');

    } catch (error) {
      if (error.name === 'AbortError' || (abortSignal && abortSignal.aborted)) {
        throw new Error('Request cancelled by user');
      }
      console.error('[LLMPlannerClient.plannerCall] Failed:', error);
      return {
        intent: 'question',
        answer: 'I encountered an error processing your request. Please try rephrasing it.'
      };
    }
  }

  /**
   * Stream a question answer with structured thinking process
   */
  async streamQuestionAnswer(context, userPrompt, onChunk, abortSignal = null) {
    console.log('[LLMPlannerClient.streamQuestionAnswer] Starting streaming answer');

    if (!this.isInitialized) {
      await this.initialize();
    }

    await this._selectModelFromSettings('plannerModel');

    let systemMessage;
    try {
      const promptUrl = chrome.runtime.getURL('config/planner-prompt.txt');
      const promptResponse = await fetch(promptUrl);
      if (promptResponse.ok) {
        systemMessage = await promptResponse.text();
        systemMessage += '\n\nIMPORTANT: When answering questions, structure your response with:\n';
        systemMessage += '1. **Thinking Process** (list assumptions, reasoning steps, conclusions)\n';
        systemMessage += '2. **Answer** (clear, organized response using bullets, numbered steps, or short paragraphs)\n';
        systemMessage += 'Use markdown formatting for clarity (bullets, numbered lists, bold headings).';
      } else {
        throw new Error('Failed to load prompt');
      }
    } catch (e) {
      systemMessage = `You are a helpful assistant. When answering questions, reveal your thinking process in a structured way:
1. List your assumptions
2. Show your reasoning steps
3. Provide clear conclusions

Format your response with bullets, numbered steps, or short paragraphs for clarity. Use markdown formatting.`;
    }

    const userMessage = context
      ? `Page Context (first 8000 chars):\n${context.substring(0, 8000)}\n\nUser Question: ${userPrompt}`
      : `User Question: ${userPrompt}`;

    const requestBody = {
      model: this.currentLLM.MODEL,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 4000,
      stream: true
    };

    try {
      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user');
      }

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

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        if (abortSignal && abortSignal.aborted) {
          reader.cancel();
          throw new Error('Request cancelled by user');
        }

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
      if (error.name === 'AbortError' || (abortSignal && abortSignal.aborted)) {
        throw new Error('Request cancelled by user');
      }
      console.error('[LLMPlannerClient.streamQuestionAnswer] Error:', error);
      throw error;
    }
  }

  /**
   * Re-planner call - Re-evaluates remaining actions after each step
   */
  async replanCall(context, originalUserPrompt, completedActions, remainingActions, abortSignal = null) {
    console.log('[LLMPlannerClient.replanCall] Starting re-plan call');

    if (!this.isInitialized) {
      await this.initialize();
    }

    const plannerLLM = this.getLLMByType('planner') || this.currentLLM;

    // Load the re-planner prompt
    let systemMessage;
    try {
      const promptUrl = chrome.runtime.getURL('config/replanner-prompt.txt');
      const promptResponse = await fetch(promptUrl);
      if (!promptResponse.ok) {
        throw new Error(`Failed to load replanner prompt: ${promptResponse.status}`);
      }
      systemMessage = await promptResponse.text();
    } catch (error) {
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

    const completedSummary = completedActions.map((a, idx) => {
      let line = `${idx + 1}. ${a.description} - Status: ${a.status}`;
      if (a.reason) {
        line += ` (Reason: ${a.reason})`;
      }
      return line;
    }).join('\n');

    const remainingSummary = remainingActions.map((a, idx) =>
      `${idx + 1}. ${a.description}`
    ).join('\n');

    const { context: contextStr } = this._buildContextString(context, {
      maxElements: 60,
      includeLinks: true,
      includeForms: true,
      htmlSnippetChars: 1000,
      budgetChars: 14000,
      label: 'replan context'
    });

    const userMessage = `Original User Request: "${originalUserPrompt}"

Completed Actions:
${completedSummary}

Current Page Context:
${contextStr}

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
      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user');
      }

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

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from LLM');
      }

      const message = data.choices[0].message;

      if (message.content) {
        let jsonStr = message.content.trim();

        if (jsonStr.includes('```')) {
          const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
          if (jsonMatch) {
            jsonStr = jsonMatch[1];
          }
        }

        const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonObjMatch) {
          jsonStr = jsonObjMatch[0];
        }

        try {
          const parsed = JSON.parse(jsonStr);
          return {
            updatedActions: parsed.updatedActions,
            reasoning: parsed.reasoning || 'No reasoning provided'
          };
        } catch (parseError) {
          return {
            updatedActions: null,
            reasoning: 'Failed to parse re-plan response, keeping original plan'
          };
        }
      }

      return {
        updatedActions: null,
        reasoning: 'No valid response, keeping original plan'
      };

    } catch (error) {
      if (error.name === 'AbortError' || (abortSignal && abortSignal.aborted)) {
        throw new Error('Request cancelled by user');
      }
      console.error('[LLMPlannerClient.replanCall] Failed:', error);
      return {
        updatedActions: null,
        reasoning: `Re-plan error: ${error.message}, keeping original plan`
      };
    }
  }

  /**
   * Goal Verification - Check if the user's goal was achieved
   */
  async verifyGoalCall(context, originalUserPrompt, executedActions, abortSignal = null) {
    console.log('[LLMPlannerClient.verifyGoalCall] Starting goal verification');

    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const actionsSummary = executedActions.map((result, index) => {
        return `${index + 1}. ${result.action?.description || 'Action'} - Status: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
      }).join('\n');

      const plannerLLM = (this.config && this.config.llms)
        ? this.config.llms.find(llm => llm.type === 'planner')
        : null;
      const selectedLLM = plannerLLM || this.currentLLM;

      const systemPrompt = `You are a goal verification assistant. Your job is to check if a user's goal was actually achieved after executing web actions, and provide helpful feedback.

CRITICAL RULES:
1. Focus on the USER'S ORIGINAL GOAL, not just whether actions succeeded
2. Check the FINAL PAGE CONTEXT to see if it matches what the user wanted
3. Return JSON format: {"achieved": true/false, "message": "explanation", "whatsMissing": "optional - what's needed to complete the goal"}

VIDEO PLAYBACK RULES:
- YouTube video pages: If URL contains "/watch?v=" → video IS playing → achieved=true
- YouTube search results: If URL contains "/results?search_query=" → video NOT playing yet → achieved=false, whatsMissing="Click on a video to start playing"

Your response MUST be valid JSON.`;

      const { context: contextStr } = this._buildContextString(context, {
        maxElements: 70,
        includeLinks: true,
        includeForms: true,
        htmlSnippetChars: 1200,
        budgetChars: 14000,
        label: 'verification context'
      });

      const userMessage = `USER'S ORIGINAL GOAL:
${originalUserPrompt}

ACTIONS THAT WERE EXECUTED:
${actionsSummary}

CURRENT PAGE STATE:
${contextStr}

Return ONLY valid JSON.`;

      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user');
      }

      const response = await this.generateCompletion(null, {
        temperature: 0.1,
        maxTokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      });

      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user');
      }

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

      if (typeof result.achieved !== 'boolean') {
        throw new Error('Invalid verification result');
      }

      return {
        achieved: result.achieved,
        message: result.message || (result.achieved ? 'Goal achieved' : 'Goal not achieved'),
        whatsMissing: result.whatsMissing || null
      };
    } catch (error) {
      console.error('[LLMPlannerClient.verifyGoalCall] Failed:', error);
      return {
        achieved: false,
        message: `Could not verify goal completion: ${error.message}`
      };
    }
  }

  /**
   * Answer Extraction - Extracts synthesized answer from page content
   */
  async answerExtractionCall(context, originalUserQuestion, executedActions, abortSignal = null) {
    console.log('[LLMPlannerClient.answerExtractionCall] Starting answer extraction');

    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      let systemPrompt = '';
      try {
        const promptUrl = chrome.runtime.getURL('config/answer-extraction-prompt.txt');
        const promptResponse = await fetch(promptUrl);
        if (promptResponse.ok) {
          systemPrompt = await promptResponse.text();
        } else {
          throw new Error('Failed to load answer extraction prompt');
        }
      } catch (e) {
        throw new Error('Could not load answer extraction prompt');
      }

      const actionsSummary = executedActions.map((result, index) => {
        return `${index + 1}. ${result.action?.description || 'Action'} - Status: ${result.status}`;
      }).join('\n');

      const { context: contextStr } = this._buildContextString(context, {
        maxElements: 50,
        includeLinks: true,
        includeForms: false,
        htmlSnippetChars: 6000,
        budgetChars: 12000,
        label: 'answer extraction context'
      });

      const userMessage = `USER'S ORIGINAL QUESTION:
${originalUserQuestion}

ACTIONS PERFORMED TO FIND THE ANSWER:
${actionsSummary}

FINAL PAGE CONTENT:
${contextStr}

TASK: Extract a clear, helpful answer to the user's question from the page content above.`;

      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user');
      }

      const response = await this.generateCompletion(null, {
        temperature: 0.3,
        maxTokens: 1800,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      });

      if (abortSignal && abortSignal.aborted) {
        throw new Error('Request cancelled by user');
      }

      const answer = response.trim();

      if (!answer || answer.length === 0) {
        return {
          success: false,
          answer: 'I searched for an answer but couldn\'t extract clear information from the page.'
        };
      }

      return {
        success: true,
        answer: answer
      };
    } catch (error) {
      console.error('[LLMPlannerClient.answerExtractionCall] Failed:', error);
      return {
        success: false,
        answer: `I attempted to find an answer but encountered an error: ${error.message}`
      };
    }
  }
}

export { LLMPlannerClient };
