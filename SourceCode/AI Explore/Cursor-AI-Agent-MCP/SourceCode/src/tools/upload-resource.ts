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

type ResourceCategory = 'command' | 'skill' | 'rule' | 'mcp';

/**
 * Infer the resource type from the uploaded file list ONLY when the user has
 * not explicitly stated a type. If the user declared a type, that always wins.
 *
 * Auto-detection rules (in priority order, applied only when declaredType is absent):
 *   1. Any file named "mcp-config.json"       → mcp
 *   2. Any file named "SKILL.md"              → skill
 *   3. Single file ending with ".mdc"         → rule
 *   4. Single file ending with ".md"          → command
 *   5. Cannot determine                       → throw validation error
 */
function inferResourceType(
  declaredType: ResourceCategory | undefined,
  files: FileEntry[]
): ResourceCategory {
  // User explicitly specified the type — honour it unconditionally.
  if (declaredType) return declaredType;

  const names = files.map((f) => path.basename(f.path).toLowerCase());

  if (names.includes('mcp-config.json')) return 'mcp';
  if (names.includes('skill.md'))        return 'skill';
  if (files.length === 1) {
    if (names[0]!.endsWith('.mdc')) return 'rule';
    if (names[0]!.endsWith('.md'))  return 'command';
  }

  throw createValidationError(
    'type',
    'required',
    'Cannot auto-detect the resource type from the provided files. ' +
    'Please specify "type" explicitly: "command" (single .md), "skill" (contains SKILL.md), ' +
    '"rule" (single .mdc), or "mcp" (contains mcp-config.json).'
  );
}

/**
 * Derive a human-readable resource name from the primary file in the upload list.
 * The original filename (without extension) is used as-is — never renamed.
 *
 *   - Single-file upload:  strip extension from the filename.
 *                          "code-review.md" → "code-review"
 *                          "csp-agent.mdc"  → "csp-agent"
 *   - Multi-file upload:   use the top-level directory name when the first
 *                          path contains a directory component.
 *                          "code-review/SKILL.md" → "code-review"
 *                          Falls back to the first file's base name otherwise.
 *
 * Returns undefined when the files array is empty (caller should error).
 */
function deriveNameFromFiles(files: FileEntry[]): string | undefined {
  if (!files || files.length === 0) return undefined;

  const first = files[0]!.path;

  // For paths like "code-review/SKILL.md", use the top-level directory.
  const dir = path.dirname(first);
  if (dir && dir !== '.') return dir;

  // Strip extension from bare filename.
  const base = path.basename(first, path.extname(first));
  return base || undefined;
}

/**
 * Validate and return the files[] array.
 * Each entry path must be a relative path with no traversal.
 * For MCP resources, mcp-config.json must be present.
 *
 * @param resolvedType The already-inferred resource type (never undefined here).
 */
function collectFiles(typedParams: UploadResourceParams, resolvedType: string): FileEntry[] {
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
  if (resolvedType === 'mcp') {
    const hasMcpConfig = typedParams.files.some(
      (f) => path.basename(f.path) === 'mcp-config.json'
    );
    if (!hasMcpConfig) {
      // Look for other files that might already describe the server configuration
      // (e.g. pyproject.toml, package.json, README.md, config.json, server.py).
      // If found, surface a targeted hint so the user knows exactly what to create.
      const configHints = typedParams.files
        .map((f) => path.basename(f.path))
        .filter((n) =>
          /\.(toml|yaml|yml|json|cfg|ini|conf|py|js|ts|md)$/i.test(n) &&
          n !== 'mcp-config.json'
        );

      const hintNote =
        configHints.length > 0
          ? `\nFound related files (${configHints.join(', ')}) that may already describe the server ` +
            `configuration — please create "mcp-config.json" based on those files.`
          : '';

      throw createValidationError(
        'files',
        'required',
        'MCP resources must include a "mcp-config.json" file. ' +
        'This file tells the client how to start the MCP server after installation.' +
        hintNote +
        '\n\nRequired format:\n' +
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
    const resourceId   = typedParams.resource_id;
    const userToken    = typedParams.user_token;
    const targetSource = typedParams.target_source ?? 'csp';
    const force        = (typedParams as any).force || false;

    // User-declared type always wins; auto-detect only when omitted.
    const resourceType = inferResourceType(typedParams.type, typedParams.files);

    // Name: explicit user value > derived from filename (no extension).
    // Never fall back to resource_id — that is an internal identifier, not a name.
    const derivedName = typedParams.name ?? deriveNameFromFiles(typedParams.files);
    if (!derivedName) {
      throw createValidationError(
        'name',
        'required',
        'Could not determine a resource name from the provided files. ' +
        'Please provide a "name" field explicitly.'
      );
    }
    const resourceName = derivedName;

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
    const fileEntries = collectFiles(typedParams, resourceType);
    logger.info({ resourceId, fileCount: fileEntries.length }, 'Files collected for upload');

    // ========== Step 5: Call CSP API — upload (staging) ==========
    logger.info({ resourceName, resourceType, targetSource }, 'Calling CSP upload API...');
    const uploadResp = await apiClient.uploadResourceFiles(
      {
        type: resourceType,
        name: resourceName,
        files: fileEntries,
        target_source: targetSource,
        force,
      },
      userToken
    );

    const uploadId = uploadResp.upload_id;
    logger.info({ uploadId, expiresAt: uploadResp.expires_at }, 'Upload staged successfully');

    // ========== Step 6: Call CSP API — finalize (Git commit) ==========
    logger.info({ uploadId }, 'Calling CSP finalize API...');
    const finalizeResp = await apiClient.finalizeResourceUpload(uploadId, typedParams.message, userToken);

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
    'The user selects files from their local machine — read each file and pass its content in files[]. ' +
    'ALWAYS confirm the target source repo with the user (e.g. "csp" (default) or "client-sdk-ai-hub"). ' +

    '\n\nResource type rules:\n' +
    '  • If the user explicitly states the type, use it as-is — no overriding.\n' +
    '  • If the user does NOT state a type, auto-detect from file structure:\n' +
    '      - Contains mcp-config.json  → type="mcp"\n' +
    '      - Contains SKILL.md         → type="skill"\n' +
    '      - Single .mdc file          → type="rule"\n' +
    '      - Single .md file           → type="command"\n' +
    '  • If the user says type="mcp" but mcp-config.json is missing, the tool will\n' +
    '    return an error with a hint about creating mcp-config.json.\n' +

    '\n\nResource name rules:\n' +
    '  • If the user provides a name, use it.\n' +
    '  • Otherwise derive the name from the filename WITHOUT its extension.\n' +
    '    Keep the original filename — NEVER rename files (e.g. do not rename any .md file).\n' +
    '    Examples: "code-review.md" → name="code-review"; "code-review/SKILL.md" → name="code-review".\n' +

    '\n\nPass files[] — an array of {path, content} entries. ' +
    'path must be the original filename as-is (relative, no path traversal). ' +
    'No restriction on file extensions — mcp packages may include .py, .js, package.json, etc.\n' +

    '\nIMPORTANT: Always read the CSP_API_TOKEN from the user\'s environment and pass it as user_token ' +
    'so that each user\'s API calls use their own identity.',
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
          'Resource category. Auto-detected from file structure — only set explicitly when detection is ambiguous. ' +
          'command: single .md slash-command file; ' +
          'skill: directory or file set containing SKILL.md; ' +
          'rule: single .mdc Cursor rule file; ' +
          'mcp: MCP server package — MUST include mcp-config.json.',
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
      user_token: {
        type: 'string',
        description:
          'CSP API token for the current user. Read this from the CSP_API_TOKEN environment ' +
          'variable configured in the user\'s mcp.json. When provided, this token is used ' +
          'for all CSP API calls in this request instead of the server-level fallback token.',
      },
    },
    required: ['resource_id', 'message', 'files'],
  },
  handler: uploadResource,
};
