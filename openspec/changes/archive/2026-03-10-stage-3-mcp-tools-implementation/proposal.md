# Change: Stage 3 - MCP Tools Real Implementation

## Why

Stage 2 implemented MCP Server with mock tool implementations. To provide real value to users, we need to implement the actual business logic for all 5 MCP tools, integrating with Git operations and REST API services.

This change transforms the placeholder tools into fully functional implementations that can:
- Sync resources from Git repository to local filesystem
- Manage subscriptions via REST API
- Search for available resources
- Upload resources to Git repository
- Uninstall resources from local filesystem

This enables the MCP Server to be a production-ready resource management system.

## What Changes

### 1. REST API Client Implementation
Create HTTP client for CSP Resource Server API integration:
- Axios-based client with retry logic
- Token-based authentication
- Request/response logging
- Error handling with typed errors
- API endpoints: subscriptions, search, resources

### 2. Git Operations Integration
Implement Git operations using `simple-git`:
- Clone/pull resources from remote repository
- Commit and push resource changes
- Branch management
- Conflict resolution
- Git authentication (SSH/HTTPS)

### 3. Filesystem Operations
Implement resource filesystem management:
- Read/write resource files
- Directory structure management
- File validation (markdown, JSON)
- Atomic file operations
- Backup and rollback

### 4. Tool Real Implementation

#### 4.1 sync_resources (Real Logic)
- Fetch subscription list from API
- Clone/pull resources from Git repository
- Compare local vs remote versions
- Incremental sync (only changed files)
- Update local resource files
- Cache resource metadata

#### 4.2 manage_subscription (Real Logic)
- Subscribe: POST /api/resources/subscriptions
- Unsubscribe: DELETE /api/resources/subscriptions/{id}
- List: GET /api/resources/subscriptions
- Batch operations support
- Local subscription state management

#### 4.3 search_resources (Real Logic)
- Query API: GET /api/resources/search
- Filter by team, type, keyword
- Result ranking and sorting
- Check subscription status
- Cache search results (5 minutes TTL)

#### 4.4 upload_resource (Real Logic)
- Validate resource format
- Commit to Git repository
- Push to remote
- Generate version number
- Update resource metadata

#### 4.5 uninstall_resource (Real Logic)
- Remove resource files from filesystem
- Update Git repository (optional)
- Remove from subscription list (optional)
- Cleanup empty directories
- Log uninstall actions

### 5. Configuration Updates
Add new environment variables:
- `GIT_REPO_URL` - Git repository URL
- `GIT_BRANCH` - Git branch name (default: main)
- `GIT_AUTH_TOKEN` - Git authentication token
- `CSP_API_TOKEN` - API authentication token
- `RESOURCE_BASE_PATH` - Local resource storage path

### 6. Error Handling Enhancement
Implement comprehensive error types:
- `GitError` - Git operation failures
- `APIError` - API request failures
- `ValidationError` - Resource validation failures
- `FileSystemError` - File operation failures

### 7. Testing Infrastructure
Update test infrastructure:
- Mock Git operations
- Mock API responses
- Integration tests with real Git/API (optional)
- Test data fixtures

## Impact

### Affected Specs
- **MODIFIED**: mcp-tools (update all 5 tool requirements from mock to real)
- **DEPENDS ON**: mcp-server (from Stage 2)
- **DEPENDS ON**: core-framework (from Stage 1)

### Affected Code
- **MODIFIED**: `SourceCode/src/tools/sync-resources.ts` - real implementation
- **MODIFIED**: `SourceCode/src/tools/manage-subscription.ts` - real implementation
- **MODIFIED**: `SourceCode/src/tools/search-resources.ts` - real implementation
- **MODIFIED**: `SourceCode/src/tools/upload-resource.ts` - real implementation
- **MODIFIED**: `SourceCode/src/tools/uninstall-resource.ts` - real implementation
- **NEW**: `SourceCode/src/api/client.ts` - REST API client
- **NEW**: `SourceCode/src/git/operations.ts` - Git operations
- **NEW**: `SourceCode/src/filesystem/manager.ts` - Filesystem manager
- **NEW**: `SourceCode/src/types/errors.ts` - Custom error types
- **MODIFIED**: `SourceCode/.env.example` - add new config variables

### Dependencies
- `simple-git` - Git operations (already in package.json)
- `axios` - HTTP client (already in package.json)

### Breaking Changes
None (tools have same interface, only internal implementation changes)

### Migration Path
N/A (backward compatible)

## Success Criteria

1. ✅ All 5 tools implement real business logic (no mock data)
2. ✅ Git clone/pull/push operations work correctly
3. ✅ REST API integration works (subscriptions, search)
4. ✅ Filesystem operations are atomic and safe
5. ✅ Error handling covers all failure scenarios
6. ✅ All tests pass (100% for real implementations)
7. ✅ Tools are ready for SSE remote calls (Stage 4)

## Testing Plan

### Unit Tests
- REST API client: request/response handling, errors
- Git operations: clone, pull, push, error handling
- Filesystem manager: read, write, atomic operations
- Each tool: business logic with mocked dependencies

### Integration Tests
- sync_resources: end-to-end sync flow
- manage_subscription: API integration
- search_resources: search and caching
- upload_resource: Git push flow
- uninstall_resource: cleanup flow

### Manual Verification
- Real Git repository operations
- Real API server connection
- Verify resource files created correctly
- Check logs for complete operation traces

## Notes

- **For Stage 4**: Design tools with remote SSE calls in mind
- **Error messages**: Should be user-friendly and actionable
- **Logging**: Detailed logging for debugging production issues
- **Performance**: Consider caching and batch operations
