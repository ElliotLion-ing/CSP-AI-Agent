# CSP AI Agent 手动交互测试流程

**版本：** 1.2.0  
**类型：** 手动 Agent 交互测试（Human-in-the-loop）  
**触发方式：** 服务部署完成后，用户手动触发 AI 按照本流程执行  
**测试目标：** 模拟真实用户与 Agent 的对话交互，验证 CSP AI Agent 的核心行为链路

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

> AI 在执行前需调用 `manage_subscription(action: list)` 确认当前哪些资源已订阅，据此决定测试路径（订阅状态影响部分 case 的前置操作）。

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
# 预期存在：SKILL.md、scripts/ 等目录
```

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| sync 触发 | 仅 zoom-build 的 resource_id | | |
| SKILL.md 存在 | `~/.csp-ai-agent/skills/zoom-build/SKILL.md` | | |
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

**Telemetry 验证（AI 执行后检查）：**

调用 `query_usage_stats` 或等效 API，确认该资源的调用计数 +1：

```
调用前计数: N
调用后计数: N+1
```

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| resolve_prompt_content 被调用 | 使用 resource_id 调用 | | |
| telemetry 计数递增 | 调用后计数 +1 | | |
| 未走本地文件路径 | 不直接读 `~/.csp-ai-agent/` 文件 | | |

---

### Case 8：Sync 内容一致性验证（本地 vs 远端 Git）

**前置条件：** `zoom-build` 已订阅并完成 sync（Case 3 之后执行）

**目的：** 验证 sync 下来的本地文件与 CSP GitLab 仓库中的最新版本完全一致，确保 sync 机制没有拉到旧版或缓存内容。

**远端 Git 地址：** `https://git.zoom.us/main/csp/-/tree/main/ai-resources/skills/zoom-build`

---

**Step 8-1：读取本地 manifest 版本信息**

AI 执行：
```bash
head -10 ~/.csp-ai-agent/.manifests/zoom-build.md
```

记录以下字段：
- `version`：如 `3.3.0`
- `description`：skill 描述的前 50 个字符

---

**Step 8-2：读取本地关键文件的特征值**

AI 执行以下命令，提取用于对比的特征值：

```bash
# SKILL.md（manifest 本身）行数 + 前 5 行
wc -l ~/.csp-ai-agent/.manifests/zoom-build.md
head -5 ~/.csp-ai-agent/.manifests/zoom-build.md

# scripts 目录文件列表 + 各文件大小
ls -la ~/.csp-ai-agent/skills/zoom-build/scripts/

# teams 目录文件列表
ls -la ~/.csp-ai-agent/skills/zoom-build/teams/

# build-cli 文件前 3 行（版本注释 / shebang）
head -3 ~/.csp-ai-agent/skills/zoom-build/scripts/build-cli

# 其中一个 team 配置的版本字段（如 client-android.json）
grep -m 3 '"version"\|"team"\|"name"' ~/.csp-ai-agent/skills/zoom-build/teams/client-android.json
```

---

**Step 8-3：通过 helper-gitlab 拉取远端 Git 内容**

AI 使用 GitLab MCP 工具获取远端文件内容，与本地对比：

```
# 获取远端 SKILL.md（ai-resources/skills/zoom-build/SKILL.md）
helper_gitlab get_file_content:
  repo: main/csp
  file_path: ai-resources/skills/zoom-build/SKILL.md
  ref: main

# 获取远端 scripts/ 目录结构
helper_gitlab list_directory:
  repo: main/csp
  path: ai-resources/skills/zoom-build/scripts
  ref: main

# 获取远端 teams/client-android.json
helper_gitlab get_file_content:
  repo: main/csp
  file_path: ai-resources/skills/zoom-build/teams/client-android.json
  ref: main
```

---

**Step 8-4：对比分析**

AI 对比以下维度：

| 对比项 | 本地值 | 远端值 | 一致？ |
|--------|--------|--------|--------|
| manifest `version` 字段 | | | |
| manifest `description` 前 50 字符 | | | |
| `scripts/` 文件数量 | | | |
| `scripts/build-cli` 文件大小 | | | |
| `teams/` 文件数量 | | | |
| `teams/client-android.json` 的 `"version"` 字段 | | | |

---

**判定规则：**

- **PASS**：所有对比项一致（或本地 version ≥ 远端 version，说明同步及时）
- **FAIL**：任意一项不一致，说明 sync 拉取的不是最新版本，需进一步排查：
  - 是否 Git 仓库 branch/ref 配置错误？
  - 是否存在 manifest hash 未变化导致 incremental sync 跳过？
  - 是否服务端 prompt cache 未及时失效？

---

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| manifest version 与远端一致 | 版本号相同 | | |
| manifest description 与远端一致 | 描述内容相同 | | |
| scripts 目录文件数量一致 | 与远端 scripts/ 条目数相同 | | |
| build-cli 文件大小一致 | 字节数相同 | | |
| teams 目录文件数量一致 | 与远端 teams/ 条目数相同 | | |
| team config version 字段一致 | release_branch / version 相同 | | |

---

### Case 9：取消订阅 MCP 类型资源 → mcp.json 条目清理

**前置条件：** 订阅列表中存在 `acm`（type: mcp）资源，且 `~/.cursor/mcp.json` 中已有对应的 `mcpServers.acm` 条目

**模拟用户语句：**
> "小助手，帮我取消 acm 这个 MCP 的订阅"

**Step 9-1：记录取消前 mcp.json 中的 acm 条目**

AI 执行：
```bash
# 读取当前 mcp.json 中 acm 相关条目（仅展示 key，不展示完整内容避免泄露）
python3 -c "
import json, os
path = os.path.expanduser('~/.cursor/mcp.json')
with open(path) as f:
    d = json.load(f)
servers = d.get('mcpServers', {})
acm_keys = [k for k in servers.keys() if 'acm' in k.lower()]
print('ACM-related keys in mcp.json:', acm_keys)
"
```

记录：`mcp.json` 中 acm 相关的 key 列表（如 `acm`、`acm-dev`）

---

**Step 9-2：执行取消订阅**

AI 执行路径：
1. 调用 `manage_subscription(action: list)` 确认 `acm` 在订阅列表中
2. 调用 `manage_subscription(action: "unsubscribe", resource_ids: ["<acm 的 resource_id>"])`
3. 检查返回的 `local_actions_required` 中是否包含 `remove_mcp_json_entry` 操作
4. 执行 `remove_mcp_json_entry`：从 `~/.cursor/mcp.json` 中移除 `mcpServers.acm` 条目

---

**Step 9-3：验证 mcp.json 条目已清理**

AI 执行：
```bash
python3 -c "
import json, os
path = os.path.expanduser('~/.cursor/mcp.json')
with open(path) as f:
    d = json.load(f)
servers = d.get('mcpServers', {})
acm_present = 'acm' in servers
print('acm still in mcp.json:', acm_present)
print('Remaining keys:', list(servers.keys()))
"
```

预期：`acm still in mcp.json: False`（acm 条目已从 mcp.json 中移除）

---

**结果对照表：**

| 验证项 | 预期行为 | 实际结果 | 通过？ |
|--------|----------|----------|--------|
| 订阅列表中移除 acm | `manage_subscription(list)` 不再返回 acm | | |
| local_actions 包含 remove_mcp_json_entry | 返回中有 `action: "remove_mcp_json_entry"` | | |
| mcp.json 条目已删除 | `mcpServers.acm` 不存在 | | |
| 其他 mcp.json 条目不受影响 | 其他 MCP server 配置保持不变 | | |

> **注意：** 测试完成后必须在收尾阶段重新订阅 `acm` 并执行 `sync_resources` 以恢复 `mcp.json` 中的 acm 配置。

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
Case 8：Sync 内容一致性验证（本地 vs 远端 Git）  ← 紧接 Case 3 之后
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
收尾：恢复订阅状态到测试前快照（含 acm mcp.json 配置恢复）
```

---

## 收尾：恢复订阅状态

测试结束后，AI 必须执行以下恢复步骤：

### Step 1：获取当前订阅列表

```
调用 manage_subscription(action: list)
```

### Step 2：对比快照，计算差异

```
测试前快照 vs 当前列表
需要重新订阅的 = 快照中有 but 当前没有
需要取消订阅的 = 快照中没有 but 当前有
```

### Step 3：执行恢复操作

```
若有需要重新订阅的：调用 manage_subscription(action: subscribe, resource_ids: [...])
若有需要取消的：    调用 manage_subscription(action: unsubscribe, resource_ids: [...])
```

### Step 4：验证恢复成功

```
再次调用 manage_subscription(action: list)
对比结果与快照，确认完全一致
```

---

## 测试报告模板

测试完成后，AI 输出以下报告（直接展示，不需要生成 md 文件）：

```
=== CSP AI Agent 手动交互测试报告 ===
测试时间：YYYY-MM-DD HH:mm
服务版本：v0.x.x

Case 1 - 全量 incremental sync：             ✅ PASS / ❌ FAIL
Case 2 - 单资源 sync：                       ✅ PASS / ❌ FAIL
Case 3 - 复杂 skill 文件写入：               ✅ PASS / ❌ FAIL
Case 8 - Sync 内容一致性（本地 vs Git）：    ✅ PASS / ❌ FAIL
Case 4 - 搜索 → 订阅 → Prompt 刷新：        ✅ PASS / ❌ FAIL
Case 5 - 取消订阅 → 清理：                  ✅ PASS / ❌ FAIL
Case 6 - 模糊调用路由：                     ✅ PASS / ❌ FAIL
Case 7 - Telemetry 计数：                   ✅ PASS / ❌ FAIL
Case 9 - MCP 取消订阅 → mcp.json 清理：    ✅ PASS / ❌ FAIL

失败项详情：
- Case X：[具体失败原因]

订阅状态恢复：✅ 已恢复 / ❌ 恢复失败
```

---

## 注意事项

1. **本测试为手动 Agent 交互测试**，AI 根据用户的自然语言触发，不是自动化脚本
2. **AI 不得提前告知用户它将做什么操作**，应模拟真实响应链路
3. **订阅快照必须在第一步记录**，测试过程中不得覆盖
4. **Case 3 和 Case 5 的文件系统检查**由 AI 通过 Shell 命令执行，结果展示给用户
5. **Case 6 需要临时调整订阅状态**，操作前告知用户会临时取消某订阅用于测试
6. **Telemetry 验证**如果服务端没有暴露查询接口，可以通过日志确认（查看服务端 Logs 目录）
7. **Case 8 远端对比** 需要 helper-gitlab 工具可用且有访问 `git.zoom.us/main/csp` 的权限；若 GitLab 不可达，可手动打开 `https://git.zoom.us/main/csp/-/tree/main/ai-resources/skills/zoom-build` 对比文件大小和版本号
8. **Case 9 执行后**必须在收尾阶段重新订阅 `acm` 并 sync，以确保 `mcp.json` 中的 acm 配置被正确恢复；此 Case 会临时使 acm MCP 从 Cursor 配置中消失，应告知用户
