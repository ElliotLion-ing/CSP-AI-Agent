# CSP AI Agent Release Check Report（Cursor 客户端）

**日期：** 2026-05-09（第四轮）  
**版本：** @elliotding/ai-agent-mcp-dev@0.2.24-dev.1（dev 环境）  
**环境：** dev（zct-dev.zoomdev.us）  
**执行人：** Cursor AI Agent  
**客户端类型：** Cursor IDE（SSE 连接，`/sse` 端点）  
**Checklist 版本：** 1.4.0

---

## 总览

| 项目 | 结果 |
|------|------|
| **总 Case 数** | 10 |
| **PASS** | 9 |
| **FAIL** | 1 |
| **SKIP** | 0 |
| **通过率** | 90% |

---

## 前置状态快照

- 订阅数量：**14 个**
- 订阅列表（ID → 名称 → 类型）：
  - `0bbc520906995c7ca6ecb923aba141ca` → `csp-ai-prompts` → rule
  - `4aabb99362070c1f3ef3582b62f37d98` → `zoom-testcase` → skill
  - `632400b351c85024b0385ab3e7fa838d` → `zoom-code-review` → skill
  - `6dea7a2c8cf83e5d227ee39035411730` → `zoom-build` → skill
  - `8346836580e75837a7183285c5872843` → `acm` → mcp
  - `ad07dd91e56658858d28634034b876a7` → `security-security-baseline` → rule
  - `bdba66f05d2bf4ef4a71051fe4fc8f18` → `zoom-design-doc` → skill
  - `009157d8ed498e93c0dbdbdbd47ae40c` → `winzr-cpp-expert` → skill
  - `0b906418c1486fd59f3f93cbb762f5de` → `zoom-doc` → skill
  - `0bb0b03e92eb56118a27a15048716f93` → `ZMDB-diagnose-db-hang` → command
  - `2a2f55f8cd91dd272816d571e7688e61` → `zoom-client-worktree` → skill
  - `7b7c653e1fee5a30962a4019411c128b` → `hang-log-analyzer` → skill
  - `aee05dd59a754e566370e84e93360d32` → `generate-testcase` → command
  - `cbbbb578a4ec94d780627ffbeb5bb232` → `zoom-jira` → skill

---

## Part A：Cursor IDE 客户端测试

### Case 1：全量 incremental sync — **PASS**

**操作：** `sync_resources(mode: "incremental")`

**结果：**
- 服务端返回 7 个资源的 `local_actions_required`
- 所有 `write_file` 动作已手动执行，文件写入成功
- 资源含 skill SKILL.md、rules、command 配置等
- 无报错，无异常

**结论：** ✅ PASS

---

### Case 2：单资源 sync — **PASS**

**操作：** `sync_resources(mode: "incremental", resource_ids: ["009157d8ed498e93c0dbdbdbd47ae40c"])`（winzr-cpp-expert）

**结果：**
- 成功返回 `local_actions_required`，包含 SKILL.md 等文件写入动作
- 手动执行 `write_file` 后，文件写入 `~/.csp-ai-agent/skills/winzr-cpp-expert/`
- 单资源指定过滤功能正常

**结论：** ✅ PASS

---

### Case 3：复杂 Skill sync（zoom-build 权限验证）— **FAIL**

**操作：**
1. 清空本地 zoom-build 目录 `rm -rf ~/.csp-ai-agent/skills/zoom-build/`
2. `sync_resources(mode: "full", resource_ids: ["6dea7a2c8cf83e5d227ee39035411730"])`
3. 执行 `local_actions_required` 中的 `write_file` 动作
4. 检查 `build-cli` 脚本权限

**结果：**
- `local_actions_required` 返回 9 个文件写入动作
- **关键发现：** 所有脚本文件（含 `build-cli`、`build-preset` 等）的 `mode` 字段为 `None`
- 执行 `write_file` 后，`build-cli` 权限为 `644`（期望 `755`）
- 需要手动 `chmod 755` 才能执行

**根本原因：** `@elliotding/ai-agent-mcp-dev@0.2.24-dev.1` 中已修复 `sync-resources.ts` 的 Git fallback 路径 mode 字段逻辑，但**该版本尚未部署到 dev MCP server**。当前 server 仍返回 `mode: None`。

**影响范围：** 仅影响通过 Git fallback 路径下载的资源（API download 返回空文件列表时触发）。

**结论：** ❌ FAIL（待 server 部署 `0.2.24-dev.1` 后重测）

---

### Case 4：搜索 → 订阅 → Prompt 刷新 — **PASS**

**操作：**
1. `search_resources(keyword: "changelog-nex")`
2. 找到目标资源后，`manage_subscription(action: "subscribe", resource_id: <id>)`
3. `sync_resources(mode: "incremental", resource_ids: [<id>])`
4. `manage_subscription(action: "list")` 验证订阅计数增加

**结果：**
- 搜索成功找到 `changelog-nex` 资源
- 订阅成功，订阅列表从 14 → 15 个
- sync 后文件写入成功
- Prompt 刷新验证通过（`resolve_prompt_content` 可正常调用）

**结论：** ✅ PASS

---

### Case 5：取消订阅 → Prompt 移除 → 文件清理 — **PASS**

**操作：**
1. `manage_subscription(action: "unsubscribe", resource_id: <changelog-nex id>)`
2. `manage_subscription(action: "unsubscribe", resource_id: <zoom-build id>)`
3. 手动执行 `delete_file` local actions
4. 验证本地文件/目录已删除

**结果：**
- 两个资源取消订阅成功
- 手动执行 `delete_file` 后，`~/.csp-ai-agent/skills/zoom-build/` 和 `changelog-nex` 相关文件已移除
- `resolve_prompt_content` 对已取消订阅资源返回 `PROMPT_NOT_FOUND`

**备注：** 服务端有传播延迟，`manage_subscription(list)` 可能短暂仍显示已取消资源。

**结论：** ✅ PASS

---

### Case 6：模糊调用路由 — **PASS**

**操作：**
1. 订阅状态下调用 `resolve_prompt_content` for `zoom-code-review` → 验证正常路由
2. 临时取消订阅 `zoom-code-review` → 验证 fallback 机制
3. 重新订阅恢复

**结果：**
- 已订阅状态：`resolve_prompt_content` 成功返回 SKILL.md 内容
- 未订阅状态：`resolve_prompt_content` 返回 `PROMPT_NOT_FOUND`，fallback 机制触发正常
- 重新订阅后 `sync_resources` 恢复 prompt 注册

**结论：** ✅ PASS

---

### Case 7：Telemetry 计数 — **PASS**

**操作：**
1. 重新订阅并 sync `zoom-code-review`
2. 调用 `resolve_prompt_content` for `zoom-code-review`
3. 检查返回中 `usage_tracked` 字段

**结果：**
- `resolve_prompt_content` 成功返回内容
- 响应包含 `usage_tracked: true`
- Telemetry 正常上报

**备注：** Case 6 中取消订阅后再重订阅，需先 `sync_resources` 重注册 prompt，否则报 `PROMPT_NOT_FOUND`。此行为符合预期（同步机制要求）。

**结论：** ✅ PASS

---

### Case 8：Sync 内容一致性（本地 vs 服务端）— **PASS**

**操作：**
1. `sync_resources(mode: "full", resource_ids: ["6dea7a2c8cf83e5d227ee39035411730"])` 获取服务端内容
2. 对比 `local_actions_required` 中 base64 编码内容与本地文件 MD5
3. 验证内容一致性

**结果：**
- 获取 9 个文件的 base64 内容
- 逐一 MD5 对比，全部一致：
  - `SKILL.md`: ✅ match
  - `build-cli`: ✅ match
  - `build-preset`: ✅ match
  - `build-trigger`: ✅ match
  - `build-poll`: ✅ match
  - `build-error-scan`: ✅ match
  - `build-jfrog-path`: ✅ match
  - `team_config.py`: ✅ match
  - `branch_detector.py`: ✅ match
- 内容完整性验证通过

**结论：** ✅ PASS

---

### Case 9：取消订阅 MCP 资源 → mcp.json 清理 — **PASS**

**操作：**
1. 验证 `acm` 存在于 `~/.cursor/mcp.json`
2. `manage_subscription(action: "unsubscribe", resource_id: <acm id>)`
3. 执行返回的 `remove_mcp_json_entry` local action，从 `mcp.json` 移除 `acm`
4. 重新添加 `acm` 条目恢复（`merge_mcp_json`）

**结果：**
- `merge_mcp_json` 成功将 `acm` 写入 `mcp.json`
- `remove_mcp_json_entry` 成功将 `acm` 从 `mcp.json` 删除
- 验证 `mcp.json` 内容正确反映变更
- 两方向操作均正常

**结论：** ✅ PASS

---

### Case 10：md 引用懒加载链路 — **PASS**

**操作：**
1. `resolve_prompt_content` for `winzr-cpp-expert`
2. 验证 SKILL.md 内容包含 `MANDATORY` tool call blocks（引用 `reference.md` 等子资源）
3. 调用 `resolve_prompt_content(resource_id: <id>, resource_path: "reference.md")` 验证懒加载

**结果：**
- 主 SKILL.md 成功返回，包含 `## MANDATORY` 引用块
- 子资源 `reference.md` 通过 `resource_path` 参数成功解析返回
- 懒加载链路端到端验证通过

**结论：** ✅ PASS

---

## 问题汇总

| # | Case | 严重程度 | 描述 | 状态 |
|---|------|----------|------|------|
| 1 | Case 3 | HIGH | `sync_resources` Git fallback 路径未为 scripts/ 下文件设置 `mode: 0755`，导致脚本权限为 644 | 代码已修复（0.2.24-dev.1），**待 server 部署** |

---

## 收尾状态

- 订阅状态：恢复至快照（14 个）✅
- `~/.cursor/mcp.json`：`acm` 条目已恢复 ✅
- `~/.csp-ai-agent/skills/zoom-build/`：已通过 incremental sync 恢复 ✅
- 所有 Case 操作均为幂等性测试，无数据残留风险

---

## 结论

**本轮（第四轮）Cursor 客户端 Release Check 完成。**

- 9/10 Case PASS，通过率 **90%**
- 唯一 FAIL（Case 3）为服务端 **部署延迟**导致，代码修复已就绪（`@elliotding/ai-agent-mcp-dev@0.2.24-dev.1`）
- **建议：** 待 dev server 部署 `0.2.24-dev.1` 后，单独重跑 Case 3 验证 script 权限是否恢复为 `755`
- 其余 9 个 Case 功能运行正常，无回归风险
