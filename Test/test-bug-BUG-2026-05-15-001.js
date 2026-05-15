/**
 * Regression test for BUG-2026-05-15-001.
 *
 * manage_subscription subscribe/batch_subscribe must scoped auto-sync the
 * requested resource ids even when the subscription API returns zero newly
 * created rows. This covers default/baseline resources restored after a local
 * unsubscribe override.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`${GREEN}[PASS]${RESET} ${message}`);
    passed++;
  } else {
    console.log(`${RED}[FAIL]${RESET} ${message}`);
    failed++;
  }
}

const sourcePath = path.join(__dirname, '..', 'SourceCode', 'src', 'tools', 'manage-subscription.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

console.log(`${BLUE}BUG-2026-05-15-001: default subscribe auto-sync regression${RESET}`);

assert(
  source.includes('const resourceIdsForAutoSync = Array.from(new Set(typedParams.resource_ids));'),
  'subscribe path derives auto-sync ids from requested resource_ids',
);

assert(
  source.includes('shouldAutoSync && resourceIdsForAutoSync.length > 0'),
  'subscribe path no longer gates auto-sync on newly-created subscription count',
);

assert(
  source.includes('resource_ids: resourceIdsForAutoSync'),
  'subscribe path forwards requested ids to scoped sync_resources',
);

assert(
  source.includes('const batchResourceIdsForAutoSync = Array.from(new Set(typedParams.resource_ids));'),
  'batch_subscribe path derives auto-sync ids from requested resource_ids',
);

assert(
  source.includes('shouldBatchAutoSync && batchResourceIdsForAutoSync.length > 0'),
  'batch_subscribe path no longer gates auto-sync on newly-created subscription count',
);

assert(
  source.includes('resource_ids: batchResourceIdsForAutoSync'),
  'batch_subscribe path forwards requested ids to scoped sync_resources',
);

assert(
  source.includes('scoped auto-sync was still executed'),
  'subscribe response explains baseline/default zero-row auto-sync behavior',
);

const total = passed + failed;
console.log(`${BLUE}Results: ${passed}/${total} passed${RESET}`);
process.exit(failed > 0 ? 1 : 0);
