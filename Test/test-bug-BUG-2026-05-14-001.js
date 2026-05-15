/**
 * Bug regression wrapper for BUG-2026-05-14-001.
 *
 * Verifies the Codex/Cursor MCP cleanup and Codex local-action setup prompt
 * regressions covered by the release-check failure.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const regressionTest = path.join(__dirname, 'test-codex-mcp-release-regression.js');
const result = spawnSync(process.execPath, [regressionTest], {
  cwd: path.join(__dirname, '..'),
  encoding: 'utf8',
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
