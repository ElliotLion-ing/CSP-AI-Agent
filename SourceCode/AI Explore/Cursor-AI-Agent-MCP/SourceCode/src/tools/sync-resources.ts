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
import { getCursorResourcePath, getCursorTypeDir, getCursorRootDir } from '../utils/cursor-paths';
import { MCPServerError } from '../types/errors';
import type { SyncResourcesParams, SyncResourcesResult, McpSetupItem, ToolResult } from '../types/tools';
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

/**
 * Two supported mcp-config.json formats:
 *
 * Format A — Local executable (e.g. jenkins):
 *   Has a top-level "command" field.
 *   { "name": "jenkins", "command": "python3", "args": ["server.py"], "env": {...} }
 *   → One entry written to mcpServers using resolved absolute args.
 *
 * Format B — Remote URL entries (e.g. acm):
 *   No "command" field; the object IS the mcpServers map (one or more entries).
 *   { "acm-dev": { "url": "...", "transport": "sse" }, "acm": { "url": "..." } }
 *   → Each key merged directly into mcpServers as-is (no path resolution needed).
 *
 * Detection: if parsed JSON has a "command" key at the top level → Format A, else Format B.
 */
interface LocalMcpDescriptor {
  name?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
type RemoteMcpEntries = Record<string, unknown>; // mcpServers-compatible map

/**
 * Register a downloaded MCP resource into ~/.cursor/mcp.json.
 *
 * Supports:
 *   - Format A (local executable): resolves relative args to absolute paths, writes one entry.
 *   - Format B (remote URL map):   merges all entries directly into mcpServers.
 *   - No mcp-config.json: heuristic fallback (scans for .py/.js entry point, logs WARN).
 *
 * The write is idempotent — re-running after a re-download updates existing entries.
 *
 * Returns a McpSetupItem when the registered server needs manual configuration
 * (empty env vars, or a command that might differ across platforms), or null
 * when no action is required from the user.
 */
async function registerMcpServer(serverName: string, installDir: string): Promise<McpSetupItem | null> {
  // ── 1. Load mcp-config.json ────────────────────────────────────────────
  const configFilePath = path.join(installDir, 'mcp-config.json');
  let rawConfig: unknown = null;

  try {
    const raw = await fs.readFile(configFilePath, 'utf-8');
    rawConfig = JSON.parse(raw);
    logger.debug({ serverName, configFilePath }, 'registerMcpServer: loaded mcp-config.json');
  } catch {
    logger.warn(
      { serverName, configFilePath },
      'registerMcpServer: mcp-config.json not found — falling back to heuristic detection. ' +
      'Add an mcp-config.json to this resource for reliable registration.'
    );
  }

  // ── 2. Determine what to merge into mcp.json ──────────────────────────
  // entriesToMerge: map of serverKey → entry object (may have multiple keys for Format B)
  let entriesToMerge: Record<string, unknown> = {};

  if (rawConfig !== null && typeof rawConfig === 'object') {
    const cfg = rawConfig as Record<string, unknown>;

    if (typeof cfg['command'] === 'string') {
      // ── Format A: local executable ───────────────────────────────────
      const descriptor = cfg as unknown as LocalMcpDescriptor;
      const key = descriptor.name ?? serverName;
      // Only resolve args that look like relative file paths (contain a dot or
      // path separator).  Plain words like "mcp", "start", "--port" are kept as-is.
      const looksLikePath = (a: string) =>
        a.startsWith('./') || a.startsWith('../') || a.includes(path.sep) || /\.\w+$/.test(a);
      const resolvedArgs = (descriptor.args ?? []).map(a =>
        path.isAbsolute(a) || !looksLikePath(a) ? a : path.join(installDir, a)
      );
      entriesToMerge[key] = {
        command: descriptor.command,
        args: resolvedArgs,
        ...(descriptor.env && Object.keys(descriptor.env).length > 0
          ? { env: descriptor.env }
          : {}),
      };
      logger.info(
        { serverName, key, command: descriptor.command },
        'registerMcpServer: Format A (local executable)'
      );
    } else {
      // ── Format B: remote URL entries map ─────────────────────────────
      // The entire object is a ready-to-merge mcpServers map.
      entriesToMerge = cfg as RemoteMcpEntries;
      logger.info(
        { serverName, keys: Object.keys(entriesToMerge) },
        'registerMcpServer: Format B (remote URL entries)'
      );
    }
  } else {
    // ── Heuristic fallback (no mcp-config.json) ───────────────────────
    let entryFile: string | null = null;
    let command = 'python3';

    try {
      const entries = await fs.readdir(installDir);
      if (entries.includes(`${serverName}.py`)) {
        entryFile = path.join(installDir, `${serverName}.py`); command = 'python3';
      } else if (entries.includes(`${serverName}.js`)) {
        entryFile = path.join(installDir, `${serverName}.js`); command = 'node';
      }
      if (!entryFile) {
        const py = entries.find(f => f.endsWith('.py') && f !== '__init__.py');
        if (py) { entryFile = path.join(installDir, py); command = 'python3'; }
      }
      if (!entryFile) {
        const js = entries.find(f => f.endsWith('.js') || f.endsWith('.mjs'));
        if (js) { entryFile = path.join(installDir, js); command = 'node'; }
      }
    } catch (err) {
      logger.warn({ serverName, installDir, err }, 'registerMcpServer: could not read install directory');
      return null;
    }

    if (!entryFile) {
      logger.warn(
        { serverName, installDir },
        'registerMcpServer: no entry point found and no mcp-config.json — skipping registration'
      );
      return null;
    }
    entriesToMerge[serverName] = { command, args: [entryFile] };
  }

  // ── 3. Read / create ~/.cursor/mcp.json ───────────────────────────────
  const mcpJsonPath = path.join(getCursorRootDir(), 'mcp.json');
  let mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };

  try {
    const raw = await fs.readFile(mcpJsonPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'mcpServers' in parsed) {
      mcpConfig = parsed as typeof mcpConfig;
    }
  } catch {
    // File doesn't exist or is corrupt — start fresh
  }

  // Smart-merge each entry into mcpServers:
  //   - Structural fields (command, args, url, transport, …): always take the
  //     value from mcp-config.json (server is authoritative for structure).
  //   - env field: preserve user-filled non-empty values; only add keys that
  //     are new or were previously empty (avoids wiping tokens / URLs the user
  //     has already configured).
  for (const [key, incoming] of Object.entries(entriesToMerge)) {
    const existing = mcpConfig.mcpServers[key];

    if (!existing || typeof existing !== 'object') {
      // No prior entry — write as-is.
      mcpConfig.mcpServers[key] = incoming;
      continue;
    }

    const incomingEntry = incoming as Record<string, unknown>;
    const existingEntry = existing as Record<string, unknown>;

    // Merge env: keep user values that are non-empty strings; fill in the rest
    // from the incoming template (which uses empty strings as placeholders).
    const mergedEnv: Record<string, string> = {};
    const incomingEnv = (incomingEntry['env'] ?? {}) as Record<string, string>;
    const existingEnv = (existingEntry['env'] ?? {}) as Record<string, string>;

    for (const envKey of Object.keys(incomingEnv)) {
      const userVal = existingEnv[envKey];
      // Preserve whatever the user typed; fall back to the template placeholder.
      mergedEnv[envKey] = (typeof userVal === 'string' && userVal !== '')
        ? userVal
        : (incomingEnv[envKey] ?? '');
    }

    // Structural fields from server override local, env is smart-merged.
    mcpConfig.mcpServers[key] = {
      ...incomingEntry,
      ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
    };
  }

  // ── 4. Atomic write ────────────────────────────────────────────────────
  const tmpPath = `${mcpJsonPath}.tmp-${process.pid}`;
  try {
    await fs.writeFile(tmpPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
    await fs.rename(tmpPath, mcpJsonPath);
    logger.info(
      { serverName, mergedKeys: Object.keys(entriesToMerge), mcpJsonPath },
      'MCP server(s) registered in mcp.json'
    );
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => undefined);
    logger.error({ serverName, err }, 'registerMcpServer: failed to write mcp.json');
    return null;
  }

  // ── 5. Detect setup requirements ──────────────────────────────────────
  // Collect env keys that are still empty (user must fill in) and flag
  // commands that may differ across platforms (python vs python3, etc.).
  const AMBIGUOUS_COMMANDS = new Set(['python', 'python3', 'node', 'npx', 'uvx']);
  const missingEnvKeys: string[] = [];
  let commandNeedsVerification = false;
  let registeredCommand = '';

  for (const entry of Object.values(entriesToMerge)) {
    const e = entry as Record<string, unknown>;
    const env = (e['env'] ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(env)) {
      if (v === '') missingEnvKeys.push(k);
    }
    if (typeof e['command'] === 'string') {
      registeredCommand = e['command'];
      if (AMBIGUOUS_COMMANDS.has(registeredCommand)) {
        commandNeedsVerification = true;
      }
    }
  }

  if (missingEnvKeys.length === 0 && !commandNeedsVerification) {
    return null; // No user action needed
  }

  // Locate the best available setup/readme doc in the install directory so the
  // user can be pointed to it.  Priority: SETUP.md > README.md > README*.md > *.md
  let setupDocPath: string | null = null;
  try {
    const entries = await fs.readdir(installDir);
    const mdFiles = entries.filter(f => /\.md$/i.test(f));
    const pick = (name: string) => mdFiles.find(f => f.toLowerCase() === name.toLowerCase());
    const found =
      pick('SETUP.md') ??
      pick('README.md') ??
      mdFiles.find(f => f.toLowerCase().startsWith('readme')) ??
      mdFiles[0];
    if (found) {
      setupDocPath = path.join(installDir, found);
    }
  } catch {
    // installDir might not exist yet for remote-URL MCPs — ignore
  }

  const hints: string[] = [];
  if (commandNeedsVerification) {
    hints.push(
      `The command "${registeredCommand}" may differ on your machine ` +
      `(e.g. "python" vs "python3"). ` +
      `Please verify the command in ${mcpJsonPath} under mcpServers["${serverName}"].`
    );
  }
  if (missingEnvKeys.length > 0) {
    hints.push(
      `Fill in the following environment variables in ${mcpJsonPath} ` +
      `under mcpServers["${serverName}"].env: ${missingEnvKeys.join(', ')}.`
    );
  }
  if (setupDocPath) {
    hints.push(`Refer to the setup guide for details: ${setupDocPath}`);
  }

  return {
    server_name: serverName,
    mcp_json_path: mcpJsonPath,
    missing_env: missingEnvKeys,
    command_needs_verification: commandNeedsVerification,
    command: registeredCommand,
    setup_hint: hints.join(' '),
    ...(setupDocPath ? { setup_doc: setupDocPath } : {}),
  };
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

    // ── Step 3: Download each subscribed resource to the local Cursor dir ──
    logToolStep('sync_resources', 'Step 3: Downloading resources to Cursor directories', {
      count: subscriptions.total,
    });

    const tally = { total: subscriptions.total, synced: 0, cached: 0, failed: 0 };

    const details: Array<{
      id: string;
      name: string;
      action: 'synced' | 'cached' | 'failed';
      version: string;
    }> = [];

    const pendingSetup: McpSetupItem[] = [];

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

            // Primary Markdown content selection:
            //   - skill: prefer SKILL.md (canonical entrypoint for all skill content)
            //   - command: prefer the file whose name matches the resource name
            //   - fallback: first .md file, then first file of any type
            const isSkill = sub.type === 'skill';
            const primaryFile = isSkill
              ? (downloadResult.files.find((f) => path.basename(f.path) === 'SKILL.md') ??
                 downloadResult.files.find((f) => f.path.endsWith('.md')) ??
                 downloadResult.files[0])
              : (downloadResult.files.find((f) => path.basename(f.path).replace(/\.md$/, '') === sub.name) ??
                 downloadResult.files.find((f) => f.path.endsWith('.md')) ??
                 downloadResult.files[0]);

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
        // We always download first so we can inspect the payload and determine
        // whether this is a remote-URL-only MCP (Format B: config-only, no
        // local files needed) before deciding what to write locally.
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

        // Detect remote-URL-only MCP: the payload contains exactly one file
        // named mcp-config.json whose JSON has no "command" field (Format B).
        // These servers are deployed remotely — no local files are needed.
        // We only need to update the user's ~/.cursor/mcp.json.
        let isRemoteUrlMcp = false;
        const firstFile = downloadResult.files[0];
        if (sub.type === 'mcp' && downloadResult.files.length === 1
            && firstFile !== undefined
            && path.basename(firstFile.path) === 'mcp-config.json') {
          try {
            const parsed = JSON.parse(firstFile.content) as Record<string, unknown>;
            if (typeof parsed['command'] !== 'string') {
              isRemoteUrlMcp = true;
            }
          } catch { /* malformed JSON — treat as normal MCP */ }
        }

        if (isRemoteUrlMcp) {
          // Remote-URL MCP: no local files to write; just register in mcp.json.
          // Parse and merge the entries directly from the downloaded content.
          const configContent = firstFile!.content;
          const mcpJsonPath = path.join(getCursorRootDir(), 'mcp.json');
          let mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
          try {
            const raw = await fs.readFile(mcpJsonPath, 'utf-8');
            const p = JSON.parse(raw);
            if (p && typeof p === 'object' && 'mcpServers' in p) {
              mcpConfig = p as typeof mcpConfig;
            }
          } catch { /* file missing or corrupt — start fresh */ }

          const entries = JSON.parse(configContent) as Record<string, unknown>;
          // Smart-merge: structural fields from server; preserve user env values.
          for (const [key, incoming] of Object.entries(entries)) {
            const existing = mcpConfig.mcpServers[key];
            if (!existing || typeof existing !== 'object') {
              mcpConfig.mcpServers[key] = incoming;
            } else {
              const inc = incoming as Record<string, unknown>;
              const ext = existing as Record<string, unknown>;
              const inEnv = (inc['env'] ?? {}) as Record<string, string>;
              const exEnv = (ext['env'] ?? {}) as Record<string, string>;
              const mergedEnv: Record<string, string> = {};
              for (const k of Object.keys(inEnv)) {
                const userVal = exEnv[k];
                mergedEnv[k] = (typeof userVal === 'string' && userVal !== '') ? userVal : (inEnv[k] ?? '');
              }
              mcpConfig.mcpServers[key] = {
                ...inc,
                ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
              };
            }
          }

          const tmpPath = `${mcpJsonPath}.tmp-${process.pid}`;
          await fs.writeFile(tmpPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
          await fs.rename(tmpPath, mcpJsonPath);

          // Detect missing env vars in remote-URL entries (no local command to check).
          const remoteMissingEnv: string[] = [];
          for (const entry of Object.values(entries)) {
            const e = entry as Record<string, unknown>;
            const env = (e['env'] ?? {}) as Record<string, string>;
            for (const [k, v] of Object.entries(env)) {
              if (v === '') remoteMissingEnv.push(k);
            }
          }
          if (remoteMissingEnv.length > 0) {
            pendingSetup.push({
              server_name: sub.name,
              mcp_json_path: mcpJsonPath,
              missing_env: remoteMissingEnv,
              command_needs_verification: false,
              command: '',
              setup_hint:
                `Fill in the following environment variables in ${mcpJsonPath} ` +
                `under the relevant mcpServers entries for "${sub.name}": ` +
                `${remoteMissingEnv.join(', ')}.`,
            });
          }

          tally.synced++;
          details.push({ id: sub.id, name: sub.name, action: 'synced', version: resourceVersion });
          logToolStep('sync_resources', 'Remote-URL MCP registered in mcp.json (no local files)', {
            resourceId: sub.id,
            mergedKeys: Object.keys(entries),
          });
          continue;
        }

        // Incremental mode: skip file write if local directory already exists.
        // MCP resources (local-executable type) still call registerMcpServer
        // to keep mcp.json in sync even when files have not changed.
        if (mode === 'incremental') {
          let alreadyPresent = false;
          try {
            await fs.access(destPath);
            alreadyPresent = true;
          } catch { /* not present — fall through to write */ }

          if (alreadyPresent) {
            if (sub.type === 'mcp') {
              const setupItem = await registerMcpServer(sub.name, destPath);
              if (setupItem) pendingSetup.push(setupItem);
            }
            tally.cached++;
            details.push({ id: sub.id, name: sub.name, action: 'cached', version: resourceVersion });
            logToolStep('sync_resources', 'Resource already present (incremental — skipping file write)', {
              resourceId: sub.id, destPath,
            });
            continue;
          }
        }

        // Ensure the Cursor type directory exists (e.g. ~/.cursor/skills/).
        const typeDir = getCursorTypeDir(sub.type);
        await fs.mkdir(typeDir, { recursive: true });

        // Determine write strategy based on resource type:
        //   Directory-based (skill, mcp): create <typeDir>/<name>/ and write files under it.
        //   File-based (command, rule):   write each file directly into <typeDir>/ — no subdir.
        const isDirectoryType = sub.type === 'skill' || sub.type === 'mcp';
        const writeRoot = isDirectoryType ? destPath : typeDir;

        if (isDirectoryType) {
          await fs.mkdir(writeRoot, { recursive: true });
        }

        for (const file of downloadResult.files) {
          // Reject path traversal attempts in file.path
          const normalised = path.normalize(file.path);
          if (normalised.startsWith('..')) {
            logger.warn({ resourceId: sub.id, filePath: file.path }, 'Skipping suspicious file path');
            continue;
          }
          const writePath = path.join(writeRoot, normalised);
          await fs.mkdir(path.dirname(writePath), { recursive: true });
          await fs.writeFile(writePath, file.content, 'utf-8');
        }

        // After writing local MCP files, register the server in ~/.cursor/mcp.json.
        if (sub.type === 'mcp') {
          const setupItem = await registerMcpServer(sub.name, destPath);
          if (setupItem) pendingSetup.push(setupItem);
        }

        tally.synced++;
        details.push({ id: sub.id, name: sub.name, action: 'synced', version: resourceVersion });
        logToolStep('sync_resources', 'Resource written to Cursor directory', {
          resourceId: sub.id,
          destPath,
          fileCount: downloadResult.files.length,
        });

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
      ...(pendingSetup.length > 0 ? { pending_setup: pendingSetup } : {}),
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
  description: 'Synchronize subscribed resources to local filesystem',
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
