# BrowseMate

A Chrome MV3 extension with AI-powered automation capabilities using LLM inference.

---

## Features

- **Side Panel UI** — Clean interface for interacting with the extension
- **LLM Integration** — Supports multiple LLM providers via HuggingFace Router
- **DOM Automation** — Content script navigator for browser automation

---

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure LLMs

Create a `config.json` file (not tracked in git):

```json
{
  "llms": [
    {
      "name": "Qwen",
      "token": "hf_YOUR_TOKEN_HERE",
      "baseURL": "https://router.huggingface.co/v1",
      "MODEL": "Qwen/Qwen2.5-32B-Instruct:featherless-ai",
      "prompt": "Your system prompt here"
    },
    {
      "name": "Mistral",
      "token": "hf_YOUR_TOKEN_HERE",
      "baseURL": "https://router.huggingface.co/v1",
      "MODEL": "mistralai/Codestral-22B-v0.1:fireworks-ai",
      "prompt": "Your system prompt here"
    }
  ]
}
```

**Note:** Get your HuggingFace token at https://huggingface.co/settings/tokens

### 3. Load Extension in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder

---

## LLM Inference

Run inference using the configured LLMs:

```bash
# Use default LLM (first in config)
node inference_llm.js

# Specify LLM by name
node inference_llm.js Qwen
node inference_llm.js Mistral
```

### Supported Providers

The model name format is `model-id:provider-name`. Available providers include:
- `featherless-ai`
- `fireworks-ai`
- `nebius`
- `novita`
- `nscale`

Check available models at: https://huggingface.co/inference/models

---

## Project Structure

```
BrowseMate/
├── manifest.json       # Chrome extension manifest
├── background.js       # Service worker
├── content.js          # Content script
├── sidebar.html        # Side panel UI
├── styles.css          # Styles
├── settings.html       # Settings page
├── settings.js         # Settings logic
├── inference_llm.js    # LLM inference script
├── config.json         # LLM configuration (gitignored)
├── package.json        # Node dependencies
└── .gitignore
```

---

## Configuration

### config.json fields

| Field | Description |
|-------|-------------|
| `name` | Display name for the LLM |
| `token` | HuggingFace API token |
| `baseURL` | API endpoint URL |
| `MODEL` | Model ID with provider suffix |
| `prompt` | Default prompt for this LLM |

---

## Development

```bash
# Test LLM connection
node inference_llm.js

# Check available LLMs
# Edit config.json to add/modify LLMs
```

---

## License

MIT
