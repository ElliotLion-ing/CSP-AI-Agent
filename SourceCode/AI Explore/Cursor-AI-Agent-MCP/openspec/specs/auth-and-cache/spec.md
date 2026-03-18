# auth-and-cache Specification

## Purpose
TBD - created by archiving change stage-5-auth-and-cache. Update Purpose after archive.
## Requirements
### Requirement: CSP Token Authentication
The system SHALL validate all incoming requests using a CSP-issued JWT token by calling `GET /csp/api/user/permissions`.

#### Scenario: Valid CSP token accepted
- **WHEN** a request carries a valid CSP JWT in the Authorization header
- **THEN** the system calls `/csp/api/user/permissions` and retrieves user groups
- **AND** the request proceeds to the requested tool

#### Scenario: Invalid or missing token rejected
- **WHEN** a request carries an invalid, expired, or missing token
- **THEN** the system returns a 401 Unauthorized response
- **AND** no tool is executed

### Requirement: Group-Based Permission Control
The system SHALL enforce per-tool access control based on the user's groups returned by the CSP permissions API.

#### Scenario: Authorized group accesses tool
- **WHEN** the user belongs to a group permitted to call a given tool
- **THEN** the tool executes normally

#### Scenario: Unauthorized group blocked
- **WHEN** the user does not belong to any permitted group for the requested tool
- **THEN** the system returns a 403 Forbidden response

### Requirement: Multi-Layer API Response Caching
The system SHALL cache CSP API responses using a two-layer strategy: L1 in-memory LRU cache and optional L2 Redis cache.

#### Scenario: Cache hit returns cached response
- **WHEN** an identical API request has been made within the TTL window
- **THEN** the system returns the cached response without calling the CSP API

#### Scenario: Cache miss triggers upstream call
- **WHEN** no cached response exists for a request
- **THEN** the system calls the CSP API, caches the response, and returns it

#### Scenario: Redis unavailable falls back to memory cache
- **WHEN** Redis is not configured or unreachable
- **THEN** the system operates with L1 in-memory LRU cache only
- **AND** no error is surfaced to the caller

### Requirement: Cache Invalidation on Mutations
The system SHALL invalidate relevant cache entries when write operations (POST/PUT/DELETE) are performed.

#### Scenario: Write operation invalidates cache
- **WHEN** a mutation request is made to the CSP API
- **THEN** the cache entries related to the affected resource are removed
- **AND** the next read request fetches fresh data from the CSP API

