# Change: Stage 5 - Authentication and Caching

## Why
Implement authentication via CSP API Token validation and multi-layer caching to improve security and performance of the MCP Server.

## What Changes
- Authentication via `GET /csp/api/user/permissions` using CSP-issued JWT token
- Permission control system based on user groups
- Multi-layer caching: L1 in-memory LRU + L2 Redis (optional, falls back to memory)
- Cache-aside pattern with automatic invalidation on mutations

## Impact
- Affected code: `SourceCode/src/auth/`, `SourceCode/src/cache/`, `SourceCode/src/config/`
- Architecture note: Local JWT signing was evaluated and rejected in favour of validating CSP-issued tokens directly
