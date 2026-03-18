#!/usr/bin/env node
/**
 * Stage 6 Health Check Test
 * Tests the /health endpoint with service monitoring
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

// Test configuration
const CONFIG = {
  mcpServerHost: 'localhost',
  mcpServerPort: 3000,
  testTimeout: 60000, // 60 seconds
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
 * Test: Health Check Endpoint Basic
 */
async function testHealthCheckBasic() {
  log('\n📋 Test 1: Health Check Endpoint - Basic', colors.blue);

  try {
    const response = await makeRequest({
      hostname: CONFIG.mcpServerHost,
      port: CONFIG.mcpServerPort,
      path: '/health',
      method: 'GET',
      timeout: 5000,
    });

    // Verify status code
    if (response.statusCode !== 200) {
      throw new Error(`Expected status 200, got ${response.statusCode}`);
    }

    // Verify response structure
    const health = response.body;
    if (!health || typeof health !== 'object') {
      throw new Error('Health response is not an object');
    }

    // Verify required fields
    const requiredFields = ['status', 'uptime', 'memory', 'sessions', 'services', 'timestamp'];
    for (const field of requiredFields) {
      if (!(field in health)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Verify status
    if (!['healthy', 'unhealthy'].includes(health.status)) {
      throw new Error(`Invalid status: ${health.status}`);
    }

    // Verify services structure
    if (!health.services.http || !health.services.redis || !health.services.cache) {
      throw new Error('Missing services health information');
    }

    log(`✅ Status: ${health.status}`, colors.green);
    log(`   Uptime: ${health.uptime}s`);
    log(`   Memory: ${health.memory.used}MB / ${health.memory.total}MB (${health.memory.percentage}%)`);
    log(`   Sessions: ${health.sessions.active} active, ${health.sessions.total} total`);
    log(`   Services:`);
    log(`     - HTTP: ${health.services.http}`);
    log(`     - Redis: ${health.services.redis}`);
    log(`     - Cache: ${health.services.cache}`);

    if (health.details) {
      log(`   Details:`, colors.yellow);
      if (health.details.redisError) {
        log(`     - Redis Error: ${health.details.redisError}`, colors.yellow);
      }
      if (health.details.cacheError) {
        log(`     - Cache Error: ${health.details.cacheError}`, colors.yellow);
      }
    }

    log('✅ Test 1 PASSED', colors.green);
    return true;
  } catch (error) {
    log(`❌ Test 1 FAILED: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test: Health Check Response Time
 */
async function testHealthCheckPerformance() {
  log('\n📋 Test 2: Health Check Response Time', colors.blue);

  try {
    const startTime = Date.now();

    const response = await makeRequest({
      hostname: CONFIG.mcpServerHost,
      port: CONFIG.mcpServerPort,
      path: '/health',
      method: 'GET',
      timeout: 5000,
    });

    const responseTime = Date.now() - startTime;

    if (response.statusCode !== 200) {
      throw new Error(`Expected status 200, got ${response.statusCode}`);
    }

    // Health check should respond quickly (< 1000ms)
    if (responseTime > 1000) {
      log(`⚠️  Response time is slow: ${responseTime}ms`, colors.yellow);
    } else {
      log(`✅ Response time: ${responseTime}ms`, colors.green);
    }

    log('✅ Test 2 PASSED', colors.green);
    return true;
  } catch (error) {
    log(`❌ Test 2 FAILED: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Test: Multiple Health Check Requests
 */
async function testHealthCheckConcurrent() {
  log('\n📋 Test 3: Concurrent Health Checks', colors.blue);

  try {
    const requests = Array(5).fill(null).map(() =>
      makeRequest({
        hostname: CONFIG.mcpServerHost,
        port: CONFIG.mcpServerPort,
        path: '/health',
        method: 'GET',
        timeout: 5000,
      })
    );

    const responses = await Promise.all(requests);

    // All requests should succeed
    const allSuccess = responses.every(r => r.statusCode === 200);
    if (!allSuccess) {
      throw new Error('Some health check requests failed');
    }

    // All should return valid health data
    const allValid = responses.every(r =>
      r.body &&
      typeof r.body === 'object' &&
      'status' in r.body &&
      'services' in r.body
    );

    if (!allValid) {
      throw new Error('Some health check responses are invalid');
    }

    log(`✅ All ${requests.length} concurrent requests succeeded`, colors.green);
    log('✅ Test 3 PASSED', colors.green);
    return true;
  } catch (error) {
    log(`❌ Test 3 FAILED: ${error.message}`, colors.red);
    return false;
  }
}

/**
 * Main test execution
 */
async function runTests() {
  log('═══════════════════════════════════════════════════════', colors.blue);
  log('  Stage 6: Health Check Endpoint Tests', colors.blue);
  log('═══════════════════════════════════════════════════════', colors.blue);

  const results = [];

  // Run tests
  results.push(await testHealthCheckBasic());
  results.push(await testHealthCheckPerformance());
  results.push(await testHealthCheckConcurrent());

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
