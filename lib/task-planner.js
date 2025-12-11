/**
 * ===========================================
 * File: task-planner.js (Simplified)
 * Purpose: Direct orchestrator for ReAct agent - all requests go to agent
 * Uses ReAct agent for all tasks (observe -> think -> act loop)
 * Dependencies: LLMClient.js, react-agent.js, mcp-client.js
 * ===========================================
 */

// Import LLM client for agent calls
import { LLMClient } from './llm-client.js';
// Import ReAct agent for agent-based execution
import { runReactAgent } from './react-agent.js';
// Import logger for debugging
import { Logger } from '../utils/logger.js';
// Import MCP client for external tool integration
import { mcpClient } from './mcp-client.js';

// LLM client instance - lazy initialized
let llmClient = null;

/**
 * Get or create LLM client instance (singleton pattern)
 * @returns {LLMClient} - The LLM client instance
 */
function getLLMClient() {
  // Create new instance if not exists
  if (!llmClient) {
    llmClient = new LLMClient();
  }
  // Return the singleton instance
  return llmClient;
}

/**
 * Main entry point - process user request directly with ReAct agent
 * All requests (questions and actions) are handled by the ReAct agent
 * @param {string|Object} context - Page context (string or {url, title, text, html})
 * @param {string} prompt - User's question or request
 * @param {Function} onProgress - Optional callback for progress updates (step, total, description, result)
 * @param {AbortSignal} abortSignal - Signal to cancel the request
 * @param {Array} conversationHistory - Recent conversation history [{role, content}, ...]
 * @param {Function} _onInteraction - Optional callback for user interactions (unused, kept for compatibility)
 * @param {Function} _onStreamChunk - Optional callback for streaming (unused, kept for compatibility)
 * @param {Function} onThinking - Optional callback for agent thinking updates (thought) => void
 * @returns {Promise<{type: string, message: string, success: boolean}>}
 */
async function processRequest(context, prompt, onProgress = null, abortSignal = null, conversationHistory = [], _onInteraction = null, _onStreamChunk = null, onThinking = null) {
  Logger.info('[processRequest] Starting request processing with ReAct agent');
  Logger.info('[processRequest] Prompt:', prompt);
  Logger.info('[processRequest] Has context:', !!context);
  Logger.debug('[processRequest] Context type:', typeof context);

  try {
    // Check if request was aborted before starting
    if (abortSignal && abortSignal.aborted) {
      throw new Error('Request cancelled by user');
    }

    // Prepare context for ReAct agent
    let agentContext = context;
    if (typeof context === 'string') {
      agentContext = { url: '', title: '', html: context, text: context };
    } else if (!context) {
      agentContext = { url: '', title: '', html: '', text: '' };
    }

    // Get LLM client
    const llm = getLLMClient();

    // Create ReAct agent callbacks
    const agentCallbacks = {
      onThinking: (thought) => {
        Logger.info('[processRequest] Agent thinking:', thought);
        if (onThinking) {
          onThinking(thought);
        }
      },
      onAction: (_action, description) => {
        Logger.info('[processRequest] Agent action:', description);
        // Build task list for progress display
        if (onProgress) {
          onProgress(`⚡ ${description}`, 0, 1, 'in_progress');
        }
      },
      onResult: (success, message) => {
        Logger.info('[processRequest] Action result:', success, message);
        if (onProgress) {
          const icon = success ? '✓' : '✗';
          onProgress(`${icon} ${message}`, 1, 1, success ? 'completed' : 'failed');
        }
      },
      onObservation: (observation) => {
        Logger.debug('[processRequest] Agent observation:', observation);
      },
      onProgress: (scratchpad, step, maxSteps) => {
        Logger.info(`[processRequest] Agent step ${step}/${maxSteps}`);
        // Format scratchpad for display
        if (onProgress) {
          const display = scratchpad.formatForDisplay();
          onProgress(display, step, maxSteps, 'in_progress');
        }
      },
      onComplete: (answer, _scratchpad) => {
        Logger.info('[processRequest] Agent complete:', answer);
      }
    };

    // Run the ReAct agent for ALL requests (questions and actions)
    Logger.info('[processRequest] Starting ReAct agent execution');
    const agentResult = await runReactAgent(
      llm,
      prompt,
      agentContext,
      agentCallbacks,
      abortSignal
    );

    Logger.info('[processRequest] ReAct agent completed');
    Logger.info('[processRequest] Result:', agentResult);

    // Format the final response
    const scratchpadSummary = agentResult.scratchpad.getSummary();
    const stats = agentResult.scratchpad.getStats();

    return {
      type: 'execution',
      message: agentResult.answer,
      taskList: scratchpadSummary,
      results: agentResult.scratchpad.getEntriesByType('result').map(r => ({
        action: { description: r.content },
        status: r.metadata?.success ? 'success' : 'failed',
        reason: r.content
      })),
      success: agentResult.success,
      scratchpad: agentResult.scratchpad,
      stats: stats
    };
  } catch (error) {
    Logger.error('[processRequest] Error processing request:', error);
    Logger.error('[processRequest] Error message:', error.message);
    Logger.error('[processRequest] Error stack:', error.stack);
    return {
      type: 'answer',
      message: `An error occurred: ${error.message}`,
      success: false
    };
  }
}

// Export functions for ES6 modules
export { processRequest, mcpClient };
