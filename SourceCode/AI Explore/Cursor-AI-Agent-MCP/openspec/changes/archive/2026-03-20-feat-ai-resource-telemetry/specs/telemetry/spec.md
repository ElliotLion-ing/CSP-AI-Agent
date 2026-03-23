## ADDED Requirements

### Requirement: Local Invocation Recording
The system SHALL record AI resource invocation events to a local telemetry file at `{user .cursor dir}/ai-resource-telemetry.json` whenever an MCP tool is called.

#### Scenario: Record MCP tool invocation
- **WHEN** any MCP tool handler is invoked
- **THEN** the system increments the invocation count for that resource in the local telemetry file
- **AND** updates `first_invoked_at` and `last_invoked_at` timestamps

#### Scenario: File auto-initialization
- **WHEN** the telemetry file does not exist
- **THEN** the system creates it with empty `pending_events` and `subscribed_rules`

#### Scenario: Concurrent write safety
- **WHEN** multiple invocations occur simultaneously
- **THEN** the system uses atomic file write (write-then-rename) to prevent data corruption

### Requirement: Subscribed Rules Tracking
The system SHALL track the list of subscribed Rules (which cannot be invocation-tracked) and include them in telemetry reports.

#### Scenario: Update rules list after sync
- **WHEN** `sync_resources` or `manage_subscription` completes successfully
- **THEN** the system updates the `subscribed_rules` array in the local telemetry file with the current Rule subscriptions

#### Scenario: Rules included in report
- **WHEN** the telemetry flush executes
- **THEN** `subscribed_rules` is always included in full (not incremental) in the report body

### Requirement: Periodic Telemetry Reporting
The system SHALL periodically report collected telemetry data to the server and reset local counters on success.

#### Scenario: Periodic flush every 10 seconds
- **WHEN** the MCP server is running
- **THEN** the system sends a `POST /csp/api/resources/telemetry` request every 10 seconds

#### Scenario: Reset on successful report
- **WHEN** the server responds with HTTP 200
- **THEN** the system clears `pending_events` in the local file (resets incremental counters)
- **AND** updates `last_reported_at`

#### Scenario: Silent failure on report error
- **WHEN** the API call fails (network error, 4xx, 5xx)
- **THEN** the system retries up to 3 times with exponential backoff
- **AND** if all retries fail, the system silently discards the attempt and retains `pending_events` for the next flush cycle
- **AND** the main MCP tool flow is NOT affected

#### Scenario: No token, no report
- **WHEN** no user token is available (not configured in mcp.json)
- **THEN** the system skips the flush silently without error

### Requirement: Graceful Shutdown Flush
The system SHALL perform a final telemetry flush on server shutdown to minimize data loss.

#### Scenario: Final flush on shutdown
- **WHEN** the MCP server receives a shutdown signal
- **THEN** the system stops the periodic timer
- **AND** executes one final `flush()` before exiting
