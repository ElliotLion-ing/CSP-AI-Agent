/**
 * resolve_prompt_content Tool
 *
 * Stable fallback for retrieving the fully resolved body of a dynamically
 * subscribed Command or Skill without relying on Cursor to issue prompts/get.
 *
 * Extended with `resource_path` parameter to support lazy-loading of internal
 * md files referenced inside SKILL.md / COMMAND.md.  When resource_path is
 * provided the server reads that specific sub-file from the local git checkout
 * and applies the same reference-expansion so nested references (A→B→C) are
 * resolved correctly at each level without bloating the initial context.
 */

import * as path from 'path';
import { logger } from '../utils/logger';
import { promptManager } from '../prompts/index.js';
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
 * Reads the file from the server-side git checkout, applies reference
 * expansion on its content (so nested A→B→C references are handled at
 * each level), and returns the expanded content.
 *
 * Security: the resourcePath is normalised and validated to prevent
 * path traversal outside the skill directory.
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

  // Resolve the resource name from the registered prompt.
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

  // Read all files for this resource from the local git checkout.
  const sourceFiles = await multiSourceGitManager.readResourceFiles(resourceName, resourceType);

  // Find the requested sub-file.
  const target = sourceFiles.find(
    (f) => path.normalize(f.path).replace(/\\/g, '/').replace(/^\.\//, '') === normPath,
  );

  if (!target) {
    logger.warn(
      { resourceName, resourcePath: normPath, availablePaths: sourceFiles.map((f) => f.path) },
      'resolve_prompt_content: requested sub-resource file not found in git checkout',
    );
    return {
      success: false,
      error: {
        code: 'RESOURCE_FILE_NOT_FOUND',
        message: `File "${normPath}" not found in resource "${resourceName}". Available files: ${sourceFiles.map((f) => f.path).join(', ')}`,
      },
    };
  }

  // Expand any internal references in the sub-file (supports A→B→C nesting).
  const { expandedContent } = expandMdReferences(target.content, resolvedResourceId);

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
