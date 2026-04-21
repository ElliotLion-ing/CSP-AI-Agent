# CSP Resource Management API - 测试用例设计

## 概述

本文档定义了基于 `CSP-AI-Agent-API-Mapping.md` 的完整测试用例设计，覆盖所有 API 端点的正常场景、异常场景和边界条件。

## 测试环境配置

- **Mock Server Port**: 6093 (可通过环境变量 `MOCK_RESOURCE_PORT` 修改)
- **Token**: 从 `CSP-Jwt-token.json` 读取
- **Base URL**: `http://127.0.0.1:6093`

## 1. 认证测试

### 1.1 GET /csp/api/user/permissions

#### TC-AUTH-001: 有效 Token 认证成功
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, result: 'success', data: { user_id, email, groups } }`

#### TC-AUTH-002: 缺失 Token
- **请求**: 
  - Headers: 无 Authorization header
- **预期响应**: 
  - Status: 401
  - Body: `{ code: 4010, result: 'failed', message: 'Invalid or expired token' }`

#### TC-AUTH-003: 无效 Token
- **请求**: 
  - Headers: `Authorization: Bearer invalid_token_xyz`
- **预期响应**: 
  - Status: 401
  - Body: `{ code: 4010, result: 'failed', message: 'Invalid or expired token' }`

#### TC-AUTH-004: 错误的 Authorization 格式
- **请求**: 
  - Headers: `Authorization: Token {valid_token}` (不是 Bearer)
- **预期响应**: 
  - Status: 401
  - Body: `{ code: 4010, result: 'failed', message: 'Invalid or expired token' }`

## 2. 搜索资源测试

### 2.1 GET /csp/api/resources/search

#### TC-SEARCH-001: 基本搜索（有结果）
- **请求**: 
  - Query: `?keyword=debug&type=command&page=1&page_size=20`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, result: 'success', data: { total: N, page: 1, page_size: 20, results: [...] } }`
  - 验证: results 包含 keyword "debug" 的资源

#### TC-SEARCH-002: 搜索无结果
- **请求**: 
  - Query: `?keyword=nonexistent-xyz&type=all`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { total: 0, results: [] } }`

#### TC-SEARCH-003: 带详情的搜索
- **请求**: 
  - Query: `?keyword=network&detail=true`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: results 中每个资源包含 `metadata` 字段 (tags, author, downloads 等)

#### TC-SEARCH-004: 按类型过滤
- **请求**: 
  - Query: `?type=skill&page=1&page_size=10`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: results 中所有资源 `type === 'skill'`

#### TC-SEARCH-005: 分页测试（第二页）
- **请求**: 
  - Query: `?keyword=&page=2&page_size=2`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: `{ page: 2, page_size: 2, results: [...] }`

#### TC-SEARCH-006: 超大页面大小限制
- **请求**: 
  - Query: `?page_size=200` (超过最大限制 100)
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: `{ page_size: 100 }` (自动限制为 100)

#### TC-SEARCH-007: 无认证访问
- **请求**: 
  - Query: `?keyword=test`
  - Headers: 无 Authorization
- **预期响应**: 
  - Status: 401
  - Body: `{ code: 4010, result: 'failed' }`

## 3. 获取资源详情测试

### 3.1 GET /csp/api/resources/{id}

#### TC-GET-001: 获取存在的资源
- **请求**: 
  - Path: `/csp/api/resources/zCodeReview-skill-001`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { id, name, type, version, hash, size_bytes, download_url, metadata, ... } }`

#### TC-GET-002: 获取不存在的资源
- **请求**: 
  - Path: `/csp/api/resources/nonexistent-id-123`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 404
  - Body: `{ code: 4008, result: 'failed', message: 'not found' }`

#### TC-GET-003: 权限不足的资源
- **请求**: 
  - Path: `/csp/api/resources/restricted-resource-001` (假设存在受限资源)
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 403
  - Body: `{ code: 4007, result: 'failed', message: 'permission denied' }`

#### TC-GET-004: 无认证访问
- **请求**: 
  - Path: `/csp/api/resources/zCodeReview-skill-001`
  - Headers: 无 Authorization
- **预期响应**: 
  - Status: 401
  - Body: `{ code: 4010, result: 'failed' }`

## 4. 下载资源文件测试

### 4.1 GET /csp/api/resources/download/{id}

#### TC-DOWNLOAD-001: 下载存在的资源
- **请求**: 
  - Path: `/csp/api/resources/download/zCodeReview-skill-001`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Headers: `Content-Type: text/markdown`, `ETag: "sha256:..."`
  - Body: 资源文件内容

#### TC-DOWNLOAD-002: 下载带 gzip 压缩
- **请求**: 
  - Path: `/csp/api/resources/download/Client-Public-skill-002`
  - Headers: `Authorization: Bearer {valid_token}`, `Accept-Encoding: gzip, br`
- **预期响应**: 
  - Status: 200
  - Headers: `Content-Encoding: gzip`, `ETag: "sha256:..."`
  - Body: gzip 压缩的资源内容

#### TC-DOWNLOAD-003: ETag 缓存命中 (304)
- **请求**: 
  - Path: `/csp/api/resources/download/zCodeReview-skill-001`
  - Headers: `Authorization: Bearer {valid_token}`, `If-None-Match: "sha256:def456abc789xyz"`
- **预期响应**: 
  - Status: 304
  - Headers: `ETag: "sha256:def456abc789xyz"`
  - Body: 空

#### TC-DOWNLOAD-004: 下载不存在的资源
- **请求**: 
  - Path: `/csp/api/resources/download/invalid-id-999`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 404
  - Body: `{ code: 4008, result: 'failed', message: 'not found' }`

#### TC-DOWNLOAD-005: 无认证下载
- **请求**: 
  - Path: `/csp/api/resources/download/zCodeReview-skill-001`
  - Headers: 无 Authorization
- **预期响应**: 
  - Status: 401
  - Body: `{ code: 4010, result: 'failed' }`

## 5. 上传资源内容测试

### 5.1 POST /csp/api/resources/upload

#### TC-UPLOAD-001: 成功上传 command
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "content": "# New Debug Tool\n\nDescription...",
      "type": "command",
      "name": "new-debug-tool"
    }
    ```
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { upload_id, status: 'pending', expires_at, preview_url } }`

#### TC-UPLOAD-002: 成功上传 skill
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "content": "# Advanced Skill\n\nContent...",
      "type": "skill",
      "name": "advanced-skill"
    }
    ```
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { upload_id, status: 'pending', ... } }`

#### TC-UPLOAD-003: 缺失必填字段
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "content": "Some content",
      "type": "command"
      // missing "name"
    }
    ```
- **预期响应**: 
  - Status: 400
  - Body: `{ code: 4000, result: 'failed', message: 'Missing required fields: content, type, name' }`

#### TC-UPLOAD-004: 无效的资源类型
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "content": "Content",
      "type": "invalid-type",
      "name": "test"
    }
    ```
- **预期响应**: 
  - Status: 400
  - Body: `{ code: 4000, result: 'failed', message: 'Invalid type, must be: command, skill, rule, or mcp' }`

#### TC-UPLOAD-005: 文件过大 (>10MB)
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "content": "<11MB+ of text>",
      "type": "command",
      "name": "large-file"
    }
    ```
- **预期响应**: 
  - Status: 400
  - Body: `{ code: 4001, result: 'failed', message: 'File size exceeds 10MB limit' }`

#### TC-UPLOAD-006: 资源名称冲突
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "content": "Content",
      "type": "command",
      "name": "debug-network"  // 已存在的名称
    }
    ```
- **预期响应**: 
  - Status: 409
  - Body: `{ code: 4009, result: 'failed', message: 'Resource name already exists' }`

#### TC-UPLOAD-007: 无认证上传
- **请求**: 
  - Headers: 无 Authorization
  - Body: `{ "content": "...", "type": "command", "name": "test" }`
- **预期响应**: 
  - Status: 401
  - Body: `{ code: 4010, result: 'failed' }`

#### TC-UPLOAD-008: 无效的 JSON body
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: `{ invalid json }`
- **预期响应**: 
  - Status: 400
  - Body: `{ code: 4000, result: 'failed', message: 'Invalid request body' }`

## 6. 完成上传测试

### 6.1 POST /csp/api/resources/finalize

#### TC-FINALIZE-001: 成功完成上传
- **前提**: 先执行 TC-UPLOAD-001 获取 upload_id
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "upload_id": "{upload_id_from_TC-UPLOAD-001}",
      "commit_message": "Add new debug tool"
    }
    ```
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { resource_id, version: '1.0.0', url, commit_hash, download_url } }`

#### TC-FINALIZE-002: 不存在的 upload_id
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "upload_id": "nonexistent-upload-id",
      "commit_message": "Test"
    }
    ```
- **预期响应**: 
  - Status: 404
  - Body: `{ code: 4009, result: 'failed', message: 'Upload not found or expired' }`

#### TC-FINALIZE-003: upload_id 已过期
- **前提**: 
  1. 执行上传获取 upload_id
  2. 等待 1 小时（或修改 mock server 使其立即过期）
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "upload_id": "{expired_upload_id}",
      "commit_message": "Test"
    }
    ```
- **预期响应**: 
  - Status: 404
  - Body: `{ code: 4009, result: 'failed', message: 'Upload expired' }`

#### TC-FINALIZE-004: 缺失必填字段
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "upload_id": "some-id"
      // missing "commit_message"
    }
    ```
- **预期响应**: 
  - Status: 400
  - Body: `{ code: 4000, result: 'failed', message: 'Missing required fields: upload_id, commit_message' }`

#### TC-FINALIZE-005: 无认证完成上传
- **请求**: 
  - Headers: 无 Authorization
  - Body: `{ "upload_id": "...", "commit_message": "..." }`
- **预期响应**: 
  - Status: 401
  - Body: `{ code: 4010, result: 'failed' }`

## 7. 获取订阅清单测试

### 7.1 GET /csp/api/resources/subscriptions

#### TC-SUBS-GET-001: 获取所有订阅（无订阅）
- **前提**: 用户无任何订阅
- **请求**: 
  - Query: `?scope=all&detail=false`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { total: 0, subscriptions: [] } }`

#### TC-SUBS-GET-002: 获取所有订阅（有订阅）
- **前提**: 用户已订阅资源（先执行 TC-SUBS-ADD-001）
- **请求**: 
  - Query: `?scope=all&detail=false`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { total: N, subscriptions: [...] } }`

#### TC-SUBS-GET-003: 带详情的订阅清单
- **前提**: 用户已订阅资源
- **请求**: 
  - Query: `?scope=all&detail=true`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: subscriptions 中每项包含 `resource` 字段 (version, hash, download_url, metadata)

#### TC-SUBS-GET-004: 按 scope 过滤
- **前提**: 用户有不同 scope 的订阅
- **请求**: 
  - Query: `?scope=general&detail=false`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: subscriptions 中所有项 `scope === 'general'`

#### TC-SUBS-GET-005: 按类型过滤
- **前提**: 用户订阅了不同类型的资源
- **请求**: 
  - Query: `?types=command,skill`
  - Headers: `Authorization: Bearer {valid_token}`
- **预期响应**: 
  - Status: 200
  - Body: subscriptions 中所有项 `type in ['command', 'skill']`

#### TC-SUBS-GET-006: ETag 缓存命中 (304)
- **前提**: 先执行一次请求获取 ETag
- **请求**: 
  - Query: `?scope=all`
  - Headers: `Authorization: Bearer {valid_token}`, `If-None-Match: "{etag_from_previous}"`
- **预期响应**: 
  - Status: 304
  - Headers: `ETag: "{same_etag}"`
  - Body: 空

#### TC-SUBS-GET-007: 无认证访问
- **请求**: 
  - Query: `?scope=all`
  - Headers: 无 Authorization
- **预期响应**: 
  - Status: 401
  - Body: `{ code: 4010, result: 'failed' }`

## 8. 添加订阅测试

### 8.1 POST /csp/api/resources/subscriptions/add

#### TC-SUBS-ADD-001: 成功订阅单个资源
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "resource_ids": ["zCodeReview-skill-001"],
      "scope": "general"
    }
    ```
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { added_count: 1, subscriptions: [{ id, name, subscribed_at }] } }`

#### TC-SUBS-ADD-002: 批量订阅多个资源
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "resource_ids": ["Client-Public-skill-002", "zDB-cmd-003"],
      "scope": "all"
    }
    ```
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { added_count: 2, subscriptions: [...] } }`

#### TC-SUBS-ADD-003: 重复订阅（幂等操作）
- **前提**: 资源已被订阅
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "resource_ids": ["zCodeReview-skill-001"],
      "scope": "general"
    }
    ```
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { added_count: 0 或 1, ... } }` (幂等，不报错)

#### TC-SUBS-ADD-004: 部分资源不存在
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "resource_ids": ["zCodeReview-skill-001", "invalid-id-xyz"],
      "scope": "all"
    }
    ```
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 4008, result: 'failed', message: 'Resources not found', data: { invalid_ids: ['invalid-id-xyz'], added_ids: ['zCodeReview-skill-001'] } }`

#### TC-SUBS-ADD-005: 权限不足的资源
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "resource_ids": ["restricted-resource-001"]
    }
    ```
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 4007, result: 'failed', message: 'Permission denied', data: { forbidden_ids: ['restricted-resource-001'] } }`

#### TC-SUBS-ADD-006: 缺失 resource_ids
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "scope": "all"
    }
    ```
- **预期响应**: 
  - Status: 400
  - Body: `{ code: 4000, result: 'failed', message: 'Missing or invalid resource_ids array' }`

#### TC-SUBS-ADD-007: resource_ids 不是数组
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "resource_ids": "zCodeReview-skill-001",
      "scope": "all"
    }
    ```
- **预期响应**: 
  - Status: 400
  - Body: `{ code: 4000, result: 'failed', message: 'Missing or invalid resource_ids array' }`

#### TC-SUBS-ADD-008: 无认证添加订阅
- **请求**: 
  - Headers: 无 Authorization
  - Body: `{ "resource_ids": ["..."], "scope": "all" }`
- **预期响应**: 
  - Status: 401
  - Body: `{ code: 4010, result: 'failed' }`

## 9. 取消订阅测试

### 9.1 DELETE /csp/api/resources/subscriptions/remove

#### TC-SUBS-REMOVE-001: 成功取消单个订阅
- **前提**: 用户已订阅该资源
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "resource_ids": ["zCodeReview-skill-001"]
    }
    ```
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { removed_count: 1, message: 'Subscriptions removed successfully' } }`

#### TC-SUBS-REMOVE-002: 批量取消订阅
- **前提**: 用户已订阅多个资源
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "resource_ids": ["Client-Public-skill-002", "zDB-cmd-003"]
    }
    ```
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { removed_count: 2, ... } }`

#### TC-SUBS-REMOVE-003: 取消不存在的订阅（幂等操作）
- **前提**: 用户未订阅该资源
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "resource_ids": ["nonexistent-id-123"]
    }
    ```
- **预期响应**: 
  - Status: 200
  - Body: `{ code: 2000, data: { removed_count: 0, ... } }` (幂等，不报错)

#### TC-SUBS-REMOVE-004: 缺失 resource_ids
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: `{}`
- **预期响应**: 
  - Status: 400
  - Body: `{ code: 4000, result: 'failed', message: 'Missing or invalid resource_ids array' }`

#### TC-SUBS-REMOVE-005: resource_ids 不是数组
- **请求**: 
  - Headers: `Authorization: Bearer {valid_token}`, `Content-Type: application/json`
  - Body: 
    ```json
    {
      "resource_ids": "single-id"
    }
    ```
- **预期响应**: 
  - Status: 400
  - Body: `{ code: 4000, result: 'failed', message: 'Missing or invalid resource_ids array' }`

#### TC-SUBS-REMOVE-006: 无认证取消订阅
- **请求**: 
  - Headers: 无 Authorization
  - Body: `{ "resource_ids": ["..."] }`
- **预期响应**: 
  - Status: 401
  - Body: `{ code: 4010, result: 'failed' }`

## 10. 综合场景测试

### TC-INTEGRATION-001: 完整的资源上传流程
1. 调用 `/upload` 上传资源 → 获取 upload_id
2. 调用 `/finalize` 完成上传 → 获取 resource_id
3. 调用 `/resources/{id}` 验证资源存在
4. 调用 `/download/{id}` 下载资源内容

### TC-INTEGRATION-002: 完整的订阅流程
1. 调用 `/search` 查找资源
2. 调用 `/subscriptions/add` 订阅资源
3. 调用 `/subscriptions` 验证订阅成功
4. 调用 `/download/{id}` 下载已订阅资源
5. 调用 `/subscriptions/remove` 取消订阅
6. 调用 `/subscriptions` 验证取消成功

### TC-INTEGRATION-003: ETag 缓存完整流程
1. 调用 `/download/{id}` 获取 ETag
2. 再次调用 `/download/{id}` 带 If-None-Match → 304
3. 调用 `/subscriptions` 获取 ETag
4. 再次调用 `/subscriptions` 带 If-None-Match → 304

## 11. 边界条件测试

### TC-BOUNDARY-001: 最大页面大小
- 请求 `page_size=100` → 应返回最多 100 条记录
- 请求 `page_size=200` → 应限制为 100 条记录

### TC-BOUNDARY-002: 空数组请求
- 订阅/取消订阅 `resource_ids: []` → 应返回 `added_count/removed_count: 0`

### TC-BOUNDARY-003: 特殊字符处理
- 资源名称包含特殊字符 (空格、中文、emoji)
- 搜索关键词包含特殊字符

### TC-BOUNDARY-004: 大文件处理
- 上传接近 10MB 的文件 → 成功
- 上传超过 10MB 的文件 → 返回 4001 错误

## 12. 性能测试建议

### TC-PERF-001: 并发搜索请求
- 同时发送 10/50/100 个搜索请求
- 验证响应时间和成功率

### TC-PERF-002: 大量订阅操作
- 批量订阅 10/50/100 个资源
- 验证处理时间

### TC-PERF-003: 下载压缩性能
- 对比带/不带 gzip 的下载时间
- 验证压缩率

## 测试执行顺序建议

1. **认证测试** (TC-AUTH-*)
2. **搜索测试** (TC-SEARCH-*)
3. **资源详情和下载测试** (TC-GET-*, TC-DOWNLOAD-*)
4. **上传流程测试** (TC-UPLOAD-*, TC-FINALIZE-*)
5. **订阅管理测试** (TC-SUBS-*)
6. **综合场景测试** (TC-INTEGRATION-*)
7. **边界条件测试** (TC-BOUNDARY-*)

## 自动化测试脚本

建议使用以下工具编写自动化测试：
- **Node.js**: 使用 Jest/Mocha + Supertest
- **Python**: 使用 pytest + requests
- **Shell**: 使用 curl + jq 进行快速验证

详见 `test-runner.js` 和 `test-examples.sh`。
