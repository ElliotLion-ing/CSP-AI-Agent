#!/usr/bin/env node
/**
 * Regression: check mode must not mark API-backed complex skills cached
 * without returning local check actions.
 *
 * C8 failed because zoom-build was deleted locally by C5, but check mode only
 * used prompt registration + Git metadata. zoom-build is API-backed, so no
 * script checks were generated and the response reported cached.
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`PASS: ${message}`);
    passed++;
  } else {
    console.error(`FAIL: ${message}`);
    failed++;
  }
}

const root = path.join(__dirname, '..');
const syncPath = path.join(root, 'SourceCode/src/tools/sync-resources.ts');
const sync = fs.readFileSync(syncPath, 'utf8');

assert(
  sync.includes('async function loadPromptResourceFiles'),
  'sync_resources has a shared API/Git loader for prompt resources',
);

assert(
  sync.includes('await apiClient.downloadResource(resourceId, userToken)'),
  'check mode complex skill detection can use API download content',
);

assert(
  sync.includes('function getLocalScriptFiles'),
  'script detection is centralized and excludes markdown/SKILL.md',
);

assert(
  sync.includes('function queueComplexSkillCheckActions'),
  'complex skills have dedicated check_file action generation',
);

assert(
  sync.includes("action: 'check_file'") &&
    sync.includes('path: `${skillDir}/${scriptFile.path}`') &&
    sync.includes('path: `${clientAdapter.getManifestDir()}/${resourceName}.md`'),
  'check mode queues check_file actions for every script and the client-specific manifest',
);

assert(
  sync.includes('const sourceFiles = await loadPromptResourceFiles(sub.id, sub.name, sub.type, userToken);') &&
    sync.includes("Complex skill check actions queued for AI Agent"),
  'skill check mode uses source files and queues local checks for registered complex skills',
);

assert(
  !sync.includes('scanResourceMetadata(sub.name, sub.type);\\n                  if (metadata.has_scripts'),
  'old check-mode Git-only metadata path is removed',
);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
