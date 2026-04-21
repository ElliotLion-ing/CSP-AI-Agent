/**
 * Logging Module
 * Structured logging using pino with daily file rotation.
 *
 * Files are named app-YYYY-MM-DD.log. Rotation is implemented by:
 *   1. Starting pino/file pointing at today's file (fixed fd, opened at startup).
 *   2. A midnight timer in the main thread spawns a fresh child process for the
 *      next day's file via a second pino instance — but that would mean two loggers.
 *
 * Practical solution used here:
 *   - Use pino-roll (daily, dateFormat: 'yyyy-MM-dd').
 *   - pino-roll produces  Logs/app.YYYY-MM-DD.1.log  (date + sequential counter).
 *   - At midnight + 2 s we rename the *previous* day's  app.YYYY-MM-DD.1.log
 *     → app-YYYY-MM-DD.log  so the canonical name is clean.
 *   - The active (today's) file keeps the pino-roll name until it rotates.
 *   - log-cleaner scans by mtime so it handles both naming conventions.
 */

import pino from 'pino';
import * as path from 'path';
import * as fs from 'fs';
import { config } from '../config';

// Ensure logs directory exists (relative to project root)
const logsDir = path.resolve(process.cwd(), config.logging.dir);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/** ms until the next local midnight + 1 s buffer. */
function msUntilMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return next.getTime() - now.getTime();
}

/**
 * Rename yesterday's pino-roll file (app.YYYY-MM-DD.1.log)
 * to the canonical name (app-YYYY-MM-DD.log) once it has been rotated away.
 */
function renameYesterdayLog(): void {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const dateStr = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');

  const src = path.join(logsDir, `app.${dateStr}.1.log`);
  const dst = path.join(logsDir, `app-${dateStr}.log`);
  if (fs.existsSync(src) && !fs.existsSync(dst)) {
    try { fs.renameSync(src, dst); } catch { /* non-fatal */ }
  }
}

// Fire rename at midnight + 2 s, then every 24 h.
setTimeout(() => {
  renameYesterdayLog();
  setInterval(renameYesterdayLog, 24 * 60 * 60 * 1000).unref();
}, msUntilMidnight() + 2000).unref();

// Create pino logger with multi-target transport
export const logger = pino({
  level: config.logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'csp-ai-agent-mcp',
  },
  transport: {
    targets: [
      // Console output (pretty format in development)
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
      // Daily-rotating file output.
      // Active file: Logs/app.YYYY-MM-DD.1.log
      // After midnight rename: Logs/app-YYYY-MM-DD.log
      {
        target: 'pino-roll',
        level: config.logLevel,
        options: {
          file: path.join(logsDir, 'app'),
          frequency: 'daily',
          dateFormat: 'yyyy-MM-dd',
          mkdir: true,
          sync: false,
        },
      },
    ],
  },
});

/**
 * Log MCP Tool call
 */
export function logToolCall(
  toolName: string,
  userId: string,
  params: Record<string, unknown>,
  durationMs: number
): void {
  logger.info(
    {
      type: 'tool_call',
      toolName,
      userId,
      params,
      durationMs,
    },
    `Tool ${toolName} called by ${userId} (${durationMs}ms)`
  );
}

/**
 * Log error with context
 */
export function logError(error: Error, context?: Record<string, unknown>): void {
  logger.error(
    {
      type: 'error',
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      ...context,
    },
    error.message
  );
}

/**
 * Log performance metrics
 */
export function logPerformance(
  operation: string,
  durationMs: number,
  metadata?: Record<string, unknown>
): void {
  logger.info(
    {
      type: 'performance',
      operation,
      durationMs,
      ...metadata,
    },
    `${operation} completed in ${durationMs}ms`
  );
}

/**
 * Log API request with detailed information
 */
export function logApiRequest(
  method: string,
  url: string,
  statusCode: number,
  durationMs: number,
  requestData?: unknown,
  responseData?: unknown,
  headers?: Record<string, string>
): void {
  logger.info(
    {
      type: 'api_request',
      method,
      url,
      statusCode,
      durationMs,
      requestData: requestData ? JSON.stringify(requestData).substring(0, 500) : undefined,
      responseData: responseData ? JSON.stringify(responseData).substring(0, 1000) : undefined,
      headers: headers ? sanitizeHeaders(headers) : undefined,
    },
    `${method} ${url} - ${statusCode} (${durationMs}ms)`
  );
}

/**
 * Log API error with full details
 */
export function logApiError(
  method: string,
  url: string,
  error: Error,
  requestData?: unknown,
  statusCode?: number
): void {
  logger.error(
    {
      type: 'api_error',
      method,
      url,
      statusCode,
      requestData: requestData ? JSON.stringify(requestData).substring(0, 500) : undefined,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    },
    `API Error: ${method} ${url} - ${error.message}`
  );
}

/**
 * Log tool execution step
 */
export function logToolStep(
  toolName: string,
  step: string,
  details?: Record<string, unknown>
): void {
  logger.debug(
    {
      type: 'tool_step',
      toolName,
      step,
      ...details,
    },
    `[${toolName}] ${step}`
  );
}

/**
 * Log tool execution result
 */
export function logToolResult(
  toolName: string,
  success: boolean,
  result?: unknown,
  error?: Error
): void {
  const level = success ? 'info' : 'error';
  logger[level](
    {
      type: 'tool_result',
      toolName,
      success,
      result: result ? JSON.stringify(result).substring(0, 1000) : undefined,
      error: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : undefined,
    },
    `[${toolName}] ${success ? 'Success' : 'Failed'}`
  );
}

/**
 * Log authentication attempt
 */
export function logAuthAttempt(
  type: 'token_validation' | 'permission_check',
  success: boolean,
  details?: Record<string, unknown>
): void {
  const level = success ? 'info' : 'warn';
  logger[level](
    {
      type: 'auth',
      operation: type,
      success,
      ...details,
    },
    `Auth ${type}: ${success ? 'Success' : 'Failed'}`
  );
}

/**
 * Log cache operation
 */
export function logCacheOperation(
  operation: 'get' | 'set' | 'delete' | 'hit' | 'miss',
  key: string,
  details?: Record<string, unknown>
): void {
  logger.debug(
    {
      type: 'cache',
      operation,
      key,
      ...details,
    },
    `Cache ${operation}: ${key}`
  );
}

/**
 * Sanitize headers to remove sensitive information
 */
function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized = { ...headers };
  
  // Mask Authorization header
  if (sanitized['Authorization'] || sanitized['authorization']) {
    const authKey = sanitized['Authorization'] ? 'Authorization' : 'authorization';
    const authValue = sanitized[authKey];
    if (authValue && authValue.startsWith('Bearer ')) {
      const token = authValue.substring(7);
      sanitized[authKey] = `Bearer ${token.substring(0, 10)}...${token.substring(token.length - 10)}`;
    }
  }
  
  return sanitized;
}

/**
 * Log Git operation
 */
export function logGitOperation(
  operation: string,
  details: Record<string, unknown>,
  durationMs: number
): void {
  logger.info(
    {
      type: 'git_operation',
      operation,
      ...details,
      durationMs,
    },
    `Git ${operation} completed (${durationMs}ms)`
  );
}
