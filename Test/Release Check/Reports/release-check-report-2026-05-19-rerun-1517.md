# Codex Release Check Report (Rerun)

- Date: 2026-05-19
- Timezone: Asia/Shanghai
- Run window: ~15:03 - 15:17
- Scope: Part B (Codex) C0-2 Phase 2 onward, then full C1-C10 completion/verification
- Checklist: `Test/Release Check/release-check-checklist.md` (latest)

## 1) 订阅快照

- Baseline (`manage_subscription:list`): 18 visible subscriptions (message: 2 locally unsubscribed defaults hidden)
- End state: restored to same 18-item baseline

## 2) Case 结果总览（Codex）

| Case | Result | Key Evidence |
|---|---|---|
| C0-1 | PASS | `~/.codex/config.toml` has `[mcp_servers.csp-ai-agent]`, `/mcp` endpoint, Authorization header |
| C0-2 Phase 1 | PASS | `sync_resources(incremental,global)` returned `merge_toml` for `developer_instructions` |
| C0-2 Phase 2 | PASS | restart后链路可继续；后续多次调用均先走 CSP subscription check |
| C0-3 | PASS | `zoom-build` scoped sync success; files landed under `~/.csp-ai-agent/codex/skills/zoom-build` |
| C1 | PASS | global incremental sync success (`health_score=100`) |
| C2 | PASS | single-resource scoped sync success |
| C3 | PASS | complex skill scoped sync success |
| C4 | PASS | search→subscribe path works; scoped sync behavior verified |
| C5 | FAIL | unsubscribe returns delete actions, but local skill/manifests not immediately removed |
| C6 | PASS | subscribed route uses CSP first; unsubscribed path falls back |
| C7 | PASS | telemetry counter increased after `resolve_prompt_content` (codex profile query path used) |
| C8 | PASS* | local-vs-server consistency validated by server payload + local FS (see note) |
| C9 | FAIL | unsubscribe `acm` returns `remove_toml_entry`, but `[mcp_servers.acm]` and `[mcp_servers.acm-dev]` remained |
| C10-1 | PASS | `winzr-cpp-expert` subscribed |
| C10-2 | PASS | SKILL content contains `[MANDATORY]` + `resolve_prompt_content` + correct `resource_path` |
| C10-3 | PASS | `resolve_prompt_content(resource_path=\"reference.md\")` success, content non-empty |
| C10-4 | PASS (retried) | CSP-first chain completed; `helper` fetched MR `main/zoomrooms!41969` metadata and raw diff, and a concrete review finding was produced from the loaded `reference.md` standards |

## 3) 关键明细

### C8 一致性对比（本地 vs 服务端内容）

- Local:
  - manifest path: `~/.csp-ai-agent/.manifests/zoom-build.md`
  - `version: 3.3.0`
  - `manifest_lines: 305`
  - `scripts_count: 9`
  - `teams_count: 7`
  - `build-cli_size: 44814`
- Server-side evidence:
  - scoped `sync_resources` returned zoom-build payload with same manifest/version lineage
  - earlier direct file pull path unavailable in this run because shell `helper` became vault-locked

> Note: C8 was completed with server payload + local landed files. Direct GitLab tree API compare in this run was blocked by helper vault state.

### C9 失败证据

1. `manage_subscription(unsubscribe, acm)` returned:
   - `remove_toml_entry` for `acm-dev`
   - `remove_toml_entry` for `acm`
2. Post-check still shows:
   - `[mcp_servers.acm-dev]`
   - `[mcp_servers.acm]`
3. Therefore: local config cleanup is not actually applied during unsubscribe path.

### C10 重试结果

- C10-1/2/3 remained PASS.
- Retried C10-4 on 2026-05-19 and the previous shell vault blocker did not reproduce.
- End-to-end chain executed as required:
  - `manage_subscription(action: list)` confirmed `winzr-cpp-expert`
  - `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c")` returned the main SKILL with `[MANDATORY]` lazy-load instruction
  - `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c", resource_path="reference.md")` returned the C++ review standards
  - `helper tool run gitlab_get_merge_request --url "https://git.zoom.us/main/zoomrooms/-/merge_requests/41969"` succeeded
  - `helper tool run gitlab_get_merge_request_diffs --url "https://git.zoom.us/main/zoomrooms/-/merge_requests/41969"` succeeded
- Representative review finding:
  - `NewParticipantsContextMenuHelper.cpp` handles `MenuID_PUser_StopNotesTranscription` by directly calling `CAICompanionMgr::GetInstance().StopNotesTranscript(false, m_userID)` without checking return value or surfacing an error path, while the nearby resume path gates the action and notifies on failure. This violates the loaded `reference.md` guidance around explicit runtime checks and failure handling.

## 4) 收尾恢复结果

- `zoom-build`: unsubscribed back to baseline
- `acm`: re-subscribed back to baseline
- Final `manage_subscription:list`: back to 18 visible subscriptions, consistent with start snapshot

## 5) 当前阻塞项（需修复）

1. **C5**: unsubscribe local cleanup not executed (skill dir/manifest not removed immediately)
2. **C9**: unsubscribe mcp cleanup not executed (`remove_toml_entry` not applied to codex config)
