// Settings page script - manages LLM configuration

// Get LLM client instance from global scope (set by LLMClient.js module)
const llmClient = window.llmClient;

const settingsForm = document.getElementById('settingsForm');
const statusMessage = document.getElementById('statusMessage');
const backToSiteBtn = document.getElementById('backToSiteBtn');

// Store timeout ID for clearing auto-hide
let statusTimeoutId = null;

// MCP Elements
const mcpServersList = document.getElementById('mcp-servers-list');
const addMcpBtn = document.getElementById('addMcpBtn');
const cancelMcpBtn = document.getElementById('cancelMcpBtn');
const mcpFormTitle = document.getElementById('mcpFormTitle');
const mcpTypeSelect = document.getElementById('mcpType');
// Auth Elements
const mcpAuthTypeSelect = document.getElementById('mcpAuthType');
const mcpAuthHeaderFields = document.getElementById('mcpAuthHeaderFields');

// Default settings
const DEFAULT_SETTINGS = {
  hfToken: '', // Kept for backward compatibility
  selectedLLM: '',
  // New planner / executor model fields (used going forward)
  plannerModel: '',
  plannerToken: '', // Separate token for planner model
  plannerTemperature: 0.7, // Temperature for planner model
  plannerMaxTokens: 2000, // Max tokens for planner model
  plannerIsOpen: false, // Whether planner section is open
  executorModel: '', // Single executor model
  executorToken: '', // Separate token for executor model
  executorTemperature: 0.7, // Temperature for executor model
  executorMaxTokens: 2000, // Max tokens for executor model
  executorIsOpen: false, // Whether executor section is open
  executorModels: [], // Array for backward compatibility (single executor)
  // Legacy fields for backward compatibility
  maxTokens: 2000,
  temperature: 0.7,
  mcpServers: null // Changed from [] to null to detect if set
};

// MCP server state
let currentMCPServers = [];
let editingServerIndex = -1;

// Model sections containers
const plannerSectionContainer = document.getElementById('plannerSectionContainer');
const executorSectionContainer = document.getElementById('executorSectionContainer');

// Track model sections
let plannerSectionId = null; // Only one planner allowed
let executorSectionId = null; // Only one executor allowed
let availableModels = []; // Store available models for dropdowns

// Track manually edited tokens (to prevent auto-overwrite)
let manuallyEditedTokens = new Set(); // Set of section IDs with manually edited tokens

// Track section open/closed state
let sectionStates = {}; // {sectionId: {isOpen: boolean, ...}}

// Add-new-model UI
const newModelForm = document.getElementById('newModelForm');
const addModelBtn = document.getElementById('addModelBtn');
const newModelNameInput = document.getElementById('newModelName');
const newModelTokenInput = document.getElementById('newModelToken');
const newModelBaseURLInput = document.getElementById('newModelBaseURL');
const newModelMODELInput = document.getElementById('newModelMODEL');
const newModelPromptInput = document.getElementById('newModelPrompt');
const addModelSaveBtn = document.getElementById('addModelSave');
const addModelCancelBtn = document.getElementById('addModelCancel');

// Storage keys
const SETTINGS_KEY = 'browsemate_settings';
const CUSTOM_LLMS_KEY = 'browsemate_custom_llms';

// Origin tab tracking (tab that was active when this Settings instance was opened)
let ORIGIN_TAB_ID = null;
try {
  const currentUrl = new URL(window.location.href);
  const originParam = currentUrl.searchParams.get('originTabId');
  if (originParam) {
    const parsed = Number(originParam);
    if (!Number.isNaN(parsed)) {
      ORIGIN_TAB_ID = parsed;
    }
  }
} catch (e) {
  console.warn('Error parsing originTabId from Settings URL:', e);
}

/**
 * Load available models from config (llm-config.json + any user-added models)
 * and store them for use in dynamic dropdowns.
 */
async function loadAvailableModels() {
  try {
    // Ensure the LLM client has loaded its configuration
    await llmClient.initialize();

    // Use the raw config list so we see full entries, including any custom ones
    const allModels =
      llmClient.config && Array.isArray(llmClient.config.llms)
        ? llmClient.config.llms
        : [];

    // Store models for use in dynamic sections
    availableModels = allModels;

    return allModels;
  } catch (error) {
    showStatus('Error loading LLM options: ' + error.message, 'error');
    return [];
  }
}

/**
 * Get a model's default token by name
 * @param {string} modelName - The model name
 * @returns {string} The default token for the model, or empty string if not found
 */
function getModelDefaultToken(modelName) {
  if (!modelName) return '';
  const model = availableModels.find(m => m && m.name === modelName);
  return model && model.token ? model.token : '';
}

/**
 * Populate a model select dropdown with available models
 * @param {HTMLSelectElement} selectElement - The select element to populate
 * @param {string} selectedValue - The value to pre-select
 */
function populateModelSelect(selectElement, selectedValue = '') {
  if (!selectElement) return;
  
  selectElement.innerHTML = '';
  availableModels.forEach((model) => {
    if (!model || !model.name) return;
    const option = document.createElement('option');
    option.value = model.name;
    option.textContent = model.name;
    if (model.name === selectedValue) {
      option.selected = true;
    }
    selectElement.appendChild(option);
  });
}

/**
 * Create a collapsible model configuration section HTML
 * @param {string} type - 'planner' or 'executor'
 * @param {string} sectionId - Unique ID for this section
 * @param {string} modelName - Pre-selected model name
 * @param {string} token - Pre-filled token value
 * @param {number} temperature - Pre-filled temperature value
 * @param {number} maxTokens - Pre-filled max tokens value
 * @param {boolean} isOpen - Whether the section should be open initially
 * @returns {HTMLElement} The created section element
 */
function createModelSection(type, sectionId, modelName = '', token = '', temperature = 0.7, maxTokens = 2000, isOpen = false) {
  const isPlanner = type === 'planner';
  const section = document.createElement('div');
  section.className = 'model-section-accordion';
  section.dataset.sectionId = sectionId;
  section.dataset.modelType = type;

  const modelLabel = isPlanner ? 'Planner model' : 'Executor model';
  const modelDescription = isPlanner 
    ? 'Model used for planning and deciding what actions to take.'
    : 'Model used for DOM automation / executor.';

  // Store initial state
  sectionStates[sectionId] = { isOpen: isOpen };

  section.innerHTML = `
    <div class="model-section-header" style="padding: 12px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 5px; cursor: pointer; user-select: none; display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <span class="section-toggle-icon" style="transition: transform 0.3s;">${isOpen ? '▼' : '▶'}</span>
        <h3 style="margin: 0; font-size: 16px;">${modelLabel}</h3>
      </div>
    </div>
    <div class="model-section-content" style="padding: 15px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px; background: #f9f9f9; display: ${isOpen ? 'block' : 'none'}; overflow: hidden; transition: max-height 0.3s ease-in-out;">
      <div class="form-group">
        <label for="${sectionId}-model">Model name</label>
        <select id="${sectionId}-model" name="${sectionId}-model" class="model-select">
          <!-- Options loaded dynamically -->
        </select>
        <small>${modelDescription}</small>
      </div>
      <div class="form-group">
        <label for="${sectionId}-token">API Token *</label>
        <input
          type="password"
          id="${sectionId}-token"
          name="${sectionId}-token"
          class="model-token-input"
          placeholder="Enter your API token"
          value="${token}"
          required
        />
        <small>Enter the API token for this model.</small>
      </div>
      <div class="form-group">
        <label for="${sectionId}-temperature">Temperature</label>
        <input
          type="number"
          id="${sectionId}-temperature"
          name="${sectionId}-temperature"
          class="model-temperature-input"
          value="${temperature}"
          min="0"
          max="2"
          step="0.1"
        />
        <small>Controls randomness: 0 = focused, 2 = creative (0-2)</small>
      </div>
      <div class="form-group">
        <label for="${sectionId}-maxTokens">Max Tokens</label>
        <input
          type="number"
          id="${sectionId}-maxTokens"
          name="${sectionId}-maxTokens"
          class="model-max-tokens-input"
          value="${maxTokens}"
          min="100"
          max="4096"
        />
        <small>Maximum number of tokens to generate (100-4096)</small>
      </div>
      <div class="form-group">
        <button type="button" class="btn btn-secondary model-test-btn" data-section-id="${sectionId}">Test Connection</button>
      </div>
    </div>
  `;

  // Populate the model select dropdown
  const selectElement = section.querySelector(`#${sectionId}-model`);
  populateModelSelect(selectElement, modelName);
  
  // Track manual token edits and auto-populate on model change
  const tokenInput = section.querySelector(`#${sectionId}-token`);
  if (tokenInput) {
    // Mark as manually edited when user types
    tokenInput.addEventListener('input', () => {
      manuallyEditedTokens.add(sectionId);
    });
    
    // Check if current token matches model's default token
    const checkTokenMatch = () => {
      const currentModelName = selectElement.value;
      const currentToken = tokenInput.value.trim();
      const modelDefaultToken = getModelDefaultToken(currentModelName);
      if (currentToken === modelDefaultToken) {
        // Token matches default, remove from manually edited set
        manuallyEditedTokens.delete(sectionId);
      }
    };
    
    // Check on initial load
    checkTokenMatch();
    
    // Add change listener to auto-populate token when model is selected
    if (selectElement) {
      selectElement.addEventListener('change', () => {
        const selectedModelName = selectElement.value;
        if (!manuallyEditedTokens.has(sectionId)) {
          // Only auto-populate if token wasn't manually edited
          const defaultToken = getModelDefaultToken(selectedModelName);
          tokenInput.value = defaultToken;
          // Clear manual edit flag if token matches default
          manuallyEditedTokens.delete(sectionId);
        } else {
          // Token was manually edited, but check if it now matches the new model's default
          checkTokenMatch();
        }
      });
    }
  }

  // Add toggle functionality to header
  const header = section.querySelector('.model-section-header');
  const content = section.querySelector('.model-section-content');
  const toggleIcon = section.querySelector('.section-toggle-icon');
  
  header.addEventListener('click', () => {
    toggleSection(sectionId);
  });

  const testBtn = section.querySelector('.model-test-btn');
  if (testBtn) {
    testBtn.addEventListener('click', () => {
      const modelName = selectElement.value;
      const tokenInput = section.querySelector(`#${sectionId}-token`);
      const token = tokenInput ? tokenInput.value.trim() : '';
      const temperatureInput = section.querySelector(`#${sectionId}-temperature`);
      const temperature = temperatureInput ? parseFloat(temperatureInput.value) : 0.7;
      const maxTokensInput = section.querySelector(`#${sectionId}-maxTokens`);
      const maxTokens = maxTokensInput ? parseInt(maxTokensInput.value) : 2000;
      testConnection(type, sectionId, modelName, token, temperature, maxTokens, testBtn);
    });
  }

  return section;
}

/**
 * Toggle a section's open/closed state
 * @param {string} sectionId - The section ID to toggle
 */
function toggleSection(sectionId) {
  const section = document.querySelector(`[data-section-id="${sectionId}"]`);
  if (!section) return;

  const content = section.querySelector('.model-section-content');
  const toggleIcon = section.querySelector('.section-toggle-icon');
  const isOpen = sectionStates[sectionId]?.isOpen || false;

  if (isOpen) {
    // Collapse
    content.style.maxHeight = content.scrollHeight + 'px';
    setTimeout(() => {
      content.style.maxHeight = '0';
    }, 10);
    setTimeout(() => {
      content.style.display = 'none';
    }, 300);
    toggleIcon.textContent = '▶';
    sectionStates[sectionId].isOpen = false;
  } else {
    // Expand
    content.style.display = 'block';
    content.style.maxHeight = '0';
    setTimeout(() => {
      content.style.maxHeight = content.scrollHeight + 'px';
    }, 10);
    setTimeout(() => {
      content.style.maxHeight = 'none';
    }, 300);
    toggleIcon.textContent = '▼';
    sectionStates[sectionId].isOpen = true;
  }
}

/**
 * Add a new planner section (only one allowed, always exists)
 */
function addPlannerSection(modelName = '', token = '', temperature = 0.7, maxTokens = 2000, isOpen = false) {
  if (plannerSectionId) {
    // Planner already exists, just update it if needed
    const existingSection = document.querySelector(`[data-section-id="${plannerSectionId}"]`);
    if (existingSection) {
      // Update values if provided
      if (modelName) {
        const modelSelect = existingSection.querySelector(`#${plannerSectionId}-model`);
        if (modelSelect) modelSelect.value = modelName;
      }
      if (token) {
        const tokenInput = existingSection.querySelector(`#${plannerSectionId}-token`);
        if (tokenInput) tokenInput.value = token;
      }
      if (temperature !== undefined) {
        const tempInput = existingSection.querySelector(`#${plannerSectionId}-temperature`);
        if (tempInput) tempInput.value = temperature;
      }
      if (maxTokens !== undefined) {
        const maxTokensInput = existingSection.querySelector(`#${plannerSectionId}-maxTokens`);
        if (maxTokensInput) maxTokensInput.value = maxTokens;
      }
      // Toggle if needed
      if (isOpen && !sectionStates[plannerSectionId]?.isOpen) {
        toggleSection(plannerSectionId);
      } else if (!isOpen && sectionStates[plannerSectionId]?.isOpen) {
        toggleSection(plannerSectionId);
      }
      return;
    }
  }

  const sectionId = 'planner-' + Date.now();
  plannerSectionId = sectionId;
  const section = createModelSection('planner', sectionId, modelName, token, temperature, maxTokens, isOpen);
  if (plannerSectionContainer) {
    plannerSectionContainer.appendChild(section);
  }
}

/**
 * Add a new executor section (only one allowed, always exists)
 */
function addExecutorSection(modelName = '', token = '', temperature = 0.7, maxTokens = 2000, isOpen = false) {
  if (executorSectionId) {
    // Executor already exists, just update it if needed
    const existingSection = document.querySelector(`[data-section-id="${executorSectionId}"]`);
    if (existingSection) {
      // Update values if provided
      if (modelName) {
        const modelSelect = existingSection.querySelector(`#${executorSectionId}-model`);
        if (modelSelect) modelSelect.value = modelName;
      }
      if (token) {
        const tokenInput = existingSection.querySelector(`#${executorSectionId}-token`);
        if (tokenInput) tokenInput.value = token;
      }
      if (temperature !== undefined) {
        const tempInput = existingSection.querySelector(`#${executorSectionId}-temperature`);
        if (tempInput) tempInput.value = temperature;
      }
      if (maxTokens !== undefined) {
        const maxTokensInput = existingSection.querySelector(`#${executorSectionId}-maxTokens`);
        if (maxTokensInput) maxTokensInput.value = maxTokens;
      }
      // Toggle if needed
      if (isOpen && !sectionStates[executorSectionId]?.isOpen) {
        toggleSection(executorSectionId);
      } else if (!isOpen && sectionStates[executorSectionId]?.isOpen) {
        toggleSection(executorSectionId);
      }
      return;
    }
  }

  const sectionId = 'executor-' + Date.now();
  executorSectionId = sectionId;
  const section = createModelSection('executor', sectionId, modelName, token, temperature, maxTokens, isOpen);
  if (executorSectionContainer) {
    executorSectionContainer.appendChild(section);
  }
}


/**
 * Load MCP Servers
 */
async function loadMCPServers(settings) {
  try {
    if (settings.mcpServers !== undefined && settings.mcpServers !== null) {
      currentMCPServers = settings.mcpServers;
    } else {
      // Load defaults from config file ONLY if not set in settings at all
      const response = await fetch('../config/mcp-servers.json');
      if (response.ok) {
        currentMCPServers = await response.json();
      } else {
        currentMCPServers = [];
      }
    }
    renderMCPServers();
  } catch (error) {
    console.error('Error loading MCP servers:', error);
    showStatus('Error loading MCP servers configuration', 'error');
  }
}

/**
 * Render MCP Servers List
 */
function renderMCPServers() {
  mcpServersList.innerHTML = '';
  
  if (currentMCPServers.length === 0) {
    mcpServersList.innerHTML = '<p>No MCP servers configured.</p>';
    return;
  }

  currentMCPServers.forEach((server, index) => {
    const item = document.createElement('div');
    item.className = `mcp-item ${server.enabled ? '' : 'disabled'}`;
    
    let details = server.url;
    let authInfo = '';
    
    if (server.auth && server.auth.type !== 'none') {
      authInfo = `<span style="font-size: 11px; background: #eee; padding: 2px 5px; border-radius: 3px; margin-left: 5px;">Auth: ${server.auth.type}</span>`;
    }

    item.innerHTML = `
      <div class="mcp-info">
        <h4>${server.name} <span style="font-weight: normal; font-size: 12px; color: #888;">(${server.type})</span>${authInfo}</h4>
        <p>${details}</p>
      </div>
      <div class="mcp-controls">
        <label style="font-size: 12px; display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" class="server-toggle" ${server.enabled ? 'checked' : ''}> Enable
        </label>
        <button type="button" class="btn btn-secondary server-edit-btn" style="padding: 5px 10px; font-size: 12px; background: #6c757d; border-color: #6c757d; color: white;">Edit</button>
        <button type="button" class="btn btn-secondary server-test-btn" style="padding: 5px 10px; font-size: 12px; background: #17a2b8; border-color: #17a2b8; color: white;">Test</button>
        <button type="button" class="btn btn-secondary server-remove-btn" style="padding: 5px 10px; font-size: 12px; background: #dc3545;">Remove</button>
      </div>
    `;
    
    // Attach event listeners programmatically
    const toggle = item.querySelector('.server-toggle');
    if (toggle) {
      toggle.addEventListener('change', () => toggleServer(index));
    }

    const editBtn = item.querySelector('.server-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', () => editServer(index));
    }
    
    const testBtn = item.querySelector('.server-test-btn');
    if (testBtn) {
      testBtn.addEventListener('click', (e) => {
        console.log('Test button clicked for server index:', index);
        testServer(index, e.currentTarget);
      });
    }
    
    const removeBtn = item.querySelector('.server-remove-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => removeServer(index));
    }

    mcpServersList.appendChild(item);
  });
}

/**
 * Global functions for event handlers
 */
function toggleServer(index) {
  console.log('Toggling server:', index);
  currentMCPServers[index].enabled = !currentMCPServers[index].enabled;
  renderMCPServers();
}

function removeServer(index) {
  if (confirm('Are you sure you want to remove this server?')) {
    currentMCPServers.splice(index, 1);
    
    // If we are editing the server that was just removed, cancel edit
    if (editingServerIndex === index) {
      cancelEdit();
    } else if (editingServerIndex > index) {
      // Adjust index if we removed a server before the one being edited
      editingServerIndex--;
    }
    
    renderMCPServers();
  }
}

function editServer(index) {
  editingServerIndex = index;
  const server = currentMCPServers[index];

  // Populate form
  document.getElementById('mcpName').value = server.name;
  document.getElementById('mcpType').value = server.type;
  document.getElementById('mcpUrl').value = server.url;

  // Trigger change event to set placeholder
  const event = new Event('change');
  document.getElementById('mcpType').dispatchEvent(event);

  // Populate Auth
  if (server.auth && server.auth.type === 'header') {
    document.getElementById('mcpAuthType').value = 'header';
    document.getElementById('mcpAuthHeaderName').value = server.auth.headerName;
    document.getElementById('mcpAuthHeaderValue').value = server.auth.headerValue;
    mcpAuthHeaderFields.style.display = 'block';
  } else {
    document.getElementById('mcpAuthType').value = 'none';
    document.getElementById('mcpAuthHeaderName').value = '';
    document.getElementById('mcpAuthHeaderValue').value = '';
    mcpAuthHeaderFields.style.display = 'none';
  }

  // Update UI
  mcpFormTitle.textContent = 'Edit Server';
  addMcpBtn.textContent = 'Update Server';
  addMcpBtn.classList.remove('btn-secondary');
  addMcpBtn.classList.add('btn-primary');
  cancelMcpBtn.style.display = 'inline-block';

  // Ensure MCP tab is active and scroll to form
  const mcpTabBtn = document.querySelector('.tab-btn[data-tab="mcp"]');
  if (mcpTabBtn && typeof switchTab === 'function') {
    switchTab('mcp');
  }
  document.querySelector('.mcp-add-form').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  editingServerIndex = -1;
  
  // Reset form
  document.getElementById('mcpName').value = '';
  document.getElementById('mcpUrl').value = '';
  document.getElementById('mcpType').value = 'http';
  
  // Reset Auth
  document.getElementById('mcpAuthType').value = 'none';
  document.getElementById('mcpAuthHeaderName').value = '';
  document.getElementById('mcpAuthHeaderValue').value = '';
  mcpAuthHeaderFields.style.display = 'none';
  
  // Trigger change event to reset placeholder
  const event = new Event('change');
  document.getElementById('mcpType').dispatchEvent(event);
  
  // Reset UI
  mcpFormTitle.textContent = 'Add New Server';
  addMcpBtn.textContent = 'Add Server';
  addMcpBtn.classList.remove('btn-primary');
  addMcpBtn.classList.add('btn-secondary');
  cancelMcpBtn.style.display = 'none';
}

async function testServer(index, btn) {
  console.log('Starting test for server:', index);
  const server = currentMCPServers[index];
  if (!server) {
    console.error('Server not found at index:', index);
    return;
  }

  const originalText = btn.textContent;
  
  btn.textContent = '...';
  btn.disabled = true;

  try {
    console.log('Testing server URL:', server.url, 'Type:', server.type);
    
    if (server.type === 'http') {
      // Test HTTP (Streamable-HTTP) transport with POST request
      // FastMCP requires BOTH content types in Accept header
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json'
      };
      
      if (server.auth && server.auth.type === 'header') {
        headers[server.auth.headerName] = server.auth.headerValue;
      }
      
      console.log('Sending POST request to test HTTP transport...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      // Send a simple ping/initialize request to test connectivity
      const testRequest = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'BrowseMate-Test', version: '1.0.0' }
        },
        id: 1
      };
      
      try {
        const response = await fetch(server.url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(testRequest),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        console.log('Response received:', response.status);

        if (response.ok) {
          console.log('Test successful, showing status...');
          showStatus(`Success: Connected to ${server.name}`, 'success');
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }

    } else if (server.type === 'sse') {
      const headers = {
        'Accept': 'text/event-stream'
      };
      
      if (server.auth && server.auth.type === 'header') {
        headers[server.auth.headerName] = server.auth.headerValue;
      }
      
      console.log('Sending fetch request...');
      // Use fetch to test connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      try {
        const response = await fetch(server.url, {
          method: 'GET',
          headers: headers,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        console.log('Response received:', response.status);

      if (response.ok) {
        console.log('Test successful, showing status...');
        showStatus(`Success: Connected to ${server.name}`, 'success');
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }

    } else if (server.type === 'websocket') {
      // WebSocket test
      console.log('Starting WebSocket test...');
      if (server.auth && server.auth.type === 'header') {
        console.warn('WebSocket test cannot send custom headers in browser');
      }

      await new Promise((resolve, reject) => {
        let ws;
        try {
          ws = new WebSocket(server.url);
        } catch (e) {
          reject(e);
          return;
        }
        
        const timeout = setTimeout(() => {
          if (ws.readyState === WebSocket.CONNECTING) {
             ws.close();
             reject(new Error('Connection timed out'));
          }
        }, 5000);

        ws.onopen = () => {
          console.log('WebSocket opened');
          clearTimeout(timeout);
          ws.close();
          resolve();
        };

        ws.onerror = (err) => {
          console.error('WebSocket error:', err);
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        };
      });
      
      showStatus(`Success: Connected to ${server.name}`, 'success');
    }
  } catch (error) {
    console.error('Test failed:', error);
    showStatus(`Connection failed: ${error.message}`, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

/**
 * Add or Update MCP Server
 */
function addMCPServer() {
  const name = document.getElementById('mcpName').value.trim();
  const type = document.getElementById('mcpType').value;
  const url = document.getElementById('mcpUrl').value.trim();
  
  if (!name) {
    showStatus('Please enter a server name', 'error');
    return;
  }
  
  if (!url) {
    showStatus('Please enter a Server URL', 'error');
    return;
  }

  const serverData = {
    id: editingServerIndex >= 0 ? currentMCPServers[editingServerIndex].id : Date.now().toString(),
    name: name,
    type: type,
    url: url,
    enabled: editingServerIndex >= 0 ? currentMCPServers[editingServerIndex].enabled : true,
    auth: {
      type: 'none'
    }
  };

  // Handle Authentication
  const authType = document.getElementById('mcpAuthType').value;
  if (authType === 'header') {
    const headerName = document.getElementById('mcpAuthHeaderName').value.trim();
    const headerValue = document.getElementById('mcpAuthHeaderValue').value.trim();
    
    if (!headerName || !headerValue) {
      showStatus('Please enter Header Name and Value', 'error');
      return;
    }
    
    serverData.auth = {
      type: 'header',
      headerName: headerName,
      headerValue: headerValue
    };
  }

  if (editingServerIndex >= 0) {
    // Update existing
    currentMCPServers[editingServerIndex] = serverData;
    showStatus('MCP Server updated (Save Settings to persist)', 'success');
    cancelEdit(); // Reset form and state
  } else {
    // Add new
    currentMCPServers.push(serverData);
    showStatus('MCP Server added (Save Settings to persist)', 'success');
    
    // Reset form
    document.getElementById('mcpName').value = '';
    document.getElementById('mcpUrl').value = '';
    document.getElementById('mcpAuthType').value = 'none';
    document.getElementById('mcpAuthHeaderName').value = '';
    document.getElementById('mcpAuthHeaderValue').value = '';
    mcpAuthHeaderFields.style.display = 'none';
  }

  renderMCPServers();
}


/**
 * Load settings from Chrome storage
 */
async function loadSettings() {
  try {
    // First load available models
    await loadAvailableModels();

    // Then load user settings
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] || DEFAULT_SETTINGS;

    // Clear existing sections
    if (plannerSectionContainer) {
      plannerSectionContainer.innerHTML = '';
    }
    if (executorSectionContainer) {
      executorSectionContainer.innerHTML = '';
    }
    plannerSectionId = null;
    executorSectionId = null;
    sectionStates = {};
    manuallyEditedTokens.clear(); // Reset manual edit tracking

    // Load planner model and token (backward compatibility: check old executorModel/executorToken)
    const plannerModel = settings.plannerModel || '';
    let plannerToken = settings.plannerToken || settings.hfToken || '';
    
    // If token is empty or matches model's default token, use default token (so it auto-updates)
    if (plannerModel) {
      const modelDefaultToken = getModelDefaultToken(plannerModel);
      if (!plannerToken || plannerToken === modelDefaultToken) {
        plannerToken = modelDefaultToken;
        // Don't mark as manually edited if using default token
      } else {
        // Token was manually edited, mark it
        // (will be marked after section is created)
      }
    }
    
    const plannerTemperature = settings.plannerTemperature !== undefined 
      ? settings.plannerTemperature 
      : (settings.temperature !== undefined ? settings.temperature : DEFAULT_SETTINGS.temperature);
    const plannerMaxTokens = settings.plannerMaxTokens !== undefined 
      ? settings.plannerMaxTokens 
      : (settings.maxTokens !== undefined ? settings.maxTokens : DEFAULT_SETTINGS.maxTokens);
    const plannerIsOpen = settings.plannerIsOpen !== undefined ? settings.plannerIsOpen : false;
    
    // Always create planner section (even if empty), collapsed by default
    addPlannerSection(plannerModel, plannerToken, plannerTemperature, plannerMaxTokens, plannerIsOpen);
    
    // Mark planner token as manually edited if it doesn't match default
    if (plannerSectionId && plannerModel) {
      const savedToken = settings.plannerToken || settings.hfToken || '';
      const modelDefaultToken = getModelDefaultToken(plannerModel);
      if (savedToken && savedToken !== modelDefaultToken) {
        manuallyEditedTokens.add(plannerSectionId);
      }
    }

    // Load executor model (support both old single executor and new array format for backward compatibility)
    let executorModel = '';
    let executorToken = '';
    let executorTemperature = DEFAULT_SETTINGS.temperature;
    let executorMaxTokens = DEFAULT_SETTINGS.maxTokens;
    let executorIsOpen = false;

    if (settings.executorModels && Array.isArray(settings.executorModels) && settings.executorModels.length > 0) {
      // New format: array of executors (use first one for backward compatibility)
      const executor = settings.executorModels[0];
      executorModel = executor.model || '';
      executorToken = executor.token || '';
      executorTemperature = executor.temperature !== undefined ? executor.temperature : DEFAULT_SETTINGS.temperature;
      executorMaxTokens = executor.maxTokens !== undefined ? executor.maxTokens : DEFAULT_SETTINGS.maxTokens;
      executorIsOpen = executor.isOpen !== undefined ? executor.isOpen : false;
    } else if (settings.executorModel) {
      // Old format: single executor (backward compatibility)
      executorModel = settings.executorModel;
      executorToken = settings.executorToken || settings.hfToken || '';
      executorTemperature = settings.temperature !== undefined ? settings.temperature : DEFAULT_SETTINGS.temperature;
      executorMaxTokens = settings.maxTokens !== undefined ? settings.maxTokens : DEFAULT_SETTINGS.maxTokens;
      executorIsOpen = false;
    }
    
    // If token is empty or matches model's default token, use default token (so it auto-updates)
    if (executorModel) {
      const modelDefaultToken = getModelDefaultToken(executorModel);
      if (!executorToken || executorToken === modelDefaultToken) {
        executorToken = modelDefaultToken;
        // Don't mark as manually edited if using default token
      } else {
        // Token was manually edited, mark it
        // (will be marked after section is created)
      }
    }

    // Always create executor section (even if empty), collapsed by default
    addExecutorSection(executorModel, executorToken, executorTemperature, executorMaxTokens, executorIsOpen);
    
    // Mark executor token as manually edited if it doesn't match default
    if (executorSectionId && executorModel) {
      const savedToken = settings.executorToken || settings.hfToken || '';
      const modelDefaultToken = getModelDefaultToken(executorModel);
      if (savedToken && savedToken !== modelDefaultToken) {
        manuallyEditedTokens.add(executorSectionId);
      }
    }
    
    // Load MCP Servers
    await loadMCPServers(settings);
  } catch (error) {
    showStatus('Error loading settings: ' + error.message, 'error');
  }
}

/**
 * Save settings to Chrome storage
 * Only saves settings from the currently active tab
 */
async function saveSettings(event) {
  event.preventDefault();

  // Get the currently active tab
  const activeTab = getActiveTab();
  if (!activeTab) {
    showStatus('Unable to determine active tab', 'error');
    return;
  }

  // Load existing settings first to preserve settings from other tabs
  let existingSettings = DEFAULT_SETTINGS;
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    if (result[SETTINGS_KEY]) {
      existingSettings = { ...DEFAULT_SETTINGS, ...result[SETTINGS_KEY] };
    }
  } catch (error) {
    console.warn('[saveSettings] Error loading existing settings:', error);
  }

  // Initialize settings object with existing values
  const settings = { ...existingSettings };

  if (activeTab === 'llm') {
    // Save only LLM Configuration tab settings
    const providerRadios = Array.from(document.querySelectorAll('input[name=\"provider\"]'));
    const checkedProvider = providerRadios.find(r => r.checked) || null;

    const localName = document.getElementById('newModelName').value.trim();
    const localBaseUrl = document.getElementById('newModelBaseURL').value.trim();
    const localModel = document.getElementById('newModelMODEL').value.trim();

    // If a local model is configured, treat it as the active provider,
    // regardless of which radio was previously selected.
    const hasLocalConfig = !!(localBaseUrl && localModel);
    const providerType = hasLocalConfig
      ? 'local'
      : (checkedProvider && checkedProvider.dataset.provider === 'local' ? 'local' : 'config');
    const hfModel = hasLocalConfig
      ? 'LOCAL'
      : (checkedProvider ? checkedProvider.value : '');

    // Get planner model, token, temperature, maxTokens, and state from dynamic section
    if (plannerSectionId) {
      const plannerSection = document.querySelector(`[data-section-id="${plannerSectionId}"]`);
      if (plannerSection) {
        const modelSelect = plannerSection.querySelector(`#${plannerSectionId}-model`);
        const tokenInput = plannerSection.querySelector(`#${plannerSectionId}-token`);
        const temperatureInput = plannerSection.querySelector(`#${plannerSectionId}-temperature`);
        const maxTokensInput = plannerSection.querySelector(`#${plannerSectionId}-maxTokens`);
        settings.plannerModel = modelSelect ? modelSelect.value : '';
        settings.plannerToken = tokenInput ? tokenInput.value.trim() : '';
        settings.plannerTemperature = temperatureInput ? parseFloat(temperatureInput.value) : DEFAULT_SETTINGS.temperature;
        settings.plannerMaxTokens = maxTokensInput ? parseInt(maxTokensInput.value) : DEFAULT_SETTINGS.maxTokens;
        settings.plannerIsOpen = sectionStates[plannerSectionId]?.isOpen || false;
      }
    } else {
      settings.plannerModel = '';
      settings.plannerToken = '';
      settings.plannerTemperature = DEFAULT_SETTINGS.temperature;
      settings.plannerMaxTokens = DEFAULT_SETTINGS.maxTokens;
      settings.plannerIsOpen = false;
    }
    
    // Get executor model, token, temperature, maxTokens, and state from dynamic section
    if (executorSectionId) {
      const executorSection = document.querySelector(`[data-section-id="${executorSectionId}"]`);
      if (executorSection) {
        const modelSelect = executorSection.querySelector(`#${executorSectionId}-model`);
        const tokenInput = executorSection.querySelector(`#${executorSectionId}-token`);
        const temperatureInput = executorSection.querySelector(`#${executorSectionId}-temperature`);
        const maxTokensInput = executorSection.querySelector(`#${executorSectionId}-maxTokens`);
        settings.executorModel = modelSelect ? modelSelect.value : '';
        settings.executorToken = tokenInput ? tokenInput.value.trim() : '';
        settings.executorTemperature = temperatureInput ? parseFloat(temperatureInput.value) : DEFAULT_SETTINGS.temperature;
        settings.executorMaxTokens = maxTokensInput ? parseInt(maxTokensInput.value) : DEFAULT_SETTINGS.maxTokens;
        settings.executorIsOpen = sectionStates[executorSectionId]?.isOpen || false;
      }
    } else {
      settings.executorModel = '';
      settings.executorToken = '';
      settings.executorTemperature = DEFAULT_SETTINGS.temperature;
      settings.executorMaxTokens = DEFAULT_SETTINGS.maxTokens;
      settings.executorIsOpen = false;
    }
    
    // Keep executorModels array for backward compatibility (single executor)
    settings.executorModels = settings.executorModel ? [{
      model: settings.executorModel,
      token: settings.executorToken,
      temperature: settings.executorTemperature,
      maxTokens: settings.executorMaxTokens,
      isOpen: settings.executorIsOpen
    }] : [];
    
    // Keep hfToken for backward compatibility (use plannerToken if available)
    settings.hfToken = settings.plannerToken || '';
    
    // Keep global temperature and maxTokens for backward compatibility (use planner values)
    settings.temperature = settings.plannerTemperature;
    settings.maxTokens = settings.plannerMaxTokens;
    settings.providerType = providerType;
    settings.localName = localName;
    settings.localBaseUrl = localBaseUrl;
    settings.localModel = localModel;

    // Validate LLM tab fields
    if (!settings.plannerToken) {
      showStatus('Please enter an API token for the Planner model', 'error');
      return;
    }

    if (!settings.plannerModel) {
      showStatus('Please select a planner model', 'error');
      return;
    }

    // Executor is optional, but if selected, token is required
    if (settings.executorModel && !settings.executorToken) {
      showStatus('Please enter an API token for the Executor model', 'error');
      return;
    }
  } else if (activeTab === 'mcp') {
    // Save only MCP Servers tab settings
    // Preserve mcpServers if it exists, otherwise use currentMCPServers
    settings.mcpServers = currentMCPServers;
  }

  // Show saving notification
  console.log('[saveSettings] Saving settings for tab:', activeTab);
  showStatus('Saving settings...', 'success');
  
  // Disable save button during save operation
  const saveBtn = settingsForm.querySelector('button[type="submit"]');
  const wasDisabled = saveBtn ? saveBtn.disabled : false;
  if (saveBtn) saveBtn.disabled = true;

  try {
    console.log('[saveSettings] Saving to chrome.storage...');
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
    console.log('[saveSettings] Settings saved to storage');

    // Update the LLM client with new settings (only if LLM tab was saved)
    if (activeTab === 'llm' && llmClient.isInitialized && llmClient.currentLLM) {
      // Use planner token as the default token
      llmClient.currentLLM.token = settings.plannerToken || settings.hfToken;
    }

    console.log('[saveSettings] Showing success notification');
    showStatus('Settings saved successfully!', 'success');
    // Rebuild the models list so the local model appears as a provider if configured
    // Use a small delay to ensure the success message is visible before reloading
    await new Promise(resolve => setTimeout(resolve, 100));
    await loadSettings();
  } catch (error) {
    console.error('[saveSettings] Error saving settings:', error);
    showStatus('Error saving settings: ' + error.message, 'error');
  } finally {
    // Re-enable save button
    if (saveBtn && !wasDisabled) saveBtn.disabled = false;
  }
}

/**
 * Test the LLM API connection for a specific model
 * @param {string} modelType - 'planner' or 'executor'
 * @param {string} sectionId - The section ID for this model
 * @param {string} modelName - The model name to test
 * @param {string} token - The token to use for testing
 * @param {number} temperature - The temperature to use for testing
 * @param {number} maxTokens - The max tokens to use for testing
 * @param {HTMLElement} testBtn - The test button element
 */
async function testConnection(modelType, sectionId, modelName, token, temperature, maxTokens, testBtn) {
  if (!token) {
    showStatus(`Please enter an API token for the ${modelType} model first`, 'error');
    return;
  }

  if (!modelName) {
    showStatus(`Please select a ${modelType} model first`, 'error');
    return;
  }

  showStatus(`Testing ${modelType} model connection...`, 'success');
  if (testBtn) testBtn.disabled = true;

  try {
    // Initialize LLM client if not already done
    if (!llmClient.isInitialized) {
      await llmClient.initialize();
    }

    // Remember the original model and token so we can restore them
    const originalModel = llmClient.currentLLM;
    const originalToken = originalModel ? originalModel.token : null;

    // Switch to the model being tested
    llmClient.selectLLM(modelName);

    // Update token temporarily for test
    llmClient.currentLLM.token = token;

    // Test with a simple prompt using the model's specific temperature and maxTokens
    const response = await llmClient.generateCompletion(
      "Say 'Hello, test successful!' if you can read this.",
      {
        maxTokens: Math.min(maxTokens, 50), // Use model's maxTokens but cap at 50 for test
        temperature: temperature
      }
    );

    // Restore original model and token
    if (originalModel && originalModel.name) {
      llmClient.selectLLM(originalModel.name);
      if (originalToken !== null) {
        llmClient.currentLLM.token = originalToken;
      }
    }

    showStatus(`${modelType.charAt(0).toUpperCase() + modelType.slice(1)} model connection successful! Response: ${response.substring(0, 100)}`, 'success');
  } catch (error) {
    showStatus(`${modelType.charAt(0).toUpperCase() + modelType.slice(1)} model connection failed: ${error.message}`, 'error');
  } finally {
    if (testBtn) testBtn.disabled = false;
  }
}

/**
 * Show status message
 */
function showStatus(message, type) {
  console.log('[showStatus] Called with:', { message, type, statusMessageExists: !!statusMessage });
  
  if (!statusMessage) {
    console.error('[showStatus] Status message element not found');
    return;
  }

  // Clear any existing timeout
  if (statusTimeoutId) {
    clearTimeout(statusTimeoutId);
    statusTimeoutId = null;
  }

  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.style.display = 'block';
  
  // Scroll the status message into view to ensure it's visible
  statusMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  
  console.log('[showStatus] Status message updated:', {
    textContent: statusMessage.textContent,
    className: statusMessage.className,
    display: statusMessage.style.display,
    computedDisplay: window.getComputedStyle(statusMessage).display
  });

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    statusTimeoutId = setTimeout(() => {
      if (statusMessage) {
        statusMessage.style.display = 'none';
        console.log('[showStatus] Auto-hiding success message');
      }
      statusTimeoutId = null;
    }, 3000);
  }
}

// Reset the new model form inputs
function resetNewModelForm() {
  if (newModelNameInput) newModelNameInput.value = '';
  if (newModelTokenInput) newModelTokenInput.value = '';
  if (newModelBaseURLInput) newModelBaseURLInput.value = '';
  if (newModelMODELInput) newModelMODELInput.value = '';
  if (newModelPromptInput) newModelPromptInput.value = '';
}

// Append a single model option to all existing model select dropdowns
function appendModelToDropdowns(model) {
  if (!model || !model.name) return;
  
  // Add to available models list
  availableModels.push(model);
  
  // Update all existing model select dropdowns
  const allSelects = document.querySelectorAll('.model-select');
  allSelects.forEach((select) => {
    if (!select) return;
    const option = document.createElement('option');
    option.value = model.name;
    option.textContent = model.name;
    select.appendChild(option);
  });
}

// Handle saving a new model definition
async function handleAddModelSave() {
  const name = newModelNameInput ? newModelNameInput.value.trim() : '';
  const token = newModelTokenInput ? newModelTokenInput.value.trim() : '';
  const baseURL = newModelBaseURLInput ? newModelBaseURLInput.value.trim() : '';
  const MODEL = newModelMODELInput ? newModelMODELInput.value.trim() : '';
  const prompt = newModelPromptInput ? newModelPromptInput.value.trim() : '';

  if (!name || !baseURL || !MODEL) {
    showStatus(
      'Please provide at least name, Base URL, and MODEL for the new model',
      'error'
    );
    return;
  }

  const newModel = { name, token, baseURL, MODEL, prompt };

  try {
    // Persist in chrome.storage so it is available in future sessions
    const stored = await chrome.storage.sync.get(CUSTOM_LLMS_KEY);
    const customList = Array.isArray(stored[CUSTOM_LLMS_KEY])
      ? stored[CUSTOM_LLMS_KEY]
      : [];

    // Avoid duplicate names
    if (customList.some((m) => (m.name || '').toLowerCase() === name.toLowerCase())) {
      showStatus('A model with this name already exists', 'error');
      return;
    }

    customList.push(newModel);
    await chrome.storage.sync.set({ [CUSTOM_LLMS_KEY]: customList });

    // Also add to the in-memory config so it is usable without reload
    if (llmClient.config && Array.isArray(llmClient.config.llms)) {
      llmClient.config.llms.push(newModel);
    }

    // Immediately append to all existing model select dropdowns
    appendModelToDropdowns(newModel);

    // Optionally auto-select the new model in the first available section
    // (User can manually select it in their sections)

    // Hide and reset the form
    if (newModelForm) {
      newModelForm.style.display = 'none';
    }
    resetNewModelForm();

    showStatus(`Model "${name}" added successfully`, 'success');
  } catch (error) {
    showStatus('Error saving new model: ' + error.message, 'error');
  }
}

// Close the Settings tab and return focus to the original site tab
async function handleBackToSite() {
  try {
    // Delegate closing & focus restoration to the background script, which
    // uses the same logic as the Settings icon in the sidebar.
    await chrome.runtime.sendMessage({ type: 'BROWSEMATE_CLOSE_SETTINGS' });
  } catch (error) {
    console.error('Error requesting settings close:', error);
  }
}

// Tab switching functionality
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

/**
 * Get the currently active tab ID
 * @returns {string|null} The active tab ID or null if none found
 */
function getActiveTab() {
  const activeBtn = Array.from(tabButtons).find(btn => btn.classList.contains('active'));
  return activeBtn ? activeBtn.dataset.tab : null;
}

function switchTab(tabId) {
  // Update button states
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Update panel visibility
  tabPanels.forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });
}

// Add click listeners to tab buttons
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

// Event listeners
settingsForm.addEventListener('submit', saveSettings);

addMcpBtn.addEventListener('click', addMCPServer);
cancelMcpBtn.addEventListener('click', cancelEdit);

mcpTypeSelect.addEventListener('change', () => {
  const urlInput = document.getElementById('mcpUrl');
  if (mcpTypeSelect.value === 'http') {
    urlInput.placeholder = 'http://localhost:8000/mcp';
  } else if (mcpTypeSelect.value === 'sse') {
    urlInput.placeholder = 'http://localhost:3000/sse';
  } else {
    urlInput.placeholder = 'ws://localhost:3000';
  }
});

mcpAuthTypeSelect.addEventListener('change', () => {
  if (mcpAuthTypeSelect.value === 'header') {
    mcpAuthHeaderFields.style.display = 'block';
  } else {
    mcpAuthHeaderFields.style.display = 'none';
  }
});

if (addModelBtn && newModelForm) {
  addModelBtn.addEventListener('click', () => {
    newModelForm.style.display = 'block';
    newModelForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

if (addModelSaveBtn) {
  addModelSaveBtn.addEventListener('click', handleAddModelSave);
}

if (addModelCancelBtn && newModelForm) {
  addModelCancelBtn.addEventListener('click', () => {
    resetNewModelForm();
    newModelForm.style.display = 'none';
  });
}

if (backToSiteBtn) {
  backToSiteBtn.addEventListener('click', handleBackToSite);
}

// Verify status message element exists on page load
if (!statusMessage) {
  console.error('[settings.js] Status message element not found on page load!');
} else {
  console.log('[settings.js] Status message element found:', statusMessage);
}

// Load settings on page load
loadSettings();
