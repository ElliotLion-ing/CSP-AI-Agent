/**
 * MCP Tool Types
 */

import type { MCPToolSchema } from './mcp';

// ── LocalAction ────────────────────────────────────────────────────────────
//
// When the MCP server is deployed remotely it cannot write to the user's local
// filesystem.  Instead it returns a list of LocalAction instructions that the
// AI Agent (running inside the user's local Cursor) must execute.
//
// Action types:
//   write_file          – create or overwrite a local file
//   delete_file         – delete a local file or directory
//   merge_mcp_json      – merge an MCP server entry into ~/.cursor/mcp.json
//   remove_mcp_json_entry – remove an MCP server entry from ~/.cursor/mcp.json

export interface WriteFileAction {
  action: 'write_file';
  /** Absolute path on the user's local machine (may start with ~). */
  path: string;
  /** File content to write. */
  content: string;
  /** File encoding (default: utf8). Set to base64 for binary files. */
  encoding?: 'utf8' | 'base64';
  /** File permissions in octal string format (e.g. "0755" for executable, "0644" for regular). Unix only. */
  mode?: string;
  /** 
   * Special marker for the FIRST script file in complex skills.
   * When true, client should perform atomic skill-level incremental check:
   * 1. Read manifest file at {CSP_AGENT_ROOT}/.manifests/<skill-name>.md (if exists)
   *    Where {CSP_AGENT_ROOT} is a SIBLING of {CURSOR_ROOT} (same parent directory).
   *    
   *    Platform resolution:
   *      Windows: Find .cursor first (C:\Users\<Username>\.cursor or AppData\Cursor\User),
   *               then create .csp-ai-agent in same parent directory.
   *               Example: If .cursor at C:\Users\Elliot.Ding\.cursor
   *                        → .csp-ai-agent = C:\Users\Elliot.Ding\.csp-ai-agent
   *      
   *      macOS:   /Users/<user>/.csp-ai-agent (sibling of /Users/<user>/.cursor)
   *      Linux:   /home/<user>/.csp-ai-agent (sibling of /home/<user>/.cursor)
   * 
   * 2. Compare manifest content with skill_manifest_content field (string equality)
   * 3. If identical: skip this action AND all subsequent write_file actions for this skill
   * 4. If different or manifest missing: 
   *    - Execute this action and all subsequent write_file actions
   *    - Write skill_manifest_content to {CSP_AGENT_ROOT}/.manifests/<skill-name>.md
   * 
   * This enables atomic skill updates while keeping SKILL.md out of the skills directory
   * (preventing Cursor from auto-discovering it as a standalone skill).
   */
  is_skill_manifest?: boolean;
  /**
   * SKILL.md content for incremental comparison (present when is_skill_manifest=true).
   * This content is NOT written to the path field — it's only used for version checking
   * and stored in the manifest directory.
   */
  skill_manifest_content?: string;
}

export interface DeleteFileAction {
  action: 'delete_file';
  /** Absolute path on the user's local machine (may start with ~). */
  path: string;
  /** When true, recursively delete a directory. */
  recursive?: boolean;
}

export interface MergeMcpJsonAction {
  action: 'merge_mcp_json';
  /** Absolute path to the user's mcp.json file. */
  mcp_json_path: string;
  /** Key under mcpServers to add or update. */
  server_name: string;
  /** The MCP server entry object to merge in. */
  entry: Record<string, unknown>;
  /** env keys that are currently empty and must be filled by the user. */
  missing_env?: string[];
  /** Human-readable hint when manual env configuration is required. */
  setup_hint?: string;
  /** Path to a local setup/readme doc if one exists in the install dir. */
  setup_doc?: string;
  /**
   * When true, the AI MUST skip this action if `mcpServers[server_name]`
   * already exists in mcp.json (regardless of content).
   * Use this for idempotent installs where re-writing would clobber
   * user-customised values (e.g. env vars the user has already filled in).
   */
  skip_if_exists?: boolean;
}

export interface RemoveMcpJsonEntryAction {
  action: 'remove_mcp_json_entry';
  /** Absolute path to the user's mcp.json file. */
  mcp_json_path: string;
  /** Key under mcpServers to remove. */
  server_name: string;
}

export type LocalAction =
  | WriteFileAction
  | DeleteFileAction
  | MergeMcpJsonAction
  | RemoveMcpJsonEntryAction;

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
  /**
   * CSP API token from the user's mcp.json env configuration.
   * Overrides the server-level fallback token so that each user
   * makes API calls with their own identity.
   */
  user_token?: string;
  /**
   * List of MCP server names that are already configured in the user's
   * ~/.cursor/mcp.json. The server will skip downloading and generating
   * write_file actions for these MCP resources to reduce overhead.
   * 
   * Set this to the keys from mcpServers in ~/.cursor/mcp.json:
   * Object.keys(JSON.parse(fs.readFileSync('~/.cursor/mcp.json')).mcpServers || {})
   * 
   * Only applies in 'incremental' mode; 'full' mode always downloads everything.
   */
  configured_mcp_servers?: string[];
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
    /** Number of resources skipped due to no local changes (incremental mode only). */
    skipped: number;
    failed: number;
  };
  details: Array<{
    id: string;
    name: string;
    action: string;
    version: string;
  }>;
  /**
   * List of resource names that were skipped during incremental sync because
   * local files are already up-to-date (hash match). Present only when skipped > 0.
   */
  skipped_resources?: Array<{
    name: string;
    reason: 'already_up_to_date' | 'no_local_sync_needed' | 'mcp_already_configured';
  }>;
  /**
   * MCP servers that were installed/updated but require manual configuration
   * before they can be used. Present only when at least one server needs setup.
   * @deprecated use local_actions_required MergeMcpJsonAction.missing_env instead
   */
  pending_setup?: McpSetupItem[];
  /**
   * Ordered list of file-system and mcp.json operations the AI Agent must
   * execute on the user's LOCAL machine after receiving this response.
   * Present only when at least one Rule or MCP resource was synced.
   *
   * The AI MUST execute every action in order before reporting success to the
   * user.  See LocalAction type variants for details.
   */
  local_actions_required?: LocalAction[];
}

// manage_subscription
export interface ManageSubscriptionParams {
  action: 'subscribe' | 'unsubscribe' | 'list' | 'batch_subscribe' | 'batch_unsubscribe';
  resource_ids?: string[];
  auto_sync?: boolean;
  scope?: 'global' | 'workspace';
  notify?: boolean;
  /** CSP API token from the user's mcp.json env configuration. */
  user_token?: string;
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
  /** CSP API token from the user's mcp.json env configuration. */
  user_token?: string;
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

// resolve_prompt_content
export interface ResolvePromptContentParams {
  prompt_name?: string;
  resource_id?: string;
  /** CSP API token from the user's mcp.json env configuration. */
  user_token?: string;
  /** Optional Jira Issue ID for usage correlation. */
  jira_id?: string;
}

export interface ResolvePromptContentResult {
  prompt_name: string;
  resource_id: string;
  resource_type: 'command' | 'skill';
  resource_name: string;
  description: string;
  content: string;
  content_source: 'cache' | 'generated' | 'raw_fallback';
  usage_tracked: boolean;
}

// upload_resource
export interface FileEntry {
  path: string;    // Relative path under the type subdir (e.g. "my-cmd.md" or "code-review/SKILL.md")
  content: string; // File content string
}

export interface UploadResourceParams {
  resource_id: string;
  /** Resource category. Optional — auto-detected from file structure when omitted. */
  type?: 'command' | 'skill' | 'rule' | 'mcp';
  message: string;
  /** Human-readable resource name sent to the CSP API. Defaults to the primary file name (without extension). */
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
  /** CSP API token from the user's mcp.json env configuration. */
  user_token?: string;
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
  /** When known, the resource type — narrows which local_actions are emitted. */
  resource_type?: 'command' | 'skill' | 'rule' | 'mcp';
  /** CSP API token from the user's mcp.json env configuration. */
  user_token?: string;
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
  /**
   * Ordered list of file-system and mcp.json operations the AI Agent must
   * execute on the user's LOCAL machine after receiving this response.
   * Present only for Rule and local-executable MCP resources.
   */
  local_actions_required?: LocalAction[];
}
