# Feature: MCP Prompt 模式 + AI Resource 使用埋点

**Feature ID:** FEAT-2026-03-20-002  
**版本:** 1.0.0  
**创建日期:** 2026-03-20  
**状态:** 设计确认中

---

## 1. 背景与动机

### 问题根因

当前架构将 Command / Skill 的实体文件下发到用户本地（`~/.cursor/commands/`、`~/.cursor/skills/`），导致：

1. **埋点不可能**：资源下发后调用完全发生在 Cursor 客户端内部，MCP Server 无任何感知
2. **版本同步滞后**：用户本地文件不一定是最新版本
3. **分发成本高**：每次资源更新都需要重新 sync

### 解决方向

借鉴 MCP Prompt 原语设计：将 Command / Skill 从「下发实体文件」改为「在 MCP Server 注册 Prompt」。用户触发 `/slash` 时，请求经过 MCP Server handler，天然产生埋点机会。

```
旧：用户 /slash → Cursor 读本地文件 → AI 执行（MCP 无感知）
新：用户 /slash → MCP Client → MCP Server handler → 记录埋点 → 返回 Prompt 内容 → AI 执行
```

---

## 2. 核心设计决策

### 2.1 各资源类型策略（已确认）

| 资源类型 | 下发策略 | 埋点能力 | 理由 |
|---------|---------|---------|------|
| **Command** | ❌ 不下发文件，注册为 MCP Prompt | ✅ 精准统计每次调用 | 用户 `/slash` 经过 MCP Server |
| **Skill** | ❌ 不下发文件，注册为 MCP Prompt | ✅ 精准统计每次调用 | 同 Command |
| **Rule** | ✅ 继续下发到 `~/.cursor/rules/` | ⚠️ 只统计已订阅列表 | Cursor 引擎直接加载，MCP 无感知 |
| **MCP** | ✅ 继续配置到 `~/.cursor/mcp.json` | ⚠️ 只统计已配置列表 | 第三方 MCP 需各自埋点；本地运行型需文件落盘 |

### 2.2 中间文件策略（已确认）

- Command / Skill 的 MCP Prompt 中间文件**不提交到 Git 仓库**
- 每次 `sync_resources` 触发 git pull 后，**实时从原件生成**最新 Prompt 中间文件（内存生成或写到 MCP Server 运行目录临时缓存）
- 用户 `upload_resource` 后，git push 前也自动生成一份中间文件用于注册
- 中间文件存放路径：MCP Server 运行目录下的 `.prompt-cache/` 文件夹（不进 Git）

### 2.3 遥测上报策略（已确认）

- 本地缓存文件：MCP Server **运行目录**下的 `ai-resource-telemetry.json`（不是 `~/.cursor/`）
- 上报间隔：每 10 秒
- 上报 API：`POST /csp/api/resources/telemetry`
- 新增可选参数：`jira_id`（如 `ZOOM-1169703`），用户不传时不携带此字段
- MCP 断线重连时立即触发一次上报

---

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      Cursor IDE                          │
│                                                          │
│  用户输入 /command-name 或 AI 引用 Skill                 │
│       │                                                  │
│       ▼ prompts/get 请求                                 │
│  MCP Client ──── stdio/SSE ────▶ MCP Server              │
│                                      │                   │
│                                      ├─ 1. 查找 Prompt   │
│                                      │   中间文件内容     │
│                                      ├─ 2. 记录埋点到    │
│                                      │   telemetry.json  │
│                                      └─ 3. 返回 messages │
└─────────────────────────────────────────────────────────┘

MCP Server 运行目录结构：
  dist/
  ├── index.js                    ← 入口，动态注册 Prompt
  ├── ai-resource-telemetry.json  ← 遥测本地缓存
  └── .prompt-cache/              ← 中间文件缓存（不进 Git）
        ├── cmd-{resource_id}.md
        └── skill-{resource_id}.md

服务端 Git 仓库结构（MCP Server 侧）：
  AI-Resources/
  ├── commands/
  │   └── {team}/{name}/
  │       └── command.md          ← 原件（用户上传）
  └── skills/
      └── {team}/{name}/
          └── SKILL.md            ← 原件（用户上传）
```

### 3.1 MCP Prompt 中间文件格式

```markdown
---
resource_id: cmd-client-sdk-ai-hub-generate-testcase
name: generate-testcase
type: command
team: Client-SDK
version: 1.2.0
description: 生成单元测试用例（显示在 Cursor slash 菜单）
---

（原件 command.md 的完整内容，经过变量替换）

import '../../workflows/shared-context.md'  ← 展开后内联
```

中间文件生成逻辑：
1. 读取原件 `.md` 内容
2. 递归展开 `import` 语句（同参考文档的 `parseMarkdownWithImports`）
3. 替换 `${VARIABLE}` 路径变量
4. 写入 `.prompt-cache/{type}-{resource_id}.md`

---

## 4. 动态 Prompt 注册机制

### 4.1 启动时注册

```typescript
// src/server.ts (改造)
async function registerPromptsFromSubscriptions(userToken: string) {
  const subscriptions = await apiClient.getSubscriptions({ types: ['command', 'skill'] }, userToken);
  for (const sub of subscriptions.subscriptions) {
    registerPromptForResource(sub);
  }
}

function registerPromptForResource(resource: SubscriptionItem) {
  const promptName = buildPromptName(resource); // e.g. "client-sdk/generate-testcase"
  server.registerPrompt(promptName, {
    description: resource.description ?? resource.name,
    arguments: [
      { name: 'jira_id', description: 'Jira Issue ID (e.g. ZOOM-1169703)', required: false }
    ]
  }, async (args) => {
    const content = await getPromptContent(resource);
    telemetry.recordInvocation(resource.id, resource.type as ResourceCategory, resource.name, args?.jira_id);
    return {
      messages: [{ role: 'user', content: { type: 'text', text: content } }]
    };
  });
}
```

### 4.2 订阅变更时动态更新

- `manage_subscription` 订阅新资源后 → 立即调用 `registerPromptForResource()`
- `manage_subscription` 取消订阅后 → 调用 `server.deletePrompt(promptName)`（需 MCP SDK 支持，否则重启 Server）
- `sync_resources` 完成后 → 重新扫描并更新所有 Prompt 注册（更新内容 + 版本）

### 4.3 Prompt 名称规范

```
{type}/{team}/{resource-name}

示例：
  command/client-sdk/generate-testcase
  skill/client-sdk/analyze-sdk-log
```

---

## 5. 遥测埋点设计

### 5.1 本地缓存文件

**路径：** `{MCP Server 运行目录}/ai-resource-telemetry.json`

```json
{
  "client_version": "0.1.4",
  "last_reported_at": "2026-03-20T10:00:00Z",
  "pending_events": [
    {
      "resource_id": "cmd-client-sdk-ai-hub-generate-testcase",
      "resource_type": "command",
      "resource_name": "generate-testcase",
      "invocation_count": 5,
      "first_invoked_at": "2026-03-20T09:55:00Z",
      "last_invoked_at": "2026-03-20T09:59:30Z",
      "jira_id": "ZOOM-1169703"
    },
    {
      "resource_id": "skill-client-sdk-ai-hub-analyze-sdk-log",
      "resource_type": "skill",
      "resource_name": "analyze-sdk-log",
      "invocation_count": 2,
      "first_invoked_at": "2026-03-20T09:56:00Z",
      "last_invoked_at": "2026-03-20T09:57:10Z"
    }
  ],
  "subscribed_rules": [
    {
      "resource_id": "rule-csp-openspec",
      "resource_name": "openspec-rule",
      "subscribed_at": "2026-03-01T00:00:00Z"
    }
  ],
  "configured_mcps": [
    {
      "resource_id": "mcp-client-sdk-ai-hub-jenkins",
      "resource_name": "jenkins",
      "configured_at": "2026-03-01T00:00:00Z"
    }
  ]
}
```

**字段说明：**
- `pending_events`：Command / Skill 调用的增量事件（上报成功后清空）
- `jira_id`：可选，用户调用时传入（同一个资源在不同 jira 上下文下分别记录）
- `subscribed_rules`：已订阅 Rule 全量列表（每次 sync 后更新）
- `configured_mcps`：已配置 MCP 全量列表（每次 sync 后更新）

### 5.2 jira_id 的本地聚合策略

同一资源在不同 jira_id 下分开记录：

```json
"pending_events": [
  { "resource_id": "cmd-xxx", "invocation_count": 3, "jira_id": "ZOOM-1169703" },
  { "resource_id": "cmd-xxx", "invocation_count": 2, "jira_id": "ZOOM-1169800" },
  { "resource_id": "cmd-xxx", "invocation_count": 1 }  // 无 jira_id 的调用
]
```

### 5.3 上报触发时机

| 触发条件 | 动作 |
|---------|------|
| 每 10 秒定时 | 读取本地文件 → POST → 清空 pending_events |
| MCP Client 重连（`oninitialized`） | 立即触发一次 flush |
| Server 优雅关闭 | 停止定时器 → 最后一次 flush |

---

## 6. API 设计

### `POST /csp/api/resources/telemetry`

#### Request Headers

| Header | 说明 |
|--------|------|
| `Authorization` | `Bearer {user_token}` |
| `Content-Type` | `application/json` |

#### Request Body

```json
{
  "client_version": "0.1.4",
  "reported_at": "2026-03-20T10:00:10Z",
  "events": [
    {
      "resource_id": "cmd-client-sdk-ai-hub-generate-testcase",
      "resource_type": "command",
      "resource_name": "generate-testcase",
      "invocation_count": 5,
      "first_invoked_at": "2026-03-20T09:55:00Z",
      "last_invoked_at": "2026-03-20T09:59:30Z",
      "jira_id": "ZOOM-1169703"
    },
    {
      "resource_id": "skill-client-sdk-ai-hub-analyze-sdk-log",
      "resource_type": "skill",
      "resource_name": "analyze-sdk-log",
      "invocation_count": 2,
      "first_invoked_at": "2026-03-20T09:56:00Z",
      "last_invoked_at": "2026-03-20T09:57:10Z"
    }
  ],
  "subscribed_rules": [
    {
      "resource_id": "rule-csp-openspec",
      "resource_name": "openspec-rule",
      "subscribed_at": "2026-03-01T00:00:00Z"
    }
  ],
  "configured_mcps": [
    {
      "resource_id": "mcp-client-sdk-ai-hub-jenkins",
      "resource_name": "jenkins",
      "configured_at": "2026-03-01T00:00:00Z"
    }
  ]
}
```

#### Request Body 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `client_version` | string | 是 | MCP 客户端版本 |
| `reported_at` | string (ISO 8601) | 是 | 上报时间戳 |
| `events` | array | 是 | Command/Skill 调用增量事件列表（可为空数组） |
| `events[].resource_id` | string | 是 | 资源唯一 ID |
| `events[].resource_type` | string | 是 | `command` 或 `skill` |
| `events[].resource_name` | string | 是 | 资源名称 |
| `events[].invocation_count` | integer | 是 | 本窗口调用次数（≥ 1） |
| `events[].first_invoked_at` | string (ISO 8601) | 是 | 本窗口首次调用时间 |
| `events[].last_invoked_at` | string (ISO 8601) | 是 | 本窗口最后调用时间 |
| `events[].jira_id` | string | **否** | Jira Issue ID（如 `ZOOM-1169703`），用户不传时省略此字段 |
| `subscribed_rules` | array | 是 | 已订阅 Rule 全量列表（可为空数组） |
| `configured_mcps` | array | 是 | 已配置 MCP 全量列表（可为空数组） |

#### Response — Success (200)

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "accepted_count": 2,
    "reported_at": "2026-03-20T10:00:10Z"
  }
}
```

#### Response — 认证失败 (401)

```json
{
  "code": 4001,
  "result": "failed",
  "message": "unauthorized"
}
```

#### Response — 请求体格式错误 (400)

```json
{
  "code": 4000,
  "result": "failed",
  "message": "invalid request body"
}
```

#### Response — 服务端错误 (500)

```json
{
  "code": 5000,
  "result": "failed",
  "message": "internal server error"
}
```

---

## 7. 现有工具改造影响分析

### 7.1 `sync_resources` — 大改

**原逻辑：** git pull → 下载文件 → 写到 `~/.cursor/{type}/`

**新逻辑：**

```
git pull（服务端 Git 仓库）
    │
    ├── Command / Skill：
    │   ├── 拉取原件内容（通过 API 下载）
    │   ├── 生成中间文件 → 写入 .prompt-cache/
    │   ├── 动态更新 MCP Server Prompt 注册（registerPrompt / 覆盖已有）
    │   └── 不写 ~/.cursor/commands/ 或 ~/.cursor/skills/
    │
    ├── Rule：
    │   ├── 沿用旧逻辑：下载文件 → 写 ~/.cursor/rules/
    │   └── 同步更新 telemetry.json 中的 subscribed_rules 列表
    │
    └── MCP：
        ├── 沿用旧逻辑：写 ~/.cursor/mcp.json
        └── 同步更新 telemetry.json 中的 configured_mcps 列表
```

### 7.2 `manage_subscription` — 中改

- 订阅 Command/Skill → 拉取内容 → 生成中间文件 → 动态注册 Prompt
- 取消订阅 Command/Skill → 注销 Prompt（或 server 重启后不再注册）
- 订阅/取消 Rule/MCP → 沿用旧逻辑

### 7.3 `search_resources` — 不改

搜索逻辑与下发方式无关，无需修改。

### 7.4 `upload_resource` — 中改

**上传 Command / Skill 时的新流程：**

```
用户上传原件
    │
    ├── 1. 调用现有上传逻辑（POST /csp/api/resources/upload + finalize → git push）
    │
    └── 2. 上传完成后：
        ├── 下载刚上传的资源内容
        ├── 生成中间文件 → 写入 .prompt-cache/
        └── 动态注册新 Prompt（使其立即在 /slash 菜单可用）
```

**上传 Rule / MCP：** 沿用旧逻辑，无变化。

### 7.5 `uninstall_resource` — 小改

- 卸载 Command/Skill → 注销 Prompt + 删除 `.prompt-cache/` 中对应文件（不再删 `~/.cursor/commands/`）
- 卸载 Rule → 删 `~/.cursor/rules/` 对应文件（旧逻辑）
- 卸载 MCP → 从 `~/.cursor/mcp.json` 移除条目（旧逻辑）

---

## 8. 新增模块

### 8.1 `src/prompts/` — Prompt 管理模块（新增）

```
src/prompts/
├── manager.ts          ← PromptManager：注册/注销/更新 Prompt
├── generator.ts        ← 中间文件生成：parseMarkdownWithImports + 变量替换
├── cache.ts            ← .prompt-cache/ 文件读写
└── index.ts            ← 导出
```

**核心接口：**

```typescript
class PromptManager {
  registerPrompt(resource: SubscriptionItem): void;
  unregisterPrompt(resourceId: string): void;
  refreshPrompt(resource: SubscriptionItem): Promise<void>;
  refreshAllPrompts(subscriptions: SubscriptionItem[]): Promise<void>;
}

class PromptGenerator {
  generate(resourceId: string, rawContent: string): Promise<string>;
  // 内部：parseMarkdownWithImports + replaceMDVariables
}
```

### 8.2 `TelemetryManager` 改造

在旧 `TelemetryManager` 基础上：

1. **文件路径变更**：从 `~/.cursor/ai-resource-telemetry.json` 改为 `{运行目录}/ai-resource-telemetry.json`
2. **新增 `configured_mcps` 字段**
3. **新增 `jira_id` 参数**到 `recordInvocation()`
4. **聚合策略**：同 resource_id + jira_id 组合为聚合 key

---

## 9. 影响范围汇总

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/prompts/manager.ts` | Prompt 注册/注销管理 |
| `src/prompts/generator.ts` | 中间文件生成（import 展开 + 变量替换） |
| `src/prompts/cache.ts` | `.prompt-cache/` 文件读写 |
| `src/prompts/index.ts` | 模块导出 |

### 修改文件

| 文件 | 变更说明 |
|------|---------|
| `src/server.ts` / `src/server/http.ts` | 启动时调用 `PromptManager.refreshAllPrompts()` |
| `src/tools/sync-resources.ts` | Command/Skill 改为生成中间文件 + 注册 Prompt |
| `src/tools/manage-subscription.ts` | 订阅变更后动态注册/注销 Prompt |
| `src/tools/upload-resource.ts` | 上传完成后生成中间文件 + 注册 Prompt |
| `src/tools/uninstall-resource.ts` | 注销 Prompt + 删缓存文件 |
| `src/telemetry/manager.ts` | 路径变更 + `jira_id` + `configured_mcps` |
| `src/api/client.ts` | `reportTelemetry` payload 新增 `configured_mcps` + `jira_id` |
| `Docs/Design/CSP-AI-Agent-API-Mapping.md` | 更新 telemetry API 文档 |

---

## 10. 实施阶段

| 阶段 | 内容 | 预计工作量 |
|------|------|----------|
| **阶段 1** | `PromptGenerator` 中间文件生成（import展开 + 变量替换） | 小 |
| **阶段 2** | `PromptManager` 动态注册机制 + Server 启动集成 | 中 |
| **阶段 3** | `sync_resources` / `manage_subscription` 改造 | 大 |
| **阶段 4** | `upload_resource` / `uninstall_resource` 改造 | 中 |
| **阶段 5** | `TelemetryManager` 改造（路径 + jira_id + configured_mcps） + API 更新 | 中 |

---

## 11. 相关文档

- 参考设计：`NewFeature/MCP-Prompt-as-Slash-Command-Design.md`
- API 规范：`Docs/Design/CSP-AI-Agent-API-Mapping.md`
- 原有 Telemetry 设计：`Docs/FeatureDocs/FEAT-2026-03-20-001-ai-resource-telemetry/`（已废弃，本 Feature 替代）
