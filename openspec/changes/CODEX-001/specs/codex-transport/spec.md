# Capability: Codex Transport

## ADDED Requirements

### Requirement: Streamable HTTP Transport
System SHALL support Streamable HTTP transport as a third transport option alongside stdio and SSE.

#### Scenario: Server starts with streamable_http transport mode
- **WHEN** `TRANSPORT_MODE=streamable_http` is configured
- **THEN** server starts and accepts POST /mcp requests

#### Scenario: tools/list works over streamable HTTP
- **WHEN** a Codex client sends a tools/list JSON-RPC request via POST /mcp
- **THEN** server responds with the full tool list

#### Scenario: tools/call works over streamable HTTP
- **WHEN** a Codex client calls sync_resources via POST /mcp
- **THEN** server executes the tool and returns the result

#### Scenario: SSE and stdio transports remain unchanged
- **WHEN** `TRANSPORT_MODE=sse` or `TRANSPORT_MODE=stdio` is configured
- **THEN** server behavior is identical to pre-refactor

### Requirement: Legacy SSE Implementation Removed
System SHALL remove the unused `transport/sse.ts` file to eliminate dead code.

#### Scenario: No import of transport/sse.ts exists
- **WHEN** the codebase is compiled
- **THEN** `transport/sse.ts` does not exist and no file imports from it
