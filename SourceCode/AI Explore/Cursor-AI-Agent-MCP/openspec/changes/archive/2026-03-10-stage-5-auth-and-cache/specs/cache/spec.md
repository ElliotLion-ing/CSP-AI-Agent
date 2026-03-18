## ADDED Requirements

### Requirement: Redis Session Storage
The system SHALL store sessions in Redis for persistence and multi-instance support.

#### Scenario: Save session to Redis
- **WHEN** a new session is created
- **THEN** the system stores session data in Redis
- **AND** sets TTL based on SESSION_TIMEOUT configuration
- **AND** uses session ID as Redis key

#### Scenario: Load session from Redis
- **WHEN** a client makes a request with session ID
- **THEN** the system retrieves session data from Redis
- **AND** updates last activity timestamp
- **AND** extends session TTL

#### Scenario: Session expiration in Redis
- **WHEN** a session exceeds its TTL
- **THEN** Redis automatically removes the expired session
- **AND** subsequent requests with that session ID fail

### Requirement: API Response Caching
The system SHALL cache API responses to reduce redundant external calls.

#### Scenario: Cache miss - first request
- **WHEN** an API request is made for the first time
- **THEN** the system calls the external API
- **AND** caches the response with TTL
- **AND** returns the response to the client

#### Scenario: Cache hit - subsequent request
- **WHEN** an API request is made for cached data
- **THEN** the system retrieves the response from cache
- **AND** returns cached data without calling external API
- **AND** logs cache hit for monitoring

#### Scenario: Cache invalidation on write
- **WHEN** a write operation modifies data
- **THEN** the system invalidates related cache entries
- **AND** ensures subsequent reads get fresh data

### Requirement: Multi-Layer Caching
The system SHALL implement a two-layer caching strategy for optimal performance.

#### Scenario: L1 cache hit (memory)
- **WHEN** a cache lookup is performed
- **THEN** the system first checks L1 in-memory cache
- **AND** returns data immediately if found
- **AND** avoids network call to Redis

#### Scenario: L1 miss, L2 hit (Redis)
- **WHEN** data is not in L1 cache
- **THEN** the system checks L2 Redis cache
- **AND** promotes data to L1 cache if found
- **AND** returns the cached data

#### Scenario: L1 and L2 miss
- **WHEN** data is not in either cache layer
- **THEN** the system fetches data from source
- **AND** stores data in both L1 and L2 caches
- **AND** returns the fresh data

### Requirement: Cache Configuration
The system SHALL support configurable caching behavior.

#### Scenario: Configure cache TTL
- **WHEN** the system starts
- **THEN** it loads cache TTL from configuration
- **AND** applies TTL to all cached entries
- **AND** uses default TTL if not configured

#### Scenario: Disable caching
- **WHEN** ENABLE_CACHE is set to false
- **THEN** the system bypasses all caching layers
- **AND** always fetches fresh data from source

### Requirement: Cache Health Monitoring
The system SHALL monitor cache performance and health.

#### Scenario: Track cache hit rate
- **WHEN** cache operations are performed
- **THEN** the system tracks hit and miss counts
- **AND** calculates hit rate percentage
- **AND** exposes metrics via health endpoint

#### Scenario: Redis connection failure
- **WHEN** Redis connection is lost
- **THEN** the system logs the connection error
- **AND** falls back to memory-only caching
- **AND** continues serving requests without Redis
