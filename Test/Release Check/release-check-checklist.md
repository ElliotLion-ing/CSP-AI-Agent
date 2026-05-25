# CSP AI Agent Release Check Checklist

**版本：** 1.4.0  
**类型：** 发布前手动 Release Check（Human-in-the-loop）  
**触发方式：** 每次发布到生产环境前，必须先在 **dev 环境**手动通知 Agent 按照本 checklist 执行  
**测试目标：** 验证 CSP AI Agent 核心行为链路、关键 Bug 修复、md 引用懒加载链路正确性，以及 Codex 双客户端兼容性  
**报告存放：** `Test/Release Check/Reports/release-check-report-YYYY-MM-DD.md`

---

> ⚠️ **强制要求**：每次 npm 发布并通知服务端部署 dev 环境完成后，**必须先执行本 checklist 全部 Case 并通过，才能发布到生产环境**。

---

## 客户端分区说明

本 checklist 分两个测试分区执行：

| 分区 | 客户端 | 执行环境 | MCP 连接方式 | Transport | Endpoint |
|------|--------|---------|------------|-----------|---------|
| **Part A**（Case 1–10） | **Cursor** | Cursor IDE Agent | SSE via `~/.cursor/mcp.json` | SSE | `/sse` |
| **Part B**（Case C1–C10 + Codex 专项） | **Codex** | Codex CLI Agent | Streamable HTTP via `~/.codex/config.toml` | Streamable HTTP | `/mcp` |

Part A 和 Part B 均须全部通过，方可发布生产环境。

---

## 前置准备

### 1. 快照当前订阅状态

在测试开始前，AI 必须执行以下操作并记录结果：

```
调用 manage_subscription(action: list)
将完整的 subscriptions 数组保存到本次测试的"订阅快照"中
测试结束后以此为依据恢复
```

### 2. 选择测试用 Skill

本测试优先使用以下资源（按顺序选择可用的）：

| 优先级 | 资源名 | 类型 | 用途 |
|--------|--------|------|------|
| 1 | `zoom-build` | complex skill | Case 3、5 复杂 skill 测试 |
| 2 | `zoom-code-review` | skill | Case 6 模糊调用测试 |
| 3 | `hang-log-analyzer` | skill | 备用搜索测试目标 |
| 4 | `winzr-cpp-expert` | skill | Case 10 md 引用链路验证（必选） |

> AI 在执行前需调用 `manage_subscription(action: list)` 确认当前哪些资源已订阅，据此决定测试路径。

---

## 测试用例

---

### Case 1：同步所有资源（incremental 默认行为）

**模拟用户语句：**
> "小助手，帮我同步一下我的所有资源"

**AI 执行路径验证：**
1. 识别意图为"同步所有资源"
2. 调用 `sync_resources(mode: "incremental", scope: "global")`
3. **不得**调用 `mode: "full"` 除非用户明确说"全量同步"

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| sync mode | `incremental`（非 full） | | |
| scope | `global`（无 resource_ids 过滤） | | |
| local_actions 范围 | 包含所有已订阅资源的 actions | | |
| 未变更资源 | 返回 cached，不重复写入 | | |

**补充验证（full 模式需用户明确触发）：**

模拟用户语句：
> "小助手，帮我做一次全量同步，把所有资源都重新下载一遍"

预期：AI 调用 `sync_resources(mode: "full", scope: "global")`

---

### Case 2：同步单一资源

**前置条件：** 用户订阅列表中存在至少一个 skill/rule 资源

**模拟用户语句：**
> "小助手，zoom-code-review 这个资源远端更新了，帮我单独 sync 一下"

**AI 执行路径验证：**
1. 识别意图为"同步单一资源 zoom-code-review"
2. 查找该资源的 resource_id（可通过订阅列表获取）
3. 调用 `sync_resources(mode: "incremental", resource_ids: ["<zoom-code-review 的 id>"])`
4. **不得**触发全体资源的 local_actions

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| resource_ids | 仅包含目标资源 ID | | |
| local_actions 范围 | 仅含目标资源的 actions，不含其他资源 | | |
| 其他资源 prompts | 不受影响，仍在列表中 | | |

---

### Case 3：同步复杂 Skill（zoom-build 文件写入验证）

**前置条件：** 需订阅 `zoom-build`（若未订阅，先执行订阅）

**模拟用户语句：**
> "小助手，帮我 sync 一下 zoom-build 这个 skill"

**AI 执行路径验证：**
1. 识别目标资源为 zoom-build（complex skill）
2. 调用 `sync_resources(mode: "incremental", resource_ids: ["6dea7a2c8cf83e5d227ee39035411730"])`
3. 执行返回的 local_actions（write_file 操作，写入到 `~/.csp-ai-agent/skills/zoom-build/`）

**文件系统验证（AI 执行后检查）：**

```bash
ls ~/.csp-ai-agent/skills/zoom-build/
# 预期存在：scripts/ 等目录
```

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| sync 触发 | 仅 zoom-build 的 resource_id | | |
| scripts 目录 | `~/.csp-ai-agent/skills/zoom-build/scripts/` 存在 | | |
| 其他 skill 文件 | 不被影响（不触发全体 sync） | | |

---

### Case 4：搜索资源 → 订阅 → Prompt 刷新

**前置条件：** 找一个当前**未订阅**的资源作为搜索目标（AI 根据订阅快照自动选择，优先使用 `hang-log-analyzer`）

**Step 4-1：搜索资源**

模拟用户语句：
> "小助手，有没有关于 hang log 分析的工具？"

预期：AI 调用 `search_resources(keyword: "hang")` 或类似关键词，返回搜索结果并展示给用户

**Step 4-2：触发订阅**

模拟用户语句：
> "好的，帮我订阅它"

预期 AI 执行路径：
1. 调用 `manage_subscription(action: "subscribe", resource_ids: ["<目标资源 id>"])`
2. 仅触发该资源的 sync（`resource_ids` 指定），**不触发全体资源 local_actions**
3. 等待 prompts/list_changed 通知 Cursor 刷新

**Step 4-3：多资源订阅测试**

模拟用户语句：
> "另外再帮我订阅 zoom-jira 和 zoom-doc"

预期：
1. 调用 `manage_subscription(action: "subscribe", resource_ids: ["<zoom-jira id>", "<zoom-doc id>"])`
2. sync 时 resource_ids 包含这两个 ID，**不触发全体资源的 local_actions**

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 搜索结果 | 返回匹配资源列表 | | |
| 单资源订阅 sync | resource_ids 仅含目标 ID | | |
| 多资源订阅 sync | resource_ids 仅含订阅的多个 ID | | |
| Prompt 刷新 | 订阅后 CSP prompt 列表新增对应 prompt | | |
| 未订阅资源 local_actions | 不出现在返回结果中 | | |

---

### Case 5：取消订阅 → Prompt 移除 → 复杂 Skill 文件清理

**前置条件：** `zoom-build` 已订阅且本地文件已存在

**Step 5-1：取消订阅普通 Skill**

模拟用户语句：
> "小助手，帮我取消 zoom-code-review 的订阅"

预期：
1. 调用 `manage_subscription(action: "unsubscribe", resource_ids: ["<zoom-code-review id>"])`
2. 从订阅列表移除
3. CSP prompt 列表中 `zoom-code-review` prompt 立即消失（不需要重启 MCP）

**Step 5-2：取消订阅复杂 Skill（文件清理验证）**

模拟用户语句：
> "小助手，帮我取消 zoom-build 的订阅"

预期：
1. 调用 `manage_subscription(action: "unsubscribe", resource_ids: ["6dea7a2c8cf83e5d227ee39035411730"])`
2. prompt 列表中 `zoom-build` prompt 立即消失
3. `~/.csp-ai-agent/skills/zoom-build/` 目录被清理

**文件系统验证：**

```bash
ls ~/.csp-ai-agent/skills/zoom-build/ 2>&1
# 预期：No such file or directory（目录已删除）
```

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 订阅列表移除 | 取消后不在 list 中 | | |
| Prompt 即时消失 | 无需重启 MCP，prompt 立即从列表移除 | | |
| zoom-build 文件清理 | `~/.csp-ai-agent/skills/zoom-build/` 不存在 | | |

---

### Case 6：模糊调用 → CSP 优先级路由验证

**前置条件：** `zoom-code-review` 已订阅；另准备一个**未订阅**的类似功能资源

**Step 6-1：已订阅资源的模糊调用**

模拟用户语句：
> "帮我 review 一下这个 MR"

预期 AI 执行路径：
1. 识别意图：review / MR
2. **必须先**调用 `manage_subscription(action: list)` 检查订阅
3. 命中 `zoom-code-review` → 调用 `resolve_prompt_content(resource_id: "632400b351c85024b0385ab3e7fa838d")`
4. 按 zoom-code-review Skill 执行，不直接调用 helper-gitlab

**Step 6-2：未订阅资源的 Fallback**

（临时取消 zoom-code-review 订阅后测试）

模拟用户语句：
> "帮我 review 一下这个 MR"

预期 AI 执行路径：
1. 调用 `manage_subscription(action: list)` → 无匹配资源
2. 提示用户："你的订阅中没有 review 相关资源，你可以搜索 CSP 资源库订阅"
3. Fallback 到 helper-gitlab 或告知无可用工具

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 已订阅：先查订阅 | 必须调用 `manage_subscription(list)` | | |
| 已订阅：命中后调用 | `resolve_prompt_content` 直接执行 | | |
| 已订阅：不走 helper | 不直接调用 helper-gitlab | | |
| 未订阅：提示用户 | 提示订阅建议 | | |
| 未订阅：Fallback | 降级到 helper 或说明无工具 | | |

---

### Case 7：Telemetry 计数验证

**前置条件：** 任意已订阅的 skill/prompt 资源（如 zoom-code-review）

**模拟用户语句：**
> "小助手，帮我调用一下 zoom-code-review"

**AI 执行路径：**
1. 调用 `resolve_prompt_content(resource_id: "632400b351c85024b0385ab3e7fa838d")`
2. 调用后查询 telemetry 统计

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| resolve_prompt_content 被调用 | 使用 resource_id 调用 | | |
| telemetry 计数递增 | 调用后计数 +1 | | |
| 未走本地文件路径 | 不直接读 `~/.csp-ai-agent/` 文件 | | |

---

### Case 8：Sync 内容一致性验证（本地 vs 远端 Git）

**前置条件：** `zoom-build` 已订阅并完成 sync（Case 3 之后执行）

**目的：** 验证 sync 下来的本地文件与 CSP GitLab 仓库中的最新版本完全一致。

**远端 Git 地址：** `https://git.zoom.us/main/csp/-/tree/main/ai-resources/skills/zoom-build`

**Step 8-1：读取本地 manifest 版本信息**

```bash
head -10 ~/.csp-ai-agent/.manifests/zoom-build.md
```

**Step 8-2：读取本地关键文件的特征值**

```bash
wc -l ~/.csp-ai-agent/.manifests/zoom-build.md
ls -la ~/.csp-ai-agent/skills/zoom-build/scripts/
ls -la ~/.csp-ai-agent/skills/zoom-build/teams/
head -3 ~/.csp-ai-agent/skills/zoom-build/scripts/build-cli
grep -m 3 '"version"\|"team"\|"name"' ~/.csp-ai-agent/skills/zoom-build/teams/client-android.json
```

**Step 8-3：通过 helper-gitlab 拉取远端 Git 内容对比**

**结果对照表：**

| 对比项 | 本地值 | 远端值 | 一致？ |
|--------|--------|--------|--------|
| manifest `version` 字段 | | | |
| `scripts/` 文件数量 | | | |
| `teams/` 文件数量 | | | |
| `build-cli` 文件大小 | | | |

---

### Case 9：取消订阅 MCP 类型资源 → mcp.json 条目清理

**前置条件：** 订阅列表中存在 `jenkins`（type: mcp）资源，且 `~/.cursor/mcp.json` 中已有对应条目

**模拟用户语句：**
> "小助手，帮我取消 jenkins 这个 MCP 的订阅"

**AI 执行路径验证：**
1. 调用 `manage_subscription(action: "unsubscribe", resource_ids: ["<jenkins id>"])`
2. 检查 local_actions 中包含 `remove_mcp_json_entry`
3. 执行后验证 `mcpServers.jenkins` 已从 mcp.json 移除

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 订阅列表中移除 jenkins | `manage_subscription(list)` 不再返回 jenkins | | |
| local_actions 包含 remove_mcp_json_entry | 返回中有该 action | | |
| mcp.json 条目已删除 | `mcpServers.jenkins` 不存在 | | |
| 其他 mcp.json 条目不受影响 | 其他 MCP server 配置保持不变 | | |

> **注意：** 测试完成后必须在收尾阶段重新订阅 `jenkins` 并执行 `sync_resources` 以恢复配置。

---

### Case 10：winzr-cpp-expert md 引用懒加载链路验证 🆕

**关联 Bug：** BUG-2026-04-21-001（SKILL.md 内引用的其他 md 文件未被解析）  
**修复版本：** v0.2.17

**目的：** 验证 BUG-2026-04-21-001 修复后，SKILL.md 内的 md 引用通过 `resolve_prompt_content(resource_path)` 懒加载链路正确工作，且调用 `winzr-cpp-expert` 做 Code Review 时整个链路端到端正常。

---

**Step 10-1：确认 winzr-cpp-expert 订阅状态**

AI 执行：
```
调用 manage_subscription(action: list)
检查订阅列表中是否存在 winzr-cpp-expert
```

- 若**未订阅**：调用 `manage_subscription(action: "subscribe", resource_ids: ["<winzr-cpp-expert id>"])`，再执行 `sync_resources` 完成注册，然后继续
- 若**已订阅**：直接继续

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 订阅状态确认 | 已订阅或成功完成订阅 | | |

---

**Step 10-2：获取 SKILL.md 内容，验证 md 引用已替换为 tool call 指令**

AI 执行：
```
调用 resolve_prompt_content(resource_id: "<winzr-cpp-expert 的 id>")
```

检查返回的 `content` 字段中：

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 原始 md 链接已消失 | content 中不存在 `[reference.md](./reference.md)` 形式的原始链接 | | |
| 出现 MANDATORY tool call 块 | content 中包含 `[MANDATORY` 字样 | | |
| tool call 中有 resolve_prompt_content | 包含 `"tool": "resolve_prompt_content"` | | |
| tool call 中有 resource_path | 包含 `"resource_path"` 字段 | | |
| resource_id 正确嵌入 | tool call JSON 中 resource_id 与 winzr-cpp-expert 的 id 一致 | | |

---

**Step 10-3：按 SKILL.md 指令调用子资源，验证懒加载链路**

AI 按照 SKILL.md 中的 `[MANDATORY]` 指令，调用：
```
resolve_prompt_content(resource_id: "<winzr-cpp-expert 的 id>", resource_path: "reference.md")
```
（resource_path 从 Step 10-2 的 tool call 块中读取）

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 调用成功（非 404） | success: true，content 非空 | | |
| 返回内容为 reference.md 实际内容 | 包含编码规范、评审标准等文字（非 SKILL.md 主内容） | | |
| 若 reference.md 内还有引用 | 内部引用也被替换为 tool call 指令（嵌套链路正常） | | |

---

**Step 10-4：端到端 Code Review 链路验证**

使用 `winzr-cpp-expert` Skill 对以下 MR 执行 Code Review：

**目标 MR：** https://git.zoom.us/main/zoomrooms/-/merge_requests/41969

模拟用户语句：
> "用 winzr-cpp-expert 帮我 review 一下这个 MR：https://git.zoom.us/main/zoomrooms/-/merge_requests/41969"

**AI 必须按以下顺序执行（验证完整调用链路）：**

1. `manage_subscription(action: list)` → 命中 winzr-cpp-expert
2. `resolve_prompt_content(resource_id: "<id>")` → 获取 SKILL.md（含 MANDATORY tool call 块）
3. 读取 SKILL.md 中的 `[MANDATORY]` 指令 → **必须**调用 `resolve_prompt_content(resource_id: "<id>", resource_path: "reference.md")`
4. 获取 reference.md 内容后，按规范执行对 MR 41969 的 Code Review

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 调用链路完整 | 步骤 1-4 全部执行，无跳过 | | |
| reference.md 被正确获取 | Step 3 的 tool call 成功，返回规范内容 | | |
| 未直接读本地文件 | 不读 `~/.csp-ai-agent/skills/winzr-cpp-expert/reference.md` | | |
| Code Review 输出质量 | 包含具体代码问题分析，引用了 reference.md 中的标准 | | |
| 未走 helper-gitlab fallback | 全程走 CSP Skill 路径，非降级方案 | | |

---

## 测试执行顺序

### Part A：Cursor 客户端（Case 1–10）

```
前置：快照订阅状态（Cursor）
  ↓
Case 1：全量 incremental sync
  ↓
Case 2：单资源 sync
  ↓
Case 3：复杂 skill sync（zoom-build 文件验证）
  ↓
Case 8：Sync 内容一致性验证（本地 vs 远端 Git）
  ↓
Case 4：搜索 → 订阅 → Prompt 刷新
  ↓
Case 5：取消订阅 → Prompt 移除 → 文件清理
  ↓
Case 6：模糊调用路由（CSP 优先 → Fallback）
  ↓
Case 7：Telemetry 计数
  ↓
Case 9：取消订阅 MCP 资源 → mcp.json 条目清理
  ↓
Case 10：winzr-cpp-expert md 引用懒加载链路验证
  ↓
收尾：恢复订阅状态到测试前快照
```

### Part B：Codex 客户端（Case C0 专项 + Case C1–C10 回归）

```
前置：Codex 环境就绪检查（Case C0）
  ↓
Case C0-1：config.toml MCP 配置验证
  ↓
Case C0-2 Phase 1：sync 注入 developer_instructions + 写入检查点
  ↓
⚠️ 用户重启 Codex（必须步骤，policy 生效的前提）
  ↓
Case C0-2 Phase 2：（新会话）用户输入恢复指令 → Agent 读检查点 → 验证路由规则生效
  ↓
Case C0-3：Skill 运行验证（zoom-build sync + 文件写入）
  ↓
Case C1–C10：与 Cursor Part A 相同的 10 个 Case（在 Codex 中重跑）
  ↓
收尾：恢复订阅状态到测试前快照
```

---

## 收尾：恢复订阅状态

测试结束后，AI 必须执行以下恢复步骤：

```
1. 调用 manage_subscription(action: list) 获取当前列表
2. 对比快照，计算需要重新订阅 / 取消订阅的资源
3. 执行恢复操作（subscribe / unsubscribe）
4. 再次调用 list 验证与快照完全一致
```

---

## Part B：Codex 客户端专项 Check

> **执行方式：** 在 Codex CLI 会话中，由 Codex Agent 执行以下所有 Case。  
> **前置条件：** `~/.codex/config.toml` 中已配置 `[mcp_servers.csp-ai-agent]`，且 `url` 字段指向 `/mcp` 端点（Streamable HTTP），Codex 已重启使配置生效。  
> **⚠️ 注意：** Codex 使用 **Streamable HTTP** transport（`/mcp` 端点），与 Cursor 使用的 **SSE**（`/sse` 端点）不同，两者 URL 尾缀不一致，配置时需注意区分。

---

### Case C0：Codex 环境就绪检查（专属于 Codex，Cursor 无此 Case）

---

#### Case C0-1：config.toml MCP 配置验证

**目的：** 确认 `~/.codex/config.toml` 中 `csp-ai-agent` 配置格式正确，且 Codex 能成功连接到 MCP Server。

**AI 执行步骤：**

```bash
# Step 1：读取 config.toml 中的 csp-ai-agent 配置节
grep -A 6 "\[mcp_servers.csp-ai-agent\]" ~/.codex/config.toml
```

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 配置节存在 | `[mcp_servers.csp-ai-agent]` 节在 config.toml 中存在 | | |
| url 字段使用 `/mcp` 端点 | `url = "https://zct-dev.zoomdev.us/csp-agent/mcp"`（dev）或 prod endpoint；**尾缀必须为 `/mcp`，不得为 `/sse`**（Codex 使用 Streamable HTTP，Cursor 才用 SSE）| | |
| url 不含 `/sse` 尾缀 | URL 中不出现 `/sse`（如有则配置错误，需改为 `/mcp`）| | |
| http_headers 包含 Authorization | `http_headers` 中含有 `Authorization = "Bearer ..."` | | |
| MCP 连接成功 | 在 Codex 中调用任意工具（如 `manage_subscription`）返回正常结果，不报 connection error | | |

---

#### Case C0-2：Rule 生效验证（csp-ai-prompts policy 注入）

**目的：** 验证订阅 `csp-ai-prompts` rule 后，sync 生成的 policy 通过 `merge_toml` action 注入到 `~/.codex/config.toml` 的 `developer_instructions` 字段，并且 Codex Agent **重启后**的新会话中该路由规则实际生效。

> ⚠️ **本 Case 横跨重启边界，分为重启前（Phase 1）和重启后（Phase 2）两个阶段。**  
> Phase 1 在当前会话中完成注入并保存检查点，然后用户重启 Codex；  
> Phase 2 在新会话中由用户输入恢复指令，Agent 读取检查点后继续验证。

---

**Phase 1（重启前，在当前 Codex 会话中执行）**

**Step C0-2-1：执行 sync，检查并应用 merge_toml action**

模拟用户语句：
> "小助手，帮我同步一下我的所有资源"

**AI 执行路径验证：**
1. 调用 `sync_resources(mode: "incremental", scope: "global")`
2. 检查返回的 `local_actions_required` 中是否包含 `merge_toml` action
3. 若有 `merge_toml` action，按指令更新 `~/.codex/config.toml` 的 `developer_instructions` 字段
4. 执行文件系统验证（见下表）

```bash
# 验证 developer_instructions 已写入
grep -A 5 "developer_instructions" ~/.codex/config.toml
```

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| sync 返回包含 merge_toml action | `local_actions_required` 中有 `action: "merge_toml"` | | |
| merge_toml 路径指向 config.toml | `path = "~/.codex/config.toml"` | | |
| merge_toml key 为 developer_instructions | `key = "developer_instructions"` | | |
| developer_instructions 写入成功 | `~/.codex/config.toml` 中包含 `developer_instructions` 字段 | | |
| policy 内容包含 CSP 路由规则 | developer_instructions 值中含有 "manage_subscription" 或 "CSP" 相关路由指令 | | |

**Step C0-2-2：保存 Release Check 重启检查点**

在应用 merge_toml 完成后，AI **必须**将当前进度写入检查点文件，然后提示用户重启：

```bash
# AI 执行：写入检查点文件
cat > ~/.codex/release-check-checkpoint.md << 'EOF'
# CSP Release Check 重启检查点

**状态：** 等待 Phase 2 验证
**当前进度：** Case C0-2 Phase 1 已完成，developer_instructions 已注入，等待重启后继续
**下一步：** Case C0-2 Phase 2 — 验证 csp-ai-prompts 路由规则在新会话中生效

## Phase 1 结果（重启前）

- sync 执行：✅ 已完成
- merge_toml action 返回：[填入实际结果]
- developer_instructions 写入：✅ 已确认
- config.toml 路径：~/.codex/config.toml

## Phase 2 待验证项

1. 在新会话中输入：「帮我 review 一下这个 MR」
2. 观察 Codex Agent 是否主动调用 manage_subscription(action: list)
3. 观察是否命中 zoom-code-review → 调用 resolve_prompt_content
4. 验证整个 C1–C10 Case 的行为与 Cursor 一致

## 恢复方式

重启 Codex 后，在新会话中输入：
「继续 Release Check，从 Case C0-2 Phase 2 开始」
EOF
echo "检查点已写入 ~/.codex/release-check-checkpoint.md"
```

**Step C0-2-3：提示用户重启 Codex**

AI 在完成上述步骤后，**必须**向用户展示以下提示，然后停止当前会话的 Release Check 流程：

```
✅ developer_instructions 已成功注入 ~/.codex/config.toml

⚠️ 需要重启 Codex 使路由规则生效。

【重启步骤】
1. 退出当前 Codex 会话（Ctrl+C 或关闭窗口）
2. 重新启动 Codex：codex
3. 在新会话中输入以下恢复指令：

   「继续 Release Check，从 Case C0-2 Phase 2 开始」

Codex 将自动读取检查点文件并继续验证路由规则是否生效。
检查点文件位置：~/.codex/release-check-checkpoint.md
```

---

**Phase 2（重启后，在新 Codex 会话中执行）**

**恢复触发语句（用户在新会话中输入）：**
> "继续 Release Check，从 Case C0-2 Phase 2 开始"

**AI 恢复步骤：**
1. 读取检查点文件 `~/.codex/release-check-checkpoint.md`，确认上次进度
2. 向用户确认："检测到 Release Check 检查点，Phase 1 已完成，现在开始 Phase 2 验证"
3. 执行 Phase 2 验证（见下）

**Step C0-2-4：验证路由规则在新会话中实际生效**

模拟用户语句：
> "帮我 review 一下这个 MR"（已订阅 `zoom-code-review`）

**预期 AI 执行路径：**
1. Codex Agent **主动**调用 `manage_subscription(action: list)` ← 这是 csp-ai-prompts rule 生效的直接证明
2. 订阅列表中命中 `zoom-code-review` → 调用 `resolve_prompt_content`
3. 按 zoom-code-review Skill 执行，**不**直接调用 helper 或本地工具

**Step C0-2-5：验证「呼叫小助手」触发路由**

模拟用户语句：
> "小助手，帮我出个包"（已订阅 `zoom-build`）

**预期 AI 执行路径：**
1. 识别唤起词「小助手」
2. **主动**调用 `manage_subscription(action: list)` ← 验证规则对唤起词也生效
3. 命中 `zoom-build` → 调用 `resolve_prompt_content`

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 检查点读取成功 | AI 能读取并复述上次进度 | | |
| 路由规则生效（review 触发） | 先调用 `manage_subscription(list)` 再命中 zoom-code-review | | |
| 不跳过 CSP 检查 | 不直接使用 helper 或本地工具 | | |
| 唤起词触发路由（小助手 + 出包） | 先调用 `manage_subscription(list)` 再命中 zoom-build | | |
| csp-ai-prompts 规则可追溯 | 调用链行为与 rule 中定义的优先级逻辑一致 | | |

**Step C0-2-6：清理检查点文件**

Phase 2 验证全部通过后，AI 删除检查点文件：

```bash
rm ~/.codex/release-check-checkpoint.md
echo "检查点已清理，继续 Case C0-3"
```

**⚠️ 若 Phase 2 验证失败：** 记录失败详情到 Report，不得清理检查点文件，以便复现排查。

---

#### Case C0-3：Skill 运行验证（zoom-build sync + 文件写入）

**目的：** 验证 Codex profile 下，skill 文件写入 Codex 专属路径 `~/.csp-ai-agent/codex/skills/`（与 Cursor 的 `~/.csp-ai-agent/skills/` **不同**），且 scripts 可执行权限正确。

模拟用户语句（在 Codex 中执行）：
> "小助手，帮我 sync 一下 zoom-build"

**AI 执行路径验证：**
1. 调用 `sync_resources(mode: "incremental", resource_ids: ["6dea7a2c8cf83e5d227ee39035411730"])`
2. 检查 `local_actions_required` 中的 `write_file` action，确认路径为 `~/.csp-ai-agent/codex/skills/zoom-build/`（Codex **专属**路径，与 Cursor 的 `~/.csp-ai-agent/skills/zoom-build/` 不同）
3. 执行 write_file actions，写入 scripts 和 teams 文件

**文件系统验证：**

```bash
ls ~/.csp-ai-agent/codex/skills/zoom-build/scripts/
ls ~/.csp-ai-agent/codex/skills/zoom-build/teams/
# 验证脚本可执行权限
ls -la ~/.csp-ai-agent/codex/skills/zoom-build/scripts/build-cli
# 确认 Cursor 路径下不存在（路径隔离验证）
ls ~/.csp-ai-agent/skills/zoom-build/ 2>&1 || echo "PASS: Cursor 路径下无 Codex skill 文件"
```

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| sync 正常返回 | success: true，details 包含 zoom-build | | |
| write_file 路径为 Codex 专属路径 | 路径为 `~/.csp-ai-agent/codex/skills/zoom-build/`（不是 `~/.csp-ai-agent/skills/` 也不是 `~/.codex/...`） | | |
| scripts 目录存在 | `~/.csp-ai-agent/codex/skills/zoom-build/scripts/` 含 build-cli 等文件 | | |
| teams 目录存在 | `~/.csp-ai-agent/codex/skills/zoom-build/teams/` 含 JSON 配置文件 | | |
| build-cli 可执行权限 | `-rwxr-xr-x`（755）| | |
| Cursor 路径隔离 | `~/.csp-ai-agent/skills/zoom-build/` 下无 Codex 写入的文件 | | |
| 无 merge_toml 用于 skill 路径 | skill 文件全部通过 write_file，不混入 merge_toml | | |

---

### Case C1–C10：Codex 平台回归测试

> 与 Part A（Cursor）完全相同的 10 个 Case，在 Codex CLI Agent 中重新执行。
>
> **执行方式：** 在 Codex 会话中，输入与 Part A 相同的模拟用户语句，验证相同的预期行为。
>
> **Codex 特有差异点（执行前知悉）：**
> - Case 9（jenkins 取消订阅）：验证 `~/.codex/config.toml` 中是否有对应 `[mcp_servers.jenkins]` 条目被清理（而非 `~/.cursor/mcp.json`）
> - Case C0-2 中 `developer_instructions` 已写入，是 Codex 与 Cursor 的核心区别
> - 其余 Case 行为应与 Cursor 完全一致

| Case | 说明 | Codex 特有验证点 | 通过？ |
|------|------|----------------|--------|
| C1 | 全量 incremental sync | 同 Cursor；额外确认无 Cursor 特有路径写入（无 `~/.cursor/rules/` 写入） | |
| C2 | 单资源 sync | 同 Cursor | |
| C3 | 复杂 Skill sync（zoom-build） | **Codex 特有**：文件写入 `~/.csp-ai-agent/codex/skills/zoom-build/`，非 Cursor 的 `~/.csp-ai-agent/skills/zoom-build/` | |
| C4 | 搜索 → 订阅 → Prompt 刷新 | 同 Cursor | |
| C5 | 取消订阅 → 文件清理 | **Codex 特有**：清理路径为 `~/.csp-ai-agent/codex/skills/zoom-build/`，非 Cursor 的 `~/.csp-ai-agent/skills/zoom-build/` | |
| C6 | 模糊调用路由（CSP 优先） | 验证 policy 注入生效（见 C0-2），Codex Agent 主动调用 manage_subscription | |
| C7 | Telemetry 计数 | 额外验证 telemetry payload 中 `agent_profile = "codex"` | |
| C8 | Sync 内容一致性 | 同 Cursor（manifest 版本验证） | |
| C9 | 取消订阅 MCP 资源 | **Codex 特有**：验证 `config.toml` 中对应 `[mcp_servers.jenkins]` 节被清理，而非 mcp.json | |
| C10 | winzr-cpp-expert 懒加载链路 | 同 Cursor，验证 md 引用替换和 resource_path 子调用 | |

**Telemetry agent_profile 专项验证（Case C7 扩展）：**

在 Codex 中调用任意资源后，验证 telemetry 数据中 `agent_profile` 字段值为 `"codex"`：

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| telemetry 调用成功 | `usage_tracked: true` | | |
| agent_profile 字段 | payload 中 `agent_profile = "codex"`（不是 `"cursor"`） | | |

---

## 注意事项

1. **本 checklist 为手动 Agent 交互测试**，AI 根据用户的自然语言触发，不是自动化脚本
2. **AI 不得提前告知用户它将做什么操作**，应模拟真实响应链路
3. **订阅快照必须在第一步记录**，测试过程中不得覆盖
4. **Case 10 / C10 为 Bug 回归验证**，是本版本发布的关键 Check 项，必须通过
5. **Case 9 / C9 执行后**必须在收尾阶段重新订阅 `jenkins` 并 sync，以恢复配置
6. **Case C0-2 横跨重启边界**：Phase 1 完成注入后，AI 必须写入检查点文件 `~/.codex/release-check-checkpoint.md` 并提示用户重启 Codex。重启后用户输入「继续 Release Check，从 Case C0-2 Phase 2 开始」触发 Phase 2 验证。Phase 2 验证通过后 AI 删除检查点文件
7. **Part B Case C7 必须验证 `agent_profile = "codex"`**：这是 CODEX-001 核心 telemetry 验证项
8. **所有 Case 结果填写到 Report 文件中**：`Test/Release Check/Reports/release-check-report-YYYY-MM-DD.md`，Part A 和 Part B 分区记录
9. **两种客户端使用不同 Transport 和 URL 端点（重要）**：
   - **Cursor（Part A）**：SSE transport → URL 尾缀为 `/sse`，配置在 `~/.cursor/mcp.json`
   - **Codex（Part B）**：Streamable HTTP transport → URL 尾缀为 `/mcp`，配置在 `~/.codex/config.toml`
   - 两者 URL 路径不可互换，Codex 中若配置为 `/sse` 将导致连接失败
