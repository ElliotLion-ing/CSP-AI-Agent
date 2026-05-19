# CSP AI Agent Release Check Report (Codex)

- 执行时间：2026-05-19 14:03:51 CST - 2026-05-19 14:10:50 CST
- 执行环境：Codex CLI（Streamable HTTP `/mcp`）
- Checklist 版本：`Test/Release Check/release-check-checklist.md`（v1.4.0）
- 结论：本轮存在关键失败，**不满足发布门禁**

## 订阅快照

- 起始快照：17 subscriptions
- 收尾恢复后：17 subscriptions（与快照一致）

## Case 执行结果

| Case | 结果 | 说明 |
|---|---|---|
| C0-1 config.toml MCP 配置验证 | PASS | `~/.codex/config.toml` 中 `csp-ai-agent` 配置、URL 与 enabled 状态正常。 |
| C0-2 Phase 1 policy 注入写入检查点 | PASS | `sync_resources(incremental, global)` 返回 `merge_toml`（developer_instructions）且提示 restart_required。 |
| C0-2 Phase 2 重启后自动生效闭环 | PASS | 补跑时间 2026-05-19 14:18 CST：`developer_instructions` 已存在且指向 `~/.csp-ai-agent/codex/csp-routing-policy.md`；策略文件包含“先 `manage_subscription(list)` 再 `resolve_prompt_content`”规则，实测链路按此执行成功。 |
| C0-3 本地 skill 落地（Codex 路径） | PASS | `zoom-build` 文件落地到 `~/.csp-ai-agent/codex/skills/zoom-build/`，脚本权限正常（`test-all.sh` 为可执行）。 |
| C1 全量 incremental sync | PASS | `sync_resources(mode=incremental, scope=global)` 成功，`health_score=100`。 |
| C2 单资源 sync | PASS | 对 `zoom-code-review` 使用 scoped `resource_ids` 同步，返回仅目标资源动作。 |
| C3 复杂 skill scoped sync（zoom-build） | PASS | 对 `zoom-build` scoped sync 成功，返回目标资源 local actions。 |
| C4 搜索→订阅→刷新 | PASS（替代目标） | checklist 中优先目标（hang/zoom-jira/zoom-doc）已预订阅；改用未订阅资源验证订阅链路，单订阅/多订阅均为 scoped 行为。 |
| C5 取消订阅→Prompt 移除→文件清理 | FAIL | `unsubscribe(zoom-code-review/zoom-build)` 后，本地目录与 manifest 未自动删除。 |
| C6 模糊调用路由（订阅优先→fallback） | PASS（部分） | 已验证“先 list 再 resolve_prompt_content”命中订阅路径；未完整演练真实 helper fallback 执行。 |
| C7 Telemetry 计数递增 | FAIL | 调用 `resolve_prompt_content(zoom-code-review)` 前后 `query_usage_stats` 计数未变化（均为 3）。 |
| C8 本地 vs 远端 Git 内容一致性 | BLOCKED | 本轮未执行 helper-gitlab 远端逐项对比。 |
| C9 退订 MCP 资源后本地配置清理 | FAIL | `unsubscribe(acm)` 返回 `remove_toml_entry` action，但 `~/.codex/config.toml` 中 `acm/acm-dev` 条目仍存在。 |
| C10 winzr md 引用懒加载链路 | PASS（核心链路） | `resolve_prompt_content(resource_id)` 中出现 `[MANDATORY] resolve_prompt_content(resource_path)`；`resource_path=reference.md` 调用成功并返回内容。 |

## 关键失败与风险

1. `unsubscribe` 后本地清理未自动落地（C5/C9 失败）  
   - 现象：服务端返回 `local_actions_required`，但本地文件/TOML 未被自动执行清理。  
   - 风险：用户误以为已退订，实际本地仍残留资源与配置，可能导致行为漂移。

2. telemetry 计数未随 resolve 增长（C7 失败）  
   - 现象：同一时段计数保持不变。  
   - 风险：发布后无法可靠审计资源实际调用量。

3. C0-2 Phase 2 未闭环（BLOCKED）  
   - 需要重启后的新会话复测 policy 自动注入生效路径。

## 本轮执行证据摘要

- `sync_resources(incremental, global)`：`health_score=100`，成功。
- `zoom-build` 本地校验：`scripts/`、`teams/` 存在；`test-all.sh` 为 `-rwxr-xr-x`。
- `unsubscribe(zoom-build/zoom-code-review/acm)`：返回了删除 action，但本地残留（失败）。
- `winzr-cpp-expert`：主 prompt 包含 `[MANDATORY]` 的 `resolve_prompt_content(resource_path)`；`reference.md` 懒加载成功。

## 收尾恢复状态

- 通过 batch unsubscribe + batch subscribe 恢复到起始 17 subscriptions。
- 当前订阅列表与起始快照一致。
- 注意：尽管订阅数量恢复，`unsubscribe` 本地动作自动执行问题仍存在（见 C5/C9）。
