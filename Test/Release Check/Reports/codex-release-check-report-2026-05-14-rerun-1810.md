# Codex Release Check Report - 2026-05-14 Rerun 18:10

## Run Metadata

- Checklist: `Test/Release Check/release-check-checklist.md` v1.4.0
- Start time: 2026-05-14 18:10 CST
- Restart checkpoint: 2026-05-14 18:17 CST, after Case C0-2 Phase 1
- End time: 2026-05-14 18:32 CST
- Environment: Codex desktop, MCP server `https://zct-dev.zoomdev.us/csp-agent/mcp`
- Scope: Full checklist rerun from the beginning; continued from Case C0-2 Phase 2 after manual Codex restart
- Final status: PASS WITH ENVIRONMENT CAVEAT

Environment caveat: this run was executed from Codex, not Cursor UI. Cursor-only prompt refresh UI cannot be directly observed here, so those checks are validated through shared MCP behavior, returned local actions, and Codex-side file/config effects.

## Preflight

| Check | Result | Evidence |
| --- | --- | --- |
| CSP subscription priority check | PASS | First post-restart action was `manage_subscription(action=list)` before resolving task-specific resources |
| Baseline subscription list | PASS | Baseline list contains 14 resources after cleanup: policy rules, skills, command resources, and `acm` MCP |
| Report regeneration | PASS | Created a new report file for this run; previous reports were not edited |
| Worktree safety | PASS | Pre-existing untracked `.agents/` and `Docs/FeatureDocs/Codex-Hooks-Remote-Provisioning-Design.md` were not touched |

## Part A - Shared / Cursor Compatibility Cases

| Case | Result | Evidence |
| --- | --- | --- |
| Case 1: Initial subscription and sync baseline | PASS with environment caveat | `sync_resources(mode=incremental, scope=global)` returned `success=true`, `health_score=100`, `total=14`, `synced=14` |
| Case 2: Single resource scoped sync | PASS | Scoped sync for `zoom-code-review` returned exactly one resource detail and scoped local action path |
| Case 3: Complex skill local scripts | PASS | `zoom-build` materialized at Codex path `~/.csp-ai-agent/codex/skills/zoom-build`; `scripts/` has 9 files, `teams/` has 7 JSON files, `build-cli` is executable |
| Case 4: Search and subscribe | PASS | `search_resources(keyword=changelog)` returned `changelog-nex`; subscribe succeeded; duplicate subscribe for already subscribed resources was idempotent |
| Case 5: Unsubscribe and local cleanup | PASS | Unsubscribe of `zoom-code-review` and `zoom-build` returned delete actions; local Codex skill paths and manifests were removed; list hid both default resources through local override |
| Case 6: Unsubscribed resource fallback | PASS | After unsubscribe, subscription list did not include review/build resources, so stale local execution was not available |
| Case 7: Telemetry tracking | PASS | `resolve_prompt_content(zoom-code-review)` returned `usage_tracked=true`; `query_usage_stats(resource_type=skill, agent_profile=codex)` increased total skill invocations from 156 to 159 and echoed `agent_profile=codex` |
| Case 8: Re-subscribe complex skill restore | PASS | Re-subscribe plus scoped sync restored `zoom-code-review` and `zoom-build`; final cleanup restored the 14-resource baseline list |
| Case 9: MCP config uninstall cleanup | PASS | `acm` unsubscribe returned two `remove_toml_entry` actions for `acm-dev` and `acm`; after local action execution no `[mcp_servers.acm*]` sections remained; restore re-added both TOML sections |
| Case 10: Markdown reference lazy loading chain | PASS | `winzr-cpp-expert` main prompt contains mandatory `resolve_prompt_content(... resource_path="reference.md")`; resolving `reference.md` succeeded with `usage_tracked=false`; MR 41969 context and raw diff were fetched after CSP skill resolution |

## Part B - Codex Cases

| Case | Result | Evidence |
| --- | --- | --- |
| Case C0-1: Codex MCP config active | PASS | `~/.codex/config.toml` contains `[mcp_servers.csp-ai-agent]`, dev MCP URL, bearer auth header, and `enabled=true` |
| Case C0-2 Phase 1: Policy injection write path | PASS | `sync_resources(mode=incremental, scope=global)` returned policy `merge_toml` action and `restart_required=true` |
| Case C0-2 Phase 1: Policy file present | PASS | `~/.csp-ai-agent/codex/csp-routing-policy.md` exists and contains `Call manage_subscription(action: list) before using task-specific tools.` |
| Case C0-2 Phase 1: Codex config link present | PASS | `~/.codex/config.toml` contains `developer_instructions = "Please read and follow the CSP routing policy at: ~/.csp-ai-agent/codex/csp-routing-policy.md"` |
| Case C0-2 Phase 2: Post-restart auto policy behavior | PASS | After manual Codex restart, first action was `manage_subscription(action=list)`; `zoom-code-review` and `zoom-build` were resolved through CSP before helper/local paths |
| Case C0-3: Subscription list after restart | PASS | Post-restart list returned the expected baseline subscriptions; scoped `zoom-build` sync returned Codex local action path under `~/.csp-ai-agent/codex/skills/zoom-build` |
| Case C1: Full sync health | PASS | Incremental full sync returned `success=true`, `health_score=100`, `total=14`, `synced=14` |
| Case C2: Scoped sync | PASS | Scoped sync for `zoom-code-review` returned one resource only |
| Case C3: Codex complex skill local actions | PASS | `zoom-build` local actions target `~/.csp-ai-agent/codex/skills/zoom-build`; materialized file count is 24 excluding `SKILL.md`, `scripts/` count is 9, `teams/` count is 7 |
| Case C4: Search and subscribe | PASS | `changelog-nex` search and temporary subscribe succeeded; resource was removed during final cleanup |
| Case C5: Unsubscribe cleanup | PASS | Delete actions for skill directory and manifest were returned and executed for `zoom-code-review` / `zoom-build` |
| Case C6: Fallback after unsubscribe | PASS | Subscription list omitted unsubscribed resources after local override; no stale local skill path remained |
| Case C7: Telemetry and profile | PASS | Usage stats returned `agent_profile=codex`; total skill invocations increased from 156 to 159 |
| Case C8: Remote/local script consistency | PASS | `zoom-build` remote/local hashes matched: manifest `b6264038ef026ac9b768790ea1c0c711093fa4e20185d7fccc05438302776bb4`, `build-cli` `a8d2ddcbe19e2c3362060b1874021d8b772dde765c3d1daf756e5e5ff5267be5` |
| Case C9: Codex MCP TOML cleanup | PASS | Unsubscribe removed `acm-dev` and `acm` TOML sections; restore re-added `[mcp_servers.acm-dev]` and `[mcp_servers.acm]` |
| Case C10: md reference lazy loading and MR review | PASS | Main skill prompt no longer expands `reference.md` inline; lazy load returns full reference content; GitLab MR `main/zoomrooms!41969` metadata and raw diff were fetched after CSP resolution |

## C10 MR Review Evidence

- MR: `main/zoomrooms!41969`
- State: `merged`
- Source branch: `dev-feature-client-7.1.0-ZOOM-1103386`
- Target branch: `feature-client-7.1.0`
- Title: `ZOOM-1103386 [WinZR]ZoomRoom - In meeting notice and host controls for Voice...`
- Representative review finding: `CNewParticipantsContextMenuHelper::HandleMenuAction` directly calls `StopNotesTranscript(false, m_userID)` for `MenuID_PUser_StopNotesTranscription` without availability/failure handling, while the resume path has guard checks.

## Non-blocking Observations

- `sync_resources(mode=incremental, scope=global)` still returns `restart_required=true` when policy `developer_instructions` action is included, even when the config already contains the instruction. This did not block C0-2 Phase 2 because post-restart behavior was verified.
- `manage_subscription(subscribe)` for default/baseline resources can return `subscriptions=[]` while still clearing local unsubscribe overrides. Follow-up `sync_resources(resource_ids=[...])` and `manage_subscription(list)` confirmed restore behavior.

## Cleanup

- Removed temporary `changelog-nex` subscription and local files.
- Restored baseline subscription list to 14 resources.
- Restored `zoom-build` local Codex scripts and manifest after unsubscribe cleanup test.
- Restored `acm-dev` and `acm` MCP TOML sections.
- Removed restart checkpoint file `~/.codex/release-check-checkpoint.md`.

## Final Verdict

PASS WITH ENVIRONMENT CAVEAT. All Codex-specific cases C0-1 through C10 passed after manual restart. Shared Cursor compatibility cases passed at MCP/local-action level; Cursor UI-only refresh behavior remains outside direct Codex observation.
