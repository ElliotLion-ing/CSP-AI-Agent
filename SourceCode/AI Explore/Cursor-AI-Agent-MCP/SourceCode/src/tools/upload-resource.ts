/**
 * upload_resource Tool
 *
 * Uploads resource files to a CSP source repository via the two-step API:
 *   Step 1: POST /csp/api/resources/upload  → returns upload_id (server-side staging)
 *   Step 2: POST /csp/api/resources/finalize → triggers Git commit, returns permanent resource_id
 *
 * The user selects files from anywhere on their local machine. The AI reads the file
 * content and passes it directly in files[]. The MCP server forwards everything to the
 * CSP API — no local path resolution or server-side filesystem access is needed.
 *
 * target_source is passed through to the CSP API as-is; the CSP server decides
 * which Git repo to commit to based on that value.
 */

import * as path from 'path';
import { logger, logToolCall } from '../utils/logger';
import { apiClient } from '../api/client';
import { resourceLoader } from '../resources';
import { MCPServerError, createValidationError } from '../types/errors';
import type { UploadResourceParams, UploadResourceResult, ToolResult, FileEntry } from '../types/tools';
import type { ResourceType } from '../types/resources';

/**
 * Validate and return the files[] array.
 * Each entry path must be a relative path with no traversal.
 * For MCP resources, mcp-config.json must be present.
 */
function collectFiles(typedParams: UploadResourceParams): FileEntry[] {
  if (!typedParams.files || typedParams.files.length === 0) {
    throw createValidationError(
      'files',
      'required',
      '"files" must be a non-empty array of {path, content} entries.'
    );
  }

  for (const entry of typedParams.files) {
    const norm = path.normalize(entry.path);
    if (norm.startsWith('..') || path.isAbsolute(norm)) {
      throw createValidationError(
        'files[].path',
        'relative_path',
        `Path traversal or absolute path not allowed: "${entry.path}"`
      );
    }
  }

  // MCP resources must include mcp-config.json so the client can auto-register
  // the server in ~/.cursor/mcp.json after sync_resources installs it.
  if (typedParams.type === 'mcp') {
    const hasMcpConfig = typedParams.files.some(
      (f) => path.basename(f.path) === 'mcp-config.json'
    );
    if (!hasMcpConfig) {
      throw createValidationError(
        'files',
        'required',
        'MCP resources must include a "mcp-config.json" file. ' +
        'This file tells the client how to start the MCP server after installation. ' +
        'Required format:\n' +
        '{\n' +
        '  "name": "<server-name>",\n' +
        '  "command": "python3",          // or "node", "uvx", etc.\n' +
        '  "args": ["<entry-file.py>"],   // relative path resolved against install dir\n' +
        '  "env": { "ENV_VAR": "" }       // optional; empty string = user must fill in\n' +
        '}'
      );
    }
  }

  return typedParams.files;
}

export async function uploadResource(params: unknown): Promise<ToolResult<UploadResourceResult>> {
  const startTime = Date.now();
  const typedParams = params as UploadResourceParams;

  logger.info({ tool: 'upload_resource', params }, 'upload_resource called');

  try {
    const resourceType = typedParams.type;
    const resourceId = typedParams.resource_id;
    const resourceName = typedParams.name ?? resourceId; // API uses "name" field
    const targetSource = typedParams.target_source ?? 'csp'; // default to "csp" repo
    const force = (typedParams as any).force || false;

    logger.info({ resourceId, resourceType, targetSource }, 'Upload target resolved');

    // ========== Step 1: Duplicate-name check ==========
    try {
      if (!resourceLoader.getStats()) {
        await resourceLoader.loadConfig();
        await resourceLoader.scanResources();
      }
      const existing = resourceLoader.searchResourcesByName(resourceName, resourceType as ResourceType | undefined);
      if (existing.length > 0 && !force) {
        const conflictInfo = existing.map((r) => ({ name: r.name, type: r.type, source: r.source }));
        logger.warn({ resourceName, resourceType, conflictInfo }, 'Resource name conflict detected');
        return {
          success: false,
          error: {
            code: 'RESOURCE_NAME_CONFLICT',
            message:
              `Resource "${resourceName}" already exists. Add "force": true to overwrite.\n` +
              conflictInfo.map((c) => `  - ${c.name} (${c.type}, source: ${c.source})`).join('\n'),
            details: conflictInfo,
          } as any,
        };
      }
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Duplicate check failed, continuing upload');
    }

    // ========== Step 3: Validate commit message ==========
    if (!typedParams.message || typeof typedParams.message !== 'string') {
      throw createValidationError('message', 'string', 'Commit message is required');
    }
    if (typedParams.message.length < 5 || typedParams.message.length > 200) {
      throw createValidationError(
        'message', 'string',
        `Commit message must be 5-200 characters, got ${typedParams.message.length}`
      );
    }

    // ========== Step 4: Collect files ==========
    const fileEntries = collectFiles(typedParams);
    logger.info({ resourceId, fileCount: fileEntries.length }, 'Files collected for upload');

    // ========== Step 5: Call CSP API — upload (staging) ==========
    logger.info({ resourceName, resourceType, targetSource }, 'Calling CSP upload API...');
    const uploadResp = await apiClient.uploadResourceFiles({
      type: resourceType,
      name: resourceName,
      files: fileEntries,
      target_source: targetSource,
      force,
    });

    const uploadId = uploadResp.upload_id;
    logger.info({ uploadId, expiresAt: uploadResp.expires_at }, 'Upload staged successfully');

    // ========== Step 6: Call CSP API — finalize (Git commit) ==========
    logger.info({ uploadId }, 'Calling CSP finalize API...');
    const finalizeResp = await apiClient.finalizeResourceUpload(uploadId, typedParams.message);

    const finalResourceId = finalizeResp.resource_id;
    const version = finalizeResp.version ?? '1.0.0';
    const resourceUrl = finalizeResp.url ?? '';
    const commitHash = finalizeResp.commit_hash ?? '';

    logger.info({ finalResourceId, version, commitHash }, 'Upload finalized successfully');

    const result: UploadResourceResult = {
      resource_id: finalResourceId,
      version,
      url: resourceUrl,
      commit_hash: commitHash,
      message: `Resource '${resourceName}' (${resourceType}) uploaded to source '${targetSource}' (v${version}). ${resourceUrl ? `URL: ${resourceUrl}` : ''}`.trim(),
    };

    const duration = Date.now() - startTime;
    logToolCall('upload_resource', 'user-id', params as Record<string, unknown>, duration);
    logger.info({ finalResourceId, version, source: targetSource, duration }, 'upload_resource completed');

    return { success: true, data: result };

  } catch (error) {
    logger.error({ error, resourceId: typedParams.resource_id }, 'upload_resource failed');
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
export const uploadResourceTool = {
  name: 'upload_resource',
  description:
    'Upload a new AI resource (command, skill, rule, or mcp) to a CSP source repository. ' +
    'The user selects files from anywhere on their local machine — read each file and pass its content in files[]. ' +
    'ALWAYS confirm two things with the user before uploading: ' +
    '(1) the resource type (command/skill/rule/mcp), and ' +
    '(2) the target source repo (e.g. "csp" (default) or "client-sdk-ai-hub"). ' +
    'The tool uses a two-step CSP API: first stages files and gets an upload_id, then finalizes the Git commit. ' +
    'Pass files[] — an array of {path, content} entries. ' +
    'path is the filename the resource should be stored as (e.g. "csp-ai-agent.mdc", "SKILL.md"). ' +
    'Single-file upload: one entry in files[]. Multi-file upload: multiple entries. ' +
    'No restriction on file extensions — mcp packages may include .py, .js, package.json, etc.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      resource_id: {
        type: 'string',
        description: 'Unique resource identifier used as commit label and for duplicate detection',
      },
      name: {
        type: 'string',
        description: 'Human-readable resource name sent to the CSP API (defaults to resource_id if omitted)',
      },
      type: {
        type: 'string',
        enum: ['command', 'skill', 'rule', 'mcp'],
        description:
          'Resource category — MUST be confirmed with the user. ' +
          'command: single .md slash-command file; ' +
          'skill: directory with SKILL.md + supporting files; ' +
          'rule: single .mdc Cursor rule file; ' +
          'mcp: MCP server package — MUST include mcp-config.json (defines command/args/env for auto-registration into ~/.cursor/mcp.json).',
      },
      message: {
        type: 'string',
        description: 'Git commit message (5-200 characters)',
      },
      target_source: {
        type: 'string',
        description:
          'Target source repo name on the CSP server. ' +
          'Ask the user which repo to target. Typical values: "csp" (default), "client-sdk-ai-hub". ' +
          'The CSP server will commit the resource to the corresponding Git repo.',
      },
      files: {
        type: 'array',
        description:
          'List of files to upload. Read each file from the user\'s local machine and pass content here. ' +
          'path is the filename the resource should be stored as on the server. ' +
          'Examples (type="rule"): [{path: "csp-ai-agent.mdc", content: "..."}]. ' +
          'Examples (type="skill"): [{path: "SKILL.md", content: "..."}, {path: "examples.md", content: "..."}]. ' +
          'Examples (type="mcp"): [{path: "server.py", content: "..."}, {path: "mcp-config.json", content: "..."}]. ' +
          'No restriction on file extension.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path under the type subdirectory' },
            content: { type: 'string', description: 'Full text content of the file' },
          },
          required: ['path', 'content'],
        },
      },
      team: {
        type: 'string',
        description: 'Team / group name (defaults to Client-Public)',
        default: 'Client-Public',
      },
      force: {
        type: 'boolean',
        description: 'Overwrite if a resource with the same name already exists',
        default: false,
      },
    },
    required: ['resource_id', 'type', 'message', 'files'],
  },
  handler: uploadResource,
};
