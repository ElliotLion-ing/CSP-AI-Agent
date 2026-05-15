/**
 * Cursor Client Adapter
 *
 * Wraps the existing cursor-paths.ts behaviour so that all current code paths
 * continue to work unchanged.  This adapter must produce identical output to
 * what the pre-adapter code produced for every method.
 */

import type { ClientAdapter, AgentProfile, PolicyStrategy } from './index.js';
import {
  getCursorRootDirForClient,
  getCspAgentDirForClient,
} from '../utils/cursor-paths.js';

export class CursorAdapter implements ClientAdapter {
  readonly profile: AgentProfile = 'cursor';

  /**
   * Complex skills are cached in ~/.csp-ai-agent/skills/<name>/ (path-isolated
   * from Cursor's own ~/.cursor/skills/ to keep Cursor from auto-discovering them).
   */
  getSkillDir(skillName: string): string {
    return `${getCspAgentDirForClient('skills')}/${skillName}`;
  }

  /** Cursor slash commands → ~/.cursor/commands/<name>/ */
  getCommandDir(commandName: string): string {
    return `${getCursorRootDirForClient()}/commands/${commandName}`;
  }

  /**
   * Resolves the target directories for a rule depending on its scope.
   *
   * - `global`    → ~/.cursor/rules/  (applies to every workspace)
   * - `workspace` → (the calling tool will inject the workspace path; returned
   *                  here as a sentinel that callers can detect and replace)
   * - `all`       → both global and workspace targets
   */
  getRuleTargetDirs(scope: string): string[] {
    const globalDir = `${getCursorRootDirForClient()}/rules`;
    switch (scope) {
      case 'global':
        return [globalDir];
      case 'workspace':
        return ['__WORKSPACE_RULES_DIR__'];
      case 'all':
        return [globalDir, '__WORKSPACE_RULES_DIR__'];
      default:
        return [globalDir];
    }
  }

  /** Cursor reads MCP server configs from ~/.cursor/mcp.json */
  getMcpConfigPath(): string {
    return `${getCursorRootDirForClient()}/mcp.json`;
  }

  /**
   * Cursor uses `.mdc` files placed in `~/.cursor/rules/` to deliver
   * routing policies.  No TOML injection needed.
   */
  getPolicyStrategy(): PolicyStrategy {
    return {
      type: 'mdc',
      targetDir: `${getCursorRootDirForClient()}/rules`,
    };
  }

  getTelemetryTags(): Record<string, string> {
    return { agent_profile: 'cursor' };
  }
}
