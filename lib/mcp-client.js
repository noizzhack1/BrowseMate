/**
 * ===========================================
 * File: mcp-client.js
 * Purpose: MCP (Model Context Protocol) client for connecting to MCP servers
 * Handles SSE and WebSocket transports, tool discovery, and tool execution
 * Dependencies: None (browser APIs only)
 * ===========================================
 */

// Import logger for debugging and tracking
import { Logger } from '../utils/logger.js';

// Connection timeout in milliseconds
const CONNECTION_TIMEOUT_MS = 10000;

// Request timeout for tool calls in milliseconds
const REQUEST_TIMEOUT_MS = 30000;

// JSON-RPC message ID counter
let messageIdCounter = 1;

/**
 * Generate a unique message ID for JSON-RPC requests
 * @returns {number} - Unique message ID
 */
function getNextMessageId() {
  // Increment and return the counter for unique message IDs
  return messageIdCounter++;
}

/**
 * MCPClient class - handles connections to MCP servers
 * Supports both SSE (Server-Sent Events) and WebSocket transports
 */
class MCPClient {
  /**
   * Constructor initializes empty connection cache
   */
  constructor() {
    // Cache for active SSE connections (serverUrl -> EventSource)
    this.sseConnections = new Map();
    // Cache for active WebSocket connections (serverUrl -> WebSocket)
    this.wsConnections = new Map();
    // Cache for discovered tools per server (serverUrl -> tools array)
    this.toolsCache = new Map();
    // Pending requests waiting for responses (messageId -> {resolve, reject, timeout})
    this.pendingRequests = new Map();
    // Cache for MCP session IDs per server (serverUrl -> sessionId)
    // Required for FastMCP streamable-http transport which mandates session continuity
    this.sessionIds = new Map();
  }

  /**
   * Get enabled MCP servers from chrome.storage
   * @returns {Promise<Array>} - Array of enabled server configurations
   */
  async getEnabledServers() {
    // Log the start of server loading
    Logger.info('[MCPClient.getEnabledServers] Loading enabled servers from storage');

    try {
      // Get settings from chrome storage
      const result = await chrome.storage.sync.get('browsemate_settings');
      // Extract settings object or use empty default
      const settings = result.browsemate_settings || {};
      // Get MCP servers array from settings, default to empty array
      const allServers = settings.mcpServers || [];

      // Filter to only enabled servers
      const enabledServers = allServers.filter(server => server.enabled === true);
      // Log the count of enabled servers found
      Logger.info(`[MCPClient.getEnabledServers] Found ${enabledServers.length} enabled servers`);
      // Return the filtered array
      return enabledServers;
    } catch (error) {
      // Log error if storage access fails
      Logger.error('[MCPClient.getEnabledServers] Failed to load servers:', error);
      // Return empty array on error to prevent crashes
      return [];
    }
  }

  /**
   * Connect to an MCP server using SSE transport
   * @param {Object} serverConfig - Server configuration object
   * @returns {Promise<EventSource>} - Connected EventSource instance
   */
  async connectSSE(serverConfig) {
    // Log connection attempt with server details
    Logger.info(`[MCPClient.connectSSE] Connecting to ${serverConfig.name} at ${serverConfig.url}`);

    // Check if we already have an active connection to this server
    if (this.sseConnections.has(serverConfig.url)) {
      // Return existing connection to avoid duplicates
      Logger.debug(`[MCPClient.connectSSE] Reusing existing connection to ${serverConfig.url}`);
      return this.sseConnections.get(serverConfig.url);
    }

    // Create a promise that resolves when connected or rejects on error/timeout
    return new Promise((resolve, reject) => {
      // Set up connection timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        // Reject with timeout error if connection takes too long
        reject(new Error(`Connection to ${serverConfig.name} timed out after ${CONNECTION_TIMEOUT_MS}ms`));
      }, CONNECTION_TIMEOUT_MS);

      try {
        // Build the SSE URL - some servers use /sse endpoint
        let sseUrl = serverConfig.url;

        // Create EventSource for SSE connection
        const eventSource = new EventSource(sseUrl);

        // Handle successful connection
        eventSource.onopen = () => {
          // Clear the timeout since we connected successfully
          clearTimeout(timeoutId);
          // Log successful connection
          Logger.info(`[MCPClient.connectSSE] Connected to ${serverConfig.name}`);
          // Store the connection in cache
          this.sseConnections.set(serverConfig.url, eventSource);
          // Resolve with the EventSource
          resolve(eventSource);
        };

        // Handle incoming messages
        eventSource.onmessage = (event) => {
          // Log received message for debugging
          Logger.debug(`[MCPClient.connectSSE] Message from ${serverConfig.name}:`, event.data);
          // Process the incoming message
          this.handleSSEMessage(serverConfig.url, event.data);
        };

        // Handle connection errors
        eventSource.onerror = (error) => {
          // Clear the timeout
          clearTimeout(timeoutId);
          // Log the error
          Logger.error(`[MCPClient.connectSSE] Error connecting to ${serverConfig.name}:`, error);
          // Close the connection on error
          eventSource.close();
          // Remove from cache if it was stored
          this.sseConnections.delete(serverConfig.url);
          // Reject the promise with error
          reject(new Error(`Failed to connect to ${serverConfig.name}: SSE connection error`));
        };

      } catch (error) {
        // Clear timeout on exception
        clearTimeout(timeoutId);
        // Log the exception
        Logger.error(`[MCPClient.connectSSE] Exception connecting to ${serverConfig.name}:`, error);
        // Reject with the error
        reject(error);
      }
    });
  }

  /**
   * Connect to an MCP server using WebSocket transport
   * @param {Object} serverConfig - Server configuration object
   * @returns {Promise<WebSocket>} - Connected WebSocket instance
   */
  async connectWebSocket(serverConfig) {
    // Log connection attempt with server details
    Logger.info(`[MCPClient.connectWebSocket] Connecting to ${serverConfig.name} at ${serverConfig.url}`);

    // Check if we already have an active connection to this server
    if (this.wsConnections.has(serverConfig.url)) {
      // Get the existing connection
      const existingWs = this.wsConnections.get(serverConfig.url);
      // Check if it's still open
      if (existingWs.readyState === WebSocket.OPEN) {
        // Return existing connection to avoid duplicates
        Logger.debug(`[MCPClient.connectWebSocket] Reusing existing connection to ${serverConfig.url}`);
        return existingWs;
      }
      // Remove stale connection from cache
      this.wsConnections.delete(serverConfig.url);
    }

    // Create a promise that resolves when connected or rejects on error/timeout
    return new Promise((resolve, reject) => {
      // Set up connection timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        // Reject with timeout error if connection takes too long
        reject(new Error(`Connection to ${serverConfig.name} timed out after ${CONNECTION_TIMEOUT_MS}ms`));
      }, CONNECTION_TIMEOUT_MS);

      try {
        // Create WebSocket connection
        const ws = new WebSocket(serverConfig.url);

        // Handle successful connection
        ws.onopen = () => {
          // Clear the timeout since we connected successfully
          clearTimeout(timeoutId);
          // Log successful connection
          Logger.info(`[MCPClient.connectWebSocket] Connected to ${serverConfig.name}`);
          // Store the connection in cache
          this.wsConnections.set(serverConfig.url, ws);
          // Resolve with the WebSocket
          resolve(ws);
        };

        // Handle incoming messages
        ws.onmessage = (event) => {
          // Log received message for debugging
          Logger.debug(`[MCPClient.connectWebSocket] Message from ${serverConfig.name}:`, event.data);
          // Process the incoming message
          this.handleWSMessage(serverConfig.url, event.data);
        };

        // Handle connection errors
        ws.onerror = (error) => {
          // Clear the timeout
          clearTimeout(timeoutId);
          // Log the error
          Logger.error(`[MCPClient.connectWebSocket] Error connecting to ${serverConfig.name}:`, error);
          // Reject the promise with error
          reject(new Error(`Failed to connect to ${serverConfig.name}: WebSocket connection error`));
        };

        // Handle connection close
        ws.onclose = (event) => {
          // Log the close event
          Logger.info(`[MCPClient.connectWebSocket] Connection to ${serverConfig.name} closed:`, event.code, event.reason);
          // Remove from cache
          this.wsConnections.delete(serverConfig.url);
        };

      } catch (error) {
        // Clear timeout on exception
        clearTimeout(timeoutId);
        // Log the exception
        Logger.error(`[MCPClient.connectWebSocket] Exception connecting to ${serverConfig.name}:`, error);
        // Reject with the error
        reject(error);
      }
    });
  }

  /**
   * Handle incoming SSE message and route to pending request
   * @param {string} serverUrl - URL of the server that sent the message
   * @param {string} data - Raw message data
   */
  handleSSEMessage(serverUrl, data) {
    try {
      // Parse the JSON-RPC response
      const response = JSON.parse(data);
      // Log the parsed response
      Logger.debug(`[MCPClient.handleSSEMessage] Parsed response:`, response);

      // Check if this is a response to a pending request
      if (response.id && this.pendingRequests.has(response.id)) {
        // Get the pending request handlers
        const { resolve, reject, timeout } = this.pendingRequests.get(response.id);
        // Clear the timeout
        clearTimeout(timeout);
        // Remove from pending requests
        this.pendingRequests.delete(response.id);

        // Check for JSON-RPC error
        if (response.error) {
          // Reject with the error
          reject(new Error(response.error.message || 'Unknown JSON-RPC error'));
        } else {
          // Resolve with the result
          resolve(response.result);
        }
      }
    } catch (error) {
      // Log parse error but don't crash
      Logger.warn(`[MCPClient.handleSSEMessage] Failed to parse message:`, error);
    }
  }

  /**
   * Handle incoming WebSocket message and route to pending request
   * @param {string} serverUrl - URL of the server that sent the message
   * @param {string} data - Raw message data
   */
  handleWSMessage(serverUrl, data) {
    // Use the same logic as SSE message handling
    this.handleSSEMessage(serverUrl, data);
  }

  /**
   * Send a JSON-RPC request to an MCP server via SSE POST
   * @param {Object} serverConfig - Server configuration
   * @param {string} method - JSON-RPC method name
   * @param {Object} params - Method parameters
   * @returns {Promise<any>} - Response result
   */
  async sendSSERequest(serverConfig, method, params = {}) {
    // Generate unique message ID for this request
    const messageId = getNextMessageId();
    // Log the request being sent
    Logger.info(`[MCPClient.sendSSERequest] Sending ${method} to ${serverConfig.name} (id: ${messageId})`);

    // Build the JSON-RPC request object
    const request = {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: messageId
    };

    // Create a promise that resolves when response is received
    return new Promise((resolve, reject) => {
      // Set up request timeout
      const timeout = setTimeout(() => {
        // Remove from pending requests on timeout
        this.pendingRequests.delete(messageId);
        // Reject with timeout error
        reject(new Error(`Request ${method} to ${serverConfig.name} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      // Store the pending request handlers
      this.pendingRequests.set(messageId, { resolve, reject, timeout });

      // Build headers for the POST request
      // Streamable HTTP transport requires specific Accept header
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      };

      // Add authentication header if configured
      if (serverConfig.auth && serverConfig.auth.type === 'header') {
        headers[serverConfig.auth.headerName] = serverConfig.auth.headerValue;
      }

      // Add MCP session ID header if we have one for this server
      // This is REQUIRED by FastMCP streamable-http transport for all requests after initialize
      const existingSessionId = this.sessionIds.get(serverConfig.url);
      if (existingSessionId) {
        // Include the session ID from previous initialize response
        headers['Mcp-Session-Id'] = existingSessionId;
        Logger.debug(`[MCPClient.sendSSERequest] Including session ID: ${existingSessionId}`);
      }

      // Determine the POST endpoint
      // For streamable-http transport, the URL is the endpoint itself
      let postUrl = serverConfig.url;
      
      // Handle different URL patterns
      if (postUrl.endsWith('/sse')) {
        // Legacy SSE URL - convert to /mcp for streamable-http
        postUrl = postUrl.replace('/sse', '/mcp');
      } else if (!postUrl.endsWith('/mcp')) {
        // Ensure URL ends with /mcp for streamable-http transport
        postUrl = postUrl.endsWith('/') ? postUrl + 'mcp' : postUrl + '/mcp';
      }

      Logger.info(`[MCPClient.sendSSERequest] POST URL: ${postUrl}`);

      // Send the POST request
      fetch(postUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(request)
      })
        .then(async response => {
          // Check if request was successful
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          // Capture and store session ID from response headers
          // FastMCP streamable-http transport returns this header on initialize
          // and requires it on all subsequent requests
          const sessionId = response.headers.get('mcp-session-id');
          if (sessionId) {
            // Store the session ID for future requests to this server
            this.sessionIds.set(serverConfig.url, sessionId);
            Logger.info(`[MCPClient.sendSSERequest] Captured session ID: ${sessionId}`);
          }
          
          // Get content type to determine how to parse response
          const contentType = response.headers.get('content-type') || '';
          Logger.debug(`[MCPClient.sendSSERequest] Content-Type: ${contentType}`);
          
          // Read response as text first
          const responseText = await response.text();
          Logger.debug(`[MCPClient.sendSSERequest] Raw response: ${responseText.substring(0, 500)}`);
          
          // Parse the response - it might be SSE format or plain JSON
          let jsonResponse;
          
          if (contentType.includes('text/event-stream') || responseText.includes('event:') || responseText.includes('data:')) {
            // SSE format - extract JSON from data field
            const dataMatch = responseText.match(/data:\s*(\{[\s\S]*?\})\s*(?:\n|$)/);
            if (dataMatch) {
              jsonResponse = JSON.parse(dataMatch[1]);
            } else {
              throw new Error('Failed to parse SSE response - no data field found');
            }
          } else {
            // Plain JSON response
            jsonResponse = JSON.parse(responseText);
          }
          
          return jsonResponse;
        })
        .then(jsonResponse => {
          // Clear the timeout
          clearTimeout(timeout);
          // Remove from pending requests
          this.pendingRequests.delete(messageId);
          // Log the response
          Logger.debug(`[MCPClient.sendSSERequest] Parsed response for ${method}:`, jsonResponse);

          // Check for JSON-RPC error
          if (jsonResponse.error) {
            reject(new Error(jsonResponse.error.message || 'Unknown JSON-RPC error'));
          } else {
            resolve(jsonResponse.result);
          }
        })
        .catch(error => {
          // Clear the timeout
          clearTimeout(timeout);
          // Remove from pending requests
          this.pendingRequests.delete(messageId);
          // Log the error
          Logger.error(`[MCPClient.sendSSERequest] Error sending ${method}:`, error);
          // Reject with the error
          reject(error);
        });
    });
  }

  /**
   * Send a JSON-RPC request to an MCP server via WebSocket
   * @param {Object} serverConfig - Server configuration
   * @param {string} method - JSON-RPC method name
   * @param {Object} params - Method parameters
   * @returns {Promise<any>} - Response result
   */
  async sendWSRequest(serverConfig, method, params = {}) {
    // Get or create WebSocket connection
    const ws = await this.connectWebSocket(serverConfig);

    // Generate unique message ID for this request
    const messageId = getNextMessageId();
    // Log the request being sent
    Logger.info(`[MCPClient.sendWSRequest] Sending ${method} to ${serverConfig.name} (id: ${messageId})`);

    // Build the JSON-RPC request object
    const request = {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: messageId
    };

    // Create a promise that resolves when response is received
    return new Promise((resolve, reject) => {
      // Set up request timeout
      const timeout = setTimeout(() => {
        // Remove from pending requests on timeout
        this.pendingRequests.delete(messageId);
        // Reject with timeout error
        reject(new Error(`Request ${method} to ${serverConfig.name} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      // Store the pending request handlers
      this.pendingRequests.set(messageId, { resolve, reject, timeout });

      // Send the request
      ws.send(JSON.stringify(request));
    });
  }

  /**
   * Initialize connection with an MCP server (required before other requests)
   * @param {Object} serverConfig - Server configuration
   * @returns {Promise<Object>} - Server capabilities
   */
  async initializeServer(serverConfig) {
    // Log initialization start
    Logger.info(`[MCPClient.initializeServer] Initializing connection to ${serverConfig.name}`);

    // Build initialization params according to MCP protocol
    const initParams = {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      clientInfo: {
        name: 'BrowseMate',
        version: '1.0.0'
      }
    };

    try {
      // Send initialize request
      let result;
      if (serverConfig.type === 'websocket') {
        result = await this.sendWSRequest(serverConfig, 'initialize', initParams);
      } else {
        result = await this.sendSSERequest(serverConfig, 'initialize', initParams);
      }

      Logger.info(`[MCPClient.initializeServer] Server ${serverConfig.name} initialized:`, result);

      // Send initialized notification (no response expected, but some servers require it)
      try {
        if (serverConfig.type === 'websocket') {
          await this.sendWSRequest(serverConfig, 'notifications/initialized', {});
        } else {
          await this.sendSSERequest(serverConfig, 'notifications/initialized', {});
        }
      } catch (notifyError) {
        // Notification errors are not critical
        Logger.debug(`[MCPClient.initializeServer] Initialized notification failed (non-critical):`, notifyError);
      }

      return result;
    } catch (error) {
      Logger.error(`[MCPClient.initializeServer] Failed to initialize ${serverConfig.name}:`, error);
      throw error;
    }
  }

  /**
   * Discover tools from an MCP server
   * @param {Object} serverConfig - Server configuration
   * @returns {Promise<Array>} - Array of tool definitions in OpenAI format
   */
  async discoverTools(serverConfig) {
    // Log tool discovery start
    Logger.info(`[MCPClient.discoverTools] Discovering tools from ${serverConfig.name}`);

    try {
      // Initialize the server connection first (required by MCP protocol)
      await this.initializeServer(serverConfig);

      // Send tools/list request based on transport type
      let result;
      if (serverConfig.type === 'websocket') {
        result = await this.sendWSRequest(serverConfig, 'tools/list');
      } else {
        // Default to HTTP transport
        result = await this.sendSSERequest(serverConfig, 'tools/list');
      }

      // Log the raw result
      Logger.debug(`[MCPClient.discoverTools] Raw tools response:`, result);

      // Extract tools array from result
      const mcpTools = result?.tools || [];
      // Log count of tools found
      Logger.info(`[MCPClient.discoverTools] Found ${mcpTools.length} tools from ${serverConfig.name}`);

      // Convert MCP tool format to OpenAI tool format
      const openAITools = mcpTools.map(tool => this.convertToolToOpenAI(tool, serverConfig));
      // Cache the tools for this server
      this.toolsCache.set(serverConfig.url, openAITools);
      // Return the converted tools
      return openAITools;

    } catch (error) {
      // Log the error
      Logger.error(`[MCPClient.discoverTools] Failed to discover tools from ${serverConfig.name}:`, error);
      // Return empty array on error
      return [];
    }
  }

  /**
   * Convert MCP tool definition to OpenAI tool format
   * @param {Object} mcpTool - MCP tool definition
   * @param {Object} serverConfig - Server configuration for prefixing
   * @returns {Object} - OpenAI-compatible tool definition
   */
  convertToolToOpenAI(mcpTool, serverConfig) {
    // Create a prefixed name to identify this as an MCP tool
    // Format: mcp_<serverId>_<toolName>
    const prefixedName = `mcp_${serverConfig.id}_${mcpTool.name}`;

    // Build OpenAI-compatible tool definition
    return {
      type: 'function',
      function: {
        name: prefixedName,
        description: `[MCP: ${serverConfig.name}] ${mcpTool.description || 'No description provided'}`,
        parameters: mcpTool.inputSchema || {
          type: 'object',
          properties: {},
          required: []
        }
      },
      // Store metadata for execution routing
      _mcpMetadata: {
        serverUrl: serverConfig.url,
        serverId: serverConfig.id,
        serverName: serverConfig.name,
        originalName: mcpTool.name,
        serverConfig: serverConfig
      }
    };
  }

  /**
   * Execute a tool call on an MCP server
   * @param {Object} serverConfig - Server configuration
   * @param {string} toolName - Original tool name (without prefix)
   * @param {Object} args - Tool arguments
   * @returns {Promise<any>} - Tool execution result
   */
  async callTool(serverConfig, toolName, args = {}) {
    // Log tool call start
    Logger.info(`[MCPClient.callTool] Calling ${toolName} on ${serverConfig.name}`);
    Logger.debug(`[MCPClient.callTool] Arguments:`, args);

    try {
      // Build the tools/call request params
      const params = {
        name: toolName,
        arguments: args
      };

      // Send tools/call request based on transport type
      let result;
      if (serverConfig.type === 'websocket') {
        result = await this.sendWSRequest(serverConfig, 'tools/call', params);
      } else {
        // Default to SSE transport
        result = await this.sendSSERequest(serverConfig, 'tools/call', params);
      }

      // Log the result
      Logger.info(`[MCPClient.callTool] Tool ${toolName} returned:`, result);

      // Extract the actual result value from MCP response format
      // MCP tools return results in nested format: { content: [{ type, text }], structuredContent: {...} }
      let displayValue = null;
      let extractedValue = null;

      // Try to extract from content array (MCP standard text content format)
      if (result && result.content && Array.isArray(result.content) && result.content.length > 0) {
        // Get text from first content item
        const firstContent = result.content[0];
        if (firstContent && firstContent.type === 'text' && firstContent.text !== undefined) {
          displayValue = firstContent.text;
          extractedValue = firstContent.text;
          Logger.debug(`[MCPClient.callTool] Extracted text content: ${displayValue}`);
        }
      }

      // Try to extract from structuredContent (FastMCP format) if no text content found
      if (displayValue === null && result && result.structuredContent) {
        // For simple results, structuredContent may have a 'result' property
        if (result.structuredContent.result !== undefined) {
          extractedValue = result.structuredContent.result;
          displayValue = JSON.stringify(extractedValue);
          Logger.debug(`[MCPClient.callTool] Extracted structured content: ${displayValue}`);
        } else {
          // Otherwise stringify the entire structuredContent
          extractedValue = result.structuredContent;
          displayValue = JSON.stringify(extractedValue);
          Logger.debug(`[MCPClient.callTool] Extracted full structured content: ${displayValue}`);
        }
      }

      // Fallback: stringify entire result if no standard format found
      if (displayValue === null && result !== undefined) {
        extractedValue = result;
        displayValue = typeof result === 'object' ? JSON.stringify(result) : String(result);
        Logger.debug(`[MCPClient.callTool] Using fallback display value: ${displayValue}`);
      }

      // Build user-friendly message with the actual result
      const resultMessage = displayValue !== null
        ? `MCP tool "${toolName}" result: ${displayValue}`
        : `MCP tool ${toolName} executed successfully`;

      // Return the result with extracted value for display
      return {
        success: true,
        result: extractedValue,
        rawResult: result,
        message: resultMessage
      };

    } catch (error) {
      // Log the error
      Logger.error(`[MCPClient.callTool] Failed to call ${toolName} on ${serverConfig.name}:`, error);
      // Return error result
      return {
        success: false,
        error: error.message,
        message: `MCP tool ${toolName} failed: ${error.message}`
      };
    }
  }

  /**
   * Get all tools from all enabled MCP servers
   * Connects to servers on-demand and discovers their tools
   * @returns {Promise<Array>} - Combined array of all MCP tools in OpenAI format
   */
  async getAllEnabledServerTools() {
    // Log start of tool aggregation
    Logger.info('[MCPClient.getAllEnabledServerTools] Gathering tools from all enabled servers');

    // Get list of enabled servers
    const enabledServers = await this.getEnabledServers();

    // If no servers enabled, return empty array
    if (enabledServers.length === 0) {
      Logger.info('[MCPClient.getAllEnabledServerTools] No enabled MCP servers');
      return [];
    }

    // Collect tools from all servers in parallel
    const toolPromises = enabledServers.map(async (serverConfig) => {
      try {
        // Try to discover tools from this server
        return await this.discoverTools(serverConfig);
      } catch (error) {
        // Log error but don't fail entire operation
        Logger.warn(`[MCPClient.getAllEnabledServerTools] Failed to get tools from ${serverConfig.name}:`, error);
        return [];
      }
    });

    // Wait for all tool discoveries to complete
    const toolArrays = await Promise.all(toolPromises);
    // Flatten the arrays into a single list
    const allTools = toolArrays.flat();
    // Log total count
    Logger.info(`[MCPClient.getAllEnabledServerTools] Total MCP tools discovered: ${allTools.length}`);
    // Return combined tools
    return allTools;
  }

  /**
   * Check if a tool name is an MCP tool (has mcp_ prefix)
   * @param {string} toolName - Name of the tool to check
   * @returns {boolean} - True if this is an MCP tool
   */
  isMCPTool(toolName) {
    // Check for mcp_ prefix
    return toolName && toolName.startsWith('mcp_');
  }

  /**
   * Parse MCP tool name to extract server ID and original tool name
   * @param {string} prefixedName - Full prefixed tool name (mcp_serverId_toolName)
   * @returns {Object} - Parsed components {serverId, toolName}
   */
  parseMCPToolName(prefixedName) {
    // Remove the mcp_ prefix
    const withoutPrefix = prefixedName.substring(4);
    // Find the first underscore to separate serverId from toolName
    const underscoreIndex = withoutPrefix.indexOf('_');

    if (underscoreIndex === -1) {
      // No underscore found, malformed name
      return { serverId: null, toolName: withoutPrefix };
    }

    // Extract server ID and tool name
    const serverId = withoutPrefix.substring(0, underscoreIndex);
    const toolName = withoutPrefix.substring(underscoreIndex + 1);

    return { serverId, toolName };
  }

  /**
   * Execute an MCP tool by its prefixed name
   * @param {string} prefixedName - Full prefixed tool name (mcp_serverId_toolName)
   * @param {Object} args - Tool arguments
   * @returns {Promise<Object>} - Execution result
   */
  async executeMCPTool(prefixedName, args = {}) {
    // Log execution start
    Logger.info(`[MCPClient.executeMCPTool] Executing MCP tool: ${prefixedName}`);

    // Parse the tool name to extract server ID and original name
    const { serverId, toolName } = this.parseMCPToolName(prefixedName);

    if (!serverId || !toolName) {
      return {
        success: false,
        error: 'Invalid MCP tool name format',
        message: `Failed to parse MCP tool name: ${prefixedName}`
      };
    }

    // Get enabled servers to find the matching one
    const enabledServers = await this.getEnabledServers();
    const serverConfig = enabledServers.find(s => s.id === serverId);

    if (!serverConfig) {
      return {
        success: false,
        error: 'MCP server not found or disabled',
        message: `MCP server with ID ${serverId} is not enabled`
      };
    }

    // Call the tool on the server
    return await this.callTool(serverConfig, toolName, args);
  }

  /**
   * Close all active connections
   * Call this when cleaning up or shutting down
   */
  closeAllConnections() {
    // Log cleanup start
    Logger.info('[MCPClient.closeAllConnections] Closing all MCP connections');

    // Close all SSE connections
    for (const [url, eventSource] of this.sseConnections) {
      try {
        eventSource.close();
        Logger.debug(`[MCPClient.closeAllConnections] Closed SSE connection to ${url}`);
      } catch (error) {
        Logger.warn(`[MCPClient.closeAllConnections] Error closing SSE connection to ${url}:`, error);
      }
    }
    // Clear the SSE cache
    this.sseConnections.clear();

    // Close all WebSocket connections
    for (const [url, ws] of this.wsConnections) {
      try {
        ws.close();
        Logger.debug(`[MCPClient.closeAllConnections] Closed WebSocket connection to ${url}`);
      } catch (error) {
        Logger.warn(`[MCPClient.closeAllConnections] Error closing WebSocket connection to ${url}:`, error);
      }
    }
    // Clear the WebSocket cache
    this.wsConnections.clear();

    // Clear pending requests (reject them)
    for (const [messageId, { reject, timeout }] of this.pendingRequests) {
      clearTimeout(timeout);
      reject(new Error('Connection closed'));
    }
    // Clear pending requests cache
    this.pendingRequests.clear();

    // Clear tools cache
    this.toolsCache.clear();

    // Clear session IDs cache (sessions are invalidated when connections close)
    this.sessionIds.clear();

    // Log cleanup complete
    Logger.info('[MCPClient.closeAllConnections] All connections closed');
  }
}

// Create singleton instance for use across the extension
const mcpClient = new MCPClient();

// Export both the class and singleton instance
export { MCPClient, mcpClient };

