# AI Browser Extension Backend - Project Specification

## 📋 Project Overview

### Purpose
Build the **backend logic** for a browser extension that provides an AI-powered chat sidebar. The sidebar can:
- See and understand the current page context (HTML + CSS)
- Answer user questions about the page content
- Perform automated actions on behalf of the user (click buttons, fill forms, scroll, etc.)

### Technology Stack
- **Language:** JavaScript ES6
- **Runtime:** Browser Extension Environment
- **LLM Integration:** External AI model API calls (planner model + actions model)

---

## 🏗️ System Architecture

```mermaid
flowchart TB
    subgraph Frontend
        UI[Sidebar UI]
    end

    subgraph TaskA[Task A - Orchestrator]
        A1[Receive Context + Prompt]
        A2[Planner LLM]
        A3{Intent?}
        A4[Return Answer]
        A5[Delegate to Task B]
    end

    subgraph TaskB[Task B - Action Executor]
        B1[Receive Action]
        B2[Actions LLM]
        B3[Generate Code]
        B4[EVAL Execute]
        B5{HTML Changed?}
        B6[Retry]
        B7[Return Result]
    end

    UI --> A1
    A1 --> A2
    A2 --> A3
    A3 -->|Question| A4
    A3 -->|Action| A5
    A5 --> B1
    B1 --> B2
    B2 --> B3
    B3 --> B4
    B4 --> B5
    B5 -->|No| B6
    B6 -->|Max 3x| B2
    B5 -->|Yes| B7
    B7 --> A5
    A4 --> UI
    A5 --> UI
```

---

## 🔄 Sequence Diagram - Full Flow

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant TA as Task A
    participant PL as Planner LLM
    participant TB as Task B
    participant AL as Actions LLM
    participant DOM as Page DOM

    FE->>TA: { context, prompt }
    TA->>PL: Analyze intent
    PL-->>TA: { intent, answer?, action? }
    
    alt Intent = Question
        TA-->>FE: { type: "answer", message }
    else Intent = Action
        TA->>TB: { context, action }
        TB->>AL: Generate code for action
        AL-->>TB: { code, explanation }
        
        loop Max 3 attempts
            TB->>DOM: Execute code (EVAL)
            DOM-->>TB: New HTML
            TB->>TB: Compare HTML
            alt HTML Changed
                TB-->>TA: { success: true }
            else No Change
                TB->>AL: Retry with new approach
            end
        end
        
        TB-->>TA: { success, message }
        TA-->>FE: { type: "action_result", message, success }
    end
```

---

## 📦 TASK A - ORCHESTRATOR MODULE

### Responsibilities
1. Receive context (HTML + CSS) and user prompt from frontend
2. Send to Planner LLM
3. If question → return answer to frontend
4. If action needed → delegate to Task B

```mermaid
flowchart LR
    A[Input] --> B[Planner LLM]
    B --> C{Intent?}
    C -->|Question| D[Return Answer]
    C -->|Action| E[Call Task B]
    E --> F[Return Result]
```

### Interfaces

```javascript
// INPUT: What Task A receives from frontend
{
  context: string,    // HTML + CSS combined
  prompt: string      // User's question or request
}

// OUTPUT: What Task A returns to frontend
{
  type: string,       // "answer" | "action_result"
  message: string,    // Response text for the user
  success: boolean    // Did it work?
}
```

### Planner LLM Response Format

```javascript
// What the Planner LLM should return
{
  intent: string,     // "question" | "action"
  answer: string,     // If question: the answer text
  action: {           // If action: what to do
    type: string,     // "click" | "fill" | "scroll" | "select" | etc.
    target: string,   // Description of element (e.g., "the blue submit button")
    value: string     // Optional: value for fill/select actions
  }
}
```

### Task A Functions

```javascript
/**
 * Main entry point
 * @param {string} context - HTML + CSS content
 * @param {string} prompt - User's request
 * @returns {Promise<{type, message, success}>}
 */
async function processRequest(context, prompt) {}

/**
 * Call Planner LLM
 * @param {string} context - Page context
 * @param {string} prompt - User prompt
 * @returns {Promise<{intent, answer?, action?}>}
 */
async function callPlannerLLM(context, prompt) {}

/**
 * Delegate action to Task B
 * @param {string} context - Page context
 * @param {{type, target, value?}} action - Action to perform
 * @returns {Promise<{success, message}>}
 */
async function delegateToTaskB(context, action) {}
```

---

## ⚡ TASK B - ACTION EXECUTOR MODULE

### Responsibilities
1. Receive context and action from Task A
2. Call Actions LLM to generate JavaScript code
3. Execute code with EVAL
4. Check if HTML changed
5. Retry up to 3 times if no change
6. Return SUCCESS or FAILED to Task A

```mermaid
flowchart TB
    A[Receive Action] --> B[Actions LLM]
    B --> C[Generate Code]
    C --> D[EVAL]
    D --> E[Get New HTML]
    E --> F{Changed?}
    F -->|Yes| G[SUCCESS]
    F -->|No| H{Attempts < 3?}
    H -->|Yes| B
    H -->|No| I[FAILED]
```

### Interfaces

```javascript
// INPUT: What Task B receives from Task A
{
  context: string,    // Current HTML + CSS
  action: {
    type: string,     // "click" | "fill" | "scroll" | etc.
    target: string,   // Element description
    value: string     // Optional value
  }
}

// OUTPUT: What Task B returns to Task A
{
  success: boolean,   // true = SUCCESS, false = FAILED
  message: string     // Description of what happened
}
```

### Actions LLM Response Format

```javascript
// What the Actions LLM should return
{
  code: string,       // Executable JavaScript code
  explanation: string // What the code does
}
```

### Task B Functions

```javascript
/**
 * Main entry point
 * @param {string} context - HTML + CSS content
 * @param {{type, target, value?}} action - Action to perform
 * @returns {Promise<{success, message}>}
 */
async function executeAction(context, action) {}

/**
 * Call Actions LLM to generate code
 * @param {string} context - Page context
 * @param {{type, target, value?}} action - Action descriptor
 * @returns {Promise<{code, explanation}>}
 */
async function callActionsLLM(context, action) {}

/**
 * Execute generated code
 * @param {string} code - JavaScript to execute
 * @returns {Promise<{success, error?}>}
 */
async function runCode(code) {}

/**
 * Get current page HTML
 * @returns {string}
 */
function getHTML() {}

/**
 * Check if HTML changed
 * @param {string} before - HTML before action
 * @param {string} after - HTML after action
 * @returns {boolean}
 */
function hasChanged(before, after) {}

/**
 * Execute with retry logic (max 3 attempts)
 * @param {string} context - Page context
 * @param {{type, target, value?}} action - Action to perform
 * @returns {Promise<{success, message}>}
 */
async function executeWithRetry(context, action) {}
```

---

## 🔄 Data Flow Examples

### Question Flow

```mermaid
sequenceDiagram
    Frontend->>Task A: { context, prompt: "What is the price?" }
    Task A->>Planner LLM: Analyze
    Planner LLM-->>Task A: { intent: "question", answer: "$99" }
    Task A-->>Frontend: { type: "answer", message: "$99", success: true }
```

### Action Flow (Success on First Try)

```mermaid
sequenceDiagram
    Frontend->>Task A: { context, prompt: "Click buy button" }
    Task A->>Planner LLM: Analyze
    Planner LLM-->>Task A: { intent: "action", action: {type: "click", target: "buy button"} }
    Task A->>Task B: { context, action }
    Task B->>Actions LLM: Generate code
    Actions LLM-->>Task B: { code: "document.querySelector('.buy').click()" }
    Task B->>Task B: EVAL + Check HTML
    Note over Task B: HTML Changed ✓
    Task B-->>Task A: { success: true, message: "Clicked buy button" }
    Task A-->>Frontend: { type: "action_result", success: true }
```

### Action Flow (Retry then Fail)

```mermaid
sequenceDiagram
    Task A->>Task B: { context, action }
    
    loop Attempt 1-3
        Task B->>Actions LLM: Generate code
        Actions LLM-->>Task B: { code }
        Task B->>Task B: EVAL + Check HTML
        Note over Task B: No change detected
    end
    
    Task B-->>Task A: { success: false, message: "Failed after 3 attempts" }
```

---

## 📝 Supported Actions

| Type | Description | Needs Value? |
|------|-------------|--------------|
| `click` | Click element | No |
| `fill` | Fill input field | Yes |
| `select` | Select dropdown option | Yes |
| `scroll` | Scroll page (up/down/top/bottom) | Yes (direction) |
| `check` | Toggle checkbox | No |
| `hover` | Hover over element | No |
| `submit` | Submit form | No |

---

## 🛡️ Error Handling

```javascript
// Simple error codes
const Errors = {
  LLM_FAILED: 'LLM call failed',
  CODE_FAILED: 'Code execution failed',
  MAX_RETRIES: 'Max retries exceeded',
  INVALID_ACTION: 'Invalid action type'
};
```

---

## 📁 File Structure

```mermaid
flowchart TB
    subgraph src["/src"]
        subgraph taskA["/taskA"]
            A1[index.js]
        end
        subgraph taskB["/taskB"]
            B1[index.js]
            B2[diff.js]
            B3[retry.js]
        end
        subgraph llm["/llm"]
            L1[index.js]
        end
        subgraph utils["/utils"]
            U1[logger.js]
        end
    end
```

```
/src
  /taskA
    index.js          # processRequest, callPlannerLLM, delegateToTaskB
  /taskB
    index.js          # executeAction, callActionsLLM, runCode
    diff.js           # hasChanged
    retry.js          # executeWithRetry
  /llm
    index.js          # Generic LLM call wrapper
  /utils
    logger.js         # Simple logging
```

---

## ✅ Acceptance Criteria

### Task A
- [ ] Receives context + prompt
- [ ] Calls Planner LLM
- [ ] Returns answer for questions
- [ ] Delegates actions to Task B
- [ ] Returns final result to frontend

### Task B
- [ ] Receives context + action
- [ ] Calls Actions LLM for code
- [ ] Executes code with EVAL
- [ ] Detects HTML changes
- [ ] Retries up to 3 times
- [ ] Returns SUCCESS or FAILED

---

## 🚀 Implementation Order

```mermaid
gantt
    title Implementation Timeline
    dateFormat  X
    axisFormat %s
    
    section Phase 1
    LLM Wrapper           :a1, 0, 1
    
    section Phase 2
    Task A - Planner      :a2, 1, 2
    
    section Phase 3
    Task B - Executor     :a3, 2, 4
    Task B - Diff         :a4, 2, 3
    Task B - Retry        :a5, 3, 4
    
    section Phase 4
    Integration           :a6, 4, 5
    Testing               :a7, 5, 6
```

1. **LLM wrapper** - Generic function to call LLM APIs
2. **Task A** - Planner logic and routing
3. **Task B** - Code generation, execution, diff, retry
4. **Integration** - Connect Task A ↔ Task B
5. **Testing** - End-to-end flows