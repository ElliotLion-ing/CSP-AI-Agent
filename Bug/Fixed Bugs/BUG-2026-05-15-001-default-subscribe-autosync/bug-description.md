# BUG-2026-05-15-001: Default subscription restore skips auto-sync

## Description

During Release Check C7, `zoom-code-review` was locally unsubscribed and then restored with `manage_subscription(batch_subscribe)`. The server subscription API returned `0` newly-created subscriptions because the resource is a baseline/default subscription. `manage_subscription` cleared the local suppression override, but skipped auto-sync because it only synced when `subResult.subscriptions.length > 0`.

As a result, `resolve_prompt_content(zoom-code-review)` immediately after restore returned `PROMPT_NOT_FOUND` until a manual scoped `sync_resources(resource_ids=[zoom-code-review])` was executed.

## Reproduction

1. Start from a baseline/default skill subscription such as `zoom-code-review`.
2. Run `manage_subscription(batch_unsubscribe, resource_ids=[zoom-code-review])`.
3. Execute returned local delete actions.
4. Run `manage_subscription(batch_subscribe, resource_ids=[zoom-code-review])`.
5. Immediately run `resolve_prompt_content(resource_id=zoom-code-review)`.

## Expected

Subscribe should leave the resource ready for immediate prompt resolution when `auto_sync` is not explicitly disabled. This must hold even when the server returns no newly-created subscription rows because the resource is already part of the default baseline.

## Actual

Auto-sync is skipped when the subscribe API returns `0` new subscriptions. The local suppression is cleared, but the in-memory Prompt Registry is not rebuilt until the user manually calls scoped `sync_resources`.

## Impact

- Codex users see a non-obvious `PROMPT_NOT_FOUND` after restoring a default resource.
- Cursor users can also be affected after local unsubscribe override because prompt list refresh depends on registry rebuild.
- The workaround is manual scoped `sync_resources`, which violates the expected subscribe semantics.
