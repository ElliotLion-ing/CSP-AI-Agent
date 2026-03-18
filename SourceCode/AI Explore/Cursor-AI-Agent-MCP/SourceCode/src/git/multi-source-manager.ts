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

// Export singleton instance
const AI_RESOURCES_BASE = path.resolve(process.cwd(), '../AI-Resources');
export const multiSourceGitManager = new MultiSourceGitManager(AI_RESOURCES_BASE);
