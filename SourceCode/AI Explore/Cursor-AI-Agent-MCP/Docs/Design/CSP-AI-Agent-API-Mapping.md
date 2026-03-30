# MCP Resource Management API

## Overview

MCP Resource Management 模块为 MCP Tool Server 提供资源管理 REST API，支持资源搜索、订阅、同步下载和上传。

- **Controller**: `McpResourceController`
- **Base Path**: `/csp/api/resources`
- **认证**: 需要 Bearer Token（所有接口均需认证）

## 1. 搜索资源

搜索平台上可用的资源，支持按团队、类型、关键词过滤，分页返回。

- **URL**: `GET /csp/api/resources/search`
- **认证**: 需要

### Query Parameters


|           |         |     |       |                                      |
| --------- | ------- | --- | ----- | ------------------------------------ |
| 参数        | 类型      | 必填  | 默认值   | 说明                                   |
| keyword   | String  | 是   | —     | 关键词搜索（名称/描述/标签）                      |
| detail    | Boolean | 否   | false | 是否包含资源详细元数据（tags、author、downloads 等） |
| type      | String  | 否   | all   | commonds, skills                     |
| page      | Integer | 否   | 1     | 页码                                   |
| page_size | Integer | 否   | 20    | 每页数量（最大 100）                         |


### Request Example

```
GET /csp/api/resources/search?keyword=debug&type=skills&detail=false&page=1&page_size=20
Authorization: Bearer {token}
```

### Response — Success (200)

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "total": 25,
    "page": 1,
    "page_size": 20,
    "results": [
      {
        "id": "zCodeReview-skill-001",
        "name": "debug-network",
        "type": "command",
        "team": "zNet",
        "version": "1.0.1",
        "description": "Network debugging tool for SDK developers",
        "metadata": {
          "module": "zNet",
          "tags": ["debugging", "network", "sdk"],
          "author": "user@example.com",
          "created_at": "2026-03-01T10:00:00Z",
          "updated_at": "2026-03-03T09:50:00Z",
          "downloads": 125
        },
        "download_url": "https://csp.example.com/api/resources/download/zCodeReview-skill-001"
      }
    ]
  }
}
```

## 2. 获取资源详情

获取单个资源的完整信息，用于订阅前验证资源存在性。

- **URL**: `GET /csp/api/resources/{id}`
- **认证**: 需要

### Path Parameters


|     |        |                                 |
| --- | ------ | ------------------------------- |
| 参数  | 类型     | 说明                              |
| id  | String | 资源 ID，如 `zCodeReview-skill-001` |


### Request Example

```
GET /csp/api/resources/zCodeReview-skill-001
Authorization: Bearer {token}
```

### Response — Success (200)

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "id": "zCodeReview-skill-001",
    "name": "debug-network",
    "type": "command",
    "team": "zNet",
    "version": "1.0.1",
    "description": "Network debugging tool",
    "hash": "sha256:def456...",
    "size_bytes": 2048,
    "download_url": "https://csp.example.com/api/resources/download/zCodeReview-skill-001",
    "created_at": "2026-03-01T10:00:00Z",
    "updated_at": "2026-03-03T09:50:00Z",
    "created_by": "user@example.com",
    "metadata": {
      "module": "zNet",
      "tags": ["debugging", "network"],
      "author": "user@example.com",
      "downloads": 125
    }
  }
}
```

### Response — Not Found (404)

```json
{
  "code": 4008,
  "result": "failed",
  "message": "not found"
}
```

### Response — No Permission (403)

```json
{
  "code": 4007,
  "result": "failed",
  "message": "permission denied"
}
```

## 3. 下载资源文件

下载指定资源的所有文件内容，以 JSON `files[]` 数组返回。  
支持单文件资源（command、rule）和多文件资源（skill、mcp），格式统一。

- **URL**: `GET /csp/api/resources/download/{id}`
- **认证**: 需要

### Path Parameters

|    |        |       |
| -- | ------ | ----- |
| 参数 | 类型     | 说明    |
| id | String | 资源 ID |

### Request Headers

|              |                     |
| ------------ | ------------------- |
| Header       | 说明                  |
| If-None-Match | ETag 缓存校验（可选）      |

### Request Example

```
GET /csp/api/resources/download/skill-csp-code-review
Authorization: Bearer {token}
If-None-Match: "sha256:def456..."
```

### Response — Success (200)

```json
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "sha256:xyz789..."

{
  "code": 2000,
  "result": "success",
  "data": {
    "resource_id": "skill-csp-code-review",
    "name": "code-review",
    "type": "skill",
    "version": "1.0.0",
    "hash": "sha256:xyz789...",
    "files": [
      {
        "path": "SKILL.md",
        "content": "# Code Review Skill\n..."
      },

## 3.1 获取资源元数据（客户端本地扫描）

### ⚡ 架构改进（v2.1 - 2026-03-27）

**不再需要服务端 API！** MCP Server 已通过 Git 仓库完整拉取所有 AI 资源文件到本地（`AI-Resources/` 目录），可以直接扫描本地文件系统生成元数据。

### 实现方式

**核心模块：** `SourceCode/src/git/multi-source-manager.ts`

**新增方法：**

```typescript
/**
 * Scan resource directory and generate metadata (has_scripts, script_files).
 * 
 * @param resourceName - Resource name
 * @param resourceType - Resource type
 * @returns Metadata object with has_scripts and script_files
 */
async scanResourceMetadata(
  resourceName: string,
  resourceType: 'command' | 'skill' | 'rule' | 'mcp'
): Promise<{
  has_scripts: boolean;
  script_files?: Array<{
    relative_path: string;
    content: string;
    mode?: string;
    encoding: 'utf8' | 'base64';
  }>;
}>
```

**扫描逻辑：**

1. **递归读取目录：** 调用 `readResourceFiles(name, type, includeAllFiles: true)` 获取所有文件
2. **启发式检测：** 检查是否存在 `scripts/`、`teams/`、`references/` 目录
3. **权限推断：**
   - `scripts/` 下非 `.json`/`.md`/`.txt` 文件 → `0755`（可执行）
   - 其他文件 → `0644`（普通文件）
4. **构建元数据：** 返回 `has_scripts` + `script_files` 数组（排除主文件 SKILL.md/COMMAND.md/README.md）

### 返回格式示例

**简单 Skill（无脚本）：**

```json
{
  "has_scripts": false
}
```

**复杂 Skill（含脚本）：**

```json
{
  "has_scripts": true,
  "script_files": [
    {
      "relative_path": "scripts/build-cli",
      "content": "#!/usr/bin/env node\nconsole.log('Build CLI');",
      "mode": "0755",
      "encoding": "utf8"
    },
    {
      "relative_path": "teams/client-android.json",
      "content": "{\"project\":\"client-android\"}",
      "mode": "0644",
      "encoding": "utf8"
    }
  ]
}
```

### 调用方

**`sync_resources` MCP Tool**（在 `SourceCode/src/tools/sync-resources.ts`）：

```typescript
// After registering MCP Prompt, scan for local scripts
const metadata = await multiSourceGitManager.scanResourceMetadata(
  sub.name,
  sub.type as 'command' | 'skill'
);

if (metadata.has_scripts && metadata.script_files) {
  // Generate local write_file actions for scripts
  for (const scriptFile of metadata.script_files) {
    localActions.push({
      action: 'write_file',
      path: `~/.cursor/skills/${sub.name}/${scriptFile.relative_path}`,
      content: scriptFile.content,
      mode: scriptFile.mode,
      encoding: scriptFile.encoding,
    });
  }
}
```

### 优势

| 优势 | 说明 |
|------|------|
| **零服务端依赖** | 不需要新增 REST API 端点，无需协调后端团队 |
| **实时准确** | 直接反映 Git Working Directory 的最新状态 |
| **高性能** | 本地文件系统访问，无网络延迟 |
| **完整权限支持** | 精确推断可执行脚本权限（0755） |
| **简化架构** | 减少 API Client → REST API 的远程调用链路 |

</details>

---

## 4. 上传资源内容（暂存）

```json
{
  "type": "command",
  "name": "debug-network",
  "files": [
    {
      "path": "debug-network.md",
      "content": "# Debug Network Tool\n\nA tool for debugging network issues..."
    }
  ]
}
```

### Request Example — 多文件（mcp 场景）

```json
{
  "type": "mcp",
  "name": "my-database-mcp",
  "files": [
    {
      "path": "README.md",
      "content": "# My Database MCP\n\nThis MCP provides database tools..."
    },
    {
      "path": "server.js",
      "content": "const { Server } = require('@modelcontextprotocol/sdk');\n..."
    },
    {
      "path": "tools/query.js",
      "content": "module.exports = async function query(params) { ... }"
    },
    {
      "path": "tools/schema.js",
      "content": "module.exports = async function schema(params) { ... }"
    },
    {
      "path": "package.json",
      "content": "{\"name\": \"my-database-mcp\", \"version\": \"1.0.0\"}"
    }
  ]
}
```

### Request Example — 多文件（skill 场景）

```json
{
  "type": "skill",
  "name": "code-review",
  "files": [
    {
      "path": "SKILL.md",
      "content": "# Code Review Skill\n\n## How to use..."
    },
    {
      "path": "checklist.md",
      "content": "## Review Checklist\n\n- [ ] Security..."
    }
  ]
}
```

### Response — Success (200)

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "upload_id": "temp-abc123",
    "status": "pending",
    "expires_at": "2026-03-03T11:00:00Z",
    "preview_url": "https://csp.example.com/preview/temp-abc123"
  }
}
```

### Response — files 为空数组（400）

```json
{
  "code": 4011,
  "result": "failed",
  "message": "files array must not be empty"
}
```

### Response — files[].path 路径穿越（400）

```json
{
  "code": 4012,
  "result": "failed",
  "message": "Invalid file path: path traversal not allowed"
}
```

### 服务端处理逻辑

1. 验证 Token → 获取用户信息
2. 校验 `files` 不为空
3. 校验每个 `files[].path` 无路径穿越（`../`、绝对路径等）
4. 校验总内容大小 < 10MB
5. 按 `path` 还原目录结构暂存
6. 检查名称冲突
7. 暂存到临时目录
8. 生成 upload_id，记录过期时间

## 5. 完成上传并 Git 提交

确认暂存的上传内容，执行 Git 提交并生成永久资源记录。

- **URL**: `POST /csp/api/resources/finalize`
- **Content-Type**: `application/json`
- **认证**: 需要

### Request Body


|                |        |     |                    |
| -------------- | ------ | --- | ------------------ |
| 参数             | 类型     | 必填  | 说明                 |
| upload_id      | String | 是   | upload 接口返回的暂存 ID  |
| commit_message | String | 是   | Git commit message |


### Request Example

```json
{
  "upload_id": "temp-abc123",
  "commit_message": "Add network debugging command"
}
```

### Response — Success (200)

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "resource_id": "Client-Public-cmd-001",
    "version": "1.0.0",
    "url": "https://git.zoom.us/main/csp/-/blob/main/...",
    "commit_hash": "abc123",
    "download_url": "https://csp.example.com/api/resources/download/Client-Public-cmd-001"
  }
}
```

### Response — Upload Not Found / Expired

```json
{
  "code": 4009,
  "result": "failed",
  "message": "Upload not found or expired"
}
```

### 服务端处理逻辑

1. 验证 upload_id 存在且未过期
2. 生成永久 resource_id: `{team}-{type_abbr}-{seq}`
3. 移动文件到 Git 仓库目录
4. Git 操作: `git add` → `git commit` → `git tag {resource_id}-v{version}`
5. 更新数据库（资源表）
6. 清理临时文件

## 6. 获取订阅资源清单

获取当前用户订阅的资源列表，包含资源元数据（版本、hash、下载链接等），支持 ETag 缓存。

- **URL**: `GET /csp/api/resources/subscriptions`
- **认证**: 需要

### Query Parameters


|        |         |     |       |                                 |
| ------ | ------- | --- | ----- | ------------------------------- |
| 参数     | 类型      | 必填  | 默认值   | 说明                              |
| scope  | String  | 否   | all   | general / team / user / all     |
| detail | Boolean | 否   | false | 是否包含资源详细信息（版本/hash/下载链接等）       |
| types  | String  | 否   | —     | 逗号分隔的类型过滤: `command,skill,rule` |


### Request Example

```
GET /csp/api/resources/subscriptions?scope=general&detail=true&types=command,skill
Authorization: Bearer {token}
If-None-Match: "W/\"etag-previous\""
```

### Response — Success (200)

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "version": "1.0.0",
    "timestamp": "2026-03-03T10:00:00Z",
    "total": 10,
    "subscriptions": [
      {
        "id": "zCodeReview-skill-001",
        "name": "debug-network",
        "type": "command",
        "team": "zNet",
        "subscribed_at": "2026-03-01T10:00:00Z",
        "auto_sync": true,
        "scope": "global",
        "notify": true,
        "resource": {
          "version": "1.0.1",
          "hash": "sha256:def456...",
          "size_bytes": 2048,
          "download_url": "https://csp.example.com/api/resources/download/zCodeReview-skill-001",
          "updated_at": "2026-03-03T09:50:00Z",
          "metadata": {
            "module": "zNet",
            "tags": ["debugging", "network"]
          }
        }
      }
    ]
  }
}
```

### Response — Not Modified (304)

```
HTTP/1.1 304 Not Modified
ETag: "W/\"abc123\""
```

订阅列表未变更，客户端使用本地缓存。

## 7. 添加订阅

批量订阅资源，支持幂等操作（重复订阅不报错）。

- **URL**: `POST /csp/api/resources/subscriptions/add`
- **Content-Type**: `application/json`
- **认证**: 需要

### Request Body


|              |          |     |     |                      |
| ------------ | -------- | --- | --- | -------------------- |
| 参数           | 类型       | 必填  | 默认值 | 说明                   |
| resource_ids | String[] | 是   | —   | 要订阅的资源 ID 列表         |
| scope        | String   | 否   | all | general / user / all |


### Request Example

```json
{
  "resource_ids": ["zCodeReview-skill-001", "Client-Public-skill-002"],
  "scope": "global"
}
```

### Response — Success (200)

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "added_count": 2,
    "subscriptions": [
      {
        "id": "zCodeReview-skill-001",
        "name": "debug-network",
        "subscribed_at": "2026-03-03T10:00:00Z"
      },
      {
        "id": "Client-Public-skill-002",
        "name": "code-review",
        "subscribed_at": "2026-03-03T10:00:00Z"
      }
    ]
  }
}
```

### Response — Partial Failure: Resource Not Found

```json
{
  "code": 4008,
  "result": "failed",
  "message": "Resources not found",
  "data": {
    "invalid_ids": ["invalid-resource-id"],
    "added_ids": ["zCodeReview-skill-001"]
  }
}
```

### Response — Partial Failure: No Permission

```json
{
  "code": 4007,
  "result": "failed",
  "message": "Permission denied",
  "data": {
    "forbidden_ids": ["restricted-resource-id"]
  }
}
```

## 8. 取消订阅

批量取消资源订阅，幂等操作（不存在的订阅不报错）。

- **URL**: `DELETE /csp/api/resources/subscriptions/remove`
- **Content-Type**: `application/json`
- **认证**: 需要

### Request Body


|              |          |     |                |
| ------------ | -------- | --- | -------------- |
| 参数           | 类型       | 必填  | 说明             |
| resource_ids | String[] | 是   | 要取消订阅的资源 ID 列表 |


### Request Example

```json
{
  "resource_ids": ["zCodeReview-skill-001"]
}
```

### Response — Success (200)

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "removed_count": 1,
    "message": "Subscriptions removed successfully"
  }
}
```

## 9 认证 API

### GET /csp/api/user/permissions

**功能**: 验证用户 token 并获取权限信息

**请求头**:

```plaintext
Authorization: Bearer {token}
```

**响应**:

```json
{
  "code": 2000,
  "data": {
    "user_id": "user123",
    "email": "user@example.com",
    "groups": ["zNet", "Client-Public"]
  }
}
```

**错误响应**:

```json
{
  "code": 4010,
  "message": "Invalid or expired token"
}
```

---

## 8. 上报 AI Resource 使用遥测

上报用户的 AI Resource 实际使用情况（Command/Skill Prompt 调用次数、已订阅 Rule 列表、已配置 MCP 列表）。由 MCP Server 的 TelemetryManager 每 10 秒定时触发，MCP Client 重连时立即额外上报一次，服务优雅关闭时执行最后一次上报。

**架构背景**：Command 和 Skill 资源已改为 MCP Prompt 模式（不再下发实体文件到用户本地）。对于已注册 slash Prompt，调用经过 `prompts/get` handler；对于同轮动态订阅场景，AI 可通过 `resolve_prompt_content` tool 获取真实正文。两条链路都会在 MCP Server 侧记录使用次数。Rule 和 MCP 仍下发本地，只统计已订阅/已配置列表。

- **URL**: `POST /csp/api/resources/telemetry`
- **认证**: 需要（`Authorization: Bearer {user_token}`）

### Request Headers

| Header | 说明 |
|--------|------|
| `Authorization` | `Bearer {user_token}` — 来自用户 mcp.json 中配置的个人 CSP Token |
| `Content-Type` | `application/json` |

### Request Body

```json
{
  "client_version": "0.1.4",
  "reported_at": "2026-03-20T10:00:10Z",
  "events": [
    {
      "resource_id": "cmd-client-sdk-generate-testcase",
      "resource_type": "command",
      "resource_name": "generate-testcase",
      "invocation_count": 5,
      "first_invoked_at": "2026-03-20T09:55:00Z",
      "last_invoked_at": "2026-03-20T09:59:30Z",
      "jira_id": "PROJ-12345"
    },
    {
      "resource_id": "skill-client-sdk-analyze-sdk-log",
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
      "resource_id": "mcp-client-sdk-jenkins",
      "resource_name": "jenkins",
      "configured_at": "2026-03-01T00:00:00Z"
    }
  ]
}
```

### Request Body 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `client_version` | string | 是 | MCP 客户端版本号 |
| `reported_at` | string (ISO 8601) | 是 | 上报时间戳 |
| `events` | array | 是 | Command/Skill 调用的增量事件（可为空数组）。事件来源可以是原生 `prompts/get`，也可以是 `resolve_prompt_content` 成功解析 |
| `events[].resource_id` | string | 是 | 资源唯一 ID |
| `events[].resource_type` | string | 是 | `command` 或 `skill` |
| `events[].resource_name` | string | 是 | 资源名称 |
| `events[].invocation_count` | integer | 是 | 本上报窗口内的调用次数（≥ 1） |
| `events[].first_invoked_at` | string (ISO 8601) | 是 | 本窗口首次调用时间 |
| `events[].last_invoked_at` | string (ISO 8601) | 是 | 本窗口最后调用时间 |
| `events[].jira_id` | string | **否** | Jira Issue ID（如 `PROJ-12345`）。用户不传时此字段**完全省略**（不为 null）。同一资源在不同 jira_id 下形成独立 event 条目 |
| `subscribed_rules` | array | 是 | 当前已订阅的 Rule 全量列表（可为空数组）。Rule 无法统计调用次数（Cursor 引擎内部加载），此字段反映订阅快照 |
| `subscribed_rules[].resource_id` | string | 是 | Rule 资源 ID |
| `subscribed_rules[].resource_name` | string | 是 | Rule 名称 |
| `subscribed_rules[].subscribed_at` | string (ISO 8601) | 是 | 订阅时间 |
| `configured_mcps` | array | 是 | 当前已配置的 MCP 全量列表（可为空数组）。MCP 调用统计由各 MCP 服务自行埋点，此字段仅反映配置快照 |
| `configured_mcps[].resource_id` | string | 是 | MCP 资源 ID |
| `configured_mcps[].resource_name` | string | 是 | MCP 名称 |
| `configured_mcps[].configured_at` | string (ISO 8601) | 是 | 配置时间 |

### Response — Success (200)

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

| 字段 | 类型 | 说明 |
|------|------|------|
| `accepted_count` | integer | 服务端接受的 event 数量 |
| `reported_at` | string | 服务端记录的上报时间（回传客户端时间，便于对账） |

### Response — 认证失败 (401)

```json
{
  "code": 4001,
  "result": "failed",
  "message": "unauthorized"
}
```

### Response — 请求体格式错误 (400)

```json
{
  "code": 4000,
  "result": "failed",
  "message": "invalid request body"
}
```

### Response — 服务端错误 (500)

```json
{
  "code": 5000,
  "result": "failed",
  "message": "internal server error"
}
```

### 客户端行为说明

#### 本地文件存储

- **文件路径**: `{MCP Server 运行目录}/ai-resource-telemetry.json`
  - 运行目录 = MCP Server 进程的 `process.cwd()`，通常为 `SourceCode/` 目录（npm start 的执行目录）
  - **不在** `~/.cursor/` 下，不污染用户侧 Cursor 配置目录
- **文件格式**: JSON，包含 `client_version`、`last_reported_at`、`pending_events`、`subscribed_rules`、`configured_mcps` 五个字段
- **写入保护**: 使用 write-then-rename 原子写（先写 `.tmp`，成功后 rename），防止并发写或进程中断导致文件损坏
- **文件锁**: 软件层面的串行队列（`withFileLock`），保证同一时刻只有一个写操作进行

#### 上报时机（三个触发点）

| 触发时机 | 说明 | 实现位置 |
|---------|------|---------|
| **定时上报** | MCP Server 启动后每 **10 秒**触发一次 flush | `index.ts` → `telemetry.startPeriodicFlush(10_000)` |
| **重连立即上报** | SSE Client 重新连接（`server.oninitialized`）时立即额外触发一次 | `http.ts` → `telemetry.flushOnReconnect()` |
| **优雅关闭最终上报** | 收到 SIGTERM/SIGINT 信号后，先 stop 定时器，再执行最后一次 flush | `index.ts` → `shutdown()` → `telemetry.stopPeriodicFlush()` + `await telemetry.flush()` |

#### 其他行为

- **Token 获取优先级**: 优先使用 SSE 连接中 `Authorization: Bearer` header 里的 token（`lastKnownToken`）；若无 SSE token 则 fallback 到 `process.env.CSP_API_TOKEN`（stdio 模式或单测）；两者均无时本次 flush 静默跳过，不报错
- **失败重试**: 最多重试 3 次（指数退避：500ms → 1s → 2s），全部失败后静默丢弃当次 flush，`pending_events` 保留至下次成功上报
- **幂等性**: 成功上报后清空 `pending_events` 并更新 `last_reported_at`；服务端应按 `(user_id, resource_id, jira_id, reported_at 窗口)` 去重
- **jira_id 聚合**: 同一资源在不同 jira_id 下单独聚合形成独立 event 条目；未传 jira_id 时该字段**完全省略**（不为 null）
- **subscribed_rules / configured_mcps**: 每次 `sync_resources` 或 `manage_subscription` 完成后全量更新到本地文件，随每次 flush 作为快照上报

---

## 附录：MCP Tools 映射（客户端工具）

以下 MCP Tools 是 MCP Server 提供给 Cursor AI 的客户端工具，用于资源管理操作。

### Tool 1: sync_resources

**功能：** 同步订阅的 AI 资源到本地，支持混合同步策略（Hybrid Sync）。

**混合同步策略（v2.0+）：**
- **简单 Skill/Command**（单 `.md` 文件）：仅注册为 MCP Prompt，不下载到本地
- **复杂 Skill**（含 `scripts/`、`teams/` 等目录）：同时注册 MCP Prompt + 下载脚本到本地
- **Rule/MCP**：下载到本地文件系统

**增量更新：**
- 使用 SHA256 哈希对比本地文件与远程内容
- 仅下载新增或变化的文件
- 跳过已是最新的文件

**Input Parameters:**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `mode` | String (enum) | 否 | `incremental` | `check` (仅检查状态), `incremental` (跳过未变化文件), `full` (强制全量) |
| `scope` | String (enum) | 否 | `global` | `global` (~/.cursor/), `workspace` (.cursor/), `all` |
| `types` | Array[String] | 否 | `[]` (all) | 过滤资源类型 (command, skill, rule, mcp) |
| `configured_mcp_servers` | Array[String] | 否 | `[]` | 已配置的 MCP Server 名称列表（用于跳过已安装的 MCP） |

**Output:**

```json
{
  "mode": "incremental",
  "health_score": 100,
  "summary": {
    "total": 10,
    "synced": 8,
    "cached": 0,
    "skipped": 2,
    "failed": 0
  },
  "skipped_resources": [
    {
      "name": "zoom-build",
      "reason": "already_up_to_date"
    }
  ],
  "local_actions_required": [
    {
      "action": "write_file",
      "path": "~/.cursor/skills/zoom-build/scripts/build-cli",
      "content": "#!/usr/bin/env node\n...",
      "mode": "0755",
      "encoding": "utf8"
    }
  ]
}
```

**关键字段说明：**
- `skipped`: 增量模式下跳过的资源数量（本地已是最新）
- `skipped_resources`: 被跳过资源的详细信息（含原因）
- `local_actions_required`: AI 必须在用户本地机器执行的文件操作指令

**调用示例（AI Agent 侧）：**

```typescript
// Step 1: Read configured MCPs
const mcpJson = JSON.parse(fs.readFileSync('~/.cursor/mcp.json', 'utf8'));
const configuredMcps = Object.keys(mcpJson.mcpServers || {});

// Step 2: Sync resources
const result = await mcpClient.callTool('sync_resources', {
  mode: 'incremental',
  configured_mcp_servers: configuredMcps
});

// Step 3: Execute local actions
for (const action of result.local_actions_required || []) {
  if (action.action === 'write_file') {
    // Check if file already up-to-date
    const localPath = expandPath(action.path);
    const localContent = fs.existsSync(localPath) 
      ? fs.readFileSync(localPath, 'utf8') 
      : null;
    
    if (localContent === action.content) {
      console.log(`Skipped (already up-to-date): ${action.path}`);
      continue;
    }
    
    // Write file
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, action.content, action.encoding || 'utf8');
    
    // Set permissions (Unix only)
    if (action.mode && process.platform !== 'win32') {
      fs.chmodSync(localPath, parseInt(action.mode, 8));
    }
  }
}
```

---

### Tool 2: manage_subscription

（保持现有文档不变）

---

### Tool 3: search_resources

（保持现有文档不变）

---

### Tool 4: resolve_prompt_content

（保持现有文档不变）

---

### Tool 5: upload_resource

（保持现有文档不变）

---

### Tool 6: uninstall_resource

**功能：** 卸载资源（移除本地文件 + 可选取消订阅）

**混合卸载策略（v2.0+）：**
- **Command/Skill**：注销 MCP Prompt + 删除本地脚本目录（如果存在）
- **Rule**：删除 `~/.cursor/rules/<name>.mdc`
- **MCP**：删除 `~/.cursor/mcp-servers/<name>/` + 移除 `mcp.json` 条目

**Input Parameters:**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `resource_id_or_name` | String | 是 | — | 资源 ID、名称或模糊匹配模式 |
| `remove_from_account` | Boolean | 否 | `false` | 是否同时取消服务端订阅 |

**Output:**

```json
{
  "success": true,
  "removed_resources": [
    {
      "id": "skill-complex-001",
      "name": "zoom-build",
      "path": "[MCP Prompt: general/skill/zoom-build]"
    }
  ],
  "subscription_removed": true,
  "message": "Successfully unregistered 1 MCP Prompt. Local skill directory cleanup action queued (execute local_actions_required). Subscription removed from account.",
  "local_actions_required": [
    {
      "action": "delete_file",
      "path": "~/.cursor/skills/zoom-build",
      "recursive": true
    }
  ]
}
```

**AI Agent 执行逻辑：**

```typescript
const result = await mcpClient.callTool('uninstall_resource', {
  resource_id_or_name: 'zoom-build',
  remove_from_account: true
});

// Execute local cleanup actions
for (const action of result.local_actions_required || []) {
  if (action.action === 'delete_file') {
    const localPath = expandPath(action.path);
    if (fs.existsSync(localPath)) {
      fs.rmSync(localPath, { 
        recursive: action.recursive || false, 
        force: true 
      });
      console.log(`Deleted: ${action.path}`);
    }
  }
}
```

---

## 混合同步架构总览（v2.0+）

### 资源分发策略

| 资源类型 | MCP Prompt 注册 | 本地文件下载 | 判断标准 |
|---------|---------------|------------|---------|
| **简单 Command** | ✅ | ❌ | 单 `.md` 文件 |
| **简单 Skill** | ✅ | ❌ | 仅 `SKILL.md`，无 `scripts/` 目录 |
| **复杂 Skill** | ✅ | ✅ | `has_scripts=true`（含 `scripts/`、`teams/` 等） |
| **Rule** | ❌ | ✅ | Cursor 引擎要求本地文件 |
| **MCP** | ❌ | ✅ | Cursor 引擎要求本地安装 |

### 调用流程（复杂 Skill 示例）

```
用户调用 /skill/zoom-build
  ↓
① Cursor 发起 MCP 请求：prompts/get('general/skill/zoom-build')
  ↓
② MCP Server 记录 telemetry（resource_name, invocation_count, timestamp）
  ↓
③ MCP Server 返回 SKILL.md 内容（动态解析 import 和变量）
  ↓
④ AI 读取 SKILL.md，发现指令：
   "调用 ~/.cursor/skills/zoom-build/scripts/build-cli trigger --preset dev"
  ↓
⑤ AI 执行 Shell 命令：node ~/.cursor/skills/zoom-build/scripts/build-cli ...
  ↓
⑥ 本地脚本运行，返回构建 URL ✅
  ↓
⑦ AI 将结果返回给用户
```

**关键优势：**
- ✅ Telemetry 数据 100% 覆盖（所有调用经过 MCP Server）
- ✅ 复杂 Skill 可调用本地脚本和配置
- ✅ 增量同步减少带宽（仅下载变化文件）

---

## 版本历史

- **v1.0** (2026-03-10): 初始 REST API 设计
- **v1.5** (2026-03-15): 纯 MCP Prompt 模式（telemetry 支持）
- **v2.0** (2026-03-27): 混合同步策略（Prompt + 本地脚本）
