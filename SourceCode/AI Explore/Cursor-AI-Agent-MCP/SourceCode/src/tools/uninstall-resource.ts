/**
 * uninstall_resource Tool
 * Uninstall a resource from local filesystem and clean up related configuration.
 *
 * For MCP resources this also removes the mcpServers entry from ~/.cursor/mcp.json.
 * For directory-based resources (skill, mcp) the entire install directory is removed.
 */

import { logger, logToolCall } from '../utils/logger';
import { apiClient } from '../api/client';
import { getCursorTypeDirForClient, getCursorRootDirForClient, getCspAgentDirForClient } from '../utils/cursor-paths.js';
import { MCPServerError, createValidationError } from '../types/errors';
import type { UninstallResourceParams, UninstallResourceResult, LocalAction, ToolResult } from '../types/tools';
import { promptManager } from '../prompts/index.js';


export async function uninstallResource(params: unknown): Promise<ToolResult<UninstallResourceResult>> {
  const startTime = Date.now();
  const typedParams = params as UninstallResourceParams;

  logger.info({ tool: 'uninstall_resource', params }, 'uninstall_resource called');

  try {
    const pattern = typedParams.resource_id_or_name;
    const removeFromAccount = typedParams.remove_from_account || false;

    const removedResources: Array<{ id: string; name: string; path: string }> = [];
    const localActions: LocalAction[] = [];
    let subscriptionRemoved = false;

    // ── Command / Skill: unregister MCP Prompt + delete cache ─────────────
    // Match registered prompt names that contain the pattern.
    const matchedPromptNames = promptManager.promptNames(typedParams.user_token ?? '').filter(
      (name) => name === pattern || name.includes(pattern),
    );

    if (matchedPromptNames.length > 0) {
      for (const promptName of matchedPromptNames) {
        // Prompt name format: <team>/<type>/<resource_name>
        const parts = promptName.split('/');
        const team         = parts[0] ?? 'general';
        const resourceType = parts[1] as 'command' | 'skill' | undefined;
        const resourceName = parts.slice(2).join('/') || promptName;

        // Find the resource_id from the registered prompt (best-effort via name).
        // For unsubscription, we pass the promptName as id if no better source.
        const resourceId = pattern.startsWith('cmd-') || pattern.startsWith('skill-')
          ? pattern
          : promptName;

        // Unregister from the in-memory prompt registry only.
        // The server-side .prompt-cache/ files are intentionally NOT deleted here —
        // they are shared across all users and will be regenerated on the next git pull.
        promptManager.unregisterPrompt(resourceId, resourceType ?? 'command', resourceName, typedParams.user_token ?? '');

        removedResources.push({ id: resourceId, name: resourceName, path: `[MCP Prompt: ${promptName}]` });
        logger.info({ promptName, team, resourceType, resourceName }, 'MCP Prompt unregistered via uninstall');
      }

      // ── HYBRID SYNC: Check for local script files and delete them ───────────
      // For complex skills that have local scripts downloaded via sync_resources,
      // we need to clean up:
      // 1. Script directory: {CSP_AGENT_ROOT}/skills/<name>/ (sibling of .cursor)
      // 2. Manifest file: {CSP_AGENT_ROOT}/.manifests/<name>.md
      const skillDir = `${getCspAgentDirForClient('skills')}/${pattern}`;
      const manifestFile = `${getCspAgentDirForClient('.manifests')}/${pattern}.md`;
      
      localActions.push({
        action: 'delete_file',
        path: skillDir,
        recursive: true,
      });
      localActions.push({
        action: 'delete_file',
        path: manifestFile,
        recursive: false,
      });
      
      logger.info(
        { pattern, skillDir, manifestFile },
        'Queued local skill directory and manifest deletion (will be skipped if files do not exist)'
      );

      // Remove from server subscription if requested
      if (removeFromAccount) {
        for (const r of removedResources) {
          try {
            await apiClient.unsubscribe(r.id, typedParams.user_token);
            subscriptionRemoved = true;
          } catch (err) {
            logger.warn({ resourceId: r.id, err }, 'Failed to unsubscribe Command/Skill Prompt from account');
          }
        }
      }

      // Return with local_actions_required for directory cleanup
      const result: UninstallResourceResult = {
        success: true,
        removed_resources: removedResources,
        subscription_removed: subscriptionRemoved,
        message: [
          `Successfully unregistered ${removedResources.length} MCP Prompt${removedResources.length > 1 ? 's' : ''}.`,
          'Local skill directory cleanup action queued (execute local_actions_required).',
          subscriptionRemoved ? 'Subscription removed from account.' : null,
        ].filter(Boolean).join(' '),
        local_actions_required: localActions.length > 0 ? localActions : undefined,
      };
      const duration = Date.now() - startTime;
      logToolCall('uninstall_resource', 'user-id', params as Record<string, unknown>, duration);
      return { success: true, data: result };
    }

    // ── Rule / MCP: return LocalAction instructions for the AI to execute ────
    // The MCP server may be running remotely; we must NOT touch the server's
    // own filesystem.  Instead we return delete/remove instructions so the AI
    // Agent performs them on the user's LOCAL machine.
    logger.debug({ pattern, resourceType: typedParams.resource_type }, 'Building local uninstall actions for Rule/MCP resource...');

    // Use client-side tilde-based paths; the MCP server may be running remotely
    // and its os.homedir() would resolve to the server's home, not the user's.
    const mcpJsonPath = `${getCursorRootDirForClient()}/mcp.json`;

    // When resource_type is provided, only emit the relevant actions.
    // When unknown, emit both (AI skips missing files gracefully).
    const knownType = typedParams.resource_type;
    const isRule = !knownType || knownType === 'rule';
    const isMcp  = !knownType || knownType === 'mcp';

    if (isRule) {
      // Rule: delete ~/.cursor/rules/<pattern>.mdc and .md variants.
      const rulesDir = getCursorTypeDirForClient('rule');
      for (const ext of ['.mdc', '.md']) {
        const filePath = `${rulesDir}/${pattern}${ext}`;
        localActions.push({ action: 'delete_file', path: filePath });
        removedResources.push({ id: pattern, name: pattern, path: filePath });
      }
    }

    if (isMcp) {
      // MCP: delete install directory (Format A — may not exist for remote-URL MCPs)
      // and remove the mcpServers entry from mcp.json.
      const mcpDir = getCursorTypeDirForClient('mcp');
      const mcpInstallDir = `${mcpDir}/${pattern}`;
      localActions.push({ action: 'delete_file', path: mcpInstallDir, recursive: true });
      localActions.push({ action: 'remove_mcp_json_entry', mcp_json_path: mcpJsonPath, server_name: pattern });
      removedResources.push({ id: pattern, name: pattern, path: mcpInstallDir });
    }

    if (removedResources.length === 0 && localActions.length === 0) {
      throw createValidationError(
        pattern,
        'resource_id_or_name',
        'No installed Rule or MCP resources found matching pattern. Use search_resources to find available resources'
      );
    }

    // Remove from server subscription if requested
    if (removeFromAccount) {
      try {
        await apiClient.unsubscribe(pattern);
        subscriptionRemoved = true;
      } catch (err) {
        logger.warn({ pattern, err }, 'Failed to unsubscribe resource from account');
      }
    }

    const result: UninstallResourceResult = {
      success: true,
      removed_resources: removedResources,
      subscription_removed: subscriptionRemoved,
      message: [
        `Prepared ${localActions.length} local uninstall action(s) for ${removedResources.length} resource(s).`,
        'Execute every action in local_actions_required on the user\'s local machine.',
        subscriptionRemoved ? 'Subscription removed from account.' : null,
      ].filter(Boolean).join(' '),
      local_actions_required: localActions,
    };

    const duration = Date.now() - startTime;
    logToolCall('uninstall_resource', 'user-id', params as Record<string, unknown>, duration);
    logger.info({ pattern, actionCount: localActions.length, subscriptionRemoved, duration }, 'uninstall_resource completed');

    return { success: true, data: result };

  } catch (error) {
    logger.error({ error, pattern: typedParams.resource_id_or_name }, 'uninstall_resource failed');
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
export const uninstallResourceTool = {
  name: 'uninstall_resource',
  description:
    'Uninstall a resource from the user\'s local machine. ' +
    'Command/Skill resources: unregisters MCP Prompt from memory and queues local script directory deletion. ' +
    'Rule/MCP resources: returns `local_actions_required` with delete_file and remove_mcp_json_entry actions. ' +
    'For delete_file actions: delete the file or directory at the given path (recursive if flag set). ' +
    'For remove_mcp_json_entry actions: read ~/.cursor/mcp.json, delete the matching ' +
    'mcpServers key, then write the file back. ' +
    'Set remove_from_account: true to also cancel the server-side subscription. ' +
    'The AI Agent MUST execute all local_actions_required on the USER\'S LOCAL MACHINE.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      resource_id_or_name: {
        type: 'string',
        description: 'Resource ID, name, or pattern (supports fuzzy matching)',
      },
      remove_from_account: {
        type: 'boolean',
        description: 'Also remove from subscription list (default: false)',
        default: false,
      },
    },
    required: ['resource_id_or_name'],
  },
  handler: uninstallResource,
};
