# Change: Stage 2 - MCP Server Basic Implementation

## Why

The core framework from Stage 1 provides the foundation, but the application cannot function as an MCP Server yet. This change implements the basic MCP Server functionality:

- MCP protocol handler using official SDK
- Basic tool registration infrastructure
- Placeholder for 5 core MCP Tools
- Session management (simplified, auth will come later)

This enables the server to accept MCP connections and register tools, preparing for Stage 3 (tool implementation).

## What Changes

### 1. MCP SDK Integration
- Install `@modelcontextprotocol/sdk` dependency (already in package.json)
- Implement MCP Server using StdioServerTransport
- Handle MCP protocol messages (initialize, tools/list, tools/call)
- Implement proper error handling for MCP protocol

### 2. Tool Registration Infrastructure
- Create tool registry system in `SourceCode/src/tools/registry.ts`
- Define MCP Tool interface and types
- Implement tool registration and lookup functions
- Add tool validation (schema, handler existence)

### 3. Tool Placeholders
Create placeholder files for 5 core tools in `SourceCode/src/tools/`:
- `sync-resources.ts` - sync_resources tool
- `manage-subscription.ts` - manage_subscription tool
- `search-resources.ts` - search_resources tool
- `upload-resource.ts` - upload_resource tool
- `uninstall-resource.ts` - uninstall_resource tool

Each placeholder returns mock data and logs the call.

### 4. Server Implementation
- Update `SourceCode/src/server.ts` with MCP Server logic
- Implement stdio transport for MCP communication
- Add tool registration on server start
- Handle graceful shutdown (close MCP connections)

### 5. Types and Interfaces
Create TypeScript types in `SourceCode/src/types/`:
- `mcp.ts` - MCP protocol types
- `tools.ts` - Tool parameter and result types

## Impact

### Affected Specs
- **NEW**: mcp-server (this change creates MCP Server capability)
- **DEPENDS ON**: core-framework (from Stage 1)

### Affected Code
- **MODIFIED**: `SourceCode/src/server.ts` - implement MCP Server
- **NEW**: `SourceCode/src/tools/registry.ts` - tool registry
- **NEW**: `SourceCode/src/tools/*.ts` - 5 tool placeholders
- **NEW**: `SourceCode/src/types/mcp.ts` - MCP types
- **NEW**: `SourceCode/src/types/tools.ts` - Tool types

### Dependencies
- Requires @modelcontextprotocol/sdk (already installed)
- Requires Stage 1 (core-framework) to be complete

### Breaking Changes
None (additive changes only)

### Migration Path
N/A (new functionality)

## Success Criteria

1. ✅ MCP Server starts and listens on stdio
2. ✅ Server responds to MCP initialize request
3. ✅ Server responds to tools/list request with 5 tools
4. ✅ Server accepts tools/call requests (returns mock data)
5. ✅ All tools are registered correctly
6. ✅ Type checking passes
7. ✅ Test coverage for MCP protocol handling

## Testing Plan

### Unit Tests
- Tool registry: registration, lookup, validation
- MCP protocol handler: initialize, tools/list, tools/call
- Tool placeholders: ensure mock responses are valid

### Integration Tests
- Full MCP server lifecycle: start, handle requests, shutdown
- Tool invocation flow: call each tool with mock params
- Error handling: invalid tool name, invalid params

### Manual Verification
- Start server and send MCP requests via stdio
- Verify tools/list returns 5 tools
- Verify tools/call returns mock data
- Check logs for tool invocations
