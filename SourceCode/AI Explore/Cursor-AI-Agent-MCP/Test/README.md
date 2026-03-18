# Mock CSP Resource API Server — 本地测试环境

## 概述

`mock-csp-resource-server.js` 是一个完整的本地 CSP Resource Management API 模拟服务，用于在不依赖生产环境的情况下开发和测试 MCP Server 的所有功能。

它不仅模拟 HTTP 接口，还实现了**真实的 Git 操作**：上传资源时会在本地 Git 仓库创建分支、提交文件并 push 到远端，返回真实的 commit hash 和 GitLab MR URL。

---

## 文件结构

```
Test/
├── mock-csp-resource-server.js   # Mock API 服务器（本文档描述的主体）
├── CSP-Jwt-token.json            # JWT Token 配置（认证用）
├── test-cases-design.md          # 测试用例设计文档
├── test-runner.js                # 自动化测试运行器
├── test-examples.sh              # curl 快速验证脚本
├── test-*.js                     # 各阶段集成测试脚本
├── quick-start.sh                # 一键启动脚本
└── README.md                     # 本文档
```

---

## 快速开始

### 启动 Mock Server

```bash
cd Test
node mock-csp-resource-server.js
```

默认监听 `http://0.0.0.0:6093`，可通过环境变量修改端口：

```bash
MOCK_RESOURCE_PORT=8080 node mock-csp-resource-server.js
```

启动后输出：

```
[2026-03-18T03:00:00.000Z] Loaded 37 resources from AI-Resources

========================================
Mock CSP Resource API Server
========================================
Listening on http://0.0.0.0:6093

Available Endpoints:
  POST /auth/validate-token
  GET  /csp/api/resources/search
  GET  /csp/api/resources/{id}
  GET  /csp/api/resources/download/{id}
  POST /csp/api/resources/upload
  POST /csp/api/resources/finalize
  GET  /csp/api/resources/subscriptions
  POST /csp/api/resources/subscriptions/add
  DELETE /csp/api/resources/subscriptions/remove
  GET  /csp/api/user/permissions
  POST /admin/reload-resources  (hot-reload, no auth)
========================================
```

### 获取 Token

Token 存储在 `Test/CSP-Jwt-token.json`：

```bash
TOKEN=$(python3 -c "import json; print(json.load(open('CSP-Jwt-token.json'))['CSP-Jwt-token'])")
```

---

## 核心能力详解

### 1. 资源自动扫描（启动时）

Mock Server 启动时自动扫描 `AI-Resources/` 目录，将所有真实资源加载为可查询的资源列表，无需手动维护 mock 数据。

**扫描规则：**

| 资源类型 | 目录 | 加载方式 |
|---------|------|---------|
| `skill` | `AI-Resources/*/skills/` | 每个子目录为一个资源，读取 `SKILL.md` 作为内容 |
| `mcp` | `AI-Resources/*/mcp/` | 每个子目录为一个资源，读取 `mcp-config.json` |
| `command` | `AI-Resources/*/commands/` | 每个 `.md` 文件为一个资源 |
| `rule` | `AI-Resources/*/rules/` | 每个 `.mdc` 文件为一个资源 |

**优先级：** 多个 source 中同名资源，靠前的 source 优先（由 `ai-resources-config.json` 的 `sources` 顺序决定）。

扫描完成后，资源以如下 ID 格式注册：

```
<type>-<source>-<name>
# 例如：
rule-csp-csp-ai-prompts
skill-client-sdk-ai-hub-analyze-sdk-log
mcp-csp-acm
```

---

### 2. 热重载资源列表

无需重启 server，运行时可动态重新扫描 `AI-Resources/` 目录：

```bash
curl -s -X POST http://127.0.0.1:6093/admin/reload-resources | python3 -m json.tool
```

**响应示例：**

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "before": 36,
    "after": 37,
    "message": "Reloaded 37 resources from AI-Resources directory"
  }
}
```

**使用场景：** 上传新资源后（git pull 或本地写入文件），调用此接口即可让 search/download 接口立刻看到新资源，无需重启。

---

### 3. 两步上传流程（含真实 Git 操作）

资源上传分两步，`finalize` 阶段会执行真实的 Git 操作。

#### Step 1: 上传文件到暂存区

```
POST /csp/api/resources/upload
```

**请求体：**

```json
{
  "type": "rule",
  "name": "csp-ai-prompts",
  "target_source": "csp",
  "force": true,
  "files": [
    {
      "path": "csp-ai-prompts.mdc",
      "content": "文件内容..."
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `type` | 资源类型：`command` / `skill` / `rule` / `mcp` |
| `name` | 资源名称（冲突检测用） |
| `target_source` | 目标 Git 仓库标识，见下方 Source 映射表 |
| `force` | `true` 时跳过名称冲突检查，允许覆盖 |
| `files` | 文件数组，每项包含 `path`（存储路径）和 `content`（文本内容） |

**响应：**

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "upload_id": "temp-1773802977480-3",
    "status": "pending",
    "expires_at": "2026-03-18T04:02:57.480Z",
    "preview_url": "http://127.0.0.1:6093/preview/temp-1773802977480-3"
  }
}
```

暂存数据保存在内存中，1 小时后过期。

#### Step 2: Finalize — 触发真实 Git 操作

```
POST /csp/api/resources/finalize
```

**请求体：**

```json
{
  "upload_id": "temp-1773802977480-3",
  "commit_message": "feat: add csp-ai-prompts rule"
}
```

**Finalize 内部执行的 Git 操作：**

```
1. 根据 target_source 找到本地 Git 仓库路径（SOURCE_REPO_MAP）
2. 将上传的文件写入对应子目录：
   - rule/command（单文件）→ ai-resources/<type>/<filename>
   - skill/mcp（多文件）  → ai-resources/<type>/<name>/
3. git checkout main && git pull --ff-only origin main
4. git checkout -b dev-main-<user>-upload-<timestamp>
5. git add <写入的文件>
6. git commit -m "<commit_message>"
7. git push -u origin <branch>
```

**响应（真实数据）：**

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "resource_id": "Client-Public-rule-038",
    "version": "1.0.0",
    "url": "https://git.zoom.us/main/csp/-/blob/dev-main-elliot-ding-upload-440540",
    "commit_hash": "f6dc9f7985e01d807551a9a4674c90be44993227",
    "download_url": "http://127.0.0.1:6093/csp/api/resources/download/Client-Public-rule-038",
    "mr_url": "https://git.zoom.us/main/csp/-/merge_requests/new?merge_request[source_branch]=dev-main-elliot-ding-upload-440540"
  }
}
```

`commit_hash` 是真实的 40 位 SHA，`mr_url` 可直接在浏览器打开创建 MR。

#### Source → Git 仓库映射表（SOURCE_REPO_MAP）

| `target_source` | 本地仓库路径 | GitLab 项目 URL |
|----------------|-------------|----------------|
| `csp` | `AI-Resources/csp/` | `https://git.zoom.us/main/csp` |
| `client-sdk-ai-hub` | `AI-Resources/client-sdk-ai-hub/` | `https://git.zoom.us/main/client-sdk-ai-hub` |

如果 `target_source` 不在映射表或本地仓库不存在，自动降级为 fake 响应（不报错）。

---

### 4. 资源搜索

```
GET /csp/api/resources/search?keyword=xxx&type=rule&page=1&page_size=20
```

对已加载的资源列表做内存搜索，支持：
- `keyword`：模糊匹配 name、description、metadata.tags
- `type`：精确过滤类型（`command` / `skill` / `rule` / `mcp`）
- `page` / `page_size`：分页

响应中每个资源包含 `is_subscribed`（是否已订阅）和 `is_installed`（本地是否已安装）字段。

---

### 5. 订阅管理

订阅数据保存在内存中（重启后重置），预置了一批默认订阅。

#### 获取订阅列表

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:6093/csp/api/resources/subscriptions
```

#### 添加订阅

```bash
curl -X POST http://127.0.0.1:6093/csp/api/resources/subscriptions/add \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resource_ids": ["rule-csp-csp-ai-prompts"]}'
```

#### 取消订阅

```bash
curl -X DELETE http://127.0.0.1:6093/csp/api/resources/subscriptions/remove \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resource_ids": ["mcp-client-sdk-ai-hub-jenkins"]}'
```

---

### 6. 资源下载

```
GET /csp/api/resources/download/{id}
```

返回该资源的全部文件内容（`files` 数组），支持 gzip 压缩（`Accept-Encoding: gzip`）和 ETag 缓存（304 Not Modified）。

---

### 7. 认证机制

所有接口（除 `/admin/reload-resources`）都需要 Bearer Token。Token 从 `CSP-Jwt-token.json` 读取并缓存。

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:6093/csp/api/user/permissions
```

**返回示例：**

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "user_id": "user-001",
    "email": "elliot.ding@zoom.us",
    "groups": ["Client-Public", "client-sdk-ai-hub"]
  }
}
```

---

## 完整 curl 示例

### 端到端上传测试

```bash
TOKEN=$(python3 -c "import json; print(json.load(open('CSP-Jwt-token.json'))['CSP-Jwt-token'])")

# Step 1: Upload
UPLOAD_RESP=$(python3 -c "
import json
content = open('../csp-ai-prompts.mdc').read()
print(json.dumps({
    'type': 'rule', 'name': 'csp-ai-prompts',
    'target_source': 'csp', 'force': True,
    'files': [{'path': 'csp-ai-prompts.mdc', 'content': content}]
}))
" | curl -s -X POST http://127.0.0.1:6093/csp/api/resources/upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d @-)

UPLOAD_ID=$(echo "$UPLOAD_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['upload_id'])")
echo "upload_id: $UPLOAD_ID"

# Step 2: Finalize (triggers real git commit + push)
curl -s -X POST http://127.0.0.1:6093/csp/api/resources/finalize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"upload_id\": \"$UPLOAD_ID\", \"commit_message\": \"feat: upload csp-ai-prompts rule\"}" \
  | python3 -m json.tool
```

### 热重载后搜索新资源

```bash
# 热重载
curl -s -X POST http://127.0.0.1:6093/admin/reload-resources | python3 -m json.tool

# 搜索
curl -s "http://127.0.0.1:6093/csp/api/resources/search?keyword=csp-ai-prompts&type=rule" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

---

## 错误场景

| HTTP 状态码 | code | 触发条件 |
|------------|------|---------|
| 401 | 4010 | Token 无效或缺失 |
| 400 | 4000 | 请求参数缺失或格式错误 |
| 409 | 4009 | 资源名称冲突（`force: true` 可绕过） |
| 404 | 4009 | upload_id 不存在或已过期 |
| 500 | 5000 | Git 操作失败（branch 冲突、push 权限等） |

---

## 故障排除

### 端口被占用

```bash
lsof -ti :6093 | xargs kill
```

### Git push 失败（SSH 权限）

确认 SSH key 已配置并能访问远端：

```bash
ssh -T git@git.zoom.us
```

### Token 加载失败

确认 `Test/CSP-Jwt-token.json` 存在且格式正确：

```json
{
  "CSP-Jwt-token": "eyJ0eXAiOiJKV1Qi..."
}
```

### 上传后 search 找不到新资源

上传触发的 git 操作在 branch 上，本地 `AI-Resources/csp/` 目录已写入文件，但 server 启动时已扫描完毕。调用热重载接口即可：

```bash
curl -X POST http://127.0.0.1:6093/admin/reload-resources
```

---

## 相关文档

- **API 设计文档**: [`Docs/CSP-AI-Agent-API-Mapping.md`](../Docs/CSP-AI-Agent-API-Mapping.md)
- **测试用例设计**: [`test-cases-design.md`](./test-cases-design.md)
- **MCP Server 源码**: [`SourceCode/src/`](../SourceCode/src/)
