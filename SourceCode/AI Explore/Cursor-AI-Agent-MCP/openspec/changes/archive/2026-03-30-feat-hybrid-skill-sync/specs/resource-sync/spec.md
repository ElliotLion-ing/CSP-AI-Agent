# Capability: resource-sync

## ADDED Requirements

### Requirement: Sync Subscribed Resources with Incremental Update
System SHALL synchronize subscribed AI resources to local machine with incremental update support, avoiding re-download of unchanged files.

#### Scenario: Sync complex skill with scripts (first time)
- **GIVEN** user has subscribed to skill "zoom-build" with `has_scripts=true`
- **AND** local directory `~/.cursor/skills/zoom-build/` does not exist
- **WHEN** user calls `sync_resources` with `mode=incremental`
- **THEN** system SHALL download `SKILL.md` and all files in `script_files` array
- **AND** system SHALL create directory structure `~/.cursor/skills/zoom-build/scripts/`, `~/.cursor/skills/zoom-build/teams/`
- **AND** system SHALL set executable permissions (mode=0755) for script files
- **AND** system SHALL register MCP Prompt `skill/zoom-build` in memory
- **AND** system SHALL return result with `synced=1`, `skipped=0`

#### Scenario: Sync complex skill with scripts (no remote changes)
- **GIVEN** local directory `~/.cursor/skills/zoom-build/` exists with all files
- **AND** remote content hash matches local content hash for all files
- **WHEN** user calls `sync_resources` with `mode=incremental`
- **THEN** system SHALL skip all file downloads
- **AND** system SHALL return result with `synced=0`, `skipped=1`
- **AND** `skipped_resources` array SHALL include entry `{ name: "zoom-build", reason: "already_up_to_date" }`

#### Scenario: Sync complex skill with partial remote update
- **GIVEN** local directory `~/.cursor/skills/zoom-build/` exists with 5 files
- **AND** remote file `scripts/build-cli` has been updated (hash mismatch)
- **AND** other 4 files have matching hashes
- **WHEN** user calls `sync_resources` with `mode=incremental`
- **THEN** system SHALL download only `scripts/build-cli`
- **AND** system SHALL NOT overwrite the 4 unchanged files
- **AND** system SHALL return result with `synced=1` (partial update)

#### Scenario: Sync simple skill without scripts
- **GIVEN** user has subscribed to skill "hang-log-analyzer" with `has_scripts=false`
- **WHEN** user calls `sync_resources` with `mode=incremental`
- **THEN** system SHALL NOT write any local files
- **AND** system SHALL register MCP Prompt `skill/hang-log-analyzer` in memory
- **AND** system SHALL return result with `synced=1`, `skipped=0`

#### Scenario: Force full sync overrides incremental check
- **GIVEN** local directory `~/.cursor/skills/zoom-build/` exists
- **AND** all file hashes match remote
- **WHEN** user calls `sync_resources` with `mode=full`
- **THEN** system SHALL re-download all files regardless of hash match
- **AND** system SHALL overwrite all local files

#### Scenario: MCP Prompt telemetry tracking remains intact
- **GIVEN** user has synced skill "zoom-build" to local
- **WHEN** AI invokes `/skill/zoom-build` command
- **THEN** MCP Server SHALL call tracking service with event data
- **AND** tracking data SHALL include `{ user, skill: "zoom-build", timestamp }`
- **AND** MCP Server SHALL return `SKILL.md` content to AI
- **AND** AI SHALL be able to execute local script referenced in `SKILL.md`

---

## ADDED Requirements

### Requirement: Uninstall Resource with Local File Cleanup
System SHALL remove local script files and directories when uninstalling complex skills.

#### Scenario: Uninstall complex skill with local files
- **GIVEN** skill "zoom-build" has local directory `~/.cursor/skills/zoom-build/` with 5 files
- **WHEN** user calls `uninstall_resource` with `name="zoom-build"`, `remove_from_account=true`
- **THEN** system SHALL delete directory `~/.cursor/skills/zoom-build/` recursively
- **AND** system SHALL unsubscribe user from resource "zoom-build"
- **AND** system SHALL return result with `deleted_files` list containing directory path
- **AND** `unsubscribed` field SHALL be `true`

#### Scenario: Uninstall complex skill (keep subscription)
- **GIVEN** skill "zoom-build" has local directory `~/.cursor/skills/zoom-build/`
- **WHEN** user calls `uninstall_resource` with `name="zoom-build"`, `remove_from_account=false`
- **THEN** system SHALL delete local directory
- **AND** system SHALL NOT unsubscribe user
- **AND** next `sync_resources` call SHALL re-download the skill

#### Scenario: Uninstall simple skill without local files
- **GIVEN** skill "hang-log-analyzer" has `has_scripts=false`
- **AND** no local directory exists for this skill
- **WHEN** user calls `uninstall_resource` with `name="hang-log-analyzer"`, `remove_from_account=true`
- **THEN** system SHALL unsubscribe user from resource
- **AND** `deleted_files` array SHALL be empty
- **AND** operation SHALL succeed without errors

#### Scenario: Uninstall non-existent local directory
- **GIVEN** skill "zoom-build" has `has_scripts=true`
- **AND** local directory `~/.cursor/skills/zoom-build/` does not exist (manually deleted)
- **WHEN** user calls `uninstall_resource` with `name="zoom-build"`, `remove_from_account=true`
- **THEN** system SHALL unsubscribe user gracefully
- **AND** system SHALL NOT throw error about missing directory
- **AND** `deleted_files` array SHALL be empty

---

## ADDED Requirements

### Requirement: Resource Metadata API
System SHALL provide API endpoint to retrieve full resource metadata including script files.

#### Scenario: Fetch complex skill metadata
- **GIVEN** skill "zoom-build" exists in resource repository
- **AND** skill has `scripts/` directory with 3 executable files
- **WHEN** client calls `GET /api/v1/resources/:id/metadata`
- **THEN** system SHALL return metadata object with `has_scripts=true`
- **AND** `script_files` array SHALL contain 3 entries
- **AND** each entry SHALL include `relative_path`, `content`, `mode`, `encoding`
- **AND** response SHALL include `content_hash` field

#### Scenario: Fetch simple skill metadata
- **GIVEN** skill "hang-log-analyzer" contains only `SKILL.md`
- **WHEN** client calls `GET /api/v1/resources/:id/metadata`
- **THEN** system SHALL return metadata with `has_scripts=false`
- **AND** `script_files` field SHALL be `null` or empty array

#### Scenario: Unauthorized access to metadata API
- **GIVEN** request without valid Bearer token
- **WHEN** client calls `GET /api/v1/resources/:id/metadata`
- **THEN** system SHALL return HTTP 401 Unauthorized
- **AND** SHALL NOT expose resource metadata

---

## Non-Functional Requirements

### Performance
- Incremental sync for 5-file skill SHALL complete in < 2 seconds when no changes exist
- First-time sync for 5-file skill (total 1MB) SHALL complete in < 10 seconds
- SHA256 hash calculation SHALL account for < 5% of total sync time

### Storage
- Single complex skill SHALL occupy < 10MB local disk space
- System SHALL support up to 50 complex skills per user (total < 500MB)

### Security
- Executable scripts SHALL be downloaded with mode 0755 (Unix) or default (Windows)
- File paths SHALL be validated to prevent path traversal attacks (`../` rejected)
- Content hash SHALL be verified before marking sync complete

### Compatibility
- Simple skills (existing behavior) SHALL continue working without changes
- Existing subscriptions SHALL be migrated transparently on first sync
- Windows, macOS, Linux SHALL all be supported

---

## Acceptance Criteria

- [ ] All 13 scenarios above pass automated tests
- [ ] Telemetry capture rate remains 100% for all skill invocations
- [ ] No breaking changes to existing skill/command users
- [ ] Documentation updated in `Docs/Design/` folder
- [ ] User can successfully use `zoom-build` skill end-to-end
