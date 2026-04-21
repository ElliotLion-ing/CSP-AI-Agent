# Implementation Tasks: single-resource-sync

## Stage 1: `resource_ids` Parameter + Filtering in `sync_resources`

- [ ] Add `resource_ids?: string[]` to `SyncResourcesParams` in `types/tools.ts`
- [ ] In `syncResources()`: after fetching subscriptions, filter by `resource_ids` when provided
- [ ] Skip full git sync (`multiSourceGitManager.syncAllSources`) when `resource_ids` is provided (only sync relevant repos if needed)
- [ ] Verify `local_actions_required` only contains actions for specified resources

## Stage 2: Fix `manage_subscription` Auto-Sync

- [ ] In `manageSubscription()` subscribe case: pass `resource_ids: typedParams.resource_ids` to `syncResources()`
- [ ] Verify that subscribing to 1 resource triggers sync for only that resource

## Stage 3: `full` Mode Server-Side Guard

- [ ] Add `_confirmed_full_sync?: boolean` to `SyncResourcesParams` in `types/tools.ts`
- [ ] In `syncResources()`: when `mode === 'full'` AND no `resource_ids` AND `!_confirmed_full_sync`, return structured confirmation error
- [ ] Update `sync_resources` tool description string to document `resource_ids`, `_confirmed_full_sync`, and the confirmation flow
