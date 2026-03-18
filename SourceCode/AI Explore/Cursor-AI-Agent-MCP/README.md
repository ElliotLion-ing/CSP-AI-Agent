# CSP-AI-Agent MCP Server

**版本**: 1.0.0  
**状态**: ✅ **生产就绪** (Stage 1-6 已完成)  
**许可证**: MIT

> CSP AI Agent MCP Server - 集中管理和分发 AI 工具的 MCP (Model Context Protocol) 服务器

---

## 📋 项目简介

CSP-AI-Agent MCP Server 是一个基于 **Model Context Protocol (MCP)** 的服务器应用，用于集中管理、分发和同步团队的 AI 开发工具（commands、skills、rules、MCP 配置）。

**解决的问题**：
- ✅ 部门内 AI 开发工具分散管理，难以共享
- ✅ 工具更新依赖手动操作，版本不一致
- ✅ 开发者无法快速发现和安装团队精选工具
- ✅ 自定义工具难以分享给团队其他成员

**核心价值**：
- 🚀 一键安装团队工具
- 🔄 自动同步更新
- 🔍 快速发现可用资源
- 📦 统一工具标准和版本管理

---

## 🌟 主要功能

### ✅ 已实现功能 (Stage 1-6)

- **核心框架** ✅ (Stage 1)
  - TypeScript/Node.js 项目结构
  - 配置管理（环境变量加载和验证）
  - 结构化日志（pino + 自动清理）
  - 优雅启动和关闭

- **MCP Server 基础** ✅ (Stage 2)
  - MCP 协议处理器（tools/list, tools/call）
  - 工具注册表系统
  - Stdio 传输协议
  - 5个 MCP 工具占位符（已替换为真实实现）

- **MCP Tools 真实实现** ✅ (Stage 3)
  - 自定义错误类型（GitError, APIError, ValidationError, FileSystemError）
  - REST API Client（Axios + 重试 + 日志）
  - Git 操作模块（克隆、拉取、提交推送）
  - 文件系统管理器（原子写入、验证、备份）
  - **5个工具完整实现**：
    - `sync_resources` - 资源同步（API + Git + 文件系统）
    - `manage_subscription` - 订阅管理（订阅/取消/列表/批量操作）
    - `search_resources` - 资源搜索（API + 缓存 + 安装状态检查）
    - `upload_resource` - 资源上传（Git 提交 + 版本号生成）
    - `uninstall_resource` - 资源卸载（模糊匹配 + 清理空目录）

- **SSE Transport and HTTP Server** ✅ (Stage 4)
  - Fastify HTTP 服务器（高性能 Web 框架）
  - SSE (Server-Sent Events) 传输协议（实时推送）
  - Session 管理和追踪（UUID + 自动超时清理）
  - 双传输模式支持（stdio + SSE）
  - 4 个 HTTP 端点：
    - `GET /` - 服务器信息
    - `GET /health` - 健康检查（uptime, memory, sessions, services）
    - `POST /sse` - SSE 连接建立（Bearer token 认证）
    - `POST /message` - 客户端消息处理（MCP JSON-RPC）
  - Keepalive 机制（30 秒心跳）
  - 优雅关闭（关闭所有活跃连接）
  - CORS 和安全头（@fastify/cors, @fastify/helmet）

- **认证和缓存** ✅ (Stage 5)
  - Token 认证（基于 CSP API `/user/permissions`）
  - 权限检查系统（基于 groups）
  - 两层缓存架构：
    - L1: 内存缓存（LRU，快速访问）
    - L2: Redis 缓存（持久化，跨实例共享）
  - 缓存统计和监控

- **生产就绪** ✅ (Stage 6)
  - 增强的健康检查（服务状态、内存、会话）
  - 优雅关闭（SIGTERM/SIGINT，4 阶段关闭）
  - 请求验证增强（字段级错误 + 智能建议）
  - 完整的配置管理（25+ 环境变量）
  - 完整测试套件（10+ 测试用例）
  - 生产文档（API Reference, Deployment Guide, Operations Manual）

### 🚧 未来功能（可选）

- **监控增强**
  - Prometheus metrics
  - 性能基准测试
  - 长期稳定性测试

- **部署工具**
  - Docker 镜像
  - CI/CD pipeline
  - Kubernetes 部署

---

## 🚀 快速开始

### 前置要求

- **Node.js**: >= 18.0.0
- **npm**: >= 9.0.0
- **Git**: 用于资源管理

### 安装步骤

```bash
# 1. 克隆项目
git clone <repository-url>
cd Cursor-AI-Agent-MCP

# 2. 进入源代码目录
cd SourceCode

# 3. 安装依赖
npm install

# 4. 复制环境变量模板
cp .env.example .env

# 5. 编辑 .env 文件，配置必要的参数
vim .env  # 或使用你喜欢的编辑器
```

### 配置说明

在 `.env` 文件中配置以下变量：

```bash
# 必填配置
NODE_ENV=development          # 环境: development/production/test
PORT=5090                     # 服务端口（stdio 模式）
LOG_LEVEL=info               # 日志级别: debug/info/warn/error

# Transport 配置
TRANSPORT_MODE=stdio         # stdio (本地) 或 sse (远程)

# HTTP Server 配置（SSE 模式）
HTTP_HOST=0.0.0.0           # HTTP 监听地址
HTTP_PORT=3000              # HTTP 监听端口

# Session 配置（SSE 模式）
SESSION_TIMEOUT=3600        # Session 超时时间（秒）

# 优雅关闭配置
# Maximum time (in milliseconds) to wait for graceful shutdown before forcing exit
# Default: 30000 (30 seconds)
SHUTDOWN_TIMEOUT=30000

# CSP API 配置
CSP_API_BASE_URL=https://csp.example.com/api

# CSP API Token (This is the JWT token issued by CSP system)
# Used for:
# 1. Validating user authentication via GET /csp/api/user/permissions
# 2. Authorization header for all CSP API calls
CSP_API_TOKEN=your_jwt_token_here

CSP_API_TIMEOUT=30000

# Git 配置
GIT_REPO_URL=https://github.com/your-org/csp-resources.git
GIT_BRANCH=main
GIT_AUTH_TOKEN=your_git_token_here
GIT_USER_NAME=CSP Agent
GIT_USER_EMAIL=agent@example.com

# Resource Storage
RESOURCE_BASE_PATH=~/.cursor/csp-resources

# 可选配置
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://user:pass@localhost:5432/csp
ENABLE_METRICS=true
```

### 运行应用

#### Stdio 模式（本地 Cursor IDE）

```bash
# 设置为 stdio 模式
export TRANSPORT_MODE=stdio

# 开发模式（热重载）
npm run dev

# 编译 TypeScript
npm run build

# 生产模式
npm run start
```

#### SSE 模式（远程部署）

```bash
# 设置为 SSE 模式
export TRANSPORT_MODE=sse
export HTTP_HOST=0.0.0.0
export HTTP_PORT=3000

# 编译并启动
npm run build
node dist/index.js

# 或使用 PM2
pm2 start dist/index.js --name csp-ai-agent-mcp

# 健康检查
curl http://localhost:3000/health

# 查看服务器信息
curl http://localhost:3000/
```

#### 其他命令

```bash
# 类型检查
npm run type-check

# 代码检查
npm run lint
```

---

## 📁 项目结构

```
Cursor-AI-Agent-MCP/
├── SourceCode/                 # 所有源代码
│   ├── package.json           # npm 包配置
│   ├── tsconfig.json          # TypeScript 配置
│   ├── .env.example           # 环境变量模板
│   ├── src/                   # TypeScript 源代码
│   │   ├── index.ts           # 主入口
│   │   ├── server.ts          # MCP Server
│   │   ├── config/            # 配置模块
│   │   ├── utils/             # 工具函数（logger, api-client, git, fs）
│   │   ├── tools/             # MCP Tools 实现
│   │   ├── server/            # HTTP Server（Fastify）
│   │   ├── session/           # Session 管理
│   │   ├── transport/         # SSE Transport
│   │   └── errors/            # 自定义错误类型
│   ├── dist/                  # 编译输出
│   └── node_modules/          # 依赖
├── Test/                      # 测试代码和 Mock Server
│   ├── test-stage1-*.js       # Stage 1 测试
│   ├── test-stage3-*.js       # Stage 3 测试
│   ├── test-stage4-*.js       # Stage 4 测试
│   └── nginx-sse-proxy.conf   # Nginx 配置
├── Docs/                      # 设计文档
│   ├── Stage-1-*.md           # 阶段性文档
│   ├── Stage-3-*.md
│   ├── Stage-4-*.md
│   └── CSP-AI-Agent-*.md      # 完整设计文档
├── Logs/                      # 日志输出
├── Publish/                   # 发布脚本
└── AGENTS.md                  # AI Agent 工作规范
```

---

## 🧪 测试

### 运行测试

```bash
# Stage 1 测试（核心框架）
cd Test
node test-stage1-startup.js

# Stage 4 测试（集成测试）
node test-stage4-integration.js

# Stage 6 测试（生产就绪）
node test-stage6-all.js

# Stage 6 单独测试
node test-stage6-health.js       # 健康检查
node test-stage6-validation.js   # 请求验证
node test-stage6-shutdown.js     # 优雅关闭（需要重启服务）

# Stage 4 SSE 测试（需要先启动服务器）
# 终端 1: 启动 SSE 服务器
cd SourceCode
export TRANSPORT_MODE=sse
npm run build
node dist/index.js

# 终端 2: 运行 SSE 测试
cd Test
node test-stage4-sse-local.js
```

### 测试覆盖

- ✅ **Stage 1**: 核心框架、配置加载、日志记录、优雅关闭 (100% 通过)
- ✅ **Stage 2**: MCP Server、工具注册、协议处理 (100% 通过)
- ✅ **Stage 3**: MCP Tools 真实实现（5个工具完整实现）
- ✅ **Stage 4**: SSE Transport、HTTP Server、Session 管理 (100% 通过，40/40 测试)
- ✅ **Stage 5**: 认证和缓存系统（完整实现）
- ✅ **Stage 6**: 健康检查、优雅关闭、请求验证（10/10 测试通过）

---

## 📊 日志管理

### 日志位置

日志文件存储在项目根目录的 `Logs/` 目录：

```
Logs/
└── app-2026-03-10.log   # 按日期命名的日志文件
```

### 日志格式

日志采用 JSON 结构化格式，便于分析和查询：

```json
{
  "level": 30,
  "time": "2026-03-10T03:31:03.245Z",
  "service": "csp-ai-agent-mcp",
  "msg": "CSP AI Agent MCP Server started successfully"
}
```

### 日志清理

- **保留期限**: 3 天
- **自动清理**: 每天自动删除超过3天的日志文件
- **手动清理**: 系统启动时会立即执行一次清理

---

## 🔧 开发指南

### 技术栈

- **语言**: TypeScript 5.3+ (ES2022)
- **运行时**: Node.js 18+
- **核心依赖**:
  - `@modelcontextprotocol/sdk` - MCP 协议支持
  - `fastify` - 高性能 HTTP 服务器
  - `@fastify/cors` - CORS 中间件
  - `@fastify/helmet` - 安全头中间件
  - `axios` - REST API 客户端
  - `simple-git` - Git 操作
  - `pino` - 结构化日志
  - `dotenv` - 环境变量管理
  - `zod` - 配置验证
  - `pino` - 高性能日志库
  - `dotenv` - 环境变量管理

### 代码规范

- **TypeScript**: Strict mode 启用
- **ESLint**: TypeScript 推荐规则
- **Prettier**: 100 字符宽度，单引号
- **提交规范**: Conventional Commits

### 构建流程

```bash
# 1. 开发（热重载）
npm run dev

# 2. 类型检查
npm run type-check

# 3. 代码检查
npm run lint

# 4. 构建
npm run build

# 5. 测试
npm test
```

---

## 📖 API 文档

### 配置 API

```typescript
import { config } from './config';

// 访问配置
console.log(config.port);        // 5090
console.log(config.logLevel);    // 'info'
console.log(config.csp.apiBaseUrl);
```

### 日志 API

```typescript
import { logger, logToolCall, logError } from './utils/logger';

// 基础日志
logger.info('Application started');
logger.error({ error }, 'Failed to connect');

// Tool 调用日志
logToolCall('sync_resources', 'user-123', { mode: 'incremental' }, 1200);

// 错误日志
try {
  // ...
} catch (error) {
  logError(error as Error, { resourceId: 'res-001' });
}
```

---

## 📚 文档

### 设计文档
- [完整设计文档](./Docs/CSP-AI-Agent-Complete-Design.md)
- [核心架构设计](./Docs/CSP-AI-Agent-Core-Design.md)
- [API 映射文档](./Docs/CSP-AI-Agent-API-Mapping.md)
- [多线程架构](./Docs/CSP-AI-Agent-MultiThread-Architecture.md)
- [日志记录设计](./Docs/CSP-AI-Agent-Logging-Design.md)

### 阶段性实现记录
- [Stage 1: 核心框架](./Docs/Stage-1-Core-Framework.md)
- [Stage 2: MCP Server 基础](./Docs/Stage-2-MCP-Server-Basic.md)
- [Stage 3: MCP Tools 实现](./Docs/Stage-3-*.md)
- [Stage 4: SSE Transport](./Docs/Stage-4-*.md)
- [Stage 5: 认证和缓存](./Docs/Stage-5-*.md)
- [Stage 6: 生产就绪](./Docs/Stage-6-*.md)
- [Stage 6 完成总结](./Docs/Stage-6-Complete-Summary.md)

### 生产文档
- [API Reference](./Docs/API-Reference.md)
- [Deployment Guide](./Docs/Deployment-Guide.md)
- [Operations Manual](./Docs/Operations-Manual.md)
- [Code Review Report](./Docs/Stage-6-Code-Review.md)

### 开发规范
- [AI Agent 工作规范](./AGENTS.md)

---

## 🐛 故障排除

### 常见问题

**Q: npm install 失败**
```bash
# 清理缓存重试
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

**Q: TypeScript 编译错误**
```bash
# 检查 Node.js 版本
node --version  # 应该 >= 18.0.0

# 重新安装 TypeScript
npm install -D typescript@latest
```

**Q: 日志文件未生成**
```bash
# 检查 Logs 目录权限
ls -la ../Logs/

# 手动创建目录
mkdir -p ../Logs
chmod 755 ../Logs
```

**Q: 应用无法启动**
```bash
# 检查环境变量
cat .env

# 查看详细错误日志
LOG_LEVEL=debug npm run dev
```

---

## 🤝 贡献指南

### 开发流程

1. **Fork 项目**
2. **创建功能分支**: `git checkout -b feature/amazing-feature`
3. **提交变更**: `git commit -m 'feat: add amazing feature'`
4. **推送分支**: `git push origin feature/amazing-feature`
5. **提交 Pull Request**

### 代码审查

- ✅ 遵循 TypeScript 严格模式
- ✅ 通过所有 ESLint 检查
- ✅ 添加必要的测试
- ✅ 更新相关文档

---

## 📄 许可证

MIT License - 详见 [LICENSE](./LICENSE) 文件

---

## 📞 联系方式

- **项目维护**: CSP Team
- **问题反馈**: [GitHub Issues](https://github.com/your-org/csp-ai-agent-mcp/issues)
- **文档**: [项目文档](./Docs/)

---

## 🗺️ 路线图

### ✅ Stage 1 - 核心框架 (已完成 2026-03-10)
- [x] 项目初始化
- [x] 配置管理
- [x] 日志记录
- [x] 开发工具链
- [x] 测试通过率: 100%
- [x] 文档: `Docs/Stage-1-Core-Framework.md`

### ✅ Stage 2 - MCP Server 基础 (已完成 2026-03-10)
- [x] MCP SDK 集成
- [x] 工具注册表系统
- [x] 5个 MCP 工具占位符
- [x] MCP 协议处理器
- [x] Stdio 传输协议
- [x] 测试通过率: 100%
- [x] 文档: `Docs/Stage-2-MCP-Server-Basic.md`

### ✅ Stage 3 - MCP Tools 实现 (已完成 2026-03-11)
- [x] sync_resources 真实业务逻辑
- [x] manage_subscription 真实业务逻辑
- [x] search_resources 真实业务逻辑
- [x] upload_resource 真实业务逻辑
- [x] uninstall_resource 真实业务逻辑
- [x] Git 操作集成
- [x] REST API 客户端
- [x] 文档: `Docs/Stage-3-*.md`

### ✅ Stage 4 - SSE 传输协议 (已完成 2026-03-11)
- [x] HTTP Server（Fastify）实现
- [x] SSE 传输协议集成
- [x] 会话管理和自动重连
- [x] 同时支持 stdio 和 SSE
- [x] SSE 连接测试和验证
- [x] 远程部署测试
- [x] 测试通过率: 100% (40/40)
- [x] 文档: `Docs/Stage-4-*.md`

### ✅ Stage 5 - 认证和缓存系统 (已完成 2026-03-11)
- [x] Token 认证（基于 CSP API）
- [x] 权限检查机制（基于 groups）
- [x] Token 管理（API 验证）
- [x] 两层缓存系统（Memory + Redis）
- [x] 性能优化
- [x] 文档: `Docs/Stage-5-*.md`

### ✅ Stage 6 - 生产就绪 (已完成 2026-03-12)
- [x] 健康检查端点（服务状态监控）
- [x] 优雅关闭（SIGTERM/SIGINT）
- [x] 请求验证增强（字段级错误）
- [x] 配置管理（25+ 环境变量）
- [x] 完整测试套件（10+ 测试）
- [x] 生产文档（API, Deployment, Operations）
- [x] 代码审查（质量保证）
- [x] 文档: `Docs/Stage-6-*.md`

### 📅 未来计划（可选）
- [ ] 单元测试覆盖率提升
- [ ] Prometheus metrics 集成
- [ ] Docker 镜像构建
- [ ] CI/CD Pipeline
- [ ] 性能基准测试
- [ ] 长期稳定性测试

---

**最后更新**: 2026-03-12  
**当前版本**: 1.0.0  
**开发状态**: ✅ **生产就绪**  
**部署状态**: 可交付运维团队部署
