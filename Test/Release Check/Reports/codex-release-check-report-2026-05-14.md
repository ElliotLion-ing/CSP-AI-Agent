# Codex Release Check Report

- Date: `2026-05-14`
- Client: `Codex`
- Checklist: [release-check-checklist.md](/Users/ElliotDing/SourceCode/AI%20Explore/Codex-AI-Agent-MCP/Test/Release%20Check/release-check-checklist.md)
- Report Type: `Part B / Codex rerun from scratch`
- Overall Result: `FAIL`

## Scope

This report is a fully regenerated `Codex` release-check report. The previous `2026-05-14` Codex report was deleted before this rerun.

This rerun covered:
- `Case C0-1` to `Case C0-3`
- `Case C1` to `Case C10`

It did **not** execute `Cursor Part A`; this file is only the Codex-side report.

## Subscription Snapshot

Initial snapshot from `manage_subscription(action="list")` contained `14` subscriptions:

- `csp-ai-prompts`
- `zoom-testcase`
- `zoom-code-review`
- `zoom-build`
- `acm`
- `security-security-baseline`
- `zoom-design-doc`
- `winzr-cpp-expert`
- `zoom-doc`
- `ZMDB-diagnose-db-hang`
- `zoom-client-worktree`
- `hang-log-analyzer`
- `generate-testcase`
- `zoom-jira`

Final snapshot after cleanup returned to the same `14` subscriptions.

## Summary

This rerun confirms three meaningful improvements on the Codex path:

1. `C1` full sync is now explicit and safe-gated. After user confirmation, `sync_resources(mode="full", scope="global", _confirmed_full_sync=true)` succeeded with `14/14 synced`.
2. `C4` single-resource and multi-resource subscribe flows now return resource-scoped `local_actions_required`, instead of dragging in all subscribed resources.
3. `C7` telemetry is clearly working on Codex. Usage stats increased from `24` to `39`, and the server log records `agent_profile:"codex"` in telemetry payloads.

The release is still blocked by four areas:

- `C0-3 / C3 / C8`: `zoom-build` local skill files still do not land under `~/.csp-ai-agent/codex/skills/zoom-build/`
- `C5`: unsubscribe for existing resources like `zoom-build` / `zoom-code-review` still fails with `requested=1, removed=0`
- `C9`: `acm` now points to Codex config on the action path, but unsubscribe still fails and local Codex config state does not fully close the loop
- `C10`: `reference.md` lazy loading works, and MR 41969 data can be fetched, but the full end-to-end review output was not completed in this rerun

## Case Results

### Case C0

| Case | Result | Notes |
|------|--------|-------|
| `C0-1` | `PASS` | `~/.codex/config.toml` contains `[mcp_servers.csp-ai-agent]`, URL uses `/mcp`, and MCP tools respond normally |
| `C0-2 Phase 1` | `PASS` | `sync_resources` returned `merge_toml ~/.codex/config.toml key=developer_instructions`; `developer_instructions` exists in config; checkpoint file was written to `~/.codex/release-check-checkpoint.md` |
| `C0-2 Phase 2` | `PASS` | After Codex restart, checkpoint was read, `developer_instructions` and policy file were still present, `manage_subscription(list)` was called first, and both `zoom-code-review` and `zoom-build` were resolved through CSP |
| `C0-3` | `FAIL` | `zoom-build` sync returns Codex-local write targets, but `~/.csp-ai-agent/codex/skills/zoom-build/scripts/`, `teams/`, and `~/.csp-ai-agent/.manifests/zoom-build.md` still do not exist |

### Case C1-C10

| Case | Result | Notes |
|------|--------|-------|
| `C1` | `PASS` | Incremental global sync succeeded: `14/14 synced`. Explicit full sync also succeeded after confirmation: `14/14 synced` |
| `C2` | `PASS` | Single-resource sync for `zoom-code-review` used only its own `resource_id`; returned only target-local actions |
| `C3` | `FAIL` | `zoom-build` sync returns write targets under `~/.csp-ai-agent/codex/skills/zoom-build/`, but local files still do not materialize |
| `C4` | `PASS` | Search found unsubscribed targets; single subscribe (`android-client-code-review`) and multi-subscribe (`androidzr-code-review`, `review-design-doc`) both returned resource-scoped sync/actions only |
| `C5` | `FAIL` | Unsubscribe for `zoom-build` and `zoom-code-review` failed with `Unsubscribe API reported partial removal: requested=1, removed=0`; list still retained both |
| `C6` | `PARTIAL` | Subscribed path is correct: `manage_subscription(list)` then `resolve_prompt_content(zoom-code-review)`. Fallback branch could not be fully exercised because unsubscribe of `zoom-code-review` failed |
| `C7` | `PASS` | `resolve_prompt_content` calls increased usage stats from `24` to `39`; log confirms telemetry payload `agent_profile:"codex"` |
| `C8` | `FAIL` | Sync action payload shows correct Codex target path and intended files, but manifest/scripts/teams are absent locally, so remote-vs-local consistency cannot be validated |
| `C9` | `FAIL` | `acm` sync action now targets `~/.codex/config.toml`, not Cursor config, but unsubscribe still fails with `removed=0`; local `acm` block was not present to verify removal behavior |
| `C10` | `PARTIAL` | `winzr-cpp-expert` subscription exists; `resolve_prompt_content(resource_path="reference.md")` succeeds; MR 41969 metadata/diff can be fetched. Full review report generation was not completed |

## Evidence

### `C0-1`

- `~/.codex/config.toml` contains:
  - `[mcp_servers.csp-ai-agent]`
  - `url = "https://zct-dev.zoomdev.us/csp-agent/mcp"`
  - `developer_instructions = "Please read and follow the CSP routing policy at: ~/.csp-ai-agent/codex/csp-routing-policy.md"`

### `C0-2`

- `sync_resources(mode="full", scope="global")` returned:
  - `merge_toml`
  - `toml_path = "~/.codex/config.toml"`
  - `key = "developer_instructions"`
  - `value = "Please read and follow the CSP routing policy at: ~/.csp-ai-agent/codex/csp-routing-policy.md"`
- Checkpoint file was read during Phase 2 and then removed after successful verification:
  - `~/.codex/release-check-checkpoint.md`
- Post-restart routing verification:
  - review intent: `manage_subscription(list)` -> `resolve_prompt_content(resource_id="632400b351c85024b0385ab3e7fa838d")`
  - build intent: `manage_subscription(list)` -> `resolve_prompt_content(resource_id="6dea7a2c8cf83e5d227ee39035411730")`

### `C3 / C8`

- `zoom-build` sync and `resolve_prompt_content(zoom-build)` both expose `local_actions_required`
- Visible target paths include:
  - `~/.csp-ai-agent/codex/skills/zoom-build/teams/web-zrc.json`
  - `~/.csp-ai-agent/codex/skills/zoom-build/scripts/build-cli`
  - `~/.csp-ai-agent/codex/skills/zoom-build/scripts/branch_detector.py`
  - `~/.csp-ai-agent/codex/skills/zoom-build/scripts/build-jfrog-path`
- But filesystem checks still fail:
  - `~/.csp-ai-agent/codex/skills/zoom-build/scripts/` missing
  - `~/.csp-ai-agent/codex/skills/zoom-build/teams/` missing
  - `~/.csp-ai-agent/.manifests/zoom-build.md` missing
  - `~/.csp-ai-agent/skills/zoom-build/` also missing, which is correct for Codex isolation

### `C4`

- Search found unsubscribed resource:
  - `android-client-code-review` with `is_subscribed=false`
- Single subscribe returned only that resource in `subscriptions`, `sync_details`, and its own `local_actions_required`
- Multi-subscribe returned only:
  - `androidzr-code-review`
  - `review-design-doc`

### `C5`

- `manage_subscription(action="unsubscribe", resource_ids=["6dea7a2c8cf83e5d227ee39035411730"])`
  - returned `success=false`
  - error: `Unsubscribe API reported partial removal: requested=1, removed=0`
- `manage_subscription(action="unsubscribe", resource_ids=["632400b351c85024b0385ab3e7fa838d"])`
  - returned the same partial-removal failure

### `C7`

- Baseline telemetry:
  - `total_invocations = 24`
  - `zoom-code-review = 12`
  - `winzr-cpp-expert = 9`
  - `hang-log-analyzer = 3`
- After this rerun:
  - `total_invocations = 39`
  - `zoom-code-review = 18`
  - `winzr-cpp-expert = 12`
  - `zoom-build = 6`
  - `hang-log-analyzer = 3`
- Log evidence:
  - [app.2026-05-14.1.log](/Users/ElliotDing/SourceCode/AI%20Explore/Codex-AI-Agent-MCP/Logs/app.2026-05-14.1.log:72)
  - [app.2026-05-14.1.log](/Users/ElliotDing/SourceCode/AI%20Explore/Codex-AI-Agent-MCP/Logs/app.2026-05-14.1.log:77)
  - [app.2026-05-14.1.log](/Users/ElliotDing/SourceCode/AI%20Explore/Codex-AI-Agent-MCP/Logs/app.2026-05-14.1.log:151)
- These log lines show telemetry requests containing `agent_profile":"codex"`

### `C9`

- `sync_resources(resource_ids=["8346836580e75837a7183285c5872843"])` returned:
  - `merge_toml`
  - `toml_path = "~/.codex/config.toml"`
  - `key = "mcp.servers.acm"`
- This confirms the action path is now Codex-oriented rather than Cursor-oriented
- But unsubscribe still fails:
  - `Unsubscribe API reported partial removal: requested=1, removed=0`

### `C10`

- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c")`
  - contains `[MANDATORY`
  - contains `resolve_prompt_content`
  - contains `resource_path`
  - embeds the correct `resource_id`
- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c", resource_path="reference.md")`
  - succeeded
  - returned actual `reference.md` content for WinZR C++ review guidance
- MR fetch succeeded:
  - `helper tool run gitlab_get_merge_request --url "https://git.zoom.us/main/zoomrooms/-/merge_requests/41969" --include-diffs true --include-comments true --include-approvals true`

## Cleanup Result

- Temporary test subscriptions added in this rerun:
  - `android-client-code-review`
  - `androidzr-code-review`
  - `review-design-doc`
- They were unsubscribed successfully in batch and local delete actions were executed
- Final subscription list returned to the original `14`-item snapshot

## Remaining Blockers

1. `zoom-build` local files are still not being materialized under the Codex skill cache path, so `C0-3 / C3 / C8` remain blocked.
2. Existing-resource unsubscribe is still not converging for `zoom-build`, `zoom-code-review`, and `acm`, so `C5 / C9` remain blocked.
3. `C10` still needs the final `winzr-cpp-expert` review output for MR 41969, not just resource-path resolution and MR data fetch.

## Final Verdict

`FAIL`

This Codex rerun is not production-ready yet.
