/**
 * Configuration Constants
 */

export const APP_NAME = 'csp-ai-agent-mcp';
export const APP_VERSION = '0.1.0';

export const DEFAULT_PORT = 5090;
export const DEFAULT_LOG_LEVEL = 'info';
export const DEFAULT_API_TIMEOUT = 30000;

export const LOG_RETENTION_DAYS = 3;
export const LOG_DIR = 'logs';
export const LOG_FILE_PATTERN = 'app-{date}.log';

export const CACHE_TTL_SECONDS = 900; // 15 minutes
export const MEMORY_CACHE_SIZE = 20;

export const TOOL_NAMES = {
  SYNC_RESOURCES: 'sync_resources',
  MANAGE_SUBSCRIPTION: 'manage_subscription',
  SEARCH_RESOURCES: 'search_resources',
  UPLOAD_RESOURCE: 'upload_resource',
  UNINSTALL_RESOURCE: 'uninstall_resource',
} as const;

export const TOOL_TIMEOUTS = {
  [TOOL_NAMES.SEARCH_RESOURCES]: 10000, // 10s
  [TOOL_NAMES.SYNC_RESOURCES]: 60000, // 60s
  [TOOL_NAMES.UPLOAD_RESOURCE]: 120000, // 120s
  [TOOL_NAMES.MANAGE_SUBSCRIPTION]: 15000, // 15s
  [TOOL_NAMES.UNINSTALL_RESOURCE]: 5000, // 5s
} as const;
