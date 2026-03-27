## MODIFIED Requirements

### Requirement: Dynamic Prompt Lifecycle Management
The system SHALL dynamically register, update, and unregister MCP Prompts in response to subscription changes and resource uploads without requiring a server restart. The system SHALL also provide a stable non-Prompt fallback path for retrieving the fully resolved body of a dynamically subscribed Command or Skill in the same task flow.

#### Scenario: New subscription triggers Prompt registration
- **WHEN** user subscribes to a Command or Skill via `manage_subscription`
- **THEN** the server fetches the resource content, generates an intermediate file, and registers a new MCP Prompt immediately

#### Scenario: Uploaded resource immediately available
- **WHEN** user uploads a Command or Skill via `upload_resource` and the upload succeeds
- **THEN** the system generates an intermediate file and registers the Prompt
- **AND** the resource is immediately accessible via `/slash` without a separate sync step

#### Scenario: Dynamic resource resolved in same tool flow
- **WHEN** a Command or Skill is newly subscribed during the current conversation flow
- **AND** the client has not issued `prompts/get`
- **THEN** the server provides an MCP Tool that returns the fully resolved prompt body without requiring a separate slash refresh

## ADDED Requirements

### Requirement: Solid Prompt Content Resolution Tool
The system SHALL provide an MCP Tool named `resolve_prompt_content` for stable retrieval of fully resolved Command and Skill prompt content during dynamic workflows.

#### Scenario: Resolve by prompt name
- **WHEN** a client calls `resolve_prompt_content` with a valid `prompt_name`
- **THEN** the server returns a structured result containing `prompt_name`, `resource_id`, `description`, and the fully resolved `content`
- **AND** the result indicates whether the content came from cache, regeneration, or raw fallback

#### Scenario: Resolve by resource ID
- **WHEN** a client calls `resolve_prompt_content` with a valid `resource_id`
- **THEN** the server finds the matching registered prompt
- **AND** it returns the same resolved content that native `prompts/get` would return for that prompt

#### Scenario: Prompt content cache miss
- **WHEN** `resolve_prompt_content` is called for a registered prompt whose `.prompt-cache` file is missing
- **THEN** the server regenerates the prompt content from the registered raw content
- **AND** it returns the regenerated content
- **AND** it refreshes the intermediate cache file

#### Scenario: Prompt not found
- **WHEN** a client calls `resolve_prompt_content` for a prompt or resource that is not registered for that user
- **THEN** the server returns a structured failure result
- **AND** the failure explains that the client should run `sync_resources` first

### Requirement: Shared Prompt Resolution Path
The system SHALL use a shared internal prompt-resolution path for both native `prompts/get` handling and `resolve_prompt_content` tool handling so that both interfaces return equivalent content for the same registered prompt.

#### Scenario: Native prompt and tool return equivalent content
- **WHEN** the same registered prompt is retrieved through `prompts/get` and through `resolve_prompt_content`
- **THEN** both paths return equivalent prompt body content for the same user and resource
- **AND** both paths use the same cache, regeneration, and raw fallback logic
