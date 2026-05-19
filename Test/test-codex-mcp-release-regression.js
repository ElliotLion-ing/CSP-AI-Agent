/**
 * Regression tests for Codex release-check MCP local actions.
 *
 * These static checks guard the profile-gated Codex path without requiring a
 * live CSP server. Cursor behavior must remain on merge_mcp_json.
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(80));
console.log('Test: Codex MCP Release Regression');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`✅ PASS: ${description}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${description}`);
    failed++;
  }
}

const root = path.join(__dirname, '..');
const syncPath = path.join(root, 'SourceCode/src/tools/sync-resources.ts');
const uninstallPath = path.join(root, 'SourceCode/src/tools/uninstall-resource.ts');
const manageSubscriptionPath = path.join(root, 'SourceCode/src/tools/manage-subscription.ts');
const promptManagerPath = path.join(root, 'SourceCode/src/prompts/manager.ts');
const typesPath = path.join(root, 'SourceCode/src/types/tools.ts');
const usagePath = path.join(root, 'SourceCode/src/tools/query-usage-stats.ts');
const httpPath = path.join(root, 'SourceCode/src/server/http.ts');
const codexAdapterPath = path.join(root, 'SourceCode/src/client-adapters/codex-adapter.ts');
const cursorAdapterPath = path.join(root, 'SourceCode/src/client-adapters/cursor-adapter.ts');

const sync = fs.readFileSync(syncPath, 'utf8');
const uninstall = fs.readFileSync(uninstallPath, 'utf8');
const manageSubscription = fs.readFileSync(manageSubscriptionPath, 'utf8');
const promptManager = fs.readFileSync(promptManagerPath, 'utf8');
const types = fs.readFileSync(typesPath, 'utf8');
const usage = fs.readFileSync(usagePath, 'utf8');
const http = fs.readFileSync(httpPath, 'utf8');
const codexAdapter = fs.readFileSync(codexAdapterPath, 'utf8');
const cursorAdapter = fs.readFileSync(cursorAdapterPath, 'utf8');

assert(sync.includes("key: `mcp_servers.${serverName}`"), 'Codex MCP merge_toml targets mcp_servers.<name>');
assert(!sync.includes("key: `mcp.servers.${serverName}`"), 'Old Codex mcp.servers.<name> key is removed');
assert(sync.includes("url.replace(/\\/sse\\/?$/, '/mcp')"), 'Codex MCP URL normalizes /sse to /mcp');
assert(sync.includes('converted.http_headers = converted.headers'), 'Codex MCP converts headers to http_headers');
assert(sync.includes("delete converted.transport"), 'Codex MCP removes Cursor transport marker');
assert(sync.includes('value: toCodexMcpTomlEntry(entry)'), 'Codex MCP merge_toml value is a structured object');
assert(!sync.includes('value: JSON.stringify(toCodexMcpTomlEntry(entry))'), 'Codex MCP merge_toml value is not escaped JSON');
assert(sync.includes("action: 'merge_mcp_json'"), 'Cursor MCP path still emits merge_mcp_json');
assert(sync.includes('overwrite: false') && sync.includes('successful setup, so restart hints do not force a re-apply loop'), 'Codex policy TOML action is idempotent');
assert(sync.includes('manifest_path: manifestPath'), 'Complex skill write_file actions carry explicit manifest_path');
assert(sync.includes('clientAdapter.getManifestDir()'), 'Complex skill manifests are resolved through the active client adapter');
assert(codexAdapter.includes('getCodexManifestDirForClient') && codexAdapter.includes('return getCodexManifestDirForClient()'), 'Codex manifests use ~/.csp-ai-agent/codex/.manifests');
assert(cursorAdapter.includes("return getCspAgentDirForClient('.manifests')"), 'Cursor manifests keep the legacy ~/.csp-ai-agent/.manifests path');

assert(uninstall.includes("agentProfile === 'codex'"), 'Uninstall has Codex branch');
assert(uninstall.includes('resolveMcpServerNamesForUninstall'), 'Uninstall resolves all MCP server names from mcp-config.json');
assert(uninstall.includes('apiClient.getSubscriptions'), 'Direct uninstall can resolve MCP resource id from subscription name');
assert(manageSubscription.includes('resource_id: resourceId'), 'manage_subscription forwards canonical resource_id to uninstall_resource');
assert(uninstall.includes('for (const serverName of serverNames)'), 'Uninstall iterates all MCP server keys for cleanup');
assert(uninstall.includes("action: 'remove_toml_entry'"), 'Codex uninstall removes TOML MCP section');
assert(uninstall.includes("Do not emit Cursor install-dir cleanup here"), 'Codex uninstall avoids Cursor cleanup path');
assert(uninstall.includes("action: 'remove_mcp_json_entry'"), 'Cursor uninstall still removes mcp.json entry');

assert(promptManager.includes('write it as the TOML table \\`[mcp_servers.<name>]\\`'), 'Setup prompt explains object merge_toml table writes');
assert(promptManager.includes('do not write the object as quoted or escaped JSON'), 'Setup prompt forbids escaped JSON TOML writes');
assert(promptManager.includes('encoding === "base64"'), 'Setup prompt requires base64 decoding for write_file actions');
assert(promptManager.includes('skill_manifest_content'), 'Setup prompt explains complex skill manifest handling');
assert(promptManager.includes('action.manifest_path'), 'Setup prompt uses action.manifest_path for complex skill manifest comparison');
assert(promptManager.includes('Create parent directories for both \\`path\\` and any \\`manifest_path\\`'), 'Setup prompt requires creating manifest parent directories');
assert(promptManager.includes('Never write \\`SKILL.md\\` into the skill script directory'), 'Setup prompt prevents SKILL.md from being written to script dir');
assert(types.includes('Record<string, unknown>'), 'MergeTomlAction accepts structured object values');
assert(types.includes('manifest_path?: string'), 'WriteFileAction exposes optional manifest_path');
assert(!types.includes('JSON-encoded object'), 'MergeTomlAction no longer documents escaped JSON object values');
assert(types.includes('resource_id?: string'), 'uninstall_resource params accept canonical resource_id for MCP cleanup');

assert(usage.includes('agent_profile: AgentProfile'), 'query_usage_stats result exposes agent_profile');
assert(usage.includes('agent_profile: agentProfile'), 'query_usage_stats returns resolved agent_profile');
assert(usage.includes('telemetry.setUserToken(userToken);'), 'query_usage_stats activates the caller token before flushing telemetry');
assert(usage.includes('await telemetry.flush();'), 'query_usage_stats flushes telemetry before reading remote usage');
assert(http.includes('function cacheToolFollowUpActions'), 'http server has a shared tool follow-up cache helper');
assert(http.includes('cacheToolFollowUpActions(userToken, result);'), 'tool calls cache local_actions_required and restart hints after execution');
assert(http.includes('promptManager.storeSyncActions(userToken ?? \'\', actions);'), 'tool follow-up cache stores local actions in promptManager');
assert(http.includes('promptManager.storeRestartHint(userToken ?? \'\', toolResult.data.restart_hint);'), 'tool follow-up cache stores restart hints in promptManager');

console.log('='.repeat(80));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(80));

process.exit(failed > 0 ? 1 : 0);
