# Capability: Codex Distribution

## ADDED Requirements

### Requirement: Codex Resource Distribution Matrix
System SHALL distribute subscribed resources to Codex-specific paths when `agent_profile=codex`.

#### Scenario: Complex skill distributed to codex path
- **WHEN** `sync_resources` runs with `agent_profile=codex` and a complex skill is subscribed
- **THEN** local_actions include write_file actions targeting `~/.csp-ai-agent/codex/skills/<name>/`

#### Scenario: Command resource transformed to codex skill bundle
- **WHEN** `sync_resources` runs with `agent_profile=codex` and a command resource is subscribed
- **THEN** local_actions include write_file actions converting the command to a skill bundle at `~/.csp-ai-agent/codex/skills/<name>/`

#### Scenario: MCP resource generates toml action for codex
- **WHEN** `sync_resources` runs with `agent_profile=codex` and an mcp resource is subscribed
- **THEN** local_actions include a merge_toml action targeting `~/.codex/config.toml` mcp_servers section

#### Scenario: Cursor distribution unchanged when agent_profile is cursor
- **WHEN** `sync_resources` runs with `agent_profile=cursor`
- **THEN** all local_actions are identical to pre-refactor behavior

### Requirement: merge_toml LocalAction Type
System SHALL support a new `merge_toml` local action type for writing TOML configuration fields.

#### Scenario: merge_toml writes developer_instructions field
- **WHEN** a merge_toml action with `key=developer_instructions` is processed
- **THEN** `~/.codex/config.toml` contains the `developer_instructions` field with the specified value

#### Scenario: merge_toml with overwrite=true replaces existing value
- **WHEN** a merge_toml action with `overwrite=true` is processed and the key already exists
- **THEN** the existing value is replaced with the new value
