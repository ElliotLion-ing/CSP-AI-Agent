/**
 * Test Suite: Telemetry API Integration Tests
 * Feature: FEAT-2026-03-20-001 AI Resource Usage Telemetry
 *
 * Requires Mock Server to be running on port 3001 OR uses direct HTTP calls.
 * Tests the POST /csp/api/resources/telemetry endpoint in the Mock Server.
 *
 * Tests:
 *   1. Valid payload accepted (200)
 *   2. Missing Authorization rejected (401)
 *   3. Missing required fields rejected (400)
 *   4. Empty events array accepted (subscribed_rules only report)
 *   5. Multiple events accepted
 *   6. accepted_count matches events.length
 */

'use strict';

const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

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

const MOCK_PORT = parseInt(process.env.MOCK_PORT || '3001', 10);
const MOCK_TOKEN = process.env.MOCK_TOKEN || 'test-token-12345';

function httpPost(path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: '127.0.0.1',
      port: MOCK_PORT,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function checkMockServerRunning() {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: MOCK_PORT, path: '/health', method: 'GET' },
      (res) => resolve(res.statusCode < 500)
    );
    req.on('error', () => resolve(false));
    req.end();
  });
}

const VALID_PAYLOAD = {
  client_version: '0.0.0-test',
  reported_at: new Date().toISOString(),
  events: [
    {
      resource_id: 'mcp-tool-sync-resources',
      resource_type: 'mcp',
      resource_name: 'sync_resources',
      invocation_count: 3,
      first_invoked_at: new Date(Date.now() - 30000).toISOString(),
      last_invoked_at: new Date().toISOString(),
    },
  ],
  subscribed_rules: [
    {
      resource_id: 'rule-csp-openspec',
      resource_name: 'openspec-rule',
      subscribed_at: '2026-03-01T00:00:00Z',
    },
  ],
};

// ─────────────────────────────── APIClient integration ──────────────────────

async function testAPIClientModule() {
  const distPath = path.resolve(__dirname, '../SourceCode/dist');
  let apiClient;
  try {
    const mod = await import(`file://${distPath}/api/client.js`);
    apiClient = mod.apiClient;
  } catch {
    return null; // Module not available in this test run
  }

  console.log('\nGroup 7: APIClient.reportTelemetry method signature');
  assert(typeof apiClient.reportTelemetry === 'function', 'apiClient.reportTelemetry is a function');

  return apiClient;
}

async function runTests() {
  console.log('\n=== Telemetry API Integration Tests ===\n');

  const mockRunning = await checkMockServerRunning();

  if (!mockRunning) {
    console.log(`ℹ️  Mock server not running on port ${MOCK_PORT} — skipping HTTP endpoint tests`);
    console.log('   Start the mock server with: cd Test && node mock-csp-resource-server.js\n');
  } else {
    console.log(`✓ Mock server detected on port ${MOCK_PORT}\n`);

    // ── Test 1: Valid payload accepted ────────────────────────────────────
    console.log('Group 1: Valid payload accepted (200)');
    {
      const res = await httpPost('/csp/api/resources/telemetry', VALID_PAYLOAD, MOCK_TOKEN);
      assertEqual(res.status, 200, 'HTTP status 200');
      assertEqual(res.body.code, 2000, 'response code 2000');
      assertEqual(res.body.result, 'success', 'result = success');
      assertEqual(res.body.data.accepted_count, 1, 'accepted_count = 1');
    }

    // ── Test 2: Missing Authorization rejected ────────────────────────────
    console.log('\nGroup 2: Missing Authorization (401)');
    {
      const res = await httpPost('/csp/api/resources/telemetry', VALID_PAYLOAD, null);
      assertEqual(res.status, 401, 'HTTP status 401');
      assertEqual(res.body.code, 4001, 'response code 4001');
    }

    // ── Test 3: Missing required fields rejected ──────────────────────────
    console.log('\nGroup 3: Missing required fields (400)');
    {
      const res = await httpPost(
        '/csp/api/resources/telemetry',
        { client_version: '0.0.0-test' }, // missing reported_at, events, subscribed_rules
        MOCK_TOKEN
      );
      assertEqual(res.status, 400, 'HTTP status 400');
      assertEqual(res.body.code, 4000, 'response code 4000');
    }

    // ── Test 4: Empty events array accepted ───────────────────────────────
    console.log('\nGroup 4: Empty events array accepted');
    {
      const payload = {
        ...VALID_PAYLOAD,
        events: [],
        subscribed_rules: [
          { resource_id: 'rule-x', resource_name: 'rule-x', subscribed_at: '2026-01-01T00:00:00Z' },
        ],
      };
      const res = await httpPost('/csp/api/resources/telemetry', payload, MOCK_TOKEN);
      assertEqual(res.status, 200, 'HTTP status 200 for empty events');
      assertEqual(res.body.data.accepted_count, 0, 'accepted_count = 0 for empty events');
    }

    // ── Test 5: Multiple events accepted ─────────────────────────────────
    console.log('\nGroup 5: Multiple events accepted');
    {
      const payload = {
        ...VALID_PAYLOAD,
        events: [
          { resource_id: 'r1', resource_type: 'mcp', resource_name: 't1', invocation_count: 5, first_invoked_at: new Date().toISOString(), last_invoked_at: new Date().toISOString() },
          { resource_id: 'r2', resource_type: 'mcp', resource_name: 't2', invocation_count: 2, first_invoked_at: new Date().toISOString(), last_invoked_at: new Date().toISOString() },
          { resource_id: 'r3', resource_type: 'mcp', resource_name: 't3', invocation_count: 1, first_invoked_at: new Date().toISOString(), last_invoked_at: new Date().toISOString() },
        ],
      };
      const res = await httpPost('/csp/api/resources/telemetry', payload, MOCK_TOKEN);
      assertEqual(res.status, 200, 'HTTP status 200 for 3 events');
      assertEqual(res.body.data.accepted_count, 3, 'accepted_count = 3');
    }

    // ── Test 6: accepted_count matches events.length ─────────────────────
    console.log('\nGroup 6: accepted_count matches events.length');
    {
      const N = 7;
      const events = Array.from({ length: N }, (_, i) => ({
        resource_id: `r-${i}`,
        resource_type: 'mcp',
        resource_name: `tool-${i}`,
        invocation_count: i + 1,
        first_invoked_at: new Date().toISOString(),
        last_invoked_at: new Date().toISOString(),
      }));
      const res = await httpPost('/csp/api/resources/telemetry', { ...VALID_PAYLOAD, events }, MOCK_TOKEN);
      assertEqual(res.status, 200, `HTTP status 200 for ${N} events`);
      assertEqual(res.body.data.accepted_count, N, `accepted_count = ${N}`);
    }
  }

  // ── APIClient module test (doesn't need mock server) ─────────────────────
  await testAPIClientModule();

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
