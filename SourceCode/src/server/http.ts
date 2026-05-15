/**
 * HTTP Server with SSE Support
 * Uses SDK SSEServerTransport for standard MCP-over-SSE protocol,
 * matching the same pattern as the ACM MCP server.
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { syncResources } from '../tools/sync-resources.js';
import { telemetry } from '../telemetry/index.js';
import { promptManager } from '../prompts/index.js';
import type { AgentProfile } from '../client-adapters/index.js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SERVER_VERSION: string = (require('../../package.json') as { version: string }).version;

// Inject syncResources into promptManager for post-restart recovery.
// Must be done after both modules are loaded to avoid circular-import issues.
promptManager.setSyncResourcesFn(syncResources);
import { config } from '../config';
import { logger } from '../utils/logger';
import { sessionManager } from '../session/manager';
import { toolRegistry } from '../tools/registry';
import {
  tokenAuthOrLegacyMiddleware,
  checkToolCallPermission,
  type AuthenticatedRequest,
} from '../auth/middleware';
import { HealthChecker, type HealthStatus as MonitoringHealthStatus } from '../monitoring/health.js';
import { CacheManager } from '../cache/cache-manager.js';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  uptime: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  sessions: {
    active: number;
    total: number;
  };
  services: MonitoringHealthStatus['services'];
  details?: MonitoringHealthStatus['details'];
  timestamp: string;
}

export class HTTPServer {
  private fastify: FastifyInstance;
  private startTime: number = Date.now();
  private healthChecker: HealthChecker | null = null;

  /** Active SDK SSE transports keyed by sessionId */
  private sseTransports: Map<string, SSEServerTransport> = new Map();

  constructor(cacheManager?: CacheManager) {
    this.fastify = Fastify({
      logger: false,
      bodyLimit: 10 * 1024 * 1024, // 10MB
    });

    if (cacheManager) {
      this.healthChecker = new HealthChecker(cacheManager);
    }

    this.setupMiddleware();
    this.setupRoutes();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Middleware
  // ─────────────────────────────────────────────────────────────────────────

  private setupMiddleware(): void {
    this.fastify.register(cors, {
      origin: true,
      credentials: true,
    });

    this.fastify.register(helmet, {
      contentSecurityPolicy: false, // Disable for SSE
    });

    this.fastify.addHook('onRequest', (request, _reply, done) => {
      logger.debug(
        { method: request.method, url: request.url, ip: request.ip },
        'HTTP request received'
      );
      done();
    });

    this.fastify.addHook('onResponse', (request, _reply, done) => {
      logger.debug(
        {
          method: request.method,
          url: request.url,
          statusCode: (request.raw as { statusCode?: number }).statusCode || 200,
        },
        'HTTP response sent'
      );
      done();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Routes
  // ─────────────────────────────────────────────────────────────────────────

  private setupRoutes(): void {
    const basePath = config.http?.basePath ?? '';

    // Health check
    this.fastify.get(`${basePath}/health`, this.handleHealth.bind(this));

    // SSE connection — GET establishes the stream (SDK standard)
    this.fastify.get(`${basePath}/sse`, {
      preHandler: tokenAuthOrLegacyMiddleware,
      handler: this.handleSSEConnection.bind(this),
    });

    // Message endpoint — POST delivers JSON-RPC messages, sessionId in query
    this.fastify.post(`${basePath}/message`, this.handleMessage.bind(this));

    // OAuth discovery — return 404 so Cursor skips OAuth handshake
    this.fastify.get('/.well-known/oauth-authorization-server', async (_req, reply) => {
      reply.code(404).send({ error: 'OAuth not supported' });
    });

    // Root info
    this.fastify.get('/', () => ({
      server: 'CSP AI Agent MCP Server',
      version: '1.0.0',
      transport: 'sse',
      basePath: basePath || '(none)',
      endpoints: {
        health:  `GET ${basePath}/health`,
        sse:     `GET ${basePath}/sse`,
        message: `POST ${basePath}/message?sessionId=<id>`,
      },
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /sse — establish SSE stream using SDK SSEServerTransport.
   * Auth is validated via preHandler; user context is forwarded to the MCP server.
   */
  private async handleSSEConnection(
    request: AuthenticatedRequest,
    reply: FastifyReply
  ): Promise<void> {
    logger.info({ ip: request.ip }, 'SSE connection request received');

    const authHeader = request.headers.authorization;
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      reply.code(401).send({ error: 'Unauthorized', message: 'Bearer token required' });
      return;
    }

    // Register the authenticated token so flush() can report telemetry for this user.
    // The token comes from the SSE Authorization header and is the single source of truth.
    telemetry.setUserToken(token);

    try {
      // Keep our session manager in sync for health/monitoring endpoints
      const sessionOptions = request.user
        ? { userId: request.user.userId, email: request.user.email, groups: request.user.groups }
        : undefined;
      const session = sessionManager.createSession(token, request.ip ?? '', sessionOptions);

      logger.info(
        { sessionId: session.id, userId: session.userId, email: session.email },
        'Session created'
      );

      // Heartbeat to keep proxies/load-balancers from dropping idle SSE streams
      const heartbeat = setInterval(() => {
        if (!reply.raw.destroyed) {
          try {
            reply.raw.write('event: heartbeat\ndata: {}\n\n');
          } catch {
            clearInterval(heartbeat);
          }
        } else {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // Build the absolute message URL for the SSE endpoint event.
      // Cursor (and other MCP clients) use this URL to POST all subsequent
      // JSON-RPC messages (tools/call, prompts/get, etc.).
      //
      // publicOrigin is resolved at startup from (in priority order):
      //   1. PUBLIC_URL env var
      //   2. Origin extracted from CSP_API_BASE_URL (same host as the API)
      //   3. http://HTTP_HOST:HTTP_PORT (safe for local dev)
      // See config/index.ts for details.
      const basePath = config.http?.basePath ?? '';
      const publicOrigin = config.http?.publicOrigin ?? `http://127.0.0.1:${config.http?.port ?? 3000}`;
      const messagePath = `${basePath}/message`;

      // The MCP SDK SSEServerTransport.start() emits an `endpoint` SSE event
      // whose data is a *relative* path (pathname + ?sessionId=...), stripping
      // the origin.  When deployed behind nginx, Cursor resolves this relative
      // path against whatever origin it used to open the SSE connection, which
      // may differ from our public API origin.  The result is that GetPrompt /
      // tools/call POST requests go to the wrong address and never arrive.
      //
      // Fix: intercept the raw response stream's write() method.  When the SDK
      // emits the relative endpoint event we replace it on-the-fly with the
      // full absolute URL so Cursor always uses the correct public address.
      // Only ONE endpoint event is ever written to the wire this way.
      const rawRes = reply.raw;
      const originalWrite = rawRes.write.bind(rawRes);
      (rawRes as NodeJS.WritableStream & { write: typeof originalWrite }).write = (
        chunk: unknown,
        encodingOrCb?: unknown,
        cb?: unknown,
      ): boolean => {
        if (typeof chunk === 'string' && chunk.startsWith('event: endpoint\ndata:')) {
          // The SDK wrote a relative endpoint event — replace with absolute URL.
          // We know the sessionId from transport.sessionId (read after construction).
          // Use a placeholder here; replaced below once we have the transport.
          // (This interceptor is set before connect(), so the write happens during
          //  connect() → transport.start().)
          chunk = chunk.replace(
            /^(event: endpoint\ndata:).*/,
            `$1 ${publicOrigin}${messagePath}?sessionId=__SESSION_ID__`,
          );
        }
        if (typeof encodingOrCb === 'function') {
          return originalWrite(chunk as string, encodingOrCb as () => void);
        }
        if (typeof cb === 'function') {
          return originalWrite(chunk as string, encodingOrCb as BufferEncoding, cb as () => void);
        }
        return originalWrite(chunk as string);
      };

      const transport = new SSEServerTransport(messagePath, rawRes);
      const sdkSessionId = transport.sessionId;

      // Now patch the placeholder with the real sessionId that the SDK assigned.
      // The write interceptor is still active during connect() → start(), so we
      // swap it out for a version that knows the actual sessionId.
      (rawRes as NodeJS.WritableStream & { write: typeof originalWrite }).write = (
        chunk: unknown,
        encodingOrCb?: unknown,
        cb?: unknown,
      ): boolean => {
        if (typeof chunk === 'string' && chunk.startsWith('event: endpoint\ndata:')) {
          chunk = `event: endpoint\ndata: ${publicOrigin}${messagePath}?sessionId=${sdkSessionId}\n\n`;
        }
        if (typeof encodingOrCb === 'function') {
          return originalWrite(chunk as string, encodingOrCb as () => void);
        }
        if (typeof cb === 'function') {
          return originalWrite(chunk as string, encodingOrCb as BufferEncoding, cb as () => void);
        }
        return originalWrite(chunk as string);
      };

      this.sseTransports.set(sdkSessionId, transport);

      transport.onclose = () => {
        logger.info({ sdkSessionId, sessionId: session.id }, 'SSE transport closed');
        clearInterval(heartbeat);
        this.sseTransports.delete(sdkSessionId);
        sessionManager.closeSession(session.id);
      };

      transport.onerror = (err: Error) => {
        logger.warn({ sdkSessionId, error: err.message }, 'SSE transport error');
      };

      const mcpServer = createMcpServerInstance(
        request.user?.userId,
        request.user?.email,
        request.user?.groups,
        token,
      );

      // connect() calls transport.start() which triggers the intercepted write()
      // above — emitting exactly ONE absolute endpoint event to the wire.
      await mcpServer.connect(transport);

      // Instruct the SSE client to retry after 3 seconds if the connection drops.
      // This follows the W3C SSE spec: the client waits `retry` ms before re-issuing
      // GET /sse, enabling automatic reconnection after transient network loss (e.g.
      // laptop lid close / sleep).  If the client ignores this field the behaviour is
      // identical to before, so this change is safe to ship unconditionally.
      reply.raw.write('retry: 3000\n\n');

      const absoluteMessageUrl = `${publicOrigin}${messagePath}?sessionId=${sdkSessionId}`;
      logger.info(
        { sdkSessionId, absoluteMessageUrl, publicOrigin },
        'SSE stream established — absolute endpoint URL intercepted and sent',
      );

      // Handle client disconnect
      request.raw.on('close', () => {
        clearInterval(heartbeat);
        transport.close().catch(() => {/* already logged via onclose */});
      });

    } catch (error) {
      logger.error({ error }, 'Failed to establish SSE connection');
      if (!reply.raw.headersSent) {
        reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to establish connection' });
      }
    }
  }

  /**
   * POST /message?sessionId=<id> — deliver JSON-RPC message to the correct transport.
   * The SDK transport's handlePostMessage handles parsing and routing internally.
   */
  private async handleMessage(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const sessionId = (request.query as Record<string, string>)['sessionId'];

    if (!sessionId) {
      reply.code(400).send({ error: 'Bad Request', message: 'Missing sessionId query parameter' });
      return;
    }

    const transport = this.sseTransports.get(sessionId);
    if (!transport) {
      logger.warn({ sessionId }, 'No active transport found for sessionId');
      reply.code(404).send({
        error: 'Not Found',
        message: 'Session not found or expired',
        details: { sessionId, suggestion: 'Reconnect via GET /sse' },
      });
      return;
    }

    logger.debug({ sessionId }, 'Forwarding message to SDK transport');

    try {
      await transport.handlePostMessage(request.raw, reply.raw, request.body);
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to handle message');
      if (!reply.raw.headersSent) {
        reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to process message' });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Health check
  // ─────────────────────────────────────────────────────────────────────────

  private async handleHealth(): Promise<HealthStatus> {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const memUsage = process.memoryUsage();

    let servicesHealth: MonitoringHealthStatus | null = null;
    if (this.healthChecker) {
      try {
        servicesHealth = await this.healthChecker.check();
      } catch (error) {
        logger.error({ error }, 'Health check failed');
      }
    }

    const health: HealthStatus = {
      status: servicesHealth?.status || 'healthy',
      uptime,
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        total: Math.round(memUsage.heapTotal / 1024 / 1024),
        percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
      },
      sessions: {
        active: sessionManager.getActiveSessionCount(),
        total: sessionManager.getTotalSessionCount(),
      },
      services: servicesHealth?.services || {
        http: 'up',
        redis: 'not_configured',
        cache: 'down',
      },
      timestamp: new Date().toISOString(),
    };

    if (servicesHealth?.details) {
      health.details = servicesHealth.details;
    }

    logger.info({ health }, 'Health check requested');
    return health;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    try {
      const host = config.http?.host || '0.0.0.0';
      const port = config.http?.port || 3000;
      const basePath = config.http?.basePath ?? '';

      await this.fastify.listen({ host, port });

      const publicOrigin = config.http?.publicOrigin ?? `http://${host}:${port}`;
      logger.info({ host, port, basePath, publicOrigin }, 'HTTP server started');
      // Internal listen address (for ops/infra):
      logger.info(`Listening on: http://${host}:${port}${basePath}`);
      // Public-facing addresses (what Cursor clients will use):
      logger.info(`[Public] Health check:    ${publicOrigin}${basePath}/health`);
      logger.info(`[Public] SSE endpoint:    ${publicOrigin}${basePath}/sse`);
      logger.info(`[Public] Message endpoint: ${publicOrigin}${basePath}/message?sessionId=<id>`);
    } catch (error) {
      logger.error({ error }, 'Failed to start HTTP server');
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      logger.info('Stopping HTTP server gracefully...');

      // Close all SDK SSE transports
      for (const [id, transport] of this.sseTransports.entries()) {
        logger.info({ id }, 'Closing SDK SSE transport');
        await transport.close().catch(() => {});
      }
      this.sseTransports.clear();

      sessionManager.closeAllSessions();

      await new Promise(resolve => setTimeout(resolve, 500));
      await this.fastify.close();

      logger.info('HTTP server stopped gracefully');
    } catch (error) {
      logger.error({ error }, 'Error stopping HTTP server');
      throw error;
    }
  }

  getFastify(): FastifyInstance {
    return this.fastify;
  }

  setCacheManager(cacheManager: CacheManager): void {
    this.healthChecker = new HealthChecker(cacheManager);
    logger.info('Health checker initialized with cache manager');
  }
}

// Singleton instance (initialized without cache manager initially)
export const httpServer = new HTTPServer();

// ─────────────────────────────────────────────────────────────────────────────
// Shared MCP Server factory
// Exported so that stdio transport in server.ts can reuse the same
// initialization logic (promptManager, tools, oninitialized auto-sync)
// without duplicating handler registration.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a fully-initialized MCP SDK Server instance with all tools,
 * prompt handlers, and the oninitialized auto-sync hook wired up.
 *
 * Used by both the SSE transport (per-connection in HTTPServer) and the
 * stdio transport (single instance in server.ts).
 */
export function createMcpServerInstance(
  userId?: string,
  email?: string,
  groups?: string[],
  userToken?: string,
  agentProfile?: AgentProfile,
): Server {
  // Resolve the active profile: caller > server-wide config > default 'cursor'.
  const resolvedProfile: AgentProfile = agentProfile ?? config.agentProfile ?? 'cursor';
  const server = new Server(
    { name: 'csp-ai-agent-mcp', version: SERVER_VERSION },
    { capabilities: { tools: {}, prompts: {}, logging: {} } },
  );

  promptManager.installHandlers(server, userToken);

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolRegistry.getMCPToolDefinitions(),
  }));

  server.oninitialized = () => {
    logger.info({ userId, agentProfile: resolvedProfile }, 'MCP initialized — triggering background sync_resources');
    telemetry.flushOnReconnect();
    void syncResources({
      mode: 'incremental',
      scope: 'global',
      user_token: userToken,
      agent_profile: resolvedProfile,
    }).then(async (result) => {
      if (result.success) {
        logger.info(
          { userId, synced: result.data?.summary?.synced, cached: result.data?.summary?.cached },
          'Auto sync_resources on connect completed',
        );
        const actions = result.data?.local_actions_required;
        if (actions && actions.length > 0) {
          // For Codex: storeSyncActions also caches merge_toml and restart_hint
          // so the AI can pick them up via the csp-ai-agent-setup prompt.
          promptManager.storeSyncActions(userToken ?? '', actions);
        }
        // Cache restart_required/restart_hint so the next GetPrompt delivers them.
        if (result.data?.restart_required && result.data?.restart_hint) {
          promptManager.storeRestartHint(userToken ?? '', result.data.restart_hint);
        }
      } else {
        logger.warn({ userId, error: result.error }, 'Auto sync_resources on connect failed');
      }
    }).catch((err) => {
      logger.error(
        { userId, error: err instanceof Error ? err.message : String(err) },
        'Auto sync_resources on connect threw an error',
      );
    });
  };

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    if (userId && groups && groups.length > 0) {
      const permCheck = checkToolCallPermission(name, { userId, email: email ?? '', groups });
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text' as const, text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }
    }

    const enrichedArgs: Record<string, unknown> = {
      user_token: userToken,
      ...args,
    };

    try {
      const result = await toolRegistry.callTool(name, enrichedArgs);
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ toolName: name, err }, 'Tool execution failed');
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  return server;
}
