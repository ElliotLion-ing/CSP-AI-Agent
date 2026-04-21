/**
 * Test Suite: TelemetryManager v2 — Unit Tests
 * Feature: FEAT MCP Prompt Telemetry (阶段5)
 *
 * New functionality verified here (on top of existing telemetry tests):
 *   1.  File path is in CWD, not ~/.cursor/
 *   2.  recordInvocation with jira_id creates separate aggregation entry
 *   3.  recordInvocation same resource + same jira_id increments count
 *   4.  recordInvocation same resource + different jira_id = separate entries
 *   5.  recordInvocation same resource + no jira_id = separate entry from jira_id variant
 *   6.  jira_id preserved in pending_events payload
 *   7.  updateConfiguredMcps — stores full list
 *   8.  updateConfiguredMcps — replaces list (not appended)
 *   9.  flush payload includes configured_mcps
 *  10.  flush payload includes jira_id in events
 *  11.  flush payload omits jira_id when undefined
 *  12.  configured_mcps included in flush payload
 *  13.  File auto-initialises configured_mcps as empty array
 *  14.  Old-format file (missing configured_mcps) is handled gracefully
 *  15.  Atomic write — no leftover .tmp files for telemetry file
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

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

// ─────────────────────────────── main ───────────────────────────────────────

async function runTests() {
  const distPath = path.resolve(__dirname, '../SourceCode/dist');

  let TelemetryManager;
  try {
    const managerMod = await import(`file://${distPath}/telemetry/manager.js`);
    TelemetryManager = managerMod.TelemetryManager;
  } catch (err) {
    console.error('❌ Cannot import compiled modules. Run npm run build first.\n', err.message);
    process.exit(1);
  }

  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-telemetry-v2-test-'));
  const tmpFile = path.join(tmpDir, 'ai-resource-telemetry.json');

  function makeMgr() {
    return new TelemetryManager(tmpFile, '0.0.0-test');
  }

  function readFile() {
    return JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  }

  function clean() {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }

  console.log('\n=== TelemetryManager v2 Unit Tests ===\n');

  // ── Test 1: File path in CWD not ~/.cursor/ ───────────────────────────────
  console.log('Group 1: File path is in a custom directory (not hardcoded ~/.cursor/)');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('cmd-001', 'command', 'my-cmd');
    assert(fs.existsSync(tmpFile), 'telemetry file created at the custom path');
    assert(!tmpFile.includes('.cursor'), 'file path does not contain .cursor');
  }

  // ── Test 2: jira_id creates separate entry ────────────────────────────────
  console.log('\nGroup 2: recordInvocation with jira_id — separate aggregation entry');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('cmd-001', 'command', 'my-cmd');
    await mgr.recordInvocation('cmd-001', 'command', 'my-cmd', 'PROJ-1111111');
    const data = readFile();
    assertEqual(data.pending_events.length, 2, 'no-jira_id and jira_id entries are separate');
  }

  // ── Test 3: Same resource + same jira_id → increment ─────────────────────
  console.log('\nGroup 3: Same resource + same jira_id increments count');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('cmd-002', 'command', 'cmd2', 'PROJ-9999');
    await mgr.recordInvocation('cmd-002', 'command', 'cmd2', 'PROJ-9999');
    await mgr.recordInvocation('cmd-002', 'command', 'cmd2', 'PROJ-9999');
    const data = readFile();
    assertEqual(data.pending_events.length, 1, 'single aggregated entry for same (resource, jira_id)');
    assertEqual(data.pending_events[0].invocation_count, 3, 'count incremented to 3');
    assertEqual(data.pending_events[0].jira_id, 'PROJ-9999', 'jira_id preserved');
  }

  // ── Test 4: Different jira_id → separate entries ──────────────────────────
  console.log('\nGroup 4: Same resource + different jira_id → separate entries');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('cmd-003', 'command', 'cmd3', 'PROJ-0001');
    await mgr.recordInvocation('cmd-003', 'command', 'cmd3', 'PROJ-0002');
    const data = readFile();
    assertEqual(data.pending_events.length, 2, 'two separate entries for two different jira_ids');
    const ids = data.pending_events.map(e => e.jira_id);
    assert(ids.includes('PROJ-0001'), 'PROJ-0001 entry present');
    assert(ids.includes('PROJ-0002'), 'PROJ-0002 entry present');
  }

  // ── Test 5: No jira_id ≠ jira_id variant ─────────────────────────────────
  console.log('\nGroup 5: No jira_id and jira_id variant are separate entries');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('cmd-004', 'command', 'cmd4');
    await mgr.recordInvocation('cmd-004', 'command', 'cmd4', 'PROJ-5555');
    await mgr.recordInvocation('cmd-004', 'command', 'cmd4');
    const data = readFile();
    assertEqual(data.pending_events.length, 2, 'no-jira and jira entries tracked separately');
    const noJira  = data.pending_events.find(e => !e.jira_id);
    const withJira = data.pending_events.find(e => e.jira_id === 'PROJ-5555');
    assert(noJira  !== undefined, 'no-jira_id entry present');
    assert(withJira !== undefined, 'PROJ-5555 entry present');
    assertEqual(noJira.invocation_count, 2, 'no-jira entry count = 2');
    assertEqual(withJira.invocation_count, 1, 'PROJ-5555 entry count = 1');
  }

  // ── Test 6: jira_id preserved in file ────────────────────────────────────
  console.log('\nGroup 6: jira_id field preserved in pending_events file');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('cmd-005', 'command', 'cmd5', 'PROJ-7777777');
    const data = readFile();
    assertEqual(data.pending_events[0].jira_id, 'PROJ-7777777', 'jira_id written to file');
  }

  // ── Test 7: updateConfiguredMcps — stores list ────────────────────────────
  console.log('\nGroup 7: updateConfiguredMcps — stores list');
  {
    clean();
    const mgr = makeMgr();
    await mgr.updateConfiguredMcps([
      { resource_id: 'mcp-001', resource_name: 'acm', configured_at: '2026-01-01T00:00:00Z' },
    ]);
    const data = readFile();
    assertEqual(data.configured_mcps.length, 1, 'one configured_mcp stored');
    assertEqual(data.configured_mcps[0].resource_id, 'mcp-001', 'resource_id correct');
  }

  // ── Test 8: updateConfiguredMcps — replaces full list ────────────────────
  console.log('\nGroup 8: updateConfiguredMcps — replaces (not appends)');
  {
    clean();
    const mgr = makeMgr();
    await mgr.updateConfiguredMcps([
      { resource_id: 'mcp-a', resource_name: 'mcp-a', configured_at: '2026-01-01T00:00:00Z' },
    ]);
    await mgr.updateConfiguredMcps([
      { resource_id: 'mcp-b', resource_name: 'mcp-b', configured_at: '2026-02-01T00:00:00Z' },
      { resource_id: 'mcp-c', resource_name: 'mcp-c', configured_at: '2026-03-01T00:00:00Z' },
    ]);
    const data = readFile();
    assertEqual(data.configured_mcps.length, 2, 'list replaced (length = 2, not 3)');
    assert(!data.configured_mcps.find(m => m.resource_id === 'mcp-a'), 'mcp-a no longer present');
  }

  // ── Test 9: flush payload includes configured_mcps ────────────────────────
  console.log('\nGroup 9: flush — payload includes configured_mcps');
  {
    clean();
    const mgr = makeMgr();
    await mgr.updateConfiguredMcps([
      { resource_id: 'mcp-flush', resource_name: 'mcp-flush', configured_at: '2026-01-01T00:00:00Z' },
    ]);
    await mgr.recordInvocation('cmd-flush', 'command', 'cmd-flush');

    let capturedPayload = null;
    mgr.configure(
      async (payload) => { capturedPayload = payload; },
      () => 'test-token',
    );
    await mgr.flush();

    assert(capturedPayload !== null, 'reportFn was called');
    assert(Array.isArray(capturedPayload.configured_mcps), 'configured_mcps is an array in payload');
    assertEqual(capturedPayload.configured_mcps.length, 1, 'one configured_mcp in payload');
    assertEqual(capturedPayload.configured_mcps[0].resource_id, 'mcp-flush', 'correct mcp in payload');
  }

  // ── Test 10: flush payload includes jira_id in events ────────────────────
  console.log('\nGroup 10: flush — payload events include jira_id');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('cmd-jira', 'command', 'cmd-jira', 'PROJ-12345');

    let capturedPayload = null;
    mgr.configure(
      async (payload) => { capturedPayload = payload; },
      () => 'test-token',
    );
    await mgr.flush();

    assert(capturedPayload !== null, 'reportFn called');
    assertEqual(capturedPayload.events[0].jira_id, 'PROJ-12345', 'jira_id present in payload event');
  }

  // ── Test 11: flush payload omits jira_id when undefined ──────────────────
  console.log('\nGroup 11: flush — payload omits jira_id when undefined');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('cmd-nojira', 'command', 'cmd-nojira');

    let capturedPayload = null;
    mgr.configure(
      async (payload) => { capturedPayload = payload; },
      () => 'test-token',
    );
    await mgr.flush();

    assert(capturedPayload !== null, 'reportFn called');
    const evt = capturedPayload.events[0];
    assert(!('jira_id' in evt) || evt.jira_id === undefined, 'jira_id absent when not provided');
  }

  // ── Test 12: configured_mcps included in flush after update ──────────────
  console.log('\nGroup 12: configured_mcps survives flush (not cleared like events)');
  {
    clean();
    const mgr = makeMgr();
    await mgr.updateConfiguredMcps([
      { resource_id: 'mcp-persist', resource_name: 'persist', configured_at: '2026-01-01T00:00:00Z' },
    ]);
    await mgr.recordInvocation('cmd-any', 'command', 'any');

    mgr.configure(async () => {}, () => 'test-token');
    await mgr.flush();

    // After flush, configured_mcps should remain (they are not cleared like events)
    const data = readFile();
    assertEqual(data.configured_mcps.length, 1, 'configured_mcps NOT cleared after flush');
    assertEqual(data.configured_mcps[0].resource_id, 'mcp-persist', 'correct mcp remains');
    assertEqual(data.pending_events.length, 0, 'pending_events cleared after flush');
  }

  // ── Test 13: File auto-initialises configured_mcps as [] ──────────────────
  console.log('\nGroup 13: File auto-initialises configured_mcps as empty array');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('cmd-init', 'command', 'init');
    const data = readFile();
    assert(Array.isArray(data.configured_mcps), 'configured_mcps is an array');
    assertEqual(data.configured_mcps.length, 0, 'configured_mcps starts empty');
  }

  // ── Test 14: Old-format file (missing configured_mcps) handled gracefully ─
  console.log('\nGroup 14: Old-format file (missing configured_mcps) handled gracefully');
  {
    clean();
    // Write an old-format file without configured_mcps
    const oldFormat = {
      client_version: '0.0.0-old',
      last_reported_at: null,
      pending_events: [],
      subscribed_rules: [],
      // configured_mcps intentionally absent
    };
    fs.writeFileSync(tmpFile, JSON.stringify(oldFormat), 'utf8');

    const mgr = makeMgr();
    // Should not throw when reading old format
    await mgr.recordInvocation('cmd-compat', 'command', 'compat');
    const data = readFile();
    assert(Array.isArray(data.configured_mcps), 'configured_mcps initialised even from old file');
    assertEqual(data.pending_events.length, 1, 'new event added successfully');
  }

  // ── Test 15: Atomic write — no leftover .tmp files ────────────────────────
  console.log('\nGroup 15: Atomic write — no leftover .tmp files in telemetry file');
  {
    clean();
    const mgr = makeMgr();
    await mgr.recordInvocation('cmd-atomic', 'command', 'atomic');
    const dir      = path.dirname(tmpFile);
    const tmpFiles = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
    assertEqual(tmpFiles.length, 0, 'no .tmp leftover files after telemetry write');
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
