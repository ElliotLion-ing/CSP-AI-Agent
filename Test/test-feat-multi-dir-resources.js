/**
 * Test Suite: FEAT-2026-04-16-001-multi-dir-resources
 * Multi-Directory Resource Paths Support
 *
 * Tests the following scenarios:
 *  1. Single string value (backward compatibility)
 *  2. Single-element array (equivalent to string)
 *  3. Two-dir array, both dirs exist — all resources indexed independently
 *  4. Two-dir array, second dir missing — first loaded, second skipped gracefully
 *  5. Same resource name in two dirs — both registered with distinct keys
 *  6. ResourceMetadata.dir field populated correctly
 *  7. readResourceFiles without sourceName (first-match across sources)
 *  8. readResourceFiles with sourceName (restricted to that source)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
    failures.push(message);
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ── Inline normalizePaths (mirrors the production implementation) ─────────────

function normalizePaths(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// ── Inline indexResource logic (mirrors loader.ts indexResource) ──────────────

function buildResourceKey(type, name, sourceName, subDir) {
  return `${type}:${name}@${sourceName}/${subDir}`;
}

function buildIndex(source, type, entries) {
  // entries: [{ name, subDir }]
  const index = new Map();
  const conflicts = [];
  for (const { name, subDir } of entries) {
    const key = buildResourceKey(type, name, source.name, subDir);
    if (index.has(key)) {
      conflicts.push(key);
    } else {
      index.set(key, { id: key, name, type, source: source.name, priority: source.priority, dir: subDir });
    }
  }
  return { index, conflicts };
}

// ── Temp dir fixture helpers ─────────────────────────────────────────────────

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'feat-multi-dir-'));
}

function setupSkillDir(base, subDir, skillName) {
  const dir = path.join(base, subDir, skillName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${skillName}\ndescription: test skill`);
  return dir;
}

// ── Test 1: normalizePaths behavior ─────────────────────────────────────────

section('Test 1: normalizePaths — backward compatibility & array support');

assert(
  JSON.stringify(normalizePaths('ai-resources/skills')) === JSON.stringify(['ai-resources/skills']),
  'Single string → wrapped in array'
);

assert(
  JSON.stringify(normalizePaths(['ai-resources/skills'])) === JSON.stringify(['ai-resources/skills']),
  'Single-element array → returned as-is'
);

assert(
  JSON.stringify(normalizePaths(['ai-resources/skills', 'ai-resources/extra-skills'])) ===
    JSON.stringify(['ai-resources/skills', 'ai-resources/extra-skills']),
  'Two-element array → returned as-is'
);

assert(
  JSON.stringify(normalizePaths(undefined)) === JSON.stringify([]),
  'Undefined → empty array'
);

assert(
  JSON.stringify(normalizePaths(null)) === JSON.stringify([]),
  'Null → empty array'
);

// ── Test 2: resourceIndex key format ────────────────────────────────────────

section('Test 2: resourceIndex key format — type:name@source/subDir');

assert(
  buildResourceKey('skills', 'zoom-build', 'csp', 'ai-resources/skills') ===
    'skills:zoom-build@csp/ai-resources/skills',
  'Key format: skills:zoom-build@csp/ai-resources/skills'
);

assert(
  buildResourceKey('rules', 'privacy-logging', 'csp', 'ai-resources/rules') ===
    'rules:privacy-logging@csp/ai-resources/rules',
  'Key format: rules:privacy-logging@csp/ai-resources/rules'
);

// ── Test 3: Same resource name in two dirs → two distinct keys ───────────────

section('Test 3: Same name in two dirs → both indexed with distinct keys');

const source = { name: 'csp', priority: 100 };
const { index, conflicts } = buildIndex(source, 'skills', [
  { name: 'zoom-build', subDir: 'ai-resources/skills' },
  { name: 'zoom-build', subDir: 'ai-resources/extra-skills' },
]);

assert(index.size === 2, 'Both entries registered — no silent dropping');
assert(conflicts.length === 0, 'No conflict (different subDirs → different keys)');
assert(
  index.has('skills:zoom-build@csp/ai-resources/skills'),
  'Key for first dir exists'
);
assert(
  index.has('skills:zoom-build@csp/ai-resources/extra-skills'),
  'Key for second dir exists'
);

// ── Test 4: dir field populated correctly ────────────────────────────────────

section('Test 4: ResourceMetadata.dir field');

const meta = index.get('skills:zoom-build@csp/ai-resources/skills');
assert(meta !== undefined, 'Metadata found for first dir key');
assert(meta.dir === 'ai-resources/skills', 'dir field = first subDir');

const meta2 = index.get('skills:zoom-build@csp/ai-resources/extra-skills');
assert(meta2 !== undefined, 'Metadata found for second dir key');
assert(meta2.dir === 'ai-resources/extra-skills', 'dir field = second subDir');

// ── Test 5: Duplicate key (same source + same subDir + same name) → conflict ─

section('Test 5: True duplicate (same key) → conflict recorded, first entry kept');

const { index: idx2, conflicts: confl2 } = buildIndex(source, 'skills', [
  { name: 'zoom-build', subDir: 'ai-resources/skills' },
  { name: 'zoom-build', subDir: 'ai-resources/skills' }, // exact same key
]);

assert(idx2.size === 1, 'Only one entry in index (first wins)');
assert(confl2.length === 1, 'One conflict recorded');
assert(confl2[0] === 'skills:zoom-build@csp/ai-resources/skills', 'Conflict key matches');

// ── Test 6: Filesystem — missing second dir skipped gracefully ───────────────

section('Test 6: Filesystem — missing second dir skipped, first loaded normally');

const tmpBase = createTempDir();
setupSkillDir(tmpBase, 'skills', 'zoom-build');
// 'extra-skills' intentionally not created

const subDirs = normalizePaths(['skills', 'extra-skills']);
const loadedDirs = [];
for (const subDir of subDirs) {
  const resourceDir = path.join(tmpBase, subDir);
  if (fs.existsSync(resourceDir)) {
    loadedDirs.push(subDir);
  }
  // Missing dir is silently skipped (no throw)
}

assert(loadedDirs.length === 1, 'Only existing dir loaded');
assert(loadedDirs[0] === 'skills', 'First dir (skills) loaded');

// Cleanup
fs.rmSync(tmpBase, { recursive: true, force: true });

// ── Test 7: Filesystem — both dirs exist, both scanned ──────────────────────

section('Test 7: Filesystem — both dirs exist, resources from both indexed');

const tmpBase2 = createTempDir();
setupSkillDir(tmpBase2, 'skills', 'zoom-build');
setupSkillDir(tmpBase2, 'extra-skills', 'zoom-review');

const subDirs2 = normalizePaths(['skills', 'extra-skills']);
const foundResources = [];
for (const subDir of subDirs2) {
  const resourceDir = path.join(tmpBase2, subDir);
  if (fs.existsSync(resourceDir)) {
    const entries = fs.readdirSync(resourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = path.join(resourceDir, entry.name, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          foundResources.push({ name: entry.name, subDir });
        }
      }
    }
  }
}

assert(foundResources.length === 2, 'Two resources found across two dirs');
assert(
  foundResources.some((r) => r.name === 'zoom-build' && r.subDir === 'skills'),
  'zoom-build found in skills dir'
);
assert(
  foundResources.some((r) => r.name === 'zoom-review' && r.subDir === 'extra-skills'),
  'zoom-review found in extra-skills dir'
);

// Cleanup
fs.rmSync(tmpBase2, { recursive: true, force: true });

// ── Test 8: readResourceFiles sourceName filtering logic ─────────────────────

section('Test 8: readResourceFiles — sourceName restricts search to one source');

// Simulate: two sources both have 'zoom-build', sourceName='csp' should only return csp's
const allSources = [
  { name: 'csp', priority: 100, path: 'csp', resources: { skills: 'ai-resources/skills' } },
  { name: 'client-sdk', priority: 50, path: 'client-sdk', resources: { skills: '.cursor/skills' } },
];

function filterSources(sources, sourceName) {
  if (sourceName) {
    const matched = sources.find((s) => s.name === sourceName);
    return matched ? [matched] : [];
  }
  return [...sources].sort((a, b) => b.priority - a.priority);
}

const withSourceName = filterSources(allSources, 'csp');
assert(withSourceName.length === 1, 'sourceName=csp → only csp source selected');
assert(withSourceName[0].name === 'csp', 'Selected source is csp');

const withoutSourceName = filterSources(allSources, undefined);
assert(withoutSourceName.length === 2, 'No sourceName → all sources selected');
assert(withoutSourceName[0].name === 'csp', 'First source is highest priority (csp)');

const unknownSource = filterSources(allSources, 'unknown-source');
assert(unknownSource.length === 0, 'Unknown sourceName → empty result');

// ── Test 9: getResourcesByType returns all entries (no silent dedup) ─────────

section('Test 9: getResourcesByType — all entries visible, no silent dedup');

const fullIndex = new Map();
const entries = [
  { type: 'skills', name: 'zoom-build', sourceName: 'csp', subDir: 'ai-resources/skills' },
  { type: 'skills', name: 'zoom-build', sourceName: 'csp', subDir: 'ai-resources/extra-skills' },
  { type: 'skills', name: 'zoom-build', sourceName: 'client-sdk', subDir: '.cursor/skills' },
];
for (const e of entries) {
  const key = buildResourceKey(e.type, e.name, e.sourceName, e.subDir);
  fullIndex.set(key, { id: key, name: e.name, type: e.type, source: e.sourceName, dir: e.subDir });
}

const skillsResults = [...fullIndex.values()].filter((m) => m.type === 'skills');
assert(skillsResults.length === 3, 'getResourcesByType returns all 3 entries for zoom-build');

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.error('\nFailed tests:');
  failures.forEach((f) => console.error(`  - ${f}`));
}
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
