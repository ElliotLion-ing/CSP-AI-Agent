# Capability: Client Adapter Framework

## ADDED Requirements

### Requirement: ClientAdapter Interface
System SHALL provide a formal ClientAdapter interface that abstracts all client-specific behavior including distribution paths, policy strategy, and telemetry tags.

#### Scenario: Cursor adapter returns cursor-specific paths
- **WHEN** `adapterRegistry.get('cursor')` is called
- **THEN** adapter returns paths rooted at `~/.cursor/` and `~/.csp-ai-agent/skills/`

#### Scenario: Codex adapter returns codex-specific paths
- **WHEN** `adapterRegistry.get('codex')` is called
- **THEN** adapter returns paths rooted at `~/.csp-ai-agent/codex/`

#### Scenario: Missing profile defaults to cursor
- **WHEN** `CSP_AGENT_PROFILE` env var is absent or invalid
- **THEN** `config.agentProfile` resolves to `'cursor'`

### Requirement: AgentProfile Configuration
System SHALL read `CSP_AGENT_PROFILE` environment variable at startup and expose it via `config.agentProfile`.

#### Scenario: Valid codex profile is recognized
- **WHEN** `CSP_AGENT_PROFILE=codex` is set
- **THEN** `config.agentProfile === 'codex'`

#### Scenario: Invalid value falls back to cursor
- **WHEN** `CSP_AGENT_PROFILE=unknown` is set
- **THEN** `config.agentProfile === 'cursor'` and a warning is logged
