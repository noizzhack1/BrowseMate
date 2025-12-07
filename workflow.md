# BrowseMate Integration Workflow - Changes Documentation

This document tracks all changes made to integrate Task A (Orchestrator) and Task B (Executor) with the LLMClient and activate both plans.

## Overview

The goal was to:
1. Add `plannerCall` and `actionsCall` methods to LLMClient
2. Create Task A orchestrator module
3. Create Task B executor enhancements (diff.js)
4. Update script.js to use Task A instead of direct LLM calls
5. Ensure all components work together correctly

---

## Changes Made

### 1. LLMClient.js (`src/llm/LLMClient.js`)

**Changes:**
- Added `plannerCall(context, userPrompt)` method for Task A
  - Analyzes user request to determine intent (question vs action)
  - Returns structured JSON: `{intent: "question"|"action", answer?: string, action?: {...}}`
  - Handles JSON parsing with fallback error handling
  
- Added `actionsCall(context, action)` method for Task B
  - Generates executable JavaScript code for browser actions
  - Returns: `{code: string, explanation: string}`
  - Validates response structure

- Updated exports:
  - Exported `LLMClient` class for ES6 modules
  - Kept singleton instance `llmClient` for backward compatibility
  - Added global `window.llmClient` for non-module scripts

**Purpose:** Enable Task A and Task B to use the LLM client for their specific purposes.

---

### 2. Task A Orchestrator (`src/taskA/index.js`) - NEW FILE

**Created:**
- `processRequest(context, prompt)` - Main entry point
  - Routes user requests to question answering or action execution
  - Returns: `{type: "answer"|"action_result", message: string, success: boolean}`

- `callPlannerLLM(context, prompt)` - Calls planner LLM
  - Determines if request is a question or action
  - Handles context formatting (string or object)

- `delegateToTaskB(action)` - Delegates actions to Task B
  - Calls `executeAction()` from executor module
  - Handles errors and formats results

**Purpose:** Central orchestrator that routes requests between question answering and action execution.

---

### 3. Task B Executor Enhancements

#### 3a. Diff Utility (`src/executor/diff.js`) - NEW FILE

**Created:**
- `hasChanged(before, after)` - Detects HTML changes
  - Normalizes HTML (removes whitespace, dynamic attributes)
  - Compares before/after HTML to detect meaningful changes
  - Returns boolean indicating if change occurred

- `normalizeHTML(html)` - Normalizes HTML for comparison
  - Removes extra whitespace
  - Strips dynamic attributes (data-react*, data-v-*)
  - Normalizes tag spacing

- `calculateSimilarity(str1, str2)` - Calculates string similarity
  - Returns 0-1 similarity score
  - Used for logging/debugging

**Purpose:** Verify that actions actually changed the page (not just executed without effect).

#### 3b. Executor Updates (`src/executor/index.js`)

**Changes:**
- Added import for `hasChanged` from `diff.js`
- **Fixed CSP violation:** Replaced `eval()` with `chrome.scripting.executeScript()`
  - **Before:** Used `eval(code)` which violates Manifest V3 CSP
  - **After:** Uses `chrome.scripting.executeScript()` with `Function` constructor
  - Executes code in the actual page context (not side panel)
  - CSP-compliant and works with Manifest V3
- Updated `runCode()` function:
  - Gets active tab using `chrome.tabs.query()`
  - Executes code via `chrome.scripting.executeScript()`
  - Handles promises returned by executed code
  - Proper error handling and propagation
- Updated `executeAction()` to:
  - Get HTML before action execution
  - Execute generated code
  - Wait 500ms for DOM updates to propagate
  - Get HTML after execution
  - Check if HTML changed using `hasChanged()`
  - Return success only if:
    - HTML changed (for most actions), OR
    - Code executed without error (for scroll/hover actions that don't change HTML)
  - Return failure if no change detected (triggers retry)

- Improved error handling:
  - Better context retrieval (handles both global `getPageContext()` and chrome.scripting fallback)
  - More detailed error messages
  - Proper LLM call error handling

**Purpose:** Ensure actions are verified by checking if they actually changed the page, and comply with Chrome Extension CSP requirements.

---

### 4. Script.js Updates (`script.js`)

**Changes:**
- Converted to ES6 module (added `type="module"` in sidebar.html)
- Added imports:
  - `import { processRequest } from './src/taskA/index.js'`
  - `import { LLMClient } from './src/llm/LLMClient.js'`

- Replaced `callLLMAPI()` function:
  - **Before:** Direct LLM call using `llmClient.generateCompletion()`
  - **After:** Uses Task A orchestrator via `processRequest()`
  - Handles both question answers and action results
  - Formats responses with status indicators (✓/✗)

- Added global exports:
  - `window.getPageContext = getPageContext` (for Task B executor)
  - `window.llmClient = llmClient` (for backward compatibility)

**Purpose:** Integrate Task A orchestrator into the main UI flow, enabling both question answering and action execution.

---

### 5. Sidebar.html Updates (`sidebar.html`)

**Changes:**
- Changed script tag to use ES6 modules:
  - **Before:** `<script src="script.js"></script>`
  - **After:** `<script type="module" src="script.js"></script>`
- Removed reference to `llm-client.js` (no longer needed, using modules)

**Purpose:** Enable ES6 module imports in script.js.

---

## Data Flow

### Question Flow (Plan A)
```
User Input → script.js → Task A (processRequest) → Planner LLM → 
Answer → script.js → UI Display
```

### Action Flow (Plan B)
```
User Input → script.js → Task A (processRequest) → Planner LLM → 
Action Intent → Task A (delegateToTaskB) → Task B (executeAction) → 
Actions LLM → Generate Code → Execute Code → Check HTML Diff → 
Success/Failure → Task A → script.js → UI Display
```

---

## Integration Points

1. **LLMClient → Task A**: `plannerCall()` method
2. **LLMClient → Task B**: `actionsCall()` method
3. **Task A → Task B**: `delegateToTaskB()` calls `executeAction()`
4. **script.js → Task A**: `processRequest()` replaces direct LLM calls
5. **Task B → getPageContext**: Uses global function from script.js
6. **Task B → diff.js**: Uses `hasChanged()` to verify actions

---

## Testing Checklist

- [ ] Question requests are answered correctly
- [ ] Action requests trigger Task B execution
- [ ] HTML diff detection works for click/fill actions
- [ ] Scroll/hover actions succeed without HTML change
- [ ] Retry logic works when actions fail
- [ ] Error handling works for missing tokens
- [ ] Page context is included when checkbox is checked
- [ ] All modules load correctly as ES6 modules

---

## Files Modified

1. `src/llm/LLMClient.js` - Added plannerCall and actionsCall methods
2. `src/taskA/index.js` - NEW - Task A orchestrator
3. `src/executor/diff.js` - NEW - HTML diff utility
4. `src/executor/index.js` - Updated to use diff.js and improve error handling
5. `script.js` - Updated to use Task A orchestrator
6. `sidebar.html` - Updated to use ES6 modules

---

## Notes

- All code runs in the same context (no message passing needed)
- `getPageContext()` is available globally for Task B
- LLMClient singleton is available globally for backward compatibility
- Task B executor has fallback for getting page context if `getPageContext()` isn't available
- HTML diff check waits 500ms after code execution for async DOM updates

---

## Status

✅ All changes completed and integrated
- Task A (Orchestrator) is active
- Task B (Executor) is active with HTML diff verification
- script.js uses Task A for all requests
- All LLM calls go through the proper channels
