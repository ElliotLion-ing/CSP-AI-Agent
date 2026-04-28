/**
 * Multi-Source Git Manager
 * Manages multiple AI Resources Git repositories efficiently
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import simpleGit from 'simple-git';
import { logger } from '../utils/logger';
import { createGitError } from '../types/errors';

interface AIResourcesConfig {
  version: string;
  default_source: SourceConfig;
  extended_sources: SourceConfig[];
}

interface SourceConfig {
  name: string;
  path: string;
  enabled: boolean;
  priority: number;
  git_url?: string;  // Git repository URL
  git_branch?: string;  // Git branch (default: main)
  resources: {
    commands: string | string[];
    skills: string | string[];
    mcp: string | string[];
    rules: string | string[];
  };
  description: string;
}

/** Normalise a single-string or array-of-strings resource dir config to always be an array. */
function normalizePaths(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

interface SyncResult {
  source: string;
  action: 'cloned' | 'pulled' | 'up-to-date' | 'skipped';
  changes: number;
  duration: number;
}

class MultiSourceGitManager {
  private configPath: string;
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.configPath = path.join(baseDir, 'ai-resources-config.json');
  }

  /**
   * Load AI Resources configuration
   */
  private async loadConfig(): Promise<AIResourcesConfig> {
    try {
      const configContent = await fs.readFile(this.configPath, 'utf-8');
      return JSON.parse(configContent) as AIResourcesConfig;
    } catch (error) {
      throw new Error(`Failed to load AI Resources config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get all enabled sources (including default)
   */
  private async getEnabledSources(): Promise<SourceConfig[]> {
    const config = await this.loadConfig();
    const sources: SourceConfig[] = [];

    if (config.default_source.enabled) {
      sources.push(config.default_source);
    }

    if (config.extended_sources) {
      sources.push(...config.extended_sources.filter(s => s.enabled));
    }

    return sources;
  }

  /**
   * Check if a Git repository exists at the given path
   */
  private async repositoryExists(repoPath: string): Promise<boolean> {
    try {
      const gitDir = path.join(repoPath, '.git');
      const stats = await fs.stat(gitDir);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Get Git repository URL from existing repo
   */
  private async getRepoUrl(repoPath: string): Promise<string | null> {
    try {
      const git = simpleGit(repoPath);
      const remotes = await git.getRemotes(true);
      const origin = remotes.find(r => r.name === 'origin');
      return origin?.refs.fetch || null;
    } catch {
      return null;
    }
  }

  /**
   * Clone a Git repository
   */
  private async cloneRepository(repoUrl: string, targetPath: string, branch: string = 'main'): Promise<void> {
    try {
      logger.info({ repoUrl, targetPath, branch }, 'Cloning Git repository...');
      
      // Ensure parent directory exists
      const parentDir = path.dirname(targetPath);
      await fs.mkdir(parentDir, { recursive: true });

      const git = simpleGit();

      // Clone with --single-branch to limit downloaded history to the target
      // branch only, keeping the clone fast without creating a shallow repo
      // (shallow repos cause "no merge base" errors on subsequent fetches).
      await git.clone(repoUrl, targetPath, [
        '--branch', branch,
        '--single-branch',
      ]);

      logger.info({ repoUrl, targetPath }, 'Repository cloned successfully');
    } catch (error) {
      throw createGitError('clone', error as Error, repoUrl);
    }
  }

  /**
   * Pull latest changes using fetch + fast-forward merge.
   *
   * Deliberately avoids --depth=1 on fetch: shallow fetches truncate local
   * history, causing "no merge base" divergence errors on subsequent pulls.
   */
  private async pullRepository(repoPath: string, branch: string = 'main'): Promise<{
    hasChanges: boolean;
    filesChanged: number;
  }> {
    try {
      const git = simpleGit(repoPath);

      // ── Step 1: read local HEAD commit before fetch ──────────────────────
      let localHead = '<unknown>';
      try {
        localHead = (await git.revparse(['HEAD'])).trim();
      } catch (e) {
        logger.warn({ repoPath, error: (e as Error).message }, 'git pull: failed to read local HEAD');
      }

      // ── Step 2: check current remotes ────────────────────────────────────
      let remotes: Array<{ name: string; refs: { fetch: string; push: string } }> = [];
      try {
        remotes = await git.getRemotes(true);
      } catch (e) {
        logger.warn({ repoPath, error: (e as Error).message }, 'git pull: failed to list remotes');
      }

      logger.info({
        repoPath,
        branch,
        localHead,
        remotes: remotes.map((r) => ({ name: r.name, fetch: r.refs.fetch })),
      }, 'git pull: starting — reading local state');

      // ── Step 3: detect shallow repo ──────────────────────────────────────
      let isShallow = false;
      try {
        isShallow = (await git.raw(['rev-parse', '--is-shallow-repository'])).trim() === 'true';
      } catch (e) {
        logger.warn({ repoPath, error: (e as Error).message }, 'git pull: failed to check shallow status — assuming not shallow');
      }

      logger.info({ repoPath, isShallow }, 'git pull: shallow-repository check complete');

      // ── Step 4: fetch ─────────────────────────────────────────────────────
      if (isShallow) {
        logger.info({ repoPath, branch }, 'git pull: shallow repo detected — running fetch --unshallow');
        try {
          await git.fetch(['--unshallow', 'origin', branch]);
          logger.info({ repoPath, branch }, 'git pull: fetch --unshallow succeeded');
        } catch (fetchErr) {
          logger.error({ repoPath, branch, error: (fetchErr as Error).message }, 'git pull: fetch --unshallow FAILED');
          throw fetchErr;
        }
      } else {
        logger.info({ repoPath, branch }, 'git pull: running fetch origin');
        try {
          await git.fetch(['origin', branch]);
          logger.info({ repoPath, branch }, 'git pull: fetch origin succeeded');
        } catch (fetchErr) {
          logger.error({ repoPath, branch, error: (fetchErr as Error).message }, 'git pull: fetch origin FAILED');
          throw fetchErr;
        }
      }

      // ── Step 5: read remote HEAD after fetch ─────────────────────────────
      const remoteBranch = `origin/${branch}`;
      let remoteHead = '<unknown>';
      try {
        remoteHead = (await git.revparse([remoteBranch])).trim();
      } catch (e) {
        logger.warn({ repoPath, remoteBranch, error: (e as Error).message }, 'git pull: failed to read remote HEAD after fetch');
      }

      logger.info({ repoPath, localHead, remoteHead, remoteBranch }, 'git pull: comparing local HEAD vs remote HEAD');

      // ── Step 6: diff to detect actual file changes ────────────────────────
      let diffSummary = { files: [] as { file: string }[], insertions: 0, deletions: 0 };
      try {
        diffSummary = await git.diffSummary([`HEAD...${remoteBranch}`]);
      } catch (e) {
        logger.warn({ repoPath, remoteBranch, error: (e as Error).message }, 'git pull: diffSummary failed — assuming no changes');
      }

      const hasChanges = diffSummary.files.length > 0;

      logger.info({
        repoPath,
        branch,
        remoteBranch,
        hasChanges,
        filesChanged: diffSummary.files.length,
        changedFiles: diffSummary.files.map((f) => f.file),
        insertions: diffSummary.insertions,
        deletions: diffSummary.deletions,
      }, hasChanges ? 'git pull: diff found changes — will merge' : 'git pull: repository is up-to-date');

      if (!hasChanges) {
        return { hasChanges: false, filesChanged: 0 };
      }

      // ── Step 7: fast-forward merge ────────────────────────────────────────
      logger.info({ repoPath, remoteBranch, filesChanged: diffSummary.files.length }, 'git pull: running merge --ff-only');
      try {
        await git.merge([remoteBranch, '--ff-only']);
      } catch (mergeErr) {
        logger.error({ repoPath, remoteBranch, error: (mergeErr as Error).message }, 'git pull: merge --ff-only FAILED');
        throw mergeErr;
      }

      // ── Step 8: read new HEAD after merge ────────────────────────────────
      let newHead = '<unknown>';
      try {
        newHead = (await git.revparse(['HEAD'])).trim();
      } catch { /* non-critical */ }

      logger.info({
        repoPath,
        branch,
        prevHead: localHead,
        newHead,
        filesChanged: diffSummary.files.length,
        insertions: diffSummary.insertions,
        deletions: diffSummary.deletions,
      }, 'git pull: repository updated successfully');

      return { hasChanges: true, filesChanged: diffSummary.files.length };
    } catch (error) {
      throw createGitError('pull', error as Error, repoPath);
    }
  }

  /**
   * Sync a single source repository
   */
  private async syncSource(source: SourceConfig): Promise<SyncResult> {
    const startTime = Date.now();
    const sourcePath = path.join(this.baseDir, source.path);
    const branch = source.git_branch || 'main';

    logger.info({
      source: source.name,
      path: sourcePath,
      priority: source.priority,
      git_url: source.git_url ?? '(not configured)',
      branch,
    }, 'Syncing AI Resources source...');

    try {
      const exists = await this.repositoryExists(sourcePath);

      logger.info({
        source: source.name,
        sourcePath,
        repoExists: exists,
        git_url: source.git_url ?? null,
        branch,
      }, 'syncSource: repository existence check complete');

      if (!exists) {
        if (!source.git_url) {
          // No git_url means the directory is Docker-mounted or manually placed —
          // files should already be present on disk.  Skip clone and let
          // readResourceFiles serve them directly.
          logger.warn({
            source: source.name,
            sourcePath,
            reason: 'git_url not configured in ai-resources-config.json',
            hint: 'If the directory is Docker-mounted, git pull must be done manually or configured with a git_url.',
          }, 'Source has no git_url configured, skipping clone');
          return {
            source: source.name,
            action: 'skipped',
            changes: 0,
            duration: Date.now() - startTime,
          };
        }

        logger.info({ source: source.name, sourcePath, git_url: source.git_url, branch }, 'Repository does not exist, cloning...');
        await this.cloneRepository(source.git_url, sourcePath, branch);
        logger.info({ source: source.name, sourcePath, branch }, 'syncSource: clone succeeded');

        return {
          source: source.name,
          action: 'cloned',
          changes: -1,
          duration: Date.now() - startTime,
        };
      } else {
        // Repository exists — check if it has a remote we can pull from.
        if (!source.git_url) {
          // No git_url: Docker-mounted or manual directory — cannot pull.
          // Log clearly so operators know why git pull is not happening.
          const existingRemote = await this.getRepoUrl(sourcePath);
          logger.warn({
            source: source.name,
            sourcePath,
            existingRemoteUrl: existingRemote ?? '(none)',
            reason: 'git_url not configured in ai-resources-config.json',
            hint: 'Add a git_url to ai-resources-config.json to enable automatic git pull, or pull manually.',
          }, 'syncSource: repository exists but has no git_url — skipping pull');
          return {
            source: source.name,
            action: 'skipped',
            changes: 0,
            duration: Date.now() - startTime,
          };
        }

        logger.info({ source: source.name, sourcePath, git_url: source.git_url, branch }, 'Repository exists, pulling latest changes...');

        const { hasChanges, filesChanged } = await this.pullRepository(sourcePath, branch);

        logger.info({
          source: source.name,
          sourcePath,
          branch,
          action: hasChanges ? 'pulled' : 'up-to-date',
          filesChanged,
          duration: Date.now() - startTime,
        }, 'syncSource: pull complete');

        return {
          source: source.name,
          action: hasChanges ? 'pulled' : 'up-to-date',
          changes: filesChanged,
          duration: Date.now() - startTime,
        };
      }
    } catch (error) {
      logger.error({
        source: source.name,
        sourcePath,
        git_url: source.git_url ?? null,
        branch,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, 'Failed to sync source');

      throw error;
    }
  }

  /**
   * Sync all enabled sources
   */
  async syncAllSources(): Promise<SyncResult[]> {
    logger.info('Starting multi-source sync...');
    
    const sources = await this.getEnabledSources();
    logger.info({ 
      totalSources: sources.length,
      sourceNames: sources.map(s => s.name)
    }, 'Found enabled sources');

    const results: SyncResult[] = [];

    for (const source of sources) {
      try {
        const result = await this.syncSource(source);
        results.push(result);
      } catch (error) {
        logger.error({ 
          source: source.name,
          error: error instanceof Error ? error.message : String(error)
        }, 'Failed to sync source, continuing with next...');
        
        results.push({
          source: source.name,
          action: 'skipped',
          changes: 0,
          duration: 0
        });
      }
    }

    logger.info({ 
      results,
      totalSources: results.length,
      cloned: results.filter(r => r.action === 'cloned').length,
      pulled: results.filter(r => r.action === 'pulled').length,
      upToDate: results.filter(r => r.action === 'up-to-date').length
    }, 'Multi-source sync completed');

    return results;
  }

  /**
   * Read the files for a named Command or Skill resource from the local git
   * checkout.  Used when the CSP API download returns an empty `files` array
   * (which is expected for Command/Skill resources in MCP Prompt mode — the
   * API only stores metadata; actual file content lives in the git repo).
   *
   * Searches all enabled sources in priority order and returns the first match.
   *
   * @param resourceName  The resource name as returned by the subscriptions API.
   * @param resourceType  'command' | 'skill'
   * @returns Array of { path, content } file entries, or [] when not found.
   */
  async readResourceFiles(
    resourceName: string,
    resourceType: 'command' | 'skill' | 'rule' | 'mcp',
    includeAllFiles: boolean = false,
    sourceName?: string,
  ): Promise<Array<{ path: string; content: string }>> {
    let sources: SourceConfig[];
    try {
      sources = await this.getEnabledSources();
    } catch (configErr) {
      logger.warn(
        {
          resourceName,
          resourceType,
          aiResourcesBase: this.baseDir,
          error: (configErr as Error).message,
        },
        'readResourceFiles: failed to load ai-resources-config.json — returning empty. ' +
        'Set AI_RESOURCES_PATH env var to the directory containing ai-resources-config.json.',
      );
      return [];
    }

    // When sourceName is provided, restrict search to that source only (precise lookup).
    // Otherwise search all sources sorted by priority descending (existing behavior).
    if (sourceName) {
      const matched = sources.find((s) => s.name === sourceName);
      if (!matched) {
        logger.warn({ resourceName, resourceType, sourceName }, 'readResourceFiles: specified sourceName not found');
        return [];
      }
      sources = [matched];
    } else {
      sources.sort((a, b) => b.priority - a.priority);
    }

    // Map singular type names to the plural directory keys used in config.
    const typeToDirKey: Record<string, keyof SourceConfig['resources']> = {
      command: 'commands',
      commands: 'commands',
      skill: 'skills',
      skills: 'skills',
      rule: 'rules',
      rules: 'rules',
      mcp: 'mcp',
    };
    const typeDir = typeToDirKey[resourceType] ?? 'skills';

    logger.info(
      {
        resourceName,
        resourceType,
        resolvedDirKey: typeDir,
        sourceCount: sources.length,
        sourceNames: sources.map((s) => s.name),
        sourceName: sourceName ?? '(all)',
      },
      'readResourceFiles: start — searching git sources for resource',
    );

    for (const source of sources) {
      const sourcePath = path.join(this.baseDir, source.path);

      // Support both single-string and array-of-strings per resource type
      const subDirs = normalizePaths(source.resources[typeDir]);

      logger.info(
        {
          source: source.name,
          resourceName,
          resourceType,
          subDirs,
        },
        'readResourceFiles: trying source',
      );

      for (const resourcesSubDir of subDirs) {
        const resourceDir = path.join(sourcePath, resourcesSubDir, resourceName);
        const resourceFile = path.join(sourcePath, resourcesSubDir, `${resourceName}.md`);

        logger.info(
          {
            source: source.name,
            subDir: resourcesSubDir,
            resourceName,
            resourceType,
            tryDirPath: resourceDir,
            tryFilePath: resourceFile,
          },
          'readResourceFiles: trying subDir',
        );

        // Try directory-based layout first (e.g. skills/<name>/ or mcp/<name>/)
        try {
          const stat = await fs.stat(resourceDir);
          if (stat.isDirectory()) {
            const results: Array<{ path: string; content: string }> = [];

            if (includeAllFiles) {
              await this.readDirectoryRecursive(resourceDir, '', results);

              if (results.length > 0) {
                logger.info(
                  {
                    source: source.name,
                    subDir: resourcesSubDir,
                    resourceName,
                    resourceType,
                    dirPath: resourceDir,
                    fileCount: results.length,
                    files: results.map((r) => r.path),
                  },
                  'readResourceFiles: found all files in directory (recursive)',
                );
                return results;
              }
            } else {
              const entries = await fs.readdir(resourceDir);
              const relevantFiles = entries.filter(
                (f) => f.endsWith('.md') || f.endsWith('.mdc') ||
                  (resourceType === 'mcp' && f === 'mcp-config.json'),
              );

              if (relevantFiles.length > 0) {
                for (const f of relevantFiles) {
                  const filePath = path.join(resourceDir, f);
                  const content = await fs.readFile(filePath, 'utf-8');
                  results.push({ path: f, content });
                }
                logger.info(
                  {
                    source: source.name,
                    subDir: resourcesSubDir,
                    resourceName,
                    resourceType,
                    dirPath: resourceDir,
                    fileCount: results.length,
                    files: results.map((r) => r.path),
                  },
                  'readResourceFiles: found files in directory layout',
                );
                return results;
              }
            }

            logger.info(
              { source: source.name, subDir: resourcesSubDir, resourceName, resourceType, dirPath: resourceDir },
              'readResourceFiles: directory exists but contains no relevant files — trying flat file',
            );
          }
        } catch { /* not a directory or doesn't exist — try flat file */ }

        // Try flat file layout (.md then .mdc)
        const mdcFile = path.join(sourcePath, resourcesSubDir, `${resourceName}.mdc`);
        for (const [filePath, ext] of [[resourceFile, '.md'], [mdcFile, '.mdc']] as const) {
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            logger.info(
              {
                source: source.name,
                subDir: resourcesSubDir,
                resourceName,
                resourceType,
                filePath,
                ext,
                contentLength: content.length,
              },
              'readResourceFiles: found flat file',
            );
            return [{ path: `${resourceName}${ext}`, content }];
          } catch { /* not found — try next extension */ }
        }

        logger.info(
          { source: source.name, subDir: resourcesSubDir, resourceName, resourceType },
          'readResourceFiles: resource not found in this subDir — trying next',
        );
      }

      logger.info(
        { source: source.name, resourceName, resourceType },
        'readResourceFiles: resource not found in this source — trying next',
      );
    }

    logger.warn(
      { resourceName, resourceType, resolvedDirKey: typeDir, sourceCount: sources.length, sourceName: sourceName ?? '(all)' },
      'readResourceFiles: resource not found in any git source',
    );
    return [];
  }

  /**
   * Recursively read all files in a directory, returning relative paths and content.
   * 
   * @param dirPath - Absolute path to the directory
   * @param relativePath - Relative path prefix (for recursion)
   * @param results - Accumulator array
   */
  private async readDirectoryRecursive(
    dirPath: string,
    relativePath: string,
    results: Array<{ path: string; content: string }>
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and directories (., .., .git, .DS_Store)
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await this.readDirectoryRecursive(fullPath, relPath, results);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          results.push({ path: relPath, content });
        } catch (readErr) {
          logger.warn(
            { fullPath, relPath, error: (readErr as Error).message },
            'readResourceFiles: failed to read file, skipping'
          );
        }
      }
    }
  }

  /**
   * Scan resource directory and generate metadata (has_scripts, script_files).
   * 
   * This method enables client-side metadata generation without requiring
   * server-side API support. It inspects the local Git working directory.
   * 
   * @param resourceName - Resource name
   * @param resourceType - Resource type
   * @returns Metadata object with has_scripts and script_files
   */
  async scanResourceMetadata(
    resourceName: string,
    resourceType: 'command' | 'skill' | 'rule' | 'mcp'
  ): Promise<{
    has_scripts: boolean;
    script_files?: Array<{
      relative_path: string;
      content: string;
      mode?: string;
      encoding: 'utf8' | 'base64';
    }>;
  }> {
    logger.info(
      { resourceName, resourceType },
      'scanResourceMetadata: scanning local Git directory for resource metadata'
    );

    const allFiles = await this.readResourceFiles(resourceName, resourceType, true);

    if (allFiles.length === 0) {
      logger.warn({ resourceName, resourceType }, 'scanResourceMetadata: no files found');
      return { has_scripts: false };
    }

    // Detect scripts: any file in scripts/, teams/, references/ directories
    const hasScripts = allFiles.some(f =>
      f.path.startsWith('scripts/') ||
      f.path.startsWith('teams/') ||
      f.path.startsWith('references/')
    );

    if (!hasScripts) {
      logger.info(
        { resourceName, resourceType, fileCount: allFiles.length },
        'scanResourceMetadata: no scripts detected (simple resource)'
      );
      return { has_scripts: false };
    }

    // Build script_files array (exclude primary markdown files)
    const scriptFiles = allFiles
      .filter(f => 
        f.path !== 'SKILL.md' && 
        f.path !== 'COMMAND.md' && 
        f.path !== 'README.md'
      )
      .map(f => {
        // Infer file mode from path and extension
        const isScript = f.path.includes('scripts/') && 
                        !f.path.endsWith('.json') && 
                        !f.path.endsWith('.md') &&
                        !f.path.endsWith('.txt');

        return {
          relative_path: f.path,
          content: f.content,
          mode: isScript ? '0755' : '0644',
          encoding: 'utf8' as const,
        };
      });

    logger.info(
      {
        resourceName,
        resourceType,
        has_scripts: true,
        scriptFileCount: scriptFiles.length,
        scriptFiles: scriptFiles.map(f => ({ path: f.relative_path, mode: f.mode })),
      },
      'scanResourceMetadata: complex resource detected with scripts'
    );

    return {
      has_scripts: true,
      script_files: scriptFiles,
    };
  }

  /**
   * Check status of all sources without pulling
   */
  async checkAllSources(): Promise<Array<{
    source: string;
    exists: boolean;
    hasRemote: boolean;
    repoUrl: string | null;
  }>> {
    const sources = await this.getEnabledSources();
    const statuses = [];

    for (const source of sources) {
      const sourcePath = path.join(this.baseDir, source.path);
      const exists = await this.repositoryExists(sourcePath);
      
      let repoUrl = null;
      if (exists) {
        repoUrl = await this.getRepoUrl(sourcePath);
      }

      statuses.push({
        source: source.name,
        exists,
        hasRemote: !!repoUrl,
        repoUrl
      });
    }

    return statuses;
  }
}

// Resolve the AI-Resources base directory.
//
// Resolution order (first existing path wins):
//   1. AI_RESOURCES_PATH env var (explicit override for production deployments)
//   2. __dirname-relative path: dist/git/ → ../../AI-Resources
//      Works when the package is installed as an npm package and run from its
//      own directory (the common production case after `npm install -g`).
//   3. process.cwd()-relative path: ../AI-Resources
//      Works in local development where cwd is SourceCode/.
//
// Using __dirname (compiled file location) instead of process.cwd() makes the
// path robust to being started from any working directory on the server.
function resolveAiResourcesBase(): string {
  if (process.env.AI_RESOURCES_PATH) {
    const explicit = path.resolve(process.env.AI_RESOURCES_PATH);
    logger.info({ aiResourcesBase: explicit }, 'AI-Resources base resolved from AI_RESOURCES_PATH env');
    return explicit;
  }

  // Probe candidate locations in priority order:
  //
  //  1. cwd/AI-Resources          — server deployed with cwd = project root (e.g. /app)
  //                                  and AI-Resources/ is a sibling of dist/
  //  2. cwd/../AI-Resources        — local dev: cwd = SourceCode/, AI-Resources/ is one level up
  //  3. __dirname/../../AI-Resources — npm global install: dist/git/ → ../../AI-Resources
  //     (resolves to same as #1 when installed as a local package from project root)
  const candidates = [
    path.resolve(process.cwd(), 'AI-Resources'),         // production: cwd is package root
    path.resolve(process.cwd(), '../AI-Resources'),       // local dev: cwd is SourceCode/
    path.resolve(__dirname, '../../AI-Resources'),        // npm global install fallback
  ];

  for (const candidate of candidates) {
    try {
      const configFile = path.join(candidate, 'ai-resources-config.json');
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      require('fs').accessSync(configFile);
      logger.info({ aiResourcesBase: candidate }, 'AI-Resources base resolved');
      return candidate;
    } catch { /* try next */ }
  }

  // Nothing found — fall back to first candidate and let later errors surface clearly.
  logger.warn(
    { triedPaths: candidates },
    'AI-Resources config not found in any candidate path — using cwd/AI-Resources as fallback. ' +
    'Set AI_RESOURCES_PATH env var to override.',
  );
  return candidates[0] as string;
}

const AI_RESOURCES_BASE = resolveAiResourcesBase();
export const multiSourceGitManager = new MultiSourceGitManager(AI_RESOURCES_BASE);
