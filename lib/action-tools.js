/**
 * ===========================================
 * File: ActionTools.js
 * Purpose: Defines web actions as OpenAI-compatible tool schemas
 * Used for function calling / tool use in LLM requests
 * ===========================================
 */

/**
 * Get all web actions formatted as OpenAI tools
 * These tools can be passed to the LLM for function calling
 * @returns {Array} Array of tool definitions
 */
export function getActionTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'click',
        description: 'Click on an element on the page using a CSS selector',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the element to click (e.g., "#submit-button", ".login-btn", "button[type=submit]")'
            }
          },
          required: ['selector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'fill',
        description: 'Fill an input field with text',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the input element (e.g., "#email", "input[name=username]")'
            },
            value: {
              type: 'string',
              description: 'Text value to enter into the input field'
            }
          },
          required: ['selector', 'value']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'select',
        description: 'Select an option from a dropdown select element',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the select element (e.g., "#country-select", "select[name=state]")'
            },
            value: {
              type: 'string',
              description: 'Value or visible text of the option to select'
            }
          },
          required: ['selector', 'value']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'check',
        description: 'Check or uncheck a checkbox',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the checkbox (e.g., "#agree-checkbox", "input[name=subscribe]")'
            },
            checked: {
              type: 'boolean',
              description: 'True to check the checkbox, false to uncheck it',
              default: true
            }
          },
          required: ['selector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'scroll',
        description: 'Scroll to an element or scroll by a specific amount',
        parameters: {
          type: 'object',
          properties: {
            target: {
              oneOf: [
                { type: 'string', description: 'CSS selector of element to scroll to' },
                { type: 'number', description: 'Number of pixels to scroll' }
              ],
              description: 'Either a CSS selector to scroll to, or a number of pixels to scroll'
            },
            direction: {
              type: 'string',
              enum: ['vertical', 'horizontal'],
              description: 'Scroll direction (only used when target is a number)',
              default: 'vertical'
            }
          },
          required: ['target']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'hover',
        description: 'Hover over an element to trigger hover effects',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the element to hover over'
            }
          },
          required: ['selector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'submit',
        description: 'Submit a form',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the form element (e.g., "#login-form", "form[action=/submit]")'
            }
          },
          required: ['selector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'navigate',
        description: 'Navigate to a different URL',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Full URL to navigate to (e.g., "https://example.com/page")'
            }
          },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'clickLink',
        description: 'Click a link by its text content',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text content of the link to click'
            },
            exact: {
              type: 'boolean',
              description: 'Whether to match exact text (true) or partial text (false)',
              default: false
            }
          },
          required: ['text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'clickButton',
        description: 'Click a button by its text content',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text content of the button to click'
            },
            exact: {
              type: 'boolean',
              description: 'Whether to match exact text (true) or partial text (false)',
              default: false
            }
          },
          required: ['text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'waitForElement',
        description: 'Wait for an element to appear on the page',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the element to wait for'
            },
            timeout: {
              type: 'number',
              description: 'Maximum time to wait in milliseconds',
              default: 5000
            }
          },
          required: ['selector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getText',
        description: 'Get the text content from an element',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the element'
            }
          },
          required: ['selector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getValue',
        description: 'Get the value from an input element',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the input element'
            }
          },
          required: ['selector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'clear',
        description: 'Clear the value from an input field',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the input element'
            }
          },
          required: ['selector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'focus',
        description: 'Focus on an input or interactive element',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the element to focus'
            }
          },
          required: ['selector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'pressKey',
        description: 'Press a keyboard key (e.g., Enter, Escape, Tab)',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Name of the key to press (e.g., "Enter", "Escape", "Tab", "ArrowDown")'
            },
            selector: {
              type: 'string',
              description: 'Optional: CSS selector for element to press key on (defaults to active element)'
            }
          },
          required: ['key']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'openNewTab',
        description: 'Open a URL in a new browser tab',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to open in the new tab'
            }
          },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'reload',
        description: 'Reload the current page',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'goBack',
        description: 'Go back to the previous page in browser history',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'goForward',
        description: 'Go forward to the next page in browser history',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    }
  ];
}

/**
 * Get a simplified list of actions for the planner prompt
 * This is used when we want to tell the LLM what actions are available
 * without using full function calling
 * @returns {string} Formatted string describing available actions
 */
export function getActionDescriptions() {
  const tools = getActionTools();
  return tools.map(tool => {
    const func = tool.function;
    const params = Object.keys(func.parameters.properties).join(', ');
    return `- ${func.name}(${params}): ${func.description}`;
  }).join('\n');
}
