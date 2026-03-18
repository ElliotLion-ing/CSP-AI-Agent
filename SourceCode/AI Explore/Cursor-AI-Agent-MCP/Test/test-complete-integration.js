#!/usr/bin/env node
/**
 * CSP AI Agent MCP Server - Complete Integration Test Suite
 * 整合所有 Stage 1-6 的核心功能测试
 * 
 * 测试覆盖：
 * - Stage 1: 核心框架（启动、配置、日志）
 * - Stage 2: MCP Server 基础（工具注册、协议处理）
 * - Stage 3: MCP Tools 实现（5个工具完整功能）
 * - Stage 4: SSE Transport（HTTP Server、Session）
 * - Stage 5: 认证和缓存（JWT、L1/L2缓存）
 * - Stage 6: 生产就绪（健康检查、优雅关闭、验证）
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
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
 * Run a test script
 */
function runTest(scriptName, description) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, scriptName);
    
    log(`\n${'='.repeat(70)}`, colors.cyan);
    log(`  ${description}`, colors.cyan);
    log('='.repeat(70), colors.cyan);

    const child = spawn('node', [scriptPath], {
      stdio: 'inherit',
      cwd: __dirname,
    });

    child.on('close', (code) => {
      if (code === 0) {
        log(`\n✅ ${scriptName} PASSED`, colors.green);
        resolve(true);
      } else {
        log(`\n❌ ${scriptName} FAILED (exit code: ${code})`, colors.red);
        resolve(false);
      }
    });

    child.on('error', (error) => {
      log(`\n❌ ${scriptName} ERROR: ${error.message}`, colors.red);
      resolve(false);
    });
  });
}

/**
 * Test Suite: Core Framework (Stage 1)
 */
async function testCoreFramework() {
  log('\n' + '═'.repeat(70), colors.magenta);
  log('  STAGE 1: Core Framework Tests', colors.magenta);
  log('═'.repeat(70), colors.magenta);

  const result = await runTest('test-stage1-startup.js', 'Testing: Configuration, Logging, Startup');
  return { stage: 'Stage 1', name: 'Core Framework', passed: result };
}

/**
 * Test Suite: MCP Server Basics (Stage 2)
 */
async function testMCPServerBasics() {
  log('\n' + '═'.repeat(70), colors.magenta);
  log('  STAGE 2: MCP Server Basics Tests', colors.magenta);
  log('═'.repeat(70), colors.magenta);

  const result = await runTest('test-stage2-integration.js', 'Testing: Tool Registry, Protocol Handling');
  return { stage: 'Stage 2', name: 'MCP Server Basics', passed: result };
}

/**
 * Test Suite: MCP Tools Implementation (Stage 3)
 */
async function testMCPTools() {
  log('\n' + '═'.repeat(70), colors.magenta);
  log('  STAGE 3: MCP Tools Implementation Tests', colors.magenta);
  log('═'.repeat(70), colors.magenta);

  const result = await runTest('test-stage3-integration.js', 'Testing: 5 MCP Tools (sync, manage, search, upload, uninstall)');
  return { stage: 'Stage 3', name: 'MCP Tools', passed: result };
}

/**
 * Test Suite: SSE Transport (Stage 4)
 */
async function testSSETransport() {
  log('\n' + '═'.repeat(70), colors.magenta);
  log('  STAGE 4: SSE Transport Tests', colors.magenta);
  log('═'.repeat(70), colors.magenta);

  const result = await runTest('test-stage4-integration.js', 'Testing: HTTP Server, SSE, Session Management');
  return { stage: 'Stage 4', name: 'SSE Transport', passed: result };
}

/**
 * Test Suite: Authentication & Cache (Stage 5)
 */
async function testAuthAndCache() {
  log('\n' + '═'.repeat(70), colors.magenta);
  log('  STAGE 5: Authentication & Cache Tests', colors.magenta);
  log('═'.repeat(70), colors.magenta);

  const result = await runTest('test-stage5-integration.js', 'Testing: JWT Auth, Permission, L1/L2 Cache');
  return { stage: 'Stage 5', name: 'Auth & Cache', passed: result };
}

/**
 * Test Suite: Production Ready (Stage 6)
 */
async function testProductionReady() {
  log('\n' + '═'.repeat(70), colors.magenta);
  log('  STAGE 6: Production Ready Tests', colors.magenta);
  log('═'.repeat(70), colors.magenta);

  log('\n📋 Running Health Check Tests...', colors.cyan);
  const healthResult = await runTest('test-stage6-health.js', 'Testing: Health Endpoint');

  log('\n📋 Running Validation Tests...', colors.cyan);
  const validationResult = await runTest('test-stage6-validation.js', 'Testing: Request Validation');

  const allPassed = healthResult && validationResult;
  
  log('\n📝 Note: Shutdown tests require manual execution:', colors.yellow);
  log('   cd Test && node test-stage6-shutdown.js', colors.yellow);

  return { stage: 'Stage 6', name: 'Production Ready', passed: allPassed };
}

/**
 * Test Suite: End-to-End Integration
 */
async function testEndToEnd() {
  log('\n' + '═'.repeat(70), colors.magenta);
  log('  END-TO-END: Complete Workflow Tests', colors.magenta);
  log('═'.repeat(70), colors.magenta);

  const tests = [];
  const startTime = Date.now();

  // Test 1: Health Check
  log('\n📋 Test E2E-1: Health Check Endpoint', colors.blue);
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET',
      timeout: 5000,
    });

    if (response.statusCode === 200 && response.body.status === 'healthy') {
      log('✅ Health check passed', colors.green);
      tests.push({ name: 'E2E Health Check', passed: true });
    } else {
      throw new Error(`Unexpected response: ${response.statusCode}`);
    }
  } catch (error) {
    log(`❌ Health check failed: ${error.message}`, colors.red);
    tests.push({ name: 'E2E Health Check', passed: false });
  }

  // Test 2: Server Info
  log('\n📋 Test E2E-2: Server Information', colors.blue);
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/',
      method: 'GET',
      timeout: 5000,
    });

    if (response.statusCode === 200 && response.body.server) {
      log(`✅ Server: ${response.body.server}`, colors.green);
      log(`   Version: ${response.body.version}`, colors.green);
      log(`   Transport: ${response.body.transport}`, colors.green);
      tests.push({ name: 'E2E Server Info', passed: true });
    } else {
      throw new Error(`Unexpected response: ${response.statusCode}`);
    }
  } catch (error) {
    log(`❌ Server info failed: ${error.message}`, colors.red);
    tests.push({ name: 'E2E Server Info', passed: false });
  }

  // Test 3: Invalid Request Handling
  log('\n📋 Test E2E-3: Error Handling (Invalid Request)', colors.blue);
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/message',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    }, {});

    if (response.statusCode === 400 && response.body.error === 'Validation Error') {
      log('✅ Error handling works correctly', colors.green);
      log(`   Error details: ${response.body.details.length} validation errors`, colors.green);
      tests.push({ name: 'E2E Error Handling', passed: true });
    } else {
      throw new Error(`Unexpected response: ${response.statusCode}`);
    }
  } catch (error) {
    log(`❌ Error handling test failed: ${error.message}`, colors.red);
    tests.push({ name: 'E2E Error Handling', passed: false });
  }

  const elapsed = Date.now() - startTime;
  const passed = tests.filter(t => t.passed).length;
  const total = tests.length;

  log(`\n📊 E2E Tests: ${passed}/${total} passed (${elapsed}ms)`, 
    passed === total ? colors.green : colors.yellow);

  return { stage: 'E2E', name: 'End-to-End', passed: passed === total };
}

/**
 * Generate detailed test report
 */
function generateReport(results, startTime, endTime) {
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const passRate = ((passed / total) * 100).toFixed(1);

  log('\n\n' + '═'.repeat(70), colors.blue);
  log('  COMPLETE TEST REPORT', colors.blue);
  log('═'.repeat(70), colors.blue);

  log('\n📊 Test Summary:', colors.cyan);
  log(`   Total Stages: ${total}`);
  log(`   Passed: ${passed}`, colors.green);
  log(`   Failed: ${total - passed}`, total - passed > 0 ? colors.red : colors.green);
  log(`   Pass Rate: ${passRate}%`, passed === total ? colors.green : colors.yellow);
  log(`   Duration: ${duration}s`);

  log('\n📋 Detailed Results:', colors.cyan);
  results.forEach((result, index) => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    const color = result.passed ? colors.green : colors.red;
    log(`   ${index + 1}. ${status}: ${result.stage} - ${result.name}`, color);
  });

  log('\n🎯 Coverage:', colors.cyan);
  log('   ✅ Core Framework (Config, Logging, Startup)');
  log('   ✅ MCP Server (Tool Registry, Protocol)');
  log('   ✅ MCP Tools (5 Tools Implementation)');
  log('   ✅ SSE Transport (HTTP, Session)');
  log('   ✅ Authentication & Cache (JWT, L1/L2)');
  log('   ✅ Production Ready (Health, Validation)');
  log('   ✅ End-to-End Integration');

  log('\n📝 Notes:', colors.yellow);
  log('   - Shutdown tests require manual execution');
  log('   - Some tests may require environment setup (Redis, etc.)');

  log('\n' + '═'.repeat(70), colors.blue);
  if (passed === total) {
    log('  🎉 ALL TESTS PASSED - PRODUCTION READY!', colors.green);
  } else {
    log(`  ⚠️  ${total - passed} TEST(S) FAILED - REVIEW REQUIRED`, colors.yellow);
  }
  log('═'.repeat(70), colors.blue);

  return { passed, total, passRate, duration };
}

/**
 * Main test execution
 */
async function runCompleteTestSuite() {
  log('\n' + '═'.repeat(70), colors.blue);
  log('  CSP AI Agent MCP Server - Complete Test Suite', colors.blue);
  log('  Testing All Stages (1-6) + End-to-End Integration', colors.blue);
  log('═'.repeat(70), colors.blue);

  const startTime = Date.now();
  const results = [];

  // Check if server is running
  log('\n🔍 Checking server status...', colors.cyan);
  try {
    const response = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET',
      timeout: 2000,
    });
    log('✅ Server is running', colors.green);
  } catch (error) {
    log('⚠️  Server might not be running. Some tests may fail.', colors.yellow);
    log('   Start server: cd SourceCode && TRANSPORT_MODE=sse npm start', colors.yellow);
  }

  // Run all test suites
  results.push(await testCoreFramework());
  results.push(await testMCPServerBasics());
  results.push(await testMCPTools());
  results.push(await testSSETransport());
  results.push(await testAuthAndCache());
  results.push(await testProductionReady());
  results.push(await testEndToEnd());

  const endTime = Date.now();

  // Generate report
  const summary = generateReport(results, startTime, endTime);

  // Exit with appropriate code
  process.exit(summary.passed === summary.total ? 0 : 1);
}

// Run the complete test suite
runCompleteTestSuite().catch((error) => {
  log(`\n❌ Test suite error: ${error.message}`, colors.red);
  console.error(error);
  process.exit(1);
});
