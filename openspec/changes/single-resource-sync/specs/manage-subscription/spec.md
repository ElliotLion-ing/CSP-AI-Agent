# Spec Delta: manage-subscription

## MODIFIED Requirements

### Requirement: Auto-Sync After Subscribe Is Scoped to Newly Subscribed Resources

System SHALL pass the newly subscribed `resource_ids` to `syncResources` during auto-sync after a subscribe action.

Previously, auto-sync called `syncResources` without `resource_ids`, causing all subscribed resources to be synced. System SHALL now scope the auto-sync to only the resources that were just subscribed.

#### Scenario: Subscribe to One Resource Only Syncs That Resource

- **WHEN** `manage_subscription` is called with `action: 'subscribe'` and `resource_ids: ['id-A']`
- **THEN** auto-sync calls `syncResources({ resource_ids: ['id-A'], mode: 'incremental' })`
- **THEN** `local_actions_required` in the subscribe response contains only actions for 'id-A'
- **THEN** no actions for other subscribed resources appear

#### Scenario: Subscribe to Multiple Resources Only Syncs Those Resources

- **WHEN** `manage_subscription` is called with `action: 'subscribe'` and `resource_ids: ['id-A', 'id-B']`
- **THEN** auto-sync calls `syncResources({ resource_ids: ['id-A', 'id-B'], mode: 'incremental' })`
- **THEN** `local_actions_required` contains only actions for 'id-A' and 'id-B'
