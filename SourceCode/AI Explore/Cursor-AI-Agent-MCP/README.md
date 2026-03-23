# CSP-AI-Agent MCP Server

**版本**: 1.0.4  
**状态**: ✅ **生产就绪**  
**许可证**: MIT

> CSP AI Agent MCP Server — 通过 MCP 协议集中管理、分发和遥测团队 AI 工具（Commands、Skills、Rules、MCP 配置）。

---

## 📋 项目简介

CSP-AI-Agent MCP Server 是一个基于 **Model Context Protocol (MCP)** 的服务器应用，运行在 CSP Server 上，通过 SSE 长连接为 Cursor IDE 提供 AI 资源的集中管理、自动分发、版本同步和使用遥测。

**解决的问题**：
- ✅ 部门内 AI 开发工具分散管理，难以共享
- ✅ 工具更新依赖手动操作，版本不一致
- ✅ 开发者无法快速发现和安装团队精选工具
- ✅ 自定义工具难以分享给团队其他成员
- ✅ 工具使用情况无法统计和追踪

**核心价值**：
- 🚀 一键订阅和安装团队工具
- 🔄 自动同步更新（增量 / 全量）
- 🔍 快速搜索可用资源
- 📦 统一工具标准和版本管理
- 📊 精准遥测 — 按资源、用户、Jira Issue 统计调用次数

---

## 🌟 主要功能

### MCP Tools（6 个）

| 工具 | 功能 |
|------|------|
| `sync_resources` | 资源同步（增量 / 全量 / 检查），安装到 Cursor 目录 |
| `manage_subscription` | 订阅管理（subscribe / unsubscribe / list） |
| `search_resources` | 关键词搜索可用资源（支持按类型、团队过滤） |
| `upload_resource` | 上传新资源到平台（两步法：暂存 + finalize） |
| `uninstall_resource` | 卸载已安装的本地资源文件 |
| `track_usage` | 记录 Command/Skill 调用事件（遥测埋点，自动触发） |

### MCP Prompts（Slash Commands）

Command 和 Skill 类型资源以 **MCP Prompt** 模式提供，直接在 Cursor 中作为 `/slash` 命令使用，无需下发实体文件到用户本地。

- Prompt 命名规范：`{type}/{team}/{resource-name}`，例如 `command/client-sdk/generate-testcase`
- Prompt 内容由 `PromptGenerator` 从资源文件生成，缓存于 `.prompt-cache/`（不进 Git）
- 每次调用时，AI 自动调用 `track_usage` 工具完成遥测埋点

### 遥测系统（Telemetry）

- **本地存储**: `{MCP Server CWD}/ai-resource-telemetry.json`，按 user token 分键存储
- **三个上报时机**:
  - 每 10 秒定时 flush（`startPeriodicFlush`）
  - SSE Client 重连时立即 flush（`flushOnReconnect`）
  - 优雅关闭前最终 flush（`shutdown`）
- **原子写入**: write-then-rename 防止并发损坏
- **差量更新**: flush 成功后仅扣减已上报的 `invocation_count`，不清空整个 `pending_events`，防止并发写入数据丢失
- **失败重试**: 最多 3 次，指数退避（500ms → 1s → 2s）

---

## 🚀 快速开始

### 前置要求

- **Node.js**: >= 18.0.0
- **npm**: >= 9.0.0

### 安装步骤

```bash
# 1. 进入源代码目录
cd SourceCode

# 2. 安装依赖
npm install

# 3. 复制环境变量模板
cp .env.example .env

# 4. 编辑 .env 文件，配置必要参数
```

### 配置说明

`.env` 文件关键配置项：

```bash
# 运行环境
NODE_ENV=development          # development / production / test
LOG_LEVEL=info               # debug / info / warn / error

# 传输模式
TRANSPORT_MODE=stdio         # stdio（本地）或 sse（远程）

# HTTP Server（SSE 模式）
HTTP_HOST=0.0.0.0
HTTP_PORT=3000
SESSION_TIMEOUT=3600

# CSP API
CSP_API_BASE_URL=https://csp.example.com/api
CSP_API_TOKEN=your_jwt_token_here
CSP_API_TIMEOUT=30000

# 优雅关闭超时（毫秒）
SHUTDOWN_TIMEOUT=30000
```

### 运行应用

#### Stdio 模式（本地 Cursor IDE）

```bash
cd SourceCode

# 开发模式（热重载）
npm run dev

# 编译 + 生产启动
npm run build && npm start
```

#### SSE 模式（远程部署）

```bash
export TRANSPORT_MODE=sse
npm run build
node dist/index.js

# 健康检查
curl http://localhost:3000/health
```

---

## 📁 项目结构

```
Cursor-AI-Agent-MCP/
├── SourceCode/                    # TypeScript 源代码（npm 发布此目录）
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── ai-resource-telemetry.json # 本地遥测数据（运行时生成，不进 Git）
│   └── src/
│       ├── index.ts               # 主入口：启动、遥测定时器、优雅关闭
│       ├── server.ts              # MCP Server 初始化
│       ├── api/                   # REST API 客户端（含 reportTelemetry）
│       ├── auth/                  # Token 认证 + 权限检查
│       ├── cache/                 # 两层缓存（内存 LRU + Redis）
│       ├── config/                # 配置加载和验证（zod）
│       ├── filesystem/            # 原子文件操作
│       ├── git/                   # Git 操作（clone/pull/push）
│       ├── monitoring/            # 健康检查端点
│       ├── prompts/               # MCP Prompt 管理（PromptManager + PromptGenerator + cache）
│       ├── resources/             # 资源加载器（从 AI-Resources/ 读取配置）
│       ├── server/                # Fastify HTTP Server（SSE 端点）
│       ├── session/               # SSE Session 管理
│       ├── telemetry/             # 遥测系统（TelemetryManager）
│       ├── tools/                 # MCP Tools 实现
│       │   ├── track-usage.ts     # 遥测埋点工具
│       │   ├── sync-resources.ts
│       │   ├── manage-subscription.ts
│       │   ├── search-resources.ts
│       │   ├── upload-resource.ts
│       │   └── uninstall-resource.ts
│       ├── transport/             # SSE Transport
│       ├── types/                 # TypeScript 类型定义
│       └── utils/                 # 日志（pino）、路径工具等
├── Test/                          # 测试代码和 Mock Server
│   ├── mock-csp-resource-server.js  # Mock CSP Resource API
│   ├── test-feat-telemetry-*.js   # 遥测系统测试
│   └── Test Reports/              # 测试报告归档
├── Docs/
│   ├── Design/                    # 整体架构设计文档（持续更新）
│   ├── FeatureDocs/               # Feature 设计文档归档
│   └── Stage Develop Docs/        # 初期开发阶段文档（历史）
├── NewFeature/                    # 进行中的 Feature 设计文档
├── Bug/                           # Bug 档案库
│   └── Fixed Bugs/                # 已归档 Bug（只读）
├── openspec/                      # OpenSpec 变更管理
│   ├── changes/                   # 活跃 / 已归档变更提案
│   └── specs/                     # 当前能力规格
├── Logs/                          # 运行日志（按日自动轮转，保留 3 天）
├── AI-Resources/                  # 已安装的 AI 资源（不进 Git）
└── AGENTS.md                      # AI Agent 工作规范
```

---

## 📡 HTTP API 端点（SSE 模式）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 服务器信息 |
| `/health` | GET | 健康检查（uptime、内存、会话数、服务状态） |
| `/sse` | POST | 建立 SSE 连接（需 Bearer token） |
| `/message` | POST | MCP JSON-RPC 消息处理 |

---

## 🧪 测试

### 启动 Mock Server

```bash
cd Test
node mock-csp-resource-server.js
# Mock 服务器默认监听 http://localhost:4000
```

### 运行遥测测试

```bash
# 在另一个终端启动 MCP Server
cd SourceCode && TRANSPORT_MODE=stdio npm run dev

# 运行遥测工具测试
node Test/test-feat-telemetry-tools.js

# 运行遥测 manager 测试
node Test/test-feat-telemetry-manager.js

# 运行完整遥测 API 上报测试
node Test/test-feat-telemetry-api.js
```

---

## 📊 日志管理

- **存储位置**: `Logs/app.YYYY-MM-DD.N.log`
- **格式**: JSON 结构化（pino），便于查询和分析
- **保留策略**: 自动清理 3 天前的日志文件
- **日志级别**: `debug` / `info` / `warn` / `error`（通过 `LOG_LEVEL` 控制）

---

## 🔧 开发指南

### 技术栈

| 类别 | 技术选型 |
|------|----------|
| 语言/运行时 | TypeScript 5.3+, Node.js 18+ |
| MCP 协议 | `@modelcontextprotocol/sdk` |
| HTTP Server | Fastify + `@fastify/cors` + `@fastify/helmet` |
| REST Client | Axios（含重试 + 日志） |
| 日志 | pino + pino-roll（自动轮转） |
| 配置验证 | zod |
| 缓存 | LRU 内存缓存 + Redis（可选） |
| 测试 | 纯 Node.js 脚本（`Test/`） |

### 构建命令

```bash
npm run dev          # 开发模式（ts-node + 热重载）
npm run build        # 编译 TypeScript → dist/
npm run type-check   # 类型检查（无输出）
npm run lint         # ESLint 检查
```

---

## 🐛 故障排除

**npm install 失败**
```bash
rm -rf node_modules package-lock.json
npm cache clean --force && npm install
```

**遥测文件未更新**
```bash
# 确认 MCP Server 正在运行，检查日志
tail -f Logs/app.$(date +%Y-%m-%d).1.log | grep -i telemetry
```

**应用无法启动**
```bash
LOG_LEVEL=debug npm run dev
```

---

## 📚 文档

### 设计文档（`Docs/Design/`）
- [核心架构设计](./Docs/Design/CSP-AI-Agent-Core-Design.md) — 系统概述、架构图、Resource ID 命名规范、MCP Tools API 规范
- [完整设计方案](./Docs/Design/CSP-AI-Agent-Complete-Design.md) — 工具详细设计、技术选型、部署方案、安全设计
- [API 映射文档](./Docs/Design/CSP-AI-Agent-API-Mapping.md) — 所有 REST API 接口规范（含遥测上报 API）
- [多线程架构](./Docs/Design/CSP-AI-Agent-MultiThread-Architecture.md) — 异步并发模型
- [日志记录设计](./Docs/Design/CSP-AI-Agent-Logging-Design.md) — pino 日志方案

### 开发规范
- [AI Agent 工作规范](./AGENTS.md) — OpenSpec 流程、测试验证、Bug 管理等

---

## 📄 许可证

MIT License

---

**最后更新**: 2026-03-23  
**当前版本**: 1.0.4  
**开发状态**: ✅ **生产就绪**
