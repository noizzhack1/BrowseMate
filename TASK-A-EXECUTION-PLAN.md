# Task A - Orchestrator Module: Execution Plan

## 📋 Overview

**Module:** Task A - Orchestrator  
**Location:** `script.js`  
**Purpose:** Receive user prompts, get page context, determine intent via Planner LLM, route to answer or action

---

## 🏗️ Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                      BROWSEMATE                                │
│                                                                │
│   script.js (Orchestrator)              content.js (Executor) │
│   ┌──────────────────────┐             ┌──────────────────┐   │
│   │ getPageContext()  ✅  │             │ executeAction() 🆕│   │
│   │ callHuggingFaceAPI()✅│◄───────────►│ findElement()   🆕│   │
│   │ callPlannerLLM()  🆕  │             │ performAction() 🆕│   │
│   │ processRequest()  🆕  │             └────────┬─────────┘   │
│   │ delegateToTaskB() 🆕  │                      │             │
│   └──────────────────────┘                      ▼             │
│                                          ┌───────────┐        │
│                                          │  PAGE DOM │        │
│                                          └───────────┘        │
└───────────────────────────────────────────────────────────────┘
```

---

## 🔄 Current Status

| Feature | Status | Location |
|---------|--------|----------|
| `getPageContext()` | ✅ Exists | `script.js` |
| `callHuggingFaceAPI()` | ✅ Exists | `script.js` |
| Settings management | ✅ Exists | `settings.js` |
| Chat UI | ✅ Exists | `sidebar.html` |
| Content script | ✅ Exists | `content.js` |

---

## 🎯 Acceptance Criteria

- [ ] Extend `getPageContext()` to support HTML extraction
- [ ] Create `callPlannerLLM()` for intent analysis
- [ ] Create `processRequest()` as main orchestrator
- [ ] Create `delegateToTaskB()` to send actions to content.js
- [ ] Update `handleChatSubmit()` to use `processRequest()`
- [ ] Add message listener to `content.js`

---

## 📁 Files to Modify

| File | Changes |
|------|---------|
| `script.js` | Add `callPlannerLLM()`, `processRequest()`, `delegateToTaskB()`, extend `getPageContext()` |
| `content.js` | Add message listener and `executeAction()` placeholder |

---

## 🔄 Task A Flow

```
User Input (prompt)
        ↓
   processRequest(prompt)
        ↓
   getPageContext({ includeHTML: true })
        ↓
   callPlannerLLM(context, prompt)
        ↓
   ┌────┴────┐
   │         │
Question   Action
   │         │
   ↓         ↓
Return    delegateToTaskB(action)
Answer         │
   │           ↓
   │      content.js → executeAction() → DOM
   │           │
   └─────┬─────┘
         ↓
   Return to UI
```

---

## 📦 Implementation

### **Phase 1: Extend getPageContext() (script.js)**

```javascript
/**
 * Get page context (URL, title, content, optional HTML)
 * @param {object} options
 * @param {boolean} options.includeHTML - Include interactive elements
 * @param {number} options.textLimit - Character limit (default: 3000)
 */
async function getPageContext(options = {}) {
  const { includeHTML = false, textLimit = 3000 } = options;
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      return { url: '', title: '', text: '' };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (includeHTML, textLimit) => {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
        const text = clone.innerText.replace(/\s+/g, ' ').trim().slice(0, textLimit);

        const result = {
          url: window.location.href,
          title: document.title,
          text: text
        };

        if (includeHTML) {
          const elements = document.querySelectorAll(
            'button, a, input, select, textarea, [onclick], [role="button"]'
          );
          const htmlParts = [];
          elements.forEach((el, i) => {
            if (i < 50) {
              const tag = el.tagName.toLowerCase();
              const id = el.id ? `#${el.id}` : '';
              const classes = el.className ? `.${el.className.split(' ').join('.')}` : '';
              const text = el.innerText?.slice(0, 50) || '';
              htmlParts.push(`<${tag}${id}${classes}>${text}</${tag}>`);
            }
          });
          result.html = htmlParts.join('\n');
        }

        return result;
      },
      args: [includeHTML, textLimit]
    });

    return results?.[0]?.result ?? { url: '', title: '', text: '' };
  } catch (error) {
    console.error('Error getting page context:', error);
    return { url: '', title: '', text: '' };
  }
}
```

---

### **Phase 2: Add callPlannerLLM() (script.js)**

```javascript
/**
 * Call Planner LLM to analyze user intent
 * @param {object} context - Page context
 * @param {string} prompt - User's request
 * @returns {Promise<{intent: string, answer?: string, action?: object}>}
 */
async function callPlannerLLM(context, prompt) {
  const result = await chrome.storage.sync.get('browsemate_settings');
  const settings = result.browsemate_settings;

  if (!settings || !settings.hfToken) {
    throw new Error('Please configure your API token in Settings.');
  }

  const systemPrompt = `You are a browser assistant. Analyze if this is:
1. A QUESTION about the page → provide answer
2. An ACTION request → provide action details

Respond in JSON:
{
  "intent": "question" or "action",
  "answer": "string (if question)",
  "action": {
    "type": "click|fill|select|scroll|check|hover|submit",
    "target": "CSS selector or description",
    "value": "optional value"
  }
}`;

  const userMessage = `Page: ${context.url}
Title: ${context.title}
Content: ${context.text}
${context.html ? `Elements:\n${context.html}` : ''}

Request: ${prompt}`;

  const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.hfToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.hfModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_tokens: settings.maxTokens || 1024,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON found');
  } catch (parseError) {
    return { intent: 'question', answer: content };
  }
}
```

---

### **Phase 3: Add delegateToTaskB() (script.js)**

```javascript
/**
 * Send action to content.js for execution
 * @param {object} action - Action to execute
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function delegateToTaskB(action) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      return { success: false, message: 'No active tab found' };
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXECUTE_ACTION',
      action: action
    });

    return response || { success: false, message: 'No response' };
  } catch (error) {
    return { 
      success: false, 
      message: error.message.includes('Receiving end does not exist')
        ? 'Please refresh the page'
        : error.message
    };
  }
}
```

---

### **Phase 4: Add processRequest() (script.js)**

```javascript
/**
 * Main orchestrator - process user request
 * @param {string} prompt - User's message
 * @param {boolean} usePageContext - Include page context
 * @returns {Promise<{type: string, message: string, success: boolean}>}
 */
async function processRequest(prompt, usePageContext = true) {
  if (!prompt || !prompt.trim()) {
    return { type: 'error', message: 'Please enter a message.', success: false };
  }

  try {
    let context = { url: '', title: '', text: '', html: '' };
    if (usePageContext) {
      context = await getPageContext({ includeHTML: true });
    }

    const plannerResponse = await callPlannerLLM(context, prompt);

    if (plannerResponse.intent === 'question') {
      return {
        type: 'answer',
        message: plannerResponse.answer || 'No answer found.',
        success: true
      };
    } 
    
    if (plannerResponse.intent === 'action' && plannerResponse.action) {
      const result = await delegateToTaskB(plannerResponse.action);
      return {
        type: 'action_result',
        message: result.message,
        success: result.success
      };
    }

    // Fallback
    const fallback = await callHuggingFaceAPI(prompt, usePageContext);
    return { type: 'answer', message: fallback, success: true };

  } catch (error) {
    try {
      const fallback = await callHuggingFaceAPI(prompt, usePageContext);
      return { type: 'answer', message: fallback, success: true };
    } catch {
      return { type: 'error', message: error.message, success: false };
    }
  }
}
```

---

### **Phase 5: Update handleChatSubmit() (script.js)**

```javascript
async function handleChatSubmit(event) {
  event.preventDefault();
  if (!chatInputEl) return;

  const value = chatInputEl.value.trim();
  if (!value) return;

  appendMessage("user", value);
  chatInputEl.value = "";
  autoResizeTextArea(chatInputEl);
  appendMessage("assistant", "Thinking...");

  const includeContext = includePageContextCheckbox?.checked || false;
  const result = await processRequest(value, includeContext);

  if (chatMessagesEl && chatMessagesEl.lastChild) {
    chatMessagesEl.removeChild(chatMessagesEl.lastChild);
  }

  if (result.type === 'action_result') {
    const prefix = result.success ? '✅' : '❌';
    appendMessage("assistant", `${prefix} ${result.message}`);
  } else {
    appendMessage("assistant", result.message);
  }
}
```

---

### **Phase 6: Update content.js**

```javascript
/**
 * Listen for action requests from sidebar
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXECUTE_ACTION') {
    executeAction(message.action)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, message: error.message }));
    return true;
  }
});

/**
 * Execute action on DOM (placeholder for Task B)
 * @param {object} action
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function executeAction(action) {
  console.log('Action:', action);
  
  // TODO: Full implementation in Task B
  return {
    success: false,
    message: `Action "${action.type}" on "${action.target}" - Task B pending`
  };
}
```

---

## ✅ Checklist

- [ ] Extend `getPageContext()` with HTML mode
- [ ] Add `callPlannerLLM()`
- [ ] Add `delegateToTaskB()`
- [ ] Add `processRequest()`
- [ ] Update `handleChatSubmit()`
- [ ] Add message listener to `content.js`

---

## 🧪 Test Scenarios

### Question
```
Input: "What is the price?"
→ { intent: "question", answer: "$99" }
→ UI shows "$99"
```

### Action
```
Input: "Click buy button"
→ { intent: "action", action: { type: "click", target: ".buy-btn" } }
→ content.js executes
→ UI shows "✅ Clicked" or "❌ Failed"
```

---

## 📅 Timeline

| Step | Task | Time |
|------|------|------|
| 1 | Extend `getPageContext()` | 20 min |
| 2 | Add `callPlannerLLM()` | 30 min |
| 3 | Add `delegateToTaskB()` | 15 min |
| 4 | Add `processRequest()` | 25 min |
| 5 | Update `handleChatSubmit()` | 10 min |
| 6 | Update `content.js` | 15 min |
| 7 | Testing | 30 min |
| **Total** | | **~2.5 hours** |

---

## 🔜 Next: Task B

After Task A:
1. **Full action execution in content.js**
   - `findElement()` - locate elements
   - `performAction()` - click, fill, select
   - `detectChange()` - check DOM changed
   - `executeWithRetry()` - retry logic
2. **Integration testing**
3. **Better error messages**
