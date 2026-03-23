# Stage 1: Core Framework Setup - 阶段性实现记录

**文档版本：** 1.0  
**创建日期：** 2026-03-10  
**阶段状态：** ✅ 已完成

---

## 📋 阶段目标

搭建 CSP-AI-Agent MCP Server 的核心框架，包括：
- 项目初始化（package.json, tsconfig.json, 配置文件）
- 基础项目结构（SourceCode/src 目录）
- 日志基础设施（pino + 自动清理）
- 配置管理
- 开发工具链（TypeScript, ESLint, npm scripts）

**验收标准：**
- ✅ `npm install` 完成无错误
- ✅ `npm run build` TypeScript 编译成功
- ✅ `npm run dev` 应用启动成功
- ✅ 日志写入 `Logs/app-YYYY-MM-DD.log`
- ✅ 日志清理自动执行
- ✅ 配置从 `.env` 正确加载
- ✅ 所有测试通过（100% Pass Rate）

---

## ✅ 已完成功能

### 1. 项目初始化
- **实现文件**：
  - `SourceCode/package.json` - npm 包配置，包含所有依赖和脚本
  - `SourceCode/tsconfig.json` - TypeScript 编译配置（ES2022, strict mode）
  - `SourceCode/.env.example` - 环境变量模板
  - `SourceCode/.eslintrc.json` - ESLint 配置
  - `SourceCode/.prettierrc.json` - Prettier 配置
- **关键代码**：
  - 依赖: `@modelcontextprotocol/sdk`, `axios`, `simple-git`, `pino`, `pino-pretty`, `dotenv`
  - 脚本: `dev`, `build`, `start`, `lint`, `type-check`
- **测试用例**：自动验证（npm install + build）

### 2. 目录结构搭建
- **实现文件**：`SourceCode/src/` 目录结构
  ```
  src/
  ├── index.ts              # 主入口
  ├── server.ts             # MCP Server 占位符
  ├── config/               # 配置模块
  │   ├── index.ts          # 配置加载
  │   └── constants.ts      # 常量定义
  ├── utils/                # 工具函数
  │   ├── logger.ts         # 日志工具
  │   └── log-cleaner.ts    # 日志清理
  ├── tools/                # MCP Tools（占位符）
  ├── types/                # TypeScript 类型
  ├── worker/               # 多线程（占位符）
  ├── transport/            # SSE 传输（占位符）
  ├── api/                  # API 客户端（占位符）
  ├── cache/                # 缓存层（占位符）
  └── state/                # 状态追踪（占位符）
  ```
- **设计说明**：按照 @Docs/CSP-AI-Agent-Complete-Design.md 规划的模块化结构

### 3. 日志记录模块
- **实现文件**：
  - `SourceCode/src/utils/logger.ts` - pino 日志实现
  - `SourceCode/src/utils/log-cleaner.ts` - 自动清理逻辑
- **关键代码**：
  ```typescript
  // pino 多目标日志配置
  export const logger = pino({
    level: config.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: 'csp-ai-agent-mcp' },
    transport: {
      targets: [
        { target: 'pino-pretty', ... },  // 控制台
        { target: 'pino/file', ... }     // 文件
      ]
    }
  });
  
  // Helper 函数
  - logToolCall() - MCP Tool 调用日志
  - logError() - 错误日志
  - logPerformance() - 性能指标
  - logApiRequest() - API 请求日志
  - logGitOperation() - Git 操作日志
  
  // 自动清理调度器
  export function startLogCleanupSchedule(): NodeJS.Timeout
  export function stopLogCleanupSchedule(timer: NodeJS.Timeout): void
  ```
- **设计说明**：
  - 使用 pino（Node.js 最快的日志库）
  - 多目标输出：控制台（pretty）+ 文件（JSON）
  - 日志保留3天，自动清理旧文件
  - 日志文件命名：`app-YYYY-MM-DD.log`
- **测试用例**：`Test/test-stage1-startup.js`

### 4. 配置管理模块
- **实现文件**：
  - `SourceCode/src/config/index.ts` - 配置加载和验证
  - `SourceCode/src/config/constants.ts` - 常量定义
- **关键代码**：
  ```typescript
  export interface Config {
    nodeEnv: 'development' | 'production' | 'test';
    port: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    csp: { apiBaseUrl: string; timeout: number };
    git: { repoPath: string; userName: string; userEmail: string };
    cache: { redis?: ...; memory: ...; disk: ... };
    database?: { url: string };
    metrics: { enabled: boolean; port?: number };
    logging: { dir: string; retentionDays: number };
  }
  
  export function loadConfig(): Config
  export { config };  // 全局单例
  ```
- **设计说明**：
  - 使用 dotenv 加载 `.env` 文件
  - TypeScript 类型安全
  - 必填/可选配置区分
  - 启动时验证，失败则退出
- **测试用例**：自动验证（应用启动时）

### 5. 主入口和错误处理
- **实现文件**：
  - `SourceCode/src/index.ts` - CLI 入口点
  - `SourceCode/src/server.ts` - MCP Server 占位符
- **关键代码**：
  ```typescript
  // 全局错误处理
  process.on('uncaughtException', (error) => { ... });
  process.on('unhandledRejection', (reason) => { ... });
  
  // 优雅关闭
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  async function shutdown(signal: string) {
    // 停止日志清理
    stopLogCleanupSchedule(cleanupTimer);
    // TODO: 关闭其他资源
    process.exit(0);
  }
  ```
- **设计说明**：
  - 捕获未处理异常和 Promise rejection
  - SIGINT/SIGTERM 信号处理
  - 优雅关闭机制
- **测试用例**：`Test/test-stage1-startup.js`

### 6. 开发工具链
- **实现文件**：
  - `SourceCode/.eslintrc.json` - ESLint 配置
  - `SourceCode/.prettierrc.json` - Prettier 配置
  - `SourceCode/tsconfig.json` - TypeScript 配置
- **关键配置**：
  - TypeScript: `strict: true`, ES2022 target
  - ESLint: TypeScript plugin, 推荐规则
  - Prettier: 100 字符宽度，单引号
- **npm 脚本**：
  - `npm run dev` - 开发模式（tsx watch）
  - `npm run build` - 编译 TypeScript
  - `npm run start` - 运行编译后代码
  - `npm run lint` - 代码检查
  - `npm run type-check` - 类型检查
- **测试用例**：手动验证各个脚本

---

## 🏗️ 关键实现

### 实现 1: 日志多目标输出

```typescript
// src/utils/logger.ts
export const logger = pino({
  level: config.logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: 'csp-ai-agent-mcp' },
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        level: config.logLevel,
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      },
      {
        target: 'pino/file',
        level: config.logLevel,
        options: {
          destination: getLogFilePath(),
          mkdir: true,
        },
      },
    ],
  },
});
```

**设计说明**：
- 同时输出到控制台（开发友好）和文件（生产记录）
- 控制台使用 pino-pretty 格式化
- 文件使用 JSON 格式（便于分析）

### 实现 2: 自动日志清理

```typescript
// src/utils/log-cleaner.ts
export async function cleanupOldLogs(): Promise<void> {
  const logsDir = path.resolve(process.cwd(), config.logging.dir);
  const retentionMs = config.logging.retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const files = fs.readdirSync(logsDir);
  let deletedCount = 0;

  for (const file of files) {
    const match = file.match(LOG_FILE_PATTERN);
    if (!match) continue;

    const filePath = path.join(logsDir, file);
    const stats = fs.statSync(filePath);
    const fileAge = now - stats.mtimeMs;

    if (fileAge > retentionMs) {
      fs.unlinkSync(filePath);
      deletedCount++;
      logger.info({ file, agedays: Math.floor(fileAge / (24 * 60 * 60 * 1000)) }, `Deleted old log file: ${file}`);
    }
  }
}

export function startLogCleanupSchedule(): NodeJS.Timeout {
  void cleanupOldLogs();  // 启动时立即执行一次
  const interval = 24 * 60 * 60 * 1000;  // 24 小时
  const timer = setInterval(() => { void cleanupOldLogs(); }, interval);
  return timer;
}
```

**设计说明**：
- 启动时立即执行一次清理
- 每24小时自动执行
- 删除超过保留期限的日志文件
- 仅处理匹配模式的文件（`app-YYYY-MM-DD.log`）

### 实现 3: 配置验证

```typescript
// src/config/index.ts
function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${value}`);
  }
  return parsed;
}
```

**设计说明**：
- 必填参数缺失时抛出清晰错误
- 类型验证（数字、布尔值）
- 默认值支持

---

## 🎯 设计决策

- **决策 1**：使用 pino 而非 winston
  - **理由**：pino 是 Node.js 中性能最好的日志库，支持结构化日志，且有丰富的 transport 生态
  
- **决策 2**：日志目录放在项目根目录的 `Logs/` 而非 `SourceCode/logs/`
  - **理由**：日志不应放在源代码目录中，便于 Git 忽略和独立管理
  
- **决策 3**：使用 tsx 作为开发模式运行器
  - **理由**：tsx 支持 TypeScript 热重载，开发体验好，无需手动编译
  
- **决策 4**：配置验证在模块加载时执行
  - **理由**：快速失败原则，避免应用带着错误配置启动

---

## ⚠️ 与初始设计的差异

### 差异 1: 日志路径配置
- **原设计**：日志路径硬编码为 `logs/`
- **实际实现**：日志路径配置为 `../Logs/`（相对于 SourceCode 目录）
- **原因**：遵循 @AGENTS.md 规范，所有源代码在 `SourceCode/` 中，日志在项目根目录的 `Logs/`
- **影响**：无负面影响，更符合项目结构规范

### 差异 2: pino 配置移除了 level formatter
- **原设计**：包含自定义 level formatter
- **实际实现**：移除了 formatters.level 配置
- **原因**：pino 使用 transport.targets 时不允许自定义 formatter
- **影响**：无影响，level 仍然正确记录

### 差异 3: 未实现 pino-roll
- **原设计**：使用 pino-roll 进行文件轮转
- **实际实现**：使用简单的日期命名 + 自动清理
- **原因**：pino-roll 对于我们的需求过于复杂，简单方案已满足需求
- **影响**：无负面影响，反而更简单可靠

---

## 📊 测试情况

- **测试用例数量**：1 个集成测试
- **测试通过率**：100% ✅
- **覆盖的场景**：
  - ✅ 应用启动
  - ✅ 配置加载
  - ✅ 日志写入
  - ✅ 优雅关闭

**测试文件**：
- `Test/test-stage1-startup.js` - 应用启动和关闭测试

**测试输出**：
```
✅ Application started successfully
✅ Application shut down gracefully
📊 Test Summary:
   Passed: 4
   Failed: 0
   Total:  4
✅ All Stage 1 tests passed!
```

**日志验证**：
- 日志文件：`Logs/app-2026-03-10.log`
- 格式：JSON 结构化日志 ✅
- 内容：包含启动、运行、关闭的完整生命周期 ✅

---

## 🔗 相关文档

- **初始设计文档**：`@Docs/CSP-AI-Agent-Complete-Design.md`
- **OpenSpec 提案**：`openspec/changes/stage-1-core-framework/`
- **测试文档**：`Test/test-stage1-README.md`

---

## 📝 后续工作

**阶段 2 准备工作**：
- ✅ 核心框架已就绪
- ✅ 开发环境已配置
- ✅ 测试框架已验证
- ⏳ 下一步：实现 MCP Server 基础（SSE 服务器 + 认证中间件）

---

**完成时间**：2026-03-10  
**开发者**：AI Agent  
**状态**：✅ 阶段验收通过
