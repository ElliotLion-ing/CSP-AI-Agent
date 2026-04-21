## MODIFIED Requirements

### Requirement: Rule and MCP Resource Delivery via AI Agent
The system SHALL NOT write Rule or MCP resource files to the server's own filesystem.
Instead, the system SHALL return structured `local_actions_required` instructions so
that the AI Agent running on the user's local machine can perform the writes.

#### Scenario: Sync Rule resource on remote server
- **WHEN** `sync_resources` is called and a subscribed resource has type `rule`
- **THEN** the tool returns a `write_file` action with the rule's file path and content
- **AND** the file path uses the user's local `~/.cursor/rules/` directory
- **AND** no files are written to the MCP server's filesystem

#### Scenario: Sync Remote-URL MCP resource on remote server
- **WHEN** `sync_resources` is called and an MCP resource has no local `command` (Format B)
- **THEN** the tool returns a `merge_mcp_json` action with the server entry and `~/.cursor/mcp.json` path
- **AND** no files are written to the MCP server's filesystem

#### Scenario: Sync Local-executable MCP resource on remote server
- **WHEN** `sync_resources` is called and an MCP resource has a local `command` (Format A)
- **THEN** the tool returns `write_file` actions for each file AND a `merge_mcp_json` action
- **AND** the file paths use the user's local `~/.cursor/mcp-servers/` directory
- **AND** no files are written to the MCP server's filesystem

#### Scenario: Uninstall Rule or MCP resource on remote server
- **WHEN** `uninstall_resource` is called for a rule or MCP resource
- **THEN** the tool returns `delete_file` and/or `remove_mcp_json_entry` actions
- **AND** no files are deleted from the MCP server's filesystem
