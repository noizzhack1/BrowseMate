// Settings page script - manages Hugging Face configuration

const settingsForm = document.getElementById('settingsForm');
const statusMessage = document.getElementById('statusMessage');
const testBtn = document.getElementById('testBtn');

// Default settings
const DEFAULT_SETTINGS = {
  hfToken: '',
  hfModel: '',
  maxTokens: 1024,
  temperature: 0.7,
  providerType: 'config',
  localName: '',
  localBaseUrl: '',
  localModel: ''
};

/**
 * Populate the models section from config/llm-config.json
 * Builds two "Custom Provider" entries based on the first two llms,
 * and (optionally) a Local Model entry if configured in settings.
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {Promise<Array>}
 */
async function populateModelsFromConfig(settings) {
  const listEl = document.getElementById('modelsList');
  const hiddenModelInput = document.getElementById('hfModel');
  if (!listEl || !hiddenModelInput) return [];

  try {
    const url = chrome.runtime.getURL('config/llm-config.json');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load llm-config.json (${res.status})`);

    const data = await res.json();
    const llms = Array.isArray(data.llms) ? data.llms : [];

    // Clear any existing items
    listEl.innerHTML = '';

    llms.slice(0, 2).forEach((llm, index) => {
      const id = `provider-${index}`;

      const label = document.createElement('label');
      label.className = 'model-card';
      label.setAttribute('for', id);

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'provider';
      radio.id = id;
      radio.value = llm.MODEL;
      radio.dataset.provider = 'config';

      const content = document.createElement('div');
      content.className = 'model-card-content';

      const title = document.createElement('div');
      title.className = 'model-card-title';
      title.textContent = `Custom Provider ${index + 1} \u2013 ${llm.name || llm.MODEL}`;

      const meta = document.createElement('div');
      meta.className = 'model-card-meta';
      meta.textContent = llm.MODEL;

      content.appendChild(title);
      content.appendChild(meta);

      label.appendChild(radio);
      label.appendChild(content);
      listEl.appendChild(label);
    });

    // Add a "Local Model" provider option only if it has been configured
    if (settings && (settings.localBaseUrl || settings.localModel)) {
      const localId = 'provider-local';
      const localLabel = document.createElement('label');
      localLabel.className = 'model-card';
      localLabel.setAttribute('for', localId);

      const localRadio = document.createElement('input');
      localRadio.type = 'radio';
      localRadio.name = 'provider';
      localRadio.id = localId;
      localRadio.value = 'LOCAL';
      localRadio.dataset.provider = 'local';

      const localContent = document.createElement('div');
      localContent.className = 'model-card-content';

      const localTitle = document.createElement('div');
      localTitle.className = 'model-card-title';
      localTitle.textContent = settings.localName || 'Local Model';

      const localMeta = document.createElement('div');
      localMeta.className = 'model-card-meta';
      localMeta.textContent = settings.localModel || 'Use a local OpenAI-compatible server (configure below).';

      localContent.appendChild(localTitle);
      localContent.appendChild(localMeta);

      localLabel.appendChild(localRadio);
      localLabel.appendChild(localContent);
      listEl.appendChild(localLabel);
    }

    // Keep the hidden input in sync with the selected radio
    listEl.addEventListener('change', (event) => {
      if (event.target && event.target.name === 'provider') {
        hiddenModelInput.value = event.target.value;
      }
    });

    return llms;
  } catch (error) {
    console.error('Error loading llm-config.json:', error);
    // Keep existing options if config fetch fails
    return [];
  }
}

/**
 * Load settings from Chrome storage
 */
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get('browsemate_settings');
    const settings = result.browsemate_settings || DEFAULT_SETTINGS;

    // First populate model options from config so we can safely select a value
    await populateModelsFromConfig(settings);

    // Populate form fields
    const hfTokenInput = document.getElementById('hfToken');
    const hfModelInput = document.getElementById('hfModel');
    const localNameInput = document.getElementById('localName');
    const localBaseUrlInput = document.getElementById('localBaseUrl');
    const localModelInput = document.getElementById('localModel');

    hfTokenInput.value = settings.hfToken || '';

    // Restore local model inputs
    localNameInput.value = settings.localName || '';
    localBaseUrlInput.value = settings.localBaseUrl || '';
    localModelInput.value = settings.localModel || '';

    // Ensure selected provider/model exists in the current options
    const radios = Array.from(document.querySelectorAll('input[name=\"provider\"]'));
    let modelValue = settings.hfModel;
    let radioToCheck = null;

    if (settings.providerType === 'local') {
      radioToCheck = radios.find(r => r.dataset.provider === 'local') || null;
      modelValue = 'LOCAL';
    } else if (modelValue) {
      radioToCheck = radios.find(r => r.value === modelValue) || null;
    }

    if (!radioToCheck && radios.length > 0) {
      radioToCheck = radios[0];
      modelValue = radios[0].value;
    }

    if (radioToCheck) {
      radioToCheck.checked = true;
    }

    hfModelInput.value = modelValue || '';

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
    hfModel,
    maxTokens: parseInt(document.getElementById('maxTokens').value),
    temperature: parseFloat(document.getElementById('temperature').value),
    providerType,
    localName,
    localBaseUrl,
    localModel
  };

  // Validate token
  if (!settings.hfToken) {
    showStatus('Please enter a Hugging Face API token', 'error');
    return;
  }

  if (!settings.hfToken.startsWith('hf_')) {
    showStatus('Warning: Hugging Face tokens usually start with "hf_"', 'error');
    return;
  }

  try {
    await chrome.storage.sync.set({ browsemate_settings: settings });
    showStatus('Settings saved successfully!', 'success');
    // Rebuild the models list so the local model appears as a provider if configured
    await loadSettings();
  } catch (error) {
    showStatus('Error saving settings: ' + error.message, 'error');
  }
}

/**
 * Test the Hugging Face API connection
 */
async function testConnection() {
  const token = document.getElementById('hfToken').value.trim();
  const model = document.getElementById('hfModel').value;

  if (!token) {
    showStatus('Please enter an API token first', 'error');
    return;
  }

  showStatus('Testing connection...', 'success');
  testBtn.disabled = true;

  try {
    const response = await fetch(
      'https://router.huggingface.co/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'user',
              content: "Say 'Hello, test successful!' if you can read this."
            }
          ],
          max_tokens: 50,
          temperature: 0.7
        })
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

    showStatus('Connection successful! Model is responding.', 'success');
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
