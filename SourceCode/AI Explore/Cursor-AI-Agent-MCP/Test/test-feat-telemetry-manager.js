/**
 * Test Suite: TelemetryManager — Unit Tests
 * Feature: FEAT-2026-03-20-001 AI Resource Usage Telemetry
 *
 * Tests:
 *   1. File auto-initialization
 *   2. recordInvocation — first call creates entry
 *   3. recordInvocation — subsequent calls increment count
 *   4. recordInvocation — multiple resources tracked independently
 *   5. updateSubscribedRules — replaces full list
 *   6. flush — calls reportFn with correct payload
 *   7. flush — clears pending_events on success
 *   8. flush — retains pending_events on failure
 *   9. flush — skips silently when no token
 *  10. startPeriodicFlush / stopPeriodicFlush — lifecycle
 *  11. Atomic write — temp file cleaned up on success
 *  12. getTelemetryFilePath — returns correct platform path
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─────────────────────────────── helpers ────────────────────────────────────

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

function assertEqual(a, b, msg) {
  assert(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}

async function runTests() {
  // ── Dynamic import (ESM compiled output) ──────────────────────────────────
  const distPath = path.resolve(__dirname, '../SourceCode/dist');

  let TelemetryManager, getTelemetryFilePath;
  try {
    const managerMod = await import(`file://${distPath}/telemetry/manager.js`);
    TelemetryManager = managerMod.TelemetryManager;

    const pathsMod = await import(`file://${distPath}/utils/cursor-paths.js`);
    getTelemetryFilePath = pathsMod.getTelemetryFilePath;
  } catch (err) {
    console.error('❌ Cannot import compiled modules. Run npm run build first.\n', err.message);
    process.exit(1);
  }

  // Use a temp dir so tests never touch real ~/.cursor
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-telemetry-test-'));
  const tmpFile = path.join(tmpDir, 'ai-resource-telemetry.json');

  function makeMgr() {
    return new TelemetryManager(tmpFile, '0.0.0-test');
  }

  function readFile() {
    return JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  }

  // Clean slate before each sub-group
  function clean() {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }

  console.log('\n=== TelemetryManager Unit Tests ===\n');

  // ── Test 1: File auto-initialization ─────────────────────────────────────
  console.log('Group 1: File auto-initialization');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('res-001', 'mcp', 'my-tool');
    assert(fs.existsSync(tmpFile), 'telemetry file is created automatically');
    const data = readFile();
    assert(Array.isArray(data.pending_events), 'pending_events is an array');
    assert(Array.isArray(data.subscribed_rules), 'subscribed_rules is an array');
  }

  // ── Test 2: First invocation creates entry ────────────────────────────────
  console.log('\nGroup 2: First invocation creates entry');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('res-sync', 'mcp', 'sync_resources');
    const data = readFile();
    assertEqual(data.pending_events.length, 1, 'one event recorded');
    const evt = data.pending_events[0];
    assertEqual(evt.resource_id, 'res-sync', 'resource_id correct');
    assertEqual(evt.resource_type, 'mcp', 'resource_type correct');
    assertEqual(evt.resource_name, 'sync_resources', 'resource_name correct');
    assertEqual(evt.invocation_count, 1, 'initial invocation_count = 1');
    assert(evt.first_invoked_at === evt.last_invoked_at, 'first and last invoked_at equal on first call');
  }

  // ── Test 3: Subsequent calls increment count ──────────────────────────────
  console.log('\nGroup 3: Subsequent calls increment count');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('res-sync', 'mcp', 'sync_resources');
    await mgr.recordInvocation('res-sync', 'mcp', 'sync_resources');
    await mgr.recordInvocation('res-sync', 'mcp', 'sync_resources');
    const data = readFile();
    assertEqual(data.pending_events.length, 1, 'still only one event entry for same resource');
    assertEqual(data.pending_events[0].invocation_count, 3, 'invocation_count incremented to 3');
  }

  // ── Test 4: Multiple resources tracked independently ─────────────────────
  console.log('\nGroup 4: Multiple resources tracked independently');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('res-a', 'mcp', 'tool-a');
    await mgr.recordInvocation('res-b', 'mcp', 'tool-b');
    await mgr.recordInvocation('res-a', 'mcp', 'tool-a');
    const data = readFile();
    assertEqual(data.pending_events.length, 2, 'two separate event entries');
    const a = data.pending_events.find(e => e.resource_id === 'res-a');
    const b = data.pending_events.find(e => e.resource_id === 'res-b');
    assertEqual(a.invocation_count, 2, 'res-a count = 2');
    assertEqual(b.invocation_count, 1, 'res-b count = 1');
  }

  // ── Test 5: updateSubscribedRules replaces full list ─────────────────────
  console.log('\nGroup 5: updateSubscribedRules');
  {
    clean();
    const mgr = makeMgr();
    await mgr.updateSubscribedRules([
      { resource_id: 'rule-001', resource_name: 'rule-a', subscribed_at: '2026-01-01T00:00:00Z' },
    ]);
    let data = readFile();
    assertEqual(data.subscribed_rules.length, 1, 'one rule stored');

    await mgr.updateSubscribedRules([
      { resource_id: 'rule-002', resource_name: 'rule-b', subscribed_at: '2026-02-01T00:00:00Z' },
      { resource_id: 'rule-003', resource_name: 'rule-c', subscribed_at: '2026-02-02T00:00:00Z' },
    ]);
    data = readFile();
    assertEqual(data.subscribed_rules.length, 2, 'rules list fully replaced (not appended)');
    assertEqual(data.subscribed_rules[0].resource_id, 'rule-002', 'new rule-002 present');
  }

  // ── Test 6: flush calls reportFn with correct payload ────────────────────
  console.log('\nGroup 6: flush — calls reportFn with correct payload');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('res-x', 'mcp', 'tool-x');
    await mgr.updateSubscribedRules([
      { resource_id: 'rule-r', resource_name: 'rule-r', subscribed_at: '2026-01-01T00:00:00Z' },
    ]);

    let capturedPayload = null;
    mgr.configure(
      async (payload) => { capturedPayload = payload; },
      () => 'test-token'
    );

    await mgr.flush();

    assert(capturedPayload !== null, 'reportFn was called');
    assertEqual(capturedPayload.events.length, 1, 'payload contains 1 event');
    assertEqual(capturedPayload.events[0].resource_id, 'res-x', 'event resource_id correct');
    assertEqual(capturedPayload.subscribed_rules.length, 1, 'payload contains 1 subscribed_rule');
    assert(typeof capturedPayload.reported_at === 'string', 'reported_at is a string');
  }

  // ── Test 7: flush clears pending_events on success ───────────────────────
  console.log('\nGroup 7: flush — clears pending_events on success');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('res-y', 'mcp', 'tool-y');
    mgr.configure(async () => {}, () => 'test-token');

    await mgr.flush();
    const data = readFile();
    assertEqual(data.pending_events.length, 0, 'pending_events cleared after successful flush');
    assert(data.last_reported_at !== null, 'last_reported_at updated');
  }

  // ── Test 8: flush retains pending_events on failure ──────────────────────
  console.log('\nGroup 8: flush — retains pending_events on API failure');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('res-z', 'mcp', 'tool-z');
    mgr.configure(
      async () => { throw new Error('network error'); },
      () => 'test-token'
    );

    await mgr.flush(); // Should swallow error after 3 retries
    const data = readFile();
    assertEqual(data.pending_events.length, 1, 'pending_events retained after flush failure');
    assertEqual(data.pending_events[0].invocation_count, 1, 'invocation_count unchanged');
  }

  // ── Test 9: flush skips silently when no token ────────────────────────────
  console.log('\nGroup 9: flush — skips when no token');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('res-w', 'mcp', 'tool-w');

    let called = false;
    mgr.configure(async () => { called = true; }, () => undefined);

    await mgr.flush();
    assert(!called, 'reportFn NOT called when token is undefined');
  }

  // ── Test 10: startPeriodicFlush / stopPeriodicFlush ───────────────────────
  console.log('\nGroup 10: startPeriodicFlush / stopPeriodicFlush lifecycle');
  {
    const mgr = makeMgr();
    mgr.configure(async () => {}, () => 'test-token');
    // Should not throw
    mgr.startPeriodicFlush(50000); // large interval so it doesn't fire
    assert(true, 'startPeriodicFlush does not throw');
    mgr.stopPeriodicFlush();
    assert(true, 'stopPeriodicFlush does not throw');
    // Calling stop twice should be safe
    mgr.stopPeriodicFlush();
    assert(true, 'double stopPeriodicFlush is safe');
  }

  // ── Test 11: Atomic write — no leftover tmp file ──────────────────────────
  console.log('\nGroup 11: Atomic write — no leftover tmp file');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('res-atomic', 'mcp', 'tool-atomic');
    const tmpPattern = `${tmpFile}.`;
    const dir = path.dirname(tmpFile);
    const leftover = fs.readdirSync(dir).filter(f => path.join(dir, f).startsWith(tmpPattern));
    assertEqual(leftover.length, 0, 'no temporary .tmp files left after write');
  }

  // ── Test 12: flushOnReconnect — fires flush immediately ──────────────────
  console.log('\nGroup 12: flushOnReconnect — fires flush immediately');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('res-reconnect', 'mcp', 'tool-reconnect');

    let flushCalled = false;
    mgr.configure(
      async () => { flushCalled = true; },
      () => 'test-token'
    );

    mgr.flushOnReconnect();
    // flushOnReconnect is fire-and-forget; give microtasks time to run
    await new Promise((res) => setTimeout(res, 50));
    assert(flushCalled, 'flushOnReconnect triggers flush immediately');

    // Pending events should be cleared after successful flush
    const data = readFile();
    assertEqual(data.pending_events.length, 0, 'pending_events cleared after reconnect flush');
  }

  // ── Test 13: getTelemetryFilePath ─────────────────────────────────────────
  console.log('\nGroup 13: getTelemetryFilePath');
  {
    const p = getTelemetryFilePath();
    assert(typeof p === 'string' && p.length > 0, 'getTelemetryFilePath returns non-empty string');
    assert(p.endsWith('ai-resource-telemetry.json'), 'path ends with ai-resource-telemetry.json');
    assert(p.includes('.cursor'), 'path contains .cursor directory');
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 Test Summary: ${passed + failed} total | ✅ ${passed} passed | ❌ ${failed} failed`);
  if (failed === 0) {
    console.log('🎉 All tests passed (100% Pass Rate)');
  } else {
    console.log(`⚠️  ${failed} test(s) failed`);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
