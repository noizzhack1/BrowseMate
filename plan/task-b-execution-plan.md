# TASK B - Action Executor Module - Execution Plan

## Chrome Extension Context

- **Runtime**: Chrome Extension (Manifest V3)
- **Execution Context**: All code runs in the **same context** with full DOM access
- **Architecture**: Task A, Task B, and UI run **together** - NOT separate processes
- **Communication**: **Direct function calls** - NO message passing needed
- **DOM Access**: **Full access** to `document`, `window`, and all DOM APIs in ALL modules
- **Page Context**: Use existing `getPageContext()` function (returns `{url, title, text, html}`)
- **API Keys Storage**: `chrome.storage.sync` / `chrome.storage.local`
- **Module System**: ES6 modules

---

## Key Simplifications

> **Because all code runs in the same context:**

| Before (Complex) | After (Simplified) |
|------------------|-------------------|
| Pass `context` parameter to functions | Call `getPageContext()` when needed |
| Message passing between components | Direct function calls |
| Separate content script for DOM access | DOM access everywhere |
| Complex async communication | Simple async/await |

---

## Understanding

**TASK B** is the Action Executor Module responsible for:
1. Receiving action instructions from Task A (via direct function call)
2. Calling an Actions LLM to generate executable JavaScript code
3. Executing the generated code using EVAL (has full DOM access)
4. Detecting if the page HTML changed (using `getPageContext().html`)
5. Retrying up to 3 times with different approaches if no change detected
6. Returning SUCCESS or FAILED result to Task A

---

## High-Level Plan

1. **Create project structure** - Set up the `/src` directory and subdirectories
2. **Create shared dependencies** - LLM wrapper and Logger utility (prerequisites for Task B)
3. **Implement Task B core modules**:
   - `diff.js` - HTML comparison logic
   - `retry.js` - Retry mechanism (max 3 attempts)
   - `index.js` - Main executor with LLM code generation and EVAL execution

---

## Files to Create

| File | Purpose |
|------|---------|
| `/src/llm/index.js` | Generic LLM API wrapper (shared dependency) |
| `/src/utils/logger.js` | Simple logging utility (shared dependency) |
| `/src/taskB/diff.js` | HTML change detection - `hasChanged()` (uses `getPageContext().html`) |
| `/src/taskB/retry.js` | Retry logic - `executeWithRetry()` |
| `/src/taskB/index.js` | Main entry - `executeAction()`, `callActionsLLM()`, `runCode()` |

> **Note**: No separate `getHTML()` function needed - use existing `getPageContext().html`

---

## Detailed Execution Plan

### Step 1: Create Directory Structure
- Create `/src/llm/`, `/src/taskB/`, `/src/utils/` directories

### Step 2: Create `/src/utils/logger.js`
- Simple logging utility with log levels (info, warn, error, debug)
- Browser console-based (no external dependencies)
- Prefix logs with `[BrowseMate]` for easy filtering

### Step 3: Create `/src/llm/index.js`
- Generic LLM call wrapper function using `fetch()` API
- Retrieve API key from `chrome.storage.sync` or `chrome.storage.local`
- Request/response handling with error management
- **Security**: Keys from chrome.storage only, sanitized logging

### Step 4: Create `/src/taskB/diff.js`
- `hasChanged(before, after)` - Compare two HTML strings to detect changes
- Handle edge cases (whitespace normalization, minor attribute changes)
- **Note**: Use existing `getPageContext().html` to get current HTML - no separate `getHTML()` needed

### Step 5: Create `/src/taskB/retry.js`
- `executeWithRetry(action, maxAttempts = 3)` - Retry wrapper (no context param needed)
- Tracks attempt count and failure reasons
- Returns accumulated error messages on final failure
- Uses `getPageContext()` internally to get fresh HTML for each attempt

### Step 6: Create `/src/taskB/index.js`
- `executeAction(action)` - Main entry point (no context param - uses `getPageContext()`)
- `callActionsLLM(action)` - Generate code via LLM (fetches context internally)
- `runCode(code)` - Execute code with EVAL (has full DOM access - same context)
- Orchestrates the flow: LLM → EVAL → Diff check → Retry if needed
- **Security**: Input validation, basic code validation before execution
- **DOM Access**: Direct access to `document` and all DOM APIs

---

## Dependencies Between Steps

```
Step 1 (directories)
    ↓
Step 2 (logger.js) ←──────┐
    ↓                     │
Step 3 (llm/index.js) ←───┤ (used by taskB)
    ↓                     │
Step 4 (diff.js) ←────────┤
    ↓                     │
Step 5 (retry.js) ←───────┘
    ↓         (depends on diff.js)
Step 6 (index.js)
    (depends on all above)
```

---

## New Dependencies Required

- **None** - Pure JavaScript ES6 for Chrome Extension environment
- Uses native `fetch()` API for LLM calls
- Uses `chrome.storage` API for API key retrieval

---

## Potential Breaking Changes

- **None anticipated** - This is a greenfield implementation

---

## Security Considerations

| Risk | Mitigation |
|------|------------|
| API key exposure | Store in `chrome.storage.sync`, never log keys, never hardcode |
| Code injection via EVAL | Validate LLM response format, basic code validation |
| Sensitive data in logs | Sanitize HTML content before logging, truncate large payloads |
| Malicious LLM output | Basic code validation before execution |
| XSS via generated code | Code runs in page context (intended behavior for actions) |

---

## Potential Risks

1. **EVAL Security** - Executing LLM-generated code is inherently risky. Will implement basic validation but full sandboxing is limited in content script context.
2. **HTML Diff Accuracy** - Minor DOM changes (timestamps, random IDs) may cause false positives/negatives.
3. **LLM Response Parsing** - Need robust JSON parsing with fallbacks.
4. **Chrome Storage Async** - API key retrieval is async, need to handle properly.

---

## Status

- [ ] Step 1: Create Directory Structure
- [ ] Step 2: Create `/src/utils/logger.js`
- [ ] Step 3: Create `/src/llm/index.js`
- [ ] Step 4: Create `/src/taskB/diff.js`
- [ ] Step 5: Create `/src/taskB/retry.js`
- [ ] Step 6: Create `/src/taskB/index.js`

---

⏸️ **WAITING FOR APPROVAL**

Do you approve this execution plan for TASK B? (yes/no)
