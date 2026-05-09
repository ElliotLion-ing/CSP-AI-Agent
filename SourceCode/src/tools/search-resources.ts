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
import { SearchCoordinator } from '../search';
import { promptManager } from '../prompts/index.js';
import { config } from '../config/index.js';
import type { AgentProfile } from '../client-adapters/index.js';

// Search coordinator singleton
const searchCoordinator = new SearchCoordinator();

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

    // ✅ MCP Server-side enhanced search (Tier 1 + Tier 2)
    logger.debug({ apiResultCount: searchResults.results.length }, 'Applying MCP-side search enhancement...');
    
    const enhancedResults = searchCoordinator.enhancedSearch(
      typedParams.keyword || '',
      searchResults.results,
      20 // maxResults
    );

    logger.info(
      { 
        apiResults: searchResults.results.length,
        enhancedResults: enhancedResults.length,
        topScore: enhancedResults[0]?.score
      },
      'Search enhancement applied'
    );

    // Build a local subscription set from registered prompts for the current user.
    // The server-side is_subscribed flag may be stale (token mismatch, cache, etc.)
    // so we override it with the authoritative local promptManager state.
    const userToken = typedParams.user_token ?? '';
    const localSubscribedNames = new Set<string>(
      promptManager.promptNames(userToken).map((promptName) => {
        // Prompt names are "<type>/<resource_name>" where resource_name is already
        // lowercased with spaces replaced by '-' (see buildPromptName).
        // Extract just the resource_name portion for comparison against search results.
        const slashIdx = promptName.indexOf('/');
        return slashIdx >= 0 ? promptName.slice(slashIdx + 1) : promptName;
      }),
    );

    // Normalize API resource names the same way buildPromptName does so the
    // comparison is case/whitespace insensitive.
    const normalizeResourceName = (name: string) => name.toLowerCase().replace(/\s+/g, '-');

    // Resolve agent profile for is_installed check strategy.
    const resolvedSearchProfile: AgentProfile =
      (typedParams.agent_profile as AgentProfile | undefined) ?? config.agentProfile ?? 'cursor';

    // Check subscription and installation status for each result
    const finalResults = await Promise.all(
      enhancedResults.map(async (resource) => {
        // Check if installed locally.
        //
        // Cursor: check the local filesystem path (server-side filesystem matches
        //   the user's machine when running as a local stdio MCP).
        //
        // Codex: complex skills are stored in ~/.csp-ai-agent/codex/skills/ on the
        //   USER's machine, which is inaccessible when the MCP server runs remotely.
        //   Use prompt registry membership as a proxy: if the resource is subscribed
        //   and its prompt is registered in-memory, treat it as installed.
        //   This avoids a false-always-false signal that would confuse Codex agents.
        let isInstalled = false;
        if (resolvedSearchProfile === 'codex') {
          // For Codex: installed ≡ subscribed prompt is registered in memory.
          isInstalled = localSubscribedNames.has(normalizeResourceName(resource.name));
        } else {
          try {
            const resourcePath = getCursorResourcePath(resource.type, resource.name);
            isInstalled = await filesystemManager.fileExists(resourcePath);
          } catch {
            // Unknown type or path check failed — treat as not installed
            isInstalled = false;
          }
        }

        // Override is_subscribed with the local promptManager state.
        // Local state is authoritative: if the prompt is registered in-memory,
        // the resource is definitely subscribed regardless of the API response.
        const locallySubscribed = localSubscribedNames.has(normalizeResourceName(resource.name));
        const isSubscribed = locallySubscribed || Boolean(resource.is_subscribed);

        if (locallySubscribed && !resource.is_subscribed) {
          logger.debug(
            { resourceName: resource.name, normalizedName: normalizeResourceName(resource.name), apiIsSubscribed: resource.is_subscribed },
            'search_resources: overriding is_subscribed=false from API with local promptManager state (true)',
          );
        }

        return {
          ...resource,
          is_subscribed: isSubscribed,
          is_installed: isInstalled,
        };
      })
    );

    // Build final result
    const result: SearchResourcesResult = {
      total: finalResults.length,
      results: finalResults,
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
      agent_profile: {
        type: 'string',
        description:
          'AI client profile: "cursor" (default) or "codex". ' +
          'Affects is_installed detection strategy: Cursor checks local filesystem paths; ' +
          'Codex uses prompt-registry membership (remote MCP cannot access user filesystem).',
        enum: ['cursor', 'codex'],
      },
      user_token: {
        type: 'string',
        description:
          'DO NOT set this field — it is automatically injected by the MCP server from ' +
          'the authenticated SSE connection. The server always provides the correct token.',
      },
    },
    required: ['keyword'],
  },
  handler: searchResources,
};
