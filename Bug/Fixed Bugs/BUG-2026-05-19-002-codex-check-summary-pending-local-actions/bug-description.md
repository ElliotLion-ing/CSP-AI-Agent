# BUG-2026-05-19-002: Codex check summary reports cached while local checks are pending

## Problem

Release Check C8 still failed after complex-skill check actions were added. `sync_resources(mode="check", resource_ids=["zoom-build"])` returned `check_file` actions for Codex local skill files, but the top-level summary still reported the resource as `cached`.

## Impact

The Release Check could not trust `summary.cached` or `health_score` for Codex complex skills. If local `~/.csp-ai-agent/codex/skills/zoom-build` files or the manifest were missing, the response still looked healthy even though local verification had not completed.

## Reproduction

1. Ensure `zoom-build` is subscribed and registered as a prompt.
2. Remove local Codex cache files:
   - `~/.csp-ai-agent/codex/skills/zoom-build`
   - `~/.csp-ai-agent/codex/.manifests/zoom-build.md`
3. Run `sync_resources(mode="check", resource_ids=["6dea7a2c8cf83e5d227ee39035411730"])`.
4. Observe `local_actions_required` contains `check_file` actions, while `summary.cached=1`.

## Expected

When server-side check mode queues `check_file` actions, the resource must not be reported as cached yet. It should be treated as failed/pending local verification until the Agent executes the checks and confirms matches.
