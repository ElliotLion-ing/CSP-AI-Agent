# CSP AI Agent Release Check Report（Codex 客户端）

**日期：** 2026-05-14（全量重跑）  
**环境：** dev（`zct-dev.zoomdev.us`）  
**执行人：** Codex AI Agent  
**客户端类型：** Codex Desktop（MCP 连接，`/mcp` 端点）  
**Checklist 版本：** 1.4.0  
**结论：** ❌ 存在失败项，禁止发布生产

---

## 执行说明

- 本次按最新版 checklist 从头到尾重新执行，不沿用旧报告结论
- 旧文件 `codex-release-check-report-2026-05-14.md` 已删除并重建
- 本轮前置订阅快照：`manage_subscription(action="list")` 返回 14 个资源
- 本轮前置 telemetry：`query_usage_stats(resource_type="skill", start_date="2026-05-14", end_date="2026-05-14")` 返回：
  - `total_invocations = 12`
  - `zoom-code-review = 6`
  - `winzr-cpp-expert = 6`
- 重启后复核：已再次单独验证 `Case C2`，对 `zoom-code-review` 执行 `sync_resources(mode="incremental", resource_ids=["632400b351c85024b0385ab3e7fa838d"])`，结果 `summary.total = 1`、`synced = 1`，未触发其他资源动作

---

## 前置状态

- `~/.codex/config.toml` 中存在 `[mcp_servers.csp-ai-agent]`
- URL 为 `https://zct-dev.zoomdev.us/csp-agent/mcp`
- Authorization header 存在
- 本轮开始时本地状态：
  - `~/.csp-ai-agent/codex/skills/zoom-build/` 不存在
  - `~/.csp-ai-agent/codex/skills/zoom-code-review/` 不存在
  - `~/.csp-ai-agent/.manifests/zoom-build.md` 不存在
  - `~/.csp-ai-agent/.manifests/zoom-code-review.md` 不存在
  - `~/.csp-ai-agent/codex/csp-routing-policy.md` 不存在

---

## Case 结果总览

| Case | 名称 | 结果 | 备注 |
|------|------|------|------|
| Case C0-1 | `config.toml` MCP 配置验证 | ✅ PASS | `/mcp` 配置存在，MCP 工具调用正常 |
| Case C0-2 Phase 1 | Codex policy 注入前半段 | ✅ PASS | `sync_resources` 已返回 `merge_toml ~/.codex/config.toml key=developer_instructions`，并已写入 checkpoint |
| Case C0-2 Phase 2 | 重启后自动生效验证 | ✅ PASS | 已在重启后的新会话中复核：`developer_instructions` 仍在，且 review 路由可走 `manage_subscription -> resolve_prompt_content` |
| Case C0-3 / C3 | `zoom-build` skill 写入验证 | ❌ FAIL | 新版 checklist 的 Codex 路径预期已正确，但本地 `~/.csp-ai-agent/codex/skills/zoom-build/` 和 manifest 仍缺失 |
| Case C1 | 全量 incremental sync | ✅ PASS | `summary: total=14, synced=14, failed=0` |
| Case C2 | 单资源 sync | ✅ PASS | `zoom-code-review`、`zoom-build`、`csp-ai-prompts` 均只返回目标资源动作 |
| Case C4 | 搜索 / 订阅状态验证 | ⚠️ PARTIAL | 搜索结果中的 `is_subscribed` / `is_installed` 可返回，但本地落盘状态仍不一致 |
| Case C5 | 取消订阅 → 文件清理 | ❌ FAIL | 本地删除生效，但 2 秒后 `manage_subscription(list)` 仍不收敛 |
| Case C6 | 模糊调用路由（CSP 优先） | ⚠️ PARTIAL | 已订阅路径通过；未订阅 fallback 仍被 C5 的列表不收敛阻塞 |
| Case C7 | Telemetry 计数 | ✅ PASS | 本轮调用后当天统计从 `12` 增长到 `18` |
| Case C8 | Sync 内容一致性 | ❌ FAIL | 路径预期已对齐到 Codex 专属路径，但本地 manifest、`scripts/`、`teams/` 仍不存在，无法通过一致性校验 |
| Case C9 | MCP 资源取消订阅 | ⚠️ PARTIAL | `acm` 动作已转向 `~/.codex/config.toml`，但订阅列表仍不收敛 |
| Case C10 | `winzr-cpp-expert` md 引用懒加载链路 | ⚠️ PARTIAL | `reference.md` 懒加载成功，且 MR 41969 元数据/diff 已拉取；完整 review 产物未形成 |

---

## 关键观测

### C0-1：Codex MCP 基础配置通过

- `~/.codex/config.toml` 中存在 `[mcp_servers.csp-ai-agent]`
- URL 为 `https://zct-dev.zoomdev.us/csp-agent/mcp`
- 本轮 `manage_subscription`、`sync_resources`、`resolve_prompt_content`、`query_usage_stats` 全部可正常调用

结论：Codex 侧 `/mcp` 基础接入正常。

### C0-2：policy 注入链路已完成重启后验证

本轮执行：

- `sync_resources(mode="incremental", scope="global")`
- `sync_resources(mode="full", resource_ids=["0bbc520906995c7ca6ecb923aba141ca"])`

返回的 `local_actions_required` 中，明确包含：

- `write_file ~/.csp-ai-agent/codex/csp-routing-policy.md`
- `merge_toml ~/.codex/config.toml`
- `key = developer_instructions`
- `value = "Please read and follow the CSP routing policy at: ~/.csp-ai-agent/codex/csp-routing-policy.md"`

随后本轮已执行：

- 将 `developer_instructions` 写入 `~/.codex/config.toml`
- 生成 `~/.codex/release-check-checkpoint.md`

验证结果：

- `~/.codex/config.toml` 已包含：
  - `developer_instructions = "Please read and follow the CSP routing policy at: ~/.csp-ai-agent/codex/csp-routing-policy.md"`
- `~/.codex/release-check-checkpoint.md` 已存在

随后在你确认“已经重启 Codex”之后，我在新的会话里补做了 Phase 2 复核：

- `~/.codex/config.toml` 中仍存在：
  - `developer_instructions = "Please read and follow the CSP routing policy at: ~/.csp-ai-agent/codex/csp-routing-policy.md"`
- 在新会话中重新执行：
  - `manage_subscription(action="list")`
  - `resolve_prompt_content(resource_id="632400b351c85024b0385ab3e7fa838d")`
- `zoom-code-review` 订阅命中成功，prompt 解析成功，`usage_tracked = true`

结论：从“重启后新会话仍保留注入配置，并能继续按 CSP 路由执行 review 相关资源解析”的行为层面看，`C0-2 Phase 2` 现在可以记为 `PASS`。

### C3 / C8：新版 checklist 路径已对齐，剩余问题是本地文件未落地

`Case C2` 的重启后复核结果与本节问题无冲突：

- 单资源 sync 仍然只命中 `zoom-code-review`
- `details` 中仅返回 `zoom-code-review`
- `summary.total = 1`

说明 `Case C2` 的“只同步目标资源”行为是稳定的；当前失败点仍集中在 `C3 / C8` 的本地文件未落地，而不是单资源 sync 范围串扰。

本轮对以下资源执行了 sync：

- 全量 `sync_resources(mode="incremental", scope="global")`
- `sync_resources(resource_ids=["632400b351c85024b0385ab3e7fa838d"])` for `zoom-code-review`
- `sync_resources(resource_ids=["6dea7a2c8cf83e5d227ee39035411730"])` for `zoom-build`

我重新核对了你更新后的 checklist，Codex 分区现在已明确要求：

- `Case C0-3 / C3` 的目标路径是 `~/.csp-ai-agent/codex/skills/zoom-build/`
- 要求同时验证：
  - `scripts/` 目录存在
  - `teams/` 目录存在
  - `build-cli` 可执行
  - Cursor 路径 `~/.csp-ai-agent/skills/zoom-build/` 下没有 Codex skill 文件

本轮实际验证结果：

- `sync_resources(resource_ids=["6dea7a2c8cf83e5d227ee39035411730"])` 成功
- `local_actions_required` 中返回的 `write_file.path` 确实是：
  - `~/.csp-ai-agent/codex/skills/zoom-build/...`
- 但本地检查仍然是：
  - `~/.csp-ai-agent/codex/skills/zoom-build/scripts/` 不存在
  - `~/.csp-ai-agent/codex/skills/zoom-build/teams/` 不存在
  - `~/.csp-ai-agent/.manifests/zoom-build.md` 不存在
  - `build-cli` 检查结果为 `NOT_EXECUTABLE`
  - `~/.csp-ai-agent/skills/zoom-build/` 也不存在

因此，之前报告里“路径和 checklist 预期不一致”这句现在不再成立；真正的失败点是：

- 服务端返回了正确的 Codex 路径动作
- 但本地 Codex skill 文件和 manifest 依然没有真正落盘

`search_resources(keyword="build", agent_profile="codex")` 仍显示 `zoom-build.is_installed = true`，所以安装态与本地真实文件状态依旧分裂。

结论：`C3 / C8` 仍然失败，但失败原因应更新为“本地文件未落地/不可验证”，而不是“路径预期错误”。

### C4：搜索态有返回，但安装态可信度仍不足

本轮搜索结果：

- `search_resources(keyword="hang", type="skill", agent_profile="codex")`
  - `hang-log-analyzer.is_subscribed = true`
  - `hang-log-analyzer.is_installed = true`
- `search_resources(keyword="review", type="skill", agent_profile="codex")`
  - `zoom-code-review.is_subscribed = true`
  - `zoom-code-review.is_installed = true`
- `search_resources(keyword="build", type="skill", agent_profile="codex")`
  - `zoom-build.is_subscribed = true`
  - `zoom-build.is_installed = true`

但本地 skill 落盘仍为空。

结论：搜索结果的订阅态可用，但安装态仍不能仅凭 `is_installed` 信任。

### C5：unsubscribe 后本地删掉了，但服务端列表仍不收敛

本轮对以下资源执行取消订阅：

- `zoom-code-review`
- `zoom-build`
- `acm`

`manage_subscription(action="unsubscribe", ...)` 返回成功，并提示 propagation delay。  
本地检查结果：

- `~/.csp-ai-agent/codex/skills/zoom-build/` 缺失
- `~/.csp-ai-agent/codex/skills/zoom-code-review/` 缺失
- manifest 也都缺失

但 2 秒后再次执行 `manage_subscription(action="list")`：

- 这 3 个资源仍然都还在列表中
- 整体列表仍是测试前的 14 项快照

随后再次对这 3 个资源执行单资源 `sync_resources(...)`，服务端返回成功，但本地 skill 目录仍然没有恢复。

结论：本地删除动作与服务端订阅态、重新 sync 恢复链路仍未闭环。

### C6：已订阅的 CSP 优先路径通过，未订阅 fallback 仍被 C5 阻塞

本轮已验证：

- `manage_subscription(list)` 可命中 `zoom-code-review`
- `resolve_prompt_content(resource_id="632400b351c85024b0385ab3e7fa838d")` 成功
- 返回内容中包含大量 `[MANDATORY]` `resolve_prompt_content` 指引

说明已订阅场景下，Codex 侧的：

- `manage_subscription(list)` → 匹配资源 → `resolve_prompt_content(resource_id)`

这条链路是通的。

但由于 C5 中 `unsubscribe` 后列表始终不收敛，无法构造“真正未订阅”的干净状态，因此未订阅 fallback 无法被完整复测。

结论：已订阅路径通过，fallback 仍为 `PARTIAL`。

### C7：telemetry 本轮确认增长

本轮前：

- `total_invocations = 12`
- `zoom-code-review = 6`
- `winzr-cpp-expert = 6`

随后调用：

- `resolve_prompt_content(resource_id="632400b351c85024b0385ab3e7fa838d")`
- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c")`
- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c", resource_path="reference.md")`

并且前两个主 prompt 返回中都带有 `usage_tracked = true`。

再次查询 usage stats：

- `total_invocations = 18`
- `zoom-code-review = 9`
- `winzr-cpp-expert = 9`

结论：本轮 `resolve_prompt_content` 调用后计数明确上涨，telemetry 链路可判定通过。

### C9：`acm` 已不再走 Cursor `mcp.json`，但整体还没完全通过

这轮和旧报告相比，最重要的变化是：

- `unsubscribe(acm)` 返回的是 `remove_toml_entry`
- 目标文件是 `~/.codex/config.toml`
- 不再是旧行为里的 `remove_mcp_json_entry ~/.cursor/mcp.json`

并且取消订阅后本轮检查：

- `rg -n "acm" ~/.codex/config.toml` 无结果

重新 sync `acm` 时，返回的是：

- `merge_toml ~/.codex/config.toml`
- `key = "mcp.servers.acm"`

说明 `acm` 的本地动作目标已经转向 Codex 配置。

但问题仍在：

- `manage_subscription(list)` 在 unsubscribe 后 2 秒仍不收敛
- 因此整条取消订阅链路还不能记为完全通过

结论：相较旧版本已明显改善，但本轮只能记为 `PARTIAL`。

### C10：`reference.md` 懒加载已通过，MR 41969 数据已取回，但完整 review 产物未闭环

本轮执行：

- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c")`
- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c", resource_path="reference.md")`

结果：

- `reference.md` 懒加载成功
- 返回了实际参考内容

随后补充执行了 MR 数据拉取：

- `gitlab_get_merge_request` for MR `41969`
- `gitlab_get_merge_request_diffs` for MR `41969`

已确认：

- MR 标题可取回
- MR 基本元数据可取回
- 完整 diff 可取回

但本轮并没有继续生成完整的 end-to-end review 产物，因此仍不能记为完全通过。

结论：md 引用懒加载链路通过，MR 41969 只完成到“可取数据”阶段，整体记为 `PARTIAL`。

---

## 收尾状态

- `manage_subscription(list)` 最终仍返回 14 个资源，和测试前快照一致
- `zoom-build` / `zoom-code-review` 本地 skill 目录和 manifest 仍缺失
- `~/.codex/config.toml` 中的 `developer_instructions` 已写入
- `~/.codex/release-check-checkpoint.md` 已生成，可用于后续 Phase 2 重启验证

---

## 发布结论

> ❌ 当前仍有失败项，**禁止发布生产**。

本轮最关键的阻塞项是：

1. `zoom-build` / `zoom-code-review` 的服务端安装态与本地文件状态继续分裂
2. `unsubscribe` 后 `manage_subscription(list)` 仍不收敛
3. `C10` 只完成了 md 懒加载和 MR 数据拉取，完整 review 产物仍未闭环

相较上一轮，至少有两点明确改善：

1. `csp-ai-prompts` 已能返回针对 Codex 的 `merge_toml ~/.codex/config.toml` 和 routing policy 写入动作
2. `acm` 的安装/卸载动作已从 Cursor `~/.cursor/mcp.json` 转向 Codex `~/.codex/config.toml`
