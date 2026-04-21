/**
 * PromptCache: manages the .prompt-cache/ directory inside the MCP Server's
 * runtime working directory.
 *
 * Cache files hold the fully-expanded Prompt content for each Command/Skill
 * resource so that the MCP Prompt handler can serve them without re-generating
 * on every invocation.
 *
 * The cache directory is intentionally NOT committed to Git — it is regenerated
 * from the canonical source files after every git pull or resource upload.
 *
 * File naming: {type}-{resource_id}.md
 *   e.g.  cmd-client-sdk-generate-testcase.md
 *         skill-client-sdk-analyze-sdk-log.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

/** Relative directory name inside the MCP Server CWD for cached Prompt files. */
const CACHE_DIR_NAME = '.prompt-cache';

export class PromptCache {
  private readonly cacheDir: string;

  /**
   * @param baseDir  Absolute base directory (defaults to process.cwd()).
   */
  constructor(baseDir: string = process.cwd()) {
    this.cacheDir = path.join(baseDir, CACHE_DIR_NAME);
  }

  /** Absolute path to the cache directory. */
  get directory(): string {
    return this.cacheDir;
  }

  /** Ensure the cache directory exists (idempotent). */
  ensureDir(): void {
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  /**
   * Derive the cache file name for a resource.
   * @param resourceType  'command' | 'skill'
   * @param resourceId    Canonical resource ID
   */
  private cacheFileName(resourceType: string, resourceId: string): string {
    // Normalise type prefix: 'command' → 'cmd', 'skill' → 'skill'
    const prefix = resourceType === 'command' ? 'cmd' : resourceType;
    // Sanitise resourceId — remove characters unsafe in filenames.
    const safeId = resourceId.replace(/[/\\:*?"<>|]/g, '-');
    return `${prefix}-${safeId}.md`;
  }

  /** Absolute path to the cache file for a given resource. */
  cachePath(resourceType: string, resourceId: string): string {
    return path.join(this.cacheDir, this.cacheFileName(resourceType, resourceId));
  }

  /**
   * Write (or overwrite) a resource's Prompt content to the cache.
   * Uses atomic write-then-rename to prevent partial reads.
   *
   * @param resourceType  'command' | 'skill'
   * @param resourceId    Canonical resource ID
   * @param content       Fully-expanded Prompt Markdown content
   */
  write(resourceType: string, resourceId: string, content: string): void {
    this.ensureDir();
    const dest = this.cachePath(resourceType, resourceId);
    const tmp = `${dest}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, dest);
      logger.debug(
        { resourceId, resourceType, path: dest },
        'Prompt cache written',
      );
    } catch (err) {
      // Best-effort cleanup of temp file
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw new Error(
        `Failed to write prompt cache for ${resourceId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Read the cached Prompt content for a resource.
   * Returns null if the cache file does not exist or cannot be read.
   *
   * @param resourceType  'command' | 'skill'
   * @param resourceId    Canonical resource ID
   */
  read(resourceType: string, resourceId: string): string | null {
    const p = this.cachePath(resourceType, resourceId);
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Delete the cache file for a resource.
   * Silently succeeds if the file does not exist.
   *
   * @param resourceType  'command' | 'skill'
   * @param resourceId    Canonical resource ID
   */
  delete(resourceType: string, resourceId: string): void {
    const p = this.cachePath(resourceType, resourceId);
    try {
      fs.unlinkSync(p);
      logger.debug({ resourceId, resourceType }, 'Prompt cache deleted');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(
          { resourceId, error: (err as Error).message },
          'Failed to delete prompt cache file',
        );
      }
    }
  }

  /**
   * Check whether a valid cache entry exists for a resource.
   *
   * @param resourceType  'command' | 'skill'
   * @param resourceId    Canonical resource ID
   */
  exists(resourceType: string, resourceId: string): boolean {
    return fs.existsSync(this.cachePath(resourceType, resourceId));
  }
}

/** Singleton cache instance using the process CWD as the base directory. */
export const promptCache = new PromptCache();
