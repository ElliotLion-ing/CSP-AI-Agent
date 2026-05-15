# Capability: Policy Injection

## ADDED Requirements

### Requirement: csp-routing-policy.md Generation
System SHALL generate `csp-routing-policy.md` by merging all subscribed rule resource contents when `agent_profile=codex`.

#### Scenario: Multiple rules merged in deterministic order
- **WHEN** two rule resources are subscribed with ids "bbb" and "aaa"
- **THEN** generated policy contains "aaa" content before "bbb" content (sorted by id)

#### Scenario: Policy file written atomically
- **WHEN** policy generation runs
- **THEN** file is written via temp-file rename to prevent partial reads

#### Scenario: Policy includes YAML front matter
- **WHEN** policy is generated
- **THEN** file begins with YAML front matter containing `csp_policy_version`, `generated_at`, and `contributing_resources`

### Requirement: developer_instructions Injection
System SHALL inject the generated policy content into `~/.codex/config.toml` as the `developer_instructions` field.

#### Scenario: developer_instructions is written on first sync
- **WHEN** `sync_resources` runs with `agent_profile=codex` for the first time
- **THEN** `~/.codex/config.toml` contains `developer_instructions` with the full policy content

#### Scenario: developer_instructions is updated on subsequent sync
- **WHEN** a rule resource is updated and `sync_resources` runs again
- **THEN** `developer_instructions` in `config.toml` reflects the latest policy content

### Requirement: Restart Notification
System SHALL return `restart_required: true` and a `restart_hint` message when policy has been updated for Codex profile.

#### Scenario: restart_hint returned after codex sync with rules
- **WHEN** `sync_resources` completes with `agent_profile=codex` and rule resources were synced
- **THEN** result includes `restart_required: true` and non-empty `restart_hint`

#### Scenario: restart_hint not returned for cursor profile
- **WHEN** `sync_resources` completes with `agent_profile=cursor`
- **THEN** result does not include `restart_required` field
