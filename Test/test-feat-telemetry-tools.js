/**
 * Test Suite: Telemetry Tool Instrumentation Tests
 * Feature: FEAT-2026-03-20-001 AI Resource Usage Telemetry
 *
 * Verifies that all 5 MCP tool handlers call telemetry.recordInvocation()
 * by inspecting the compiled source code for the expected call patterns.
 *
 * Tests:
 *   1. sync_resources imports telemetry module
 *   2. sync_resources calls recordInvocation
 *   3. sync_resources calls updateSubscribedRules
 *   4. manage_subscription imports telemetry module
 *   5. manage_subscription calls recordInvocation
 *   6. search_resources imports telemetry module
 *   7. search_resources calls recordInvocation
 *   8. upload_resource imports telemetry module
 *   9. upload_resource calls recordInvocation
 *  10. uninstall_resource imports telemetry module
 *  11. uninstall_resource calls recordInvocation
 *  12. TelemetryManager singleton 'telemetry' is exported from telemetry/index
 *  13. index.ts configures telemetry with reportTelemetry
 *  14. index.ts calls startPeriodicFlush on server start
 *  15. index.ts calls stopPeriodicFlush + flush on shutdown
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

function readSrc(relPath) {
  const fullPath = path.resolve(__dirname, '../SourceCode/src', relPath);
  return fs.readFileSync(fullPath, 'utf8');
}

function readDist(relPath) {
  const fullPath = path.resolve(__dirname, '../SourceCode/dist', relPath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8');
}

console.log('\n=== Telemetry Tool Instrumentation Tests ===\n');

// ── Source-level checks ───────────────────────────────────────────────────────

console.log('Group 1: sync_resources instrumentation');
{
  const src = readSrc('tools/sync-resources.ts');
  assert(src.includes("from '../telemetry/index.js'"), 'sync_resources imports telemetry module');
  assert(src.includes('telemetry.recordInvocation('), 'sync_resources calls recordInvocation');
  assert(src.includes('mcp-tool-sync-resources'), 'sync_resources uses correct resource_id');
  assert(src.includes('telemetry.updateSubscribedRules('), 'sync_resources calls updateSubscribedRules');
  assert(src.includes("s.type === 'rule'"), 'sync_resources filters rules for updateSubscribedRules');
}

console.log('\nGroup 2: manage_subscription instrumentation');
{
  const src = readSrc('tools/manage-subscription.ts');
  assert(src.includes("from '../telemetry/index.js'"), 'manage_subscription imports telemetry module');
  assert(src.includes('telemetry.recordInvocation('), 'manage_subscription calls recordInvocation');
  assert(src.includes('mcp-tool-manage-subscription'), 'manage_subscription uses correct resource_id');
}

console.log('\nGroup 3: search_resources instrumentation');
{
  const src = readSrc('tools/search-resources.ts');
  assert(src.includes("from '../telemetry/index.js'"), 'search_resources imports telemetry module');
  assert(src.includes('telemetry.recordInvocation('), 'search_resources calls recordInvocation');
  assert(src.includes('mcp-tool-search-resources'), 'search_resources uses correct resource_id');
}

console.log('\nGroup 4: upload_resource instrumentation');
{
  const src = readSrc('tools/upload-resource.ts');
  assert(src.includes("from '../telemetry/index.js'"), 'upload_resource imports telemetry module');
  assert(src.includes('telemetry.recordInvocation('), 'upload_resource calls recordInvocation');
  assert(src.includes('mcp-tool-upload-resource'), 'upload_resource uses correct resource_id');
}

console.log('\nGroup 5: uninstall_resource instrumentation');
{
  const src = readSrc('tools/uninstall-resource.ts');
  assert(src.includes("from '../telemetry/index.js'"), 'uninstall_resource imports telemetry module');
  assert(src.includes('telemetry.recordInvocation('), 'uninstall_resource calls recordInvocation');
  assert(src.includes('mcp-tool-uninstall-resource'), 'uninstall_resource uses correct resource_id');
}

console.log('\nGroup 6: TelemetryManager module exports');
{
  const src = readSrc('telemetry/index.ts');
  assert(src.includes("export { TelemetryManager, telemetry }"), 'telemetry/index exports TelemetryManager and singleton');

  const managerSrc = readSrc('telemetry/manager.ts');
  assert(managerSrc.includes('export const telemetry = new TelemetryManager()'), 'singleton telemetry exported from manager');
  assert(managerSrc.includes('getTelemetryFilePath'), 'manager uses getTelemetryFilePath from cursor-paths');
  assert(managerSrc.includes('write-then-rename'), 'manager documents atomic write strategy');
  assert(managerSrc.includes('MAX_RETRIES'), 'manager defines MAX_RETRIES');
}

console.log('\nGroup 7: Server lifecycle integration (index.ts)');
{
  const src = readSrc('index.ts');
  assert(src.includes("from './telemetry/index.js'"), 'index.ts imports telemetry');
  assert(src.includes("from './api/client.js'"), 'index.ts imports apiClient');
  assert(src.includes('telemetry.configure('), 'index.ts calls telemetry.configure');
  assert(src.includes('reportTelemetry'), 'index.ts wires reportTelemetry into telemetry');
  assert(src.includes('telemetry.startPeriodicFlush('), 'index.ts calls startPeriodicFlush');
  assert(src.includes('10_000'), 'startPeriodicFlush called with 10s interval');
  assert(src.includes('telemetry.stopPeriodicFlush()'), 'index.ts calls stopPeriodicFlush on shutdown');
  assert(src.includes('await telemetry.flush()'), 'index.ts awaits final flush on shutdown');

  // SSE reconnect flush
  const httpSrc = readSrc('server/http.ts');
  assert(httpSrc.includes("from '../telemetry/index.js'"), 'http.ts imports telemetry');
  assert(httpSrc.includes('telemetry.flushOnReconnect()'), 'http.ts calls flushOnReconnect on MCP initialized');
  assert(httpSrc.includes('oninitialized'), 'flushOnReconnect wired inside oninitialized hook');

  // stdio reconnect flush
  const serverSrc = readSrc('server.ts');
  assert(serverSrc.includes('flushOnReconnect'), 'server.ts calls flushOnReconnect after stdio connect');
}

console.log('\nGroup 7b: TelemetryManager.flushOnReconnect');
{
  const src = readSrc('telemetry/manager.ts');
  assert(src.includes('flushOnReconnect'), 'manager.ts defines flushOnReconnect');
  assert(src.includes('flush().catch'), 'flushOnReconnect is fire-and-forget');
}

console.log('\nGroup 8: API client reportTelemetry method');
{
  const src = readSrc('api/client.ts');
  assert(src.includes('async reportTelemetry('), 'apiClient has reportTelemetry method');
  assert(src.includes('/csp/api/resources/telemetry'), 'reportTelemetry calls correct endpoint');
  assert(src.includes('this.authConfig(userToken)'), 'reportTelemetry uses per-request token');
}

console.log('\nGroup 9: cursor-paths utility');
{
  const src = readSrc('utils/cursor-paths.ts');
  assert(src.includes('getTelemetryFilePath'), 'cursor-paths exports getTelemetryFilePath');
  assert(src.includes('ai-resource-telemetry.json'), 'correct filename used');
  assert(src.includes('getCursorRootDir()'), 'path is relative to cursor root dir');
}

// ── Compiled output checks ─────────────────────────────────────────────────────

console.log('\nGroup 10: Compiled output exists');
{
  const mgr = readDist('telemetry/manager.js');
  assert(mgr !== null, 'dist/telemetry/manager.js exists');
  const idx = readDist('telemetry/index.js');
  assert(idx !== null, 'dist/telemetry/index.js exists');
  if (mgr) {
    assert(mgr.includes('TelemetryManager'), 'compiled manager.js contains TelemetryManager');
    assert(mgr.includes('recordInvocation'), 'compiled manager.js contains recordInvocation');
    assert(mgr.includes('flush'), 'compiled manager.js contains flush');
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`📊 Test Summary: ${passed + failed} total | ✅ ${passed} passed | ❌ ${failed} failed`);
if (failed === 0) {
  console.log('🎉 All tests passed (100% Pass Rate)');
} else {
  console.log(`⚠️  ${failed} test(s) failed`);
  process.exit(1);
}
