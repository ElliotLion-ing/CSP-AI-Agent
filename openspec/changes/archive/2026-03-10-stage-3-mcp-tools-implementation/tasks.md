# Tasks: Stage 3 - MCP Tools Real Implementation

## 1. REST API Client
- [x] 1.1 Create src/api/client.ts with Axios configuration
- [x] 1.2 Implement authentication (Bearer token)
- [x] 1.3 Implement retry logic (3 attempts)
- [x] 1.4 Add request/response logging
- [x] 1.5 Define API endpoints (subscriptions, search, resources)
- [x] 1.6 Implement error handling with typed errors

## 2. Git Operations
- [x] 2.1 Create src/git/operations.ts
- [x] 2.2 Implement cloneRepository()
- [x] 2.3 Implement pullRepository()
- [x] 2.4 Implement commitAndPush()
- [x] 2.5 Add Git authentication support
- [x] 2.6 Implement conflict detection and handling

## 3. Filesystem Manager
- [x] 3.1 Create src/filesystem/manager.ts
- [x] 3.2 Implement readResource()
- [x] 3.3 Implement writeResource() with atomic operations
- [x] 3.4 Implement deleteResource()
- [x] 3.5 Implement directory management
- [x] 3.6 Add file validation (markdown, JSON)

## 4. Custom Error Types
- [x] 4.1 Create src/types/errors.ts
- [x] 4.2 Define GitError class
- [x] 4.3 Define APIError class
- [x] 4.4 Define ValidationError class
- [x] 4.5 Define FileSystemError class
- [x] 4.6 Export error factory functions

## 5. sync_resources Real Implementation
- [x] 5.1 Replace mock implementation with real logic
- [x] 5.2 Fetch subscriptions from API
- [x] 5.3 Clone/pull resources from Git
- [x] 5.4 Implement incremental sync algorithm
- [x] 5.5 Update local resource files
- [x] 5.6 Add metadata caching
- [x] 5.7 Write unit tests

## 6. manage_subscription Real Implementation
- [x] 6.1 Replace mock implementation with real logic
- [x] 6.2 Implement subscribe action (POST API)
- [x] 6.3 Implement unsubscribe action (DELETE API)
- [x] 6.4 Implement list action (GET API)
- [x] 6.5 Implement batch operations
- [x] 6.6 Add local state management
- [x] 6.7 Write unit tests

## 7. search_resources Real Implementation
- [x] 7.1 Replace mock implementation with real logic
- [x] 7.2 Integrate with API search endpoint
- [x] 7.3 Implement result filtering and sorting
- [x] 7.4 Check subscription status for each result
- [x] 7.5 Add search result caching (5 min TTL)
- [x] 7.6 Write unit tests

## 8. upload_resource Real Implementation
- [x] 8.1 Replace mock implementation with real logic
- [x] 8.2 Validate resource format (markdown/JSON)
- [x] 8.3 Commit to Git repository
- [x] 8.4 Push to remote
- [x] 8.5 Generate semantic version number
- [x] 8.6 Update resource metadata
- [x] 8.7 Write unit tests

## 9. uninstall_resource Real Implementation
- [x] 9.1 Replace mock implementation with real logic
- [x] 9.2 Remove resource files from filesystem
- [x] 9.3 Update Git repository (if requested)
- [x] 9.4 Remove from subscription list (if requested)
- [x] 9.5 Cleanup empty directories
- [x] 9.6 Log uninstall actions
- [x] 9.7 Write unit tests

## 10. Configuration Updates
- [x] 10.1 Update .env.example with new variables
- [x] 10.2 Add GIT_REPO_URL
- [x] 10.3 Add GIT_BRANCH
- [x] 10.4 Add GIT_AUTH_TOKEN
- [x] 10.5 Add CSP_API_TOKEN
- [x] 10.6 Add RESOURCE_BASE_PATH
- [x] 10.7 Update config/index.ts to load new vars

## 11. Testing
- [x] 11.1 Create Test/test-stage3-integration.js
- [x] 11.2 Test all core modules compilation
- [x] 11.3 Test all 5 tools structure
- [x] 11.4 Test error types export
- [x] 11.5 Test API Client structure
- [x] 11.6 Test Git Operations structure
- [x] 11.7 Test Filesystem Manager structure
- [x] 11.8 Test configuration structure
- [x] 11.9 Run all tests and verify 100% pass rate

## 12. Documentation
- [x] 12.1 Create Docs/Stage-3-MCP-Tools-Implementation.md
- [x] 12.2 Document all 5 tools implementation details
- [x] 12.3 Document core modules (API Client, Git, Filesystem)
- [x] 12.4 Document design decisions and trade-offs
- [x] 12.5 Update README.md with Stage 3 status
- [x] 12.6 Update Stage-3-Progress.md

---

**Status**: ✅ All tasks completed  
**Test Results**: 15/15 tests passed (100%)  
**Build Status**: TypeScript compilation successful  
**Ready for**: OpenSpec archive and Stage 4
