/**
 * Codex Client Adapter
 *
 * Implements the ClientAdapter interface for the OpenAI Codex CLI client.
 *
 * Key differences from CursorAdapter:
 * - Complex skills    → ~/.csp-ai-agent/codex/skills/<name>/
 * - Commands          → transformed into Codex skill bundles (same path as skills)
 * - Rules             → aggregated into csp-routing-policy.md (no .mdc files written)
 * - MCP config        → ~/.codex/config.toml  (merge_toml action, not mcp.json)
 * - Policy delivery   → developer_instructions in ~/.codex/config.toml
 */

import type { ClientAdapter, AgentProfile, PolicyStrategy } from './index.js';
import {
  getCodexSkillDirForClient,
  getCodexManifestDirForClient,
  getCodexConfigTomlPathForClient,
  getCodexPolicyPathForClient,
} from '../utils/codex-paths.js';

export class CodexAdapter implements ClientAdapter {
  readonly profile: AgentProfile = 'codex';

  /** Complex skills are cached in the Codex-specific sub-tree. */
  getSkillDir(skillName: string): string {
    return getCodexSkillDirForClient(skillName);
  }

  getManifestDir(): string {
    return getCodexManifestDirForClient();
  }

  /**
   * Codex has no native "commands" concept.  Commands are transformed into
   * Codex skill bundles so they are placed in the skills directory under a
   * namespaced sub-folder.
   */
  getCommandDir(commandName: string): string {
    return getCodexSkillDirForClient(`__cmd__${commandName}`);
  }

  /**
   * Codex does not use per-file `.mdc` rules.  Rules are instead aggregated
   * into a single policy markdown file and injected via `developer_instructions`.
   * This method returns an empty array to signal that no individual rule files
   * should be written; the calling code in sync-resources must route rules to
   * the policy aggregator instead.
   */
  getRuleTargetDirs(_scope: string): string[] {
    return [];
  }

  /**
   * Codex reads MCP server configurations from its native config.toml rather
   * than a JSON mcp.json file.
   */
  getMcpConfigPath(): string {
    return getCodexConfigTomlPathForClient();
  }

  /**
   * Policy is delivered by materialising a policy markdown file and injecting
   * its file path into the `developer_instructions` key in config.toml.
   *
   * The MCP server emits a `merge_toml` LocalAction carrying the policy content
   * and a `restart_required: true` field so the Agent can prompt the user to
   * restart Codex for the policy to take effect.
   */
  getPolicyStrategy(): PolicyStrategy {
    return {
      type: 'policy_inject',
      policyFile: getCodexPolicyPathForClient(),
      configTomlKey: 'developer_instructions',
      configTomlPath: getCodexConfigTomlPathForClient(),
    };
  }

  getTelemetryTags(): Record<string, string> {
    return { agent_profile: 'codex' };
  }
}
