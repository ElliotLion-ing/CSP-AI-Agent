/**
 * Cursor IDE standard directory path resolver.
 *
 * Cursor stores user-level assets in platform-specific locations.
 * 
 * DEFAULT BEHAVIOR (all platforms unified):
 *   Windows: C:\Users\<Username>\.cursor\<type>\
 *   macOS:   /Users/<user>/.cursor/<type>/
 *   Linux:   /home/<user>/.cursor/<type>/
 * 
 * FALLBACK DISCOVERY (if not found in default location):
 *   Windows: %APPDATA%\Cursor\User, %LOCALAPPDATA%\Cursor, Documents\.cursor
 *   macOS:   ~/Library/Application Support/.cursor
 *   Linux:   ~/.local/share/.cursor, ~/.config/.cursor
 *
 * Resource type → subdirectory mapping mirrors the actual Cursor directory layout.
 */

import * as os from 'os';
import * as path from 'path';

/** Supported Cursor resource types and their directory names. */
export const CURSOR_TYPE_DIRS: Record<string, string> = {
  skill:   'skills',
  skills:  'skills',
  command: 'commands',
  commands:'commands',
  rule:    'rules',
  rules:   'rules',
  mcp:     'mcp-servers',
  'mcp-servers': 'mcp-servers',
};

/**
 * Returns the root of the Cursor user directory on the current platform.
 *
 * CORRECTED BEHAVIOR (all platforms use same default logic):
 *   Default: <USER_HOME>/.cursor (checked first on all platforms)
 *   Windows: C:\Users\<Username>\.cursor
 *   macOS:   /Users/<user>/.cursor
 *   Linux:   /home/<user>/.cursor
 *
 * Dynamic fallback: If .cursor not found in user home, searches
 * platform-specific alternative locations:
 *   - Windows: %APPDATA%\Cursor\User, %LOCALAPPDATA%\Cursor, Documents\.cursor
 *   - macOS: ~/Library/Application Support/.cursor
 *   - Linux: ~/.local/share/.cursor, ~/.config/.cursor
 *
 * NOTE: Only use this when running code on the USER's local machine.
 * When generating paths for LocalAction instructions (which are executed by the
 * AI on the user's machine, not on this server), use getCursorRootDirForClient()
 * instead to avoid returning the server's home directory.
 */
export function getCursorRootDir(): string {
  const homeDir = os.homedir();
  const defaultPath = path.join(homeDir, '.cursor');

  // 1. Check default location (priority: user home directory)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    if (require('fs').existsSync(defaultPath)) {
      return defaultPath;
    }
  } catch {
    // If fs module not available or error, return default path
    return defaultPath;
  }

  // 2. Fallback: search platform-specific alternative locations
  const fallbackPaths: string[] = [];

  if (process.platform === 'win32') {
    // Windows alternatives (in case of non-standard installation)
    const appData = process.env.APPDATA;
    const localAppData = process.env.LOCALAPPDATA;
    if (appData) {
      fallbackPaths.push(
        path.join(appData, 'Cursor', 'User'),      // Legacy/enterprise location
        path.join(appData, 'Cursor', '.cursor'),
      );
    }
    if (localAppData) {
      fallbackPaths.push(path.join(localAppData, 'Cursor'));
    }
    fallbackPaths.push(path.join(homeDir, 'Documents', '.cursor'));
  } else if (process.platform === 'darwin') {
    // macOS alternatives
    fallbackPaths.push(
      path.join(homeDir, 'Library', 'Application Support', '.cursor'),
    );
  } else {
    // Linux alternatives
    fallbackPaths.push(
      path.join(homeDir, '.local', 'share', '.cursor'),
      path.join(homeDir, '.config', '.cursor'),
    );
  }

  // Check each fallback path
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const fs = require('fs');
    for (const p of fallbackPaths) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      if (fs.existsSync(p)) {
        return p;
      }
    }
  } catch {
    // If fs module not available, return default
  }

  // 3. Last resort: return default path (will be created when needed)
  return defaultPath;
}

/**
 * Returns a platform-neutral Cursor root path for use in LocalAction instructions.
 *
 * LocalAction paths are sent to the AI Agent running on the USER's local machine,
 * not executed on this (possibly remote) server.  Using os.homedir() here would
 * produce the server's home directory (e.g. /root/.cursor on a Linux server),
 * which is wrong when the user is on macOS or Windows.
 *
 * We return a tilde-prefixed path ("~/.cursor") which the AI / shell on the
 * user's machine will expand to the correct home directory automatically.
 * For Windows we still return the APPDATA-relative form as a hint, but note
 * that the AI is expected to expand %APPDATA% on the client side.
 */
export function getCursorRootDirForClient(): string {
  // Return a portable ~-based path; the AI on the user's machine expands it.
  return '~/.cursor';
}

/**
 * Returns the Cursor subdirectory for a given resource type, using a
 * client-side portable path (tilde-based).  Use this when building paths
 * that will be included in LocalAction instructions.
 */
export function getCursorTypeDirForClient(resourceType: string): string {
  const subdir = CURSOR_TYPE_DIRS[resourceType.toLowerCase()];
  if (!subdir) {
    throw new Error(
      `Unknown resource type "${resourceType}". ` +
      `Supported types: ${Object.keys(CURSOR_TYPE_DIRS).join(', ')}`
    );
  }
  return `${getCursorRootDirForClient()}/${subdir}`;
}

/**
 * Returns the Cursor subdirectory for a given resource type.
 *
 * @param resourceType  - API resource type string (e.g. 'skill', 'command', 'rule', 'mcp')
 * @returns Absolute path to the matching Cursor directory
 * @throws  Error if the resource type is not recognised
 *
 * @example
 *   getCursorTypeDir('skill')   // ~/.cursor/skills
 *   getCursorTypeDir('command') // ~/.cursor/commands
 *   getCursorTypeDir('rule')    // ~/.cursor/rules
 *   getCursorTypeDir('mcp')     // ~/.cursor/mcp-servers
 */
export function getCursorTypeDir(resourceType: string): string {
  const subdir = CURSOR_TYPE_DIRS[resourceType.toLowerCase()];
  if (!subdir) {
    throw new Error(
      `Unknown resource type "${resourceType}". ` +
      `Supported types: ${Object.keys(CURSOR_TYPE_DIRS).join(', ')}`
    );
  }
  return path.join(getCursorRootDir(), subdir);
}

/**
 * Returns the install path for a specific named resource.
 *
 * For directory-based resources (skill, mcp) the result is a directory:
 *   ~/.cursor/skills/<name>/
 *
 * For file-based resources (command, rule) the result is the file path
 * preserving the original filename (caller should pass name with extension):
 *   ~/.cursor/commands/<name>         (e.g. generate-testcase.md)
 *   ~/.cursor/rules/<name>            (e.g. elliotTest.mdc)
 *
 * @param resourceType  - Resource type string
 * @param resourceName  - Resource name (with or without extension)
 */
export function getCursorResourcePath(resourceType: string, resourceName: string): string {
  return path.join(getCursorTypeDir(resourceType), resourceName);
}

/**
 * Returns the path to the local AI resource telemetry file.
 *
 * Stored at the Cursor root level (not inside a resource-type subdirectory)
 * so it persists independently of individual resource installs/uninstalls.
 *
 * All platforms: <USER_HOME>/.cursor/ai-resource-telemetry.json
 * Windows: C:\Users\<Username>\.cursor\ai-resource-telemetry.json
 * macOS:   /Users/<user>/.cursor/ai-resource-telemetry.json
 * Linux:   /home/<user>/.cursor/ai-resource-telemetry.json
 */
export function getTelemetryFilePath(): string {
  return path.join(getCursorRootDir(), 'ai-resource-telemetry.json');
}

// ============================================================================
// CSP AI Agent Isolated Storage Paths
// ============================================================================

/**
 * Returns the parent directory where .cursor is located.
 * Used to ensure .csp-ai-agent is created as a sibling of .cursor.
 *
 * @returns Absolute path to the parent directory containing .cursor
 */
function getCursorParentDir(): string {
  const cursorRoot = getCursorRootDir();  // Find actual .cursor location (with dynamic search)
  return path.dirname(cursorRoot);        // Return its parent directory
}

/**
 * Returns the root directory for CSP AI Agent isolated storage (LOCAL execution).
 *
 * CRITICAL DESIGN RULE: .csp-ai-agent MUST be a sibling of .cursor.
 *
 * Strategy:
 *   1. Find where .cursor actually exists (getCursorRootDir with dynamic search)
 *   2. Extract parent directory of .cursor
 *   3. Place .csp-ai-agent in THE SAME parent directory
 *
 * Examples:
 *   If .cursor is at C:\Users\Elliot.Ding\.cursor
 *   → Parent:       C:\Users\Elliot.Ding
 *   → .csp-ai-agent = C:\Users\Elliot.Ding\.csp-ai-agent (SIBLING)
 *
 *   If .cursor is at /Users/elliot/.cursor
 *   → Parent:       /Users/elliot
 *   → .csp-ai-agent = /Users/elliot/.csp-ai-agent (SIBLING)
 *
 *   If .cursor is at C:\Users\John\AppData\Roaming\Cursor\User (non-standard)
 *   → Parent:       C:\Users\John\AppData\Roaming\Cursor
 *   → .csp-ai-agent = C:\Users\John\AppData\Roaming\Cursor\.csp-ai-agent (SIBLING)
 *
 * This ensures consistent sibling directory layout across all platforms.
 *
 * NOTE: This function is for LOCAL execution only (when MCP server runs on user's machine).
 * For LocalAction instructions, use getCspAgentRootDirForClient().
 */
export function getCspAgentRootDir(): string {
  const parentDir = getCursorParentDir();
  return path.join(parentDir, '.csp-ai-agent');
}

/**
 * Returns CSP AI Agent root directory path for client-side LocalAction instructions.
 *
 * This is a symbolic path that the AI Agent will resolve on the user's machine.
 *
 * AI Agent resolution strategy (MUST implement on client side):
 *   1. Find .cursor directory location:
 *      - Windows: Check C:\Users\<Username>\.cursor first, then search AppData
 *      - macOS:   Check /Users/<user>/.cursor first, then search Library
 *      - Linux:   Check /home/<user>/.cursor first, then search .local, .config
 *   2. Extract parent directory of .cursor
 *   3. Place .csp-ai-agent in THE SAME parent directory
 *
 * @returns Symbolic path: "~/.csp-ai-agent" (AI Agent expands based on .cursor location)
 */
export function getCspAgentRootDirForClient(): string {
  // Return portable tilde-based path
  // AI Agent must expand this by finding .cursor's parent directory
  return '~/.csp-ai-agent';
}

/**
 * Returns CSP AI Agent subdirectory path for local execution.
 *
 * @param subdir - Subdirectory name ('skills', '.manifests', etc.)
 * @returns Absolute local path
 *
 * @example
 *   getCspAgentDir('skills')
 *   // → Local: C:\Users\Elliot.Ding\.csp-ai-agent\skills (if .cursor in user home)
 */
export function getCspAgentDir(subdir: string): string {
  return path.join(getCspAgentRootDir(), subdir);
}

/**
 * Returns CSP AI Agent subdirectory path for client-side LocalAction instructions.
 *
 * @param subdir - Subdirectory name ('skills', '.manifests', etc.)
 * @returns Symbolic path for AI Agent to resolve
 *
 * @example
 *   getCspAgentDirForClient('skills')
 *   // → "~/.csp-ai-agent/skills"
 *   // AI Agent resolves to: C:\Users\Elliot.Ding\.csp-ai-agent\skills (if .cursor in user home)
 */
export function getCspAgentDirForClient(subdir: string): string {
  return `${getCspAgentRootDirForClient()}/${subdir}`;
}
