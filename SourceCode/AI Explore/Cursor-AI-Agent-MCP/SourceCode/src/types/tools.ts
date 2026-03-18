/**
 * MCP Tool Types
 */

import type { MCPToolSchema } from './mcp';

// Tool Handler Function Type (generic, accepts any params and returns any result)
export type ToolHandler = (params: unknown) => Promise<ToolResult>;

// Tool Definition
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: MCPToolSchema;
  handler: ToolHandler;
}

// Tool Result (generic)
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

//===============================================
// Tool-specific Parameter and Result Types
//===============================================

// sync_resources
export interface SyncResourcesParams {
  mode?: 'check' | 'incremental' | 'full';
  scope?: 'global' | 'workspace' | 'all';
  types?: string[];
}

export interface McpSetupItem {
  /** MCP server name as it appears in mcp.json */
  server_name: string;
  /** Human-readable path to mcp.json on this platform */
  mcp_json_path: string;
  /** env keys that are currently empty and need user input */
  missing_env: string[];
  /** true when the registered command might not be correct for this machine */
  command_needs_verification: boolean;
  /** the command string that was registered */
  command: string;
  /** freeform guidance shown to the user */
  setup_hint: string;
  /** absolute path to a local setup/readme doc found in the install directory, if any */
  setup_doc?: string;
}

export interface SyncResourcesResult {
  mode: string;
  health_score: number;
  summary: {
    total: number;
    synced: number;
    cached: number;
    failed: number;
  };
  details: Array<{
    id: string;
    name: string;
    action: string;
    version: string;
  }>;
  /**
   * MCP servers that were installed/updated but require manual configuration
   * before they can be used. Present only when at least one server needs setup.
   */
  pending_setup?: McpSetupItem[];
}

// manage_subscription
export interface ManageSubscriptionParams {
  action: 'subscribe' | 'unsubscribe' | 'list' | 'batch_subscribe' | 'batch_unsubscribe';
  resource_ids?: string[];
  auto_sync?: boolean;
  scope?: 'global' | 'workspace';
  notify?: boolean;
}

export interface ManageSubscriptionResult {
  action: string;
  success: boolean;
  subscriptions?: Array<{
    id: string;
    name: string;
    type: string;
    subscribed_at: string;
  }>;
  message?: string;
  /** Sync results for each resource after auto-sync on subscribe */
  sync_details?: Array<{ id: string; name: string; action: string }>;
  /** MCP servers that need manual configuration after auto-sync */
  pending_setup?: unknown[];
}

// search_resources
export interface SearchResourcesParams {
  team?: string;
  type?: string;
  keyword: string;
}

export interface SearchResourcesResult {
  total: number;
  results: Array<{
    id: string;
    name: string;
    type: string;
    team: string;
    version: string;
    description: string;
    score: number;
    is_subscribed: boolean;
    is_installed: boolean;
  }>;
}

// upload_resource
export interface FileEntry {
  path: string;    // Relative path under the type subdir (e.g. "my-cmd.md" or "code-review/SKILL.md")
  content: string; // File content string
}

export interface UploadResourceParams {
  resource_id: string;
  type: 'command' | 'skill' | 'rule' | 'mcp';
  message: string;
  /** Human-readable resource name sent to the CSP API. Defaults to resource_id. */
  name?: string;
  /** Target source repo from ai-resources-config.json (e.g. "csp", "client-sdk-ai-hub"). Defaults to default_source. */
  target_source?: string;
  team?: string;

  // ---- Three input modes (priority: files > directory > content) ----

  /** File list to upload. Paths are relative to the type subdir of the chosen source. Any file extension allowed. */
  files: FileEntry[];

  // ---- Optional fields ----
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface UploadResourceResult {
  resource_id: string;
  version: string;
  url: string;
  commit_hash: string;
  message: string;
}

// uninstall_resource
export interface UninstallResourceParams {
  resource_id_or_name: string;
  remove_from_account?: boolean;
}

export interface UninstallResourceResult {
  success: boolean;
  removed_resources: Array<{
    id: string;
    name: string;
    path: string;
  }>;
  subscription_removed: boolean;
  message: string;
}
