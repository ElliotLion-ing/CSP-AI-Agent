# Proposal: Single-Resource Sync & Full-Mode Confirmation

**Change ID:** single-resource-sync  
**Jira:** CLIENTSP-109  
**Author:** Elliot Ding  
**Date:** 2026-04-10

## Why

When `sync_resources` is called, it always processes all subscribed resources and returns `local_actions_required` for all of them — even in `incremental` mode after subscribing to a single new resource. This causes two problems:

1. **Unnecessary writes**: Resources that haven't changed still generate write_file actions.
2. **Context overhead**: With 16+ subscribed resources, `local_actions_required` can be 50–200+ actions, consuming a large portion of the AI agent's context window before the actual task begins.

Additionally, `full` mode — which downloads and generates actions for every subscribed resource — has no guardrail, making it easy to accidentally saturate the context window.

## What

1. **Add `resource_ids` parameter to `sync_resources`**: When provided, only the specified resources are fetched from the subscription list and processed. `local_actions_required` contains only actions for those resources.

2. **Fix `manage_subscription` auto-sync**: After subscribing to resource(s), auto-sync must pass the newly subscribed `resource_ids` to `syncResources` instead of syncing all resources.

3. **Server-side `full` mode confirmation guard**: When `mode='full'` is called without `resource_ids` and without `_confirmed_full_sync: true`, the server returns a structured error requiring user confirmation before proceeding. No rule file changes needed.

## Impact

- `SourceCode/src/types/tools.ts`: Add `resource_ids` and `_confirmed_full_sync` fields to `SyncResourcesParams`.
- `SourceCode/src/tools/sync-resources.ts`: Client-side subscription filtering + full-mode guard logic.
- `SourceCode/src/tools/manage-subscription.ts`: Pass `resource_ids` to auto-sync call.
- Tool description strings: Document new parameters and confirmation flow.
- **No backend API changes** (uses existing `downloadResource(id)` single-resource endpoint).
- **No rule file changes** (enforcement is server-side only).
- **Fully backward compatible** (existing callers without `resource_ids` behave identically).
