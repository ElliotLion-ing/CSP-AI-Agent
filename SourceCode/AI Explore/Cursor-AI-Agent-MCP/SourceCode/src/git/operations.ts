/**
 * Git Operations Module
 * Per-repo git helpers used by upload_resource to target a specific source repo.
 * All repo URLs and branches come from AI-Resources/ai-resources-config.json —
 * not from environment variables.
 */

import simpleGit from 'simple-git';
import { config } from '../config';
import { logger } from '../utils/logger';
import { createGitError } from '../types/errors';

class GitOperations {
  // ---- Per-repo helpers (used by upload_resource to target a specific source) ----

  /**
   * Check whether a git repository exists at an arbitrary local path
   */
  async repositoryExistsAt(repoPath: string): Promise<boolean> {
    try {
      const git = simpleGit({ baseDir: repoPath, binary: 'git', maxConcurrentProcesses: 6 });
      await git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current branch of an arbitrary local repo
   */
  async getCurrentBranchAt(repoPath: string): Promise<string> {
    try {
      const git = simpleGit({ baseDir: repoPath, binary: 'git', maxConcurrentProcesses: 6 });
      const branchSummary = await git.branch();
      return branchSummary.current;
    } catch (error) {
      throw createGitError('get-branch', error as Error);
    }
  }

  /**
   * Commit and push to a specific repo / remote url / branch.
   * Creates a unique remote testing branch and returns a PR URL.
   */
  async commitAndPushRepo(
    repoPath: string,
    remoteUrl: string,
    baseBranch: string,
    message: string,
    files?: string[]
  ): Promise<{ commitHash: string; prUrl?: string }> {
    try {
      const git = simpleGit({ baseDir: repoPath, binary: 'git', maxConcurrentProcesses: 6 });

      logger.info({ repoPath, remoteUrl, message, fileCount: files?.length }, 'Committing and pushing to source repo...');

      await git.addConfig('user.name', config.git.userName);
      await git.addConfig('user.email', config.git.userEmail);

      const branchSummary = await git.branch();
      const currentBranch = branchSummary.current;

      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const remoteBranchName = `dev-${currentBranch}-testing-${timestamp}-${randomSuffix}`;
      logger.info({ remoteBranchName }, 'Generated remote branch name for PR');

      if (files && files.length > 0) {
        await git.add(files);
      } else {
        await git.add('.');
      }

      const commitResult = await git.commit(message);
      const commitHash = commitResult.commit;
      logger.info({ commitHash }, 'Git commit created');

      await git.push(remoteUrl, `${currentBranch}:${remoteBranchName}`);
      logger.info({ remoteBranchName }, 'Git push completed');

      const repoBaseUrl = remoteUrl.replace(/\.git$/, '');
      const prUrl = `${repoBaseUrl}/compare/${baseBranch}...${remoteBranchName}`;
      logger.info({ prUrl, commitHash }, 'PR URL generated');

      return { commitHash, prUrl };
    } catch (error) {
      throw createGitError('commit-push', error as Error, remoteUrl);
    }
  }
}

export const gitOperations = new GitOperations();
