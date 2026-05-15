# Fix Solution

## Root Cause

`manage_subscription` used `subResult.subscriptions.length > 0` and `batchSubResult.subscriptions.length > 0` as the auto-sync gate.

That is incorrect for default/baseline resources. The CSP API can validly return zero newly-created rows because the resource is already provided by the baseline subscription set, while the local MCP process may still have:

- a local unsubscribe suppression override that must be cleared;
- an unregistered Prompt Registry entry from the previous unsubscribe;
- deleted local skill files/manifests from the unsubscribe local actions.

Clearing suppression without scoped sync makes `manage_subscription(list)` show the resource again, but `resolve_prompt_content` still fails because the prompt was not re-registered.

## Fix

Change subscribe and batch_subscribe auto-sync semantics:

- If `auto_sync !== false`, always run scoped `sync_resources` for the requested `resource_ids`.
- Do not rely on the server-created subscription row count to decide whether local prompt registration is needed.
- Keep the sync scoped to requested ids to avoid returning local actions for unrelated resources.
- Update response messages to distinguish requested ids from newly-created server rows and explicitly document baseline/default zero-row behavior.

## Modified Files

- `SourceCode/src/tools/manage-subscription.ts`
- `Test/test-bug-BUG-2026-05-15-001.js`

## Compatibility

- Cursor compatibility is preserved: subscribe still returns `local_actions_required` from scoped sync, and prompt list changes continue to be notified through `PromptManager.registerPrompt`.
- Codex compatibility is improved: restored baseline/default skills are immediately available to `resolve_prompt_content` without a manual sync.
- Existing users who explicitly pass `auto_sync: false` keep the previous behavior.
