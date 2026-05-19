# BUG-2026-05-19-001: Codex unsubscribe cleanup can be verified before local actions run

## Description

Codex release checklist C5 and C9 failed because `manage_subscription(action="unsubscribe")` returned the correct `local_actions_required` cleanup actions, but the test flow verified local filesystem/config state before those actions were executed on the user's machine.

## Affected Cases

- C5: `zoom-build` unsubscribe returned `delete_file` actions, but `~/.csp-ai-agent/codex/skills/zoom-build` still existed during verification.
- C9: `acm` unsubscribe returned `remove_toml_entry` actions, but `~/.codex/config.toml` still contained `[mcp_servers.acm-dev]` and `[mcp_servers.acm]` during verification.

## Reproduction

1. Call `manage_subscription(action="unsubscribe", resource_ids=["6dea7a2c8cf83e5d227ee39035411730"])`.
2. Observe `local_actions_required` contains `delete_file` cleanup actions.
3. Verify `~/.csp-ai-agent/codex/skills/zoom-build` before applying the actions.
4. The directory still exists.
5. Repeat with `acm`; `remove_toml_entry` actions are returned, but TOML sections remain until local actions are applied.

## Expected Behavior

Codex must treat returned local actions as completion-blocking. Release check verification must happen only after every returned local action has been executed on the user's local machine.
