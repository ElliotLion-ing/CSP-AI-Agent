# Fix Solution

## Root Cause

`sync_resources` check mode generated `check_file` local actions but then immediately incremented `tally.cached` and pushed a `cached` detail row. This was a placeholder assumption, not a real local filesystem check.

For registered command/skill prompts, the same issue existed after adding complex-skill local checks: the code marked the prompt cached before considering whether local script and manifest checks were queued.

## Fix

Updated `SourceCode/src/tools/sync-resources.ts`:

- For registered complex skills, compute a `checkAction` result.
- Keep `cached` only when no local file checks are required.
- Mark the resource as `failed` when `check_file` actions are queued or local check preparation fails.
- For Rule/MCP check mode, mark resources with queued `check_file` actions as `failed` instead of using the old cached placeholder.

## Rationale

The MCP server cannot read the user's local filesystem. A queued `check_file` action means the check is not complete. Reporting that state as cached is unsafe for release gating.

## Modified Files

- `SourceCode/src/tools/sync-resources.ts`
- `Test/test-bug-BUG-2026-05-19-001.js`
