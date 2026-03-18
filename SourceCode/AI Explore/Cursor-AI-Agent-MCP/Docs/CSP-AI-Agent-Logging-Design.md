# CSP-AI-Agent MCP Server - 日志记录模块设计

**版本**: v1.0  
**日期**: 2026-03-09  
**状态**: Design Draft

---

## 📋 目录

1. [设计目标](#一设计目标)
2. [技术选型](#二技术选型)
3. [日志架构](#三日志架构)
4. [实现方案](#四实现方案)
5. [日志清理策略](#五日志清理策略)
6. [使用示例](#六使用示例)
7. [配置说明](#七配置说明)
8. [监控与告警](#八监控与告警)

---

## 一、设计目标

### 1.1 核心需求

- ✅ 所有日志打印到本地文件（不输出到控制台）
- ✅ 日志文件保存在 `logs/` 目录
- ✅ 自动清理 3 天前的日志文件
- ✅ 结构化日志格式（JSON）
- ✅ 支持日志级别控制
- ✅ 日志轮转（按日期或大小）
- ✅ 高性能，不影响主业务

### 1.2 日志场景

| 场景 | 日志级别 | 示例 |
|------|---------|------|
| MCP Tool 调用 | INFO | `sync_resources called by user:123` |
| REST API 请求 | INFO | `GET /api/resources/subscriptions - 200 OK (120ms)` |
| Git 操作 | INFO | `git pull completed: 5 files updated` |
| 错误处理 | ERROR | `Failed to download resource: Network timeout` |
| 调试信息 | DEBUG | `Cache hit: codereview-command-001` |
| 性能追踪 | INFO | `sync_resources completed in 1.2s` |

---

## 二、技术选型

### 2.1 npm 包选择: `pino` + `pino-roll`

**选择理由**:

| 维度 | 说明 |
|------|------|
| **性能** | 🚀 业界最快的 Node.js 日志库<br>异步日志，不阻塞主线程 |
| **JSON 格式** | 📝 原生支持结构化日志<br>便于日志分析工具解析 |
| **文件轮转** | 🔄 `pino-roll` 支持按日期/大小轮转<br>自动创建新文件 |
| **生态成熟** | ⭐ npm 周下载量 > 2000 万<br>社区活跃，维护良好 |
| **低内存占用** | 💾 内存效率高<br>适合长期运行的服务 |
| **TypeScript 支持** | ✅ 完整的类型定义<br>开发体验好 |

**对比其他方案**:

| 方案 | 优势 | 劣势 | 综合评分 |
|------|------|------|---------|
| **pino + pino-roll** | 极致性能、JSON 格式、文件轮转、生态好 | 需要额外安装 pino-roll | ⭐⭐⭐⭐⭐ |
| winston | 功能丰富、配置灵活 | 性能较差、配置复杂 | ⭐⭐⭐⭐ |
| bunyan | JSON 格式、稳定 | 性能一般、不再活跃维护 | ⭐⭐⭐ |
| log4js | 类似 Java Log4j | 性能差、配置繁琐 | ⭐⭐ |

### 2.2 依赖安装

```bash
npm install pino pino-roll
npm install -D @types/pino
```

**package.json**:
```json
{
  "dependencies": {
    "pino": "^8.19.0",
    "pino-roll": "^1.1.0"
  }
}
```

---

## 三、日志架构

### 3.1 目录结构

```plaintext
CSP Server
├── csp-ai-agent-mcp/
│   ├── logs/                       # 日志目录（运行时生成）
│   │   ├── app-2026-03-09.log      # 当天日志
│   │   ├── app-2026-03-08.log      # 昨天日志
│   │   ├── app-2026-03-07.log      # 前天日志
│   │   └── error-2026-03-09.log    # 错误日志（可选）
│   ├── src/
│   │   ├── utils/
│   │   │   └── logger.ts           # 日志工具模块
│   │   └── index.ts
│   └── package.json
```

### 3.2 日志级别

```typescript
enum LogLevel {
  TRACE = 10,    // 最详细的调试信息
  DEBUG = 20,    // 调试信息
  INFO = 30,     // 常规信息（默认）
  WARN = 40,     // 警告信息
  ERROR = 50,    // 错误信息
  FATAL = 60     // 致命错误
}
```

### 3.3 日志格式

**JSON 结构化日志**:

```json
{
  "level": 30,
  "time": 1709971200000,
  "timestamp": "2026-03-09T10:00:00.000Z",
  "pid": 12345,
  "hostname": "csp-server-01",
  "name": "csp-ai-agent-mcp",
  "msg": "sync_resources completed successfully",
  
  "userId": "user-123",
  "userToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "toolName": "sync_resources",
  "toolParams": {
    "mode": "incremental",
    "scope": "global"
  },
  "duration": 1200,
  "resourceCount": 5,
  
  "v": 1
}
```

**关键字段说明**:

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `level` | number | ✅ | 日志级别 (10=TRACE, 20=DEBUG, 30=INFO, 40=WARN, 50=ERROR, 60=FATAL) |
| `time` | number | ✅ | Unix 时间戳（毫秒） |
| `timestamp` | string | ✅ | ISO 8601 格式时间 |
| `pid` | number | ✅ | 进程 ID |
| `hostname` | string | ✅ | 服务器主机名 |
| `name` | string | ✅ | 服务名称 |
| `msg` | string | ✅ | 日志消息 |
| **`userId`** | string | ✅ | **用户 ID**（从 SSE 连接获取） |
| **`userToken`** | string | ✅ | **用户认证 Token**（用于审计和追踪） |
| **`toolName`** | string | ⭐ | **调用的 MCP Tool 名称** |
| `toolParams` | object | ⚪ | Tool 调用参数 |
| `duration` | number | ⚪ | 操作耗时（毫秒） |
| `requestId` | string | ⚪ | 请求追踪 ID |
| `v` | number | ✅ | 日志格式版本 |

**⚠️ 安全注意**: userToken 记录完整值用于审计，但在查询日志时建议脱敏显示（只显示前后各 8 位）。

---

## 四、实现方案

### 4.1 日志工具模块 (`src/utils/logger.ts`)

```typescript
import pino from 'pino';
import pinoRoll from 'pino-roll';
import path from 'path';
import fs from 'fs';

/**
 * Logger Configuration
 */
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// 确保 logs 目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 创建日志记录器
 */
export const logger = pino(
  {
    level: LOG_LEVEL,
    name: 'csp-ai-agent-mcp',
    
    // 基础配置
    base: {
      pid: process.pid,
      hostname: require('os').hostname(),
    },
    
    // 时间戳格式（同时包含 time 和 timestamp）
    timestamp: () => {
      const now = Date.now();
      const iso = new Date(now).toISOString();
      return `,"time":${now},"timestamp":"${iso}"`;
    },
    
    // 自定义序列化
    serializers: {
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
      err: pino.stdSerializers.err,
      
      // 自定义 Token 序列化（完整记录，但可配置脱敏）
      userToken: (token: string) => {
        // 生产环境建议脱敏：只保留前后 8 位
        if (process.env.NODE_ENV === 'production' && process.env.LOG_MASK_TOKEN === 'true') {
          if (token && token.length > 16) {
            return `${token.substring(0, 8)}...${token.substring(token.length - 8)}`;
          }
        }
        // 开发环境或审计需求：完整记录
        return token;
      },
    },
  },
  pinoRoll({
    // 日志文件配置
    file: path.join(LOG_DIR, 'app'),
    
    // 文件轮转策略
    frequency: 'daily',           // 按日轮转
    dateFormat: 'yyyy-MM-dd',     // 日期格式
    
    // 文件大小限制（可选，超过自动轮转）
    size: '100M',                 // 单文件最大 100MB
    
    // 同步写入（确保日志不丢失）
    sync: false,                  // 异步写入（性能更好）
  })
);

/**
 * 日志上下文管理（包含用户信息）
 */
export function createLogContext(context: {
  userId?: string;
  userToken?: string;
  requestId?: string;
  [key: string]: any;
}) {
  return logger.child(context);
}

/**
 * 记录 MCP Tool 调用（包含完整维度）
 */
export function logToolCall(
  toolName: string,
  userId: string,
  userToken: string,
  params: any,
  duration?: number
) {
  logger.info({
    type: 'tool_call',
    toolName,           // 工具名称
    userId,             // 用户 ID
    userToken,          // 用户 Token（用于审计）
    toolParams: params, // 工具参数
    duration,           // 耗时
  }, `Tool ${toolName} called by user ${userId}`);
}

/**
 * 记录 REST API 请求
 */
export function logApiRequest(
  method: string,
  url: string,
  statusCode: number,
  duration: number,
  userId?: string,
  userToken?: string
) {
  logger.info({
    type: 'api_request',
    method,
    url,
    statusCode,
    duration,
    userId,
    userToken,
  }, `${method} ${url} - ${statusCode} (${duration}ms)`);
}

/**
 * 记录 Git 操作
 */
export function logGitOperation(
  operation: string,
  details: any,
  userId?: string
) {
  logger.info({
    type: 'git_operation',
    operation,
    userId,
    ...details,
  }, `Git ${operation} completed`);
}

/**
 * 记录错误（包含用户上下文）
 */
export function logError(
  error: Error,
  context?: {
    userId?: string;
    userToken?: string;
    toolName?: string;
    [key: string]: any;
  }
) {
  logger.error({
    type: 'error',
    err: error,
    stack: error.stack,
    ...context,
  }, error.message);
}

/**
 * 记录性能指标
 */
export function logPerformance(
  operation: string,
  duration: number,
  metadata?: Record<string, any>
) {
  logger.info({
    type: 'performance',
    operation,
    duration,
    ...metadata,
  }, `${operation} completed in ${duration}ms`);
}

/**
 * 优雅关闭
 */
export function closeLogger() {
  return new Promise<void>((resolve) => {
    logger.flush(() => {
      resolve();
    });
  });
}
```

### 4.2 在 MCP Server 中使用

**示例 1: sync_resources Tool**

```typescript
import { logger, logToolCall, logError } from '../utils/logger';

export async function syncResources(
  params: SyncResourcesInput,
  context: { userId: string; userToken: string }
) {
  const startTime = Date.now();
  const { userId, userToken } = context;
  
  try {
    logger.info({ 
      userId, 
      userToken,
      toolName: 'sync_resources',
      params 
    }, 'Starting sync_resources');
    
    // 调用 REST API
    const response = await cspClient.getSubscriptions();
    
    // 下载资源
    for (const resource of response.subscriptions) {
      logger.debug({ 
        userId,
        resourceId: resource.id 
      }, `Downloading ${resource.id}`);
      await downloadResource(resource.id);
    }
    
    const duration = Date.now() - startTime;
    
    // 记录完整日志：时间戳、用户Token、工具名称、耗时
    logToolCall('sync_resources', userId, userToken, params, duration);
    
    return { success: true, duration };
    
  } catch (error) {
    logError(error as Error, { 
      userId, 
      userToken,
      toolName: 'sync_resources',
      params 
    });
    throw error;
  }
}
```

**示例 2: SSE 连接处理（获取用户上下文）**

```typescript
import { logger, createLogContext } from '../utils/logger';

// 处理 SSE 连接，提取用户信息
export async function handleSseConnection(req: Request) {
  // 从请求头获取 Token
  const userToken = req.headers.authorization?.replace('Bearer ', '');
  
  // 验证 Token 并获取用户 ID
  const user = await validateToken(userToken);
  const userId = user.id;
  
  // 创建带用户上下文的日志记录器
  const requestLogger = createLogContext({
    userId,
    userToken,
    requestId: generateRequestId(),
  });
  
  requestLogger.info('SSE connection established');
  
  // 将用户上下文传递给后续的 Tool 调用
  return { userId, userToken, logger: requestLogger };
}
```

**示例 3: 完整的 Tool 调用流程**

```typescript
// MCP Server 接收 Tool 调用
export async function handleToolCall(
  toolName: string,
  params: any,
  context: { userId: string; userToken: string }
) {
  const { userId, userToken } = context;
  const startTime = Date.now();
  
  // 创建带上下文的日志
  const toolLogger = createLogContext({
    userId,
    userToken,
    toolName,
    requestId: generateRequestId(),
  });
  
  toolLogger.info({ params }, `Tool ${toolName} invoked`);
  
  try {
    let result;
    
    // 根据工具名称调用对应的处理函数
    switch (toolName) {
      case 'sync_resources':
        result = await syncResources(params, context);
        break;
      case 'manage_subscription':
        result = await manageSubscription(params, context);
        break;
      case 'search_resources':
        result = await searchResources(params, context);
        break;
      case 'upload_resource':
        result = await uploadResource(params, context);
        break;
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
    
    const duration = Date.now() - startTime;
    
    // 记录成功日志（包含所有维度）
    logToolCall(toolName, userId, userToken, params, duration);
    
    return result;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // 记录错误日志（包含所有维度）
    logError(error as Error, {
      userId,
      userToken,
      toolName,
      params,
      duration,
    });
    
    throw error;
  }
}
```

**示例 2: REST API 客户端**

```typescript
import axios from 'axios';
import { logApiRequest } from '../utils/logger';

async function callApi(
  method: string, 
  url: string,
  context?: { userId?: string; userToken?: string }
) {
  const startTime = Date.now();
  
  try {
    const response = await axios({ method, url });
    const duration = Date.now() - startTime;
    
    logApiRequest(
      method, 
      url, 
      response.status, 
      duration,
      context?.userId,
      context?.userToken
    );
    
    return response.data;
    
  } catch (error) {
    const duration = Date.now() - startTime;
    logApiRequest(
      method, 
      url, 
      error.response?.status || 500, 
      duration,
      context?.userId,
      context?.userToken
    );
    throw error;
  }
}
```

**示例 3: Git 操作**

```typescript
import simpleGit from 'simple-git';
import { logGitOperation } from '../utils/logger';

async function gitPull(userId?: string) {
  const git = simpleGit('/path/to/repo');
  
  try {
    const result = await git.pull();
    
    logGitOperation('pull', {
      summary: result.summary,
      files: result.files.length,
      insertions: result.summary.insertions,
      deletions: result.summary.deletions,
    }, userId);
    
    return result;
    
  } catch (error) {
    logError(error as Error, { 
      operation: 'git pull',
      userId 
    });
    throw error;
  }
}
```

---

## 五、日志清理策略

### 5.1 自动清理脚本

**创建 `src/utils/log-cleaner.ts`**:

```typescript
import fs from 'fs';
import path from 'path';
import { logger } from './logger';

/**
 * 日志清理配置
 */
const LOG_DIR = path.join(process.cwd(), 'logs');
const RETENTION_DAYS = 3; // 保留 3 天

/**
 * 清理过期日志文件
 */
export async function cleanOldLogs(): Promise<void> {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      return;
    }
    
    const now = Date.now();
    const cutoffTime = now - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    const files = fs.readdirSync(LOG_DIR);
    let deletedCount = 0;
    
    for (const file of files) {
      // 只处理 .log 文件
      if (!file.endsWith('.log')) {
        continue;
      }
      
      const filePath = path.join(LOG_DIR, file);
      const stats = fs.statSync(filePath);
      
      // 检查文件修改时间
      if (stats.mtime.getTime() < cutoffTime) {
        fs.unlinkSync(filePath);
        deletedCount++;
        logger.info({ file, age: now - stats.mtime.getTime() }, 
          `Deleted old log file: ${file}`);
      }
    }
    
    if (deletedCount > 0) {
      logger.info({ deletedCount }, `Cleaned up ${deletedCount} old log files`);
    }
    
  } catch (error) {
    logger.error({ err: error }, 'Failed to clean old logs');
  }
}

/**
 * 启动定时清理任务
 */
export function startLogCleanupSchedule(): NodeJS.Timeout {
  // 每天凌晨 2 点执行清理
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 小时
  
  // 首次启动时清理一次
  cleanOldLogs();
  
  // 定时清理
  const intervalId = setInterval(() => {
    cleanOldLogs();
  }, CLEANUP_INTERVAL);
  
  logger.info({ retentionDays: RETENTION_DAYS }, 
    'Log cleanup scheduler started');
  
  return intervalId;
}

/**
 * 停止清理任务
 */
export function stopLogCleanupSchedule(intervalId: NodeJS.Timeout): void {
  clearInterval(intervalId);
  logger.info('Log cleanup scheduler stopped');
}
```

### 5.2 在主程序中集成

**更新 `src/index.ts`**:

```typescript
import { logger, closeLogger } from './utils/logger';
import { startLogCleanupSchedule, stopLogCleanupSchedule } from './utils/log-cleaner';

let cleanupSchedule: NodeJS.Timeout;

async function start() {
  logger.info('CSP-AI-Agent MCP Server starting...');
  
  // 启动日志清理任务
  cleanupSchedule = startLogCleanupSchedule();
  
  // 启动 MCP Server
  await startMcpServer();
  
  logger.info('CSP-AI-Agent MCP Server started successfully');
}

async function shutdown() {
  logger.info('CSP-AI-Agent MCP Server shutting down...');
  
  // 停止日志清理
  if (cleanupSchedule) {
    stopLogCleanupSchedule(cleanupSchedule);
  }
  
  // 停止 MCP Server
  await stopMcpServer();
  
  // 刷新日志缓冲
  await closeLogger();
  
  logger.info('CSP-AI-Agent MCP Server stopped');
  process.exit(0);
}

// 监听进程退出信号
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start server');
  process.exit(1);
});
```

---

## 六、使用示例

### 6.1 基础日志记录

```typescript
import { logger, createLogContext } from './utils/logger';

// INFO 级别（包含时间戳、用户信息、工具名称）
logger.info({
  userId: 'user-123',
  userToken: 'eyJhbGci...',
  toolName: 'sync_resources',
}, 'Starting resource sync');

// 带完整上下文
logger.info({ 
  userId: 'user-123',
  userToken: 'eyJhbGci...',
  toolName: 'manage_subscription',
  action: 'subscribe',
  resourceIds: ['resource-001', 'resource-002']
}, 'User subscribed to resources');

// DEBUG 级别
logger.debug({ 
  userId: 'user-123',
  cacheKey: 'resource-001' 
}, 'Cache hit');

// WARN 级别
logger.warn({ 
  userId: 'user-123',
  toolName: 'sync_resources',
  retryCount: 3 
}, 'Retry limit approaching');

// ERROR 级别（包含用户上下文）
logger.error({ 
  userId: 'user-123',
  userToken: 'eyJhbGci...',
  toolName: 'sync_resources',
  err: error 
}, 'Failed to process request');
```

### 6.2 子日志记录器（带用户上下文）

```typescript
import { createLogContext } from './utils/logger';

// 创建带完整用户上下文的子日志记录器
const requestLogger = createLogContext({
  requestId: 'req-123',
  userId: 'user-456',
  userToken: 'eyJhbGci...',
  toolName: 'sync_resources',
});

// 所有日志自动包含上下文信息
requestLogger.info('Processing request');
requestLogger.debug({ step: 1 }, 'Validating input');
requestLogger.info({ step: 2 }, 'Calling API');
requestLogger.info({ step: 3, duration: 1200 }, 'Request completed');
```

### 6.3 性能追踪（包含用户和工具信息）

```typescript
import { logPerformance } from './utils/logger';

async function syncResources(
  params: any,
  context: { userId: string; userToken: string }
) {
  const startTime = Date.now();
  
  // 执行同步操作
  await doSync();
  
  const duration = Date.now() - startTime;
  logPerformance('sync_resources', duration, {
    userId: context.userId,
    userToken: context.userToken,
    toolName: 'sync_resources',
    resourceCount: 10,
    totalSize: 1024000,
  });
}
```

### 6.4 日志查询示例

**按用户查询**:
```bash
# 查询特定用户的所有操作
grep '"userId":"user-123"' logs/app-2026-03-09.log | npx pino-pretty

# 查询用户调用的工具
grep '"userId":"user-123"' logs/app-2026-03-09.log | grep '"toolName"' | jq -r '.toolName'
```

**按工具查询**:
```bash
# 查询 sync_resources 的所有调用
grep '"toolName":"sync_resources"' logs/app-2026-03-09.log | npx pino-pretty

# 统计各工具的调用次数
grep '"toolName"' logs/app-2026-03-09.log | jq -r '.toolName' | sort | uniq -c
```

**按时间戳查询**:
```bash
# 查询特定时间段的日志
grep '"timestamp":"2026-03-09T10:"' logs/app-2026-03-09.log | npx pino-pretty

# 查询最近1小时的错误日志
grep '"level":50' logs/app-2026-03-09.log | grep "$(date -u -d '1 hour ago' '+%Y-%m-%dT%H')"
```

**综合查询**:
```bash
# 查询特定用户调用特定工具的日志
grep '"userId":"user-123"' logs/*.log | grep '"toolName":"sync_resources"'

# 查询包含 Token 的审计日志
grep '"userToken"' logs/app-2026-03-09.log | jq -r '{time: .timestamp, user: .userId, tool: .toolName, token: .userToken}'
```

---

## 七、配置说明

### 7.1 环境变量

```bash
# LOG_LEVEL=info              # 日志级别: trace, debug, info, warn, error, fatal
# LOG_DIR=./logs              # 日志目录（默认: ./logs）
# LOG_RETENTION_DAYS=3        # 日志保留天数（默认: 3）
# LOG_MAX_FILE_SIZE=100M      # 单文件最大大小（默认: 100MB）
# LOG_MASK_TOKEN=false        # 是否脱敏 Token（默认: false，完整记录用于审计）
```

### 7.2 运行时配置

```typescript
// config/logging.ts
export const loggingConfig = {
  level: process.env.LOG_LEVEL || 'info',
  dir: process.env.LOG_DIR || './logs',
  retentionDays: parseInt(process.env.LOG_RETENTION_DAYS || '3'),
  maxFileSize: process.env.LOG_MAX_FILE_SIZE || '100M',
  
  // Token 脱敏配置
  maskToken: process.env.LOG_MASK_TOKEN === 'true',
  
  // 日志轮转策略
  rotation: {
    frequency: 'daily',       // 'daily' | 'hourly' | 'size'
    dateFormat: 'yyyy-MM-dd',
  },
  
  // 是否输出到控制台（开发环境）
  console: process.env.NODE_ENV === 'development',
  
  // 必需字段校验
  requiredFields: ['userId', 'timestamp', 'toolName'],
};
```

### 7.3 日志字段标准

**所有日志必须包含的字段**:

```typescript
interface RequiredLogFields {
  // 系统字段
  level: number;              // 日志级别
  time: number;               // Unix 时间戳（毫秒）
  timestamp: string;          // ISO 8601 格式时间
  pid: number;                // 进程 ID
  hostname: string;           // 主机名
  name: string;               // 服务名
  msg: string;                // 日志消息
  
  // 用户维度（必需）
  userId: string;             // 用户 ID
  userToken: string;          // 用户 Token
  
  // 工具维度（Tool 调用时必需）
  toolName?: string;          // 调用的工具名称
  toolParams?: any;           // 工具参数
  
  // 请求追踪
  requestId?: string;         // 请求 ID
  duration?: number;          // 操作耗时
}
```

---

## 八、监控与告警

### 8.1 日志查看

**实时查看日志**:
```bash
# 查看今天的日志
tail -f logs/app-2026-03-09.log

# 格式化 JSON 输出
tail -f logs/app-2026-03-09.log | npx pino-pretty

# 过滤错误日志
tail -f logs/app-2026-03-09.log | grep '"level":50'
```

**搜索日志**:
```bash
# 搜索特定用户的日志
grep 'user-123' logs/app-2026-03-09.log

# 搜索错误日志
grep '"level":50' logs/*.log

# 搜索特定 Tool 调用
grep 'sync_resources' logs/app-2026-03-09.log
```

### 8.2 日志分析

**使用 pino-pretty 美化输出**:
```bash
npm install -g pino-pretty

# 美化显示
cat logs/app-2026-03-09.log | pino-pretty

# 只显示错误
cat logs/app-2026-03-09.log | pino-pretty --level error

# 自定义时间格式
cat logs/app-2026-03-09.log | pino-pretty -t "yyyy-mm-dd HH:MM:ss"
```

### 8.3 告警建议

**监控指标**:
- 🔴 ERROR 日志数量 > 100/小时
- 🟡 WARN 日志数量 > 500/小时
- 🔵 sync_resources 平均耗时 > 5s
- 🔵 日志文件大小 > 500MB

**告警方式**:
- 日志采集工具（ELK、Grafana Loki）
- 监控脚本定期检查
- 集成到现有告警系统

---

## 九、最佳实践

### 9.1 日志规范

**DO ✅**:
- ✅ 使用结构化日志（JSON）
- ✅ 记录关键业务操作
- ✅ **必须包含：时间戳、用户ID、用户Token、工具名称**
- ✅ 记录性能指标（耗时）
- ✅ 记录错误和异常（含用户上下文）
- ✅ 使用合适的日志级别
- ✅ Tool 调用必须记录完整上下文

**DON'T ❌**:
- ❌ 记录密码、私钥等敏感信息（Token 用于审计可以记录）
- ❌ 记录大量冗余信息
- ❌ 在循环中频繁记录日志
- ❌ 记录大对象（超过 1KB）
- ❌ 遗漏关键维度（用户、工具、时间戳）

**日志完整性检查**:
```typescript
// 所有 Tool 调用必须包含这些字段
function validateToolLog(log: any): boolean {
  return !!(
    log.timestamp &&      // 时间戳
    log.userId &&         // 用户 ID
    log.userToken &&      // 用户 Token
    log.toolName &&       // 工具名称
    log.toolParams        // 工具参数
  );
}
```

### 9.2 性能优化

```typescript
// ✅ 正确：异步日志
logger.info({ userId: 'user-123' }, 'User logged in');

// ❌ 错误：同步日志（阻塞）
logger.info({ sync: true }, 'Blocking log');

// ✅ 正确：条件日志
if (logger.isLevelEnabled('debug')) {
  logger.debug({ data: expensiveOperation() }, 'Debug info');
}

// ✅ 正确：使用子日志记录器
const childLogger = logger.child({ requestId: 'req-123' });
childLogger.info('Processing');
```

### 9.3 测试

```typescript
// src/utils/__tests__/logger.test.ts
import { describe, it, expect } from 'vitest';
import { logger } from '../logger';

describe('Logger', () => {
  it('should write logs to file', async () => {
    logger.info('Test log message');
    
    // 验证日志文件创建
    const logFile = 'logs/app-2026-03-09.log';
    expect(fs.existsSync(logFile)).toBe(true);
  });
  
  it('should clean old logs', async () => {
    await cleanOldLogs();
    
    // 验证旧日志被删除
    const oldLogFile = 'logs/app-2026-03-05.log';
    expect(fs.existsSync(oldLogFile)).toBe(false);
  });
});
```

---

## 十、总结

### 10.1 技术栈

- ✅ **pino**: 高性能 JSON 日志库
- ✅ **pino-roll**: 文件轮转插件
- ✅ **自动清理**: 定时清理 3 天前日志

### 10.2 文件结构

```
logs/
├── app-2026-03-09.log      # 今天
├── app-2026-03-08.log      # 昨天
└── app-2026-03-07.log      # 前天（第 4 天将被删除）
```

### 10.3 关键特性

- 🚀 **高性能**: 异步写入，不阻塞主线程
- 📝 **结构化**: JSON 格式，便于分析
- 🔄 **自动轮转**: 按日期轮转，防止单文件过大
- 🧹 **自动清理**: 3 天自动清理，节省磁盘空间
- 🔍 **易于查询**: 支持 grep、pino-pretty 等工具

---

**文档版本**: v1.0  
**最后更新**: 2026-03-09  
**维护者**: CSP-AI-Agent Team
