/**
 * resolve_prompt_content Tool
 *
 * Stable fallback for retrieving the fully resolved body of a dynamically
 * subscribed Command or Skill without relying on Cursor to issue prompts/get.
 */

import { logger } from '../utils/logger';
import { promptManager } from '../prompts/index.js';
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

  if (!promptName && !resourceId) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Either prompt_name or resource_id is required',
      },
    };
  }

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

export const resolvePromptContentTool = {
  name: 'resolve_prompt_content',
  description:
    'Retrieve the fully resolved content of a Command or Skill prompt without relying on native prompts/get. ' +
    'Use this immediately after search_resources -> manage_subscription -> sync_resources when you need the prompt body in the same workflow. ' +
    'Provide either prompt_name (for example "command/acm-helper") or resource_id. ' +
    'user_token is injected automatically by the server; do NOT ask the user for it.',
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
    },
  },
  handler: resolvePromptContent,
};
