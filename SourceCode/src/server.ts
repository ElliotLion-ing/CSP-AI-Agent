/**
 * MCP Server Main Logic
 * Implements Model Context Protocol server with dual transport support
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from './utils/logger';
import { config } from './config';
import { toolRegistry } from './tools/registry';
import {
  syncResourcesTool,
  manageSubscriptionTool,
  searchResourcesTool,
  uploadResourceTool,
  uninstallResourceTool,
  trackUsageTool,
  resolvePromptContentTool,
  queryUsageStatsTool,
} from './tools';
import { httpServer, createMcpServerInstance } from './server/http';
import { streamableHttpServer } from './server/streamable-http.js';
import { adapterRegistry } from './client-adapters/index.js';
import { CursorAdapter } from './client-adapters/cursor-adapter.js';
import { CodexAdapter } from './client-adapters/codex-adapter.js';

// Register client adapters at startup.
// Cursor adapter is registered first so it serves as the default fallback.
adapterRegistry.register(new CursorAdapter());
adapterRegistry.register(new CodexAdapter());

let stdioServer: ReturnType<typeof createMcpServerInstance> | null = null;

/**
 * Register all MCP tools
 */
function registerTools() {
  logger.info('Registering MCP tools...');

  toolRegistry.registerTool(syncResourcesTool);
  toolRegistry.registerTool(manageSubscriptionTool);
  toolRegistry.registerTool(searchResourcesTool);
  toolRegistry.registerTool(uploadResourceTool);
  toolRegistry.registerTool(uninstallResourceTool);
  toolRegistry.registerTool(trackUsageTool);
  toolRegistry.registerTool(resolvePromptContentTool);
  toolRegistry.registerTool(queryUsageStatsTool);

  logger.info(
    { toolCount: toolRegistry.getToolCount() },
    `Registered ${toolRegistry.getToolCount()} MCP tools`,
  );
}

/**
 * Start MCP Server with stdio transport.
 * Reuses createMcpServerInstance() from http.ts to avoid duplicating
 * handler registration (promptManager, tools, oninitialized auto-sync).
 */
async function startStdioServer(): Promise<void> {
  logger.info('Starting MCP Server with stdio transport...');

  // Reuse the shared factory — same capabilities, prompt handlers,
  // tool handlers, and oninitialized auto-sync as the SSE path.
  // No userId/email/groups for stdio (no auth header available).
  // Stdio is used by Cursor local MCP, so bind profile explicitly.
  stdioServer = createMcpServerInstance(undefined, undefined, undefined, undefined, 'cursor');

  const transport = new StdioServerTransport();
  await stdioServer.connect(transport);

  // Flush any pending telemetry immediately — stdio reconnects when Cursor
  // restarts the process, so treat connect as a reconnect event.
  const { telemetry: tel } = await import('./telemetry/index.js');
  tel.flushOnReconnect();

  logger.info('✅ MCP Server started successfully (stdio transport)');
}

/**
 * Start MCP Server with SSE transport
 */
async function startSSEServer(): Promise<void> {
  logger.info('Starting MCP Server with SSE transport...');
  await httpServer.start();
  logger.info('✅ MCP Server started successfully (SSE transport)');
}

/**
 * Start MCP Server with Streamable HTTP transport.
 * Used by Codex CLI clients which use the 2025-03-26 Streamable HTTP spec.
 */
async function startStreamableHttpServer(): Promise<void> {
  logger.info('Starting MCP Server with Streamable HTTP transport...');
  await streamableHttpServer.start();
  logger.info('✅ MCP Server started successfully (Streamable HTTP transport)');
}

/**
 * Start MCP Server (auto-detect transport mode from config)
 *
 * Transport modes:
 *   stdio           — local stdio (Cursor local MCP, default)
 *   sse             — legacy SSE only (Cursor remote MCP)
 *   streamable_http — Streamable HTTP only (Codex CLI)
 *   dual            — SSE (port HTTP_PORT) + Streamable HTTP (port STREAMABLE_HTTP_PORT)
 *                     simultaneously, serving Cursor and Codex from the same process
 */
export async function startServer(): Promise<void> {
  registerTools();

  const transportMode = config.transport.mode;
  logger.info({ transportMode, agentProfile: config.agentProfile }, `Starting server with ${transportMode} transport`);

  if (transportMode === 'dual') {
    // Start both transports concurrently; fail fast if either one throws.
    await Promise.all([
      startSSEServer(),
      startStreamableHttpServer(),
    ]);
    logger.info('✅ Dual transport mode: SSE + Streamable HTTP both started');
  } else if (transportMode === 'sse') {
    await startSSEServer();
  } else if (transportMode === 'streamable_http') {
    await startStreamableHttpServer();
  } else {
    await startStdioServer();
  }
}

/**
 * Stop MCP Server
 */
export async function stopServer(): Promise<void> {
  logger.info('Stopping MCP Server...');

  const transportMode = config.transport.mode;

  if (transportMode === 'dual') {
    await Promise.all([
      httpServer.stop(),
      streamableHttpServer.stop(),
    ]);
  } else if (transportMode === 'sse') {
    await httpServer.stop();
  } else if (transportMode === 'streamable_http') {
    await streamableHttpServer.stop();
  } else {
    if (stdioServer) {
      await stdioServer.close();
      stdioServer = null;
    }
  }

  logger.info('MCP Server stopped');
}
