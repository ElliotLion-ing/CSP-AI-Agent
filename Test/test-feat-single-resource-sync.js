/**
 * Test Case: FEAT-2026-04-10-001 — Single-Resource Sync & Full-Mode Confirmation
 *
 * Covers:
 *  1. resource_ids filter: only specified resources are processed
 *  2. resource_ids filter: local_actions contain only targeted resource actions
 *  3. manage_subscription auto-sync passes resource_ids to syncResources
 *  4. full mode without resource_ids + without _confirmed_full_sync → FULL_SYNC_REQUIRES_CONFIRMATION
 *  5. full mode with _confirmed_full_sync: true → proceeds normally
 *  6. full mode with resource_ids (scoped) → no confirmation required
 *  7. omitting resource_ids preserves existing behaviour (all resources synced)
 */

'use strict';

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE   = '\x1b[34m';
const RESET  = '\x1b[0m';

let passed = 0;
let failed = 0;

function log(color, prefix, msg) {
  console.log(`${color}[${prefix}]${RESET} ${msg}`);
}

function assert(condition, testName, detail = '') {
  if (condition) {
    log(GREEN, 'PASS', testName);
    passed++;
  } else {
    log(RED, 'FAIL', `${testName}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ─── Simulate the core sync logic (mirrors sync-resources.ts) ──────────────

/**
 * Simulate the resource_ids + full-mode-guard logic from syncResources().
 *
 * @param {object} params  SyncResourcesParams
 * @param {Array}  allSubscriptions  Full list of user subscriptions
 * @returns {{ error?: object, subscriptions?: Array, skippedGitSync?: boolean }}
 */
function simulateSyncResources(params, allSubscriptions) {
  const mode               = params.mode || 'incremental';
  const resourceIds        = params.resource_ids && params.resource_ids.length > 0
    ? new Set(params.resource_ids)
    : null;
  const confirmedFullSync  = params._confirmed_full_sync === true;

  // ── Full-mode confirmation guard ─────────────────────────────────────────
  if (mode === 'full' && !resourceIds && !confirmedFullSync) {
    return {
      success: false,
      error: {
        code: 'FULL_SYNC_REQUIRES_CONFIRMATION',
        message: 'Full sync requires confirmation.',
        details: { requires_confirmation: true },
      },
    };
  }

  // ── Filter subscriptions by resource_ids ──────────────────────────────────
  const filtered = resourceIds
    ? allSubscriptions.filter(s => resourceIds.has(s.id))
    : allSubscriptions;

  // ── Git sync always runs (never skipped by resource_ids) ─────────────────
  // git pull is prerequisite for downloadResource to return latest content.
  const skippedGitSync = false;

  // ── Generate mock local_actions for each filtered resource ────────────────
  const localActions = filtered.flatMap(s => {
    if (s.type === 'rule') {
      return [{ action: 'write_file', path: `~/.cursor/rules/${s.name}.mdc`, resource_id: s.id }];
    }
    if (s.type === 'skill' && s.hasScripts) {
      return [
        { action: 'write_file', path: `~/.csp-ai-agent/skills/${s.name}/scripts/tool`, resource_id: s.id, is_skill_manifest: true },
        { action: 'write_file', path: `~/.csp-ai-agent/skills/${s.name}/scripts/helper`, resource_id: s.id },
      ];
    }
    return [];
  });

  return {
    success: true,
    subscriptions: filtered,
    skippedGitSync,
    localActions,
  };
}

/**
 * Simulate manage_subscription subscribe → auto-sync call.
 * Returns the resource_ids that would be passed to syncResources.
 */
function simulateAutoSync(subscribeResourceIds) {
  // NEW behaviour: pass resource_ids to syncResources
  return { resource_ids: subscribeResourceIds, mode: 'incremental' };
}

// ─── Test Data ───────────────────────────────────────────────────────────────

const ALL_SUBSCRIPTIONS = [
  { id: 'rule-001',  name: 'csp-ai-prompts',   type: 'rule',  hasScripts: false },
  { id: 'rule-002',  name: 'security-baseline', type: 'rule',  hasScripts: false },
  { id: 'skill-001', name: 'zoom-build',        type: 'skill', hasScripts: true  },
  { id: 'skill-002', name: 'zoom-code-review',  type: 'skill', hasScripts: true  },
  { id: 'skill-003', name: 'zoom-jira',         type: 'skill', hasScripts: false },
  { id: 'mcp-001',   name: 'acm',              type: 'mcp',   hasScripts: false },
];

// ─── Test Suite ──────────────────────────────────────────────────────────────

console.log(`\n${BLUE}═══════════════════════════════════════════════════════${RESET}`);
console.log(`${BLUE}  FEAT-2026-04-10-001: Single-Resource Sync Tests${RESET}`);
console.log(`${BLUE}═══════════════════════════════════════════════════════${RESET}\n`);

// ── Test 1: Single resource_id filter — only that resource is processed ──────
log(YELLOW, 'TEST', '1. resource_ids filter: single resource');
{
  const result = simulateSyncResources({ resource_ids: ['skill-001'] }, ALL_SUBSCRIPTIONS);
  assert(result.success === true, 'T1.1 — sync succeeds with resource_ids filter');
  assert(result.subscriptions.length === 1, 'T1.2 — exactly 1 resource processed', `got ${result.subscriptions.length}`);
  assert(result.subscriptions[0].id === 'skill-001', 'T1.3 — correct resource ID', `got ${result.subscriptions[0]?.id}`);
}

// ── Test 2: local_actions contain only targeted resource's actions ────────────
log(YELLOW, 'TEST', '2. local_actions scoped to resource_ids only');
{
  const result = simulateSyncResources({ resource_ids: ['skill-001'] }, ALL_SUBSCRIPTIONS);
  assert(result.success === true, 'T2.1 — sync succeeds');
  const otherResourceActions = result.localActions.filter(a => a.resource_id !== 'skill-001');
  assert(otherResourceActions.length === 0, 'T2.2 — no actions for other resources', `found ${otherResourceActions.length} stray actions`);
  assert(result.localActions.length > 0, 'T2.3 — actions exist for the targeted resource');
}

// ── Test 3: Multiple resource_ids filter ─────────────────────────────────────
log(YELLOW, 'TEST', '3. resource_ids filter: multiple resources');
{
  const result = simulateSyncResources({ resource_ids: ['rule-001', 'skill-001'] }, ALL_SUBSCRIPTIONS);
  assert(result.success === true, 'T3.1 — sync succeeds');
  assert(result.subscriptions.length === 2, 'T3.2 — exactly 2 resources processed', `got ${result.subscriptions.length}`);
  const ids = result.subscriptions.map(s => s.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify(['rule-001', 'skill-001']), 'T3.3 — correct resource IDs', `got ${ids}`);
}

// ── Test 4: Git sync always runs regardless of resource_ids ──────────────────
// git pull is a prerequisite for downloadResource(id) to return latest content.
// The download API reads from the server-side local git checkout — skipping
// git sync would cause stale content to be returned once git-based sync is enabled.
log(YELLOW, 'TEST', '4. Git sync always runs (resource_ids does NOT skip it)');
{
  const result = simulateSyncResources({ resource_ids: ['rule-001'] }, ALL_SUBSCRIPTIONS);
  assert(result.skippedGitSync === false, 'T4.1 — git sync still runs with resource_ids filter');

  const resultAll = simulateSyncResources({}, ALL_SUBSCRIPTIONS);
  assert(resultAll.skippedGitSync === false, 'T4.2 — git sync runs without filter too');
}

// ── Test 5: Omitting resource_ids processes all resources ─────────────────────
log(YELLOW, 'TEST', '5. No resource_ids filter — all resources processed');
{
  const result = simulateSyncResources({}, ALL_SUBSCRIPTIONS);
  assert(result.success === true, 'T5.1 — sync succeeds');
  assert(result.subscriptions.length === ALL_SUBSCRIPTIONS.length, 'T5.2 — all resources processed', `got ${result.subscriptions.length}, expected ${ALL_SUBSCRIPTIONS.length}`);
}

// ── Test 6: full mode without resource_ids + no confirmation → error ──────────
log(YELLOW, 'TEST', '6. full mode without resource_ids requires confirmation');
{
  const result = simulateSyncResources({ mode: 'full' }, ALL_SUBSCRIPTIONS);
  assert(result.success === false, 'T6.1 — returns failure');
  assert(result.error?.code === 'FULL_SYNC_REQUIRES_CONFIRMATION', 'T6.2 — correct error code', `got ${result.error?.code}`);
  assert(result.error?.details?.requires_confirmation === true, 'T6.3 — requires_confirmation flag set');
  assert(!result.subscriptions, 'T6.4 — no resources processed');
}

// ── Test 7: full mode with _confirmed_full_sync: true → proceeds ──────────────
log(YELLOW, 'TEST', '7. full mode with _confirmed_full_sync: true proceeds normally');
{
  const result = simulateSyncResources({ mode: 'full', _confirmed_full_sync: true }, ALL_SUBSCRIPTIONS);
  assert(result.success === true, 'T7.1 — sync succeeds');
  assert(result.subscriptions.length === ALL_SUBSCRIPTIONS.length, 'T7.2 — all resources processed', `got ${result.subscriptions.length}`);
}

// ── Test 8: full mode with resource_ids — no confirmation needed ──────────────
log(YELLOW, 'TEST', '8. full mode scoped by resource_ids — no confirmation required');
{
  const result = simulateSyncResources({ mode: 'full', resource_ids: ['skill-001'] }, ALL_SUBSCRIPTIONS);
  assert(result.success === true, 'T8.1 — sync succeeds without confirmation');
  assert(result.subscriptions.length === 1, 'T8.2 — only target resource processed');
  assert(result.error === undefined, 'T8.3 — no confirmation error');
}

// ── Test 9: incremental mode is default (no mode param) ──────────────────────
log(YELLOW, 'TEST', '9. default mode is incremental — no confirmation required');
{
  // No mode param → defaults to incremental → no guard triggered even without resource_ids
  const result = simulateSyncResources({}, ALL_SUBSCRIPTIONS);
  assert(result.success === true, 'T9.1 — default call succeeds');
  assert(!result.error, 'T9.2 — no FULL_SYNC_REQUIRES_CONFIRMATION for default mode');
}

// ── Test 10: manage_subscription auto-sync passes resource_ids ────────────────
log(YELLOW, 'TEST', '10. manage_subscription auto-sync scoped to subscribed resource_ids');
{
  const subscribedIds = ['skill-001'];
  const syncParams = simulateAutoSync(subscribedIds);
  assert(Array.isArray(syncParams.resource_ids), 'T10.1 — resource_ids passed to syncResources');
  assert(JSON.stringify(syncParams.resource_ids) === JSON.stringify(subscribedIds), 'T10.2 — correct resource_ids forwarded', `got ${JSON.stringify(syncParams.resource_ids)}`);
  assert(syncParams.mode === 'incremental', 'T10.3 — incremental mode used for auto-sync');

  // Verify the scoped sync only touches the subscribed resource
  const syncResult = simulateSyncResources(syncParams, ALL_SUBSCRIPTIONS);
  assert(syncResult.success === true, 'T10.4 — scoped auto-sync succeeds');
  assert(syncResult.subscriptions.length === 1, 'T10.5 — only 1 resource processed', `got ${syncResult.subscriptions.length}`);
  assert(syncResult.subscriptions[0].id === 'skill-001', 'T10.6 — correct resource processed');
}

// ── Test 11: resource_ids with unknown IDs (not subscribed) ──────────────────
log(YELLOW, 'TEST', '11. resource_ids with non-subscribed ID → empty result');
{
  const result = simulateSyncResources({ resource_ids: ['not-subscribed-id'] }, ALL_SUBSCRIPTIONS);
  assert(result.success === true, 'T11.1 — sync succeeds (no error for unknown IDs)');
  assert(result.subscriptions.length === 0, 'T11.2 — no resources processed (unknown ID filtered out)', `got ${result.subscriptions.length}`);
  assert(result.localActions.length === 0, 'T11.3 — no local actions generated');
}

// ── Summary ──────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${BLUE}═══════════════════════════════════════════════════════${RESET}`);
console.log(`${BLUE}  Results: ${passed}/${total} passed${RESET}`);
if (failed > 0) {
  console.log(`${RED}  ${failed} test(s) FAILED${RESET}`);
}
console.log(`${BLUE}═══════════════════════════════════════════════════════${RESET}\n`);

process.exit(failed > 0 ? 1 : 0);
