# 全链路调用记录 — 2026-03-27 会话

> 记录本次 Cursor AI Agent 会话中所有 MCP 工具调用、本地文件操作及关键判断节点。

---

## 会话概览

| 项目 | 内容 |
|------|------|
| 日期 | 2026-03-27 |
| 涉及 MCP Server | `user-csp-ai-agent` |
| 操作类型 | 资源全量同步、Command 调用、Skill 调用 |

---

## Round 1 — 同步所有资源（`sync` 全量）

### 用户指令
> "小助手，帮我 sync 所有资源"

### 调用链

#### Step 1 · 工具发现
- 读取 MCP 服务器目录：`/Users/ElliotDing/.cursor/projects/.../mcps/user-csp-ai-agent/`
- 读取 schema 文件：`tools/sync_resources.json`
- 确认参数：`mode: full | scope: all`

#### Step 2 · MCP Tool 调用
```
Tool:   user-csp-ai-agent / sync_resources
Args:   { "mode": "full", "scope": "all" }
```

**返回结果：**
```json
{
  "success": true,
  "data": {
    "mode": "full",
    "health_score": 100,
    "summary": { "total": 7, "synced": 7, "cached": 0, "failed": 0 },
    "details": [
      { "name": "csp-ai-prompts",           "action": "synced" },
      { "name": "ZMDB-log-analyze",          "action": "synced" },
      { "name": "hang-log-analyzer",         "action": "synced" },
      { "name": "acm",                       "action": "synced" },
      { "name": "security-security-baseline","action": "synced" },
      { "name": "zoom-design-doc",           "action": "synced" },
      { "name": "ACM-Helper",                "action": "synced" }
    ],
    "local_actions_required": [...]
  }
}
```

#### Step 3 · 本地文件操作（执行 local_actions_required）

**Hash 校验 — csp-ai-prompts.mdc：**
- 本地 hash：`a94b1188d407061b86e57c94c365d156166eb871291195c79d612f9b3efdda71`
- 服务端 hash：`3f0535ad1e578867b24d240ea855b2664b66b0b0afb888517864698327159c74`
- 结果：**不一致 → 执行写入**
- 写入路径：`~/.cursor/rules/csp-ai-prompts.mdc` ✅

**Hash 校验 — security-security-baseline.mdc：**
- 本地 hash：`9c8cc6fac224f7adadf143ef45b20e2753a0b1f6d1ec4027391805923047fdd7`
- 服务端 hash：`1c6aad23a0e4c6c0e7e2571380e8fcecb0effcec85b6f9c294f2b049f5613789`
- 结果：**不一致 → 执行写入**
- 写入路径：`~/.cursor/rules/security-security-baseline.mdc` ✅

**MCP 配置合并 — ~/.cursor/mcp.json：**
- 检查 `acm` 是否存在：`False` → **新增**
  ```json
  "acm": { "url": "https://zct.zoomdev.us/sse", "transport": "sse", "headers": {} }
  ```
- 检查 `acm-dev` 是否存在：`False` → **新增**
  ```json
  "acm-dev": { "url": "https://zct-dev.zoomdev.us/sse", "transport": "sse" }
  ```
- 写回 `~/.cursor/mcp.json` ✅

#### 同步结果
- 健康度：**100 分**
- 7/7 全部 synced，0 失败，0 pending_setup

---

## Round 2 — 调用 ACM-Helper Command

### 用户指令
> `/user-csp-ai-agent/command/acm-helper`

### 调用链

#### Step 1 · Prompt 描述文件读取
- 读取：`mcps/user-csp-ai-agent/prompts/command_acm-helper.json`
- 确认：name=`command/acm-helper`，参数=`jira_id`（可选）

#### Step 2 · MCP Tool 调用
```
Tool:   user-csp-ai-agent / track_usage
Args:   {
  "resource_id":   "cee745c647d85ad497a40308a8d2f001",
  "resource_type": "command",
  "resource_name": "ACM-Helper"
}
```
**返回：** `{ "success": true, "data": { "recorded": true } }` ✅

#### Step 3 · Prompt 内容获取（受限）
- 尝试调用 `prompts/get`（MCP Prompts 协议原语）→ **工具不存在**
- 原因：`prompts/get` 是 Cursor 客户端负责的 MCP 协议层，非 Agent 可直接调用的 Tool
- 检索本地 skill 文件（`~/.cursor/skills/`）→ **未找到 ACM-Helper 本地文件**
- 检索 `~/.cursor/mcp.json` 中 acm/acm-dev server → **刚写入，Cursor 尚未加载**

#### 结论与阻断原因
- ACM-Helper 作为 MCP Prompt 注册，需 Cursor 客户端通过 `/` 触发获取 prompt 内容
- **需重启 Cursor** 使 acm/acm-dev MCP server 生效后，通过 `/command/acm-helper` 使用

---

## Round 3 — 调用 hang-log-analyzer Skill

### 用户指令
> `/user-csp-ai-agent/skill/hang-log-analyzer`

### 调用链

#### Step 1 · Prompt 描述文件读取
- 读取：`mcps/user-csp-ai-agent/prompts/skill_hang-log-analyzer.json`
- 确认：name=`skill/hang-log-analyzer`，参数=`jira_id`（可选）

#### Step 2 · MCP Tool 调用
```
Tool:   user-csp-ai-agent / track_usage
Args:   {
  "resource_id":   "7b7c653e1fee5a30962a4019411c128b",
  "resource_type": "skill",
  "resource_name": "hang-log-analyzer"
}
```
**返回：** `{ "success": true, "data": { "recorded": true } }` ✅

#### Step 3 · Skill 内容获取（受限）
- 读取本地已安装 skill 文件（`zoom-ts-log-skill/SKILL.md`）→ 为不同 skill，仅供参考
- 搜索本地 `~/.cursor/skills/`、`~/.agents/`、`~/.aicompanion/` → **未找到 hang-log-analyzer 本地文件**
- 全局 `find` 搜索 `*hang*log*` → 仅找到 prompt descriptor JSON，无内容文件

#### 结论与阻断原因
- `hang-log-analyzer` skill 内容存储在 CSP 服务器端，通过 MCP Prompts 协议动态注入
- Agent 模式下无法直接获取 MCP Prompt 内容
- **正确使用方式：** 在 Cursor Chat 输入框输入 `/skill/hang-log-analyzer` 并附上 log 内容

---

## 关键发现 & 问题点

| # | 问题 | 影响 | 建议 |
|---|------|------|------|
| 1 | Rule 文件 hash 不一致，本地版本落后 | csp-ai-prompts、security-baseline 行为可能与服务端不符 | 本次已修复，写入最新版本 |
| 2 | acm/acm-dev 未在 mcp.json 中配置 | ACM-Helper command 无法工作 | 本次已添加，需重启 Cursor 生效 |
| 3 | MCP Prompts 在 Agent 模式下不可直接调用 | Command/Skill 调用无法在 Agent 模式中自动展开 prompt | 需通过 Cursor 输入框 `/` 触发 |

---

## 文件操作汇总

| 文件路径 | 操作 | 状态 |
|---------|------|------|
| `~/.cursor/rules/csp-ai-prompts.mdc` | 覆盖写入（hash 变更） | ✅ 完成 |
| `~/.cursor/rules/security-security-baseline.mdc` | 覆盖写入（hash 变更） | ✅ 完成 |
| `~/.cursor/mcp.json` | 合并写入 acm + acm-dev | ✅ 完成 |

---

## MCP Tool 调用汇总

| 调用序号 | Server | Tool | 参数摘要 | 结果 |
|---------|--------|------|---------|------|
| 1 | user-csp-ai-agent | `sync_resources` | mode=full, scope=all | ✅ 7/7 synced |
| 2 | user-csp-ai-agent | `track_usage` | ACM-Helper / command | ✅ recorded |
| 3 | user-csp-ai-agent | `prompts/get` | command/acm-helper | ❌ tool not found |
| 4 | user-csp-ai-agent | `track_usage` | hang-log-analyzer / skill | ✅ recorded |
