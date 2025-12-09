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
        name: 'fillAndSubmit',
        description: 'Fill an input field with text and press Enter to submit (useful for search boxes)',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the input element (e.g., "#search", "input[name=q]")'
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
    },
    {
      type: 'function',
      function: {
        name: 'changeTab',
        description: 'Switch to a different browser tab by index, relative position, or search text that matches tab title/URL',
        parameters: {
          type: 'object',
          properties: {
            identifier: {
              oneOf: [
                { type: 'number', description: 'Tab index (0-based) or tab ID' },
                { type: 'string', description: 'Search text to match against tab title/URL (case-insensitive), or "next"/"previous"/"prev" for relative navigation' }
              ],
              description: 'Tab to switch to: numeric index (0-based), tab ID, "next"/"previous" for relative navigation, or text to search in tab titles/URLs (e.g., "GitHub", "google", "youtube")'
            }
          },
          required: ['identifier']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'zoom',
        description: 'Change the zoom level of the current page',
        parameters: {
          type: 'object',
          properties: {
            level: {
              oneOf: [
                { type: 'number', description: 'Zoom factor (e.g., 1.0 for 100%, 1.5 for 150%, 0.75 for 75%)' },
                { type: 'string', description: 'Percentage string (e.g., "150%", "100%") or relative change (e.g., "+10%", "-20%")' }
              ],
              description: 'Zoom level: numeric factor (1.0 = 100%), percentage string ("150%"), or relative change ("+10%" to zoom in, "-20%" to zoom out)'
            }
          },
          required: ['level']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'drag',
        description: 'Drag an element and drop it on another element using HTML5 drag-and-drop',
        parameters: {
          type: 'object',
          properties: {
            sourceSelector: {
              type: 'string',
              description: 'CSS selector for the element to drag (e.g., "#item-1", ".draggable-card")'
            },
            targetSelector: {
              type: 'string',
              description: 'CSS selector for the drop target element (e.g., "#dropzone", ".target-container")'
            }
          },
          required: ['sourceSelector', 'targetSelector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'findSearchInput',
        description: 'Intelligently find the main search input on any webpage, then fill it with a search term and submit. This is the best action to use when searching on a page where you are not sure of the search input selector.',
        parameters: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              description: 'The search term to enter into the search input'
            }
          },
          required: ['value']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'translatePage',
        description: 'Translate all text content on the current page to a target language using AI translation. The page will be re-rendered with translated text while preserving the HTML structure.',
        parameters: {
          type: 'object',
          properties: {
            targetLanguage: {
              type: 'string',
              description: 'The target language to translate to (e.g., "English", "Spanish", "Hebrew", "French", "Chinese", etc.)'
            }
          },
          required: ['targetLanguage']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'uploadFile',
        description: 'Trigger the file picker dialog for a file input element. Note: Due to browser security restrictions, files cannot be selected programmatically - this will open the file picker for the user to select a file manually.',
        parameters: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'CSS selector for the file input element (e.g., "input[type=file]", "#file-upload")'
            },
            filePath: {
              type: 'string',
              description: 'Desired file path (informational only - user will select manually)'
            }
          },
          required: ['selector']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'showFireworks',
        description: 'Display a fun fireworks animation on the page for celebration. Perfect for when the user says "party" or wants to celebrate!',
        parameters: {
          type: 'object',
          properties: {
            duration: {
              type: 'number',
              description: 'Duration of the fireworks animation in milliseconds (default: 2000)',
              default: 2000
            }
          },
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
