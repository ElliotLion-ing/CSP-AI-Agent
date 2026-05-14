# Codex Release Check Report - 2026-05-14 Rerun 17:38

## Scope

- Checklist: `Test/Release Check/release-check-checklist.md` v1.4.0
- Environment: Codex Desktop, MCP endpoint `https://zct-dev.zoomdev.us/csp-agent/mcp`
- Trigger: new package deployed, full checklist rerun from the beginning, continued after mandatory Codex restart
- Final verdict: **FAIL**

## Baseline

| Item | Result | Evidence |
| --- | --- | --- |
| CSP subscription pre-check | PASS | `manage_subscription(list)` returned 14 baseline subscriptions |
| Codex MCP config | PASS | `~/.codex/config.toml` has `[mcp_servers.csp-ai-agent]`, `/mcp` URL, bearer auth, `enabled = true` |
| Policy injection file | PASS | `developer_instructions` points to `~/.csp-ai-agent/codex/csp-routing-policy.md`; policy file exists |
| Restart checkpoint | PASS | C0-2 Phase 1 wrote checkpoint; Phase 2 deleted it after restart validation |
| Final subscription restoration | PASS | Final `manage_subscription(list)` returned the original 14 baseline resources |

## Part A - Cursor Compatibility Cases

| Case | Status | Evidence / Notes |
| --- | --- | --- |
| Case 1: Sync all subscribed resources | PASS with caveat | `sync_resources(mode=incremental, scope=global, agent_profile=cursor)` returned success, total 14, synced 14, failed 0, health_score 100. Caveat: checklist expects unchanged resources to be `cached`, but server returned `synced` for all. |
| Case 2: Sync single resource | PASS | `sync_resources(resource_ids=[zoom-code-review], agent_profile=cursor)` returned exactly one synced resource. |
| Case 3: Complex skill local files | PASS | `zoom-build` local script/cache previously verified under Cursor path `~/.csp-ai-agent/skills/zoom-build`: scripts present, `build-cli` executable, teams JSON present, manifest version 3.3.0. |
| Case 4: Search and subscribe | PASS with caveat | Search/subscribe flow worked. Batch subscribe for already-subscribed resources returned 0, treated as idempotent. |
| Case 5: Unsubscribe cleanup | PASS | `zoom-code-review` and `zoom-build` unsubscribe returned delete local actions; local skill dirs/manifests were removed and verified missing. |
| Case 6: Prompt routing / fallback | PASS with caveat | After unsubscribe, review/build resources were hidden. Re-subscribing default skill exposed it in list, but `resolve_prompt_content` required explicit `sync_resources` before prompt registration recovered. |
| Case 7: Telemetry | PASS | `resolve_prompt_content(zoom-code-review)` returned `usage_tracked: true`; usage stats showed Codex profile counts. |
| Case 8: Local action consistency | PARTIAL | Remote GitLab comparison was later verified from Codex for key files, but Cursor-side full remote comparison was not directly re-run in this resumed phase. |
| Case 9: MCP resource install/uninstall | PASS | Cursor path was previously validated; later Codex C9 confirmed server now emits TOML actions for Codex. |
| Case 10: Markdown reference lazy loading | PASS | `winzr-cpp-expert` main prompt and `reference.md` lazy load worked; Codex C10 completed MR 41969 E2E evidence. |

## Part B - Codex Cases

| Case | Status | Evidence / Notes |
| --- | --- | --- |
| C0-1: Codex MCP config precheck | PASS | URL is `/mcp`, not `/sse`; bearer auth is present; server enabled. |
| C0-2 Phase 1: Policy injection setup | PASS | `sync_resources(mode=incremental, scope=global)` returned success, total 14, synced 14, failed 0, `restart_required: true`; local config had `developer_instructions`. |
| C0-2 Phase 2: Restart validation | PASS | After restart, the resumed session first called `manage_subscription(list)`, then resolved `zoom-code-review` and `zoom-build` via `resolve_prompt_content`; no helper/local fallback was used for routing. |
| C0-2 checkpoint cleanup | PASS | `~/.codex/release-check-checkpoint.md` deleted after Phase 2 success. |
| C0-3: Codex skill runtime local write | FAIL | `sync_resources(zoom-build)` returned Codex `write_file` actions, but filesystem verification showed `~/.csp-ai-agent/codex/skills/zoom-build/scripts`, `teams`, `build-cli`, and `.manifests/zoom-build.md` were not created. |
| C1: Sync all subscribed resources | PASS with caveat | `sync_resources(mode=incremental, scope=global)` returned success, total 14, synced 14, failed 0, health_score 100. Caveat: unchanged resources still reported as `synced` rather than `cached`. |
| C2: Sync single resource | PASS | `sync_resources(resource_ids=[zoom-code-review])` returned total 1, synced 1, failed 0, and local action scope only targeted `zoom-code-review`. |
| C3: Complex skill local files | FAIL | Same root cause as C0-3: `zoom-build` sync returned local actions but Codex did not apply them to `~/.csp-ai-agent/codex/skills/zoom-build`. |
| C4: Search and subscribe | PASS with caveat | `search_resources(keyword=changelog)` returned `changelog-nex`; subscribe succeeded. Batch subscribe for already-subscribed `zoom-jira`/`zoom-doc` returned 0 as idempotent. |
| C5: Unsubscribe cleanup | PASS | Unsubscribing `zoom-code-review` and `zoom-build` returned Codex delete actions; after executing them, both Codex skill dirs were missing. |
| C6: Fuzzy routing / fallback | PASS with caveat | After unsubscribe, list returned 13 subscriptions with hidden default overrides and no review/build. Re-subscribing restored list visibility, but immediate `resolve_prompt_content(zoom-code-review)` failed with `PROMPT_NOT_FOUND` until explicit `sync_resources` was run. |
| C7: Telemetry | PASS | Before/after usage stats increased from total 81 to 84; `zoom-code-review` increased from 39 to 42; `agent_profile` echoed `codex`; `resolve_prompt_content` returned `usage_tracked: true`. |
| C8: Sync content consistency | FAIL | Remote GitLab key files were fetched: `SKILL.md` size 18290/version 3.3.0, `client-android.json` size 4596, `build-cli` size 44814. Local Codex files were absent after sync, so local-vs-remote comparison could not pass. |
| C9: MCP resource uninstall | PASS with issue | `sync_resources(acm)` returned Codex `merge_toml` actions for `~/.codex/config.toml`; unsubscribe returned `remove_toml_entry` for `acm`, and `[mcp_servers.acm]` was removed. Issue: `[mcp_servers.acm-dev]` was created by sync but not returned for cleanup. |
| C10: winzr-cpp-expert lazy loading | PASS | `manage_subscription(list)` confirmed subscription; main prompt contained mandatory `resolve_prompt_content(resource_path="reference.md")`; `reference.md` resolved successfully from MCP. MR 41969 details and raw diff were fetched and reviewed using the CSP skill chain. |

## C10 MR 41969 Review Evidence

- MR: `main/zoomrooms!41969`, state `merged`, source `dev-feature-client-7.1.0-ZOOM-1103386`, target `feature-client-7.1.0`.
- Diff covered AI Companion Notes support across `AICompanionMgr`, participants UI, security dialog XML, notifications, SDK callback, and RoomRes assets.
- Review chain used CSP skill first: `manage_subscription(list)` -> `resolve_prompt_content(winzr-cpp-expert)` -> `resolve_prompt_content(resource_path=reference.md)` -> GitLab diff fetch.
- Sample review finding: newly added `CAICompanionMgr` methods such as `IsNotesTranscriptOpen`, `IsMeetingNotesEnabled`, `ResumeNotesTranscript`, and `StopNotesTranscript` are non-throwing wrappers over SDK state/action calls but are not marked `noexcept`, which conflicts with the reference rule requiring non-throwing functions to be marked `noexcept`.
- Sample review finding: `NewParticipantsContextMenuHelper::HandleMenuAction` checks availability before `ResumeNotesTranscript`, but `StopNotesTranscript(false, m_userID)` is issued directly; given the reference's safety-first rule, this path should verify current meeting/user capability or handle failure explicitly.

## Issues Observed

| ID | Severity | Issue | Impact |
| --- | --- | --- | --- |
| RC-2026-05-14-001 | Medium | Incremental sync returns `synced` for unchanged resources instead of `cached`. | Checklist cache semantics cannot be fully validated from summary even when sync succeeds. |
| RC-2026-05-14-002 | Medium | Re-subscribing default resources can return "subscribed 0" and still require explicit `sync_resources` before `resolve_prompt_content` works. | Agent must sync after re-subscribe; otherwise prompt lookup may fail with `PROMPT_NOT_FOUND`. |
| RC-2026-05-14-003 | High | Codex receives `write_file` local actions for complex skills but they are not applied to disk automatically in this environment. | C0-3/C3/C8 fail; Codex cannot reliably run complex local skills unless the agent manually executes all returned local actions. |
| RC-2026-05-14-004 | Medium | `acm` sync writes both `mcp_servers.acm-dev` and `mcp_servers.acm`, but unsubscribe only returns cleanup for `acm`. | Codex `config.toml` can retain stale `acm-dev` config after unsubscribe unless manually cleaned. |

## Restoration

- Restored subscription list to the 14 baseline resources.
- Removed temporary `changelog-nex` subscription and local Codex cache.
- Re-subscribed `acm` after C9; final list includes `acm`.
- Removed temporary `[mcp_servers.acm]` and stale `[mcp_servers.acm-dev]` from `~/.codex/config.toml`.
- Confirmed `~/.codex/release-check-checkpoint.md` is absent.

## Conclusion

This release check is **not production-ready**. Routing policy injection and C10 md lazy loading are now closed, and Codex C9 has moved to TOML actions. The remaining release blockers are Codex local action execution for complex skills and incomplete cleanup of the `acm-dev` TOML entry.
