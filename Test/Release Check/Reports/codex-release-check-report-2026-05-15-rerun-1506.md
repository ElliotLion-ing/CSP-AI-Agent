# Codex Release Check Report - 2026-05-15 Rerun 15:06

## Run Metadata

- Checklist: `Test/Release Check/release-check-checklist.md` v1.4.0
- Start time: 2026-05-15 15:06 CST
- Restart checkpoint: 2026-05-15 15:08 CST, after Case C0-2 Phase 1
- End time: 2026-05-15 15:23 CST
- Environment: Codex desktop, MCP server `https://zct-dev.zoomdev.us/csp-agent/mcp`
- Scope: Full checklist rerun from the beginning after new CSP AI Agent deployment
- Final status: PASS WITH ENVIRONMENT CAVEAT

Environment caveat: this run was executed from Codex. Cursor UI-only behavior such as visible prompt refresh/list-changed UI was validated through server action shape and local-action compatibility, not by operating Cursor itself.

## Preflight

| Check | Result | Evidence |
| --- | --- | --- |
| CSP subscription priority check | PASS | First action for this rerun was `manage_subscription(action=list)` before task-specific tool usage |
| Baseline subscription list | PASS | Subscription list returned 14 expected resources, including policy rules, skills, command resources, and `acm` MCP |
| Worktree safety | PASS | `git status --short` was clean before this rerun started |
| Report regeneration | PASS | Created this new 2026-05-15 report; previous reports were not edited |

## Part B - Codex Specific Cases

| Case | Result | Evidence |
| --- | --- | --- |
| C0-1: Codex MCP config active | PASS | `~/.codex/config.toml` contains `[mcp_servers.csp-ai-agent]`, URL `https://zct-dev.zoomdev.us/csp-agent/mcp`, bearer auth header, and `enabled = true` |
| C0-2 Phase 1: Policy injection write path | PASS | Full sync returned a `merge_toml` action for `developer_instructions` with `restart_required=true` |
| C0-2 Phase 1: Policy file present | PASS | `~/.csp-ai-agent/codex/csp-routing-policy.md` exists and contains required `manage_subscription(action: list)` and `resolve_prompt_content(...)` routing rules |
| C0-2 Phase 1: Config link present | PASS | `~/.codex/config.toml` contains `developer_instructions = "Please read and follow the CSP routing policy at: ~/.csp-ai-agent/codex/csp-routing-policy.md"` |
| C0-2 Phase 2: Post-restart auto policy behavior | PASS | After manual Codex restart, the first action was again `manage_subscription(action=list)`, then matching CSP resources were resolved before helper fallback |
| C0-2 Phase 2: Review/build trigger routing | PASS | `resolve_prompt_content` succeeded for `zoom-code-review` and `zoom-build`; no direct helper fallback was used before CSP resolution |
| C0-3: Subscription list after restart | PASS | Post-restart subscription list returned the expected baseline 14 resources |
| C1: Full sync health | PASS | `sync_resources(mode=incremental, scope=global)` returned `success=true`, `health_score=100`, `total=14`, `synced=14`, `failed=0` |
| C2: Scoped sync | PASS | Scoped sync for `zoom-code-review` returned `total=1`, `synced=1`, and only `zoom-code-review` local actions |
| C3: Complex skill local scripts | PASS | `zoom-build` scoped sync returned Codex local action paths under `~/.csp-ai-agent/codex/skills/zoom-build`; `scripts/` had 9 executable files and `teams/` had 7 JSON files |
| C4: Search and subscribe | PASS | `search_resources(keyword="changelog")` found `changelog-nex`; subscribe succeeded. Batch subscribe for already-subscribed `zoom-jira` and `zoom-doc` was idempotent |
| C5: Unsubscribe cleanup | PASS | Batch unsubscribe for `zoom-code-review` and `zoom-build` returned Codex delete actions; executing them removed both local skill directories and manifests |
| C6: Fallback after unsubscribe | PASS | After local unsubscribe override, `manage_subscription(list)` hid `zoom-code-review` and `zoom-build`; no matching CSP review skill was available, so fallback condition was valid |
| C7: Telemetry and profile | PASS | `query_usage_stats(resource_type=skill, agent_profile=codex)` returned `agent_profile="codex"`; after resolve, total invocations increased from 174 to 177 and `zoom-code-review` from 86 to 89 |
| C8: Remote/local script consistency | PASS | `zoom-build` package materialized to Codex path. Manifest hash `b6264038ef026ac9b768790ea1c0c711093fa4e20185d7fccc05438302776bb4`; `build-cli` hash `a8d2ddcbe19e2c3362060b1874021d8b772dde765c3d1daf756e5e5ff5267be5`; `client-android.json` hash `2feb0c87a6876350fb572fb56c0ed5275c4ca3c76e78f5864c12c9afa5212120` |
| C9: Codex MCP TOML cleanup | PASS | Unsubscribing `acm` returned `remove_toml_entry` actions for `acm-dev` and `acm`; sections were removed, then restored from structured sync actions |
| C10: Markdown reference lazy loading and MR review | PASS | `winzr-cpp-expert` main prompt returned a mandatory `resolve_prompt_content(..., resource_path="reference.md")` block; `reference.md` was loaded through MCP and then GitLab MR review was performed |

## Part A - Shared Cursor Compatibility Cases

| Case | Result | Evidence |
| --- | --- | --- |
| Case 1: Incremental/full sync | PASS | Shared `sync_resources` returned healthy aggregate status and no failed resources |
| Case 2: Scoped sync by resource ID | PASS | `zoom-code-review` scoped sync returned only that resource and its own local actions |
| Case 3: Complex skill local action shape | PASS | Server returned concrete local file actions for a complex skill. Codex paths were under `~/.csp-ai-agent/codex/skills/...`; no legacy Cursor path was required for Codex |
| Case 4: Search and subscribe | PASS | Search and subscribe APIs worked; already-subscribed resources behaved idempotently |
| Case 5: Unsubscribe cleanup | PASS | Server returned local delete actions and local unsubscribe override hid default resources from list results |
| Case 6: Fallback after unsubscribe | PASS | Once the CSP review skill was hidden, routing had no matching subscribed CSP resource and could fall back |
| Case 7: Telemetry | PASS | Prompt resolution recorded usage and stats reflected `agent_profile="codex"` |
| Case 8: Content consistency | PASS | Remote package content could be materialized locally with expected scripts, team configs, and manifest |
| Case 9: MCP config cleanup | PASS | `acm` unsubscribe emitted structured TOML cleanup actions; restore emitted structured TOML merge values |
| Case 10: Markdown reference lazy loading | PASS | Main skill content referenced `reference.md` through a mandatory MCP call block instead of relying on local file access |

## Regression Checks

| Regression | Result | Evidence |
| --- | --- | --- |
| `merge_toml` structured value bug | PASS | Scoped sync for `acm` returned `merge_toml.value` as TOML objects for `mcp_servers.acm-dev` and `mcp_servers.acm`, not escaped JSON strings |
| Codex policy path | PASS | Policy file path is `~/.csp-ai-agent/codex/csp-routing-policy.md`; config points to that path through `developer_instructions` |
| Codex skill path | PASS | Local skill files were written under `~/.csp-ai-agent/codex/skills/<skill-name>`; old Cursor path `~/.csp-ai-agent/skills/zoom-build` was absent and not required |
| Default subscription restore | PASS | After local unsubscribe override, re-subscribe restored list visibility. A scoped `sync_resources` was required before resolving the restored prompt registry entry |

## C10 MR Review Evidence

- CSP resource used first: `winzr-cpp-expert` (`009157d8ed498e93c0dbdbdbd47ae40c`).
- Lazy reference loaded through MCP: `resource_path="reference.md"`.
- GitLab MR reviewed after CSP resolution: `main/zoomrooms!41969`.
- Representative finding: `NewParticipantsContextMenuHelper.cpp` handles `MenuID_PUser_StopNotesTranscription` by directly calling `CAICompanionMgr::GetInstance().StopNotesTranscript(false, m_userID)` without checking return value or surfacing an error path, while the nearby transcription permission flow includes restriction checks and notification handling. This violates the loaded reference guidance around safe error handling and avoiding silent failures.

## Cleanup

| Item | Result | Evidence |
| --- | --- | --- |
| Temporary `changelog-nex` subscription | PASS | Unsubscribed and removed `~/.csp-ai-agent/codex/skills/changelog-nex` plus its manifest |
| Baseline subscription list restored | PASS | Final `manage_subscription(action=list)` returned 14 subscriptions and no `changelog-nex` |
| `acm` restored | PASS | Final `~/.codex/config.toml` contains `[mcp_servers.acm-dev]` and `[mcp_servers.acm]` |
| Restart checkpoint removed | PASS | `~/.codex/release-check-checkpoint.md` no longer exists |

## Final Verdict

All checklist cases executed from the beginning and passed in the Codex environment. No release-blocking bug was found in this rerun.

Non-blocking observation: after locally unsubscribing and restoring default baseline skills, the prompt registry required a scoped `sync_resources` before `resolve_prompt_content` succeeded again. This was recoverable and did not block the release check.
