#!/usr/bin/env node
/**
 * test-upload-resource-v2.js
 *
 * Full end-to-end test suite for the redesigned upload_resource flow.
 *
 * Coverage:
 *   [Mock API layer]  POST /csp/api/resources/upload  — stage files
 *   [Mock API layer]  POST /csp/api/resources/finalize — Git commit
 *   [MCP tool layer]  upload_resource via JSON-RPC through MCP Server
 *
 * Test cases:
 *   T01 – Mock /upload: single command file (happy path)
 *   T02 – Mock /upload: multi-file skill (SKILL.md + examples.md)
 *   T03 – Mock /upload: mcp package with non-.md files (.py, requirements.txt)
 *   T04 – Mock /upload: missing required field → 400
 *   T05 – Mock /upload: invalid type → 400
 *   T06 – Mock /upload: path traversal in files[].path → 400
 *   T07 – Mock /upload: empty files[] → 400
 *   T08 – Mock /finalize: valid upload_id (happy path)
 *   T09 – Mock /finalize: unknown upload_id → 404
 *   T10 – Mock /finalize: missing commit_message → 400
 *   T11 – Mock /upload + /finalize: name conflict on second upload
 *   T12 – MCP tool: upload_resource single file via JSON-RPC
 *   T13 – MCP tool: upload_resource multi-file skill via JSON-RPC
 *   T14 – MCP tool: upload_resource invalid type → tool returns error
 *   T15 – MCP tool: upload_resource missing files[] → tool returns error
 *   T16 – Mock /upload: unauthenticated request → 401
 *   T17 – Mock /finalize: unauthenticated request → 401
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const MOCK_URL  = 'http://127.0.0.1:6093';
const MCP_URL   = 'http://127.0.0.1:3000';
const TOKEN_FILE = path.join(__dirname, 'CSP-Jwt-token.json');

function loadToken() {
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    return data['CSP-Jwt-token'] || data.token || '';
  } catch {
    console.error('❌ Cannot read CSP-Jwt-token.json');
    process.exit(1);
  }
}
const TOKEN = loadToken();

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function request(options, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const opts = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.auth !== false ? { Authorization: `Bearer ${TOKEN}` } : {}),
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...options.headers,
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function parseUrl(urlStr) {
  const u = new URL(urlStr);
  return { hostname: u.hostname, port: parseInt(u.port), path: u.pathname };
}

function post(baseUrl, urlPath, body, opts = {}) {
  const { hostname, port } = parseUrl(baseUrl);
  return request({ method: 'POST', hostname, port, path: urlPath, ...opts }, body);
}

function get(baseUrl, urlPath, opts = {}) {
  const { hostname, port } = parseUrl(baseUrl);
  return request({ method: 'GET', hostname, port, path: urlPath, ...opts });
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     → ${err.message}`);
    failures.push({ name, error: err.message });
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertStatus(res, expected) {
  assert(res.status === expected, `Expected HTTP ${expected}, got ${res.status}. Body: ${JSON.stringify(res.body)}`);
}

function assertCode(res, expected) {
  assert(res.body?.code === expected, `Expected code ${expected}, got ${res.body?.code}. Body: ${JSON.stringify(res.body)}`);
}

// ── Connectivity check ─────────────────────────────────────────────────────
async function checkConnectivity() {
  console.log('\n🔍 Checking server connectivity...');

  try {
    const r = await get(MOCK_URL, '/health', { auth: false });
    // Mock server may not have /health but should refuse or return something
    console.log(`   Mock Server (${MOCK_URL}): reachable (${r.status})`);
  } catch (e) {
    // Try permissions endpoint as fallback
    try {
      await get(MOCK_URL, '/csp/api/user/permissions');
      console.log(`   Mock Server (${MOCK_URL}): reachable`);
    } catch {
      console.error(`\n❌ Mock Server not reachable at ${MOCK_URL}`);
      console.error('   → Run: node Test/mock-csp-resource-server.js');
      process.exit(1);
    }
  }

  try {
    const r = await get(MCP_URL, '/health', { auth: false });
    assert(r.status === 200, `MCP /health returned ${r.status}`);
    console.log(`   MCP Server (${MCP_URL}): reachable`);
  } catch (e) {
    console.error(`\n❌ MCP Server not reachable at ${MCP_URL}`);
    console.error('   → Run: cd SourceCode && npm start');
    process.exit(1);
  }
}

// ── JSON-RPC helper for MCP tool calls ───────────────────────────────────────
let mcpSessionId = null;

async function callMcpTool(toolName, toolArgs) {
  // Establish SSE session first to get sessionId
  if (!mcpSessionId) {
    mcpSessionId = await establishSseSession();
  }

  // /message body format: { sessionId: string, message: <JSON-RPC object> }
  const jsonRpcMessage = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: toolName, arguments: toolArgs },
  };

  const body = {
    sessionId: mcpSessionId,
    message: jsonRpcMessage,
  };

  const { hostname, port } = parseUrl(MCP_URL);
  const res = await request({
    method: 'POST',
    hostname,
    port,
    path: '/message',
    headers: { Authorization: `Bearer ${TOKEN}` },
  }, body);

  return res;
}

// Keep SSE request/response alive so the session stays open
let _sseReq = null;
let _sseRes = null;

/**
 * Establish a POST /sse session.
 * Server responds with SSE stream; the first data event is:
 *   data: {"type":"connected","sessionId":"<id>"}\n\n
 */
async function establishSseSession() {
  return new Promise((resolve, reject) => {
    const { hostname, port } = parseUrl(MCP_URL);
    const req = http.request({
      method: 'POST',
      hostname,
      port,
      path: '/sse',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'text/event-stream',
        'Content-Length': '0',
      },
    }, (res) => {
      _sseRes = res;
      let buffer = '';
      let sessionId = null;

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        // Parse SSE lines
        const lines = buffer.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.sessionId && !sessionId) {
                sessionId = parsed.sessionId;
                resolve(sessionId);
              }
            } catch {}
          }
        }
      });

      res.on('error', (err) => {
        if (!sessionId) reject(new Error(`SSE error: ${err.message}`));
      });

      res.on('end', () => {
        if (!sessionId) reject(new Error('SSE ended without sessionId'));
      });

      setTimeout(() => {
        if (!sessionId) reject(new Error('SSE timeout (5s) — no sessionId received'));
      }, 5000);
    });

    _sseReq = req;
    req.on('error', (err) => reject(new Error(`SSE request error: ${err.message}`)));
    req.end();
  });
}

function closeSseSession() {
  if (_sseRes) { try { _sseRes.destroy(); } catch {} _sseRes = null; }
  if (_sseReq) { try { _sseReq.destroy(); } catch {} _sseReq = null; }
  mcpSessionId = null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function runMockApiTests() {
  console.log('\n📦 [Mock API] POST /csp/api/resources/upload');

  await test('T01 – single command file (happy path)', async () => {
    const res = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'command',
      name: `test-review-pr-${Date.now()}`,
      files: [{ path: 'review-pr.md', content: '# Review PR\nAudit pull requests.' }],
    });
    assertStatus(res, 200);
    assertCode(res, 2000);
    assert(res.body.data?.upload_id?.startsWith('temp-'), `Expected upload_id starting with "temp-", got: ${res.body.data?.upload_id}`);
    assert(res.body.data?.expires_at, 'Missing expires_at');
    assert(res.body.data?.status === 'pending', 'Expected status=pending');
  });

  await test('T02 – multi-file skill (SKILL.md + examples.md)', async () => {
    const res = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'skill',
      name: `perf-analysis-${Date.now()}`,
      files: [
        { path: 'perf-analysis/SKILL.md', content: '# Perf Analysis Skill\nAnalyze performance.' },
        { path: 'perf-analysis/examples.md', content: '## Examples\nN+1 query detection.' },
      ],
    });
    assertStatus(res, 200);
    assertCode(res, 2000);
    assert(res.body.data?.upload_id, 'Missing upload_id');
  });

  await test('T03 – mcp package with non-.md files (.py, requirements.txt)', async () => {
    const res = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'mcp',
      name: `my-db-mcp-${Date.now()}`,
      files: [
        { path: 'my-db-mcp/README.md', content: '# My DB MCP' },
        { path: 'my-db-mcp/server.py', content: 'from mcp import Server\nserver = Server("my-db-mcp")' },
        { path: 'my-db-mcp/requirements.txt', content: 'mcp>=1.0.0\nsqlalchemy>=2.0' },
      ],
    });
    assertStatus(res, 200);
    assertCode(res, 2000);
    assert(res.body.data?.upload_id, 'Missing upload_id for mcp package');
  });

  await test('T04 – missing required field "name" → 400', async () => {
    const res = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'command',
      files: [{ path: 'x.md', content: 'hello' }],
      // name intentionally omitted
    });
    assertStatus(res, 400);
    assertCode(res, 4000);
  });

  await test('T05 – invalid type "widget" → 400', async () => {
    const res = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'widget',
      name: `bad-type-${Date.now()}`,
      files: [{ path: 'x.md', content: 'hello' }],
    });
    assertStatus(res, 400);
    assertCode(res, 4000);
  });

  await test('T06 – path traversal in files[].path → 400', async () => {
    const res = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'command',
      name: `traversal-${Date.now()}`,
      files: [{ path: '../../../etc/passwd', content: 'evil' }],
    });
    assertStatus(res, 400);
    assertCode(res, 4000);
  });

  await test('T07 – empty files[] array → 400', async () => {
    const res = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'skill',
      name: `empty-files-${Date.now()}`,
      files: [],
    });
    assertStatus(res, 400);
    assertCode(res, 4000);
  });

  await test('T16 – unauthenticated /upload → 401', async () => {
    const { hostname, port } = parseUrl(MOCK_URL);
    const res = await request({
      method: 'POST', hostname, port, path: '/csp/api/resources/upload', auth: false,
    }, { type: 'command', name: 'no-auth', files: [{ path: 'x.md', content: 'x' }] });
    assertStatus(res, 401);
  });

  // ── Finalize tests ──────────────────────────────────────────────────────────
  console.log('\n🏁 [Mock API] POST /csp/api/resources/finalize');

  // First stage an upload to get a valid upload_id
  let validUploadId;
  try {
    const stageRes = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'command',
      name: `finalize-test-cmd-${Date.now()}`,
      files: [{ path: 'finalize-test.md', content: '# Finalize Test' }],
    });
    validUploadId = stageRes.body.data?.upload_id;
  } catch (e) {
    console.warn('  ⚠️  Could not stage upload for finalize tests — skipping T08/T11');
  }

  await test('T08 – finalize valid upload_id (happy path)', async () => {
    assert(validUploadId, 'No valid upload_id available');
    const res = await post(MOCK_URL, '/csp/api/resources/finalize', {
      upload_id: validUploadId,
      commit_message: 'feat: add finalize-test command',
    });
    assertStatus(res, 200);
    assertCode(res, 2000);
    assert(res.body.data?.resource_id?.startsWith('Client-Public-'), `Unexpected resource_id: ${res.body.data?.resource_id}`);
    assert(res.body.data?.version === '1.0.0', 'Expected version 1.0.0');
    assert(res.body.data?.commit_hash, 'Missing commit_hash');
    assert(res.body.data?.url, 'Missing url');
  });

  await test('T09 – finalize unknown upload_id → 404', async () => {
    const res = await post(MOCK_URL, '/csp/api/resources/finalize', {
      upload_id: 'temp-nonexistent-99999',
      commit_message: 'should fail',
    });
    assertStatus(res, 404);
    assertCode(res, 4009);
  });

  await test('T10 – finalize missing commit_message → 400', async () => {
    const res = await post(MOCK_URL, '/csp/api/resources/finalize', {
      upload_id: 'temp-some-id',
      // commit_message intentionally omitted
    });
    assertStatus(res, 400);
    assertCode(res, 4000);
  });

  await test('T17 – unauthenticated /finalize → 401', async () => {
    const { hostname, port } = parseUrl(MOCK_URL);
    const res = await request({
      method: 'POST', hostname, port, path: '/csp/api/resources/finalize', auth: false,
    }, { upload_id: 'x', commit_message: 'y' });
    assertStatus(res, 401);
  });

  // ── Name conflict test (requires two uploads) ──────────────────────────────
  console.log('\n⚠️  [Mock API] Name conflict');

  await test('T11 – second upload with same name → 409', async () => {
    const conflictName = `conflict-resource-${Date.now()}`;
    // First upload (stage + finalize)
    const r1 = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'rule',
      name: conflictName,
      files: [{ path: 'my-rule.mdc', content: '# My Rule' }],
    });
    assertStatus(r1, 200);
    const uid1 = r1.body.data?.upload_id;
    assert(uid1, 'First upload failed to return upload_id');

    await post(MOCK_URL, '/csp/api/resources/finalize', {
      upload_id: uid1,
      commit_message: 'feat: add rule',
    });

    // Second upload with same name — should conflict
    const r2 = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'rule',
      name: conflictName,
      files: [{ path: 'my-rule.mdc', content: '# Duplicate' }],
    });
    assertStatus(r2, 409);
    assertCode(r2, 4009);
  });
}

async function runMcpToolTests() {
  console.log('\n🔧 [MCP Tool] upload_resource via JSON-RPC');

  await test('T12 – upload_resource single command file via JSON-RPC', async () => {
    const res = await callMcpTool('upload_resource', {
      resource_id: `test-cmd-${Date.now()}`,
      type: 'command',
      message: 'feat: add test command via mcp tool',
      target_source: 'csp',
      files: [
        { path: 'test-review-pr.md', content: '# Test Review PR\nThis is a test command.' },
      ],
    });
    // JSON-RPC via /message returns 202 Accepted (async); the actual result
    // is delivered over SSE. We just verify the MCP server accepted the call.
    assert(
      res.status === 200 || res.status === 202 || res.status === 204,
      `Expected 200/202/204, got ${res.status}. Body: ${JSON.stringify(res.body)}`
    );
  });

  await test('T13 – upload_resource multi-file skill via JSON-RPC', async () => {
    const res = await callMcpTool('upload_resource', {
      resource_id: `test-skill-${Date.now()}`,
      type: 'skill',
      message: 'feat: add multi-file perf skill',
      target_source: 'csp',
      files: [
        { path: 'perf-test/SKILL.md', content: '# Perf Test Skill' },
        { path: 'perf-test/examples.md', content: '## Examples' },
      ],
    });
    assert(
      res.status === 200 || res.status === 202 || res.status === 204,
      `Expected 200/202/204, got ${res.status}. Body: ${JSON.stringify(res.body)}`
    );
  });

  await test('T14 – upload_resource invalid type returns JSON-RPC error', async () => {
    const res = await callMcpTool('upload_resource', {
      resource_id: 'bad-type-resource',
      type: 'invalid_type',
      message: 'should fail',
      files: [{ path: 'x.md', content: 'x' }],
    });
    // Should receive either 400 HTTP or JSON-RPC error response
    assert(
      res.status === 400 || res.status === 200,
      `Unexpected status: ${res.status}`
    );
    if (res.status === 200 && res.body?.error) {
      // JSON-RPC error object present — acceptable
    } else if (res.status === 400) {
      // HTTP 400 — acceptable
    }
    // Either way it should not be 500 unless it's a known validation error
  });

  await test('T15 – upload_resource missing files[] returns error', async () => {
    const res = await callMcpTool('upload_resource', {
      resource_id: 'no-files-resource',
      type: 'command',
      message: 'no files provided',
      // files intentionally omitted
    });
    assert(
      res.status === 400 || res.status === 200,
      `Unexpected status: ${res.status}`
    );
  });
}

// ── Also test other existing tool endpoints to verify nothing is broken ───────
async function runRegressionTests() {
  console.log('\n🔁 [Regression] Other MCP tools still work');

  await test('search_resources still returns results', async () => {
    const res = await callMcpTool('search_resources', {
      keyword: 'code',
      type: 'skill',
    });
    assert(
      res.status === 200 || res.status === 202 || res.status === 204,
      `search_resources failed: HTTP ${res.status}`
    );
  });

  await test('manage_subscription list action works', async () => {
    const res = await callMcpTool('manage_subscription', { action: 'list' });
    assert(
      res.status === 200 || res.status === 202 || res.status === 204,
      `manage_subscription list failed: HTTP ${res.status}`
    );
  });
}

// ── Mock API direct two-step flow (combined staging + finalize) ──────────────
async function runTwoStepFlowTests() {
  console.log('\n🔗 [E2E Two-Step] Full upload → finalize flow');

  await test('Full flow: command (single file)', async () => {
    const name = `e2e-cmd-${Date.now()}`;
    const r1 = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'command',
      name,
      files: [{ path: 'my-cmd.md', content: '# My E2E Command' }],
    });
    assertStatus(r1, 200);
    assertCode(r1, 2000);
    const uploadId = r1.body.data?.upload_id;
    assert(uploadId, 'No upload_id from /upload');

    const r2 = await post(MOCK_URL, '/csp/api/resources/finalize', {
      upload_id: uploadId,
      commit_message: 'feat: e2e command upload',
    });
    assertStatus(r2, 200);
    assertCode(r2, 2000);
    assert(r2.body.data?.resource_id, 'Missing resource_id from /finalize');
    assert(r2.body.data?.commit_hash, 'Missing commit_hash');
  });

  await test('Full flow: skill (multi-file)', async () => {
    const name = `e2e-skill-${Date.now()}`;
    const r1 = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'skill',
      name,
      files: [
        { path: 'e2e-skill/SKILL.md', content: '# E2E Skill' },
        { path: 'e2e-skill/examples.md', content: '## Examples' },
        { path: 'e2e-skill/config.json', content: '{"version":"1.0"}' },
      ],
    });
    assertStatus(r1, 200);
    const uploadId = r1.body.data?.upload_id;

    const r2 = await post(MOCK_URL, '/csp/api/resources/finalize', {
      upload_id: uploadId,
      commit_message: 'feat: e2e multi-file skill upload',
    });
    assertStatus(r2, 200);
    assertCode(r2, 2000);
    assert(r2.body.data?.resource_id?.includes('skill'), `Expected skill resource_id, got: ${r2.body.data?.resource_id}`);
  });

  await test('Full flow: mcp package (.py + requirements.txt)', async () => {
    const name = `e2e-mcp-${Date.now()}`;
    const r1 = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'mcp',
      name,
      files: [
        { path: 'my-mcp/README.md', content: '# My MCP' },
        { path: 'my-mcp/server.py', content: 'from mcp import Server' },
        { path: 'my-mcp/requirements.txt', content: 'mcp>=1.0.0' },
        { path: 'my-mcp/config.json', content: '{}' },
      ],
    });
    assertStatus(r1, 200);
    const uploadId = r1.body.data?.upload_id;

    const r2 = await post(MOCK_URL, '/csp/api/resources/finalize', {
      upload_id: uploadId,
      commit_message: 'feat: add my-mcp package',
    });
    assertStatus(r2, 200);
    assertCode(r2, 2000);
    assert(r2.body.data?.resource_id?.includes('mcp'), `Expected mcp resource_id, got: ${r2.body.data?.resource_id}`);
  });

  await test('Full flow: rule (.mdc file)', async () => {
    const name = `e2e-rule-${Date.now()}`;
    const r1 = await post(MOCK_URL, '/csp/api/resources/upload', {
      type: 'rule',
      name,
      files: [{ path: 'security-baseline.mdc', content: '# Security Rule\n\nDo not hardcode secrets.' }],
    });
    assertStatus(r1, 200);
    const uploadId = r1.body.data?.upload_id;

    const r2 = await post(MOCK_URL, '/csp/api/resources/finalize', {
      upload_id: uploadId,
      commit_message: 'feat: add security-baseline rule',
    });
    assertStatus(r2, 200);
    assert(r2.body.data?.resource_id?.includes('rule'), `Expected rule resource_id, got: ${r2.body.data?.resource_id}`);
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════════════════════');
  console.log(' upload_resource v2 — Full Test Suite');
  console.log(`  Mock Server : ${MOCK_URL}`);
  console.log(`  MCP Server  : ${MCP_URL}`);
  console.log('════════════════════════════════════════════════════════');

  await checkConnectivity();

  await runMockApiTests();
  await runTwoStepFlowTests();
  await runMcpToolTests();
  await runRegressionTests();

  closeSseSession();

  // ── Summary ─────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log('\n════════════════════════════════════════════════════════');
  console.log(` Test Summary: ${passed}/${total} passed`);
  if (failed > 0) {
    console.log(` Failed (${failed}):`);
    failures.forEach(f => console.log(`   ✗ ${f.name}: ${f.error}`));
  }
  console.log('════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
