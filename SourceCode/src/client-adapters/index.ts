/**
 * Client Adapter Framework
 *
 * Provides an abstraction layer so that all client-specific logic (path
 * resolution, distribution strategy, policy injection) is routed through
 * a pluggable adapter rather than scattered `if (profile === 'codex')` checks
 * throughout shared tools.
 *
 * Two built-in adapters:
 *   CursorAdapter  – behaviour identical to the existing Cursor-only code paths
 *   CodexAdapter   – new Codex-specific paths and policy injection strategy
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core types
// ─────────────────────────────────────────────────────────────────────────────

export type AgentProfile = 'cursor' | 'codex';

/**
 * Describes where a resource should be materialised on the client machine
 * and which LocalAction type should be used to write it.
 */
export interface MaterializationPath {
  /** Destination path on the user's local machine (may start with ~). */
  localPath: string;
  /** Which LocalAction type the server should emit for this file. */
  actionType: 'write_file' | 'merge_mcp_json' | 'merge_toml' | 'skip';
}

/**
 * Describes how global routing policies (CSP prompt-routing rules) are
 * delivered to the client agent.
 *
 * - `mdc`           – write a `.mdc` file into `~/.cursor/rules/`
 * - `policy_inject` – materialise a policy markdown file and inject its path
 *                     into the Codex `developer_instructions` config key
 */
export interface PolicyStrategy {
  type: 'mdc' | 'policy_inject';
  /** For `mdc` – target directory for the generated `.mdc` file. */
  targetDir?: string;
  /** For `policy_inject` – path of the materialised policy markdown file. */
  policyFile?: string;
  /**
   * For `policy_inject` – TOML config key to update.
   * Typically `developer_instructions`.
   */
  configTomlKey?: string;
  /**
   * For `policy_inject` – absolute path to the client config TOML file.
   * Typically `~/.codex/config.toml`.
   */
  configTomlPath?: string;
}

/**
 * Interface that every client adapter must satisfy.
 *
 * Each method returns a path or descriptor; it is the caller's
 * responsibility to translate that into a concrete LocalAction.
 */
export interface ClientAdapter {
  readonly profile: AgentProfile;

  /** Directory where complex skills are cached for this client. */
  getSkillDir(skillName: string): string;

  /** Directory where commands are cached for this client. */
  getCommandDir(commandName: string): string;

  /**
   * Returns all local directories that a rule with the given scope should be
   * written to.  May return an empty array when rules are aggregated into a
   * policy file instead (Codex).
   */
  getRuleTargetDirs(scope: string): string[];

  /** Absolute path to the MCP server config file for this client. */
  getMcpConfigPath(): string;

  /** Policy delivery strategy for this client. */
  getPolicyStrategy(): PolicyStrategy;

  /** Additional telemetry tags to attach for this client (e.g. agent_profile). */
  getTelemetryTags(): Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export class ClientAdapterRegistry {
  private readonly adapters = new Map<AgentProfile, ClientAdapter>();

  register(adapter: ClientAdapter): void {
    this.adapters.set(adapter.profile, adapter);
  }

  /**
   * Returns the adapter for the requested profile.
   * Falls back to the `cursor` adapter when the requested profile has not
   * been registered, ensuring backward-compatible behaviour for all existing
   * callers.
   */
  get(profile: AgentProfile): ClientAdapter {
    const adapter = this.adapters.get(profile);
    if (adapter) {
      return adapter;
    }
    const fallback = this.adapters.get('cursor');
    if (fallback) {
      return fallback;
    }
    throw new Error(`ClientAdapterRegistry: no adapter registered for profile '${profile}' and no cursor fallback available`);
  }

  /** Returns true when an adapter for the given profile has been registered. */
  has(profile: AgentProfile): boolean {
    return this.adapters.has(profile);
  }
}

/** Shared singleton registry. Adapters are registered at module load time. */
export const adapterRegistry = new ClientAdapterRegistry();
