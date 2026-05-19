# BUG-2026-05-19-001: Codex complex skill check falsely reports cached

## Description

Release Check C8 failed after C5 cleanup because `zoom-build` remained subscribed but the local Codex skill files were missing:

- `~/.csp-ai-agent/codex/skills/zoom-build`
- `~/.csp-ai-agent/codex/.manifests/zoom-build.md`

Despite the missing files, `sync_resources(mode: "check", resource_ids: ["6dea7a2c8cf83e5d227ee39035411730"])` returned `cached=1` and did not return `check_file` local actions.

## Reproduction

1. Subscribe/sync `zoom-build` in Codex.
2. Unsubscribe `zoom-build` and execute returned `delete_file` local actions.
3. Restore the subscription without executing all returned `write_file` actions.
4. Call `sync_resources(mode: "check", resource_ids: ["zoom-build id"])`.

## Expected

Check mode should return local `check_file` actions for the complex skill scripts and the Codex-specific manifest path so the local Agent can detect missing files.

## Actual

Check mode only verified prompt registration and used Git metadata for script checks. API-backed complex skills such as `zoom-build` were missed, causing a false `cached` result with no local file checks.
