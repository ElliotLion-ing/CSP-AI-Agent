## ADDED Requirements

**⚠️ 架构变更说明**:
> 以下需求描述了原始设计（本地 JWT 签发 + roles 权限）。
> 
> **当前实现已调整为**：
> - Token 验证：通过 CSP API `GET /csp/api/user/permissions`
> - 不再本地签发 JWT（Requirement: Token Generation 已废弃）
> - 权限系统：基于 `groups` 而不是 `roles`
> - 配置：使用 `CSP_API_TOKEN` 而不是 `JWT_SECRET`

---

### Requirement: Token Authentication via CSP API ⭐ (Updated)
The system SHALL validate tokens by calling CSP API `/csp/api/user/permissions`.

#### Scenario: Successful authentication
- **WHEN** a client provides a valid JWT token (CSP_API_TOKEN) in the Authorization header
- **THEN** the system calls CSP API `GET /csp/api/user/permissions` with the token
- **AND** extracts user_id, email, and groups from the API response
- **AND** creates an authenticated session with user groups

#### Scenario: Token validation failure
- **WHEN** CSP API returns 401 or error code 4010
- **THEN** the system rejects the request with 401 Unauthorized
- **AND** returns the error message from CSP API

---

### ~~Requirement: Token Generation~~ ⚠️ (Deprecated)
> **已废弃**: MCP Server 不再本地签发 JWT token。
> Token 由 CSP 系统签发，MCP Server 只负责验证和传递。

~~The system SHALL provide JWT token generation for authenticated users.~~

---

### Requirement: Group-Based Access Control ⭐ (Updated)
The system SHALL enforce group-based permissions for tool access.

#### Scenario: Admin group access
- **WHEN** a user belonging to "admin" group calls any tool
- **THEN** the system allows the operation
- **AND** logs the admin action

#### Scenario: User access with allowed groups
- **WHEN** a user's groups match the tool's allowed groups
- **THEN** the system allows the operation
- **AND** executes the tool handler

#### Scenario: User access without allowed groups
- **WHEN** a user's groups don't match any allowed groups for the tool
- **THEN** the system rejects the request with 403 Forbidden
- **AND** returns a clear permission denied message

#### Scenario: All authenticated users (wildcard)
- **WHEN** a tool allows all authenticated users (allowedGroups: ['*'])
- **THEN** any user with valid authentication can access the tool
- **AND** executes the tool handler

---

### ~~Requirement: Role-Based Access Control~~ ⚠️ (Replaced by Group-Based)
> **已替换**: 原来的 roles (admin/user/readonly) 已被 groups (zNet, Client-Public, etc.) 替代。

---

### Requirement: Permission Configuration
The system SHALL support configurable permission rules for each tool.

#### Scenario: Load permission rules from config
- **WHEN** the system starts
- **THEN** it loads permission rules from configuration
- **AND** validates the permission schema
- **AND** applies default permissions if not configured

#### Scenario: Check tool permissions
- **WHEN** a tool is invoked
- **THEN** the system checks the user's role against tool permissions
- **AND** allows or denies access based on permission rules
