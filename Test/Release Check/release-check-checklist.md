# CSP AI Agent Release Check Checklist

**版本：** 1.3.0  
**类型：** 发布前手动 Release Check（Human-in-the-loop）  
**触发方式：** 每次发布到生产环境前，必须先在 **dev 环境**手动通知 Agent 按照本 checklist 执行  
**测试目标：** 验证 CSP AI Agent 核心行为链路、关键 Bug 修复、md 引用懒加载链路正确性  
**报告存放：** `Test/Release Check/Reports/release-check-report-YYYY-MM-DD.md`

---

> ⚠️ **强制要求**：每次 npm 发布并通知服务端部署 dev 环境完成后，**必须先执行本 checklist 全部 Case 并通过，才能发布到生产环境**。

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

**前置条件：** 订阅列表中存在 `acm`（type: mcp）资源，且 `~/.cursor/mcp.json` 中已有对应条目

**模拟用户语句：**
> "小助手，帮我取消 acm 这个 MCP 的订阅"

**AI 执行路径验证：**
1. 调用 `manage_subscription(action: "unsubscribe", resource_ids: ["<acm id>"])`
2. 检查 local_actions 中包含 `remove_mcp_json_entry`
3. 执行后验证 `mcpServers.acm` 已从 mcp.json 移除

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 订阅列表中移除 acm | `manage_subscription(list)` 不再返回 acm | | |
| local_actions 包含 remove_mcp_json_entry | 返回中有该 action | | |
| mcp.json 条目已删除 | `mcpServers.acm` 不存在 | | |
| 其他 mcp.json 条目不受影响 | 其他 MCP server 配置保持不变 | | |

> **注意：** 测试完成后必须在收尾阶段重新订阅 `acm` 并执行 `sync_resources` 以恢复配置。

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

```
前置：快照订阅状态
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
Case 10：winzr-cpp-expert md 引用懒加载链路验证 🆕
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

## 注意事项

1. **本 checklist 为手动 Agent 交互测试**，AI 根据用户的自然语言触发，不是自动化脚本
2. **AI 不得提前告知用户它将做什么操作**，应模拟真实响应链路
3. **订阅快照必须在第一步记录**，测试过程中不得覆盖
4. **Case 10 为 Bug 回归验证**，是本版本发布的关键 Check 项，必须通过
5. **Case 9 执行后**必须在收尾阶段重新订阅 `acm` 并 sync，以恢复 mcp.json 配置
6. **所有 Case 结果填写到 Report 文件中**：`Test/Release Check/Reports/release-check-report-YYYY-MM-DD.md`
