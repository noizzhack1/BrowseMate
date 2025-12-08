// Settings page script - manages LLM configuration

// Get LLM client instance from global scope (set by LLMClient.js module)
const llmClient = window.llmClient;

const settingsForm = document.getElementById('settingsForm');
const statusMessage = document.getElementById('statusMessage');
const testBtn = document.getElementById('testBtn');
const backToSiteBtn = document.getElementById('backToSiteBtn');

// Default settings
const DEFAULT_SETTINGS = {
  hfToken: '',
  selectedLLM: '',
  // New planner / executor model fields (used going forward)
  plannerModel: '',
  executorModel: '',
  maxTokens: 1024,
  temperature: 0.7
};

// Planner / executor dropdowns
const plannerSelect = document.getElementById('plannerModel');
const executorSelect = document.getElementById('executorModel');

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

/**
 * Load available models from config (llm-config.json + any user-added models)
 * and populate the planner / executor dropdowns.
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

    // Clear existing options
    if (plannerSelect) plannerSelect.innerHTML = '';
    if (executorSelect) executorSelect.innerHTML = '';

    // Populate both dropdowns with the same model list using the name as display value
    allModels.forEach((model) => {
      if (!model || !model.name) return;
      if (plannerSelect) {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = model.name;
        plannerSelect.appendChild(option);
      }
      if (executorSelect) {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = model.name;
        executorSelect.appendChild(option);
      }
    });

    return allModels;
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
    // First load available models
    const models = await loadAvailableModels();

    // Then load user settings
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] || DEFAULT_SETTINGS;

    const defaultModelName = models[0]?.name || '';

    // Populate form fields
    document.getElementById('hfToken').value = settings.hfToken || '';
    document.getElementById('maxTokens').value =
      settings.maxTokens || DEFAULT_SETTINGS.maxTokens;
    document.getElementById('temperature').value =
      settings.temperature || DEFAULT_SETTINGS.temperature;

    if (plannerSelect) {
      plannerSelect.value = settings.plannerModel || defaultModelName;
    }
    if (executorSelect) {
      executorSelect.value = settings.executorModel || defaultModelName;
    }
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
    plannerModel: plannerSelect ? plannerSelect.value : '',
    executorModel: executorSelect ? executorSelect.value : '',
    maxTokens: parseInt(document.getElementById('maxTokens').value, 10),
    temperature: parseFloat(document.getElementById('temperature').value)
  };

  // Validate token
  if (!settings.hfToken) {
    showStatus('Please enter an API token', 'error');
    return;
  }

  if (!settings.plannerModel || !settings.executorModel) {
    showStatus('Please select both planner and executor models', 'error');
    return;
  }

  try {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });

    // Update the LLM client with new settings
    if (llmClient.isInitialized && llmClient.currentLLM) {
      llmClient.currentLLM.token = settings.hfToken;
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
  const plannerModelName = plannerSelect ? plannerSelect.value : '';

  if (!token) {
    showStatus('Please enter an API token first', 'error');
    return;
  }

  if (!plannerModelName) {
    showStatus('Please select a planner model first', 'error');
    return;
  }

  showStatus('Testing connection...', 'success');
  testBtn.disabled = true;

  try {
    // Initialize LLM client if not already done
    if (!llmClient.isInitialized) {
      await llmClient.initialize();
    }

    // Remember the original model and token so we can restore them
    const originalModel = llmClient.currentLLM;
    const originalToken = originalModel ? originalModel.token : null;

    // Switch to the planner model
    llmClient.selectLLM(plannerModelName);

    // Update token temporarily for test
    llmClient.currentLLM.token = token;

    // Test with a simple prompt
    const response = await llmClient.generateCompletion(
      "Say 'Hello, test successful!' if you can read this.",
      {
        maxTokens: 50,
        temperature: 0.7
      }
    );

    // Restore original model and token
    if (originalModel && originalModel.name) {
      llmClient.selectLLM(originalModel.name);
      if (originalToken !== null) {
        llmClient.currentLLM.token = originalToken;
      }
    }

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

// Reset the new model form inputs
function resetNewModelForm() {
  if (newModelNameInput) newModelNameInput.value = '';
  if (newModelTokenInput) newModelTokenInput.value = '';
  if (newModelBaseURLInput) newModelBaseURLInput.value = '';
  if (newModelMODELInput) newModelMODELInput.value = '';
  if (newModelPromptInput) newModelPromptInput.value = '';
}

// Append a single model option to both planner and executor dropdowns
function appendModelToDropdowns(model) {
  if (!model || !model.name) return;
  [plannerSelect, executorSelect].forEach((select) => {
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

    // Immediately append to planner and executor dropdowns
    appendModelToDropdowns(newModel);

    // Optionally auto-select the new model
    if (plannerSelect) plannerSelect.value = name;
    if (executorSelect) executorSelect.value = name;

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

// Close the Settings tab and return to the original site
async function handleBackToSite() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id) {
      await chrome.tabs.remove(activeTab.id);
      return;
    }
  } catch (error) {
    console.error('Error closing settings tab:', error);
  }

  // Fallback: try closing the window if running in a popup-like context
  try {
    window.close();
  } catch (_) {
    // ignore
  }
}

// Event listeners
settingsForm.addEventListener('submit', saveSettings);
testBtn.addEventListener('click', testConnection);

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

// Load settings on page load
loadSettings();
