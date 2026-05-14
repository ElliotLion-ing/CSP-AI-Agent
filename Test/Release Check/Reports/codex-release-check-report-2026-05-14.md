# CSP AI Agent Release Check Report（Codex 客户端）

**日期：** 2026-05-14（CSP AI Agent 重新部署后复测）  
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
- 初始本地状态：
  - `~/.csp-ai-agent/skills/zoom-build/` 不存在
  - `~/.csp-ai-agent/skills/zoom-code-review/` 不存在
  - `~/.csp-ai-agent/.manifests/zoom-build.md` 不存在
  - `~/.csp-ai-agent/.manifests/zoom-code-review.md` 不存在
  - `build-cli` 不存在

---

## Case 结果总览

| Case | 名称 | 结果 | 备注 |
|------|------|------|------|
| Case C0-1 | `config.toml` MCP 配置验证 | ✅ PASS | `/mcp` 配置存在，MCP 工具调用正常 |
| Case C0-2 Phase 1 | Rule / policy 注入验证 | ❌ FAIL | `~/.codex/config.toml` 中仍无 `developer_instructions` |
| Case C0-3 / C3 | `zoom-build` skill 写入验证 | ❌ FAIL | `sync_resources` 返回成功且 `search_resources.is_installed=true`，但本地 `scripts/`、manifest 仍全部缺失 |
| Case C1 | 全量 incremental sync | ✅ PASS | `summary: total=14, synced=14, failed=0` |
| Case C2 | 单资源 sync | ✅ PASS | `zoom-code-review`、`zoom-build` 均只返回目标资源 |
| Case C4 | 搜索 → 订阅 → Prompt 刷新 | ⚠️ PARTIAL | `hang-log-analyzer`、`zoom-code-review`、`zoom-build` 均显示 `is_installed=true`，但本地 `zoom-code-review` / `zoom-build` 目录仍缺失 |
| Case C5 | 取消订阅 → 文件清理 | ❌ FAIL | `unsubscribe` 后 2 秒重查，`manage_subscription(list)` 仍保留资源；重新 sync 仍未恢复本地 skill 文件 |
| Case C6 | 模糊调用路由（CSP 优先） | ⚠️ PARTIAL | 已订阅路径通过，`zoom-code-review` 可成功 `resolve_prompt_content`；未订阅 fallback 因 C5 列表不收敛未完成复测 |
| Case C7 | Telemetry 计数 | ✅ PASS | 本轮调用后当天统计从 `6` 增长到 `12`，其中 `zoom-code-review=6`、`winzr-cpp-expert=6` |
| Case C8 | Sync 内容一致性 | ❌ FAIL | 服务端返回 `local_actions_required`，但多次 sync 后本地 skill 目录和 manifest 仍未落地 |
| Case C9 | MCP 资源取消订阅 | ❌ FAIL | `acm` 安装/卸载动作仍面向 `~/.cursor/mcp.json`，不是 Codex `~/.codex/config.toml` |
| Case C10 | `winzr-cpp-expert` md 引用懒加载链路 | ⚠️ PARTIAL | `resource_path="reference.md"` 懒加载成功；MR 41969 端到端 review 未完成 |

---

## 关键观测

### C0-2：Codex policy 注入仍未生效

- `sync_resources(mode="incremental", scope="global")` 成功
- 返回的 `local_actions_required` 仍然是 Cursor rule 写入
- `rg developer_instructions ~/.codex/config.toml` 无结果

结论：Codex 专项的 `developer_instructions` 注入链路仍未打通。

### C3 / C8：`zoom-build` / `zoom-code-review` 仍存在“服务端已安装，本地未落地”的分裂

重测前本地即为空：

- `zoom-build` 目录不存在
- `zoom-code-review` 目录不存在
- 两个 manifest 都不存在
- `build-cli` 不存在

随后执行：

- 全量 `sync_resources(mode="incremental", scope="global")`
- 单资源 `sync_resources(resource_ids=["632400..."])`
- 单资源 `sync_resources(resource_ids=["6dea7a2c8cf83e5d227ee39035411730"])`

结果：

- `search_resources(keyword="review")` 中 `zoom-code-review.is_installed = true`
- `search_resources(keyword="build")` 中 `zoom-build.is_installed = true`
- 但本地目录与 manifest 依旧全部缺失

结论：服务端“已安装”状态与本地文件系统状态持续分裂，且这轮已经不是权限问题，而是根本没有落盘。

### C4：搜索态和本地态仍不一致

- `search_resources(keyword="hang")` 中 `hang-log-analyzer.is_subscribed = true`，`is_installed = true`
- `search_resources(keyword="review")` 中 `zoom-code-review.is_subscribed = true`，`is_installed = true`
- `search_resources(keyword="build")` 中 `zoom-build.is_subscribed = true`，`is_installed = true`
- 但本地 `zoom-code-review` / `zoom-build` 仍然都不存在

结论：搜索结果中的安装态仍不可信。

### C5：本地删除后，服务端列表仍不收敛；重新 sync 也不恢复

对 `zoom-code-review`、`zoom-build`、`acm` 执行 `unsubscribe` 后：

- 返回消息明确提示 propagation delay
- 2 秒后本地检查：
  - `zoom-build` 目录不存在
  - `zoom-code-review` 目录不存在
  - 两个 manifest 不存在
- 2 秒后 `manage_subscription(list)` 仍然返回这 3 个资源
- 随后对这 3 个资源重新执行单资源 sync
- 本地 `zoom-build` / `zoom-code-review` 目录与 manifest 依然没有恢复
- `~/.cursor/mcp.json` 被重新创建，但不影响上述 skill 本地文件缺失问题

结论：本地删除动作与服务端列表、重新安装链路仍不一致。

### C6：`zoom-code-review` 已订阅路径可用，但 fallback 半链路未完成

- `manage_subscription(list)` 能命中 `zoom-code-review`
- `resolve_prompt_content(resource_id="632400b351c85024b0385ab3e7fa838d")` 本轮成功返回 prompt 内容
- 说明已订阅场景下，Codex 侧 `CSP 优先 -> resolve_prompt_content` 链路可用
- 但由于 `unsubscribe` 后 `manage_subscription(list)` 不收敛，无法构造干净的“未订阅 fallback”状态

结论：已订阅路径通过，未订阅 fallback 路径仍受 C5 阻塞，因此记为 `PARTIAL`。

### C7：telemetry 计数链路本轮可确认生效

第一次查询 `query_usage_stats(resource_type="skill", start_date="2026-05-14", end_date="2026-05-14")`：

- `total_invocations = 6`

随后调用：

- `resolve_prompt_content(resource_id="632400b351c85024b0385ab3e7fa838d")`
- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c")`
- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c", resource_path="reference.md")`

再次查询 usage stats：

- `total_invocations = 12`
- `zoom-code-review = 6`
- `winzr-cpp-expert = 6`

结论：本轮 `resolve_prompt_content` 调用后，telemetry 计数明确增长，可判定为通过。

### C9：`acm` 仍走 Cursor 路径

`unsubscribe(acm)` 返回：

- `delete_file ~/.cursor/mcp-servers/acm`
- `remove_mcp_json_entry ~/.cursor/mcp.json -> server_name=acm`

`sync_resources(resource_ids=["834683..."])` 返回：

- `merge_mcp_json ~/.cursor/mcp.json -> acm-dev`
- `merge_mcp_json ~/.cursor/mcp.json -> acm`

本地检查：

- `~/.cursor/mcp.json` 在本轮 re-sync 后被重新创建
- `sync` / `unsubscribe` 的本地动作目标仍明确是 Cursor 路径，而不是 `~/.codex/config.toml`

结论：Codex checklist 期待的 `~/.codex/config.toml` 链路仍未实现。

### C10：懒加载链路可用

- `resolve_prompt_content(resource_id="009157...")` 成功
- `resolve_prompt_content(resource_id="009157...", resource_path="reference.md")` 成功
- 返回了 `reference.md` 实际内容

结论：md 子资源懒加载本身是通的，但端到端 MR review 链路本轮未覆盖。

---

## 收尾状态

- `manage_subscription(list)` 最终仍显示 14 个资源，和测试前快照一致
- 但 `zoom-build` / `zoom-code-review` 本地目录与 manifest 在本轮末尾仍缺失
- `~/.cursor/mcp.json` 在本轮测试中被重新创建，说明 `acm` 链路仍然落在 Cursor 侧路径
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
