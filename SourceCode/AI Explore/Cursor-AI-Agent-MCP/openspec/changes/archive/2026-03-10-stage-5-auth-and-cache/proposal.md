# Change: Stage 5 - Authentication and Caching

**⚠️ 架构变更说明 (2026-03-10 归档后)**:
> 本提案描述了 Stage 5 的原始设计（基于本地 JWT 签发和 roles 权限）。
> 
> **实施后架构已调整为**：
> - Token 验证改为通过 CSP API (`GET /csp/api/user/permissions`)
> - 移除本地 JWT 签发功能 (`auth/jwt.ts` 已删除)
> - 移除 `JWT_SECRET` 配置，使用 `CSP_API_TOKEN`
> - 权限系统从 `roles` 改为 `groups`
> 
> 详见：`Docs/Token-Authentication-Fix.md`

---

## Why

The current system (Stage 4) has SSE Transport and HTTP Server, but lacks:
- **Authentication**: No user identity verification, only basic Bearer token check
- **Authorization**: No permission control, all users can access all tools
- **Session Security**: Sessions are not tied to verified users
- **API Caching**: REST API calls are not cached, causing redundant requests
- **Session Storage**: Sessions are memory-only, can't support multi-instance deployment

**Business Impact**:
- Security risk: Unauthenticated access to sensitive operations
- Performance issue: Repeated API calls waste resources
- Scalability limit: Memory-only sessions block horizontal scaling

## What Changes

### 1. JWT Authentication Middleware
- Implement JWT token generation and verification
- Add authentication middleware to SSE endpoint
- Store user identity (userId, roles) in JWT claims
- Token refresh mechanism

### 2. Permission Control System
- Define role-based permissions (admin, user, readonly)
- Tool-level permission checks
- Operation-level permission checks (read/write)
- Permission middleware for tool calls

### 3. Redis Integration
- Redis client setup and connection management
- Session storage in Redis (replace memory Map)
- API response caching
- Cache invalidation strategies

### 4. Multi-layer Caching System
- **L1 Cache**: In-memory LRU cache (fast, small capacity)
- **L2 Cache**: Redis cache (persistent, large capacity)
- **Cache Strategies**: TTL-based expiration, LRU eviction
- Cache key design and namespace

### 5. Configuration Updates
- JWT secret key configuration
- Redis connection configuration
- Cache TTL configuration
- Permission rules configuration

## Impact

### Affected Specs
- `mcp-server` - Add authentication and authorization
- `auth` - New capability (JWT authentication)
- `cache` - New capability (multi-layer caching)

### Affected Code
- `SourceCode/src/server/http.ts` - Add JWT middleware
- `SourceCode/src/session/manager.ts` - Integrate Redis storage
- `SourceCode/src/utils/api-client.ts` - Add caching layer
- `SourceCode/src/auth/` - New directory (JWT, permissions)
- `SourceCode/src/cache/` - New directory (Redis, LRU)
- `SourceCode/src/config/index.ts` - Add auth/cache config

### Breaking Changes
- SSE endpoint requires valid JWT token (not just Bearer token)
- Tool calls require permission checks
- Redis is now a required dependency for SSE mode

### Migration Path
1. Install Redis server
2. Configure JWT secret and Redis URL in .env
3. Generate JWT tokens for existing users
4. Update client to use JWT tokens
5. Test authentication and caching

## Dependencies

- `jsonwebtoken` - JWT generation and verification
- `ioredis` - Redis client
- `lru-cache` - In-memory LRU cache

## Estimated Duration

2-3 days

## Priority

High - Security and performance are critical for production deployment
