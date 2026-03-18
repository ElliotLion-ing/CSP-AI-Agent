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
      {
        "path": "examples/demo.md",
        "content": "# Demo\n..."
      }
    ]
  }
}
```

**说明：**
- `files[].path` 是文件在资源目录内的相对路径（不含资源名前缀）
- 单文件资源（command / rule）的 `files` 数组中只有一个元素
- 客户端按 `files[].path` 在 Cursor 目录内重建目录结构

### Response — Not Modified (304)

```
HTTP/1.1 304 Not Modified
ETag: "sha256:def456..."
```

资源未变更，客户端使用本地缓存。

### Response — Not Found (404)

```json
{
  "code": 4008,
  "result": "failed",
  "message": "not found"
}
```

## 4. 上传资源内容（暂存）

上传资源文件内容到服务端暂存，返回 upload_id。需后续调用 finalize 接口完成 Git 提交。

统一使用 `files[]` 数组上传，单文件资源只需数组中放一个元素即可，目录结构通过 `path` 字段保留。

- **URL**: `POST /csp/api/resources/upload`
- **Content-Type**: `application/json`
- **认证**: 需要

### Request Body

| 参数              | 类型     | 必填  | 说明                                         |
| --------------- | ------ | --- | ------------------------------------------ |
| type            | String | 是   | 资源类型: `command` / `skill` / `rule` / `mcp` |
| name            | String | 是   | 资源名称（不含扩展名）                                |
| files           | Array  | 是   | 文件列表，至少包含一个元素                              |
| files[].path    | String | 是   | 文件在资源内的相对路径，不允许 `../` 等路径穿越               |
| files[].content | String | 是   | 文件的文本内容                                    |

### Request Example — 单文件（command）

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

