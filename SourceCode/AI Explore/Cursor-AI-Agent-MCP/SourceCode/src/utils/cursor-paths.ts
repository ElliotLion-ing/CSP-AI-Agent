/**
 * Cursor IDE standard directory path resolver.
 *
 * Cursor stores user-level assets in platform-specific locations:
 *   macOS / Linux : ~/.cursor/<type>/
 *   Windows       : %APPDATA%\Cursor\User\<type>\
 *                   (typically C:\Users\<user>\AppData\Roaming\Cursor\User\<type>\)
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
 * macOS / Linux : ~/.cursor
 * Windows       : %APPDATA%\Cursor\User
 */
export function getCursorRootDir(): string {
  if (process.platform === 'win32') {
    // APPDATA is always set on Windows; fall back to USERPROFILE as a safety net
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Cursor', 'User');
  }
  // macOS and Linux both use ~/.cursor
  return path.join(os.homedir(), '.cursor');
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
