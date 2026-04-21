/**
 * Markdown Internal Reference Expander
 *
 * Replaces internal markdown file references found in SKILL.md / COMMAND.md
 * with mandatory resolve_prompt_content tool call instructions.
 *
 * Design rationale (v2 — lazy-load via tool call):
 *   - Inlining referenced md files into SKILL.md inflates the agent context
 *     even when the content is never needed for the current task.
 *   - Instead, every internal reference is replaced with a structured
 *     [MANDATORY] tool call block that forces the agent to call
 *     resolve_prompt_content(resource_id, resource_path) on demand.
 *   - The server-side handler for resource_path applies the same expansion,
 *     so A→B→C nested references are naturally supported depth-first.
 *   - No local write_file actions are generated for md files.
 *   - No size threshold judgement needed — all references are treated equally.
 *
 * External URLs and anchor-only links are always left untouched.
 */

import { logger } from './logger.js';

export interface ExpandMdReferencesResult {
  /** SKILL.md content with all internal md references replaced by tool call instructions */
  expandedContent: string;
}

/**
 * Expand internal markdown references inside `content` by replacing each
 * reference with a mandatory resolve_prompt_content tool call instruction.
 *
 * @param content      Raw markdown content (SKILL.md / COMMAND.md)
 * @param resourceId   The canonical CSP resource ID for this skill/command.
 *                     Embedded into the generated tool call so the agent
 *                     has an unambiguous handle to pass back to the server.
 * @returns            Expanded content (references replaced by tool call blocks)
 */
export function expandMdReferences(
  content: string,
  resourceId: string,
): ExpandMdReferencesResult {
  const expandedContent = content.replace(
    INTERNAL_MD_LINK_RE,
    (_fullMatch, _linkText, rawHref) => {
      // Strip optional anchor suffix before recording the path.
      const anchorIdx = rawHref.indexOf('#');
      const hrefPath = anchorIdx >= 0 ? rawHref.slice(0, anchorIdx) : rawHref;
      const normHref = normalizePath(hrefPath);

      logger.info(
        { resourceId, href: rawHref, normHref },
        'expandMdReferences: replacing internal md reference with tool call instruction',
      );

      return buildToolCallBlock(resourceId, normHref);
    },
  );

  return { expandedContent };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Regex to match markdown links with relative (internal) targets.
 *
 * Matches:  [any text](relative/path/to/file.md)
 *           [any text](./relative/path/to/file.md)
 *
 * Does NOT match:
 *   [text](https://...)   external URLs
 *   [text](#anchor)       anchor-only links
 *   [text](http://...)    external URLs
 */
const INTERNAL_MD_LINK_RE =
  /\[([^\]]*)\]\(((?!https?:\/\/|#)[^)]+\.md(?:#[^)]*)?)\)/g;

/**
 * Normalise a relative file path by removing a leading "./".
 *   "./references/ref.md" → "references/ref.md"
 *   "references/ref.md"  → "references/ref.md"
 */
function normalizePath(p: string): string {
  return p.replace(/^\.\//, '');
}

/**
 * Build the mandatory tool call instruction block that replaces an internal
 * md reference link.  The agent MUST execute this call before proceeding.
 *
 * Format is intentionally terse and machine-readable so the agent can parse
 * the arguments without ambiguity.
 */
function buildToolCallBlock(resourceId: string, resourcePath: string): string {
  const args = JSON.stringify({ resource_id: resourceId, resource_path: resourcePath });
  return (
    `\n<!-- SKILL_RESOURCE_REF: ${resourcePath} -->\n` +
    `**[MANDATORY — 立即执行，不可跳过]** 调用以下工具获取必要内容后再继续：\n` +
    `\`\`\`json\n` +
    `{"tool": "resolve_prompt_content", "arguments": ${args}}\n` +
    `\`\`\`\n` +
    `<!-- END_SKILL_RESOURCE_REF -->\n`
  );
}
