# resource-sync Specification

## Purpose
Client-side hybrid resource synchronization with local Git scanning for metadata generation.

## ADDED Requirements

### Requirement: Git Manager SHALL scan local repositories for resource metadata

System SHALL provide Git Manager capability to scan local AI Resources repositories and generate metadata without REST API dependency.

#### Scenario: Scan complex skill from local Git directory
- **GIVEN** skill "zoom-build" exists in `AI-Resources/csp/ai-resources/skills/zoom-build/`
- **AND** skill has `scripts/` directory with 3 executable files
- **AND** skill has `teams/` directory with 2 JSON configuration files
- **WHEN** client calls `multiSourceGitManager.scanResourceMetadata('zoom-build', 'skill')`
- **THEN** system SHALL return metadata object with `has_scripts=true`
- **AND** `script_files` array SHALL contain 5 entries (3 scripts + 2 configs)
- **AND** each script entry SHALL have `mode="0755"`
- **AND** each config entry SHALL have `mode="0644"`
- **AND** all entries SHALL include `relative_path`, `content`, `encoding="utf8"`

#### Scenario: Scan simple skill with no local scripts
- **GIVEN** skill "hang-log-analyzer" in Git repo contains only `SKILL.md`
- **WHEN** client calls `multiSourceGitManager.scanResourceMetadata('hang-log-analyzer', 'skill')`
- **THEN** system SHALL return metadata with `has_scripts=false`
- **AND** `script_files` field SHALL be `undefined`

#### Scenario: Scan non-existent resource
- **GIVEN** skill "non-existent-skill" does not exist in any configured Git source
- **WHEN** client calls `multiSourceGitManager.scanResourceMetadata('non-existent-skill', 'skill')`
- **THEN** system SHALL return `{ has_scripts: false }`
- **AND** SHALL log warning "no files found"

---

### Requirement: sync_resources SHALL use local Git scanning for metadata

System SHALL replace REST API calls with local Git scanning when detecting complex skills.

#### Scenario: Sync complex skill (first time) with local scanning
- **GIVEN** user subscribed to "zoom-build" skill
- **AND** local directory `~/.cursor/skills/zoom-build/` does NOT exist
- **WHEN** `sync_resources` is called
- **THEN** system SHALL call `multiSourceGitManager.scanResourceMetadata('zoom-build', 'skill')`
- **AND** SHALL detect `has_scripts=true` with 3 script files
- **AND** SHALL generate 3 `write_file` actions in `local_actions_required`
- **AND** SHALL set `mode="0755"` for executable scripts
- **AND** SHALL increment `summary.synced` counter
- **AND** SHALL register MCP Prompt for telemetry tracking

#### Scenario: Incremental sync with unchanged files (Git-based)
- **GIVEN** user subscribed to "zoom-build" skill
- **AND** local files exist with content matching Git repository
- **WHEN** `sync_resources` is called with `mode='incremental'`
- **THEN** system SHALL call `multiSourceGitManager.scanResourceMetadata('zoom-build', 'skill')`
- **AND** SHALL compare local file hashes with scanned content
- **AND** SHALL skip all file writes (all hashes match)
- **AND** SHALL increment `summary.skipped` counter
- **AND** SHALL add entry to `skipped_resources` with `reason='already_up_to_date'`

#### Scenario: Incremental sync with partial update (Git-based)
- **GIVEN** user subscribed to "zoom-build" skill
- **AND** local file `scripts/build-cli` has outdated content
- **AND** other 2 files are up-to-date
- **WHEN** `sync_resources` is called with `mode='incremental'`
- **THEN** system SHALL detect 1 changed file via hash comparison
- **AND** SHALL generate only 1 `write_file` action for `build-cli`
- **AND** SHALL skip 2 unchanged files
- **AND** SHALL increment `summary.synced` counter

#### Scenario: Sync simple skill (no local files needed)
- **GIVEN** user subscribed to "hang-log-analyzer" skill
- **WHEN** `sync_resources` is called
- **THEN** system SHALL call `multiSourceGitManager.scanResourceMetadata('hang-log-analyzer', 'skill')`
- **AND** SHALL detect `has_scripts=false`
- **AND** SHALL NOT generate any local file actions
- **AND** SHALL add entry to `skipped_resources` with `reason='no_local_sync_needed'`
- **AND** SHALL register MCP Prompt only

#### Scenario: Full sync mode ignores hash comparison
- **GIVEN** user subscribed to "zoom-build" with unchanged local files
- **WHEN** `sync_resources` is called with `mode='full'`
- **THEN** system SHALL generate `write_file` actions for all files
- **AND** SHALL NOT perform hash comparison
- **AND** SHALL increment `summary.synced` counter

---
## Requirements
### Requirement: Git Manager SHALL scan local repositories for resource metadata

System SHALL provide Git Manager capability to scan local AI Resources repositories and generate metadata without REST API dependency.

#### Scenario: Scan complex skill from local Git directory
- **GIVEN** skill "zoom-build" exists in `AI-Resources/csp/ai-resources/skills/zoom-build/`
- **AND** skill has `scripts/` directory with 3 executable files
- **AND** skill has `teams/` directory with 2 JSON configuration files
- **WHEN** client calls `multiSourceGitManager.scanResourceMetadata('zoom-build', 'skill')`
- **THEN** system SHALL return metadata object with `has_scripts=true`
- **AND** `script_files` array SHALL contain 5 entries (3 scripts + 2 configs)
- **AND** each script entry SHALL have `mode="0755"`
- **AND** each config entry SHALL have `mode="0644"`
- **AND** all entries SHALL include `relative_path`, `content`, `encoding="utf8"`

#### Scenario: Scan simple skill with no local scripts
- **GIVEN** skill "hang-log-analyzer" in Git repo contains only `SKILL.md`
- **WHEN** client calls `multiSourceGitManager.scanResourceMetadata('hang-log-analyzer', 'skill')`
- **THEN** system SHALL return metadata with `has_scripts=false`
- **AND** `script_files` field SHALL be `undefined`

#### Scenario: Scan non-existent resource
- **GIVEN** skill "non-existent-skill" does not exist in any configured Git source
- **WHEN** client calls `multiSourceGitManager.scanResourceMetadata('non-existent-skill', 'skill')`
- **THEN** system SHALL return `{ has_scripts: false }`
- **AND** SHALL log warning "no files found"

---

### Requirement: sync_resources SHALL use local Git scanning for metadata

System SHALL replace REST API calls with local Git scanning when detecting complex skills.

#### Scenario: Sync complex skill (first time) with local scanning
- **GIVEN** user subscribed to "zoom-build" skill
- **AND** local directory `~/.cursor/skills/zoom-build/` does NOT exist
- **WHEN** `sync_resources` is called
- **THEN** system SHALL call `multiSourceGitManager.scanResourceMetadata('zoom-build', 'skill')`
- **AND** SHALL detect `has_scripts=true` with 3 script files
- **AND** SHALL generate 3 `write_file` actions in `local_actions_required`
- **AND** SHALL set `mode="0755"` for executable scripts
- **AND** SHALL increment `summary.synced` counter
- **AND** SHALL register MCP Prompt for telemetry tracking

#### Scenario: Incremental sync with unchanged files (Git-based)
- **GIVEN** user subscribed to "zoom-build" skill
- **AND** local files exist with content matching Git repository
- **WHEN** `sync_resources` is called with `mode='incremental'`
- **THEN** system SHALL call `multiSourceGitManager.scanResourceMetadata('zoom-build', 'skill')`
- **AND** SHALL compare local file hashes with scanned content
- **AND** SHALL skip all file writes (all hashes match)
- **AND** SHALL increment `summary.skipped` counter
- **AND** SHALL add entry to `skipped_resources` with `reason='already_up_to_date'`

#### Scenario: Incremental sync with partial update (Git-based)
- **GIVEN** user subscribed to "zoom-build" skill
- **AND** local file `scripts/build-cli` has outdated content
- **AND** other 2 files are up-to-date
- **WHEN** `sync_resources` is called with `mode='incremental'`
- **THEN** system SHALL detect 1 changed file via hash comparison
- **AND** SHALL generate only 1 `write_file` action for `build-cli`
- **AND** SHALL skip 2 unchanged files
- **AND** SHALL increment `summary.synced` counter

#### Scenario: Sync simple skill (no local files needed)
- **GIVEN** user subscribed to "hang-log-analyzer" skill
- **WHEN** `sync_resources` is called
- **THEN** system SHALL call `multiSourceGitManager.scanResourceMetadata('hang-log-analyzer', 'skill')`
- **AND** SHALL detect `has_scripts=false`
- **AND** SHALL NOT generate any local file actions
- **AND** SHALL add entry to `skipped_resources` with `reason='no_local_sync_needed'`
- **AND** SHALL register MCP Prompt only

#### Scenario: Full sync mode ignores hash comparison
- **GIVEN** user subscribed to "zoom-build" with unchanged local files
- **WHEN** `sync_resources` is called with `mode='full'`
- **THEN** system SHALL generate `write_file` actions for all files
- **AND** SHALL NOT perform hash comparison
- **AND** SHALL increment `summary.synced` counter

---

