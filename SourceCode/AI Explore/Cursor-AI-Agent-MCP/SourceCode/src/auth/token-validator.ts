/**
 * Token Validation via CSP API
 * Validates tokens by calling CSP /user/permissions endpoint
 */

import { apiClient } from '../api/client';
import { logger, logError, logAuthAttempt } from '../utils/logger';

/**
 * Token validation payload structure
 */
export interface TokenPayload {
  userId: string;
  email: string;
  groups: string[];  // Changed from 'roles' to 'groups' to match API response
  // Additional fields for compatibility
  roles?: string[];  // Alias for groups
  [key: string]: unknown;
}

/**
 * CSP API response for /user/permissions
 */
interface PermissionsResponse {
  code: number;
  data?: {
    user_id: string;
    email: string;
    groups: string[];
  };
  message?: string;
}

/**
 * Token validation cache (in-memory, 5 minute TTL)
 */
const tokenCache = new Map<string, { payload: TokenPayload; expireAt: number }>();

/**
 * Cache cleanup interval reference (for cleanup on shutdown)
 */
let cacheCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Clean expired cache entries
 */
function cleanExpiredCache(): void {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [token, entry] of tokenCache.entries()) {
    if (entry.expireAt < now) {
      tokenCache.delete(token);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug(
      { type: 'cache_cleanup', cleaned, remaining: tokenCache.size },
      `Cleaned ${cleaned} expired token(s) from cache`
    );
  }
}

/**
 * Start cache cleanup interval
 */
export function startCacheCleanup(): void {
  if (cacheCleanupInterval) {
    logger.warn('Cache cleanup interval already running');
    return;
  }
  
  // Clean cache every minute
  cacheCleanupInterval = setInterval(cleanExpiredCache, 60000);
  logger.info('Token cache cleanup interval started (60s)');
}

/**
 * Stop cache cleanup interval
 */
export function stopCacheCleanup(): void {
  if (cacheCleanupInterval) {
    clearInterval(cacheCleanupInterval);
    cacheCleanupInterval = null;
    logger.info('Token cache cleanup interval stopped');
  }
}

// Start cleanup on module load
startCacheCleanup();

/**
 * Verify token by calling CSP API /user/permissions
 * @param token - The JWT token to verify
 * @returns Token payload if valid, null otherwise
 */
export async function verifyTokenViaAPI(token: string): Promise<TokenPayload | null> {
  const tokenPreview = token.substring(0, 10) + '...' + token.substring(token.length - 10);
  const startTime = Date.now();
  
  try {
    logger.debug(
      { 
        type: 'auth', 
        operation: 'verify_token_api',
        tokenPreview,
        timestamp: new Date().toISOString()
      },
      'Calling CSP API /user/permissions to validate token'
    );

    // Call CSP API to validate token and get permissions
    // Note: apiClient already adds Authorization header with CSP_API_TOKEN
    // But for SSE connection, we might use a different token from the client
    const response = await apiClient.get<PermissionsResponse>(
      '/csp/api/user/permissions',
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        timeout: 5000, // 5 second timeout for auth check
      }
    );

    const duration = Date.now() - startTime;

    // Check response code (2000 means success)
    if (response.code === 2000 && response.data) {
      const payload: TokenPayload = {
        userId: response.data.user_id,
        email: response.data.email,
        groups: response.data.groups || [],
        roles: response.data.groups || [],  // Alias for backward compatibility
      };

      logger.info(
        { 
          type: 'auth', 
          operation: 'verify_token_api',
          userId: payload.userId,
          email: payload.email,
          groups: payload.groups,
          duration,
          timestamp: new Date().toISOString()
        },
        `Token validated successfully for user ${payload.userId}`
      );

      logAuthAttempt('token_validation', true, {
        userId: payload.userId,
        email: payload.email,
        groups: payload.groups,
        duration
      });

      return payload;
    }

    logger.warn(
      { 
        type: 'auth', 
        operation: 'verify_token_api', 
        code: response.code,
        message: response.message,
        tokenPreview,
        duration,
        timestamp: new Date().toISOString()
      },
      'Token validation failed - invalid or expired token'
    );
    
    logAuthAttempt('token_validation', false, {
      code: response.code,
      message: response.message,
      duration
    });
    
    return null;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logError(error as Error, {
      type: 'auth',
      operation: 'verify_token_api',
      tokenPreview,
      duration,
      timestamp: new Date().toISOString()
    });
    
    logAuthAttempt('token_validation', false, {
      error: error instanceof Error ? error.message : String(error),
      duration
    });
    
    return null;
  }
}

/**
 * Verify token with caching
 * Uses cached result if available to reduce API calls
 * @param token - The token to verify
 * @returns Token payload if valid, null otherwise
 */
export async function verifyToken(token: string): Promise<TokenPayload | null> {
  const tokenPreview = token.substring(0, 10) + '...' + token.substring(token.length - 10);
  
  // Check cache first
  const cached = tokenCache.get(token);
  if (cached && cached.expireAt > Date.now()) {
    logger.debug(
      { 
        type: 'auth', 
        operation: 'verify_token', 
        userId: cached.payload.userId,
        email: cached.payload.email,
        cacheHit: true,
        tokenPreview,
        timestamp: new Date().toISOString()
      },
      'Token validation cache hit'
    );
    return cached.payload;
  }

  logger.debug(
    {
      type: 'auth',
      operation: 'verify_token',
      cacheHit: false,
      tokenPreview,
      timestamp: new Date().toISOString()
    },
    'Token validation cache miss, calling API'
  );

  // Validate via API
  const payload = await verifyTokenViaAPI(token);

  // Cache the result if valid (5 minute TTL)
  if (payload) {
    const expireAt = Date.now() + 5 * 60 * 1000; // 5 minutes
    tokenCache.set(token, { payload, expireAt });
    logger.debug(
      { 
        type: 'auth', 
        operation: 'verify_token', 
        userId: payload.userId,
        email: payload.email,
        cacheTTL: '5min',
        timestamp: new Date().toISOString()
      },
      'Token validation result cached (5 min TTL)'
    );
  }

  return payload;
}

/**
 * Clear token from cache (e.g., after logout)
 * @param token - The token to invalidate
 */
export function invalidateToken(token: string): void {
  tokenCache.delete(token);
  logger.debug(
    { type: 'auth', operation: 'invalidate_token' },
    'Token removed from cache'
  );
}

/**
 * Clear all cached tokens
 */
export function clearTokenCache(): void {
  tokenCache.clear();
  logger.info(
    { type: 'auth', operation: 'clear_cache' },
    'All cached tokens cleared'
  );
}

/**
 * Get cache statistics
 */
export function getTokenCacheStats() {
  cleanExpiredCache();
  return {
    size: tokenCache.size,
    tokens: Array.from(tokenCache.keys()).map(t => t.substring(0, 10) + '...'),
  };
}
