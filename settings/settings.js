// Settings page script - manages LLM configuration

// Get LLM client instance from global scope (set by LLMClient.js module)
const llmClient = window.llmClient;

const settingsForm = document.getElementById('settingsForm');
const statusMessage = document.getElementById('statusMessage');
const testBtn = document.getElementById('testBtn');

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
  hfToken: '',
  selectedLLM: '',
  maxTokens: 1024,
  temperature: 0.7,
  mcpServers: null // Changed from [] to null to detect if set
};

let currentMCPServers = [];
let editingServerIndex = -1;

/**
 * Load available LLMs from config
 */
async function loadAvailableLLMs() {
  try {
    await llmClient.initialize();
    const llms = llmClient.getAvailableLLMs();

    const selectElement = document.getElementById('selectedLLM');
    selectElement.innerHTML = '';

    llms.forEach(llm => {
      const option = document.createElement('option');
      option.value = llm.name;
      option.textContent = `${llm.name} (${llm.model})`;
      selectElement.appendChild(option);
    });

    return llms;
  } catch (error) {
    showStatus('Error loading LLM options: ' + error.message, 'error');
    return [];
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
  
  // Scroll to form
  document.querySelector('.mcp-add-form').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  editingServerIndex = -1;
  
  // Reset form
  document.getElementById('mcpName').value = '';
  document.getElementById('mcpUrl').value = '';
  document.getElementById('mcpType').value = 'sse';
  
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
    
    if (server.type === 'sse') {
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
    // First load available LLMs
    const llms = await loadAvailableLLMs();

    // Then load user settings
    const result = await chrome.storage.sync.get('browsemate_settings');
    const settings = result.browsemate_settings || DEFAULT_SETTINGS;

    // Populate form fields
    document.getElementById('hfToken').value = settings.hfToken || '';
    document.getElementById('selectedLLM').value = settings.selectedLLM || (llms[0]?.name || '');
    document.getElementById('maxTokens').value = settings.maxTokens || DEFAULT_SETTINGS.maxTokens;
    document.getElementById('temperature').value = settings.temperature || DEFAULT_SETTINGS.temperature;
    
    // Load MCP Servers
    await loadMCPServers(settings);

  } catch (error) {
    showStatus('Error loading settings: ' + error.message, 'error');
  }
}

/**
 * Save settings to Chrome storage
 */
async function saveSettings(event) {
  event.preventDefault();

  const settings = {
    hfToken: document.getElementById('hfToken').value.trim(),
    selectedLLM: document.getElementById('selectedLLM').value,
    maxTokens: parseInt(document.getElementById('maxTokens').value),
    temperature: parseFloat(document.getElementById('temperature').value),
    mcpServers: currentMCPServers // Save the current list of servers
  };

  // Validate token
  if (!settings.hfToken) {
    showStatus('Please enter an API token', 'error');
    return;
  }

  if (!settings.selectedLLM) {
    showStatus('Please select an LLM provider', 'error');
    return;
  }

  try {
    await chrome.storage.sync.set({ browsemate_settings: settings });

    // Update the LLM client with new settings
    if (llmClient.isInitialized) {
      llmClient.currentLLM.token = settings.hfToken;
      await llmClient.switchLLM(settings.selectedLLM);
    }

    showStatus('Settings saved successfully!', 'success');
  } catch (error) {
    showStatus('Error saving settings: ' + error.message, 'error');
  }
}

/**
 * Test the LLM API connection
 */
async function testConnection() {
  const token = document.getElementById('hfToken').value.trim();
  const selectedLLM = document.getElementById('selectedLLM').value;

  if (!token) {
    showStatus('Please enter an API token first', 'error');
    return;
  }

  if (!selectedLLM) {
    showStatus('Please select an LLM provider first', 'error');
    return;
  }

  showStatus('Testing connection...', 'success');
  testBtn.disabled = true;

  try {
    // Initialize LLM client if not already done
    if (!llmClient.isInitialized) {
      await llmClient.initialize();
    }

    // Switch to selected LLM
    llmClient.selectLLM(selectedLLM);

    // Update token temporarily for test
    const originalToken = llmClient.currentLLM.token;
    llmClient.currentLLM.token = token;

    // Test with a simple prompt
    const response = await llmClient.generateCompletion(
      "Say 'Hello, test successful!' if you can read this.",
      {
        maxTokens: 50,
        temperature: 0.7
      }
    );

    // Restore original token
    llmClient.currentLLM.token = originalToken;

    showStatus('Connection successful! Model is responding: ' + response.substring(0, 100), 'success');
  } catch (error) {
    showStatus('Connection failed: ' + error.message, 'error');
  } finally {
    testBtn.disabled = false;
  }
}

/**
 * Show status message
 */
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;
  statusMessage.style.display = 'block';

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      statusMessage.style.display = 'none';
    }, 3000);
  }
}

// Event listeners
settingsForm.addEventListener('submit', saveSettings);
testBtn.addEventListener('click', testConnection);
addMcpBtn.addEventListener('click', addMCPServer);
cancelMcpBtn.addEventListener('click', cancelEdit);

mcpTypeSelect.addEventListener('change', () => {
  const urlInput = document.getElementById('mcpUrl');
  if (mcpTypeSelect.value === 'sse') {
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

// Load settings on page load
loadSettings();
