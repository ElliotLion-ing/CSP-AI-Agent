# Fix Solution

## Root Cause

1. MCP resource cleanup used the requested resource name as a single server key. For Format B `mcp-config.json`, one CSP resource can define multiple server entries, such as `acm-dev` and `acm`, so cleanup left sibling entries behind.
2. `manage_subscription(unsubscribe)` did not forward the canonical resource id or user token into `uninstall_resource`, so the uninstall path could not reliably download the resource config and resolve the actual server keys.
3. `csp-ai-agent-setup` embedded local actions but did not explain base64 decoding or complex skill manifest handling. Codex could receive valid `write_file` actions but still execute them incorrectly.

## Changes

- `SourceCode/src/tools/uninstall-resource.ts`
  - Added MCP server-name resolution from `mcp-config.json`.
  - Added direct uninstall fallback that resolves a resource id from current subscriptions by resource name.
  - Updated Codex cleanup to emit one `remove_toml_entry` per resolved server key.
  - Updated Cursor cleanup to emit one `remove_mcp_json_entry` per resolved server key, preserving the old Cursor path while fixing sibling-key cleanup.
- `SourceCode/src/tools/manage-subscription.ts`
  - Forwarded `resource_id` and `user_token` to `uninstall_resource`.
- `SourceCode/src/prompts/manager.ts`
  - Added setup prompt rules for base64 `write_file` decoding.
  - Added complex skill manifest handling rules.
  - Explicitly prevents writing `SKILL.md` into the skill script directory.
- `SourceCode/src/types/tools.ts`
  - Added internal `resource_id` support to `UninstallResourceParams`.
- `Test/test-codex-mcp-release-regression.js`
  - Added static regression assertions for MCP multi-key cleanup and setup prompt local-action rules.
- `Test/test-bug-BUG-2026-05-14-001.js`
  - Added bug-specific regression entry point.

## Compatibility

- Cursor remains on `merge_mcp_json` for sync and `remove_mcp_json_entry` for uninstall.
- Codex remains on `merge_toml` for sync and `remove_toml_entry` for uninstall.
- The cleanup change only expands one-resource cleanup from one server key to all keys declared by the same resource config.
