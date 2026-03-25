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
    commands: string;
    skills: string;
    mcp: string;
    rules: string;
  };
  description: string;
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
      return JSON.parse(configContent);
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

      logger.info({ repoPath, branch }, 'Fetching latest changes...');

      // If the local repo is shallow (was previously cloned with --depth),
      // unshallow it first so subsequent fetches have a proper merge base.
      const isShallow = (await git.raw(['rev-parse', '--is-shallow-repository'])).trim() === 'true';
      if (isShallow) {
        logger.info({ repoPath }, 'Shallow repo detected — running fetch --unshallow first');
        await git.fetch(['--unshallow', 'origin', branch]);
      } else {
        // Fetch the branch from origin without --depth to keep full history intact.
        await git.fetch(['origin', branch]);
      }

      // Compare local HEAD with remote tip to detect changes before merging.
      const remoteBranch = `origin/${branch}`;
      const diffSummary = await git.diffSummary([`HEAD...${remoteBranch}`]);
      const hasChanges = diffSummary.files.length > 0;

      if (!hasChanges) {
        logger.info({ repoPath }, 'Repository is up-to-date, no changes to pull');
        return { hasChanges: false, filesChanged: 0 };
      }

      // Fast-forward only — never auto-merge diverged histories.
      logger.info({ repoPath, filesChanged: diffSummary.files.length }, 'Pulling changes...');
      await git.merge([remoteBranch, '--ff-only']);

      logger.info({
        repoPath,
        filesChanged: diffSummary.files.length,
        insertions: diffSummary.insertions,
        deletions: diffSummary.deletions,
      }, 'Repository updated successfully');

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

    logger.info({ 
      source: source.name, 
      path: sourcePath,
      priority: source.priority
    }, 'Syncing AI Resources source...');

    try {
      const exists = await this.repositoryExists(sourcePath);

      if (!exists) {
        // First time: clone repository
        if (!source.git_url) {
          logger.warn({ source: source.name }, 'Source has no git_url configured, skipping clone');
          return {
            source: source.name,
            action: 'skipped',
            changes: 0,
            duration: Date.now() - startTime
          };
        }

        logger.info({ source: source.name }, 'Repository does not exist, cloning...');
        await this.cloneRepository(
          source.git_url,
          sourcePath,
          source.git_branch || 'main'
        );

        return {
          source: source.name,
          action: 'cloned',
          changes: -1,  // -1 means full clone
          duration: Date.now() - startTime
        };
      } else {
        // Repository exists: pull latest changes
        logger.info({ source: source.name }, 'Repository exists, pulling latest changes...');
        
        const { hasChanges, filesChanged } = await this.pullRepository(
          sourcePath,
          source.git_branch || 'main'
        );

        return {
          source: source.name,
          action: hasChanges ? 'pulled' : 'up-to-date',
          changes: filesChanged,
          duration: Date.now() - startTime
        };
      }
    } catch (error) {
      logger.error({ 
        source: source.name,
        error: error instanceof Error ? error.message : String(error)
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
    // Sort by priority descending so higher-priority sources win.
    sources.sort((a, b) => b.priority - a.priority);

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
      },
      'readResourceFiles: start — searching git sources for resource',
    );

    for (const source of sources) {
      const sourcePath = path.join(this.baseDir, source.path);
      const resourcesSubDir = source.resources[typeDir as keyof typeof source.resources];
      const resourceDir = path.join(sourcePath, resourcesSubDir, resourceName);
      const resourceFile = path.join(sourcePath, resourcesSubDir, `${resourceName}.md`);

      logger.info(
        {
          source: source.name,
          resourceName,
          resourceType,
          tryDirPath: resourceDir,
          tryFilePath: resourceFile,
        },
        'readResourceFiles: trying source',
      );

      // Try directory-based layout first (e.g. rules/<name>/ or mcp/<name>/)
      try {
        const stat = await fs.stat(resourceDir);
        if (stat.isDirectory()) {
          const entries = await fs.readdir(resourceDir);
          const mdFiles = entries.filter((f) => f.endsWith('.md') || f.endsWith('.mdc'));
          if (mdFiles.length > 0) {
            const results: Array<{ path: string; content: string }> = [];
            for (const f of mdFiles) {
              const filePath = path.join(resourceDir, f);
              const content = await fs.readFile(filePath, 'utf-8');
              results.push({ path: f, content });
            }
            logger.info(
              {
                source: source.name,
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
          logger.info(
            { source: source.name, resourceName, resourceType, dirPath: resourceDir },
            'readResourceFiles: directory exists but contains no .md/.mdc files — trying flat file',
          );
        }
      } catch { /* not a directory or doesn't exist — try flat file */ }

      // Try flat file layout (e.g. rules/<name>.mdc or rules/<name>.md)
      // Also try .mdc extension for rule resources.
      const mdcFile = path.join(sourcePath, resourcesSubDir, `${resourceName}.mdc`);
      for (const [filePath, ext] of [[resourceFile, '.md'], [mdcFile, '.mdc']] as const) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          logger.info(
            {
              source: source.name,
              resourceName,
              resourceType,
              filePath,
              ext,
              contentLength: content.length,
            },
            'readResourceFiles: found flat file',
          );
          return [{ path: `${resourceName}${ext}`, content }];
        } catch { /* not found — try next extension or source */ }
      }

      logger.info(
        { source: source.name, resourceName, resourceType },
        'readResourceFiles: resource not found in this source — trying next',
      );
    }

    logger.warn(
      { resourceName, resourceType, resolvedDirKey: typeDir, sourceCount: sources.length },
      'readResourceFiles: resource not found in any git source',
    );
    return [];
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
