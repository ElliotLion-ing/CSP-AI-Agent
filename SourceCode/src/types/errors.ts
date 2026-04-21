/**
 * Custom Error Types
 * Typed errors for different failure scenarios
 */

/**
 * Base Error for MCP Server operations
 */
export class MCPServerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Git Operation Error
 */
export class GitError extends MCPServerError {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly repositoryUrl?: string,
    details?: unknown
  ) {
    super(message, 'GIT_ERROR', details);
    
    // Redact credentials from repository URL
    if (this.repositoryUrl) {
      this.repositoryUrl = this.redactCredentials(this.repositoryUrl);
    }
  }

  private redactCredentials(url: string): string {
    return url.replace(/:\/\/([^:]+):([^@]+)@/, '://***:***@');
  }
}

/**
 * API Request Error
 */
export class APIError extends MCPServerError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly method?: string,
    public readonly url?: string,
    public readonly retryCount?: number,
    details?: unknown
  ) {
    super(message, 'API_ERROR', details);
  }
}

/**
 * Resource Validation Error
 */
export class ValidationError extends MCPServerError {
  constructor(
    message: string,
    public readonly filePath?: string,
    public readonly expectedFormat?: string,
    public readonly validationReason?: string,
    details?: unknown
  ) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

/**
 * Filesystem Operation Error
 */
export class FileSystemError extends MCPServerError {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly path?: string,
    public readonly systemErrorCode?: string,
    public readonly suggestedResolution?: string,
    details?: unknown
  ) {
    super(message, 'FILESYSTEM_ERROR', details);
  }
}

/**
 * Error Factory Functions
 */

export function createGitError(
  operation: string,
  error: Error,
  repositoryUrl?: string
): GitError {
  return new GitError(
    `Git ${operation} failed: ${error.message}`,
    operation,
    repositoryUrl,
    { originalError: error }
  );
}

export function createAPIError(
  method: string,
  url: string,
  error: Error,
  statusCode?: number,
  retryCount?: number
): APIError {
  const message = `API ${method} ${url} failed: ${error.message}`;
  return new APIError(message, statusCode, method, url, retryCount, { originalError: error });
}

export function createValidationError(
  filePath: string,
  expectedFormat: string,
  reason: string
): ValidationError {
  return new ValidationError(
    `Resource validation failed: ${reason}`,
    filePath,
    expectedFormat,
    reason
  );
}

export function createFileSystemError(
  operation: string,
  path: string,
  error: Error & { code?: string },
  suggestedResolution?: string
): FileSystemError {
  return new FileSystemError(
    `Filesystem ${operation} failed: ${error.message}`,
    operation,
    path,
    error.code,
    suggestedResolution,
    { originalError: error }
  );
}
