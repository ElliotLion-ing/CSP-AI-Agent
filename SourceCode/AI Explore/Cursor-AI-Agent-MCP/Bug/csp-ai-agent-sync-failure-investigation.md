# CSP AI Agent Sync 失败调查记录

**日期：** 2026-03-25  
**问题：** `csp-ai-prompts` 和 `acm` 两个资源在 full sync 时服务端返回 `failed`

---

## 一、问题背景

用户执行"sync 所有资源"操作，调用 `user-csp-ai-agent` MCP 的 `sync_resources` 工具，以 `mode: full, scope: all` 参数同步全部 7 个订阅资源。结果 5 个成功，2 个失败。

---

## 二、完整调用链路

### Step 1 — 查询订阅列表

**调用：**
```json
{
  "tool": "manage_subscription",
  "server": "user-csp-ai-agent",
  "arguments": { "action": "list" }
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "subscriptions": [
      { "id": "0bbc520906995c7ca6ecb923aba141ca", "name": "csp-ai-prompts",           "type": "rule"    },
      { "id": "0ccd800f60705676a305eeb3824b2d9c", "name": "ZMDB-log-analyze",         "type": "command" },
      { "id": "7b7c653e1fee5a30962a4019411c128b", "name": "hang-log-analyzer",        "type": "skill"   },
      { "id": "8346836580e75837a7183285c5872843", "name": "acm",                       "type": "mcp"     },
      { "id": "ad07dd91e56658858d28634034b876a7", "name": "security-security-baseline","type": "rule"    },
      { "id": "bdba66f05d2bf4ef4a71051fe4fc8f18", "name": "zoom-design-doc",           "type": "skill"   },
      { "id": "cee745c647d85ad497a40308a8d2f001", "name": "ACM-Helper",               "type": "command" }
    ],
    "message": "Found 7 subscriptions"
  }
}
```

---

### Step 2 — 执行 Full Sync

**调用：**
```json
{
  "tool": "sync_resources",
  "server": "user-csp-ai-agent",
  "arguments": { "mode": "full", "scope": "all" }
}
```

**响应：**
```json
{
  "success": true,
  "data": {
    "mode": "full",
    "health_score": 71,
    "summary": { "total": 7, "synced": 5, "cached": 0, "failed": 2 },
    "details": [
      { "id": "0bbc520906995c7ca6ecb923aba141ca", "name": "csp-ai-prompts",            "action": "failed", "version": "unknown" },
      { "id": "0ccd800f60705676a305eeb3824b2d9c", "name": "ZMDB-log-analyze",          "action": "synced", "version": "unknown" },
      { "id": "7b7c653e1fee5a30962a4019411c128b", "name": "hang-log-analyzer",         "action": "synced", "version": "unknown" },
      { "id": "8346836580e75837a7183285c5872843", "name": "acm",                        "action": "failed", "version": "unknown" },
      { "id": "ad07dd91e56658858d28634034b876a7", "name": "security-security-baseline", "action": "synced", "version": "unknown" },
      { "id": "bdba66f05d2bf4ef4a71051fe4fc8f18", "name": "zoom-design-doc",            "action": "synced", "version": "unknown" },
      { "id": "cee745c647d85ad497a40308a8d2f001", "name": "ACM-Helper",                "action": "synced", "version": "unknown" }
    ],
    "local_actions_required": [
      {
        "action": "write_file",
        "path": "/root/.cursor/rules/security-security-baseline.mdc",
        "content": "(已写入 ~/.cursor/rules/security-security-baseline.mdc)"
      }
    ]
  }
}
```

---

### Step 3 — 执行本地操作（local_actions_required）

服务端在 `sync_resources` 响应中附带了 `local_actions_required`，Agent 需要在本地机器上执行这些动作：

| 动作类型 | 目标路径 | 执行结果 |
|---------|---------|---------|
| `write_file` | `~/.cursor/rules/security-security-baseline.mdc` | ✅ 成功写入 |

> **注意：** 服务端返回的路径为 `/root/.cursor/rules/`（Linux 默认路径），实际写入适配为 macOS 用户目录 `/Users/ElliotDing/.cursor/rules/`。

---

## 三、失败资源分析

### 失败资源 1：`csp-ai-prompts`（type: rule）

| 字段 | 值 |
|------|-----|
| Resource ID | `0bbc520906995c7ca6ecb923aba141ca` |
| 类型 | rule |
| 返回 action | `failed` |
| version | `unknown` |
| 错误信息 | 服务端未返回具体错误原因 |

**待确认问题：**
- 服务端是否有该资源的内容？（资源本身是否存在/已发布）
- 是否是权限问题？
- `version: unknown` 是否意味着资源元数据缺失？

---

### 失败资源 2：`acm`（type: mcp）

| 字段 | 值 |
|------|-----|
| Resource ID | `8346836580e75837a7183285c5872843` |
| 类型 | mcp |
| 返回 action | `failed` |
| version | `unknown` |
| 错误信息 | 服务端未返回具体错误原因 |

**待确认问题：**
- MCP 类型资源需要返回 `merge_mcp_json` 的 local_action，但本次响应中没有该资源的 local_action，说明服务端在生成配置前就已失败
- 是否 `acm` MCP 资源的配置（command/url/env）在服务端未正确注册？

---

## 四、用户问题

> "服务端返回 failed 是什么 API 接口吗？"

**解答：**  
不是一个独立的 API 接口返回 failed。`failed` 是 `sync_resources` 工具响应中 `details[].action` 字段的枚举值，由 CSP AI Agent MCP Server 在处理每个资源的同步逻辑时内部设置的状态标记。

服务端的 sync 流程大致为：
1. 遍历用户的订阅列表
2. 对每个资源尝试拉取最新内容（rule/skill 类型注册为 MCP Prompt，mcp 类型生成 mcp.json 配置）
3. 若拉取或处理失败，则将该资源的 `action` 标记为 `"failed"`，并在整体响应中一并返回

**当前服务端响应没有包含具体的错误原因**（如 HTTP 状态码、错误消息），这是一个值得向服务端开发者反馈的改进点：应在 `failed` 资源的详情中附加 `error_message` 字段以便排查。

---

## 五、同步结果汇总

| 资源名 | 类型 | 结果 |
|--------|------|------|
| `ZMDB-log-analyze` | command | ✅ 已同步 |
| `hang-log-analyzer` | skill | ✅ 已同步 |
| `security-security-baseline` | rule | ✅ 已同步 |
| `zoom-design-doc` | skill | ✅ 已同步 |
| `ACM-Helper` | command | ✅ 已同步 |
| `csp-ai-prompts` | rule | ❌ 失败（原因未知） |
| `acm` | mcp | ❌ 失败（原因未知） |

**Health Score：71 / 100**

---

## 六、后续建议

1. 对 `csp-ai-prompts` 和 `acm` 单独重试 sync，确认是否为偶发性失败
2. 向 CSP AI Agent 服务端开发者反馈：`failed` 状态应携带 `error_message`，便于调试
3. 如果重试仍失败，检查这两个资源在服务端的发布状态（是否已正确上传/注册）
