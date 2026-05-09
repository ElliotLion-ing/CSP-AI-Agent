# CSP AI Agent Release Check Report（Codex 客户端）

**日期：** 2026-05-09（重新部署后复测）  
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
| Case C0-3 / C3 | `zoom-build` skill 写入验证 | ❌ FAIL | 本轮不是权限错误，而是 `zoom-build` 的本地 `scripts/`、`teams/`、manifest 全部缺失 |
| Case C1 | 全量 incremental sync | ✅ PASS | `summary: total=14, synced=14, failed=0` |
| Case C2 | 单资源 sync | ✅ PASS | `zoom-code-review`、`zoom-build` 均只返回目标资源 |
| Case C4 | 搜索 → 订阅 → Prompt 刷新 | ⚠️ PARTIAL | `is_subscribed` 正确，但 `is_installed` 仍为 `false`；且 sync 后本地目录并未恢复 |
| Case C5 | 取消订阅 → 文件清理 | ❌ FAIL | 本地删除已生效，但 `manage_subscription(list)` 仍保留资源；随后重新 sync 也未恢复本地文件 |
| Case C6 | 模糊调用路由（CSP 优先） | ⚠️ PARTIAL | 已订阅资源能 `resolve_prompt_content`；但本地安装态和 unsubscribe 状态不稳定，fallback 前提不可靠 |
| Case C7 | Telemetry 计数 | ⚠️ PARTIAL | usage stats 里已能看到 `zoom-code-review`，但本次再次 `resolve_prompt_content` 后计数未继续增长 |
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

### C3：`zoom-build` 从“权限错”变成“文件未安装”

复测时本地检查结果：

- `build-cli-not-executable`
- `zoom-build-scripts-missing`
- `zoom-build-teams-missing`
- `zoom-build-manifest-missing`

结论：这次不是 `0755` 权限问题，而是 `zoom-build` 本地文件根本没有被恢复下来。

### C4：搜索态只修了一半

- `search_resources(keyword="review")` 中 `zoom-code-review.is_subscribed = true`
- `search_resources(keyword="hang")` 中 `hang-log-analyzer.is_subscribed = true`
- 但两者 `is_installed` 仍都为 `false`

结论：订阅态比前几轮好，但安装态仍不可信。

### C5：本地删除成功，但服务端列表仍不收敛

对 `zoom-code-review`、`zoom-build` 执行 `unsubscribe` 后：

- 返回消息包含 propagation delay 提示
- 2 秒后本地检查：
  - `zoom-build-missing`
  - `zoom-build-manifest-missing`
  - `zoom-code-review-missing`
  - `zoom-code-review-manifest-missing`
- 但 `manage_subscription(list)` 仍返回这两个资源
- 随后对这两个资源重新执行 `sync_resources(resource_ids=[...])`
- 本地目录依然没有恢复

结论：本地删除动作已生效，但服务端订阅列表和重新安装链路仍不一致。

### C7：telemetry 从“完全不记”改善为“有历史记录，但当前不递增”

本轮查询 `query_usage_stats(resource_type="skill", start_date="2026-05-09", end_date="2026-05-09")`：

- `total_invocations = 14`
- `winzr-cpp-expert = 7`
- `zoom-code-review = 7`

随后再次调用：

- `resolve_prompt_content(resource_id="632400...")`
- 响应 `usage_tracked = true`

再次查询 usage stats：

- 计数仍保持 `total_invocations = 14`
- `zoom-code-review` 仍为 `7`

结论：telemetry 不再是完全失效，但本次调用后没有继续递增，仍未完全符合 checklist 预期。

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
> 2. `zoom-build` 本地文件未落地，已不是单纯权限问题
> 3. unsubscribe 后 `list` 与本地状态仍不一致，重新 sync 也未恢复本地文件
> 4. telemetry 有历史计数，但当前调用后不递增
> 5. `acm` 安装/卸载链路仍指向 Cursor `mcp.json`，不是 Codex `config.toml`
