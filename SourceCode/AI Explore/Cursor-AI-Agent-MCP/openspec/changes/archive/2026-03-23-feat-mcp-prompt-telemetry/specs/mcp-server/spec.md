## ADDED Requirements

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
