/**
 * Test Suite: PromptGenerator — Unit Tests
 * Feature: FEAT MCP Prompt Telemetry (阶段1)
 *
 * Tests:
 *   1.  replaceMDVariables — basic substitution
 *   2.  replaceMDVariables — multiple occurrences of same variable
 *   3.  replaceMDVariables — unknown variable left unchanged
 *   4.  replaceMDVariables — empty variables map
 *   5.  parseMarkdownWithImports — content with no import directives
 *   6.  parseMarkdownWithImports — resolves a valid import
 *   7.  parseMarkdownWithImports — missing import file handled gracefully
 *   8.  parseMarkdownWithImports — max depth guard prevents infinite recursion
 *   9.  generatePromptContentFromString — no imports, no variables
 *  10.  generatePromptContentFromString — variables substituted
 *  11.  generatePromptContentFromString — import expanded inline
 *  12.  PromptCache.write / read roundtrip
 *  13.  PromptCache.exists returns false for missing entry
 *  14.  PromptCache.delete removes the file
 *  15.  PromptCache.write is atomic (no leftover .tmp files)
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

// ─────────────────────────────── main ───────────────────────────────────────

async function runTests() {
  const distPath = path.resolve(__dirname, '../SourceCode/dist');

  let replaceMDVariables, parseMarkdownWithImports, generatePromptContentFromString, PromptCache;
  try {
    const genMod = await import(`file://${distPath}/prompts/generator.js`);
    replaceMDVariables             = genMod.replaceMDVariables;
    parseMarkdownWithImports       = genMod.parseMarkdownWithImports;
    generatePromptContentFromString = genMod.generatePromptContentFromString;

    const cacheMod = await import(`file://${distPath}/prompts/cache.js`);
    PromptCache = cacheMod.PromptCache;
  } catch (err) {
    console.error('❌ Cannot import compiled modules. Run npm run build first.\n', err.message);
    process.exit(1);
  }

  // Temp workspace
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-prompt-gen-test-'));

  console.log('\n=== PromptGenerator Unit Tests ===\n');

  // ── Test 1: replaceMDVariables basic substitution ─────────────────────────
  console.log('Group 1: replaceMDVariables — basic substitution');
  {
    const result = replaceMDVariables('Hello ${NAME}!', { NAME: 'World' });
    assertEqual(result, 'Hello World!', 'single variable replaced');
  }

  // ── Test 2: multiple occurrences of same variable ─────────────────────────
  console.log('\nGroup 2: replaceMDVariables — multiple occurrences');
  {
    const result = replaceMDVariables('${X} and ${X}', { X: 'foo' });
    assertEqual(result, 'foo and foo', 'all occurrences replaced');
  }

  // ── Test 3: unknown variable left unchanged ───────────────────────────────
  console.log('\nGroup 3: replaceMDVariables — unknown variable');
  {
    const result = replaceMDVariables('Hello ${UNKNOWN}!', {});
    assertEqual(result, 'Hello ${UNKNOWN}!', 'unknown variable kept as-is');
  }

  // ── Test 4: empty variables map ──────────────────────────────────────────
  console.log('\nGroup 4: replaceMDVariables — empty variables map');
  {
    const result = replaceMDVariables('No vars here.', {});
    assertEqual(result, 'No vars here.', 'no-variable content unchanged');
  }

  // ── Test 5: parseMarkdownWithImports — no imports ─────────────────────────
  console.log('\nGroup 5: parseMarkdownWithImports — no import directives');
  {
    const mdFile = path.join(tmpDir, 'simple.md');
    fs.writeFileSync(mdFile, '# Hello\nNo imports here.\n', 'utf8');
    const result = await parseMarkdownWithImports(mdFile);
    assertIncludes(result, '# Hello', 'heading preserved');
    assertIncludes(result, 'No imports here.', 'body preserved');
  }

  // ── Test 6: parseMarkdownWithImports — valid import ───────────────────────
  console.log('\nGroup 6: parseMarkdownWithImports — resolves a valid import');
  {
    const partialFile = path.join(tmpDir, 'partial.md');
    fs.writeFileSync(partialFile, 'Imported content.\n', 'utf8');

    const mainFile = path.join(tmpDir, 'main.md');
    fs.writeFileSync(mainFile, `# Main\nimport '${partialFile}'\nEnd.\n`, 'utf8');

    const result = await parseMarkdownWithImports(mainFile);
    assertIncludes(result, 'Imported content.', 'imported file content is inlined');
    assertIncludes(result, '# Main', 'main heading preserved');
    assertIncludes(result, 'End.', 'content after import preserved');
  }

  // ── Test 7: parseMarkdownWithImports — missing import file ────────────────
  console.log('\nGroup 7: parseMarkdownWithImports — missing import handled gracefully');
  {
    const mainFile = path.join(tmpDir, 'with-missing.md');
    fs.writeFileSync(mainFile, "import 'nonexistent.md'\nAfter import.\n", 'utf8');
    // Should not throw; missing file is replaced with a warning comment
    const result = await parseMarkdownWithImports(mainFile);
    assertIncludes(result, 'After import.', 'content after missing import still present');
  }

  // ── Test 8: max depth guard ───────────────────────────────────────────────
  console.log('\nGroup 8: parseMarkdownWithImports — max depth guard');
  {
    // Create two files that mutually import each other (would be infinite without guard)
    const fileA = path.join(tmpDir, 'cycleA.md');
    const fileB = path.join(tmpDir, 'cycleB.md');
    fs.writeFileSync(fileA, `import '${fileB}'\nContent A.\n`, 'utf8');
    fs.writeFileSync(fileB, `import '${fileA}'\nContent B.\n`, 'utf8');
    // Should complete without hanging (max depth cuts off recursion)
    const result = await parseMarkdownWithImports(fileA);
    assert(typeof result === 'string', 'returns a string even with cyclic imports');
  }

  // ── Test 9: generatePromptContentFromString — no imports, no vars ─────────
  console.log('\nGroup 9: generatePromptContentFromString — plain content');
  {
    const content = '# My Prompt\nDo something useful.\n';
    const result  = await generatePromptContentFromString(content, tmpDir);
    assertIncludes(result, '# My Prompt', 'heading preserved');
    assertIncludes(result, 'Do something useful.', 'body preserved');
  }

  // ── Test 10: generatePromptContentFromString — variable substitution ───────
  console.log('\nGroup 10: generatePromptContentFromString — variable substitution');
  {
    const content = 'Hello ${PERSON}!';
    const result  = await generatePromptContentFromString(content, tmpDir, { PERSON: 'Alice' });
    assertEqual(result, 'Hello Alice!', 'variable substituted in string-based flow');
  }

  // ── Test 11: generatePromptContentFromString — import expanded ────────────
  console.log('\nGroup 11: generatePromptContentFromString — import expanded');
  {
    // Write a partial file that the raw string will import
    const partPath = path.join(tmpDir, 'injected.md');
    fs.writeFileSync(partPath, 'Injected section.\n', 'utf8');

    const rawContent = `# Top\nimport '${partPath}'\nBottom.\n`;
    const result     = await generatePromptContentFromString(rawContent, tmpDir);
    assertIncludes(result, 'Injected section.', 'imported content inlined in string-based flow');
    assertIncludes(result, '# Top', 'top content preserved');
    assertIncludes(result, 'Bottom.', 'bottom content preserved');
  }

  // ── Test 12: PromptCache write / read roundtrip ───────────────────────────
  console.log('\nGroup 12: PromptCache — write / read roundtrip');
  {
    const cache = new PromptCache(tmpDir);
    cache.write('command', 'cmd-test-001', '# Prompt content');
    const read = cache.read('command', 'cmd-test-001');
    assertEqual(read, '# Prompt content', 'read returns exact written content');
  }

  // ── Test 13: PromptCache.exists false for missing ─────────────────────────
  console.log('\nGroup 13: PromptCache — exists returns false for missing entry');
  {
    const cache = new PromptCache(tmpDir);
    assert(!cache.exists('command', 'cmd-does-not-exist'), 'exists() = false for unknown resource');
  }

  // ── Test 14: PromptCache.delete removes file ──────────────────────────────
  console.log('\nGroup 14: PromptCache — delete removes the file');
  {
    const cache = new PromptCache(tmpDir);
    cache.write('skill', 'skill-test-del', 'to be deleted');
    assert(cache.exists('skill', 'skill-test-del'), 'file exists before delete');
    cache.delete('skill', 'skill-test-del');
    assert(!cache.exists('skill', 'skill-test-del'), 'file gone after delete');
  }

  // ── Test 15: PromptCache.write is atomic ─────────────────────────────────
  console.log('\nGroup 15: PromptCache — write is atomic (no leftover .tmp files)');
  {
    const cache = new PromptCache(tmpDir);
    cache.write('command', 'cmd-atomic', 'atomic content');
    const cacheDir = path.join(tmpDir, '.prompt-cache');
    const tmpFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.tmp'));
    assertEqual(tmpFiles.length, 0, 'no .tmp files remain after atomic write');
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
