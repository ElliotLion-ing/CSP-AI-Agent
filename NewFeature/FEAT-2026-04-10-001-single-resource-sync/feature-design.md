# Feature Design: Single-Resource Sync & Default Incremental Mode

**Feature ID:** FEAT-2026-04-10-001  
**Version:** 1.1.0  
**Date:** 2026-04-10  
**Author:** Elliot Ding  
**Jira:** [CLIENTSP-109](https://zoomvideo.atlassian.net/browse/CLIENTSP-109)  
**Status:** Design Confirmed — Ready for OpenSpec

---

## 1. Background

When `sync_resources` is called (incremental or full mode), `local_actions_required` always contains actions for **all** subscribed resources. This causes two critical problems:

1. **Unnecessary operations**: Even resources that haven't changed generate write_file actions that the AI must process, causing pointless disk I/O and execution overhead.
2. **Context window bloat**: With many subscribed resources (e.g. 16 resources), `local_actions_required` can contain 50–200+ actions, consuming a large chunk of the agent's context window before the actual task even begins.

### Current Flow (problematic)

```
User subscribes to "zoom-build"
  → manage_subscription(subscribe) calls syncResources({ mode: 'incremental' })
  → syncResources fetches ALL subscriptions (16 resources)
  → Processes all 16 → generates local_actions for all complex skills
  → Returns 50+ local_actions covering ALL resources
  → AI must execute all 50+ actions before it can proceed
```

### Desired Flow

```
User subscribes to "zoom-build"
  → manage_subscription(subscribe) calls syncResources({ resource_ids: ['zoom-build-id'] })
  → syncResources fetches ONLY zoom-build subscription
  → Processes 1 resource → generates local_actions for zoom-build only
  → Returns 3–5 local_actions (scripts for zoom-build only)
  → AI executes minimal actions and proceeds immediately
```

---

## 2. Goals

### Goal 1: Single-Resource Sync Support

Add a `resource_ids` parameter to `sync_resources` that allows syncing one or more specific resources instead of all subscribed resources.

- When `resource_ids` is provided, only fetch and process those specific resources.
- `local_actions_required` will only contain actions relevant to the specified resources.
- Applicable to all resource types: skill, rule, mcp, command.

### Goal 2: Auto-Sync After Subscribe Uses Single-Resource Sync

When `manage_subscription(subscribe)` triggers auto-sync, it must pass the newly subscribed `resource_ids` to `syncResources`, not sync all resources.

- Current: `syncResources({ mode: 'incremental' })` → syncs all 16 resources
- Fixed: `syncResources({ mode: 'incremental', resource_ids: ['newly-subscribed-id'] })` → syncs only 1

### Goal 3: Search → Subscribe Flow Uses Single-Resource Sync

When the user performs a fuzzy search and subscribes to a result, the follow-up sync must also be scoped to the single subscribed resource.

### Goal 4: Default Sync Mode is `incremental`, Not `full`; `full` Mode Warning at Server Side

- Default mode (when no `mode` param is specified) stays `incremental` (already the case, no change needed).
- `full` mode syncs ALL resources — must only be triggered on **explicit user request**.
- **Decision (confirmed):** Warning will be enforced **server-side** (in the `sync_resources` tool handler), NOT via rule changes (to avoid impacting all users' rule files).

**Server-side `full` mode guard:**

When `mode === 'full'` AND no `resource_ids` filter is provided, the server returns a special response requiring user confirmation before proceeding:

```typescript
// In syncResources(), before processing:
if (mode === 'full' && !typedParams.resource_ids?.length && !typedParams._confirmed_full_sync) {
  return {
    success: false,
    error: {
      code: 'FULL_SYNC_REQUIRES_CONFIRMATION',
      message: '⚠️ Full sync will process ALL subscribed resources...',
      // Structured so agent can surface this to user and retry with confirmation flag
    },
    data: {
      requires_confirmation: true,
      warning: 'Full sync returns local_actions for ALL resources (potentially 100KB+ context). Incremental is recommended.',
      retry_with: { ...params, _confirmed_full_sync: true },
    }
  };
}
```

The agent surfaces the warning, waits for user confirmation, then retries with `_confirmed_full_sync: true`.

---

## 3. Technical Design

### 3.1 `SyncResourcesParams` Changes

```typescript
// In SourceCode/src/types/tools.ts
export interface SyncResourcesParams {
  mode?: 'check' | 'incremental' | 'full';
  scope?: 'global' | 'workspace' | 'all';
  types?: string[];
  user_token?: string;
  configured_mcp_servers?: string[];

  /**
   * NEW: Optional list of resource IDs to sync.
   * When provided, ONLY these resources are fetched and processed.
   * local_actions_required will only contain actions for these resources.
   * When omitted, behavior is unchanged (all subscriptions are synced).
   */
  resource_ids?: string[];
}
```

### 3.2 `syncResources` Logic Changes

**In `SourceCode/src/tools/sync-resources.ts`:**

**Implementation Strategy: Client-side filtering (no API change needed)**

Analysis of `CSP-AI-Agent-API-Mapping.md` confirms:
- `GET /csp/api/resources/subscriptions` has NO `resource_ids` filter param — server-side filtering would require backend API change.
- `GET /csp/api/resources/download/{id}` **already supports single resource download by ID** — this is the key enabling API.

Therefore: fetch full subscription list, filter client-side, then call `downloadResource(id)` only for matched resources.

```
Step 1 (current): getSubscriptions() → process ALL results
Step 1 (new):
  getSubscriptions() → full list
  IF resource_ids is provided:
    subscriptions = subscriptions.filter(s => resource_ids.includes(s.id))
  // Step 2 (git sync): always runs — git pull is a prerequisite for downloadResource(id)
  //   to return the latest content. The download API reads from the server-side local
  //   git checkout, so skipping git sync would yield stale content.
  // Step 3: Only process filtered subscriptions → downloadResource(id) per resource
```

**Key benefit**: `downloadResource(resourceId)` is already a single-resource API — no protocol change needed. The only change is filtering which resources enter the processing loop.

### 3.3 `manage_subscription` Auto-Sync Fix

**In `SourceCode/src/tools/manage-subscription.ts`:**

```typescript
// Before (problematic):
const syncResult = await syncResources({
  mode: 'incremental',
  scope: typedParams.scope || 'global',
  user_token: typedParams.user_token,
});

// After (fixed):
const syncResult = await syncResources({
  mode: 'incremental',
  scope: typedParams.scope || 'global',
  user_token: typedParams.user_token,
  resource_ids: typedParams.resource_ids,  // Only sync newly subscribed resources
});
```

### 3.4 `SyncResourcesParams` — New `_confirmed_full_sync` Field

```typescript
export interface SyncResourcesParams {
  // ... existing fields ...
  resource_ids?: string[];
  /**
   * Internal confirmation flag for full sync.
   * When mode='full' is called without resource_ids, server requires this to be true.
   * Agent sets this after user confirms the full-sync warning.
   */
  _confirmed_full_sync?: boolean;
}
```

### 3.5 `sync_resources` Tool Description Update

Update the MCP tool description to:
- Document the new `resource_ids` parameter.
- Explain `full` mode confirmation flow (error code `FULL_SYNC_REQUIRES_CONFIRMATION`).
- Clarify that default behavior is `incremental`.
- Note: **No changes to `csp-ai-prompts.mdc` or any user-facing rule files.**

---

## 4. API Design

### `sync_resources` Tool (updated)

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `mode` | `'check' \| 'incremental' \| 'full'` | No | `'incremental'` | Sync mode. `full` without `resource_ids` requires confirmation |
| `scope` | `'global' \| 'workspace' \| 'all'` | No | `'global'` | Where to write local files |
| `resource_ids` | `string[]` | **NEW** | `undefined` (all) | Limit sync to specific resource IDs. Bypasses full-sync warning |
| `types` | `string[]` | No | `undefined` (all) | Filter by resource type |
| `user_token` | `string` | No | — | CSP API token |
| `configured_mcp_servers` | `string[]` | No | `[]` | Existing MCP server names for skip optimization |
| `_confirmed_full_sync` | `boolean` | **NEW** | `false` | Agent sets true after user confirms full-sync warning |

### Existing Backend APIs (no change needed)

| API | Usage |
|-----|-------|
| `GET /csp/api/resources/subscriptions` | Fetch full subscription list; client filters by `resource_ids` |
| `GET /csp/api/resources/download/{id}` | Already single-resource — used per filtered resource |
| `GET /csp/api/resources/{id}` | Single resource detail (not used in sync flow currently) |

---

## 5. Impact Analysis

| Component | Change Type | Risk |
|---|---|---|
| `SourceCode/src/types/tools.ts` | Add `resource_ids`, `_confirmed_full_sync` to `SyncResourcesParams` | Low |
| `SourceCode/src/tools/sync-resources.ts` | Client-side filter + `full` mode guard | Medium — core logic |
| `SourceCode/src/tools/manage-subscription.ts` | Pass `resource_ids` to auto-sync call | Low — 1-line change |
| Tool description strings | Document new params + confirmation flow | Low |
| `csp-ai-prompts.mdc` / any rule files | **No changes** — full-sync enforcement is server-side only | None |
| Backend API | **No changes** — client-side filtering, existing download API reused | None |

**Backward compatibility:** Fully backward compatible. When `resource_ids` is not provided, existing behavior is unchanged.

---

## 6. Development Stages

### Stage 1: Core — `resource_ids` Parameter + Filtering
- Add `resource_ids` to `SyncResourcesParams` interface.
- Implement filtering in `syncResources` (Option B: client-side filter first).
- Unit tests: single resource sync, multi-resource sync, no filter (all resources).

### Stage 2: Auto-Sync Fix in `manage_subscription`
- Pass `resource_ids` from subscribe params to `syncResources`.
- Integration test: subscribe → auto-sync → verify only subscribed resource's local_actions returned.

### Stage 3: `full` Mode Warning in Rule/Prompt
- Update `sync_resources` tool description to document `full` mode warning requirement.
- Update `csp-ai-prompts.mdc` rule: agent must warn + confirm before executing full sync.

---

## 7. Acceptance Criteria

- [ ] `sync_resources({ resource_ids: ['id1'] })` only returns `local_actions` for resource `id1`
- [ ] `manage_subscription(subscribe, resource_ids: ['id'])` auto-sync only touches that 1 resource
- [ ] Search → subscribe flow uses single-resource sync  
- [ ] Default mode is `incremental`; `full` mode requires explicit request
- [ ] `full` mode shows warning and waits for user confirmation before executing
- [ ] All existing tests pass (backward compatibility)
- [ ] New tests achieve ≥90% coverage for the filtering path

---

## 8. Decisions Made

| Question | Decision |
|---|---|
| Server-side `resource_ids` filter on `GET /subscriptions`? | **No** — client-side filter sufficient; `downloadResource(id)` already single-resource |
| `full` mode warning enforcement location? | **Server-side only** — no rule file changes to avoid impacting all users |
