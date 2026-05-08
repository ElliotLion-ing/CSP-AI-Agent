/**
 * Codex client directory path resolver.
 *
 * Returns tilde-based portable paths suitable for use in LocalAction
 * instructions that the AI Agent will execute on the user's local machine.
 *
 * Directory layout:
 *   ~/.csp-ai-agent/codex/         – Codex-specific cached resources (sibling of .cursor)
 *     skills/<name>/               – Complex Codex skills
 *     csp-routing-policy.md        – Aggregated routing policy injected into Codex
 *   ~/.codex/                      – Codex native config directory
 *     config.toml                  – Codex configuration (developer_instructions lives here)
 */

/**
 * Returns the root directory for Codex-specific CSP agent resources
 * as a client-side portable path.
 *
 * The AI Agent must expand `~` to the user's home directory.
 */
export function getCodexRootDirForClient(): string {
  return '~/.csp-ai-agent/codex';
}

/**
 * Returns the directory where complex Codex skills are cached.
 */
export function getCodexSkillDirForClient(skillName: string): string {
  return `${getCodexRootDirForClient()}/skills/${skillName}`;
}

/**
 * Returns the path of the aggregated CSP routing policy markdown file
 * that is injected into Codex via `developer_instructions`.
 */
export function getCodexPolicyPathForClient(): string {
  return `${getCodexRootDirForClient()}/csp-routing-policy.md`;
}

/**
 * Returns the path to the Codex native configuration file.
 * This is where `developer_instructions` (and other runtime options) live.
 */
export function getCodexConfigTomlPathForClient(): string {
  return '~/.codex/config.toml';
}
