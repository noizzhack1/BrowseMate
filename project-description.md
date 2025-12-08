# AI Browser Extension - Project Specification

## 📋 Project Overview

### Purpose
Build an AI-powered browser extension with a chat sidebar that can:
- See and understand the current page content
- Answer user questions about the page
- Perform automated actions (click buttons, fill forms, scroll, etc.)

### Technology Stack
- **Language:** JavaScript ES6
- **Runtime:** Chrome Extension (Manifest V3)
- **LLM Integration:** HuggingFace API (planner + actions)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSEMATE EXTENSION                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   sidebar.html + script.js          content.js                  │
│   ┌─────────────────────┐          ┌─────────────────────┐      │
│   │  Chat UI            │          │  DOM Access         │      │
│   │  LLM API calls      │◄────────►│  Action Execution   │      │
│   │  Orchestrator       │          │  Page Context       │      │
│   └─────────────────────┘          └─────────────────────┘      │
│                                              │                   │
│                                              ▼                   │
│                                    ┌─────────────────────┐      │
│                                    │     PAGE DOM        │      │
│                                    └─────────────────────┘      │
│                                                                  │
│   background.js                                                  │
│   ┌─────────────────────┐                                       │
│   │  Extension Lifecycle │                                       │
│   │  Open Side Panel     │                                       │
│   └─────────────────────┘                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ fetch()
                              ▼
                    ┌─────────────────┐
                    │  HuggingFace    │
                    │  LLM API        │
                    └─────────────────┘
```

---

## 📁 File Structure

```
BrowseMate/
├── manifest.json        # Extension configuration
├── background.js        # Service worker
├── sidebar.html         # Sidebar UI markup
├── script.js            # Sidebar logic (Task A - Orchestrator)
├── content.js           # Page script (Task B - Action Executor)
├── styles.css           # Sidebar styles
├── settings.html        # Settings page
└── settings.js          # Settings logic
```

---

## 📦 TASK A - ORCHESTRATOR (script.js)

### Responsibilities
1. Receive user prompt from chat UI
2. Get page context
3. Call Planner LLM to determine intent
4. If question → return answer directly
5. If action → delegate to content.js (Task B)

### Functions

```javascript
async function processRequest(prompt, usePageContext) {}
async function getPageContext(options) {}
async function callPlannerLLM(context, prompt) {}
async function delegateToTaskB(action) {}
async function callHuggingFaceAPI(userText, includeContext) {}
```

### Planner LLM Response Format

```javascript
{
  intent: "question" | "action",
  answer: "string (if question)",
  action: {
    type: "click|fill|select|scroll|check|hover|submit",
    target: "CSS selector or element description",
    value: "optional value for fill/select"
  }
}
```

---

## ⚡ TASK B - ACTION EXECUTOR (content.js)

### Responsibilities
1. Listen for action requests from sidebar
2. Find target element in DOM
3. Execute action (click, fill, scroll, etc.)
4. Detect if page changed
5. Retry up to 3 times if no change
6. Return success/failure

### Functions

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {})
async function executeAction(action) {}
function findElement(target) {}
function performAction(element, actionType, value) {}
function detectChange(beforeHTML, afterHTML) {}
async function executeWithRetry(action) {}
```

### Supported Actions

| Type | Description | Needs Value? |
|------|-------------|--------------|
| `click` | Click element | No |
| `fill` | Fill input field | Yes |
| `select` | Select dropdown option | Yes |
| `scroll` | Scroll page | Yes (direction) |
| `check` | Toggle checkbox | No |
| `hover` | Hover over element | No |
| `submit` | Submit form | No |

---

## 🔄 Data Flow

### Question Flow
```
User: "What is the price?"
  → getPageContext()
  → callPlannerLLM() → { intent: "question", answer: "$99" }
  → Return to UI: "$99"
```

### Action Flow
```
User: "Click buy button"
  → getPageContext()
  → callPlannerLLM() → { intent: "action", action: { type: "click", target: ".buy-btn" } }
  → delegateToTaskB() → content.js
  → executeAction() → clicks button
  → Return to UI: "Clicked buy button"
```

---

## 🛡️ Error Handling

| Scenario | Response |
|----------|----------|
| Empty prompt | Return error message |
| LLM call fails | Fallback to direct LLM call |
| Element not found | Return error, retry |
| Action failed | Retry up to 3 times |

---

## ✅ Acceptance Criteria

### Task A (script.js)
- [ ] `getPageContext()` supports text and HTML modes
- [ ] `callPlannerLLM()` determines intent
- [ ] `processRequest()` orchestrates the flow
- [ ] `delegateToTaskB()` sends actions to content.js

### Task B (content.js)
- [ ] Listens for action messages
- [ ] Finds elements by selector/text
- [ ] Executes all action types
- [ ] Detects DOM changes
- [ ] Retries up to 3 times

---

## 🚀 Implementation Order

```
1. Extend getPageContext() with HTML mode
2. Add callPlannerLLM()
3. Add processRequest() orchestrator
4. Add delegateToTaskB()
5. Add message listener to content.js
6. Add executeAction()
7. Add findElement()
8. Add retry logic
9. Testing
```
