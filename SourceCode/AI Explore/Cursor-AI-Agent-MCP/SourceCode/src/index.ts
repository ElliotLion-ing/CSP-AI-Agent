#!/usr/bin/env node

/**
 * CSP AI Agent MCP Server - Main Entry Point
 */

import { config } from './config';
import { logger } from './utils/logger';
import { startLogCleanupSchedule, stopLogCleanupSchedule } from './utils/log-cleaner';
import { startServer, stopServer } from './server';
import { stopCacheCleanup } from './auth/token-validator';
import { sessionManager } from './session/manager';
import { telemetry } from './telemetry/index.js';
import { apiClient } from './api/client.js';

// Global error handlers
process.on('uncaughtException', (error: Error) => {
  // Handle EPIPE and ECONNRESET gracefully (client disconnected)
  if (error.message.includes('EPIPE') || error.message.includes('ECONNRESET')) {
    logger.debug({ 
      error: error.message, 
      type: 'uncaught_exception_network' 
    }, 'Client disconnected (EPIPE/ECONNRESET)');
    return; // Don't exit for network errors
  }
  
  // For other uncaught exceptions, log and exit
  logger.error({ error, type: 'uncaught_exception' }, `Uncaught Exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
  logger.error(
    {
      type: 'unhandled_rejection',
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    },
    'Unhandled Promise Rejection'
  );
  process.exit(1);
});

async function main() {
  logger.info(
    {
      nodeEnv: config.nodeEnv,
      port: config.port,
      logLevel: config.logLevel,
    },
    'Starting CSP AI Agent MCP Server...'
  );

  // Start log cleanup scheduler
  const cleanupTimer = startLogCleanupSchedule();

  // Wire up telemetry reporting (inject API client to avoid circular import)
  telemetry.configure(
    (payload, token) => apiClient.reportTelemetry(payload, token),
    () => process.env.CSP_API_TOKEN
  );

  try {
    // Start MCP Server
    await startServer();

    logger.info({ port: config.port }, `✅ CSP AI Agent MCP Server started successfully`);

    // Start periodic telemetry flush (every 10 seconds)
    telemetry.startPeriodicFlush(10_000);
    logger.info('Telemetry flush scheduler started (interval: 10s)');
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    stopLogCleanupSchedule(cleanupTimer);
    process.exit(1);
  }

  // Graceful shutdown handlers
  let isShuttingDown = false;
  const SHUTDOWN_TIMEOUT = Number(process.env.SHUTDOWN_TIMEOUT) || 30000; // 30 seconds default

  const shutdown = async (signal: string) => {
    // Prevent multiple shutdown attempts
    if (isShuttingDown) {
      logger.warn({ signal }, 'Shutdown already in progress, ignoring signal');
      return;
    }
    isShuttingDown = true;

    logger.info({ signal, timeout: SHUTDOWN_TIMEOUT }, `Received ${signal}, starting graceful shutdown...`);

    // Set timeout for forced shutdown
    const shutdownTimer = setTimeout(() => {
      logger.error(
        { timeout: SHUTDOWN_TIMEOUT },
        `Graceful shutdown timeout (${SHUTDOWN_TIMEOUT}ms), forcing exit`
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT);

    try {
      // Phase 1: Stop accepting new requests
      logger.info('Phase 1: Stopping new requests...');

      // Phase 2: Wait for ongoing requests to complete
      logger.info('Phase 2: Waiting for ongoing requests to complete...');

      // Stop MCP Server (this will close all active sessions and connections)
      await stopServer();

      // Phase 3: Stop background tasks
      logger.info('Phase 3: Stopping background tasks...');

      // Stop log cleanup
      stopLogCleanupSchedule(cleanupTimer);
      
      // Stop session cleanup
      sessionManager.stopCleanup();
      logger.info('Session cleanup stopped');
      
      // Stop token cache cleanup
      stopCacheCleanup();
      logger.info('Token cache cleanup stopped');

      // Stop telemetry scheduler and perform final flush
      telemetry.stopPeriodicFlush();
      logger.info('Telemetry scheduler stopped, performing final flush...');
      await telemetry.flush();
      logger.info('Final telemetry flush completed');

      // Phase 4: Flush logs
      logger.info('Phase 4: Flushing logs...');
      
      // Give logger time to flush
      await new Promise(resolve => setTimeout(resolve, 500));

      // Clear shutdown timeout
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
}

// Start the application
void main().catch((error: unknown) => {
  logger.error({ error }, 'Fatal error during startup');
  process.exit(1);
});
