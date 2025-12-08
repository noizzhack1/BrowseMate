// Settings page script - manages LLM configuration

// Get LLM client instance from global scope (set by LLMClient.js module)
const llmClient = window.llmClient;

const settingsForm = document.getElementById('settingsForm');
const statusMessage = document.getElementById('statusMessage');
const testBtn = document.getElementById('testBtn');

// Default settings
const DEFAULT_SETTINGS = {
  hfToken: '',
  selectedLLM: '',
  maxTokens: 1024,
  temperature: 0.7
};

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
 * Load settings from Chrome storage
 */
async function loadSettings() {
  try {
    // First load available LLMs
    const llms = await loadAvailableLLMs();

    // Then load user settings
    const result = await chrome.storage.sync.get('browsemate_settings');
    const settings = result.browsemate_settings || DEFAULT_SETTINGS;

    // First populate model options from config so we can safely select a value
    await populateModelsFromConfig(settings);

    // Populate form fields
    document.getElementById('hfToken').value = settings.hfToken || '';
    document.getElementById('selectedLLM').value = settings.selectedLLM || (llms[0]?.name || '');
    document.getElementById('maxTokens').value = settings.maxTokens || DEFAULT_SETTINGS.maxTokens;
    document.getElementById('temperature').value = settings.temperature || DEFAULT_SETTINGS.temperature;
  } catch (error) {
    showStatus('Error loading settings: ' + error.message, 'error');
  }
}

/**
 * Save settings to Chrome storage
 */
async function saveSettings(event) {
  event.preventDefault();

  const providerRadios = Array.from(document.querySelectorAll('input[name=\"provider\"]'));
  const checkedProvider = providerRadios.find(r => r.checked) || null;

  const localName = document.getElementById('localName').value.trim();
  const localBaseUrl = document.getElementById('localBaseUrl').value.trim();
  const localModel = document.getElementById('localModel').value.trim();

  // If a local model is configured, treat it as the active provider,
  // regardless of which radio was previously selected.
  const hasLocalConfig = !!(localBaseUrl && localModel);
  const providerType = hasLocalConfig
    ? 'local'
    : (checkedProvider && checkedProvider.dataset.provider === 'local' ? 'local' : 'config');
  const hfModel = hasLocalConfig
    ? 'LOCAL'
    : (checkedProvider ? checkedProvider.value : '');

  const settings = {
    hfToken: document.getElementById('hfToken').value.trim(),
    selectedLLM: document.getElementById('selectedLLM').value,
    maxTokens: parseInt(document.getElementById('maxTokens').value),
    temperature: parseFloat(document.getElementById('temperature').value),
    providerType,
    localName,
    localBaseUrl,
    localModel
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
    // Rebuild the models list so the local model appears as a provider if configured
    await loadSettings();
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

// Toggle local model form
const addLocalModelBtn = document.getElementById('addLocalModelBtn');
const localModelFields = document.getElementById('localModelFields');
if (addLocalModelBtn && localModelFields) {
  addLocalModelBtn.addEventListener('click', () => {
    const isVisible = localModelFields.style.display === 'block';
    localModelFields.style.display = isVisible ? 'none' : 'block';
  });
}

// Load settings on page load
loadSettings();
