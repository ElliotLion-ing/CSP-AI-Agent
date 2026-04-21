# Spec Delta: sync-resources

## ADDED Requirements

### Requirement: resource_ids Parameter for Scoped Sync

System SHALL accept an optional `resource_ids` string array parameter in `sync_resources`.

When `resource_ids` is provided, system SHALL only process subscribed resources whose IDs are in the array. `local_actions_required` SHALL contain only actions relevant to those resources.

When `resource_ids` is not provided, system SHALL process all subscribed resources (existing behavior, unchanged).

#### Scenario: Single Resource Sync Returns Only That Resource's Actions

- **WHEN** `sync_resources` is called with `resource_ids: ['id-A']` and user has 10 subscribed resources
- **THEN** only resource with id 'id-A' is processed
- **THEN** `local_actions_required` contains only actions for resource 'id-A'
- **THEN** no actions for any other resource appear in the response

#### Scenario: Multiple Resource IDs Filter Works Correctly

- **WHEN** `sync_resources` is called with `resource_ids: ['id-A', 'id-B']` and user has 10 subscribed resources
- **THEN** only resources 'id-A' and 'id-B' are processed
- **THEN** `local_actions_required` contains only actions for 'id-A' and 'id-B'

#### Scenario: Omitting resource_ids Preserves Existing Behavior

- **WHEN** `sync_resources` is called without `resource_ids`
- **THEN** all subscribed resources are processed (same as before)

### Requirement: Full Mode Requires Confirmation When Syncing All Resources

System SHALL enforce a confirmation step when `mode='full'` is requested without scoping by `resource_ids`.

When `mode='full'` AND `resource_ids` is not provided AND `_confirmed_full_sync` is not `true`, system SHALL return a structured error with code `FULL_SYNC_REQUIRES_CONFIRMATION` instead of processing resources.

When `_confirmed_full_sync: true` is set, system SHALL proceed with full sync normally.

When `mode='full'` is used together with `resource_ids`, system SHALL NOT require confirmation (scoped full sync is acceptable).

#### Scenario: Full Sync Without Confirmation Returns Error

- **WHEN** `sync_resources` is called with `mode: 'full'` and no `resource_ids` and no `_confirmed_full_sync`
- **THEN** system returns `success: false`
- **THEN** error code is `FULL_SYNC_REQUIRES_CONFIRMATION`
- **THEN** response data includes `requires_confirmation: true` and a `warning` message
- **THEN** no resources are processed, no `local_actions_required` is returned

#### Scenario: Full Sync With Confirmation Proceeds Normally

- **WHEN** `sync_resources` is called with `mode: 'full'` and `_confirmed_full_sync: true`
- **THEN** system processes all subscribed resources normally
- **THEN** response matches existing full-sync behavior

#### Scenario: Full Sync Scoped to resource_ids Does Not Require Confirmation

- **WHEN** `sync_resources` is called with `mode: 'full'` and `resource_ids: ['id-A']`
- **THEN** system processes only resource 'id-A' without requiring confirmation
