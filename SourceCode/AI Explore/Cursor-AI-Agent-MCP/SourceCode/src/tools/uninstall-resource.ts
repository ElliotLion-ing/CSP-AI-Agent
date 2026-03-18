/**
 * uninstall_resource Tool
 * Uninstall a resource from local filesystem and clean up related configuration.
 *
 * For MCP resources this also removes the mcpServers entry from ~/.cursor/mcp.json.
 * For directory-based resources (skill, mcp) the entire install directory is removed.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { logger, logToolCall } from '../utils/logger';
import { filesystemManager } from '../filesystem/manager';
import { apiClient } from '../api/client';
import { getCursorTypeDir, getCursorRootDir } from '../utils/cursor-paths.js';
import { MCPServerError, createValidationError } from '../types/errors';
import type { UninstallResourceParams, UninstallResourceResult, ToolResult } from '../types/tools';

/** Resource install entry — may be a file or a directory. */
interface InstalledResource {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * Find installed resource files/directories by pattern.
 * - File-based types (rule, command): scan for matching .md/.mdc files
 * - Directory-based types (skill, mcp): scan for matching subdirectories
 */
async function findInstalledResources(pattern: string): Promise<InstalledResource[]> {
  const results: InstalledResource[] = [];

  const FILE_TYPES = ['rule', 'command'] as const;
  const DIR_TYPES  = ['skill', 'mcp']    as const;

  // Scan file-based types
  for (const type of FILE_TYPES) {
    let typePath: string;
    try { typePath = getCursorTypeDir(type); } catch { continue; }

    try {
      // listFiles returns relative names; build absolute paths here
      const relNames = await filesystemManager.listFiles(typePath, /\.(md|mdc)$/);
      for (const relName of relNames) {
        const absPath = path.join(typePath, relName);
        const baseName = path.basename(relName).replace(/\.(md|mdc)$/, '');
        if (baseName === pattern || baseName.includes(pattern) || relName.includes(pattern)) {
          results.push({ id: baseName, name: baseName, path: absPath, isDirectory: false });
        }
      }
    } catch {
      logger.debug({ type, typePath: typePath! }, 'Cursor resource type directory not found, skipping');
    }
  }

  // Scan directory-based types
  for (const type of DIR_TYPES) {
    let typePath: string;
    try { typePath = getCursorTypeDir(type); } catch { continue; }

    try {
      const entries = await fs.readdir(typePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === pattern || entry.name.includes(pattern)) {
          results.push({
            id: entry.name,
            name: entry.name,
            path: path.join(typePath, entry.name),
            isDirectory: true,
          });
        }
      }
    } catch {
      logger.debug({ type, typePath: typePath! }, 'Cursor resource type directory not found, skipping');
    }
  }

  return results;
}

/**
 * Remove the mcpServers entry whose key matches `serverName` from ~/.cursor/mcp.json.
 * Writes back atomically. No-op if the file or entry does not exist.
 */
async function removeMcpJsonEntry(serverName: string): Promise<boolean> {
  const mcpJsonPath = path.join(getCursorRootDir(), 'mcp.json');
  if (!fsSync.existsSync(mcpJsonPath)) return false;

  try {
    const raw = await fs.readFile(mcpJsonPath, 'utf-8');
    const config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };

    if (!config.mcpServers) return false;

    // Case-insensitive search for the server entry
    const matchedKey = Object.keys(config.mcpServers).find(
      k => k === serverName || k.toLowerCase() === serverName.toLowerCase()
    );
    if (!matchedKey) return false;

    delete config.mcpServers[matchedKey];

    const tempPath = `${mcpJsonPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(config, null, 2), 'utf-8');
    await fs.rename(tempPath, mcpJsonPath);

    logger.info({ serverName: matchedKey, mcpJsonPath }, 'Removed mcpServers entry from mcp.json');
    return true;
  } catch (error) {
    logger.warn({ serverName, mcpJsonPath, error }, 'Failed to update mcp.json');
    return false;
  }
}

/** Recursively delete a directory and all its contents. */
async function removeDirectory(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}

export async function uninstallResource(params: unknown): Promise<ToolResult<UninstallResourceResult>> {
  const startTime = Date.now();
  const typedParams = params as UninstallResourceParams;

  logger.info({ tool: 'uninstall_resource', params }, 'uninstall_resource called');

  try {
    const pattern = typedParams.resource_id_or_name;
    const removeFromAccount = typedParams.remove_from_account || false;

    logger.debug({ pattern }, 'Finding installed resources...');
    const matched = await findInstalledResources(pattern);

    if (matched.length === 0) {
      throw createValidationError(
        pattern,
        'resource_id_or_name',
        'No installed resources found matching pattern. Use search_resources to find available resources'
      );
    }

    logger.info({ pattern, count: matched.length }, 'Found matching installed resources');

    const removedResources: Array<{ id: string; name: string; path: string }> = [];
    let subscriptionRemoved = false;
    let mcpJsonCleaned = false;

    for (const resource of matched) {
      try {
        if (resource.isDirectory) {
          // Directory-based resource (skill / mcp): remove entire directory
          await removeDirectory(resource.path);
          logger.debug({ resourceId: resource.id, path: resource.path }, 'Resource directory deleted');

          // For MCP: also clean up mcp.json entry
          const cleaned = await removeMcpJsonEntry(resource.name);
          if (cleaned) mcpJsonCleaned = true;
        } else {
          // File-based resource (rule / command): remove single file
          await filesystemManager.deleteResource(resource.path);
          logger.debug({ resourceId: resource.id, path: resource.path }, 'Resource file deleted');
        }

        removedResources.push({ id: resource.id, name: resource.name, path: resource.path });

        // Remove from server subscription if requested
        if (removeFromAccount) {
          try {
            await apiClient.unsubscribe(resource.id);
            subscriptionRemoved = true;
            logger.debug({ resourceId: resource.id }, 'Resource unsubscribed from account');
          } catch (error) {
            logger.warn({ resourceId: resource.id, error }, 'Failed to unsubscribe resource from account');
          }
        }
      } catch (error) {
        logger.error({ resourceId: resource.id, path: resource.path, error }, 'Failed to delete resource');
      }
    }

    // Clean up leftover empty directories
    for (const type of ['command', 'skill', 'rule', 'mcp']) {
      try {
        const typePath = getCursorTypeDir(type);
        await filesystemManager.removeEmptyDirs(typePath);
      } catch {
        // Directory may not exist — ignore
      }
    }

    const messageParts = [
      `Successfully uninstalled ${removedResources.length} resource${removedResources.length > 1 ? 's' : ''}.`,
      mcpJsonCleaned ? 'MCP server entry removed from ~/.cursor/mcp.json.' : null,
      subscriptionRemoved ? 'Subscription removed from account.' : null,
    ];

    const result: UninstallResourceResult = {
      success: true,
      removed_resources: removedResources,
      subscription_removed: subscriptionRemoved,
      message: messageParts.filter(Boolean).join(' '),
    };

    const duration = Date.now() - startTime;
    logToolCall('uninstall_resource', 'user-id', params as Record<string, unknown>, duration);
    logger.info({ pattern, removedCount: removedResources.length, mcpJsonCleaned, subscriptionRemoved, duration }, 'uninstall_resource completed');

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
    'Uninstall a resource from the local machine. ' +
    'Deletes installed files (rules/commands) or entire install directories (skills/mcp). ' +
    'For MCP resources, also removes the mcpServers entry from ~/.cursor/mcp.json. ' +
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
