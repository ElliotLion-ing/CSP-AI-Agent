# telemetry Specification

## Purpose
Tracks AI Resource (Command/Skill) invocation usage on behalf of users, stores events locally in the MCP Server's working directory, and periodically reports aggregated data to the remote telemetry API. Rule and MCP resources are tracked as subscription/configuration snapshots only.
## Requirements
### Requirement: Local Invocation Recording
The system SHALL record Command and Skill invocations locally when the MCP Server handles a `prompts/get` request. Each unique combination of `(resource_id, jira_id)` SHALL be tracked as a separate aggregation entry. The `jira_id` field is optional and SHALL only be recorded when the user explicitly passes it during invocation.

#### Scenario: Command invoked with jira_id
- **WHEN** user triggers a Command Prompt via `/slash` and passes `jira_id=PROJ-12345`
- **THEN** system records an invocation entry with `resource_id`, `resource_type=command`, `resource_name`, and `jira_id=PROJ-12345`
- **AND** `invocation_count` is incremented for the `(resource_id, jira_id)` aggregate key

#### Scenario: Skill invoked without jira_id
- **WHEN** user triggers a Skill Prompt and does not pass `jira_id`
- **THEN** system records an invocation entry without the `jira_id` field
- **AND** aggregation key is `resource_id` alone

### Requirement: Telemetry File Location
The system SHALL store the local telemetry cache file as `ai-resource-telemetry.json` in the MCP Server's runtime working directory (not `~/.cursor/`). The system SHALL include `subscribed_rules`, `configured_mcps`, and `pending_events` in the file.

#### Scenario: File created on first invocation
- **WHEN** no telemetry file exists and the first invocation is recorded
- **THEN** system creates `{cwd}/ai-resource-telemetry.json` with the event and empty rule/mcp lists

#### Scenario: File contains configured_mcps
- **WHEN** sync_resources completes and MCP resources are processed
- **THEN** `configured_mcps` field in the telemetry file is updated with the full list of currently configured MCPs

### Requirement: Subscribed Rules Tracking
The system SHALL track the list of subscribed Rules (which cannot be invocation-tracked) and include them in telemetry reports.

#### Scenario: Update rules list after sync
- **WHEN** `sync_resources` or `manage_subscription` completes successfully
- **THEN** the system updates the `subscribed_rules` array in the local telemetry file with the current Rule subscriptions

#### Scenario: Rules included in report
- **WHEN** the telemetry flush executes
- **THEN** `subscribed_rules` is always included in full (not incremental) in the report body

### Requirement: Periodic Telemetry Reporting
The system SHALL report telemetry data to `POST /csp/api/resources/telemetry` every 10 seconds. The API payload SHALL include optional `jira_id` per event entry and a `configured_mcps` array.

#### Scenario: Report with jira_id events
- **WHEN** the 10-second flush timer fires and pending events contain entries with `jira_id`
- **THEN** system sends payload where those event entries include `jira_id` field
- **AND** events without `jira_id` omit the field entirely (no null/empty string)

#### Scenario: Empty events still reports rules and MCPs
- **WHEN** no Command/Skill was invoked in the last 10 seconds
- **THEN** system still sends report with empty `events` array and full `subscribed_rules` and `configured_mcps` lists

### Requirement: Flush on Reconnect
The system SHALL immediately trigger a telemetry flush when the MCP client (re)connects to the server via either SSE or stdio transport.

#### Scenario: SSE client reconnects
- **WHEN** a new SSE client connects and MCP handshake completes (`oninitialized`)
- **THEN** `flushOnReconnect()` is called immediately, fire-and-forget

### Requirement: Graceful Shutdown Flush
The system SHALL perform a final telemetry flush on server shutdown to minimize data loss.

#### Scenario: Final flush on shutdown
- **WHEN** the MCP server receives a shutdown signal
- **THEN** the system stops the periodic timer
- **AND** executes one final `flush()` before exiting

