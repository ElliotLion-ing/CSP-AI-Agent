# CSP AI Agent Release Check Report（Codex 客户端）

**日期：** 2026-05-09（新一轮重新部署后复测）  
**环境：** dev（zct-dev.zoomdev.us）  
**执行人：** Codex AI Agent  
**客户端类型：** Codex Desktop（MCP 连接，`/mcp` 端点）  
**Checklist 版本：** 1.4.0  
**结论：** ❌ 存在失败项，禁止发布生产

---

## 前置状态

- `manage_subscription(action="list")` 返回 14 个订阅资源
- `~/.codex/config.toml` 中存在 `[mcp_servers.csp-ai-agent]`
- URL 为 `https://zct-dev.zoomdev.us/csp-agent/mcp`
- Authorization header 存在

---

## Case 结果总览

| Case | 名称 | 结果 | 备注 |
|------|------|------|------|
| Case C0-1 | `config.toml` MCP 配置验证 | ✅ PASS | `/mcp` 配置存在，MCP 工具调用正常 |
| Case C0-2 Phase 1 | Rule / policy 注入验证 | ❌ FAIL | `~/.codex/config.toml` 中仍无 `developer_instructions` |
| Case C0-3 / C3 | `zoom-build` skill 写入验证 | ❌ FAIL | `sync_resources` 返回成功且 `search_resources.is_installed=true`，但本地 `scripts/`、`teams/`、manifest 依然全部缺失 |
| Case C1 | 全量 incremental sync | ✅ PASS | `summary: total=14, synced=14, failed=0` |
| Case C2 | 单资源 sync | ✅ PASS | `zoom-code-review`、`zoom-build` 均只返回目标资源 |
| Case C4 | 搜索 → 订阅 → Prompt 刷新 | ⚠️ PARTIAL | `zoom-build.is_installed=true`、`zoom-code-review.is_installed=true`，但两者本地目录与 manifest 仍缺失 |
| Case C5 | 取消订阅 → 文件清理 | ❌ FAIL | `unsubscribe` 后本地缺失，但 `manage_subscription(list)` 2 秒后仍保留资源；随后重新 sync 仍未恢复本地文件 |
| Case C6 | 模糊调用路由（CSP 优先） | ⚠️ PARTIAL | 已订阅路径恢复，`zoom-code-review` 可成功 `resolve_prompt_content`；但未订阅 fallback 因 C5 列表不收敛未完成复测 |
| Case C7 | Telemetry 计数 | ✅ PASS | 本轮 `resolve_prompt_content` 后计数继续增长：`total=23`，`winzr-cpp-expert=13`，`zoom-code-review=10` |
| Case C8 | Sync 内容一致性 | ⚠️ PARTIAL | 服务端能返回 `local_actions_required`，但本地文件未真正恢复，无法完成本地一致性验证 |
| Case C9 | MCP 资源取消订阅 | ❌ FAIL | `acm` 安装/卸载动作仍面向 `~/.cursor/mcp.json`，不是 Codex `~/.codex/config.toml` |
| Case C10 | `winzr-cpp-expert` md 引用懒加载链路 | ⚠️ PARTIAL | `resource_path="reference.md"` 懒加载成功；MR 41969 端到端 review 未完成 |

---

## 关键观测

### C0-2：Codex policy 注入仍未生效

- `sync_resources(mode="incremental", scope="global")` 成功
- 但返回的 `local_actions_required` 仍只看到 Cursor rule 写入
- `grep developer_instructions ~/.codex/config.toml` 无结果

结论：Codex 专项的 `merge_toml -> ~/.codex/config.toml -> developer_instructions` 链路仍未打通。

### C3：`zoom-build` 仍存在“服务端已安装，本地未落地”的分裂

复测时本地检查结果：

- `zoom-build-scripts-missing`
- `zoom-build-teams-missing`
- `zoom-build-manifest-missing`
- `build-cli-not-executable`
- `search_resources(keyword="build")` 中 `zoom-build.is_installed = true`

结论：服务端安装态与本地文件系统状态继续分裂；这次已经不只是 `0755` 权限问题，而是 sync 成功后本地仍未真正落地。

### C4：搜索态有所改善，但安装态和本地态仍不一致

- `search_resources(keyword="review")` 中 `zoom-code-review.is_subscribed = true`
- `search_resources(keyword="hang")` 中 `hang-log-analyzer.is_subscribed = true`
- `search_resources(keyword="review")` 中 `zoom-code-review.is_installed = true`
- `search_resources(keyword="build")` 中 `zoom-build.is_installed = true`
- 但本地检查仍然显示 `zoom-code-review` 和 `zoom-build` 目录都不存在

结论：订阅态与服务端安装态都能返回 `true`，但本地落地结果仍然缺失，说明安装态仍不可信。

### C5：本地删除后，服务端列表仍不收敛；重新 sync 也不恢复

对 `zoom-code-review`、`zoom-build` 执行 `unsubscribe` 后：

- 返回消息包含 propagation delay 提示
- 2 秒后本地检查：
  - `zoom-build-missing`
  - `zoom-build-manifest-missing`
  - `zoom-code-review-missing`
  - `zoom-code-review-manifest-missing`
- 2 秒后 `manage_subscription(list)` 仍返回这两个资源
- 随后对这两个资源重新执行 `sync_resources(resource_ids=[...])`
- 本地目录依然没有恢复

结论：本地删除动作已生效，但服务端订阅列表和重新安装链路仍不一致。

### C6：`zoom-code-review` prompt 注册已恢复，但 fallback 半链路未完成复测

- `sync_resources(resource_ids=["632400..."])` 返回成功
- `resolve_prompt_content(resource_id="632400b351c85024b0385ab3e7fa838d")` 本轮成功返回 prompt 内容
- 说明已订阅场景下，Codex 侧 `CSP 优先 -> resolve_prompt_content` 链路已打通
- 但由于 `unsubscribe` 后 `manage_subscription(list)` 仍不收敛，未订阅 fallback 场景无法在干净状态下完成复测

结论：已订阅路径通过，未订阅 fallback 路径仍受 C5 阻塞，因此本轮记为 `PARTIAL`。

### C7：telemetry 计数链路本轮可确认生效

第一次查询 `query_usage_stats(resource_type="skill", start_date="2026-05-09", end_date="2026-05-09")`：

- `total_invocations = 17`
- `winzr-cpp-expert = 10`
- `zoom-code-review = 8`

随后调用：

- `resolve_prompt_content(resource_id="632400b351c85024b0385ab3e7fa838d")`
- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c")`
- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c", resource_path="reference.md")`

再次查询 usage stats：

- `total_invocations = 23`
- `winzr-cpp-expert = 13`
- `zoom-code-review = 10`

结论：本轮 `resolve_prompt_content` 调用后，`winzr-cpp-expert` 和 `zoom-code-review` 计数都出现增长，telemetry 统计链路可判定为通过。

### C9：`acm` 仍走 Cursor 路径

`unsubscribe(acm)` 返回：

- `delete_file ~/.cursor/mcp-servers/acm`
- `remove_mcp_json_entry ~/.cursor/mcp.json -> server_name=acm`

`sync_resources(resource_ids=["834683..."])` 返回：

- `merge_mcp_json ~/.cursor/mcp.json -> acm-dev`
- `merge_mcp_json ~/.cursor/mcp.json -> acm`

结论：Codex checklist 期待的 `~/.codex/config.toml` 链路仍未实现。

### C10：懒加载链路可用

- `resolve_prompt_content(resource_id="009157...")` 成功
- `resolve_prompt_content(resource_id="009157...", resource_path="reference.md")` 成功
- 返回了 `reference.md` 实际内容
- `content` 中已包含 `[MANDATORY]` 与 `resource_path="reference.md"` 指令块

结论：md 子资源懒加载本身是通的，但端到端 MR review 链路本轮未覆盖。

---

## 收尾状态

- `manage_subscription(list)` 仍显示 14 个资源，和测试前快照一致
- 但 `zoom-build` / `zoom-code-review` 本地目录在本轮末尾仍缺失
- 本地状态因此 **不可信**

---

## 发布结论

> ❌ 存在失败项，**禁止发布生产**。
>
> 当前最关键的阻塞项是：
> 1. Codex 侧 `developer_instructions` 注入链路未生效
> 2. `zoom-build` / `zoom-code-review` 的安装态与本地文件状态仍分裂，两者都显示已安装但本地目录与 manifest 依旧缺失
> 3. unsubscribe 后 `list` 与本地状态仍不一致，重新 sync 也未恢复本地文件
> 4. `acm` 安装/卸载链路仍指向 Cursor `mcp.json`，不是 Codex `config.toml`
> 5. Case C10 仅验证了 md 懒加载子链路，MR 41969 端到端 review 仍未完成
