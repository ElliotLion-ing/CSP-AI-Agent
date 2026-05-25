/**
 * Streamable HTTP Server Transport
 *
 * Implements the MCP Streamable HTTP transport specification (2025-03-26),
 * which Codex CLI uses to communicate with MCP servers.
 *
 * Differences from the legacy SSE transport (http.ts):
 * - Stateless: each POST /mcp request is processed independently by a new
 *   Server instance; no sessionId or persistent SSE connection is maintained.
 * - Single endpoint: all JSON-RPC messages arrive as POST /mcp.
 * - GET /mcp is supported for SSE streaming server notifications (optional).
 *
 * Authentication:
 * - Reuses tokenAuthOrLegacyMiddleware from the SSE server.
 * - For Codex (stdio MCP config without a bearer token), auth is skipped when
 *   the middleware finds no Authorization header and the server has been
 *   configured with CSP_AGENT_PROFILE=codex.
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import {
  tokenAuthOrLegacyMiddleware,
  type AuthenticatedRequest,
} from '../auth/middleware.js';
import { createMcpServerInstance } from './http.js';
import { telemetry } from '../telemetry/index.js';

export class StreamableHTTPServer {
  private readonly fastify: FastifyInstance;

  constructor() {
    this.fastify = Fastify({
      logger: false,
      bodyLimit: 10 * 1024 * 1024, // 10 MB
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Middleware
  // ─────────────────────────────────────────────────────────────────────────

  private setupMiddleware(): void {
    void this.fastify.register(cors, { origin: true });
    void this.fastify.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Routes
  // ─────────────────────────────────────────────────────────────────────────

  private setupRoutes(): void {
    const basePath = config.streamableHttp?.basePath ?? config.http?.basePath ?? '';

    // Health check — same contract as the SSE server
    this.fastify.get(`${basePath}/health`, async (_req, reply) => {
      await reply.send({ status: 'healthy', transport: 'streamable_http' });
    });

    // Primary MCP endpoint — handles both GET (SSE notification stream) and
    // POST (JSON-RPC request/response or SSE streaming response)
    const mcpPath = `${basePath}/mcp`;

    this.fastify.all(mcpPath, async (req, reply) => {
      // Auth — same middleware as the SSE server.
      // For Codex with CSP_AGENT_PROFILE=codex, the middleware should be
      // configured to allow unauthenticated requests (handled at deploy time).
      try {
        await tokenAuthOrLegacyMiddleware(req as unknown as AuthenticatedRequest, reply);
      } catch {
        // tokenAuthOrLegacyMiddleware already replied with a 401/403; bail out.
        return;
      }

      if (reply.sent) {
        return;
      }

      const authedReq = req as unknown as AuthenticatedRequest;
      const token = authedReq.headers.authorization?.replace(/^Bearer\s+/i, '');

      // Register the token with the telemetry manager so that:
      // 1. The token is added to activeTokens (required for flush() to proceed).
      // 2. The per-user slot is initialised in the telemetry file.
      //
      // Background: unlike the SSE transport (which calls setUserToken once on
      // connection and keeps the token active for the session lifetime), the
      // Streamable HTTP transport is stateless — each POST /mcp is an independent
      // request with no persistent session.  Without this call, activeTokens
      // remains empty and telemetry.flush() exits early, so recorded invocation
      // events accumulate locally but are never uploaded to the remote API.
      if (token) {
        telemetry.setUserToken(token);
      }

      // Per-request stateless Server instance — identical setup to the SSE path.
      const mcpServer = createMcpServerInstance(
        authedReq.user?.userId,
        authedReq.user?.email,
        authedReq.user?.groups,
        token,
        'codex',
      );

      const transport = new StreamableHTTPServerTransport({
        // Stateless mode: each request is independent; session management is
        // left to the client (Codex handles reconnection on its own).
        sessionIdGenerator: undefined,
      });

      // Connect MCP Server to transport; the transport will send the response
      // through the underlying Node.js ServerResponse (accessed via reply.raw).
      await mcpServer.connect(transport);

      try {
        await transport.handleRequest(
          req.raw,
          reply.raw,
          req.body,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, path: req.url }, `Streamable HTTP MCP request failed: ${msg}`);
        if (!reply.sent) {
          await reply.code(500).send({ error: 'Internal server error' });
        }
      } finally {
        // Clean up: close the transport so the underlying connection is freed.
        // The Server instance will be garbage-collected after this request.
        await transport.close().catch(() => undefined);
        // Trigger an immediate best-effort flush after each Streamable HTTP
        // request so that telemetry events recorded during this request (e.g.
        // resolve_prompt_content invocations) are uploaded promptly.
        // Fire-and-forget: flush errors are handled inside flush() itself.
        if (token) {
          telemetry.flush().catch(() => undefined);
        }
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    // Use dedicated streamableHttp config block when available (dual mode),
    // fall back to http config for standalone streamable_http mode.
    const host = config.streamableHttp?.host ?? config.http?.host ?? '0.0.0.0';
    const port = config.streamableHttp?.port ?? config.http?.port ?? 3001;

    await this.fastify.listen({ host, port });
    logger.info(
      { host, port, transport: 'streamable_http' },
      `✅ Streamable HTTP MCP server listening on ${host}:${port}`,
    );
  }

  async stop(): Promise<void> {
    await this.fastify.close();
    logger.info('Streamable HTTP server stopped');
  }
}

export const streamableHttpServer = new StreamableHTTPServer();
