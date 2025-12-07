# BrowseMate Web Actions System

## Overview

The BrowseMate extension now uses a comprehensive web actions system that replaces the previous `eval()`-based approach with safe, predefined browser automation primitives. Actions are exposed to the LLM as OpenAI-compatible tools for function calling.

## Architecture

### 1. WebActions Class (`src/actions/WebActions.js`)

Defines all available browser automation actions as safe, structured functions:

**Available Actions:**
- `click(selector)` - Click an element
- `fill(selector, value)` - Fill an input field
- `select(selector, value)` - Select dropdown option
- `check(selector, checked)` - Check/uncheck checkbox
- `scroll(target, direction)` - Scroll to element or by amount
- `hover(selector)` - Hover over element
- `submit(selector)` - Submit a form
- `navigate(url)` - Navigate to URL
- `clickLink(text, exact)` - Click link by text
- `clickButton(text, exact)` - Click button by text
- `waitForElement(selector, timeout)` - Wait for element to appear
- `getText(selector)` - Get text content from element
- `getValue(selector)` - Get value from input
- `clear(selector)` - Clear input field
- `focus(selector)` - Focus on element
- `pressKey(key, selector)` - Press keyboard key
- `openNewTab(url)` - Open new tab
- `reload()` - Reload page
- `goBack()` - Navigate back
- `goForward()` - Navigate forward

Each action returns a function that can be executed in the page context.

### 2. Action Tools (`src/actions/ActionTools.js`)

Converts WebActions to OpenAI-compatible tool schemas for function calling:

```javascript
import { getActionTools, getActionDescriptions } from './actions/ActionTools.js';

// Get tools for LLM function calling
const tools = getActionTools();

// Get human-readable action descriptions
const descriptions = getActionDescriptions();
```

### 3. LLM Client Updates (`src/llm/LLMClient.js`)

**Enhanced `plannerCall()` method:**
- Now accepts `tools` parameter (array of action tools)
- Uses OpenAI function calling API
- Returns either:
  - `{intent: 'question', answer: '...'}` for questions
  - `{intent: 'action', toolCalls: [...]}` for actions

**Example:**
```javascript
const result = await llmClient.plannerCall(context, prompt, tools);

if (result.intent === 'action') {
  // Process tool calls
  for (const toolCall of result.toolCalls) {
    const functionName = toolCall.function.name;
    const functionArgs = JSON.parse(toolCall.function.arguments);
    // Execute action...
  }
}
```

### 4. Task A Orchestrator (`src/taskA/index.js`)

**Updated to use tools:**
- Loads action tools via `getActionTools()`
- Passes tools to `plannerCall()`
- Processes `toolCalls` from LLM response
- Converts tool calls to action format for Task B

**Flow:**
```
User Request → Planner LLM (with tools) → Tool Calls → Task B Executor
```

### 5. Executor Updates (`src/executor/index.js`)

**Replaced LLM code generation with WebActions:**
- Removed: `actionsCall()` (LLM-generated code)
- Removed: `runCode()` (eval-based execution)
- Added: `executeWebAction()` (safe action execution)
- Updated: `executeAction()` to use WebActions

**New Action Format:**
```javascript
{
  name: 'click',        // Action name from WebActions
  params: {             // Parameters for the action
    selector: '#submit-button'
  }
}
```

**Execution Flow:**
1. Validate action has `name` and `params`
2. Extract parameter values from `params` object
3. Create WebAction function via `WebActions.executeAction(name, ...params)`
4. Execute with retry logic (max 3 attempts)
5. Check for HTML changes (except for actions like scroll, hover)
6. Return success/failure result

## How It Works

### Tool Calling Flow

1. **User makes request** (e.g., "Click the login button")

2. **Task A calls Planner LLM** with:
   - Page context (HTML + text)
   - User prompt
   - Available action tools

3. **LLM responds** with tool call:
   ```json
   {
     "intent": "action",
     "toolCalls": [{
       "function": {
         "name": "click",
         "arguments": "{\"selector\": \"#login-btn\"}"
       }
     }]
   }
   ```

4. **Task A processes** tool call:
   - Extracts function name: `"click"`
   - Parses arguments: `{selector: "#login-btn"}`
   - Converts to action format:
     ```javascript
     {
       name: 'click',
       params: { selector: '#login-btn' }
     }
     ```

5. **Task B executes** action:
   - Creates WebAction: `WebActions.click('#login-btn')`
   - Executes in page context
   - Checks for DOM changes
   - Returns result

### Benefits Over eval()

**Security:**
- ✅ No arbitrary code execution
- ✅ Predefined, safe actions only
- ✅ Type-safe parameters

**Reliability:**
- ✅ Consistent behavior
- ✅ Proper error handling
- ✅ No syntax errors from LLM

**Performance:**
- ✅ No LLM call for code generation
- ✅ Faster execution
- ✅ Lower token usage

**Maintainability:**
- ✅ Clear action definitions
- ✅ Easy to add new actions
- ✅ Testable functions

## Configuration

Actions are automatically available to the LLM when the planner is called. No additional configuration needed.

To add a new action:

1. Add method to `WebActions` class:
   ```javascript
   static myNewAction(param1, param2) {
     return function() {
       // Implementation
       return { success: true, message: 'Done' };
     };
   }
   ```

2. Add tool definition to `ActionTools.js`:
   ```javascript
   {
     type: 'function',
     function: {
       name: 'myNewAction',
       description: 'Description of what it does',
       parameters: {
         type: 'object',
         properties: {
           param1: { type: 'string', description: '...' },
           param2: { type: 'number', description: '...' }
         },
         required: ['param1', 'param2']
       }
     }
   }
   ```

3. Action is now available to the LLM!

## Testing

Test an action manually:
```javascript
import { WebActions } from './src/actions/WebActions.js';

// Create action function
const clickAction = WebActions.click('#my-button');

// Execute in page context
const result = await chrome.scripting.executeScript({
  target: { tabId: tabId },
  world: 'MAIN',
  func: clickAction
});

console.log(result[0].result); // { success: true, message: '...' }
```

## Files Changed

- ✅ `src/actions/WebActions.js` - NEW: Action definitions
- ✅ `src/actions/ActionTools.js` - NEW: Tool schemas
- ✅ `src/llm/LLMClient.js` - UPDATED: Tool calling support
- ✅ `src/taskA/index.js` - UPDATED: Process tool calls
- ✅ `src/executor/index.js` - UPDATED: Use WebActions instead of eval

## Migration Notes

**Old System (eval-based):**
```
User Request → Planner → Action Intent → Code Generator LLM → eval(code) → Result
```

**New System (tool-based):**
```
User Request → Planner (with tools) → Tool Calls → WebActions → Result
```

**Key Differences:**
- No code generation LLM call needed
- No eval() or Function constructor
- Actions are predefined and safe
- LLM directly calls actions via function calling
