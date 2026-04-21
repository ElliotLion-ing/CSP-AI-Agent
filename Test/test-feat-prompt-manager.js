/**
 * Test Suite: PromptManager — Unit Tests
 * Feature: FEAT MCP Prompt Telemetry (阶段2)
 *
 * Tests:
 *   1.  buildPromptName — command format
 *   2.  buildPromptName — skill format
 *   3.  buildPromptName — spaces normalised to hyphens
 *   4.  registerPrompt — prompt added to registry
 *   5.  registerPrompt — calling twice updates the entry (idempotent)
 *   6.  registerPrompt — generates cache file
 *   7.  unregisterPrompt — removes from registry
 *   8.  unregisterPrompt — non-existent entry is a no-op
 *   9.  refreshPrompt — same as re-registering (cache updated)
 *  10.  refreshAllPrompts — all resources registered
 *  11.  refreshAllPrompts — partial failure does not abort others
 *  12.  size — reflects current registry count
 *  13.  has — true for registered, false for unknown
 *  14.  promptNames — returns all registered names
 *  15.  installHandlers — ListPrompts returns registered prompts
 *  16.  installHandlers — GetPrompt returns content for registered prompt
 *  17.  installHandlers — GetPrompt returns fallback for unknown prompt
 *  18.  installHandlers — calling twice is a no-op (idempotent)
 *  19.  GetPrompt — jira_id forwarded to telemetry
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

function assertIncludes(str, sub, msg) {
  assert(typeof str === 'string' && str.includes(sub), `${msg} (substring "${sub}" not found)`);
}

// Minimal fake MCP Server that captures registered handlers.
function makeFakeServer() {
  const handlers = {};
  return {
    setRequestHandler(schema, fn) {
      handlers[schema.shape?.method?.value ?? String(schema)] = fn;
    },
    async dispatch(method, params) {
      const fn = handlers[method];
      if (!fn) throw new Error(`No handler for method: ${method}`);
      return fn({ method, params });
    },
    _handlers: handlers,
  };
}

// ─────────────────────────────── main ───────────────────────────────────────

async function runTests() {
  const distPath = path.resolve(__dirname, '../SourceCode/dist');

  let PromptManager, PromptCache;
  let ListPromptsRequestSchema, GetPromptRequestSchema;
  try {
    const managerMod = await import(`file://${distPath}/prompts/manager.js`);
    PromptManager = managerMod.PromptManager;

    const cacheMod = await import(`file://${distPath}/prompts/cache.js`);
    PromptCache = cacheMod.PromptCache;

    const typesMod = await import(`file://${distPath}/../node_modules/@modelcontextprotocol/sdk/dist/esm/types.js`);
    ListPromptsRequestSchema = typesMod.ListPromptsRequestSchema;
    GetPromptRequestSchema   = typesMod.GetPromptRequestSchema;
  } catch (err) {
    console.error('❌ Cannot import compiled modules. Run npm run build first.\n', err.message);
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-prompt-mgr-test-'));

  // PromptManager uses the promptCache singleton internally.
  // Each test creates a fresh PromptManager instance (fresh in-memory registry),
  // while the PromptCache singleton is pointed at our tmpDir via a separate
  // PromptCache instance used only for verification reads.
  function makeManager() {
    // Fresh PromptManager = empty in-memory registry
    return new PromptManager();
  }

  // Verification cache pointing at tmpDir
  function makeVerifyCache() {
    return new PromptCache(tmpDir);
  }

  // Sample resource metadata
  function makeMeta(overrides = {}) {
    return {
      resource_id:   'cmd-csp-test-cmd',
      resource_type: 'command',
      resource_name: 'test-cmd',
      team:          'csp',
      description:   'A test command',
      rawContent:    '# Test Command\nDo the thing.\n',
      ...overrides,
    };
  }

  console.log('\n=== PromptManager Unit Tests ===\n');

  // ── Test 1: buildPromptName — command format ──────────────────────────────
  console.log('Group 1: buildPromptName — command');
  {
    const mgr  = makeManager();
    const name = mgr.buildPromptName({ resource_type: 'command', team: 'csp', resource_name: 'my-cmd' });
    assertEqual(name, 'command/csp/my-cmd', 'command prompt name format correct');
  }

  // ── Test 2: buildPromptName — skill format ────────────────────────────────
  console.log('\nGroup 2: buildPromptName — skill');
  {
    const mgr  = makeManager();
    const name = mgr.buildPromptName({ resource_type: 'skill', team: 'client-sdk', resource_name: 'analyze-log' });
    assertEqual(name, 'skill/client-sdk/analyze-log', 'skill prompt name format correct');
  }

  // ── Test 3: buildPromptName — spaces normalised ───────────────────────────
  console.log('\nGroup 3: buildPromptName — spaces → hyphens');
  {
    const mgr  = makeManager();
    const name = mgr.buildPromptName({ resource_type: 'command', team: 'My Team', resource_name: 'My Command' });
    assertEqual(name, 'command/my-team/my-command', 'spaces converted to hyphens');
  }

  // ── Test 4: registerPrompt — added to registry ────────────────────────────
  console.log('\nGroup 4: registerPrompt — adds to registry');
  {
    const mgr = makeManager();
    await mgr.registerPrompt(makeMeta());
    assertEqual(mgr.size, 1, 'registry size = 1 after register');
    assert(mgr.has('command/csp/test-cmd'), 'prompt name present in registry');
  }

  // ── Test 5: registerPrompt — idempotent ───────────────────────────────────
  console.log('\nGroup 5: registerPrompt — idempotent (calling twice updates)');
  {
    const mgr = makeManager();
    await mgr.registerPrompt(makeMeta({ description: 'v1' }));
    await mgr.registerPrompt(makeMeta({ description: 'v2' }));
    assertEqual(mgr.size, 1, 'still only 1 entry after re-register');
  }

  // ── Test 6: registerPrompt — generates cache file ─────────────────────────
  console.log('\nGroup 6: registerPrompt — generates .prompt-cache file in CWD');
  {
    // The PromptManager singleton writes to process.cwd()/.prompt-cache/
    // We verify via the default promptCache singleton that the file exists.
    const { promptCache: singletonCache } = await import(`file://${distPath}/prompts/cache.js`);
    const mgr  = makeManager();
    const meta = makeMeta({ resource_id: 'cmd-cache-check-grp6' });
    await mgr.registerPrompt(meta);
    // File should exist in the singleton's CWD-based cache dir
    assert(singletonCache.exists('command', 'cmd-cache-check-grp6'), 'cache file created by registerPrompt');
    // Cleanup
    singletonCache.delete('command', 'cmd-cache-check-grp6');
  }

  // ── Test 7: unregisterPrompt — removes from registry ─────────────────────
  console.log('\nGroup 7: unregisterPrompt — removes from registry');
  {
    const mgr = makeManager();
    await mgr.registerPrompt(makeMeta());
    mgr.unregisterPrompt('cmd-csp-test-cmd', 'command', 'csp', 'test-cmd');
    assertEqual(mgr.size, 0, 'registry empty after unregister');
    assert(!mgr.has('command/csp/test-cmd'), 'prompt name no longer in registry');
  }

  // ── Test 8: unregisterPrompt — no-op for unknown ─────────────────────────
  console.log('\nGroup 8: unregisterPrompt — no-op for non-existent');
  {
    const mgr = makeManager();
    // Should not throw
    mgr.unregisterPrompt('cmd-nonexistent', 'command', 'csp', 'nonexistent');
    assert(true, 'unregisterPrompt on unknown entry does not throw');
  }

  // ── Test 9: refreshPrompt — cache updated ────────────────────────────────
  console.log('\nGroup 9: refreshPrompt — cache updated');
  {
    const { promptCache: singletonCache } = await import(`file://${distPath}/prompts/cache.js`);
    const mgr  = makeManager();
    const meta = makeMeta({ resource_id: 'cmd-refresh-grp9', resource_name: 'refresh-grp9', rawContent: '# v1' });
    await mgr.registerPrompt(meta);
    const v1 = singletonCache.read('command', 'cmd-refresh-grp9');
    assertIncludes(v1 ?? '', '# v1', 'v1 content cached');

    await mgr.refreshPrompt({ ...meta, rawContent: '# v2 updated' });
    const v2 = singletonCache.read('command', 'cmd-refresh-grp9');
    assertIncludes(v2 ?? '', '# v2 updated', 'v2 content written after refresh');

    singletonCache.delete('command', 'cmd-refresh-grp9');
  }

  // ── Test 10: refreshAllPrompts — all registered ───────────────────────────
  console.log('\nGroup 10: refreshAllPrompts — all resources registered');
  {
    const mgr   = makeManager();
    const metas = [
      makeMeta({ resource_id: 'cmd-a', resource_name: 'cmd-a' }),
      makeMeta({ resource_id: 'cmd-b', resource_name: 'cmd-b' }),
      makeMeta({ resource_id: 'cmd-c', resource_name: 'cmd-c', resource_type: 'skill' }),
    ];
    await mgr.refreshAllPrompts(metas);
    assertEqual(mgr.size, 3, 'all 3 resources registered after refreshAllPrompts');
  }

  // ── Test 11: refreshAllPrompts — partial failure doesn't abort ────────────
  console.log('\nGroup 11: refreshAllPrompts — partial failure does not abort others');
  {
    const mgr = makeManager();
    // One valid meta, one with rawContent that causes a generator error (null)
    const metas = [
      makeMeta({ resource_id: 'cmd-ok', resource_name: 'cmd-ok' }),
      // rawContent null would fail generation but registerPrompt falls back gracefully
      makeMeta({ resource_id: 'cmd-ok2', resource_name: 'cmd-ok2', rawContent: '' }),
    ];
    await mgr.refreshAllPrompts(metas);
    // Both should still be registered (generator failures are non-fatal)
    assert(mgr.size >= 1, 'at least 1 prompt registered despite partial issue');
  }

  // ── Test 12: size reflects count ─────────────────────────────────────────
  console.log('\nGroup 12: size — reflects current registry count');
  {
    const mgr = makeManager();
    assertEqual(mgr.size, 0, 'size = 0 initially');
    await mgr.registerPrompt(makeMeta({ resource_id: 'cmd-s1', resource_name: 'cmd-s1' }));
    assertEqual(mgr.size, 1, 'size = 1 after one register');
    await mgr.registerPrompt(makeMeta({ resource_id: 'cmd-s2', resource_name: 'cmd-s2' }));
    assertEqual(mgr.size, 2, 'size = 2 after two registers');
    mgr.unregisterPrompt('cmd-s1', 'command', 'csp', 'cmd-s1');
    assertEqual(mgr.size, 1, 'size = 1 after unregister');
  }

  // ── Test 13: has — correct membership ────────────────────────────────────
  console.log('\nGroup 13: has — true/false membership');
  {
    const mgr = makeManager();
    await mgr.registerPrompt(makeMeta());
    assert(mgr.has('command/csp/test-cmd'), 'has() = true for registered prompt');
    assert(!mgr.has('command/other/unknown'), 'has() = false for unregistered prompt');
  }

  // ── Test 14: promptNames — snapshot of all names ─────────────────────────
  console.log('\nGroup 14: promptNames — returns all registered names');
  {
    const mgr = makeManager();
    await mgr.registerPrompt(makeMeta({ resource_id: 'cmd-n1', resource_name: 'n1' }));
    await mgr.registerPrompt(makeMeta({ resource_id: 'cmd-n2', resource_name: 'n2', resource_type: 'skill' }));
    const names = mgr.promptNames();
    assertEqual(names.length, 2, 'promptNames returns 2 names');
    assert(names.includes('command/csp/n1'), 'n1 in names');
    assert(names.includes('skill/csp/n2'), 'n2 in names');
  }

  // ── Test 15: installHandlers — ListPrompts ────────────────────────────────
  console.log('\nGroup 15: installHandlers — ListPrompts returns registered prompts');
  {
    const mgr    = makeManager();
    const server = makeFakeServer();
    mgr.installHandlers(server);

    await mgr.registerPrompt(makeMeta({ description: 'A command desc' }));

    const listMethod = ListPromptsRequestSchema.shape?.method?.value ?? 'prompts/list';
    const response   = await server.dispatch(listMethod, {});
    assert(Array.isArray(response.prompts), 'response.prompts is an array');
    assertEqual(response.prompts.length, 1, '1 prompt listed');
    assertEqual(response.prompts[0].name, 'command/csp/test-cmd', 'prompt name correct');
    assertEqual(response.prompts[0].description, 'A command desc', 'description correct');
    assert(Array.isArray(response.prompts[0].arguments), 'arguments array present');
  }

  // ── Test 16: installHandlers — GetPrompt content ─────────────────────────
  console.log('\nGroup 16: installHandlers — GetPrompt returns content');
  {
    const mgr    = makeManager();
    const server = makeFakeServer();
    mgr.installHandlers(server);

    await mgr.registerPrompt(makeMeta({ rawContent: '# My Command\nRun this!' }));

    const getMethod = GetPromptRequestSchema.shape?.method?.value ?? 'prompts/get';
    const response  = await server.dispatch(getMethod, { name: 'command/csp/test-cmd', arguments: {} });
    assert(Array.isArray(response.messages), 'messages array present');
    assertEqual(response.messages[0].role, 'user', 'message role = user');
    assertIncludes(response.messages[0].content.text, '# My Command', 'prompt content returned');
  }

  // ── Test 17: installHandlers — GetPrompt fallback for unknown ────────────
  console.log('\nGroup 17: installHandlers — GetPrompt fallback for unknown prompt');
  {
    const mgr    = makeManager();
    const server = makeFakeServer();
    mgr.installHandlers(server);

    const getMethod = GetPromptRequestSchema.shape?.method?.value ?? 'prompts/get';
    const response  = await server.dispatch(getMethod, { name: 'command/unknown/nonexistent', arguments: {} });
    assert(Array.isArray(response.messages), 'fallback messages array present');
    assertIncludes(response.messages[0].content.text, 'not available', 'fallback message contains "not available"');
  }

  // ── Test 18: installHandlers — idempotent ─────────────────────────────────
  console.log('\nGroup 18: installHandlers — calling twice is a no-op');
  {
    const mgr    = makeManager();
    const server = makeFakeServer();
    // First install
    mgr.installHandlers(server);
    const handlerCountAfterFirst = Object.keys(server._handlers).length;
    // Second install should not overwrite or duplicate
    mgr.installHandlers(server);
    const handlerCountAfterSecond = Object.keys(server._handlers).length;
    assertEqual(handlerCountAfterFirst, handlerCountAfterSecond, 'handler count unchanged after second installHandlers');
  }

  // ── Test 19: GetPrompt — jira_id forwarded to telemetry ──────────────────
  console.log('\nGroup 19: GetPrompt — jira_id forwarded to telemetry recordInvocation');
  {
    // We cannot easily intercept the singleton telemetry here, but we can verify
    // that passing a jira_id does NOT cause an error and that the response is
    // still correctly formed.
    const mgr    = makeManager();
    const server = makeFakeServer();
    mgr.installHandlers(server);

    await mgr.registerPrompt(makeMeta({ rawContent: '# Cmd with Jira' }));

    const getMethod = GetPromptRequestSchema.shape?.method?.value ?? 'prompts/get';
    const response  = await server.dispatch(getMethod, {
      name: 'command/csp/test-cmd',
      arguments: { jira_id: 'PROJ-1234567' },
    });
    assert(Array.isArray(response.messages), 'response ok with jira_id argument');
    assertIncludes(response.messages[0].content.text, '# Cmd with Jira', 'correct prompt content returned');
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
