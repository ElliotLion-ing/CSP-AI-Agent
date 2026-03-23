# mcp-server Specification

## Purpose
TBD - created by archiving change stage-2-mcp-server-basic. Update Purpose after archive.
## Requirements
### Requirement: MCP Protocol Support
The system SHALL implement the Model Context Protocol (MCP) using the official SDK, enabling communication via stdio transport.

#### Scenario: Server initialization
- **WHEN** the MCP Server receives an initialize request
- **THEN** it responds with server capabilities
- **AND** it includes the list of supported protocol versions
- **AND** it indicates tool support is enabled

#### Scenario: List available tools
- **WHEN** a client sends a tools/list request
- **THEN** the server responds with a list of all registered tools
- **AND** each tool includes name, description, and input schema
- **AND** the list contains exactly 5 tools (sync_resources, manage_subscription, search_resources, upload_resource, uninstall_resource)

#### Scenario: Call a tool
- **WHEN** a client sends a tools/call request with valid tool name and parameters
- **THEN** the server invokes the corresponding tool handler
- **AND** the server returns the tool's result
- **AND** the invocation is logged with tool name, parameters, and duration

#### Scenario: Call non-existent tool
- **WHEN** a client sends a tools/call request with an invalid tool name
- **THEN** the server responds with an error
- **AND** the error indicates the tool was not found
- **AND** the error is logged

#### Scenario: Call tool with invalid parameters
- **WHEN** a client sends a tools/call request with invalid parameters
- **THEN** the server validates the parameters against the tool schema
- **AND** the server responds with a validation error
- **AND** the error describes which parameters are invalid

### Requirement: Tool Registry
The system SHALL provide a tool registry for registering, storing, and retrieving MCP tools.

#### Scenario: Register a tool
- **WHEN** a tool is registered with name, description, schema, and handler
- **THEN** the tool is added to the registry
- **AND** the tool can be retrieved by name
- **AND** the tool appears in the tools/list response

#### Scenario: Register duplicate tool
- **WHEN** attempting to register a tool with a name that already exists
- **THEN** the registration fails with an error
- **AND** the error indicates the tool name is already registered
- **AND** the existing tool is not overwritten

#### Scenario: Retrieve registered tool
- **WHEN** requesting a tool by name from the registry
- **THEN** if the tool exists, it is returned with all metadata
- **AND** if the tool does not exist, undefined is returned

#### Scenario: List all tools
- **WHEN** requesting the list of all registered tools
- **THEN** an array of all tool definitions is returned
- **AND** each definition includes name, description, and schema

### Requirement: Tool Placeholders
The system SHALL provide placeholder implementations for all 5 core MCP tools, returning mock data.

#### Scenario: Call sync_resources placeholder
- **WHEN** sync_resources tool is called with any parameters
- **THEN** it logs the invocation with parameters
- **AND** it returns mock sync result data
- **AND** the mock data follows the expected result schema

#### Scenario: Call manage_subscription placeholder
- **WHEN** manage_subscription tool is called with any parameters
- **THEN** it logs the invocation with parameters
- **AND** it returns mock subscription result data
- **AND** the mock data follows the expected result schema

#### Scenario: Call search_resources placeholder
- **WHEN** search_resources tool is called with any parameters
- **THEN** it logs the invocation with parameters
- **AND** it returns mock search results
- **AND** the mock data follows the expected result schema

#### Scenario: Call upload_resource placeholder
- **WHEN** upload_resource tool is called with any parameters
- **THEN** it logs the invocation with parameters
- **AND** it returns mock upload result
- **AND** the mock data follows the expected result schema

#### Scenario: Call uninstall_resource placeholder
- **WHEN** uninstall_resource tool is called with any parameters
- **THEN** it logs the invocation with parameters
- **AND** it returns mock uninstall result
- **AND** the mock data follows the expected result schema

### Requirement: MCP Server Lifecycle
The system SHALL manage the MCP Server lifecycle including startup, operation, and graceful shutdown.

#### Scenario: Server startup
- **WHEN** the application starts
- **THEN** the MCP Server is initialized with stdio transport
- **AND** all tools are registered
- **AND** the server begins listening for MCP requests
- **AND** a log entry confirms server readiness

#### Scenario: Server shutdown
- **WHEN** the application receives a shutdown signal
- **THEN** the MCP Server stops accepting new requests
- **AND** any in-flight tool executions are allowed to complete
- **AND** the server closes the stdio transport cleanly
- **AND** a log entry confirms server shutdown

### Requirement: Error Handling
The system SHALL handle MCP protocol errors gracefully and return appropriate error responses.

#### Scenario: Malformed MCP request
- **WHEN** the server receives a malformed MCP message
- **THEN** it logs the error with message details
- **AND** it responds with a protocol error
- **AND** the server continues operating normally

#### Scenario: Tool execution error
- **WHEN** a tool handler throws an exception during execution
- **THEN** the exception is caught and logged
- **AND** an error response is sent to the client
- **AND** the error includes a user-friendly message
- **AND** the server continues operating normally

### Requirement: MCP Prompt Registration for Command and Skill Resources
The system SHALL register subscribed Command and Skill resources as MCP Prompts on the server instead of downloading their content as local files. Each Prompt SHALL be accessible via the Cursor `/slash` menu by its registered name.

#### Scenario: Command registered as MCP Prompt on server start
- **WHEN** the MCP Server starts and loads user subscriptions
- **THEN** for each subscribed Command and Skill, the server registers a corresponding MCP Prompt via `server.registerPrompt()`
- **AND** the Prompt name follows the pattern `{type}/{team}/{resource-name}`

#### Scenario: User invokes a Command via slash
- **WHEN** user types `/command/client-sdk/generate-testcase` in Cursor
- **THEN** MCP Client sends `prompts/get` request to MCP Server
- **AND** MCP Server returns the Prompt content from the intermediate file cache
- **AND** an invocation event is recorded in the telemetry manager

### Requirement: Prompt Intermediate File Cache
The system SHALL generate and maintain intermediate Prompt files in a `.prompt-cache/` directory within the MCP Server's runtime working directory. These files SHALL NOT be committed to Git. The files SHALL be regenerated each time the underlying resource content changes (after git pull or upload).

#### Scenario: Intermediate file generated after git pull
- **WHEN** `sync_resources` triggers a git pull and a Command resource is updated
- **THEN** the system generates a new intermediate file at `.prompt-cache/cmd-{resource_id}.md`
- **AND** the existing MCP Prompt registration is refreshed with the updated content

#### Scenario: Intermediate file not in Git repository
- **WHEN** the system generates intermediate files in `.prompt-cache/`
- **THEN** these files are not committed to the AI-Resources Git repository
- **AND** the `.prompt-cache/` directory is listed in `.gitignore`

### Requirement: Dynamic Prompt Lifecycle Management
The system SHALL dynamically register, update, and unregister MCP Prompts in response to subscription changes and resource uploads without requiring a server restart.

#### Scenario: New subscription triggers Prompt registration
- **WHEN** user subscribes to a Command or Skill via `manage_subscription`
- **THEN** the server fetches the resource content, generates an intermediate file, and registers a new MCP Prompt immediately

#### Scenario: Unsubscription removes Prompt
- **WHEN** user unsubscribes from a Command or Skill
- **THEN** the corresponding MCP Prompt is unregistered
- **AND** the `.prompt-cache/` intermediate file is deleted

#### Scenario: Uploaded resource immediately available
- **WHEN** user uploads a Command or Skill via `upload_resource` and the upload succeeds
- **THEN** the system generates an intermediate file and registers the Prompt
- **AND** the resource is immediately accessible via `/slash` without a separate sync step

