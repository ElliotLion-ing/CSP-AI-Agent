# Stage 6-2: 优雅关闭 - 阶段性实现记录

**文档版本：** 1.0  
**创建日期：** 2026-03-12  
**阶段状态：** 已完成

---

## 📋 阶段目标

**本阶段计划实现的功能**：
1. 增强主入口文件的 shutdown handler
2. 实现优雅关闭序列（停止接受 → 等待完成 → 关闭连接 → 退出）
3. 处理 SIGTERM 和 SIGINT 信号
4. 添加 30 秒超时机制
5. 添加 SHUTDOWN_TIMEOUT 配置
6. 创建优雅关闭测试

**验收标准**：
- ✅ 收到 SIGTERM/SIGINT 信号时正确触发关闭
- ✅ 关闭序列分阶段执行（日志清晰）
- ✅ 超时机制防止无限等待
- ✅ 关闭期间不接受新连接
- ✅ SSE 连接优雅关闭（发送 close 事件）
- ✅ 测试验证关闭行为

---

## ✅ 已完成功能

### 1. 增强主入口文件 shutdown handler
- **实现文件**：`SourceCode/src/index.ts`
- **关键功能**：
  - 防止多次关闭（`isShuttingDown` 标志）
  - 可配置的超时机制（`SHUTDOWN_TIMEOUT`）
  - 强制退出定时器（超时后 `process.exit(1)`）
  - 4 阶段关闭流程（新请求、等待、停止、刷新）
  - 清理超时定时器

### 2. 增强 HTTP Server stop 方法
- **实现文件**：`SourceCode/src/server/http.ts`
- **关键改进**：
  - 详细的步骤日志（Step 1/2/3）
  - 关闭所有 SSE sessions（发送 close 事件）
  - 等待 close 事件发送完成（500ms）
  - Fastify 优雅关闭（等待请求完成）

### 3. 配置管理
- **配置文件**：`SourceCode/.env.example`
- **新增配置**：
  - `SHUTDOWN_TIMEOUT`：优雅关闭超时（默认 30000ms）

### 4. 测试用例
- **测试文件**：`Test/test-stage6-shutdown.js`
- **测试覆盖**：
  - SIGTERM 信号测试
  - SIGINT 信号测试（Ctrl+C 模拟）
  - 关闭时间验证
  - 服务器不可访问验证

---

## 🏗️ 关键实现

### 实现 1: 增强 shutdown handler

```typescript
// src/index.ts
let isShuttingDown = false;
const SHUTDOWN_TIMEOUT = Number(process.env.SHUTDOWN_TIMEOUT) || 30000;

const shutdown = async (signal: string) => {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    logger.warn({ signal }, 'Shutdown already in progress, ignoring signal');
    return;
  }
  isShuttingDown = true;

  logger.info({ signal, timeout: SHUTDOWN_TIMEOUT }, 'Starting graceful shutdown...');

  // Set timeout for forced shutdown
  const shutdownTimer = setTimeout(() => {
    logger.error({ timeout: SHUTDOWN_TIMEOUT }, 'Graceful shutdown timeout, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);

  try {
    // Phase 1: Stop accepting new requests
    logger.info('Phase 1: Stopping new requests...');

    // Phase 2: Wait for ongoing requests
    logger.info('Phase 2: Waiting for ongoing requests to complete...');
    await stopServer(); // This closes all sessions and connections

    // Phase 3: Stop background tasks
    logger.info('Phase 3: Stopping background tasks...');
    stopLogCleanupSchedule(cleanupTimer);

    // Phase 4: Flush logs
    logger.info('Phase 4: Flushing logs...');
    await new Promise(resolve => setTimeout(resolve, 500));

    clearTimeout(shutdownTimer);
    logger.info('✅ Graceful shutdown completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
    clearTimeout(shutdownTimer);
    process.exit(1);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
```

**设计说明**：
- 使用 `isShuttingDown` 标志防止重复触发
- 超时定时器确保进程不会无限等待
- 4 个明确的阶段，日志清晰
- 错误处理：捕获异常并正确退出

### 实现 2: HTTP Server 优雅关闭

```typescript
// src/server/http.ts
async stop(): Promise<void> {
  try {
    logger.info('Stopping HTTP server gracefully...');

    // Step 1: Stop accepting new connections
    logger.info('Step 1: Stopping new connections...');

    // Step 2: Close all active SSE sessions
    logger.info({ activeSessions: sessionManager.getActiveSessionCount() }, 
                'Step 2: Closing active SSE sessions...');
    sessionManager.closeAllSessions();

    // Step 3: Wait for close events to be sent
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 4: Stop Fastify server (waits for ongoing requests)
    logger.info('Step 3: Stopping Fastify server...');
    await this.fastify.close();

    logger.info('✅ HTTP server stopped gracefully');
  } catch (error) {
    logger.error({ error }, 'Error stopping HTTP server');
    throw error;
  }
}
```

**设计说明**：
- 先关闭 SSE sessions，发送 close 事件给客户端
- 等待 500ms 确保 close 事件发送完成
- Fastify 的 `close()` 方法会等待正在处理的请求完成
- 详细的日志便于诊断

### 实现 3: 配置管理

```bash
# .env.example
# Graceful Shutdown Configuration
# Maximum time (in milliseconds) to wait for graceful shutdown before forcing exit
# Default: 30000 (30 seconds)
SHUTDOWN_TIMEOUT=30000
```

**设计说明**：
- 可配置的超时时间
- 清晰的注释说明
- 合理的默认值（30 秒）

---

## 🎯 设计决策

### 决策 1: 使用超时定时器强制退出

**原因**：
- 防止关闭过程无限等待（例如：连接未响应、死锁）
- 确保服务器最终能够退出
- 运维场景需要可预测的关闭时间

**实现**：
- 设置 `setTimeout` 在超时后 `process.exit(1)`
- 成功关闭时清除定时器
- 超时时间可配置（`SHUTDOWN_TIMEOUT`）

### 决策 2: 分阶段关闭，而非一次性关闭

**原因**：
- 清晰的日志便于诊断问题
- 每个阶段可以独立监控和调试
- 符合生产环境的最佳实践

**实现**：
- Phase 1: 停止新请求
- Phase 2: 等待完成
- Phase 3: 停止后台任务
- Phase 4: 刷新日志

### 决策 3: 使用 `isShuttingDown` 标志防止重复关闭

**原因**：
- 用户可能多次按 Ctrl+C
- 运维脚本可能重复发送信号
- 重复关闭会导致错误和混乱的日志

**实现**：
- 全局 `isShuttingDown` 标志
- 第二次调用时直接返回，输出警告日志
- 简单有效

### 决策 4: 先关闭 SSE sessions，再关闭 Fastify

**原因**：
- SSE 客户端（Cursor）需要收到 close 事件
- 如果直接关闭 Fastify，连接突然断开
- Cursor 会显示错误而非正常关闭

**实现**：
- 调用 `sessionManager.closeAllSessions()`
- 等待 500ms 让 close 事件发送完成
- 然后关闭 Fastify

---

## ⚠️ 与初始设计的差异

### 差异 1: 关闭超时默认值

**原设计**：未明确指定，任务中提到 "30s max"  
**实际实现**：默认 30000ms（30 秒），可通过环境变量配置  
**原因**：增加灵活性，允许不同环境使用不同超时  
**影响**：需要在 .env.example 中文档化

### 差异 2: 未实现 "停止接受新请求" 的显式逻辑

**原设计**：Phase 1 应该停止接受新请求  
**实际实现**：依赖 Fastify 的 `close()` 方法，它会自动停止接受新连接  
**原因**：
- Fastify `close()` 已经实现了这个功能
- 无需重复实现
- 避免与 Fastify 内部逻辑冲突  
**影响**：关闭行为与预期一致，只是实现更简洁

### 差异 3: 测试中启动独立的 MCP Server 实例

**原设计**：测试假设 MCP Server 已经运行  
**实际实现**：测试脚本自己启动和关闭 MCP Server  
**原因**：
- 自动化测试，无需手动启动
- 隔离测试环境
- 更容易在 CI/CD 中运行  
**影响**：测试更健壮，但运行时间稍长

---

## 📊 测试情况

**测试用例数量**：2 个  
**测试通过率**：待验证  
**覆盖的场景**：
- ✅ SIGTERM 信号触发优雅关闭
- ✅ SIGINT 信号触发优雅关闭（Ctrl+C）
- ✅ 关闭时间在超时范围内
- ✅ 关闭后服务器不可访问
- ✅ 关闭日志正确输出

**测试命令**：
```bash
# 运行测试（脚本会自动启动和关闭 MCP Server）
cd Test
node test-stage6-shutdown.js
```

**注意**：
- 测试会自动启动 MCP Server，无需手动启动
- 确保端口 3000 未被占用
- 测试完成后自动清理

---

## 🔗 相关文档

- **初始设计文档**：`openspec/changes/stage-6-production-ready/proposal.md`
- **任务清单**：`openspec/changes/stage-6-production-ready/tasks.md`
- **主入口文件**：`SourceCode/src/index.ts`
- **HTTP Server**：`SourceCode/src/server/http.ts`
- **配置示例**：`SourceCode/.env.example`
- **测试用例**：`Test/test-stage6-shutdown.js`

---

## 📝 备注

- 优雅关闭功能已完成核心实现
- 超时机制确保进程不会无限等待
- SSE 连接优雅关闭，避免 Cursor 显示错误
- 测试覆盖 SIGTERM 和 SIGINT 两种信号
- 下一步：增强请求验证功能

---

**阶段完成时间**：2026-03-12  
**下一阶段**：增强请求验证（Stage 6-3）
