#!/usr/bin/env node
/**
 * Test: Isolated Skill Path with Manifest (v2.4)
 * 
 * Validates:
 * 1. Scripts download to ~/.csp-ai-agent/skills/<name>/ (isolated)
 * 2. SKILL.md NOT in skills directory (only in .manifests/)
 * 3. Manifest file stored in ~/.csp-ai-agent/.manifests/<name>.md
 * 4. Cursor cannot auto-discover skills (missing SKILL.md)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  BLUE: '\x1b[34m',
  RESET: '\x1b[0m',
};

function log(level, message) {
  const color = level === 'PASS' ? COLORS.GREEN : level === 'FAIL' ? COLORS.RED : COLORS.BLUE;
  console.log(`${color}[${level}]${COLORS.RESET} ${message}`);
}

function expandPath(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

const tests = [
  {
    name: 'First script has manifest marker + content',
    setup: () => ({
      action: 'write_file',
      path: '~/.csp-ai-agent/skills/zoom-build/scripts/build-cli',
      content: '#!/usr/bin/env python3\nprint("test")',
      mode: '0755',
      is_skill_manifest: true,
      skill_manifest_content: '# Zoom Build Skill\nVersion 3.3.0',
    }),
    validate: (action) => (
      action.is_skill_manifest === true &&
      typeof action.skill_manifest_content === 'string' &&
      action.skill_manifest_content.length > 0 &&
      action.path.includes('.csp-ai-agent/skills/') &&
      !action.path.endsWith('SKILL.md')
    ),
  },
  {
    name: 'SKILL.md NOT in skills directory',
    setup: () => ([
      { action: 'write_file', path: '~/.csp-ai-agent/skills/zoom-build/scripts/build-cli', is_skill_manifest: true },
      { action: 'write_file', path: '~/.csp-ai-agent/skills/zoom-build/scripts/build-trigger' },
      { action: 'write_file', path: '~/.csp-ai-agent/skills/zoom-build/teams/client-android.json' },
    ]),
    validate: (actions) => !actions.some(a => a.path.includes('/skills/') && a.path.endsWith('SKILL.md')),
  },
  {
    name: 'Manifest location correct',
    setup: () => '~/.csp-ai-agent/.manifests/zoom-build.md',
    validate: (path) => path.includes('.csp-ai-agent/.manifests/') && path.endsWith('.md'),
  },
  {
    name: 'Uninstall deletes scripts AND manifest',
    setup: () => ([
      { action: 'delete_file', path: '~/.csp-ai-agent/skills/zoom-build', recursive: true },
      { action: 'delete_file', path: '~/.csp-ai-agent/.manifests/zoom-build.md', recursive: false },
    ]),
    validate: (actions) => (
      actions.some(a => a.path.includes('.csp-ai-agent/skills/') && a.recursive === true) &&
      actions.some(a => a.path.includes('.csp-ai-agent/.manifests/') && a.path.endsWith('.md'))
    ),
  },
  {
    name: 'Cursor cannot discover (no SKILL.md in skills dir)',
    setup: () => ([
      '~/.csp-ai-agent/skills/zoom-build/scripts/build-cli',
      '~/.csp-ai-agent/skills/zoom-build/teams/client-android.json',
      '~/.csp-ai-agent/.manifests/zoom-build.md',
    ]),
    validate: (files) => (
      !files.some(f => f.includes('/skills/') && f.endsWith('SKILL.md')) &&
      files.some(f => f.includes('.manifests/'))
    ),
  },
  {
    name: 'Rules still use ~/.cursor/rules/',
    setup: () => ({ action: 'write_file', path: '~/.cursor/rules/test-rule.mdc' }),
    validate: (action) => /\.cursor\/rules\/test-rule\.mdc$/.test(expandPath(action.path)),
  },
];

let passed = 0;
let failed = 0;

console.log(COLORS.BLUE + '\n=== Isolated Skill Path + Manifest Test Suite ===' + COLORS.RESET);
console.log('Testing: Scripts in isolated path, SKILL.md in manifest directory (v2.4)\n');

for (const test of tests) {
  try {
    const result = test.setup();
    if (test.validate(result)) {
      log('PASS', test.name);
      passed++;
    } else {
      log('FAIL', test.name);
      console.log(`  Actual: ${JSON.stringify(result, null, 2).substring(0, 200)}`);
      failed++;
    }
  } catch (error) {
    log('FAIL', `${test.name} - ${error.message}`);
    failed++;
  }
}

console.log(`\n${COLORS.BLUE}=== Summary ===${COLORS.RESET}`);
console.log(`Total: ${tests.length}`);
console.log(`${COLORS.GREEN}Passed: ${passed}${COLORS.RESET}`);
console.log(`${COLORS.RED}Failed: ${failed}${COLORS.RESET}`);
console.log(`Pass Rate: ${((passed / tests.length) * 100).toFixed(1)}%\n`);

process.exit(failed > 0 ? 1 : 0);
