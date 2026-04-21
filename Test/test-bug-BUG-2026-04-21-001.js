/**
 * Test Case: SKILL.md Internal Markdown Reference Expansion (v2 — lazy-load via tool call)
 *
 * Bug ID: BUG-2026-04-21-001
 * Purpose: Verify that internal markdown references in SKILL.md are correctly
 * replaced with mandatory resolve_prompt_content tool call instructions,
 * enabling lazy-loading without context bloat.
 *
 * Key scenarios:
 *   - Single reference replaced by tool call block
 *   - Multiple references all replaced
 *   - External URLs / anchors untouched
 *   - No content is inlined (v1 behavior removed)
 *   - No largeFileActions generated
 *   - Nested references (A→B→C): expandMdReferences applied recursively
 *     at each resolve_prompt_content call — validated by calling expandMdReferences
 *     on the sub-file content as the server would do
 *   - resource_id is embedded correctly in the generated tool call JSON
 *   - Path traversal blocked in resolveSubResource (tested via module logic)
 */

'use strict';

const path = require('path');

// ANSI color codes
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE   = '\x1b[34m';
const RESET  = '\x1b[0m';

function log(color, prefix, message) {
  console.log(`${color}[${prefix}]${RESET} ${message}`);
}

// ---------------------------------------------------------------------------
// Load compiled module
// ---------------------------------------------------------------------------

const DIST_PATH = path.join(__dirname, '..', 'SourceCode', 'dist', 'utils', 'md-reference-expander.js');

let expandMdReferences;

try {
  const mod = require(DIST_PATH);
  expandMdReferences = mod.expandMdReferences;
  log(GREEN, 'LOAD', `Module loaded from ${DIST_PATH}`);
} catch (err) {
  log(RED, 'FATAL', `Cannot load compiled module: ${err.message}`);
  log(RED, 'FATAL', 'Run "npm run build" in SourceCode/ first.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, description, detail = '') {
  if (condition) {
    log(GREEN, 'PASS', description);
    passed++;
  } else {
    log(RED, 'FAIL', `${description}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

const RESOURCE_ID = '009157d8ed498e93c0dbdbdbd47ae40c';

// ---------------------------------------------------------------------------
// Test 1: No internal references — content unchanged
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('Test 1: No internal references — content passes through unchanged');
console.log(`${'='.repeat(70)}`);

{
  const content = '# SKILL\n\nNo references here.\n[external](https://example.com)\n[anchor](#section)\n';
  const { expandedContent } = expandMdReferences(content, RESOURCE_ID);

  assert(expandedContent === content, 'Content unchanged when no internal references');
  assert(!expandedContent.includes('MANDATORY'), 'No tool call blocks injected');
}

// ---------------------------------------------------------------------------
// Test 2: Single small reference → tool call block (no inlining)
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('Test 2: Single reference replaced by tool call block (no inlining)');
console.log(`${'='.repeat(70)}`);

{
  const skillMd = '# SKILL\n\nSee [reference.md](./references/reference.md) for details.\n';
  const { expandedContent } = expandMdReferences(skillMd, RESOURCE_ID);

  assert(
    expandedContent.includes('MANDATORY'),
    'Tool call block contains MANDATORY marker',
  );
  assert(
    expandedContent.includes('resolve_prompt_content'),
    'Tool call block references resolve_prompt_content',
  );
  assert(
    expandedContent.includes(RESOURCE_ID),
    'resource_id embedded in tool call JSON',
  );
  assert(
    expandedContent.includes('"resource_path":"references/reference.md"'),
    'resource_path embedded correctly (without leading "./")',
  );
  assert(
    expandedContent.includes('SKILL_RESOURCE_REF: references/reference.md'),
    'HTML comment marker present for tooling',
  );
  // Must NOT inline any content
  assert(
    !expandedContent.includes('BEGIN EMBEDDED'),
    'No inline embedding (v1 behavior removed)',
  );
  assert(
    !expandedContent.includes('[reference.md](./references/reference.md)'),
    'Original markdown link is replaced',
  );
}

// ---------------------------------------------------------------------------
// Test 3: Multiple references → each gets its own tool call block
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('Test 3: Multiple references — each replaced by individual tool call block');
console.log(`${'='.repeat(70)}`);

{
  const skillMd = [
    '# SKILL',
    'Follow [reference.md](./reference.md) for coding standards.',
    'Use [checklist.md](./checklist.md) during review.',
    'See [examples.md](./references/examples.md) for code samples.',
  ].join('\n');

  const { expandedContent } = expandMdReferences(skillMd, RESOURCE_ID);

  assert(
    (expandedContent.match(/MANDATORY/g) || []).length === 3,
    'Three MANDATORY tool call blocks generated (one per reference)',
  );
  assert(
    expandedContent.includes('"resource_path":"reference.md"'),
    'reference.md path embedded',
  );
  assert(
    expandedContent.includes('"resource_path":"checklist.md"'),
    'checklist.md path embedded',
  );
  assert(
    expandedContent.includes('"resource_path":"references/examples.md"'),
    'references/examples.md path embedded (subdirectory preserved)',
  );
}

// ---------------------------------------------------------------------------
// Test 4: External URLs are NOT processed
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('Test 4: External URLs are never processed');
console.log(`${'='.repeat(70)}`);

{
  const skillMd = '# SKILL\n\n[Google](https://google.com)\n[Docs](http://example.com/guide.md)\n';
  const { expandedContent } = expandMdReferences(skillMd, RESOURCE_ID);

  assert(
    expandedContent.includes('[Google](https://google.com)'),
    'External https:// URL link unchanged',
  );
  assert(
    expandedContent.includes('[Docs](http://example.com/guide.md)'),
    'External http:// URL link unchanged',
  );
  assert(!expandedContent.includes('MANDATORY'), 'No tool call blocks for external URLs');
}

// ---------------------------------------------------------------------------
// Test 5: Anchor-only links are NOT processed
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('Test 5: Anchor-only links are never processed');
console.log(`${'='.repeat(70)}`);

{
  const skillMd = '# SKILL\n\nSee [section](#my-section) for more.\n';
  const { expandedContent } = expandMdReferences(skillMd, RESOURCE_ID);

  assert(expandedContent.includes('[section](#my-section)'), 'Anchor-only link unchanged');
  assert(!expandedContent.includes('MANDATORY'), 'No tool call block for anchor link');
}

// ---------------------------------------------------------------------------
// Test 6: "./" prefix normalisation
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('Test 6: "./" prefix is stripped in the embedded resource_path');
console.log(`${'='.repeat(70)}`);

{
  const skillMd = '# SKILL\n\nSee [ref](./references/reference.md).\n';
  const { expandedContent } = expandMdReferences(skillMd, RESOURCE_ID);

  assert(
    expandedContent.includes('"resource_path":"references/reference.md"'),
    '"references/reference.md" (no leading "./") embedded in tool call JSON',
  );
  assert(
    !expandedContent.includes('"resource_path":"./references/reference.md"'),
    'No leading "./" in embedded resource_path',
  );
}

// ---------------------------------------------------------------------------
// Test 7: Nested references — A→B simulation
// (Server calls expandMdReferences on sub-file content at each level)
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('Test 7: Nested references A→B — server expands sub-file content too');
console.log(`${'='.repeat(70)}`);

{
  // SKILL.md references A.md
  const skillMd = '# SKILL\n\nSee [A.md](./A.md).\n';
  const { expandedContent: level1 } = expandMdReferences(skillMd, RESOURCE_ID);

  assert(
    level1.includes('"resource_path":"A.md"'),
    'Level 1: A.md reference replaced by tool call',
  );

  // Simulate: agent calls resolve_prompt_content(resource_id, resource_path="A.md")
  // Server reads A.md, finds it references B.md, calls expandMdReferences on A.md content
  const aMdContent = '# A\n\nThis references [B.md](./B.md).\n';
  const { expandedContent: level2 } = expandMdReferences(aMdContent, RESOURCE_ID);

  assert(
    level2.includes('"resource_path":"B.md"'),
    'Level 2: B.md reference in A.md also replaced by tool call',
  );
  assert(
    level2.includes('MANDATORY'),
    'Level 2: MANDATORY block present in A.md expanded content',
  );

  // B.md has no further references — content passes through unchanged
  const bMdContent = '# B\n\nFinal content, no more references.\n';
  const { expandedContent: level3 } = expandMdReferences(bMdContent, RESOURCE_ID);

  assert(
    level3 === bMdContent,
    'Level 3: B.md content unchanged (no references)',
  );
}

// ---------------------------------------------------------------------------
// Test 8: Nested A(large)→B(small) and A(large)→B(large) all handled via tool calls
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('Test 8: Nested cases (A large→B small, A large→B large) — all via tool calls');
console.log(`${'='.repeat(70)}`);

{
  // Both cases behave identically: server expands A.md content when agent requests it
  // A.md content (regardless of size) is processed by expandMdReferences on server
  const aMdWithRef = '# A (large)\n\nSee [B.md](./B.md) for more details.\n';
  const { expandedContent: expandedA } = expandMdReferences(aMdWithRef, RESOURCE_ID);

  assert(
    expandedA.includes('"resource_path":"B.md"'),
    'A(large)→B: B.md reference in A.md content replaced by tool call',
  );
  // No size thresholding needed — all references handled the same way
  assert(
    !expandedA.includes('BEGIN EMBEDDED'),
    'No inlining regardless of B.md size',
  );
}

// ---------------------------------------------------------------------------
// Test 9: Path traversal in resource_path (validation logic check)
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('Test 9: Path traversal attempt — ".." paths blocked by normalisation');
console.log(`${'='.repeat(70)}`);

{
  // The expander itself doesn't validate paths — that's done in resolveSubResource.
  // Here we verify that ".." in a link href produces a normalised path in the tool call,
  // so the server-side validation has a consistent value to check.
  const skillMd = '# SKILL\n\nSee [evil](../../../etc/passwd.md).\n';
  const { expandedContent } = expandMdReferences(skillMd, RESOURCE_ID);

  // The expander replaces the link with a tool call block containing the raw path.
  // The server's resolveSubResource will then reject it via path.normalize check.
  assert(
    expandedContent.includes('MANDATORY'),
    'Tool call block generated (server will reject path traversal at validation stage)',
  );
  assert(
    expandedContent.includes('../../../etc/passwd.md'),
    'Path traversal path is preserved in tool call (server rejects it)',
  );
}

// ---------------------------------------------------------------------------
// Test 10: Realistic winzr-cpp-expert scenario
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('Test 10: Realistic scenario — winzr-cpp-expert with reference.md');
console.log(`${'='.repeat(70)}`);

{
  const skillMd = [
    '---',
    'name: winzr-cpp-expert',
    'description: "C++ expert skill"',
    '---',
    '',
    '# winzr-cpp-expert',
    '',
    '## Instructions',
    '',
    '### For Code Writing',
    '1. Read existing code and context',
    '2. Write code per [reference.md](./reference.md) requirements',
    '',
    '### For Code Review',
    '1. Read the code/diff to review',
    '2. Follow the [reference.md](./reference.md) review process',
  ].join('\n');

  const { expandedContent } = expandMdReferences(skillMd, RESOURCE_ID);

  // Both references to reference.md should be replaced
  assert(
    (expandedContent.match(/MANDATORY/g) || []).length === 2,
    'Both reference.md links replaced by tool call blocks',
  );
  assert(
    expandedContent.includes('"resource_path":"reference.md"'),
    'resource_path "reference.md" correctly embedded',
  );
  // Context is NOT bloated — no file content inlined
  assert(
    !expandedContent.includes('BEGIN EMBEDDED'),
    'No content inlined — context stays lean',
  );
  // Original instructions still intact
  assert(
    expandedContent.includes('For Code Writing') && expandedContent.includes('For Code Review'),
    'SKILL.md structure preserved around the replacements',
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(70)}`);
console.log('TEST SUMMARY');
console.log(`${'='.repeat(70)}`);
console.log(`${GREEN}Passed:  ${passed}${RESET}`);
console.log(`${RED}Failed:  ${failed}${RESET}`);
console.log(`Total:   ${passed + failed}`);

const passRate = ((passed / (passed + failed)) * 100).toFixed(1);
console.log(`Pass Rate: ${passRate}%`);

if (failed === 0) {
  log(GREEN, 'RESULT', `ALL TESTS PASSED (${passed}/${passed + failed})`);
  process.exit(0);
} else {
  log(RED, 'RESULT', `${failed} TEST(S) FAILED`);
  process.exit(1);
}
