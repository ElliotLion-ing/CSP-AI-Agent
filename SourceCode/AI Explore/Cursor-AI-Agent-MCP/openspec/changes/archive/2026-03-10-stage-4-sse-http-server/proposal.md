# Change: Stage 4 - SSE Transport and HTTP Server

## Why

Stage 3 implemented all 5 MCP tools with real business logic using stdio transport. However, **MCP Server must be deployed on a remote server** to be accessible by multiple users. SSE (Server-Sent Events) is the **core transport protocol** required for production deployment, not an optional feature.

Without SSE + HTTP Server:
- ❌ Server can only run locally via stdio
- ❌ Cannot deploy to remote server for team access
- ❌ Multiple users cannot connect simultaneously
- ❌ No web-based access or monitoring

With SSE + HTTP Server:
- ✅ Deploy server to remote machine (CSP server)
- ✅ Multiple users connect via HTTP/SSE
- ✅ Support both stdio (dev) and SSE (prod) transports
- ✅ Enable web monitoring and health checks
- ✅ Production-ready architecture

## What Changes

### 1. HTTP Server Integration (Fastify)
Implement HTTP server with Fastify framework:
- Health check endpoint: `GET /health`
- SSE connection endpoint: `POST /sse`
- Message handling endpoint: `POST /message`
- Graceful shutdown support
- Request logging and error handling

### 2. SSE Transport Protocol
Implement MCP SSE transport as per MCP specification:
- SSE connection establishment
- Bidirectional message passing (SSE for server→client, HTTP POST for client→server)
- Session management and tracking
- Connection keepalive and auto-reconnect
- Error handling and recovery

### 3. Dual Transport Support
Support both stdio and SSE transports:
- Stdio transport for local development and debugging
- SSE transport for production remote deployment
- Environment-based transport selection
- Shared tool registry between transports

### 4. Session Management
Track user sessions and connections:
- Session ID generation and tracking
- User authentication via Bearer token
- Connection state management
- Session cleanup on disconnect

### 5. Configuration Updates
Add HTTP/SSE configuration:
- `HTTP_PORT` - HTTP server port (default: 3000)
- `HTTP_HOST` - HTTP server host (default: 0.0.0.0)
- `TRANSPORT_MODE` - stdio or sse (default: stdio)
- `SESSION_TIMEOUT` - Session timeout in seconds (default: 3600)

### 6. Health Monitoring
Add health check and monitoring:
- `/health` endpoint with server status
- Active connections count
- Memory usage metrics
- Uptime tracking

### 7. Testing Infrastructure
Add SSE transport tests:
- SSE connection tests
- Message passing tests
- Session management tests
- Load testing (multiple concurrent connections)

## Impact

### Affected Specs
- **NEW**: sse-transport (SSE transport protocol requirements)
- **MODIFIED**: mcp-server (add SSE support)
- **DEPENDS ON**: mcp-tools (from Stage 3)

### Affected Code
- **NEW**: `SourceCode/src/server/http.ts` - Fastify HTTP server
- **NEW**: `SourceCode/src/transport/sse.ts` - SSE transport implementation
- **NEW**: `SourceCode/src/session/manager.ts` - Session management
- **MODIFIED**: `SourceCode/src/server.ts` - Add transport selection
- **MODIFIED**: `SourceCode/src/index.ts` - Main entry point with dual transport
- **MODIFIED**: `SourceCode/.env.example` - Add HTTP/SSE config

### Dependencies
- `fastify` - HTTP server framework (already in package.json)
- `@fastify/cors` - CORS support
- `@fastify/helmet` - Security headers

### Breaking Changes
None (backward compatible, stdio transport still works)

### Migration Path
N/A (adds new features, doesn't break existing)

## Success Criteria

1. ✅ HTTP server starts and listens on configured port
2. ✅ SSE connections can be established
3. ✅ MCP protocol works over SSE transport
4. ✅ All 5 tools work via SSE (same as stdio)
5. ✅ Multiple concurrent SSE connections supported
6. ✅ Session management tracks active users
7. ✅ Health check endpoint returns server status
8. ✅ Graceful shutdown closes all connections
9. ✅ Can deploy to remote server and connect from client
10. ✅ All tests pass (stdio + SSE transports)

## Testing Plan

### Unit Tests
- HTTP server startup/shutdown
- SSE connection lifecycle
- Session creation/deletion
- Health check endpoint

### Integration Tests
- Full MCP flow over SSE
- Multiple concurrent connections
- Tool execution via SSE
- Session timeout and cleanup

### Manual Verification
- Deploy to remote server
- Connect from local Cursor IDE
- Execute all 5 tools via SSE
- Monitor health check endpoint
- Test reconnection after disconnect

## Notes

- **Production Deployment**: Server will run on CSP machine with SSE enabled
- **Local Development**: Use stdio transport for faster iteration
- **Security**: Add authentication middleware in Stage 5
- **Performance**: SSE has ~2x latency vs stdio but enables remote access
