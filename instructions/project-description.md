# BrowseMate - Chrome extension

# Overview

BrowseMate is a Chrome Extension that serves as an intelligent web assistant, leveraging Large Language Models to help users interact with web pages. It understands the context of the current page and all opened tabs, allowing users to ask questions and request actions without having to manually navigate or interact with page elements.

## Core Features

- **Contextual Awareness**: Analyzes the content of the current tab and maintains awareness of all open tabs
- **Natural Language Interface**: Allows users to ask questions about page content in natural language
- **Web Page Interaction**: Performs actions on behalf of the user (clicking, filling forms, scrolling, etc.)
- **Memory & History**: Maintains context of the conversation and previous actions
- **Intelligent Task Planning**: Creates and executes multi-step action plans

## Architecture

BrowseMate consists of two main components:

### Backend - JS

The backend handles the core functionality including:

- LLM integration
- Context processing
- Action planning and execution
- Memory management

### Frontend - HTML + CSS

The frontend provides the user interface including:

- Chat interface
- Settings panel
- Visual feedback for actions
- Status indicators

## Implementation Roadmap

### Phase 1: Core Functionality

- Basic UI implementation
- LLM integration
- Simple context extraction
- Basic action execution (click, fill, scroll)

### Phase 2: Enhanced Features

- Advanced context awareness
- Memory implementation
- Expanded action set
- Task planning

### Phase 3: Refinement

- Performance optimization
- Error handling improvements
- User experience enhancements

## Technical Requirements

- **Browser Compatibility**: Chrome
- **API Integration**: OpenAI API or similar LLM provider
- **Storage**: Local storage for settings, IndexedDB for history (?)
- **Permissions**:
    - Access to tab content
    - History access
    - Storage access
    - Network requests

## Security Considerations

- All sensitive data processed locally when possible
- No storage of user credentials or sensitive information
- Transparent permission usage
- User confirmation required for potentially destructive actions
- Option to disable on sensitive sites (banking, healthcare) (?)

## Future Enhancements

- Multi-language support
- Custom action creation
- Integration with productivity tools
- Mobile browser support (?)
- Browser bookmark and history analysis

[TODO](https://www.notion.so/TODO-2c30ed63922c8000b4efcf3dc7edaf91?pvs=21)

[Project Structure](https://www.notion.so/Project-Structure-2c30ed63922c801cb145c41faf7d2232?pvs=21)