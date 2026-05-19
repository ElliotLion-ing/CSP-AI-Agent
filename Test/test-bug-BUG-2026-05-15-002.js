/**
 * Bug regression wrapper for BUG-2026-05-15-002.
 *
 * Verifies Codex complex-skill manifest paths are profile-specific so legacy
 * Cursor manifests cannot suppress Codex-local file materialization.
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
