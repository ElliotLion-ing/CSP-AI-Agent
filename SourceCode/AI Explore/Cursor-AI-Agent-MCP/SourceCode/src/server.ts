/**
 * MCP Server Main Logic
 * Implements Model Context Protocol server with dual transport support
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
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
import { httpServer } from './server/http';

let server: Server | null = null;

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
    `Registered ${toolRegistry.getToolCount()} MCP tools`
  );
}

/**
 * Start MCP Server with stdio transport
 */
async function startStdioServer(): Promise<void> {
  logger.info('Starting MCP Server with stdio transport...');

  // Create MCP Server
  server = new Server(
    {
      name: 'csp-ai-agent-mcp',
      version: '0.2.5',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
    }
  );

  // Install Prompt list/get handlers so Command and Skill resources are
  // exposed as MCP Prompts (Cursor slash commands).
  const { promptManager } = await import('./prompts/index.js');
  promptManager.installHandlers(server);

  // Handle tools/list request
  server.setRequestHandler(ListToolsRequestSchema, () => {
    const tools = toolRegistry.getMCPToolDefinitions();
    logger.debug({ toolCount: tools.length }, 'tools/list request handled');
    return {
      tools,
    };
  });

  // Handle tools/call request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    logger.info({ toolName: name, arguments: args }, `tools/call request: ${name}`);

    const tool = toolRegistry.getTool(name);
    if (!tool) {
      const error = `Tool not found: ${name}`;
      logger.error({ toolName: name }, error);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: {
                code: 'TOOL_NOT_FOUND',
                message: error,
              },
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      // Call the tool handler
      const result = await tool.handler(args || {});

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ toolName: name, error: errorMessage }, `Tool execution failed: ${name}`);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: {
                code: 'TOOL_EXECUTION_ERROR',
                message: errorMessage,
              },
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

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

  // Start HTTP server
  await httpServer.start();

  logger.info('✅ MCP Server started successfully (SSE transport)');
}

/**
 * Start MCP Server (auto-detect transport mode)
 */
export async function startServer(): Promise<void> {
  // Register all tools (common for both transports)
  registerTools();

  // Start server based on transport mode
  const transportMode = config.transport.mode;
  
  logger.info({ transportMode }, `Starting server with ${transportMode} transport`);

  if (transportMode === 'sse') {
    await startSSEServer();
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

  if (transportMode === 'sse') {
    // Stop HTTP server
    await httpServer.stop();
  } else {
    // Stop stdio server
    if (server) {
      await server.close();
      server = null;
    }
  }

  logger.info('MCP Server stopped');
}
