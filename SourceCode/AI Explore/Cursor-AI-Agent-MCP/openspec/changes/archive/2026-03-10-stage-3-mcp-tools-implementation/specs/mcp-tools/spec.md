# Spec Delta: MCP Tools Capability

## MODIFIED Requirements

### Requirement: sync_resources Tool Implementation
The system SHALL implement real business logic for sync_resources tool, integrating with Git repository and REST API for resource synchronization.

#### Scenario: Incremental sync with subscription check
- **WHEN** user calls sync_resources with mode='incremental'
- **THEN** system fetches subscription list from API
- **AND** system pulls latest changes from Git repository
- **AND** system identifies changed resources since last sync
- **AND** system updates only changed resource files
- **AND** system caches resource metadata locally

#### Scenario: Full sync from scratch
- **WHEN** user calls sync_resources with mode='full' and local repository doesn't exist
- **THEN** system clones Git repository to local path
- **AND** system fetches all subscribed resources
- **AND** system writes all resource files to filesystem
- **AND** system initializes metadata cache

#### Scenario: Sync with Git authentication failure
- **WHEN** user calls sync_resources and Git authentication fails
- **THEN** system throws GitError with authentication failure message
- **AND** system logs the error with Git repository URL (without credentials)
- **AND** system returns error response to client

#### Scenario: Sync with API unavailable
- **WHEN** user calls sync_resources and API server is unavailable
- **THEN** system retries API request 3 times with exponential backoff
- **AND** if all retries fail, system throws APIError
- **AND** system logs the error with API endpoint and error details
- **AND** system returns error response indicating API unavailability

---

### Requirement: manage_subscription Tool Implementation
The system SHALL implement real business logic for manage_subscription tool, integrating with REST API for subscription management.

#### Scenario: Subscribe to resource successfully
- **WHEN** user calls manage_subscription with action='subscribe' and resource_ids
- **THEN** system sends POST request to /api/resources/subscriptions
- **AND** system includes authentication token in request header
- **AND** API returns 200 with subscription details
- **AND** system updates local subscription state
- **AND** system returns success response with new subscriptions

#### Scenario: Subscribe with duplicate resource ID
- **WHEN** user calls manage_subscription to subscribe to already subscribed resource
- **THEN** API returns 409 Conflict
- **AND** system logs the conflict
- **AND** system returns error response indicating resource already subscribed

#### Scenario: Unsubscribe from resource
- **WHEN** user calls manage_subscription with action='unsubscribe' and resource_ids
- **THEN** system sends DELETE request to /api/resources/subscriptions/{id}
- **AND** API returns 204 No Content
- **AND** system removes from local subscription state
- **AND** system returns success response

#### Scenario: List all subscriptions
- **WHEN** user calls manage_subscription with action='list'
- **THEN** system sends GET request to /api/resources/subscriptions
- **AND** API returns paginated subscription list
- **AND** system merges with local subscription state
- **AND** system returns complete subscription list

#### Scenario: Batch subscribe operations
- **WHEN** user calls manage_subscription with action='batch_subscribe' and multiple resource_ids
- **THEN** system sends batch POST request to API
- **AND** system processes all subscriptions in single transaction
- **AND** system returns summary of successful and failed subscriptions

---

### Requirement: search_resources Tool Implementation
The system SHALL implement real business logic for search_resources tool, integrating with REST API and caching mechanism.

#### Scenario: Search by keyword
- **WHEN** user calls search_resources with keyword='debug'
- **THEN** system sends GET request to /api/resources/search?keyword=debug
- **AND** API returns matching resources with relevance scores
- **AND** system checks subscription status for each result
- **AND** system caches search results for 5 minutes
- **AND** system returns results sorted by relevance score

#### Scenario: Search with filters (team and type)
- **WHEN** user calls search_resources with team='zNet' and type='command'
- **THEN** system sends GET request with query parameters
- **AND** API filters results by team and type
- **AND** system returns filtered results

#### Scenario: Search with cache hit
- **WHEN** user calls search_resources with same keyword within 5 minutes
- **THEN** system checks cache for existing results
- **AND** cache hit returns cached results immediately
- **AND** no API request is sent
- **AND** system logs cache hit

#### Scenario: Search with empty results
- **WHEN** user calls search_resources with keyword that matches no resources
- **THEN** API returns empty results array
- **AND** system returns empty results with total=0
- **AND** system still caches the empty result

---

### Requirement: upload_resource Tool Implementation
The system SHALL implement real business logic for upload_resource tool, integrating with Git operations and resource validation.

#### Scenario: Upload new resource successfully
- **WHEN** user calls upload_resource with new resource_id, type, and message
- **THEN** system validates resource format (markdown or JSON)
- **AND** system commits resource file to Git repository
- **AND** system generates semantic version number (e.g., 1.0.0)
- **AND** system pushes to remote Git repository
- **AND** system returns upload result with version and commit hash

#### Scenario: Upload with invalid resource format
- **WHEN** user calls upload_resource with malformed markdown file
- **THEN** system validates file format
- **AND** validation fails with specific error message
- **AND** system throws ValidationError
- **AND** no Git commit is created

#### Scenario: Upload with Git push failure
- **WHEN** user calls upload_resource and Git push fails (e.g., network error)
- **THEN** system creates local commit successfully
- **AND** push operation fails with network error
- **AND** system throws GitError with push failure details
- **AND** system keeps local commit for retry

#### Scenario: Update existing resource
- **WHEN** user calls upload_resource with existing resource_id
- **THEN** system detects existing resource
- **AND** system increments version number (e.g., 1.0.0 → 1.0.1)
- **AND** system commits and pushes updated resource
- **AND** system returns new version number

---

### Requirement: uninstall_resource Tool Implementation
The system SHALL implement real business logic for uninstall_resource tool, with filesystem cleanup and optional subscription removal.

#### Scenario: Uninstall resource from filesystem only
- **WHEN** user calls uninstall_resource with resource_id and remove_from_account=false
- **THEN** system removes resource files from local filesystem
- **AND** system does not remove from subscription list
- **AND** system does not update Git repository
- **AND** system returns list of removed files

#### Scenario: Uninstall with subscription removal
- **WHEN** user calls uninstall_resource with remove_from_account=true
- **THEN** system removes resource files from filesystem
- **AND** system calls manage_subscription to unsubscribe
- **AND** subscription is removed from both local and remote
- **AND** system returns removal confirmation

#### Scenario: Uninstall non-existent resource
- **WHEN** user calls uninstall_resource with resource_id that doesn't exist locally
- **THEN** system checks filesystem for resource
- **AND** no files found to remove
- **AND** system returns success with empty removed_resources list
- **AND** system logs warning about non-existent resource

#### Scenario: Uninstall with directory cleanup
- **WHEN** user calls uninstall_resource and resource directory becomes empty after removal
- **THEN** system removes resource files
- **AND** system detects empty parent directory
- **AND** system removes empty directory recursively
- **AND** system logs directory cleanup actions

---

## ADDED Requirements

### Requirement: REST API Client Integration
The system SHALL provide a REST API client for communicating with CSP Resource Server.

#### Scenario: API request with authentication
- **WHEN** API client sends request to CSP Resource Server
- **THEN** client includes Bearer token in Authorization header
- **AND** token is loaded from CSP_API_TOKEN environment variable
- **AND** request includes User-Agent header with server version

#### Scenario: API request with retry logic
- **WHEN** API request fails with network error
- **THEN** client retries request up to 3 times
- **AND** client uses exponential backoff (1s, 2s, 4s)
- **AND** client logs each retry attempt
- **AND** if all retries fail, client throws APIError

#### Scenario: API response logging
- **WHEN** API client receives response
- **THEN** client logs request method, URL, status code, and duration
- **AND** if response is error, client logs error details
- **AND** sensitive data (tokens, passwords) are redacted from logs

---

### Requirement: Git Operations Integration
The system SHALL provide Git operations for resource repository management.

#### Scenario: Clone Git repository
- **WHEN** system clones Git repository for first time
- **THEN** system uses GIT_REPO_URL from configuration
- **AND** system authenticates with GIT_AUTH_TOKEN
- **AND** system clones to RESOURCE_BASE_PATH directory
- **AND** system checks out configured branch (GIT_BRANCH)

#### Scenario: Pull latest changes
- **WHEN** system pulls latest changes from Git repository
- **THEN** system fetches remote changes
- **AND** system performs fast-forward merge if possible
- **AND** if merge conflicts detected, system throws GitError
- **AND** system logs all pulled file changes

#### Scenario: Commit and push changes
- **WHEN** system commits and pushes resource changes
- **THEN** system stages all modified files
- **AND** system creates commit with provided message
- **AND** system pushes to remote repository
- **AND** system returns commit hash and push result

---

### Requirement: Filesystem Manager
The system SHALL provide filesystem operations for resource file management with atomicity guarantees.

#### Scenario: Write resource file atomically
- **WHEN** system writes resource file
- **THEN** system writes to temporary file first
- **AND** system validates file content
- **AND** system renames temporary file to target path (atomic operation)
- **AND** if any step fails, system cleans up temporary file

#### Scenario: Read resource file with validation
- **WHEN** system reads resource file
- **THEN** system checks file exists
- **AND** system reads file content
- **AND** system validates file format (markdown or JSON)
- **AND** if validation fails, system throws ValidationError

#### Scenario: Delete resource file with backup
- **WHEN** system deletes resource file
- **THEN** system creates backup of file before deletion
- **AND** system performs deletion
- **AND** if deletion fails, system restores from backup
- **AND** system logs deletion action

---

### Requirement: Error Handling with Typed Errors
The system SHALL provide typed error classes for different failure scenarios.

#### Scenario: Git operation failure
- **WHEN** Git operation fails
- **THEN** system throws GitError with operation type and error details
- **AND** error includes original Git error message
- **AND** error includes repository URL (without credentials)

#### Scenario: API request failure
- **WHEN** API request fails
- **THEN** system throws APIError with HTTP status code and response body
- **AND** error includes request method and URL
- **AND** error includes retry information

#### Scenario: File validation failure
- **WHEN** resource file validation fails
- **THEN** system throws ValidationError with validation details
- **AND** error includes file path and expected format
- **AND** error includes specific validation failure reason

#### Scenario: Filesystem operation failure
- **WHEN** filesystem operation fails
- **THEN** system throws FileSystemError with operation type and path
- **AND** error includes system error code (ENOENT, EACCES, etc.)
- **AND** error includes suggested resolution action
