# CSP AI Agent Release Check Report

**报告日期：** 2026-05-09  
**测试环境：** dev  
**服务版本：** v0.2.21（npm `@elliotding/ai-agent-mcp@0.2.21`）  
**测试执行人：** AI Agent（Codex）  
**Checklist 版本：** v1.4.0  
**结论：** ❌ 存在失败项，禁止发布生产

---

## 订阅快照（测试前）

```json
[
  { "id": "0bbc520906995c7ca6ecb923aba141ca", "name": "csp-ai-prompts", "type": "rule" },
  { "id": "4aabb99362070c1f3ef3582b62f37d98", "name": "zoom-testcase", "type": "skill" },
  { "id": "632400b351c85024b0385ab3e7fa838d", "name": "zoom-code-review", "type": "skill" },
  { "id": "6dea7a2c8cf83e5d227ee39035411730", "name": "zoom-build", "type": "skill" },
  { "id": "8346836580e75837a7183285c5872843", "name": "acm", "type": "mcp" },
  { "id": "ad07dd91e56658858d28634034b876a7", "name": "security-security-baseline", "type": "rule" },
  { "id": "bdba66f05d2bf4ef4a71051fe4fc8f18", "name": "zoom-design-doc", "type": "skill" },
  { "id": "009157d8ed498e93c0dbdbdbd47ae40c", "name": "winzr-cpp-expert", "type": "skill" },
  { "id": "0b906418c1486fd59f3f93cbb762f5de", "name": "zoom-doc", "type": "skill" },
  { "id": "0bb0b03e92eb56118a27a15048716f93", "name": "ZMDB-diagnose-db-hang", "type": "command" },
  { "id": "2a2f55f8cd91dd272816d571e7688e61", "name": "zoom-client-worktree", "type": "skill" },
  { "id": "7b7c653e1fee5a30962a4019411c128b", "name": "hang-log-analyzer", "type": "skill" },
  { "id": "aee05dd59a754e566370e84e93360d32", "name": "generate-testcase", "type": "command" },
  { "id": "cbbbb578a4ec94d780627ffbeb5bb232", "name": "zoom-jira", "type": "skill" }
]
```

---

## 执行范围说明

- 本次按**最新** `release-check-checklist.md` 复测 Part B（Codex）。
- Checklist 已明确区分：Cursor 使用 `/sse`，Codex 使用 `/mcp`。因此旧报告里把 `/mcp` 判为失败的结论无效。
- `Case C0-2 Phase 2` 跨重启边界，当前会话只能验证到 Phase 1。
- `Case C8` 远端 Git 对比、`Case C10 Step 10-4` 端到端 MR Review，本次仍未完成全链路远端验证。

---

## Case 执行结果

| Case | 名称 | 结果 | 备注 |
|------|------|------|------|
| Case C0-1 | `config.toml` MCP 配置验证 | ✅ PASS | `~/.codex/config.toml` 中 `csp-ai-agent` 存在，URL 为 `/mcp`，Authorization 存在，MCP tool 调用正常 |
| Case C0-2 Phase 1 | Rule 注入验证 | ❌ FAIL | `sync_resources(mode="incremental", scope="global")` 未返回 `merge_toml -> ~/.codex/config.toml -> developer_instructions` 链路；`developer_instructions` 仍缺失 |
| Case C0-3 / C3 | `zoom-build` skill 写入验证 | ❌ FAIL | `scripts/`、`teams/`、manifest 均存在，但 `build-cli` 权限仍是 `-rw-r--r--`，不满足 755 |
| Case C1 | 全量 incremental sync | ✅ PASS | `sync_resources(mode="incremental", scope="global")` 成功，summary: total=14, synced=14, failed=0 |
| Case C2 | 单资源 sync | ✅ PASS | `zoom-code-review`、`zoom-build` 单资源 sync 均只返回目标资源 |
| Case C4 | 搜索 → 订阅 → Prompt 刷新 | ⚠️ PARTIAL | 搜索接口可用，但 `search_resources` 返回的 `is_subscribed` / `is_installed` 与 `manage_subscription(list)` 明显不一致 |
| Case C5 | 取消订阅 → 文件清理 | ❌ FAIL | 对 `zoom-code-review`、`zoom-build` 执行 unsubscribe 后，订阅列表仍保留；`zoom-build` 本地目录和 manifest 仍存在 |
| Case C6 | 模糊调用路由（CSP 优先） | ⚠️ PARTIAL | 已验证已订阅时可 `resolve_prompt_content` 命中 CSP Skill；但因 unsubscribe 后列表未移除，未能形成稳定的 fallback 前提 |
| Case C7 | Telemetry 计数 | ❌ FAIL | 调用 `resolve_prompt_content(resource_id="632400...")` 后再次查询，计数仍未增加 |
| Case C8 | Sync 内容一致性（本地 vs 远端 Git） | ⚠️ PARTIAL | 已验证本地 manifest/version/scripts/teams；未完成远端 Git 对比 |
| Case C9 | 取消订阅 MCP 资源 | ❌ FAIL | 最新 checklist 的 Codex 注释要求验证 `~/.codex/config.toml` 清理；实际返回仍是 Cursor 向的 `~/.cursor/mcp.json` / `remove_mcp_json_entry` |
| Case C10 | `winzr-cpp-expert` md 引用懒加载链路 | ⚠️ PARTIAL | `resource_path="reference.md"` 懒加载成功；MR 41969 端到端 review 链路未完成 |

---

## 关键观测

### C0-1：Codex MCP 配置

实际读取到：

```toml
[mcp_servers.csp-ai-agent]
url = "https://zct-dev.zoomdev.us/csp-agent/mcp"
http_headers = { "Authorization" = "Bearer ..." }
enabled = true
```

结论：

- `[mcp_servers.csp-ai-agent]` 配置节存在
- URL 使用 `/mcp`，符合最新版 checklist 对 Codex 的要求
- Authorization header 存在
- `manage_subscription`、`sync_resources`、`resolve_prompt_content` 可正常调用

### C0-2：Codex policy 注入未生效

实际行为：

- 调用：`sync_resources(mode="incremental", scope="global")`
- 返回中未观察到 `merge_toml`
- `~/.codex/config.toml` 中仍找不到 `developer_instructions`
- 也未进入“写检查点 -> 重启 -> Phase 2 验证”的前置状态

结论：

- Codex 专项的 policy 注入链路未打通

### C3：`zoom-build` 本地文件存在但脚本不可执行

本地证据：

- `~/.csp-ai-agent/skills/zoom-build/scripts/` 存在
- `~/.csp-ai-agent/skills/zoom-build/teams/` 存在
- `~/.csp-ai-agent/.manifests/zoom-build.md` 存在
- `build-cli` 权限为 `-rw-r--r--`

结论：

- sync 能把复杂 skill 文件写下来
- 但核心脚本没有可执行位，不满足 checklist 预期

### C4：搜索结果中的订阅状态不可信

复测时观察到：

- `manage_subscription(list)` 明确返回 `zoom-code-review`、`zoom-doc`、`hang-log-analyzer` 已在订阅列表中
- 但 `search_resources(keyword: "review")` 里 `zoom-code-review.is_subscribed = false`
- `search_resources(keyword: "doc")` 里 `zoom-doc.is_subscribed = false`
- `search_resources(keyword: "hang")` 里 `hang-log-analyzer.is_subscribed = false`

结论：

- 搜索接口本身可用
- 但搜索结果中的订阅态 / 安装态标记与真实订阅列表不一致，影响 Case 4、Case 6 的可靠性

### C5：取消订阅状态不一致

`zoom-code-review`：

- `unsubscribe` 返回 success，并给出删除 skill/manifest 的 local actions
- 本地目录当前为缺失状态
- 但 `manage_subscription(list)` 仍返回 `zoom-code-review`

`zoom-build`：

- `unsubscribe` 返回 success，并给出删除 skill/manifest 的 local actions
- 但 `manage_subscription(list)` 仍返回 `zoom-build`
- `~/.csp-ai-agent/skills/zoom-build/` 仍存在
- `~/.csp-ai-agent/.manifests/zoom-build.md` 仍存在

结论：

- 服务端订阅状态、`list` 结果、本地文件清理三者不一致

### C7：Telemetry 未递增

测试前：

- `query_usage_stats(resource_type="skill", start_date="2026-05-09", end_date="2026-05-09")`
- 返回 `total_invocations = 1`
- 唯一记录为 `winzr-cpp-expert: 1`

测试动作：

- 调用 `resolve_prompt_content(resource_id="632400b351c85024b0385ab3e7fa838d")`
- 返回 `usage_tracked = true`

测试后：

- 再次查询 usage stats
- 结果仍为 `total_invocations = 1`
- 仍只显示 `winzr-cpp-expert: 1`

结论：

- `resolve_prompt_content` 的响应声称已跟踪
- 但 telemetry 聚合计数没有实际增加

### C9：MCP 取消订阅仍走 Cursor 路径

最新 checklist 在 Codex 部分的补充说明明确要求：

- Case 9 对 Codex 要验证 `~/.codex/config.toml` 中的 `[mcp_servers.<name>]` 清理

实际 `unsubscribe(acm)` 返回的 local actions：

- `delete_file ~/.cursor/mcp-servers/acm`
- `remove_mcp_json_entry ~/.cursor/mcp.json -> server_name=acm`

实际 `sync_resources(resource_ids=["834683..."])` 返回的恢复动作也仍是：

- `merge_mcp_json ~/.cursor/mcp.json`

结论：

- 整条 `acm` MCP 资源安装/卸载链路仍偏向 Cursor，不符合 Codex checklist 预期

---

## Case C10 详细结果

### Step 10-1：订阅状态

- `winzr-cpp-expert` 订阅状态：已订阅

### Step 10-2：SKILL.md 内容验证

| 验证项 | 结果 |
|--------|------|
| 原始 md 链接已消失 | ✅ |
| 出现 MANDATORY tool call 块 | ✅ |
| tool call 中有 `resolve_prompt_content` | ✅ |
| tool call 中有 `resource_path` | ✅ |
| `resource_id` 正确嵌入 | ✅ |

### Step 10-3：懒加载子资源

- 调用：`resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c", resource_path="reference.md")`
- 结果：成功
- 返回内容摘要：返回了 `reference.md` 实际内容，包含 Zoom Rooms Windows C++ 编码规范、评审标准等文本

| 验证项 | 结果 |
|--------|------|
| 调用成功（非 404） | ✅ |
| 返回内容为 `reference.md` 实际内容 | ✅ |
| 嵌套引用处理正常（若存在） | N/A |

### Step 10-4：端到端 Code Review 链路（MR 41969）

- 目标 MR：https://git.zoom.us/main/zoomrooms/-/merge_requests/41969

| 验证项 | 结果 |
|--------|------|
| 调用链路完整（步骤 1-4 全部执行） | ❌ |
| `reference.md` 被正确获取 | ✅ |
| 未直接读本地文件 | ✅ |
| Code Review 输出包含具体分析 | ❌ |
| 未走 helper-gitlab fallback | ⚠️ 未执行到该阶段 |

说明：

- 已完成 `manage_subscription(list)`、`resolve_prompt_content(resource_id)`、`resolve_prompt_content(resource_path="reference.md")`
- 未完成对 MR 41969 的远端 diff 抓取与按 skill 输出完整 review report

---

## 失败项详情

- **C0-2**：未观察到 `merge_toml -> ~/.codex/config.toml -> developer_instructions` 注入链路
- **C0-3 / C3**：`zoom-build/scripts/build-cli` 权限错误，不可执行
- **C5**：取消订阅后，`list` 结果未移除；`zoom-build` 本地文件未清理
- **C7**：`resolve_prompt_content` 后 telemetry 计数未增加
- **C9**：MCP 资源安装/卸载仍面向 Cursor 路径，不是 Codex 配置路径
- **C10 Step 10-4**：未完成 MR review 端到端链路

---

## 订阅状态恢复

- 最终 `manage_subscription(action="list")` 返回 14 个资源，与测试前快照一致
- 但本地文件恢复仍受当前 sync/local_actions 问题影响；例如本次复测后 `zoom-code-review` 本地目录仍未重新出现

恢复结果：⚠️ **订阅列表已恢复，但本地状态不完全可信**

---

## 发布结论

> ❌ 存在失败项，**禁止发布生产**。
>
> 当前最关键的阻塞项是：
> 1. Codex 侧 `developer_instructions` 注入链路未生效
> 2. 取消订阅后的订阅状态 / 本地清理 / 搜索标记三者不一致
> 3. telemetry 计数未递增
> 4. `zoom-build` 脚本权限错误
