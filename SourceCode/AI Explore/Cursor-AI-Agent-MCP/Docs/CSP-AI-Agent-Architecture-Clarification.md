# CSP-AI-Agent MCP Server - 系统架构说明

## 📋 核心架构理解

### 1. MCP Server 部署位置
**MCP Server 运行在 CSP Server 上（服务器端部署）**

```
❌ 错误理解：MCP Server 运行在用户本地
✅ 正确理解：MCP Server 运行在 CSP Server 上
```

### 2. 通信方式

```plaintext
Cursor IDE (用户本地)
    ↓
    ↓ SSE 长连接 (MCP 协议)
    ↓
MCP Server (CSP Server 上)
    ├─ 接收用户指令通过 SSE
    ├─ MCP Tools 在服务器端执行
    └─ 调用 CSP REST API (内部调用)
        ↓
    CSP REST API Service
        ├─ 管理数据库 (SQLite/PostgreSQL)
        └─ 操作 Git Repository
```

### 3. 数据存储

**用户本地 (Cursor IDE)**:
- ✅ `~/.cursor/.csp-sync-state.json` - 同步状态文件
  - 由 MCP Server 通过 SSE 返回的 JSON 数据
  - Cursor IDE 保存到本地
  - 用于增量同步时的版本对比
- ✅ `~/.cursor/rules/` - 下载的 commands
- ✅ `~/.cursor/skills/` - 下载的 skills

**MCP Server 端 (CSP Server 上)**:
- ✅ 运行时状态存储在内存 (Map/Set)
- ✅ 通过 Git 命令管理资源文件 (git pull/push)
- ❌ 不使用 SQLite、PostgreSQL 等数据库
- ❌ 不写入服务器端磁盘状态文件

**CSP REST API 端 (CSP Server 上)**:
- ✅ 使用 SQLite/PostgreSQL 管理元数据
- ✅ 这是 REST API 服务自己的数据库
- ❌ 与 MCP Server 无关

**Git Repository (CSP Server 上)**:
- ✅ MCP Server 通过 Git 命令操作本地工作目录
- ✅ Remote: git@git.zoom.us:main/csp.git

---

## 🏗️ 详细架构图

```plaintext
┌──────────────── 用户端 ─────────────────┐
│  Cursor IDE                              │
│  ├─ MCP Client (内置)                    │
│  └─ 通过 SSE 连接 MCP Server             │
└──────────────────────────────────────────┘
           ↓ SSE (MCP 协议)
           ↓
┌──────────────── CSP Server ─────────────┐
│                                          │
│  ┌────────────────────────────────┐     │
│  │  MCP Server (服务器端)          │     │
│  │                                 │     │
│  │  Tools (服务器端执行):          │     │
│  │  ├─ sync_resources              │     │
│  │  ├─ manage_subscription         │     │
│  │  ├─ search_resources            │     │
│  │  └─ upload_resource             │     │
│  │                                 │     │
│  │  状态管理 (内存):               │     │
│  │  └─ Map<resourceId, state>      │     │
│  │                                 │     │
│  │  Git 操作:                      │     │
│  │  ├─ git pull                    │     │
│  │  ├─ git add                     │     │
│  │  ├─ git commit                  │     │
│  │  └─ git push                    │     │
│  └─────────────────────────────────┘     │
│           ↓ REST API (内部调用)          │
│  ┌────────────────────────────────┐     │
│  │  CSP REST API Service           │     │
│  │                                 │     │
│  │  Endpoints:                     │     │
│  │  ├─ GET  /resources/subscriptions    │
│  │  ├─ POST /resources/subscriptions/add│
│  │  ├─ GET  /resources/search           │
│  │  ├─ GET  /resources/download/{id}    │
│  │  ├─ POST /resources/upload           │
│  │  └─ POST /resources/finalize         │
│  │                                 │     │
│  │  数据库 (REST API 管理):        │     │
│  │  └─ SQLite/PostgreSQL           │     │
│  │      ├─ users                   │     │
│  │      ├─ resources               │     │
│  │      ├─ subscriptions           │     │
│  │      └─ metadata                │     │
│  └─────────────────────────────────┘     │
│           ↓ File System                  │
│  ┌────────────────────────────────┐     │
│  │  Git Repository (本地工作目录)  │     │
│  │                                 │     │
│  │  ai-resources/                  │     │
│  │  ├─ commands/                   │     │
│  │  ├─ skills/                     │     │
│  │  ├─ rules/                      │     │
│  │  └─ mcp/                        │     │
│  │                                 │     │
│  │  Remote: git@git.zoom.us:main/csp.git│
│  └─────────────────────────────────┘     │
└──────────────────────────────────────────┘
```

---

## 🔄 数据流向

### 用户发起请求流程

```plaintext
1. 用户在 Cursor IDE 中调用 MCP Tool
   ↓
2. 通过 SSE 连接发送请求到 MCP Server (CSP Server 上)
   ↓
3. MCP Tool 在服务器端执行
   ↓
4. MCP Tool 调用 CSP REST API (内部调用，同一台服务器)
   ↓
5. CSP REST API 处理请求
   ├─ 查询操作 → 查询数据库 → 返回数据
   ├─ 下载操作 → 读取 Git 仓库文件 → 返回文件
   └─ 上传操作 → 保存文件 → Git commit/push
   ↓
6. REST API 返回结果给 MCP Server
   ↓
7. 【如果是下载】MCP Server 通过 git pull 获取最新文件
   ↓
8. MCP Tool 通过 SSE 返回结果给 Cursor IDE
   包含：资源状态 JSON 数据
   ↓
9. Cursor IDE 处理结果
   ├─ 保存状态到 ~/.cursor/.csp-sync-state.json
   ├─ 将资源文件写入 ~/.cursor/rules/
   └─ 将资源文件写入 ~/.cursor/skills/
```

**增量同步流程**:

```plaintext
1. Cursor IDE 读取本地 ~/.cursor/.csp-sync-state.json
   本地状态: { "resource-001": "v1.0.1" }
   ↓
2. 调用 sync_resources (mode: incremental)
   ↓
3. MCP Server 调用 REST API 获取服务端状态
   服务端状态: { "resource-001": "v1.0.2" }
   ↓
4. MCP Server 对比版本
   v1.0.1 vs v1.0.2 → 需要更新
   ↓
5. 下载新版本文件
   ↓
6. 返回更新后的状态 JSON
   ↓
7. Cursor IDE 更新本地 .csp-sync-state.json
   版本更新: v1.0.1 → v1.0.2
```

---

## ⚠️ 关键澄清

### 用户本地状态文件

✅ **正确认知**:
- Cursor IDE 本地保存 `~/.cursor/.csp-sync-state.json`
- 文件内容由 MCP Server 通过 SSE 返回
- 用于增量同步时的版本对比
- 记录已订阅资源的版本、hash 等信息

**数据流向**:
```
MCP Server (调用 REST API) 
  → 获取订阅资源信息
  → 通过 SSE 返回 JSON 给 Cursor
  → Cursor 保存到 ~/.cursor/.csp-sync-state.json
```

### MCP Server 不使用服务器端数据库文件

❌ **错误认知**:
- MCP Server 在服务器端使用 SQLite 存储状态
- MCP Server 写入服务器端的状态文件

✅ **正确认知**:
- MCP Server 运行时状态存储在内存中
- 进程重启后状态丢失（无影响，Cursor 有本地状态）
- 不在服务器端写入磁盘文件（除了 Git 操作）

### CSP REST API 的数据库

✅ **REST API 自己的数据库**:
- CSP REST API 使用 SQLite/PostgreSQL
- 存储用户信息、资源元数据、订阅关系
- **与 MCP Server 完全独立**

### Git 操作主体

✅ **MCP Server 操作 Git**:
- MCP Server 通过 Git 命令操作本地工作目录
- `git pull` 拉取最新资源
- `git add/commit/push` 由 REST API 触发（上传场景）

❌ **不是用户本地操作**:
- 用户本地不执行 Git 命令
- Git 仓库在 CSP Server 上

---

## 📝 总结

| 组件 | 位置 | 职责 | 数据存储 |
|------|------|------|---------|
| **Cursor IDE** | 用户本地 | 发起请求，接收资源，管理本地状态 | `~/.cursor/.csp-sync-state.json` + 资源文件 |
| **MCP Server** | CSP Server | 执行 Tools，调用 API，Git 操作 | 内存状态 (不持久化) |
| **CSP REST API** | CSP Server | 处理请求，管理数据库 | SQLite/PostgreSQL |
| **Git Repository** | CSP Server | 存储资源文件 | 文件系统 |

**关键原则**:
1. MCP Server 运行在服务器端，不在用户本地
2. 通过 SSE 长连接与 Cursor IDE 通信
3. MCP Tools 在服务器端执行，调用 REST API
4. 用户本地有 `.csp-sync-state.json` 用于增量同步对比
5. MCP Server 不使用服务器端数据库，只用内存和 Git
6. 数据库由 CSP REST API 管理，与 MCP Server 无关
