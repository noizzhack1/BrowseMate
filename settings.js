// Settings page script - manages Hugging Face configuration

const settingsForm = document.getElementById('settingsForm');
const statusMessage = document.getElementById('statusMessage');
const testBtn = document.getElementById('testBtn');

// Default settings
const DEFAULT_SETTINGS = {
  hfToken: '',
  hfModel: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  maxTokens: 1024,
  temperature: 0.7
};

/**
 * Load settings from Chrome storage
 */
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get('browsemate_settings');
    const settings = result.browsemate_settings || DEFAULT_SETTINGS;

    // Populate form fields
    document.getElementById('hfToken').value = settings.hfToken || '';
    document.getElementById('hfModel').value = settings.hfModel || DEFAULT_SETTINGS.hfModel;
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

  const settings = {
    hfToken: document.getElementById('hfToken').value.trim(),
    hfModel: document.getElementById('hfModel').value,
    maxTokens: parseInt(document.getElementById('maxTokens').value),
    temperature: parseFloat(document.getElementById('temperature').value)
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

// Load settings on page load
loadSettings();
