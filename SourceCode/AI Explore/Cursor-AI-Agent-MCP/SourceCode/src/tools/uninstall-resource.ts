/**
 * uninstall_resource Tool
 * Uninstall a resource from local filesystem and clean up related configuration.
 *
 * For MCP resources this also removes the mcpServers entry from ~/.cursor/mcp.json.
 * For directory-based resources (skill, mcp) the entire install directory is removed.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger, logToolCall } from '../utils/logger';
import { filesystemManager } from '../filesystem/manager';
import { apiClient } from '../api/client';
import { getCursorTypeDir, getCursorRootDir } from '../utils/cursor-paths.js';
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
    let subscriptionRemoved = false;

    // ── Command / Skill: unregister MCP Prompt + delete cache ─────────────
    // Match registered prompt names that contain the pattern.
    const matchedPromptNames = promptManager.promptNames().filter(
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
        promptManager.unregisterPrompt(resourceId, resourceType ?? 'command', resourceName);

        removedResources.push({ id: resourceId, name: resourceName, path: `[MCP Prompt: ${promptName}]` });
        logger.info({ promptName, team, resourceType, resourceName }, 'MCP Prompt unregistered via uninstall');
      }

      // Remove from server subscription if requested
      if (removeFromAccount) {
        for (const r of removedResources) {
          try {
            await apiClient.unsubscribe(r.id);
            subscriptionRemoved = true;
          } catch (err) {
            logger.warn({ resourceId: r.id, err }, 'Failed to unsubscribe Command/Skill Prompt from account');
          }
        }
      }

      // Return early — Command/Skill resources have no local filesystem footprint.
      const result: UninstallResourceResult = {
        success: true,
        removed_resources: removedResources,
        subscription_removed: subscriptionRemoved,
        message: [
          `Successfully unregistered ${removedResources.length} MCP Prompt${removedResources.length > 1 ? 's' : ''}.`,
          subscriptionRemoved ? 'Subscription removed from account.' : null,
        ].filter(Boolean).join(' '),
      };
      const duration = Date.now() - startTime;
      logToolCall('uninstall_resource', 'user-id', params as Record<string, unknown>, duration);
      return { success: true, data: result };
    }

    // ── Rule / MCP: return LocalAction instructions for the AI to execute ────
    // The MCP server may be running remotely; we must NOT touch the server's
    // own filesystem.  Instead we return delete/remove instructions so the AI
    // Agent performs them on the user's LOCAL machine.
    logger.debug({ pattern }, 'Building local uninstall actions for Rule/MCP resource...');

    const localActions: LocalAction[] = [];
    const mcpJsonPath = path.join(getCursorRootDir(), 'mcp.json');

    // Rule: delete matching .md/.mdc files from ~/.cursor/rules/
    try {
      const rulesDir = getCursorTypeDir('rule');
      const ruleFiles = await filesystemManager.listFiles(rulesDir, /\.(md|mdc)$/);
      for (const relName of ruleFiles) {
        const baseName = path.basename(relName).replace(/\.(md|mdc)$/, '');
        if (baseName === pattern || baseName.includes(pattern) || relName.includes(pattern)) {
          const absPath = path.join(rulesDir, relName);
          localActions.push({ action: 'delete_file', path: absPath });
          removedResources.push({ id: baseName, name: baseName, path: absPath });
        }
      }
    } catch { /* rules dir may not exist */ }

    // MCP: delete install directory + remove mcp.json entry
    try {
      const mcpDir = getCursorTypeDir('mcp');
      const entries = await fs.readdir(mcpDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === pattern || entry.name.includes(pattern)) {
          const dirPath = path.join(mcpDir, entry.name);
          localActions.push({ action: 'delete_file', path: dirPath, recursive: true });
          localActions.push({ action: 'remove_mcp_json_entry', mcp_json_path: mcpJsonPath, server_name: entry.name });
          removedResources.push({ id: entry.name, name: entry.name, path: dirPath });
        }
      }
    } catch { /* mcp-servers dir may not exist */ }

    // Also check Remote-URL MCPs whose entry is only in mcp.json (no local dir).
    // The pattern might match a server name in mcp.json directly.
    if (localActions.filter(a => a.action === 'remove_mcp_json_entry').length === 0) {
      // Add a conditional remove action — the AI will check if the key exists.
      localActions.push({
        action: 'remove_mcp_json_entry',
        mcp_json_path: mcpJsonPath,
        server_name: pattern,
      });
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
    'Uninstall a Rule or MCP resource from the user\'s local machine. ' +
    'Returns `local_actions_required` — an ordered list of delete_file and ' +
    'remove_mcp_json_entry actions that the AI Agent MUST execute on the USER\'S LOCAL MACHINE. ' +
    'For delete_file actions: delete the file or directory at the given path. ' +
    'For remove_mcp_json_entry actions: read ~/.cursor/mcp.json, delete the matching ' +
    'mcpServers key, then write the file back. ' +
    'Command and Skill resources are handled by unregistering their MCP Prompt (no local files). ' +
    'Set remove_from_account: true to also cancel the server-side subscription.',
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
