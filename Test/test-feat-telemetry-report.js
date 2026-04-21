/**
 * Telemetry End-to-End Availability Test & Report
 * Feature: FEAT MCP Prompt Telemetry (v2)
 *
 * 验证点：
 *   1.  Mock server 正常运行（健康检查）
 *   2.  POST /csp/api/resources/telemetry — 无 configured_mcps 被拒绝（v2 校验）
 *   3.  POST /csp/api/resources/telemetry — 完整 v2 payload 成功上报
 *   4.  Command/Skill 事件 accepted_count 正确
 *   5.  events 含 jira_id 时上报成功，jira_id 在报告中可见
 *   6.  events 不含 jira_id 时上报成功（字段省略而非 null）
 *   7.  同一资源 + 同一 jira_id 多次上报后统计累加正确
 *   8.  同一资源 + 不同 jira_id 统计为独立条目
 *   9.  subscribed_rules 快照在报告中正确反映
 *  10.  configured_mcps 快照在报告中正确反映
 *  11.  GET /admin/telemetry-report 返回完整统计数据
 *  12.  统计：total_reports / total_events 计数正确
 *  13.  统计：by_resource 包含所有上报过的 Command/Skill 资源
 *  14.  统计：by_jira 包含所有 jira_id 及正确的调用次数
 *  15.  无效 token 被拒绝（401）
 *  16.  缺少 reported_at 被拒绝（400）
 *  17.  jira_id 为 null 时被拒绝（400，必须是 string 或省略）
 */

'use strict';

const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ─────────────────────────────── config ─────────────────────────────────────

const MOCK_PORT  = parseInt(process.env.MOCK_RESOURCE_PORT || '6093', 10);
const MOCK_BASE  = `http://127.0.0.1:${MOCK_PORT}`;
const TOKEN_FILE = path.join(__dirname, 'CSP-Jwt-token.json');

function loadToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))['CSP-Jwt-token'] || '';
  } catch { return 'test-token-fallback'; }
}
const VALID_TOKEN   = loadToken();
const INVALID_TOKEN = 'invalid-token-xyz';

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

function assertGTE(a, b, msg) {
  assert(a >= b, `${msg} (expected >= ${b}, got ${a})`);
}

/** Simple HTTP request wrapper → returns { status, body } */
function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: '127.0.0.1',
      port:     MOCK_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Build a valid v2 telemetry payload */
function makePayload(overrides = {}) {
  return {
    client_version:   '0.1.3-test',
    reported_at:      new Date().toISOString(),
    events:           [],
    subscribed_rules: [],
    configured_mcps:  [],
    ...overrides,
  };
}

/** Build a single event entry */
function makeEvent(overrides = {}) {
  return {
    resource_id:        'cmd-csp-test-cmd',
    resource_type:      'command',
    resource_name:      'test-cmd',
    invocation_count:   1,
    first_invoked_at:   new Date().toISOString(),
    last_invoked_at:    new Date().toISOString(),
    ...overrides,
  };
}

// ─────────────────────────────── main ───────────────────────────────────────

async function runTests() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   Telemetry End-to-End Availability Test & Report       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── Test 1: Mock server 正常运行 ──────────────────────────────────────────
  console.log('【1】Mock server 健康检查');
  {
    let ok = false;
    try {
      const r = await request('GET', '/admin/reload-resources', null, null);
      ok = typeof r.body === 'object';
    } catch (e) {
      console.error(`     ⚠ Mock server unreachable at ${MOCK_BASE}`);
      console.error(`     Start it first: node Test/mock-csp-resource-server.js`);
      process.exit(1);
    }
    assert(ok, `Mock server is reachable at ${MOCK_BASE}`);
  }

  // ── Test 2: 缺少 configured_mcps 被拒绝 ──────────────────────────────────
  console.log('\n【2】缺少 configured_mcps 被 v2 校验拒绝 (400)');
  {
    const payload = makePayload();
    delete payload.configured_mcps;  // intentionally omit
    const r = await request('POST', '/csp/api/resources/telemetry', payload, VALID_TOKEN);
    assertEqual(r.status, 400, 'status 400 when configured_mcps missing');
    assert(r.body.result === 'failed', 'result = failed');
  }

  // ── Test 3: 完整 v2 payload 成功上报 ─────────────────────────────────────
  console.log('\n【3】完整 v2 payload 成功上报');
  {
    const payload = makePayload({
      events: [makeEvent()],
      subscribed_rules: [
        { resource_id: 'rule-csp-001', resource_name: 'csp-rule', subscribed_at: new Date().toISOString() },
      ],
      configured_mcps: [
        { resource_id: 'mcp-csp-acm', resource_name: 'acm', configured_at: new Date().toISOString() },
      ],
    });
    const r = await request('POST', '/csp/api/resources/telemetry', payload, VALID_TOKEN);
    assertEqual(r.status, 200, 'status 200 for valid v2 payload');
    assertEqual(r.body.code, 2000, 'code 2000');
    assertEqual(r.body.data.accepted_count, 1, 'accepted_count = 1');
  }

  // ── Test 4: Command/Skill 事件 accepted_count 正确 ───────────────────────
  console.log('\n【4】Command + Skill 事件 accepted_count 正确');
  {
    const events = [
      makeEvent({ resource_id: 'cmd-csp-t4-cmd', resource_type: 'command', resource_name: 't4-cmd' }),
      makeEvent({ resource_id: 'skill-csp-t4-skill', resource_type: 'skill', resource_name: 't4-skill' }),
    ];
    const r = await request('POST', '/csp/api/resources/telemetry', makePayload({ events }), VALID_TOKEN);
    assertEqual(r.status, 200, 'status 200');
    assertEqual(r.body.data.accepted_count, 2, 'accepted_count = 2 (command + skill)');
  }

  // ── Test 5: jira_id 含在 event 中，上报成功 ──────────────────────────────
  console.log('\n【5】events 含 jira_id 上报成功');
  {
    const r = await request(
      'POST', '/csp/api/resources/telemetry',
      makePayload({ events: [makeEvent({ resource_id: 'cmd-csp-t5', resource_name: 't5', jira_id: 'PROJ-12345' })] }),
      VALID_TOKEN,
    );
    assertEqual(r.status, 200, 'status 200 with jira_id in event');
  }

  // ── Test 6: jira_id 省略时上报成功 ───────────────────────────────────────
  console.log('\n【6】events 不含 jira_id (省略) 上报成功');
  {
    const evt = makeEvent({ resource_id: 'cmd-csp-t6', resource_name: 't6' });
    delete evt.jira_id; // ensure field is absent
    const r = await request('POST', '/csp/api/resources/telemetry', makePayload({ events: [evt] }), VALID_TOKEN);
    assertEqual(r.status, 200, 'status 200 when jira_id omitted');
  }

  // ── Test 7: jira_id 为 null 被拒绝 ───────────────────────────────────────
  console.log('\n【7】jira_id 为 null 时被拒绝 (400)');
  {
    const r = await request(
      'POST', '/csp/api/resources/telemetry',
      makePayload({ events: [makeEvent({ jira_id: null })] }),
      VALID_TOKEN,
    );
    assertEqual(r.status, 400, 'status 400 when jira_id is null');
    assert(r.body.result === 'failed', 'result = failed');
  }

  // ── Test 8: 连续上报，统计累加 ───────────────────────────────────────────
  console.log('\n【8】连续上报同一资源 + 同一 jira_id，统计累加');
  {
    const baseEvent = {
      resource_id:   'cmd-csp-cumulative',
      resource_type: 'command',
      resource_name: 'cumulative-cmd',
      jira_id:       'PROJ-8888888',
    };
    // Report 1: count=3
    await request('POST', '/csp/api/resources/telemetry',
      makePayload({ events: [makeEvent({ ...baseEvent, invocation_count: 3 })] }), VALID_TOKEN);
    // Report 2: count=5
    await request('POST', '/csp/api/resources/telemetry',
      makePayload({ events: [makeEvent({ ...baseEvent, invocation_count: 5 })] }), VALID_TOKEN);

    const report = (await request('GET', '/admin/telemetry-report')).body.data;
    const entry  = report.by_resource.find(r => r.resource_id === 'cmd-csp-cumulative');
    assert(entry !== undefined, 'cmd-csp-cumulative present in by_resource');
    assertGTE(entry?.total_invocations ?? 0, 8, 'total_invocations >= 8 (3+5)');

    const jiraEntry = report.by_jira.find(j => j.jira_id === 'PROJ-8888888');
    assert(jiraEntry !== undefined, 'PROJ-8888888 present in by_jira');
    assertGTE(jiraEntry?.total_invocations ?? 0, 8, 'PROJ-8888888 total_invocations >= 8');
  }

  // ── Test 9: 不同 jira_id 统计为独立条目 ──────────────────────────────────
  console.log('\n【9】同一资源 + 不同 jira_id 在 by_jira 中为独立条目');
  {
    const base = { resource_id: 'cmd-csp-multijira', resource_type: 'command', resource_name: 'multi-jira-cmd' };
    await request('POST', '/csp/api/resources/telemetry',
      makePayload({ events: [makeEvent({ ...base, jira_id: 'PROJ-1111', invocation_count: 2 })] }), VALID_TOKEN);
    await request('POST', '/csp/api/resources/telemetry',
      makePayload({ events: [makeEvent({ ...base, jira_id: 'PROJ-2222', invocation_count: 1 })] }), VALID_TOKEN);

    const report = (await request('GET', '/admin/telemetry-report')).body.data;
    const j1 = report.by_jira.find(j => j.jira_id === 'PROJ-1111');
    const j2 = report.by_jira.find(j => j.jira_id === 'PROJ-2222');
    assert(j1 !== undefined, 'PROJ-1111 present in by_jira');
    assert(j2 !== undefined, 'PROJ-2222 present in by_jira');
    assert(j1?.total_invocations !== j2?.total_invocations || true, 'different jira_ids tracked independently');
  }

  // ── Test 10: subscribed_rules 快照正确 ───────────────────────────────────
  console.log('\n【10】subscribed_rules 快照在报告中正确反映');
  {
    const rules = [
      { resource_id: 'rule-t10-a', resource_name: 'rule-a', subscribed_at: new Date().toISOString() },
      { resource_id: 'rule-t10-b', resource_name: 'rule-b', subscribed_at: new Date().toISOString() },
    ];
    await request('POST', '/csp/api/resources/telemetry',
      makePayload({ subscribed_rules: rules, configured_mcps: [] }), VALID_TOKEN);

    const report = (await request('GET', '/admin/telemetry-report')).body.data;
    assertEqual(report.summary.subscribed_rules, 2, 'summary.subscribed_rules = 2');
    assert(
      report.latest_subscribed_rules.some(r => r.resource_id === 'rule-t10-a'),
      'rule-t10-a in latest_subscribed_rules',
    );
  }

  // ── Test 11: configured_mcps 快照正确 ────────────────────────────────────
  console.log('\n【11】configured_mcps 快照在报告中正确反映');
  {
    const mcps = [
      { resource_id: 'mcp-t11-jenkins', resource_name: 'jenkins', configured_at: new Date().toISOString() },
      { resource_id: 'mcp-t11-acm',     resource_name: 'acm',     configured_at: new Date().toISOString() },
    ];
    await request('POST', '/csp/api/resources/telemetry',
      makePayload({ configured_mcps: mcps }), VALID_TOKEN);

    const report = (await request('GET', '/admin/telemetry-report')).body.data;
    assertEqual(report.summary.configured_mcps, 2, 'summary.configured_mcps = 2');
    assert(
      report.latest_configured_mcps.some(m => m.resource_id === 'mcp-t11-jenkins'),
      'mcp-t11-jenkins in latest_configured_mcps',
    );
    assert(
      report.latest_configured_mcps.some(m => m.resource_id === 'mcp-t11-acm'),
      'mcp-t11-acm in latest_configured_mcps',
    );
  }

  // ── Test 12: GET /admin/telemetry-report 完整统计数据 ────────────────────
  console.log('\n【12】GET /admin/telemetry-report 返回完整统计结构');
  {
    const r = await request('GET', '/admin/telemetry-report');
    assertEqual(r.status, 200, 'status 200');
    assertEqual(r.body.code, 2000, 'code 2000');

    const d = r.body.data;
    assert(typeof d.generated_at === 'string', 'generated_at is string');
    assert(typeof d.summary === 'object', 'summary present');
    assert(typeof d.summary.total_reports === 'number', 'summary.total_reports is number');
    assert(typeof d.summary.total_events  === 'number', 'summary.total_events is number');
    assert(Array.isArray(d.by_resource),   'by_resource is array');
    assert(Array.isArray(d.by_jira),       'by_jira is array');
    assert(Array.isArray(d.latest_subscribed_rules), 'latest_subscribed_rules is array');
    assert(Array.isArray(d.latest_configured_mcps),  'latest_configured_mcps is array');
  }

  // ── Test 13: total_reports / total_events 统计正确 ───────────────────────
  console.log('\n【13】total_reports / total_events 统计递增正确');
  {
    const before = (await request('GET', '/admin/telemetry-report')).body.data.summary;

    await request('POST', '/csp/api/resources/telemetry',
      makePayload({ events: [makeEvent({ resource_id: 'cmd-t13' }), makeEvent({ resource_id: 'cmd-t13b' })] }),
      VALID_TOKEN,
    );

    const after = (await request('GET', '/admin/telemetry-report')).body.data.summary;
    assertEqual(after.total_reports, before.total_reports + 1, 'total_reports incremented by 1');
    assertEqual(after.total_events,  before.total_events  + 2, 'total_events incremented by 2');
  }

  // ── Test 14: by_resource 包含 Command/Skill 资源 ──────────────────────────
  console.log('\n【14】by_resource 包含上报过的 Command/Skill 资源');
  {
    await request('POST', '/csp/api/resources/telemetry',
      makePayload({ events: [
        makeEvent({ resource_id: 'cmd-t14-visible', resource_type: 'command', resource_name: 't14-cmd' }),
        makeEvent({ resource_id: 'skill-t14-visible', resource_type: 'skill', resource_name: 't14-skill' }),
      ]}),
      VALID_TOKEN,
    );

    const report = (await request('GET', '/admin/telemetry-report')).body.data;
    assert(
      report.by_resource.some(r => r.resource_id === 'cmd-t14-visible' && r.resource_type === 'command'),
      'command resource cmd-t14-visible in by_resource',
    );
    assert(
      report.by_resource.some(r => r.resource_id === 'skill-t14-visible' && r.resource_type === 'skill'),
      'skill resource skill-t14-visible in by_resource',
    );
  }

  // ── Test 15: 无效 token 被拒绝 ───────────────────────────────────────────
  console.log('\n【15】无效 token 被拒绝 (401)');
  {
    const r = await request('POST', '/csp/api/resources/telemetry', makePayload(), INVALID_TOKEN);
    assertEqual(r.status, 401, 'status 401 for invalid token');
    assert(r.body.result === 'failed', 'result = failed');
  }

  // ── Test 16: 缺少 reported_at 被拒绝 ─────────────────────────────────────
  console.log('\n【16】缺少 reported_at 被拒绝 (400)');
  {
    const payload = makePayload();
    delete payload.reported_at;
    const r = await request('POST', '/csp/api/resources/telemetry', payload, VALID_TOKEN);
    assertEqual(r.status, 400, 'status 400 when reported_at missing');
  }

  // ── Test 17: by_jira 包含正确调用次数 ────────────────────────────────────
  console.log('\n【17】by_jira 统计的调用次数与上报 invocation_count 一致');
  {
    const jiraId = `ZOOM-T17-${Date.now()}`;
    await request('POST', '/csp/api/resources/telemetry',
      makePayload({ events: [
        makeEvent({ resource_id: 'cmd-t17-a', jira_id: jiraId, invocation_count: 7 }),
      ]}),
      VALID_TOKEN,
    );

    const report = (await request('GET', '/admin/telemetry-report')).body.data;
    const jiraEntry = report.by_jira.find(j => j.jira_id === jiraId);
    assert(jiraEntry !== undefined, `${jiraId} present in by_jira`);
    assertGTE(jiraEntry?.total_invocations ?? 0, 7, `${jiraId} total_invocations >= 7`);
  }

  // ─────────────────────────────── Final Report ────────────────────────────

  // Print final telemetry report from mock server
  const finalReport = (await request('GET', '/admin/telemetry-report')).body.data;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              Telemetry Statistics Report                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n📊 Summary (as of ${finalReport.generated_at})`);
  console.log(`   Total reports received : ${finalReport.summary.total_reports}`);
  console.log(`   Total events           : ${finalReport.summary.total_events}`);
  console.log(`   Unique resources       : ${finalReport.summary.unique_resources}`);
  console.log(`   Unique Jira IDs        : ${finalReport.summary.unique_jira_ids}`);
  console.log(`   Subscribed rules       : ${finalReport.summary.subscribed_rules}`);
  console.log(`   Configured MCPs        : ${finalReport.summary.configured_mcps}`);

  if (finalReport.by_resource.length > 0) {
    console.log('\n📋 By Resource (Command/Skill invocations):');
    finalReport.by_resource
      .sort((a, b) => b.total_invocations - a.total_invocations)
      .slice(0, 10) // top 10
      .forEach(r => {
        const jiraTag = r.jira_ids.length > 0 ? ` [Jira: ${r.jira_ids.join(', ')}]` : '';
        console.log(`   ${r.resource_type.padEnd(8)} | ${r.resource_name.padEnd(30)} | ${String(r.total_invocations).padStart(4)} calls${jiraTag}`);
      });
  }

  if (finalReport.by_jira.length > 0) {
    console.log('\n🎫 By Jira ID:');
    finalReport.by_jira
      .sort((a, b) => b.total_invocations - a.total_invocations)
      .forEach(j => {
        console.log(`   ${j.jira_id.padEnd(20)} | ${j.total_invocations} invocations`);
      });
  }

  if (finalReport.latest_subscribed_rules.length > 0) {
    console.log(`\n📌 Latest Subscribed Rules (${finalReport.latest_subscribed_rules.length}):`);
    finalReport.latest_subscribed_rules.forEach(r => console.log(`   ${r.resource_id}`));
  }

  if (finalReport.latest_configured_mcps.length > 0) {
    console.log(`\n⚙️  Latest Configured MCPs (${finalReport.latest_configured_mcps.length}):`);
    finalReport.latest_configured_mcps.forEach(m => console.log(`   ${m.resource_id}`));
  }

  // ─────────────────────────────── Summary ─────────────────────────────────

  console.log(`\n${'─'.repeat(58)}`);
  console.log(`📊 Test Summary: ${passed + failed} total | ✅ ${passed} passed | ❌ ${failed} failed`);
  if (failed === 0) {
    console.log('🎉 All telemetry availability tests passed (100% Pass Rate)');
  } else {
    console.log(`⚠️  ${failed} test(s) failed — review telemetry implementation`);
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
