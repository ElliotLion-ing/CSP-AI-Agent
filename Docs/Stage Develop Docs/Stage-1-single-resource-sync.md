# Stage Development Doc: Single-Resource Sync & Full-Mode Confirmation

**Feature:** FEAT-2026-04-10-001  
**OpenSpec:** single-resource-sync  
**Date:** 2026-04-10  
**Stage:** Complete (All 3 Stages)

---

## Stage Goals

Reduce `local_actions_required` context overhead by supporting single-resource sync, and enforce a confirmation step before full sync.

---

## Completed Features

### Stage 1: `resource_ids` Parameter + Filtering (`sync-resources.ts`)

- Added `resource_ids?: string[]` to `SyncResourcesParams`.
- After fetching all subscriptions from API, filter to only specified IDs client-side.
- Server-side git sync (`syncAllSources`) always runs (except `check` mode) — it is a prerequisite for `downloadResource(id)` to return the latest content, since the download API reads from the server-side local git checkout.
- `local_actions_required` contains only actions for filtered resources.
- Fully backward compatible: omitting `resource_ids` preserves existing behaviour.

### Stage 2: `manage_subscription` Auto-Sync Fix (`manage-subscription.ts`)

- When `subscribe` triggers auto-sync, now passes `resource_ids: typedParams.resource_ids` to `syncResources`.
- Subscribing to 1 resource now triggers sync for only that resource, not all 16+.

### Stage 3: Full-Mode Confirmation Guard (`sync-resources.ts`)

- Added `_confirmed_full_sync?: boolean` to `SyncResourcesParams`.
- When `mode='full'` AND no `resource_ids` AND `_confirmed_full_sync !== true`: returns structured error `FULL_SYNC_REQUIRES_CONFIRMATION`.
- Full sync scoped by `resource_ids` bypasses the guard (safe, bounded).
- Updated tool description and `inputSchema` to document both new parameters.
- **No rule file changes** — enforcement is purely server-side.

---

## Key Implementation Details

### Filtering Logic (sync-resources.ts ~line 107)

```typescript
const resourceIds = params.resource_ids && params.resource_ids.length > 0
  ? new Set(params.resource_ids)
  : null;

// After getSubscriptions():
const subscriptions = resourceIds
  ? { total: ..., subscriptions: allSubscriptions.subscriptions.filter(s => resourceIds.has(s.id)) }
  : allSubscriptions;

// Skip git sync when scoped:
if (resourceIds) {
  // skip syncAllSources()
} else {
  await multiSourceGitManager.syncAllSources();
}
```

### Full-Mode Guard (sync-resources.ts ~line 122)

```typescript
if (mode === 'full' && !resourceIds && !confirmedFullSync) {
  return { success: false, error: { code: 'FULL_SYNC_REQUIRES_CONFIRMATION', ... } };
}
```

### Auto-Sync Fix (manage-subscription.ts ~line 56)

```typescript
const syncResult = await syncResources({
  mode: 'incremental',
  scope: typedParams.scope || 'global',
  user_token: typedParams.user_token,
  resource_ids: typedParams.resource_ids,  // ← only newly subscribed IDs
});
```

---

## Test Results

**Test file:** `Test/test-feat-single-resource-sync.js`  
**Result:** 33/33 passed, 0 failed  
**Exit code:** 0

| Test Group | Cases | Result |
|---|---|---|
| Single resource_id filter | T1.1–T1.3 | ✅ Pass |
| local_actions scoped to resource | T2.1–T2.3 | ✅ Pass |
| Multiple resource_ids filter | T3.1–T3.3 | ✅ Pass |
| Git sync skip when scoped | T4.1–T4.2 | ✅ Pass |
| No filter = all resources | T5.1–T5.2 | ✅ Pass |
| Full mode confirmation guard | T6.1–T6.4 | ✅ Pass |
| Full + confirmed = proceeds | T7.1–T7.2 | ✅ Pass |
| Full + resource_ids = no guard | T8.1–T8.3 | ✅ Pass |
| Default = incremental, no guard | T9.1–T9.2 | ✅ Pass |
| Auto-sync scoped after subscribe | T10.1–T10.6 | ✅ Pass |
| Unknown resource_ids = empty | T11.1–T11.3 | ✅ Pass |

---

## Design Decisions vs Initial Design

| Decision | Initial | Final |
|---|---|---|
| API server-side filter | Considered | Not done — client-side filter sufficient |
| `full` mode enforcement | Rule file change | Server-side only (no rule changes) |
| Auto-sync scope | All resources | Scoped to `resource_ids` |

**Design deviation:** 0 — fully matches feature-design.md v1.1.0

---

## Files Changed

| File | Change |
|---|---|
| `SourceCode/src/types/tools.ts` | Added `resource_ids`, `_confirmed_full_sync` to `SyncResourcesParams` |
| `SourceCode/src/tools/sync-resources.ts` | Full-mode guard + resource_ids filter + git skip + tool description |
| `SourceCode/src/tools/manage-subscription.ts` | Pass `resource_ids` to auto-sync call |
| `Test/test-feat-single-resource-sync.js` | New test file, 11 test groups, 33 assertions |
