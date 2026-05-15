# CSP AI Agent Release Check Report - Codex Rerun 2026-05-14 17:00

**Checklist:** `Test/Release Check/release-check-checklist.md` v1.4.0  
**Environment:** Codex Desktop, Streamable HTTP MCP endpoint `https://zct-dev.zoomdev.us/csp-agent/mcp`  
**Run status:** COMPLETE - resumed after restart and completed Codex C0-2 Phase 2 through C10  
**Report type:** Fresh report for this rerun; not based on the prior 2026-05-14 report.

## Subscription Snapshot

Initial snapshot contained 14 resources:

| Resource | Type | ID |
|---|---|---|
| csp-ai-prompts | rule | `0bbc520906995c7ca6ecb923aba141ca` |
| zoom-testcase | skill | `4aabb99362070c1f3ef3582b62f37d98` |
| zoom-code-review | skill | `632400b351c85024b0385ab3e7fa838d` |
| zoom-build | skill | `6dea7a2c8cf83e5d227ee39035411730` |
| acm | mcp | `8346836580e75837a7183285c5872843` |
| security-security-baseline | rule | `ad07dd91e56658858d28634034b876a7` |
| zoom-design-doc | skill | `bdba66f05d2bf4ef4a71051fe4fc8f18` |
| winzr-cpp-expert | skill | `009157d8ed498e93c0dbdbdbd47ae40c` |
| zoom-doc | skill | `0b906418c1486fd59f3f93cbb762f5de` |
| ZMDB-diagnose-db-hang | command | `0bb0b03e92eb56118a27a15048716f93` |
| zoom-client-worktree | skill | `2a2f55f8cd91dd272816d571e7688e61` |
| hang-log-analyzer | skill | `7b7c653e1fee5a30962a4019411c128b` |
| generate-testcase | command | `aee05dd59a754e566370e84e93360d32` |
| zoom-jira | skill | `cbbbb578a4ec94d780627ffbeb5bb232` |

## Codex Results So Far

| Case | Status | Evidence |
|---|---|---|
| C0-1 config.toml MCP 配置 | PASS | `[mcp_servers.csp-ai-agent]` exists, URL is `https://zct-dev.zoomdev.us/csp-agent/mcp`, no `/sse`, Authorization header present, `manage_subscription(list)` succeeds. |
| C0-2 Phase 1 policy 注入 | PASS | `sync_resources(mode: incremental, scope: global)` returned `merge_toml` for `~/.codex/config.toml` `developer_instructions`; config contains developer instructions and `~/.csp-ai-agent/codex/csp-routing-policy.md` exists. |
| C0-2 Phase 2 restart 后 policy 生效 | PASS | After Codex restart, checkpoint was read, `manage_subscription(list)` was called first, `帮我 review 一下这个 MR` resolved `zoom-code-review`, and `小助手，帮我出个包` resolved `zoom-build`. Checkpoint file was deleted after pass. |
| C0-3 zoom-build Codex skill 写入 | PASS with setup note | `sync_resources(mode: incremental, resource_ids: [zoom-build])` returned success. Codex path contains scripts=9 and teams=7; `build-cli` is `-rwxr-xr-x` size 44814; Cursor path `~/.csp-ai-agent/skills/zoom-build` is absent. The tool still returns `setup_required: true`/repeated local actions after restart, which should be investigated separately. |
| C1 全量 incremental sync | PASS with restart caveat | Before and after restart, `sync_resources(mode: incremental, scope: global)` returned success, total 14, synced 14, health_score 100, no full sync used. After restart it still returned `restart_required: true`, so restart hints are not idempotently suppressed. |
| C2 单资源 sync | PASS | Before and after restart, `sync_resources(mode: incremental, resource_ids: [zoom-code-review])` returned only `zoom-code-review`; no unrelated resource actions observed. |
| C3 zoom-build complex skill sync | PASS with local-action caveat | MCP returned Codex-path `write_file` actions under `~/.csp-ai-agent/codex/skills/zoom-build/`. After executing/materializing the returned actions via the CSP download helper, Codex path verification passed: scripts=9, teams=7, `build-cli` mode `-rwxr-xr-x`, Cursor path absent. The raw MCP output is still too large/truncated for reliable manual action execution. |
| C4 search and subscribe | PASS | `search_resources(keyword: hang)` returned subscribed and unsubscribed matches. Single-resource subscribe for `changelog-nex` synced only that resource. Multi-resource subscribe using unsubscribed `dir-to-zoomdoc` and `hybrid-jssdk-docs` synced exactly two resources, then temporary resources were unsubscribed and local files removed. |
| C5 unsubscribe and cleanup | PASS with restoration caveat | Unsubscribing `zoom-code-review` hid it from list and returned Codex delete actions. Unsubscribing `zoom-build` returned Codex delete actions and local directory removal succeeded. After later restore, `subscribe` for default resources returned 0 new resources, requiring explicit `sync_resources` to re-register prompts. |
| C6 CSP priority route | PARTIAL | With `zoom-code-review` listed, `resolve_prompt_content(resource_id)` initially failed with `PROMPT_NOT_FOUND` after unsubscribe/restore until explicit single-resource sync was run. After sync, resolve succeeded with `usage_tracked: true`. Fallback path after unsubscribe hid `zoom-code-review` and list reported 13 resources. |
| C7 telemetry | PASS with profile caveat | Post-restart telemetry was observable: `query_usage_stats` showed `zoom-code-review` invocation_count increasing from 30 to 33 after `resolve_prompt_content(resource_id)`, and `usage_tracked: true` was returned. The stats API still does not expose `agent_profile`, so the `agent_profile=codex` checklist item remains unconfirmed. |
| C8 local vs remote content consistency | PASS | `zoom-build` materialized from CSP API: remote `file_count=25`, written files 24 plus manifest. Local manifest version `3.3.0`, scripts count 9, teams count 7, `build-cli` size 44814 and mode `-rwxr-xr-x`. |
| C9 MCP resource cleanup | FAIL | Syncing `acm` returned Codex local action `merge_toml` with key `mcp.servers.acm` and SSE URLs `/sse`, not current Codex `mcp_servers.*` streamable HTTP shape. Unsubscribe returned `remove_toml_entry` for `~/.codex/config.toml`; cleanup preserved `csp-ai-agent`, but the sync action format is wrong for Codex. |
| C10 winzr md lazy loading | PASS | `resolve_prompt_content(winzr-cpp-expert)` returned MANDATORY `resolve_prompt_content` blocks with `resource_path: reference.md`; `resolve_prompt_content(resource_path: reference.md)` succeeded and returned ZoomRooms C++ review standards. MR 41969 was fetched through the CSP-first chain, helper GitLab returned MR metadata and full diff, and a concrete review finding could be produced against the diff using the loaded reference. |

## Part A Cursor Coverage

Part A Cursor IDE prompt-list behavior was not directly observable from this Codex session. File/path semantics were only inferred where Codex tools returned Cursor-related local actions. A separate Cursor IDE session is still required to fully sign off Case 1-10 for Cursor-native prompt refresh behavior.

## Overall Verdict

Codex release check is not production-ready because Case C9 still fails for MCP config action shape. The remaining non-blocking caveats are repeated setup/restart prompts, large local action payload handling, and telemetry `agent_profile` visibility.

## Issues Found

| ID | Severity | Area | Finding |
|---|---|---|---|
| RC-2026-05-14-001 | High | Codex local actions | Large complex skill `local_actions_required` payload is not reliably executable from the Codex tool output because output is truncated. Server returns correct Codex paths, but end-to-end file write depends on the agent/client executing complete actions. After restart, `resolve_prompt_content` also returned `setup_required: true` and repeated local actions. |
| RC-2026-05-14-002 | High | Subscription restore | After unsubscribing a default/baseline resource, calling `subscribe` again can return 0 resources and does not by itself re-register the prompt. Explicit `sync_resources(resource_ids: [...])` was required. |
| RC-2026-05-14-003 | Medium | Telemetry | Invocation count is now observable after restart, but `query_usage_stats` still does not expose/confirm `agent_profile=codex`. |
| RC-2026-05-14-004 | High | MCP config action | `acm` sync returns `mcp.servers.acm` with `/sse` URLs, which is not the Codex `mcp_servers.*` streamable HTTP shape expected by the checklist. |
| RC-2026-05-14-005 | Resolved in rerun | E2E MR review | After restart, helper GitLab successfully fetched MR 41969 metadata and full diff; the previous local vault blocker did not reproduce. |
| RC-2026-05-14-006 | Medium | Policy sync idempotency | After restart and successful Phase 2 verification, global `sync_resources` still returned `restart_required: true` for the already-applied `developer_instructions` policy. This can cause repeated restart prompts even when the policy is already active. |

## Restart Checkpoint

Case C0-2 Phase 1 and Phase 2 are complete. The restart checkpoint at `~/.codex/release-check-checkpoint.md` was deleted after successful Phase 2 verification.

Phase 2 verified that Codex applies the injected CSP routing policy by calling `manage_subscription(list)` before task-specific tools for both:

| Trigger | Expected result |
|---|---|
| `帮我 review 一下这个 MR` | `manage_subscription(list)` then `resolve_prompt_content(zoom-code-review)` |
| `小助手，帮我出个包` | `manage_subscription(list)` then `resolve_prompt_content(zoom-build)` |

## Current State Restoration

Temporary resources subscribed during C4 (`changelog-nex`, `dir-to-zoomdoc`, `hybrid-jssdk-docs`) were unsubscribed and local files removed. The final subscription list matches the initial 14-resource snapshot. Default test resources (`zoom-code-review`, `zoom-build`, `acm`) are present in the subscription list again. `zoom-build` Codex local files currently exist for post-restart verification.
