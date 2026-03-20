/**
 * search_resources Tool
 * Search for available resources
 */

import { logger, logToolCall } from '../utils/logger';
import { apiClient } from '../api/client';
import { filesystemManager } from '../filesystem/manager';
import { getCursorResourcePath } from '../utils/cursor-paths.js';
import { MCPServerError } from '../types/errors';
import type { SearchResourcesParams, SearchResourcesResult, ToolResult } from '../types/tools';

// Simple in-memory cache
const searchCache = new Map<string, { results: SearchResourcesResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generate cache key from search parameters
 */
function getCacheKey(params: SearchResourcesParams): string {
  return JSON.stringify({
    team: params.team || '',
    type: params.type || '',
    keyword: params.keyword || '',
  });
}

/**
 * Get cached search results if available and not expired
 */
function getCachedResults(cacheKey: string): SearchResourcesResult | null {
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug({ cacheKey }, 'Search cache hit');
    return cached.results;
  }
  
  if (cached) {
    // Remove expired cache entry
    searchCache.delete(cacheKey);
    logger.debug({ cacheKey }, 'Search cache expired, removed');
  }
  
  return null;
}

/**
 * Cache search results
 */
function cacheResults(cacheKey: string, results: SearchResourcesResult): void {
  searchCache.set(cacheKey, {
    results,
    timestamp: Date.now(),
  });
  logger.debug({ cacheKey, total: results.total }, 'Search results cached');
}

export async function searchResources(params: unknown): Promise<ToolResult<SearchResourcesResult>> {
  const startTime = Date.now();

  // Type assertion for params
  const typedParams = params as SearchResourcesParams;

  logger.info({ tool: 'search_resources', params }, 'search_resources called');

  try {
    // Generate cache key
    const cacheKey = getCacheKey(typedParams);

    // Check cache first
    const cachedResult = getCachedResults(cacheKey);
    if (cachedResult) {
      const duration = Date.now() - startTime;
      logToolCall('search_resources', 'user-id', params as Record<string, unknown>, duration);
      
      logger.info({ total: cachedResult.total, duration, cached: true }, 'search_resources completed (cache hit)');
      
      return {
        success: true,
        data: cachedResult,
      };
    }

    // Search via API
    logger.debug({ team: typedParams.team, type: typedParams.type, keyword: typedParams.keyword }, 'Searching resources...');
    
    const searchResults = await apiClient.searchResources(
      {
        team: typedParams.team,
        type: typedParams.type,
        keyword: typedParams.keyword,
      },
      typedParams.user_token
    );

    // Check subscription and installation status for each result
    const enhancedResults = await Promise.all(
      searchResults.results.map(async (resource) => {
        // Check if installed locally in the Cursor directory for this resource type
        let isInstalled = false;
        try {
          const resourcePath = getCursorResourcePath(resource.type, resource.name);
          isInstalled = await filesystemManager.fileExists(resourcePath);
        } catch {
          // Unknown type or path check failed — treat as not installed
          isInstalled = false;
        }

        return {
          ...resource,
          is_installed: isInstalled,
        };
      })
    );

    // Build final result
    const result: SearchResourcesResult = {
      total: searchResults.total,
      results: enhancedResults,
    };

    // Cache the results
    cacheResults(cacheKey, result);

    const duration = Date.now() - startTime;
    logToolCall('search_resources', 'user-id', params as Record<string, unknown>, duration);

    logger.info(
      {
        team: typedParams.team,
        type: typedParams.type,
        keyword: typedParams.keyword,
        total: result.total,
        duration,
        cached: false,
      },
      'search_resources completed successfully'
    );

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    logger.error({ error, tool: 'search_resources', errorStack: error instanceof Error ? error.stack : undefined }, 'search_resources failed');
    return {
      success: false,
      error: {
        code: error instanceof MCPServerError ? error.code : 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// Tool definition for registry
export const searchResourcesTool = {
  name: 'search_resources',
  description: 'Search for available resources by team, type, or keyword',
  inputSchema: {
    type: 'object' as const,
    properties: {
      team: {
        type: 'string',
        description: 'Filter by team (empty = all teams)',
      },
      type: {
        type: 'string',
        description: 'Filter by resource type',
        enum: ['command', 'skill', 'rule', 'mcp', ''],
      },
      keyword: {
        type: 'string',
        description: 'Search keyword (searches in name, description, tags)',
      },
      user_token: {
        type: 'string',
        description:
          'CSP API token for the current user. Read this from the CSP_API_TOKEN environment ' +
          'variable configured in the user\'s mcp.json. When provided, this token is used ' +
          'for all CSP API calls in this request instead of the server-level fallback token.',
      },
    },
    required: ['keyword'],
  },
  handler: searchResources,
};
