# Release Check Report - Codex Rerun

**Date:** 2026-05-19 17:05:50 CST  
**Client:** Codex  
**Scope:** Continue from Case C0-2 Phase 2 and cover C0/C1-C10  
**Checklist:** `Test/Release Check/release-check-checklist.md`  
**Overall Result:** FAIL

## Summary

本轮覆盖了 Codex C0 专项与 C1-C10。C5 与 C9 的本轮回归均通过，且重点验证了本次修复要求的本地清理 action：

- C5：取消订阅 `zoom-code-review` / `zoom-build` 后返回 `delete_file` actions，包含 `local_actions_block_completion=true`，执行后本地 Codex skill 目录被删除。
- C9：取消订阅 `acm` 后返回 Codex 专用 `remove_toml_entry` actions，目标为 `~/.codex/config.toml` 中的 `acm-dev` 与 `acm`，执行后配置项消失，收尾阶段已恢复。

本轮未达到发布门禁通过条件，原因是 C8 未能完成 PASS：C5 清理后，`zoom-build` 的恢复 sync 返回了大量 `write_file` local actions，但这些 actions 没有实际全部落盘；最终验证时 `~/.csp-ai-agent/codex/skills/zoom-build` 不存在，因此无法完成本地 vs 远端内容一致性对比。

## Environment Snapshot

- Initial subscription count: 20
- Final subscription count: 20
- Transport: Codex Streamable HTTP via `~/.codex/config.toml`
- Endpoint: `/mcp`
- CSP policy: `~/.csp-ai-agent/codex/csp-routing-policy.md`
- C0-2 checkpoint: `~/.codex/release-check-checkpoint.md`

## Case Results

| Case | Result | Evidence |
|------|--------|----------|
| C0-1 | PASS | `~/.codex/config.toml` contains `[mcp_servers.csp-ai-agent]`; MCP tools callable via Codex. |
| C0-2 Phase 1 | PASS | Pre-restart sync injected `developer_instructions`; checkpoint existed with `restart_required=true`, 20/20 resources synced, health score 100. |
| C0-2 Phase 2 | PASS | Read checkpoint after restart, verified policy file content, resolved `zoom-code-review` and `zoom-build`, then removed checkpoint. |
| C0-3 | PASS | `zoom-build` sync returned 16 `write_file` actions; earlier filesystem verification showed Codex isolated path under `~/.csp-ai-agent/codex/skills/zoom-build`, executable `build-cli`, and no Cursor path usage. |
| C1 | PASS | Incremental full sync evidence reused from C0-2 Phase 1: `mode=incremental`, no full sync, 20/20 synced. |
| C2 | PASS | Single-resource sync for `zoom-code-review` used only resource id `632400b351c85024b0385ab3e7fa838d`; check mode returned cached. |
| C3 | PASS | Complex skill `zoom-build` sync was scoped to resource id `6dea7a2c8cf83e5d227ee39035411730`; scripts/teams files were present before C5 cleanup. |
| C4 | PASS | Search found unsubscribed doc resources; subscribed `doc-nex`, then batch subscribed `api-doc-generator` and `create-module-doc`; scoped sync only affected requested ids. |
| C5 | PASS | Unsubscribe `zoom-code-review` and `zoom-build` returned 2 `delete_file` actions each with `local_actions_block_completion=true`; executed deletes and verified both Codex skill dirs removed. |
| C6 | PASS | Unsubscribed path showed review resource absent and requires fallback; resubscribed `zoom-code-review`, then `resolve_prompt_content` succeeded before any GitLab helper usage. |
| C7 | PASS | `resolve_prompt_content` for `zoom-code-review` succeeded; `query_usage_stats(agent_profile="codex")` returned `agent_profile=codex` and count increased to 40. |
| C8 | FAIL | After C5 cleanup and restore attempt, final check found `~/.csp-ai-agent/codex/skills/zoom-build` missing, so local manifest/scripts/teams values could not be compared to remote Git. |
| C9 | PASS | `acm` unsubscribe returned `remove_toml_entry` for `~/.codex/config.toml` keys `mcp_servers.acm-dev` and `mcp_servers.acm`; after execution, both sections and URLs were absent. |
| C10 | PASS | `winzr-cpp-expert` main prompt contained generated `[MANDATORY] resolve_prompt_content` block for `reference.md`; lazy resource call succeeded with real reference content; MR 41969 metadata, diff, and JIRA `ZOOM-1103386` context were fetched after CSP skill resolution. |

## Key Bug Regression Notes

### C5

Observed behavior matches the intended fix:

- `manage_subscription(unsubscribe, zoom-code-review)` returned `delete_file` actions for `~/.csp-ai-agent/codex/skills/zoom-code-review` and its manifest.
- `manage_subscription(unsubscribe, zoom-build)` returned `delete_file` actions for `~/.csp-ai-agent/codex/skills/zoom-build` and its manifest.
- Both responses included `local_actions_block_completion=true`, preventing the agent from marking cleanup complete before local actions are executed.

### C9

Observed behavior matches the intended Codex-specific fix:

- Before unsubscribe, `~/.codex/config.toml` contained `[mcp_servers.acm-dev]` and `[mcp_servers.acm]`.
- Unsubscribe returned `remove_toml_entry`, not Cursor `remove_mcp_json_entry`.
- After executing the returned actions, `rg` found no `acm`, `acm-dev`, `zct.zoomdev.us/mcp`, or `zct-dev.zoomdev.us/mcp` entries.
- Cleanup restored both TOML sections via subscribe `merge_toml` actions.

## Cleanup

- Temporary C4 subscriptions removed: `doc-nex`, `api-doc-generator`, `create-module-doc`.
- Final subscription list restored to 20 entries.
- `acm` subscription restored and `~/.codex/config.toml` again contains `[mcp_servers.acm-dev]` and `[mcp_servers.acm]`.

## Blocking Issue

C8 remains blocking for release gate in this run. The immediate issue is not C5/C9 cleanup; those passed. The blocker is that after C5 deletes `zoom-build`, the subsequent restore path still returns pending `write_file` local actions that must be executed before filesystem validation. Since the final local `zoom-build` directory is missing, this run cannot prove sync content consistency.
