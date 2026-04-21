#!/usr/bin/env node
/**
 * Automated Test Runner for CSP Resource Management API
 * Executes test cases defined in test-cases-design.md
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:6093';
const TOKEN_FILE = path.join(__dirname, 'CSP-Jwt-token.json');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Test statistics
let stats = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0
};

// Load token
function loadToken() {
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    return data['CSP-Jwt-token'];
  } catch (err) {
    console.error(`${colors.red}Failed to load token: ${err.message}${colors.reset}`);
    process.exit(1);
  }
}

const validToken = loadToken();
const invalidToken = 'invalid_token_xyz123';

// HTTP request helper
function request(method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqOptions = {
      method: method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: options.headers || {}
    };

    if (options.body) {
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(options.body));
    }

    const req = lib.request(reqOptions, (res) => {
      let data = [];
      
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        let body = Buffer.concat(data);
        
        // Handle gzip encoding
        if (res.headers['content-encoding'] === 'gzip') {
          zlib.gunzip(body, (err, decoded) => {
            if (err) return reject(err);
            body = decoded.toString('utf8');
            try {
              resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
            } catch {
              resolve({ status: res.statusCode, headers: res.headers, body: body });
            }
          });
        } else {
          body = body.toString('utf8');
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body: body });
          }
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

// Test assertion helpers
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertIncludes(array, value, message) {
  if (!array.includes(value)) {
    throw new Error(`${message}: array does not include ${value}`);
  }
}

function assertHasProperty(obj, prop, message) {
  if (!(prop in obj)) {
    throw new Error(`${message}: object missing property ${prop}`);
  }
}

// Test runner
async function runTest(name, testFn) {
  stats.total++;
  process.stdout.write(`${colors.cyan}[TEST]${colors.reset} ${name} ... `);
  
  try {
    await testFn();
    stats.passed++;
    console.log(`${colors.green}✓ PASS${colors.reset}`);
  } catch (err) {
    stats.failed++;
    console.log(`${colors.red}✗ FAIL${colors.reset}`);
    console.log(`       ${colors.red}${err.message}${colors.reset}`);
  }
}

// ============================================
// Test Cases
// ============================================

async function testAuth() {
  console.log(`\n${colors.bright}=== 1. Authentication Tests ===${colors.reset}`);

  await runTest('TC-AUTH-001: Valid token authentication', async () => {
    const res = await request('GET', '/csp/api/user/permissions', {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    assertEqual(res.status, 200, 'Status code');
    assertEqual(res.body.code, 2000, 'Response code');
    assertHasProperty(res.body.data, 'email', 'Response data');
  });

  await runTest('TC-AUTH-002: Missing token', async () => {
    const res = await request('GET', '/csp/api/user/permissions', {});
    assertEqual(res.status, 401, 'Status code');
    assertEqual(res.body.code, 4010, 'Response code');
  });

  await runTest('TC-AUTH-003: Invalid token', async () => {
    const res = await request('GET', '/csp/api/user/permissions', {
      headers: { 'Authorization': `Bearer ${invalidToken}` }
    });
    assertEqual(res.status, 401, 'Status code');
    assertEqual(res.body.code, 4010, 'Response code');
  });

  await runTest('TC-AUTH-004: Wrong authorization format', async () => {
    const res = await request('GET', '/csp/api/user/permissions', {
      headers: { 'Authorization': `Token ${validToken}` }
    });
    assertEqual(res.status, 401, 'Status code');
    assertEqual(res.body.code, 4010, 'Response code');
  });
}

async function testSearch() {
  console.log(`\n${colors.bright}=== 2. Search Resources Tests ===${colors.reset}`);

  await runTest('TC-SEARCH-001: Basic search with results', async () => {
    const res = await request('GET', '/csp/api/resources/search?keyword=debug&type=command&page=1&page_size=20', {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    assertEqual(res.status, 200, 'Status code');
    assertEqual(res.body.code, 2000, 'Response code');
    assertHasProperty(res.body.data, 'total', 'Response data');
    assertHasProperty(res.body.data, 'results', 'Response data');
  });

  await runTest('TC-SEARCH-002: Search with no results', async () => {
    const res = await request('GET', '/csp/api/resources/search?keyword=nonexistent-xyz&type=all', {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    assertEqual(res.status, 200, 'Status code');
    assertEqual(res.body.data.total, 0, 'Total results');
  });

  await runTest('TC-SEARCH-003: Search with details', async () => {
    const res = await request('GET', '/csp/api/resources/search?keyword=network&detail=true', {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    assertEqual(res.status, 200, 'Status code');
    if (res.body.data.results.length > 0) {
      assertHasProperty(res.body.data.results[0], 'metadata', 'Result metadata');
    }
  });

  await runTest('TC-SEARCH-004: Filter by type', async () => {
    const res = await request('GET', '/csp/api/resources/search?type=skill&page=1&page_size=10', {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    assertEqual(res.status, 200, 'Status code');
    if (res.body.data.results.length > 0) {
      res.body.data.results.forEach(r => {
        assertEqual(r.type, 'skill', 'Resource type');
      });
    }
  });

  await runTest('TC-SEARCH-007: No authentication', async () => {
    const res = await request('GET', '/csp/api/resources/search?keyword=test', {});
    assertEqual(res.status, 401, 'Status code');
    assertEqual(res.body.code, 4010, 'Response code');
  });
}

async function testGetResource() {
  console.log(`\n${colors.bright}=== 3. Get Resource Details Tests ===${colors.reset}`);

  await runTest('TC-GET-001: Get existing resource', async () => {
    const res = await request('GET', '/csp/api/resources/zCodeReview-skill-001', {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    assertEqual(res.status, 200, 'Status code');
    assertEqual(res.body.code, 2000, 'Response code');
    assertEqual(res.body.data.id, 'zCodeReview-skill-001', 'Resource ID');
    assertHasProperty(res.body.data, 'hash', 'Resource hash');
  });

  await runTest('TC-GET-002: Get non-existent resource', async () => {
    const res = await request('GET', '/csp/api/resources/nonexistent-id-123', {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    assertEqual(res.status, 404, 'Status code');
    assertEqual(res.body.code, 4008, 'Response code');
  });

  await runTest('TC-GET-004: No authentication', async () => {
    const res = await request('GET', '/csp/api/resources/zCodeReview-skill-001', {});
    assertEqual(res.status, 401, 'Status code');
    assertEqual(res.body.code, 4010, 'Response code');
  });
}

async function testDownload() {
  console.log(`\n${colors.bright}=== 4. Download Resource Tests ===${colors.reset}`);

  await runTest('TC-DOWNLOAD-001: Download existing resource', async () => {
    const res = await request('GET', '/csp/api/resources/download/zCodeReview-skill-001', {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    assertEqual(res.status, 200, 'Status code');
    assertHasProperty(res.headers, 'etag', 'ETag header');
  });

  await runTest('TC-DOWNLOAD-002: Download with gzip', async () => {
    const res = await request('GET', '/csp/api/resources/download/Client-Public-skill-002', {
      headers: { 
        'Authorization': `Bearer ${validToken}`,
        'Accept-Encoding': 'gzip, br'
      }
    });
    assertEqual(res.status, 200, 'Status code');
  });

  await runTest('TC-DOWNLOAD-004: Download non-existent resource', async () => {
    const res = await request('GET', '/csp/api/resources/download/invalid-id-999', {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    assertEqual(res.status, 404, 'Status code');
    assertEqual(res.body.code, 4008, 'Response code');
  });

  await runTest('TC-DOWNLOAD-005: No authentication', async () => {
    const res = await request('GET', '/csp/api/resources/download/zCodeReview-skill-001', {});
    assertEqual(res.status, 401, 'Status code');
  });
}

async function testUpload() {
  console.log(`\n${colors.bright}=== 5. Upload Resource Tests ===${colors.reset}`);

  let uploadId;

  await runTest('TC-UPLOAD-001: Successfully upload command', async () => {
    const res = await request('POST', '/csp/api/resources/upload', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        content: '# New Debug Tool\n\nDescription...',
        type: 'command',
        name: `test-tool-${Date.now()}`
      }
    });
    assertEqual(res.status, 200, 'Status code');
    assertEqual(res.body.code, 2000, 'Response code');
    assertHasProperty(res.body.data, 'upload_id', 'Upload ID');
    uploadId = res.body.data.upload_id;
  });

  await runTest('TC-UPLOAD-003: Missing required field', async () => {
    const res = await request('POST', '/csp/api/resources/upload', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        content: 'Some content',
        type: 'command'
        // missing "name"
      }
    });
    assertEqual(res.status, 400, 'Status code');
    assertEqual(res.body.code, 4000, 'Response code');
  });

  await runTest('TC-UPLOAD-004: Invalid resource type', async () => {
    const res = await request('POST', '/csp/api/resources/upload', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        content: 'Content',
        type: 'invalid-type',
        name: 'test'
      }
    });
    assertEqual(res.status, 400, 'Status code');
    assertEqual(res.body.code, 4000, 'Response code');
  });

  await runTest('TC-UPLOAD-006: Resource name conflict', async () => {
    const res = await request('POST', '/csp/api/resources/upload', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        content: 'Content',
        type: 'command',
        name: 'debug-network'  // existing name
      }
    });
    assertEqual(res.status, 409, 'Status code');
    assertEqual(res.body.code, 4009, 'Response code');
  });

  await runTest('TC-UPLOAD-007: No authentication', async () => {
    const res = await request('POST', '/csp/api/resources/upload', {
      body: {
        content: 'Test',
        type: 'command',
        name: 'test'
      }
    });
    assertEqual(res.status, 401, 'Status code');
  });

  return uploadId;
}

async function testFinalize(uploadId) {
  console.log(`\n${colors.bright}=== 6. Finalize Upload Tests ===${colors.reset}`);

  if (!uploadId) {
    console.log(`${colors.yellow}Skipping finalize tests (no upload_id)${colors.reset}`);
    return;
  }

  await runTest('TC-FINALIZE-001: Successfully finalize upload', async () => {
    const res = await request('POST', '/csp/api/resources/finalize', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        upload_id: uploadId,
        commit_message: 'Add new test tool'
      }
    });
    assertEqual(res.status, 200, 'Status code');
    assertEqual(res.body.code, 2000, 'Response code');
    assertHasProperty(res.body.data, 'resource_id', 'Resource ID');
  });

  await runTest('TC-FINALIZE-002: Non-existent upload_id', async () => {
    const res = await request('POST', '/csp/api/resources/finalize', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        upload_id: 'nonexistent-upload-id',
        commit_message: 'Test'
      }
    });
    assertEqual(res.status, 404, 'Status code');
    assertEqual(res.body.code, 4009, 'Response code');
  });

  await runTest('TC-FINALIZE-004: Missing required field', async () => {
    const res = await request('POST', '/csp/api/resources/finalize', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        upload_id: 'some-id'
        // missing "commit_message"
      }
    });
    assertEqual(res.status, 400, 'Status code');
    assertEqual(res.body.code, 4000, 'Response code');
  });
}

async function testSubscriptions() {
  console.log(`\n${colors.bright}=== 7. Subscriptions Tests ===${colors.reset}`);

  // Add subscriptions first
  await runTest('TC-SUBS-ADD-001: Successfully subscribe single resource', async () => {
    const res = await request('POST', '/csp/api/resources/subscriptions/add', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        resource_ids: ['zCodeReview-skill-001'],
        scope: 'general'
      }
    });
    assertEqual(res.status, 200, 'Status code');
    assertEqual(res.body.code, 2000, 'Response code');
  });

  await runTest('TC-SUBS-ADD-002: Batch subscribe multiple resources', async () => {
    const res = await request('POST', '/csp/api/resources/subscriptions/add', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        resource_ids: ['Client-Public-skill-002', 'zDB-cmd-003'],
        scope: 'all'
      }
    });
    assertEqual(res.status, 200, 'Status code');
  });

  await runTest('TC-SUBS-GET-002: Get all subscriptions', async () => {
    const res = await request('GET', '/csp/api/resources/subscriptions?scope=all&detail=false', {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    assertEqual(res.status, 200, 'Status code');
    assertEqual(res.body.code, 2000, 'Response code');
    assertHasProperty(res.body.data, 'subscriptions', 'Subscriptions list');
  });

  await runTest('TC-SUBS-GET-003: Get subscriptions with details', async () => {
    const res = await request('GET', '/csp/api/resources/subscriptions?scope=all&detail=true', {
      headers: { 'Authorization': `Bearer ${validToken}` }
    });
    assertEqual(res.status, 200, 'Status code');
    if (res.body.data.subscriptions.length > 0) {
      assertHasProperty(res.body.data.subscriptions[0], 'resource', 'Resource details');
    }
  });

  await runTest('TC-SUBS-REMOVE-001: Successfully unsubscribe', async () => {
    const res = await request('DELETE', '/csp/api/resources/subscriptions/remove', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        resource_ids: ['zCodeReview-skill-001']
      }
    });
    assertEqual(res.status, 200, 'Status code');
    assertEqual(res.body.code, 2000, 'Response code');
  });

  await runTest('TC-SUBS-ADD-004: Partial resource not found', async () => {
    const res = await request('POST', '/csp/api/resources/subscriptions/add', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        resource_ids: ['zCodeReview-skill-001', 'invalid-id-xyz'],
        scope: 'all'
      }
    });
    assertEqual(res.body.code, 4008, 'Response code');
    assertHasProperty(res.body.data, 'invalid_ids', 'Invalid IDs list');
  });

  await runTest('TC-SUBS-ADD-006: Missing resource_ids', async () => {
    const res = await request('POST', '/csp/api/resources/subscriptions/add', {
      headers: { 'Authorization': `Bearer ${validToken}` },
      body: {
        scope: 'all'
      }
    });
    assertEqual(res.status, 400, 'Status code');
    assertEqual(res.body.code, 4000, 'Response code');
  });
}

// ============================================
// Main Test Execution
// ============================================

async function main() {
  console.log(`\n${colors.bright}${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.bright}${colors.blue} CSP Resource API Test Runner${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.bright}Base URL:${colors.reset} ${BASE_URL}`);
  console.log(`${colors.bright}Token:${colors.reset} ${validToken.substring(0, 20)}...`);
  console.log(`${colors.bright}${colors.blue}========================================${colors.reset}\n`);

  try {
    await testAuth();
    await testSearch();
    await testGetResource();
    await testDownload();
    const uploadId = await testUpload();
    await testFinalize(uploadId);
    await testSubscriptions();
  } catch (err) {
    console.error(`\n${colors.red}Fatal error: ${err.message}${colors.reset}`);
  }

  // Print summary
  console.log(`\n${colors.bright}${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.bright} Test Summary${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.bright}Total:${colors.reset}   ${stats.total}`);
  console.log(`${colors.green}Passed:${colors.reset}  ${stats.passed}`);
  console.log(`${colors.red}Failed:${colors.reset}  ${stats.failed}`);
  console.log(`${colors.yellow}Skipped:${colors.reset} ${stats.skipped}`);
  
  const passRate = ((stats.passed / stats.total) * 100).toFixed(2);
  console.log(`${colors.bright}Pass Rate:${colors.reset} ${passRate}%`);
  console.log(`${colors.bright}${colors.blue}========================================${colors.reset}\n`);

  process.exit(stats.failed > 0 ? 1 : 0);
}

main();
