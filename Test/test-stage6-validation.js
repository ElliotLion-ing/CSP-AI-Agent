#!/usr/bin/env node
/**
 * Stage 6 Request Validation Test
 * Tests enhanced request validation with invalid inputs
 */

const http = require('http');

// Test configuration
const CONFIG = {
  mcpServerHost: 'localhost',
  mcpServerPort: 3000,
};

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

/**
 * Make HTTP request
 */
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : null;
          resolve({ statusCode: res.statusCode, body: parsed, headers: res.headers });
        } catch (error) {
          resolve({ statusCode: res.statusCode, body, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * Test: Missing sessionId
 */
async function testMissingSessionId() {
  log('\n📋 Test 1: Missing sessionId field', colors.blue);

  try {
    const response = await makeRequest(
      {
        hostname: CONFIG.mcpServerHost,
        port: CONFIG.mcpServerPort,
        path: '/message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      },
      {
        // Missing sessionId
        message: { jsonrpc: '2.0', method: 'test' },
      }
    );

    // Should return 400
    if (response.statusCode !== 400) {
      throw new Error(`Expected 400, got ${response.statusCode}`);
    }

    // Should have validation error
    if (!response.body.error || response.body.error !== 'Validation Error') {
      throw new Error('Expected Validation Error');
    }

    // Should have details
    if (!response.body.details || !Array.isArray(response.body.details)) {
      throw new Error('Expected details array');
    }

    // Should mention sessionId
    const sessionIdError = response.body.details.find(
      (e) => e.field === 'sessionId'
    );
    if (!sessionIdError) {
      throw new Error('Expected sessionId validation error');
    }

    log(`✅ Status: ${response.statusCode}`, colors.green);
    log(`   Error: ${response.body.error}`);
    log(`   Message: ${response.body.message}`);
    log(`   Details: ${JSON.stringify(response.body.details, null, 2)}`);

    log('✅ Test 1 PASSED', colors.green);
    return true;
  } catch (error) {
    log(`❌ Test 1 FAILED: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test: Missing message
 */
async function testMissingMessage() {
  log('\n📋 Test 2: Missing message field', colors.blue);

  try {
    const response = await makeRequest(
      {
        hostname: CONFIG.mcpServerHost,
        port: CONFIG.mcpServerPort,
        path: '/message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      },
      {
        sessionId: 'test-session-123',
        // Missing message
      }
    );

    // Should return 400
    if (response.statusCode !== 400) {
      throw new Error(`Expected 400, got ${response.statusCode}`);
    }

    // Should have validation error
    if (!response.body.error || response.body.error !== 'Validation Error') {
      throw new Error('Expected Validation Error');
    }

    // Should mention message
    const messageError = response.body.details.find((e) => e.field === 'message');
    if (!messageError) {
      throw new Error('Expected message validation error');
    }

    log(`✅ Status: ${response.statusCode}`, colors.green);
    log(`   Error: ${response.body.error}`);
    log(`   Details: ${JSON.stringify(response.body.details, null, 2)}`);

    log('✅ Test 2 PASSED', colors.green);
    return true;
  } catch (error) {
    log(`❌ Test 2 FAILED: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test: Invalid session (not found)
 */
async function testInvalidSession() {
  log('\n📋 Test 3: Invalid session (404 with helpful message)', colors.blue);

  try {
    const response = await makeRequest(
      {
        hostname: CONFIG.mcpServerHost,
        port: CONFIG.mcpServerPort,
        path: '/message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      },
      {
        sessionId: 'non-existent-session',
        message: { jsonrpc: '2.0', method: 'test' },
      }
    );

    // Should return 404
    if (response.statusCode !== 404) {
      throw new Error(`Expected 404, got ${response.statusCode}`);
    }

    // Should have helpful message
    if (!response.body.message || !response.body.message.includes('Session not found')) {
      throw new Error('Expected helpful error message');
    }

    // Should have suggestion
    if (!response.body.details || !response.body.details.suggestion) {
      log('⚠️  Missing suggestion in error response', colors.yellow);
    } else {
      log(`✅ Suggestion provided: ${response.body.details.suggestion}`, colors.green);
    }

    log(`✅ Status: ${response.statusCode}`, colors.green);
    log(`   Error: ${response.body.error}`);
    log(`   Message: ${response.body.message}`);

    log('✅ Test 3 PASSED', colors.green);
    return true;
  } catch (error) {
    log(`❌ Test 3 FAILED: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test: Both fields missing
 */
async function testBothFieldsMissing() {
  log('\n📋 Test 4: Both sessionId and message missing', colors.blue);

  try {
    const response = await makeRequest(
      {
        hostname: CONFIG.mcpServerHost,
        port: CONFIG.mcpServerPort,
        path: '/message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      },
      {} // Empty body
    );

    // Should return 400
    if (response.statusCode !== 400) {
      throw new Error(`Expected 400, got ${response.statusCode}`);
    }

    // Should have validation errors for both fields
    if (!response.body.details || response.body.details.length < 2) {
      throw new Error('Expected validation errors for both fields');
    }

    const sessionIdError = response.body.details.find((e) => e.field === 'sessionId');
    const messageError = response.body.details.find((e) => e.field === 'message');

    if (!sessionIdError || !messageError) {
      throw new Error('Expected errors for both sessionId and message');
    }

    log(`✅ Status: ${response.statusCode}`, colors.green);
    log(`   Errors found: ${response.body.details.length}`);
    log(`   Details: ${JSON.stringify(response.body.details, null, 2)}`);

    log('✅ Test 4 PASSED', colors.green);
    return true;
  } catch (error) {
    log(`❌ Test 4 FAILED: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Main test execution
 */
async function runTests() {
  log('═══════════════════════════════════════════════════════', colors.blue);
  log('  Stage 6: Request Validation Tests', colors.blue);
  log('═══════════════════════════════════════════════════════', colors.blue);

  const results = [];

  // Run tests
  results.push(await testMissingSessionId());
  results.push(await testMissingMessage());
  results.push(await testInvalidSession());
  results.push(await testBothFieldsMissing());

  // Summary
  log('\n═══════════════════════════════════════════════════════', colors.blue);
  const passed = results.filter(Boolean).length;
  const total = results.length;
  const passRate = ((passed / total) * 100).toFixed(1);

  if (passed === total) {
    log(`✅ All tests passed! (${passed}/${total}, ${passRate}%)`, colors.green);
    log('═══════════════════════════════════════════════════════', colors.blue);
    process.exit(0);
  } else {
    log(`❌ Some tests failed (${passed}/${total}, ${passRate}%)`, colors.red);
    log('═══════════════════════════════════════════════════════', colors.blue);
    process.exit(1);
  }
}

// Check if MCP server is running
async function checkServerRunning() {
  try {
    await makeRequest({
      hostname: CONFIG.mcpServerHost,
      port: CONFIG.mcpServerPort,
      path: '/health',
      method: 'GET',
      timeout: 2000,
    });
    return true;
  } catch (error) {
    return false;
  }
}

// Main
(async () => {
  const isRunning = await checkServerRunning();

  if (!isRunning) {
    log('⚠️  MCP Server is not running!', colors.yellow);
    log('Please start the server first:', colors.yellow);
    log('  cd SourceCode && npm start', colors.yellow);
    process.exit(1);
  }

  await runTests();
})();
