# Fix Solution

## Root Cause

The MCP server runs remotely and cannot directly mutate the user's local filesystem or `~/.codex/config.toml`. It correctly returned `local_actions_required`, but the unsubscribe result did not explicitly model those actions as a completion blocker. This allowed release verification to check local state before the Codex-side action execution step happened.

## Changes

- `SourceCode/src/tools/manage-subscription.ts`
  - Cache unsubscribe cleanup actions through `promptManager.storeSyncActions(...)` so the setup prompt can still serve them even outside the HTTP follow-up cache path.
  - Add `local_actions_block_completion: true` for unsubscribe responses with pending local cleanup actions.
  - Strengthen the user-facing message to block C5/C9 verification until local actions are applied.

- `SourceCode/src/server/http.ts`
  - Strengthen the front-loaded local action warning so tool responses explicitly block local state verification before action execution.

- `SourceCode/src/prompts/manager.ts`
  - Strengthen setup prompt instructions for cached and fresh local actions.

- `SourceCode/src/types/tools.ts`
  - Add `local_actions_block_completion?: boolean` to `ManageSubscriptionResult`.

- `Test/test-codex-mcp-release-regression.js`
  - Add regression assertions for unsubscribe action caching, completion-blocking metadata, and stronger C5/C9 verification wording.

## Design Note

The server still must not directly delete local files or edit local Codex config, because deployed MCP servers do not run on the user's machine. The reliable contract is: return structured local actions, mark them as completion-blocking, cache them for setup prompt recovery, and require the AI client to execute them before verification.
