/**
 * PromptGenerator: converts raw Command/Skill Markdown assets into MCP Prompt content.
 *
 * Two-step pipeline:
 *  1. parseMarkdownWithImports — recursively inline `import 'path'` directives.
 *  2. replaceMDVariables       — substitute ${VAR} placeholders with runtime values.
 *
 * The resulting string is returned to the caller who can pass it directly as
 * the MCP Prompt message text, or write it to the .prompt-cache/ directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// Maximum import recursion depth to guard against circular imports.
const MAX_IMPORT_DEPTH = 20;

// Matches lines like:  import 'relative/path/to/file.md'
const IMPORT_REGEX = /^import\s+['"]([^'"]+)['"]\s*$/gm;

/**
 * Recursively resolve and inline all `import 'path'` statements in a Markdown
 * file.  Each imported file's content replaces its import statement in the
 * parent document.
 *
 * @param filePath  Absolute path to the root Markdown file.
 * @param depth     Current recursion depth (used for cycle detection).
 * @returns         Fully expanded Markdown string.
 */
export async function parseMarkdownWithImports(
  filePath: string,
  depth = 0,
): Promise<string> {
  if (depth > MAX_IMPORT_DEPTH) {
    throw new Error(
      `Import depth exceeded ${MAX_IMPORT_DEPTH} levels at ${filePath}. ` +
      'Check for circular imports.',
    );
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read Markdown file: ${filePath} — ${(err as Error).message}`);
  }

  const fileDir = path.dirname(filePath);
  const matches: Array<{ statement: string; resolvedPath: string }> = [];

  let match: RegExpExecArray | null;
  // Reset lastIndex before each exec loop (regex is stateful with 'g' flag).
  IMPORT_REGEX.lastIndex = 0;
  while ((match = IMPORT_REGEX.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath) {
      matches.push({
        statement: match[0],
        resolvedPath: path.resolve(fileDir, importPath),
      });
    }
  }

  // Process imports sequentially to preserve insertion order.
  for (const { statement, resolvedPath } of matches) {
    try {
      const importedContent = await parseMarkdownWithImports(resolvedPath, depth + 1);
      content = content.replace(statement, importedContent);
    } catch (err) {
      logger.warn(
        { importPath: resolvedPath, parentFile: filePath, error: (err as Error).message },
        'Failed to resolve import — leaving placeholder in place',
      );
    }
  }

  return content;
}

/**
 * Replace ${VARIABLE_NAME} placeholders in content with values from the
 * provided variable map.  Variables not found in the map are left unchanged so
 * they remain visible in the output for debugging.
 *
 * @param content   Markdown string (after import expansion).
 * @param variables Key-value map of variable names to their replacement strings.
 * @returns         Content with placeholders substituted.
 */
export function replaceMDVariables(
  content: string,
  variables: Record<string, string>,
): string {
  let result = content;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
    result = result.replace(regex, value);
  }
  return result;
}

/**
 * High-level entry point: expand imports then substitute variables.
 *
 * @param filePath  Absolute path to the root Markdown file.
 * @param variables Optional variable substitution map (defaults to empty).
 * @returns         Final Prompt content ready for MCP registration.
 */
export async function generatePromptContent(
  filePath: string,
  variables: Record<string, string> = {},
): Promise<string> {
  const expanded = await parseMarkdownWithImports(filePath);
  return replaceMDVariables(expanded, variables);
}

/**
 * Generate Prompt content from a raw Markdown string (no file I/O).
 * Used when the resource content has already been downloaded from the API.
 *
 * @param rawContent Raw Markdown string.
 * @param basePath   Absolute directory used to resolve relative `import` paths.
 * @param variables  Optional variable substitution map.
 * @returns          Final Prompt content.
 */
export async function generatePromptContentFromString(
  rawContent: string,
  basePath: string,
  variables: Record<string, string> = {},
): Promise<string> {
  // Write to a temp file so parseMarkdownWithImports can resolve relative imports.
  const tmpPath = path.join(basePath, `.tmp-prompt-${Date.now()}-${process.pid}.md`);
  let result: string;
  try {
    fs.mkdirSync(basePath, { recursive: true });
    fs.writeFileSync(tmpPath, rawContent, 'utf8');
    result = await parseMarkdownWithImports(tmpPath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
  }
  return replaceMDVariables(result, variables);
}
