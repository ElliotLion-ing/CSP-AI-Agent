# BUG-2026-05-15-002 Windows Codex Manifest Path

## Bug Description

On Windows, Codex release check failed after `sync_resources` returned Codex-specific `write_file` local actions for complex skills. The expected Codex directories under `~/.csp-ai-agent/codex/skills/...` were not created, while legacy Cursor-style directories under `~/.csp-ai-agent/skills/...` already existed.

## Reproduction

1. Run `sync_resources(mode="incremental", scope="global")` from Codex on Windows.
2. Observe `local_actions_required` includes paths such as `~/.csp-ai-agent/codex/skills/<skill>/...`.
3. Execute setup prompt local-action instructions.
4. Check `~/.csp-ai-agent/codex/skills/<skill>/`.

## Expected Result

Codex complex skill files are written to `~/.csp-ai-agent/codex/skills/<skill>/`, and Codex manifests are stored under `~/.csp-ai-agent/codex/.manifests/<skill>.md`.

## Actual Result

The Codex skill directory was missing. Windows machines with legacy `~/.csp-ai-agent/.manifests/<skill>.md` could incorrectly treat the skill as already up to date and skip the Codex-specific `write_file` actions.

## Root Cause

Complex skill setup instructions always told the agent to compare against the legacy manifest path `~/.csp-ai-agent/.manifests/<skill>.md`. For Codex, the script files are intentionally written to a different subtree, `~/.csp-ai-agent/codex/skills/<skill>/`. When the legacy manifest already existed and matched, the agent skipped the file writes that should have created the Codex-specific folders.

## Impact

- Windows Codex release check can fail `C0-3`, `C3`, and `C8`.
- A Codex user may have valid prompts but missing local helper scripts.
- macOS logic should remain unaffected because Cursor continues using the legacy manifest path and Codex now receives its own explicit path.
