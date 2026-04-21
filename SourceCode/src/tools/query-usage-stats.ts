/**
 * Query Usage Stats Tool
 * 
 * Queries the current user's resource usage statistics from the remote API.
 * Returns aggregated usage data including user info and resource usage list.
 */

import { apiClient } from '../api/client';
import { logger, logToolStep } from '../utils/logger';
import { ToolResult } from '../types/tools';

export interface QueryUsageStatsParams {
  resource_type?: 'command' | 'skill' | 'rule' | 'mcp' | 'all';
  start_date?: string; // yyyy-MM-dd format
  end_date?: string;   // yyyy-MM-dd format
  user_token?: string; // Auto-injected by MCP server
}

export interface UsageStatsResource {
  resource_id: string;
  resource_name: string;
  resource_type: string;
  invocation_count: number;
}

export interface UsageStatsResult {
  user_id: number;
  user_name: string;
  user_email: string;
  total_invocations: number;
  resource_usage: UsageStatsResource[];
}

/**
 * Query current user's resource usage statistics.
 * 
 * Calls GET /csp/api/mcp-telemetry/my-usage with optional filters.
 * User identity is automatically derived from the Authorization token.
 * 
 * @param params Query parameters and user token
 * @returns Tool result with usage statistics or error
 */
export async function queryUsageStats(params: unknown): Promise<ToolResult<UsageStatsResult>> {
  const p = params as QueryUsageStatsParams;
  const userToken = p.user_token ?? '';

  logToolStep('query_usage_stats', 'Starting usage stats query', {
    resource_type: p.resource_type ?? 'all',
    start_date: p.start_date,
    end_date: p.end_date,
    has_token: !!userToken,
  });

  // Validate user token
  if (!userToken) {
    logger.error({ tool: 'query_usage_stats' }, 'User token is missing');
    return {
      success: false,
      error: {
        code: 'MISSING_TOKEN',
        message: 'User token is required to query usage statistics',
      },
    };
  }

  try {
    // Build API request parameters
    const apiParams: {
      resource_type?: string;
      start_date?: string;
      end_date?: string;
    } = {};

    if (p.resource_type && p.resource_type !== 'all') {
      apiParams.resource_type = p.resource_type;
    }

    if (p.start_date) {
      apiParams.start_date = p.start_date;
    }

    if (p.end_date) {
      apiParams.end_date = p.end_date;
    }

    logToolStep('query_usage_stats', 'Calling remote API', {
      endpoint: '/csp/api/mcp-telemetry/my-usage',
      params: apiParams,
    });

    // Call remote API
    const response = await apiClient.getMyUsageStats(apiParams, userToken);

    // Validate response structure
    if (response.code !== 2000) {
      logger.error(
        {
          tool: 'query_usage_stats',
          response_code: response.code,
          response_result: response.result,
        },
        'API returned non-success code'
      );

      return {
        success: false,
        error: {
          code: 'API_ERROR',
          message: response.result || 'Unknown API error',
        },
      };
    }

    logToolStep('query_usage_stats', 'Successfully retrieved usage stats', {
      user_id: response.data.user_id,
      total_invocations: response.data.total_invocations,
      resource_count: response.data.resource_usage.length,
    });

    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    logger.error(
      {
        tool: 'query_usage_stats',
        error: error instanceof Error ? error.message : String(error),
        params: {
          resource_type: p.resource_type,
          start_date: p.start_date,
          end_date: p.end_date,
        },
      },
      'Failed to query usage statistics'
    );

    return {
      success: false,
      error: {
        code: 'QUERY_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// Tool descriptor for MCP registration
export const queryUsageStatsTool = {
  name: 'query_usage_stats',
  description: `
Query current user's AI resource usage statistics.

Returns aggregated usage data from the remote API, including:
- User information (ID, name, email)
- Total invocation count across all resources
- Per-resource usage details (sorted by invocation count, descending)

Supports optional filtering by:
- resource_type: Filter by 'command', 'skill', 'rule', or 'mcp' (default: all types)
- start_date: Filter events from this date onward (yyyy-MM-dd format)
- end_date: Filter events up to this date (yyyy-MM-dd format)

User identity is automatically derived from the Authorization token.

Example usage:
- Query all resources: query_usage_stats({})
- Query skills only: query_usage_stats({ resource_type: 'skill' })
- Query March 2026: query_usage_stats({ start_date: '2026-03-01', end_date: '2026-03-31' })
  `.trim(),
  inputSchema: {
    type: 'object' as const,
    properties: {
      resource_type: {
        type: 'string',
        enum: ['command', 'skill', 'rule', 'mcp', 'all'],
        description: 'Filter by resource type (default: all)',
      },
      start_date: {
        type: 'string',
        description: 'Start date for filtering (yyyy-MM-dd format, e.g., 2026-03-01)',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      },
      end_date: {
        type: 'string',
        description: 'End date for filtering (yyyy-MM-dd format, e.g., 2026-03-31)',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      },
      user_token: {
        type: 'string',
        description: 'User authentication token (auto-injected by MCP server)',
      },
    },
    required: [],
  },
  handler: queryUsageStats,
};
