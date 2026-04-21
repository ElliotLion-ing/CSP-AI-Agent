/**
 * resolve_prompt_content Tool
 *
 * Stable fallback for retrieving the fully resolved body of a dynamically
 * subscribed Command or Skill without relying on Cursor to issue prompts/get.
 *
 * Extended with `resource_path` parameter to support lazy-loading of internal
 * md files referenced inside SKILL.md / COMMAND.md.  When resource_path is
 * provided the server resolves that specific sub-file using the following
 * priority chain (most reliable → least reliable):
 *
 *   1. CSP API download  — `downloadResource(resourceId)` returns ALL files for
 *      the resource including sub-files.  This is the primary and most reliable
 *      source because it does not depend on any local git checkout.
 *   2. Local filesystem  — `readResourceFiles()` reads from the server-side
 *      git checkout directory (Docker-mounted or manually cloned).  Used when
 *      the API call fails or the sub-file is absent from the API response.
 *   3. Git (implicit)   — already the lowest layer inside readResourceFiles();
 *      only reached if neither of the above sources has the file.
 *
 * This ordering eliminates the dependency on a correctly-configured local git
 * checkout for the common case, making sub-resource resolution robust even
 * when git clone/pull has not been configured on the server.
 */

import * as path from 'path';
import { logger } from '../utils/logger';
import { promptManager } from '../prompts/index.js';
import { apiClient } from '../api/client.js';
import { multiSourceGitManager } from '../git/multi-source-manager.js';
import { expandMdReferences } from '../utils/md-reference-expander.js';
import type {
  ResolvePromptContentParams,
  ResolvePromptContentResult,
  ToolResult,
} from '../types/tools';

export async function resolvePromptContent(
  params: unknown,
): Promise<ToolResult<ResolvePromptContentResult>> {
  const p = params as ResolvePromptContentParams;
  const promptName = typeof p.prompt_name === 'string' && p.prompt_name.trim() !== ''
    ? p.prompt_name.trim()
    : undefined;
  const resourceId = typeof p.resource_id === 'string' && p.resource_id.trim() !== ''
    ? p.resource_id.trim()
    : undefined;
  const userToken = typeof p.user_token === 'string' ? p.user_token : '';
  const jiraId = typeof p.jira_id === 'string' && p.jira_id.trim() !== ''
    ? p.jira_id.trim()
    : undefined;
  const resourcePath = typeof p.resource_path === 'string' && p.resource_path.trim() !== ''
    ? p.resource_path.trim()
    : undefined;

  if (!promptName && !resourceId) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Either prompt_name or resource_id is required',
      },
    };
  }

  // ── Sub-file mode: resource_path provided ──────────────────────────────
  // Agent is requesting a specific internal md file referenced in SKILL.md.
  // Read the file from the local git checkout, expand its own references,
  // and return the content directly (no telemetry for sub-file reads —
  // they are attributed to the parent skill invocation).
  if (resourcePath) {
    return resolveSubResource(resourceId, promptName, resourcePath, userToken);
  }

  // ── Primary mode: return main SKILL.md / COMMAND.md content ───────────
  const resolved = await promptManager.resolvePromptContentForInvocation({
    promptName,
    resourceId,
    userToken,
    jiraId,
  });

  if (!resolved) {
    const target = promptName ?? resourceId ?? 'unknown';
    logger.warn({ promptName, resourceId }, 'resolve_prompt_content: prompt not found');
    return {
      success: false,
      error: {
        code: 'PROMPT_NOT_FOUND',
        message: `Prompt "${target}" is not available. Please run sync_resources first.`,
      },
    };
  }

  logger.info(
    {
      promptName: resolved.promptName,
      resourceId: resolved.meta.resource_id,
      contentSource: resolved.contentSource,
    },
    'resolve_prompt_content: prompt resolved successfully',
  );

  return {
    success: true,
    data: {
      prompt_name: resolved.promptName,
      resource_id: resolved.meta.resource_id,
      resource_type: resolved.meta.resource_type,
      resource_name: resolved.meta.resource_name,
      description: resolved.description,
      content: resolved.content,
      content_source: resolved.contentSource,
      usage_tracked: Boolean(userToken),
    },
  };
}

/**
 * Resolve a sub-resource file (internal md referenced inside SKILL.md).
 *
 * Uses a three-tier priority chain to locate the requested file:
 *   1. CSP API  — downloadResource() returns all files for the resource;
 *      most reliable, no dependency on local git checkout.
 *   2. Local filesystem — readResourceFiles() reads from the Docker-mounted
 *      or manually-cloned server-side git checkout directory.
 *   3. Git (implicit inside readResourceFiles) — lowest priority fallback.
 *
 * After locating the file content, reference-expansion is applied so that
 * nested A→B→C references are resolved correctly at each level.
 *
 * Security: resourcePath is normalised and validated to prevent path
 * traversal outside the skill directory.
 */
async function resolveSubResource(
  resourceId: string | undefined,
  promptName: string | undefined,
  resourcePath: string,
  userToken: string,
): Promise<ToolResult<ResolvePromptContentResult>> {
  // Normalise and block path traversal attempts.
  const normPath = path.normalize(resourcePath).replace(/\\/g, '/');
  if (normPath.startsWith('..') || path.isAbsolute(normPath)) {
    logger.warn({ resourcePath, normPath }, 'resolve_prompt_content: path traversal attempt blocked');
    return {
      success: false,
      error: {
        code: 'INVALID_RESOURCE_PATH',
        message: `Invalid resource_path "${resourcePath}": must be a relative path within the skill directory.`,
      },
    };
  }

  // Resolve the resource name and type from the registered prompt.
  let resourceName: string | undefined;
  let resolvedResourceId: string | undefined;
  let resourceType: 'command' | 'skill' = 'skill';

  if (resourceId) {
    const registered = promptManager.getByResourceId(resourceId, userToken);
    if (registered) {
      resourceName = registered.meta.resource_name;
      resolvedResourceId = registered.meta.resource_id;
      resourceType = registered.meta.resource_type;
    }
  } else if (promptName) {
    const registered = promptManager.getByPromptName(promptName, userToken);
    if (registered) {
      resourceName = registered.meta.resource_name;
      resolvedResourceId = registered.meta.resource_id;
      resourceType = registered.meta.resource_type;
    }
  }

  if (!resourceName || !resolvedResourceId) {
    const target = resourceId ?? promptName ?? 'unknown';
    logger.warn(
      { resourceId, promptName, resourcePath },
      'resolve_prompt_content: parent resource not found for sub-file resolution',
    );
    return {
      success: false,
      error: {
        code: 'PROMPT_NOT_FOUND',
        message: `Parent resource "${target}" is not registered. Please run sync_resources first.`,
      },
    };
  }

  // Helper: normalise a file path the same way for comparison.
  const normFilePath = (p: string) => path.normalize(p).replace(/\\/g, '/').replace(/^\.\//, '');

  // ── Tier 1: CSP API download ───────────────────────────────────────────
  // downloadResource() returns ALL files for the resource (including sub-files
  // like reference.md). This is the primary source — it works regardless of
  // whether the server-side git checkout is configured or up-to-date.
  logger.info(
    { resourceName, resourcePath: normPath, resolvedResourceId },
    'resolveSubResource: tier-1 — attempting API download',
  );
  try {
    const downloadResult = await apiClient.downloadResource(resolvedResourceId, userToken || undefined);
    const apiFile = downloadResult.files.find((f) => normFilePath(f.path) === normPath);
    if (apiFile) {
      logger.info(
        { resourceName, resourcePath: normPath, source: 'api', contentLength: apiFile.content.length },
        'resolveSubResource: tier-1 hit — sub-file found via API download',
      );
      const { expandedContent } = expandMdReferences(apiFile.content, resolvedResourceId);
      return {
        success: true,
        data: {
          prompt_name: `skill/${resourceName}/${normPath}`,
          resource_id: resolvedResourceId,
          resource_type: resourceType,
          resource_name: resourceName,
          description: `Internal resource file: ${normPath}`,
          content: expandedContent,
          content_source: 'api',
          usage_tracked: false,
        },
      };
    }
    logger.info(
      { resourceName, resourcePath: normPath, availableApiPaths: downloadResult.files.map((f) => f.path) },
      'resolveSubResource: tier-1 miss — sub-file not in API response, falling back to local filesystem',
    );
  } catch (apiErr) {
    logger.warn(
      { resourceName, resourcePath: normPath, error: (apiErr as Error).message },
      'resolveSubResource: tier-1 failed — API download error, falling back to local filesystem',
    );
  }

  // ── Tier 2 & 3: Local filesystem / git checkout ────────────────────────
  // readResourceFiles() reads from the Docker-mounted or manually-cloned
  // server-side directory (tier 2), with git as its own internal fallback
  // (tier 3).  Neither tier requires git to be fully operational.
  logger.info(
    { resourceName, resourcePath: normPath },
    'resolveSubResource: tier-2 — attempting local filesystem read',
  );
  const sourceFiles = await multiSourceGitManager.readResourceFiles(resourceName, resourceType);
  const localFile = sourceFiles.find((f) => normFilePath(f.path) === normPath);

  if (!localFile) {
    logger.warn(
      { resourceName, resourcePath: normPath, availablePaths: sourceFiles.map((f) => f.path) },
      'resolveSubResource: all tiers exhausted — sub-resource file not found',
    );
    return {
      success: false,
      error: {
        code: 'RESOURCE_FILE_NOT_FOUND',
        message:
          `File "${normPath}" not found in resource "${resourceName}". ` +
          `Tried: (1) CSP API download, (2) local filesystem/git checkout. ` +
          `Available local files: ${sourceFiles.map((f) => f.path).join(', ') || '(none)'}`,
      },
    };
  }

  logger.info(
    { resourceName, resourcePath: normPath, source: 'local', contentLength: localFile.content.length },
    'resolveSubResource: tier-2 hit — sub-file found in local filesystem',
  );

  // Expand any internal references in the sub-file (supports A→B→C nesting).
  const { expandedContent } = expandMdReferences(localFile.content, resolvedResourceId);

  logger.info(
    { resourceName, resourcePath: normPath, contentLength: expandedContent.length },
    'resolve_prompt_content: sub-resource file resolved successfully',
  );

  return {
    success: true,
    data: {
      prompt_name: `skill/${resourceName}/${normPath}`,
      resource_id: resolvedResourceId,
      resource_type: resourceType,
      resource_name: resourceName,
      description: `Internal resource file: ${normPath}`,
      content: expandedContent,
      content_source: 'cache',
      usage_tracked: false,
    },
  };
}

export const resolvePromptContentTool = {
  name: 'resolve_prompt_content',
  description:
    'Retrieve the fully resolved content of a Command or Skill prompt without relying on native prompts/get. ' +
    'Use this immediately after search_resources -> manage_subscription -> sync_resources when you need the prompt body in the same workflow. ' +
    'Provide either prompt_name (for example "command/acm-helper") or resource_id. ' +
    'user_token is injected automatically by the server; do NOT ask the user for it. ' +
    'When SKILL.md content contains [MANDATORY] tool call blocks with resource_path, call this tool again with ' +
    'the same resource_id and the specified resource_path to lazily fetch the referenced internal md file.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      prompt_name: {
        type: 'string',
        description: 'Registered MCP prompt name, for example "command/acm-helper".',
      },
      resource_id: {
        type: 'string',
        description: 'Canonical CSP resource ID for the Command or Skill.',
      },
      user_token: {
        type: 'string',
        description: 'DO NOT set this field — it is injected automatically by the server.',
      },
      jira_id: {
        type: 'string',
        description: 'Optional Jira issue ID for usage correlation.',
      },
      resource_path: {
        type: 'string',
        description:
          'Optional relative path to an internal md file within the skill/command resource. ' +
          'Used to lazily fetch md files that are referenced inside SKILL.md via [MANDATORY] tool call blocks. ' +
          'Example: "references/reference.md". Must be a relative path (no ".." traversal).',
      },
    },
  },
  handler: resolvePromptContent,
};
