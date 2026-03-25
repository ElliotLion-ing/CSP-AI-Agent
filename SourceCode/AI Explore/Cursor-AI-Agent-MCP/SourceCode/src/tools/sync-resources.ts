/**
 * sync_resources Tool
 *
 * Synchronises the user's subscribed AI resources.
 *
 * Resource delivery strategy (v1.5):
 *   - Command / Skill : registered as MCP Prompts (NOT written to local filesystem).
 *                       Content is generated into .prompt-cache/ and registered via PromptManager.
 *   - Rule            : downloaded to ~/.cursor/rules/ (Cursor engine requires local files).
 *   - MCP             : downloaded to ~/.cursor/mcp-servers/ and registered in mcp.json.
 *
 * Flow:
 *   1. Fetch subscription list from CSP server (REST API).
 *   2. (non-check) Trigger Git sync on server side via multiSourceGitManager.
 *   3. For each subscription: handle per type as above.
 *   4. Update telemetry: subscribed_rules + configured_mcps lists.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger, logToolCall, logToolStep, logToolResult } from '../utils/logger';
import { apiClient } from '../api/client';
import { multiSourceGitManager } from '../git/multi-source-manager';
import {
  getCursorResourcePath,
  getCursorTypeDirForClient,
  getCursorRootDirForClient,
} from '../utils/cursor-paths';
import { MCPServerError } from '../types/errors';
import type {
  SyncResourcesParams,
  SyncResourcesResult,
  LocalAction,
  ToolResult,
} from '../types/tools';
import { telemetry } from '../telemetry/index.js';
import { promptManager } from '../prompts/index.js';

/**
 * Extract the `description` field from YAML frontmatter in a Markdown file.
 * Frontmatter is delimited by leading `---` and closing `---` lines.
 * Returns undefined if no frontmatter or no description key is found.
 */
function extractFrontmatterDescription(content: string): string | undefined {
  if (!content.startsWith('---')) return undefined;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return undefined;
  const frontmatter = content.slice(3, end);
  for (const line of frontmatter.split('\n')) {
    const match = /^description:\s*(.+)$/.exec(line.trim());
    if (match) return match[1]!.trim().replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}


export async function syncResources(params: unknown): Promise<ToolResult<SyncResourcesResult>> {
  const startTime = Date.now();

  const typedParams = params as SyncResourcesParams;

  logger.info({
    tool: 'sync_resources',
    params: typedParams,
    timestamp: new Date().toISOString()
  }, 'sync_resources tool invoked');

  logToolStep('sync_resources', 'Tool invocation started', { params: typedParams });

  try {
    const mode      = typedParams.mode  || 'incremental';
    const scope     = typedParams.scope || 'global';
    const types     = typedParams.types;
    const userToken = typedParams.user_token;

    logToolStep('sync_resources', 'Parameters validated', { mode, scope, types });

    // ── Step 1: Fetch subscription list ────────────────────────────────────
    logToolStep('sync_resources', 'Step 1: Fetching subscriptions from API', { scope, types });
    const t1 = Date.now();

    const subscriptions = await apiClient.getSubscriptions({ types }, userToken);

    logToolStep('sync_resources', 'Subscriptions fetched', {
      total: subscriptions.total,
      duration: Date.now() - t1,
      ids: subscriptions.subscriptions.map(s => s.id),
    });

    // ── Step 2: Server-side Git sync (skip in check mode) ──────────────────
    logToolStep('sync_resources', 'Step 2: Server-side Git sync');

    if (mode === 'check') {
      const statuses = await multiSourceGitManager.checkAllSources();
      logToolStep('sync_resources', 'Repository status check completed', {
        sources: statuses.map(s => ({ name: s.source, exists: s.exists, hasRemote: s.hasRemote })),
      });
    } else {
      const t2 = Date.now();
      const gitResults = await multiSourceGitManager.syncAllSources();
      logToolStep('sync_resources', 'Server-side Git sync completed', {
        duration: Date.now() - t2,
        summary: {
          cloned:    gitResults.filter(r => r.action === 'cloned').length,
          pulled:    gitResults.filter(r => r.action === 'pulled').length,
          upToDate:  gitResults.filter(r => r.action === 'up-to-date').length,
          skipped:   gitResults.filter(r => r.action === 'skipped').length,
        },
      });
    }

    // ── Step 3: Download each subscribed resource ──────────────────────────
    // Command / Skill  → registered as MCP Prompts on the server (no local I/O)
    // Rule / MCP       → file content is returned as LocalAction instructions
    //                    so that the AI Agent executes the writes on the user's
    //                    LOCAL machine (not on this potentially remote server).
    logToolStep('sync_resources', 'Step 3: Processing subscribed resources', {
      count: subscriptions.total,
    });

    const tally = { total: subscriptions.total, synced: 0, cached: 0, failed: 0 };

    const details: Array<{
      id: string;
      name: string;
      action: 'synced' | 'cached' | 'failed';
      version: string;
    }> = [];

    // Accumulated local file-system actions the AI must perform on the user's machine.
    const localActions: LocalAction[] = [];

    for (let i = 0; i < subscriptions.subscriptions.length; i++) {
      const sub = subscriptions.subscriptions[i];
      if (!sub) continue;

      // Safe access — `resource` metadata is only present when detail=true was requested.
      const resourceVersion = sub.resource?.version ?? 'unknown';

      logToolStep('sync_resources', `Processing ${i + 1}/${tally.total}`, {
        resourceId: sub.id,
        resourceName: sub.name,
        resourceType: sub.type,
      });

      try {
        // Resolve the destination path inside the Cursor directory.
        // getCursorResourcePath throws for unrecognised types, caught below.
        const destPath = getCursorResourcePath(sub.type, sub.name);

        // In check mode: just report whether the resource already exists locally.
        if (mode === 'check') {
          try {
            await fs.access(destPath);
            tally.cached++;
            details.push({ id: sub.id, name: sub.name, action: 'cached', version: resourceVersion });
            logToolStep('sync_resources', 'Resource already present (check mode)', {
              resourceId: sub.id, destPath,
            });
          } catch {
            tally.failed++;
            details.push({ id: sub.id, name: sub.name, action: 'failed', version: resourceVersion });
            logToolStep('sync_resources', 'Resource missing (check mode)', {
              resourceId: sub.id, destPath,
            });
          }
          continue;
        }

        // ── Command / Skill: MCP Prompt mode (no local file write) ──────────
        // Download content → generate intermediate cache → register as MCP Prompt.
        if (sub.type === 'command' || sub.type === 'skill') {
          logToolStep('sync_resources', `Registering ${sub.type} as MCP Prompt`, {
            resourceId: sub.id,
            resourceName: sub.name,
          });
          try {
            const tDl = Date.now();
            const downloadResult = await apiClient.downloadResource(sub.id, userToken);
            logToolStep('sync_resources', 'Download complete (Prompt mode)', {
              resourceId: sub.id,
              fileCount: downloadResult.files.length,
              duration: Date.now() - tDl,
            });

            // When the API returns no files (expected for Command/Skill in MCP Prompt
            // mode — content lives in the server-side git repo, not the API), fall back
            // to reading the files directly from the local git checkout.
            let sourceFiles = downloadResult.files;
            if (sourceFiles.length === 0) {
              sourceFiles = await multiSourceGitManager.readResourceFiles(
                sub.name,
                sub.type as 'command' | 'skill',
              );
              if (sourceFiles.length > 0) {
                logToolStep('sync_resources', 'Loaded resource files from local git checkout', {
                  resourceId: sub.id,
                  fileCount: sourceFiles.length,
                });
              } else {
                logger.warn(
                  { resourceId: sub.id, resourceName: sub.name },
                  'No files found via API or local git — prompt will have empty content',
                );
              }
            }

            // Primary Markdown content selection:
            //   - skill: prefer SKILL.md (canonical entrypoint for all skill content)
            //   - command: prefer the file whose name matches the resource name
            //   - fallback: first .md file, then first file of any type
            const isSkill = sub.type === 'skill';
            const primaryFile = isSkill
              ? (sourceFiles.find((f) => path.basename(f.path) === 'SKILL.md') ??
                 sourceFiles.find((f) => f.path.endsWith('.md')) ??
                 sourceFiles[0])
              : (sourceFiles.find((f) => path.basename(f.path).replace(/\.md$/, '') === sub.name) ??
                 sourceFiles.find((f) => f.path.endsWith('.md')) ??
                 sourceFiles[0]);

            const rawContent = primaryFile?.content ?? '';

            // Extract description from frontmatter (---\ndescription: ...\n---)
            // falling back to the subscription's description field or resource name.
            const frontmatterDesc = extractFrontmatterDescription(rawContent);
            const description =
              frontmatterDesc ??
              (sub as any).description ??
              sub.name;

            await promptManager.registerPrompt({
              resource_id: sub.id,
              resource_type: sub.type as 'command' | 'skill',
              resource_name: sub.name,
              team: (sub as any).team ?? 'general',
              description,
              rawContent,
            });

            // Clean up any legacy local files that may have been written by an
            // older version of sync_resources.  Command/Skill resources are now
            // served exclusively as MCP Prompts; stale local files would cause
            // the AI to read outdated content (without the track_usage header).
            try {
              const legacyPath = getCursorResourcePath(sub.type, `${sub.name}.md`);
              await fs.unlink(legacyPath);
              logger.info(
                { resourceId: sub.id, legacyPath },
                'Removed legacy local file for Command/Skill resource',
              );
            } catch {
              // File didn't exist — nothing to clean up.
            }

            tally.synced++;
            details.push({ id: sub.id, name: sub.name, action: 'synced', version: resourceVersion });
            logToolStep('sync_resources', `${sub.type} registered as MCP Prompt`, {
              resourceId: sub.id,
              promptCount: promptManager.size,
            });
          } catch (promptErr) {
            logger.error(
              { resourceId: sub.id, error: (promptErr as Error).message },
              'Failed to register Command/Skill as MCP Prompt',
            );
            tally.failed++;
            details.push({ id: sub.id, name: sub.name, action: 'failed', version: resourceVersion });
          }
          continue;
        }

        // Download all files for this resource from the CSP server.
        logToolStep('sync_resources', 'Downloading resource', {
          resourceId: sub.id,
          resourceType: sub.type,
        });
        const tDl = Date.now();
        const downloadResult = await apiClient.downloadResource(sub.id, userToken);
        logToolStep('sync_resources', 'Download complete', {
          resourceId: sub.id,
          fileCount: downloadResult.files.length,
          duration: Date.now() - tDl,
        });

        // When the API returns no files (expected when the MCP server is deployed
        // remotely and content lives in the server-side git repo), fall back to
        // reading the files directly from the local git checkout.
        let resourceFiles = downloadResult.files;
        if (resourceFiles.length === 0) {
          logger.info(
            { resourceId: sub.id, resourceName: sub.name, type: sub.type },
            'sync_resources: API returned no files — triggering git-checkout fallback',
          );
          const gitType = sub.type as 'command' | 'skill' | 'rule' | 'mcp';
          const gitFiles = await multiSourceGitManager.readResourceFiles(sub.name, gitType);
          if (gitFiles.length > 0) {
            resourceFiles = gitFiles;
            logger.info(
              {
                resourceId: sub.id,
                resourceName: sub.name,
                type: sub.type,
                fileCount: resourceFiles.length,
                files: resourceFiles.map((f) => f.path),
              },
              'sync_resources: git-checkout fallback succeeded',
            );
            logToolStep('sync_resources', 'Loaded resource files from local git checkout', {
              resourceId: sub.id,
              fileCount: resourceFiles.length,
            });
          } else {
            logger.warn(
              { resourceId: sub.id, resourceName: sub.name, type: sub.type },
              'sync_resources: git-checkout fallback found no files — marking resource failed',
            );
            tally.failed++;
            details.push({ id: sub.id, name: sub.name, action: 'failed', version: resourceVersion });
            continue;
          }
        }

        // ── MCP resource ──────────────────────────────────────────────────────
        // Read mcp-config.json to determine Format A (local executable, has
        // "command" field) vs Format B (remote URL map, no "command" field).
        //
        // IMPORTANT: all paths in LocalAction instructions must use the CLIENT-side
        // helper (tilde-based) so they resolve correctly on the user's machine,
        // not on this (possibly remote Linux) server.
        if (sub.type === 'mcp') {
          const mcpConfigFile = resourceFiles.find(
            (f) => path.basename(f.path) === 'mcp-config.json',
          );
          // ~/.cursor/mcp.json on the user's machine
          const mcpJsonPath = `${getCursorRootDirForClient()}/mcp.json`;

          logger.info(
            {
              resourceId: sub.id,
              resourceName: sub.name,
              mcpJsonPath,
              hasMcpConfigFile: !!mcpConfigFile,
              availableFiles: resourceFiles.map((f) => f.path),
            },
            'sync_resources: processing MCP resource',
          );

          if (mcpConfigFile) {
            let cfg: Record<string, unknown> = {};
            try { cfg = JSON.parse(mcpConfigFile.content) as Record<string, unknown>; }
            catch {
              logger.warn(
                { resourceId: sub.id, resourceName: sub.name },
                'sync_resources: failed to parse mcp-config.json — treating as empty config',
              );
            }

            if (typeof cfg['command'] === 'string') {
              // ── Format A: local executable ──────────────────────────────────
              const installDir = `${getCursorTypeDirForClient('mcp')}/${sub.name}`;
              const writeActions: string[] = [];
              for (const file of resourceFiles) {
                const normalised = path.normalize(file.path);
                if (normalised.startsWith('..')) continue;
                const fileDest = `${installDir}/${normalised}`;
                localActions.push({ action: 'write_file', path: fileDest, content: file.content });
                writeActions.push(fileDest);
              }
              const env = (cfg['env'] ?? {}) as Record<string, string>;
              const missingEnv = Object.entries(env).filter(([, v]) => v === '').map(([k]) => k);
              const looksLikePath = (a: string) =>
                a.startsWith('./') || a.startsWith('../') || a.includes('/') || /\.\w+$/.test(a);
              const args = ((cfg['args'] ?? []) as string[]).map((a) =>
                path.isAbsolute(a) || !looksLikePath(a) ? a : `${installDir}/${a.replace(/^\.\//, '')}`,
              );
              const serverName = (cfg['name'] as string | undefined) ?? sub.name;
              localActions.push({
                action: 'merge_mcp_json',
                mcp_json_path: mcpJsonPath,
                server_name: serverName,
                entry: { ...cfg, args },
                ...(missingEnv.length > 0 ? {
                  missing_env: missingEnv,
                  setup_hint: `Fill in env vars in ${mcpJsonPath} under mcpServers["${sub.name}"]: ${missingEnv.join(', ')}.`,
                } : {}),
              });
              logger.info(
                {
                  resourceId: sub.id,
                  resourceName: sub.name,
                  format: 'A',
                  installDir,
                  mcpJsonPath,
                  serverName,
                  writeFiles: writeActions,
                  missingEnv,
                },
                'sync_resources: MCP Format A — write_file + merge_mcp_json actions queued',
              );
              logToolStep('sync_resources', 'Local-executable MCP: write_file + merge_mcp_json queued', { resourceId: sub.id });
            } else {
              // ── Format B: remote URL map ────────────────────────────────────
              const queuedServers: string[] = [];
              for (const [serverName, entry] of Object.entries(cfg)) {
                const e = entry as Record<string, unknown>;
                const env = (e['env'] ?? {}) as Record<string, string>;
                const missingEnv = Object.entries(env).filter(([, v]) => v === '').map(([k]) => k);
                localActions.push({
                  action: 'merge_mcp_json',
                  mcp_json_path: mcpJsonPath,
                  server_name: serverName,
                  entry: e,
                  ...(missingEnv.length > 0 ? {
                    missing_env: missingEnv,
                    setup_hint: `Fill in env vars in ${mcpJsonPath} under mcpServers["${serverName}"]: ${missingEnv.join(', ')}.`,
                  } : {}),
                });
                queuedServers.push(serverName);
              }
              logger.info(
                {
                  resourceId: sub.id,
                  resourceName: sub.name,
                  format: 'B',
                  mcpJsonPath,
                  serverKeys: queuedServers,
                },
                'sync_resources: MCP Format B — merge_mcp_json actions queued',
              );
              logToolStep('sync_resources', 'Remote-URL MCP: merge_mcp_json queued', {
                resourceId: sub.id, serverKeys: Object.keys(cfg),
              });
            }
          } else {
            // No mcp-config.json: heuristic fallback
            const installDir = `${getCursorTypeDirForClient('mcp')}/${sub.name}`;
            const writeActions: string[] = [];
            for (const file of resourceFiles) {
              const normalised = path.normalize(file.path);
              if (normalised.startsWith('..')) continue;
              const fileDest = `${installDir}/${normalised}`;
              localActions.push({ action: 'write_file', path: fileDest, content: file.content });
              writeActions.push(fileDest);
            }
            const jsEntry = resourceFiles.find((f) => f.path.endsWith('.js'));
            const pyEntry = resourceFiles.find((f) => f.path.endsWith('.py'));
            const entryFile = jsEntry ?? pyEntry ?? resourceFiles[0];
            const cmd = jsEntry ? 'node' : 'python3';
            const entryPath = `${installDir}/${entryFile?.path ?? ''}`;
            localActions.push({
              action: 'merge_mcp_json',
              mcp_json_path: mcpJsonPath,
              server_name: sub.name,
              entry: { command: cmd, args: [entryPath] },
            });
            logger.info(
              {
                resourceId: sub.id,
                resourceName: sub.name,
                format: 'heuristic',
                installDir,
                mcpJsonPath,
                cmd,
                entryPath,
                writeFiles: writeActions,
              },
              'sync_resources: MCP heuristic fallback — write_file + merge_mcp_json actions queued',
            );
            logToolStep('sync_resources', 'MCP heuristic fallback: write_file + merge_mcp_json queued', { resourceId: sub.id });
          }

          tally.synced++;
          details.push({ id: sub.id, name: sub.name, action: 'synced', version: resourceVersion });
          continue;
        }

        // ── Rule resource ─────────────────────────────────────────────────────
        // Return write_file actions; the AI writes the files locally.
        // Use client-side path so the path resolves on the user's machine.
        if (sub.type === 'rule') {
          const typeDir = getCursorTypeDirForClient(sub.type);
          const writeActions: string[] = [];

          for (const file of resourceFiles) {
            const normalised = path.normalize(file.path);
            if (normalised.startsWith('..')) {
              logger.warn({ resourceId: sub.id, filePath: file.path }, 'Skipping suspicious file path');
              continue;
            }
            const destPath = `${typeDir}/${normalised}`;
            localActions.push({
              action: 'write_file',
              path: destPath,
              content: file.content,
            });
            writeActions.push(destPath);
          }

          logger.info(
            {
              resourceId: sub.id,
              resourceName: sub.name,
              typeDir,
              fileCount: writeActions.length,
              destPaths: writeActions,
            },
            'sync_resources: Rule — write_file actions queued for AI',
          );

          tally.synced++;
          details.push({ id: sub.id, name: sub.name, action: 'synced', version: resourceVersion });
          logToolStep('sync_resources', 'Rule: write_file actions queued for AI', {
            resourceId: sub.id,
            fileCount: resourceFiles.length,
          });
          continue;
        }

        // Fallback for any unrecognised types (should not happen in practice).
        logger.warn({ resourceId: sub.id, type: sub.type }, 'Unrecognised resource type — skipping');
        tally.failed++;
        details.push({ id: sub.id, name: sub.name, action: 'failed', version: resourceVersion });

      } catch (error) {
        logger.error({
          resourceId: sub.id,
          resourceName: sub.name,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to sync resource');

        tally.failed++;
        details.push({ id: sub.id, name: sub.name, action: 'failed', version: sub.resource?.version ?? 'unknown' });
      }
    }

    // ── Step 4: Health score ───────────────────────────────────────────────
    const healthScore = tally.total > 0
      ? Math.round(((tally.synced + tally.cached) / tally.total) * 100)
      : 100;

    const result: SyncResourcesResult = {
      mode,
      health_score: healthScore,
      summary: tally,
      details,
      ...(localActions.length > 0 ? { local_actions_required: localActions } : {}),
    };

    const duration = Date.now() - startTime;
    logToolCall('sync_resources', 'user-id', params as Record<string, unknown>, duration);
    logToolResult('sync_resources', true, result);

    logger.info({
      tool: 'sync_resources',
      mode,
      total: tally.total,
      synced: tally.synced,
      cached: tally.cached,
      failed: tally.failed,
      healthScore,
      duration,
      timestamp: new Date().toISOString()
    }, 'sync_resources completed successfully');

    // Update telemetry snapshot lists (fire-and-forget).
    // Rules: cannot track individual invocations; report subscription list only.
    const subscribedRules = subscriptions.subscriptions
      .filter((s) => s.type === 'rule')
      .map((s) => ({
        resource_id: s.id,
        resource_name: s.name,
        subscribed_at: (s as any).subscribed_at ?? new Date().toISOString(),
      }));
    if (userToken) telemetry.updateSubscribedRules(subscribedRules, userToken).catch(() => {});

    // MCPs: individual invocation tracking is each MCP server's own responsibility.
    const configuredMcps = subscriptions.subscriptions
      .filter((s) => s.type === 'mcp')
      .map((s) => ({
        resource_id: s.id,
        resource_name: s.name,
        configured_at: (s as any).subscribed_at ?? new Date().toISOString(),
      }));
    if (userToken) telemetry.updateConfiguredMcps(configuredMcps, userToken).catch(() => {});

    return { success: true, data: result };

  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error({
      tool: 'sync_resources',
      error: error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : String(error),
      duration,
      timestamp: new Date().toISOString()
    }, 'sync_resources failed with error');

    logToolResult('sync_resources', false, undefined, error instanceof Error ? error : new Error(String(error)));

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
export const syncResourcesTool = {
  name: 'sync_resources',
  description:
    'Synchronize subscribed AI resources. ' +
    'Command and Skill resources are registered as MCP Prompts on the server. ' +
    'Rule and MCP resources are returned as `local_actions_required` — an ordered list of ' +
    'write_file, merge_mcp_json, or other actions that the AI Agent MUST execute on the ' +
    'USER\'S LOCAL MACHINE after receiving the response. ' +
    'Execute every action in the list before reporting success to the user. ' +
    'For merge_mcp_json actions: read the existing ~/.cursor/mcp.json, smart-merge the ' +
    'provided entry (preserve existing user env values), then write the file back. ' +
    'For write_file actions: create any missing parent directories then write the file.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      mode: {
        type: 'string',
        description: 'Sync mode: check (status only), incremental (updates only), full (all)',
        enum: ['check', 'incremental', 'full'],
        default: 'incremental',
      },
      scope: {
        type: 'string',
        description: 'Installation scope: global (~/.cursor/), workspace (.cursor/), or all',
        enum: ['global', 'workspace', 'all'],
        default: 'global',
      },
      types: {
        type: 'array',
        description: 'Filter by resource types (empty = all types)',
      },
      user_token: {
        type: 'string',
        description:
          'DO NOT set this field — it is automatically injected by the MCP server from ' +
          'the authenticated SSE connection. The server always provides the correct token.',
      },
    },
  },
  handler: syncResources,
};
