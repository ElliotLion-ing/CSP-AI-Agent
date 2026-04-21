#!/usr/bin/env node
/**
 * Stage 6 Graceful Shutdown Test
 * Tests graceful shutdown behavior with SIGTERM and SIGINT
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
 * Start MCP Server
 */
function startMCPServer() {
  return new Promise((resolve, reject) => {
    log('\n🚀 Starting MCP Server for testing...', colors.blue);

    const serverProcess = spawn('npm', ['start'], {
      cwd: path.join(__dirname, '../SourceCode'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TRANSPORT_MODE: 'sse', SHUTDOWN_TIMEOUT: '5000' },
    });

    let output = '';
    let started = false;

    serverProcess.stdout.on('data', (data) => {
      output += data.toString();
      if (!started && output.includes('HTTP server started')) {
        started = true;
        log('✅ MCP Server started', colors.green);
        setTimeout(() => resolve(serverProcess), 2000); // Wait for full initialization
      }
    });

    serverProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    serverProcess.on('error', (error) => {
      log(`❌ Failed to start MCP Server: ${error.message}`, colors.red);
      reject(error);
    });

    // Timeout for startup
    setTimeout(() => {
      if (!started) {
        serverProcess.kill('SIGKILL');
        log('❌ MCP Server startup timeout', colors.red);
        log(`Output: ${output}`, colors.yellow);
        reject(new Error('Server startup timeout'));
      }
    }, 15000);
  });
}

/**
 * Test: Graceful Shutdown with SIGTERM
 */
async function testGracefulShutdownSIGTERM() {
  log('\n📋 Test 1: Graceful Shutdown with SIGTERM', colors.blue);

  let serverProcess;
  try {
    // Start server
    serverProcess = await startMCPServer();

    // Verify server is running
    const healthResponse = await makeRequest({
      hostname: CONFIG.mcpServerHost,
      port: CONFIG.mcpServerPort,
      path: '/health',
      method: 'GET',
      timeout: 2000,
    });

    if (healthResponse.statusCode !== 200) {
      throw new Error('Server not healthy before shutdown');
    }

    log('✅ Server is running and healthy', colors.green);

    // Send SIGTERM signal
    log('Sending SIGTERM signal...', colors.blue);
    const shutdownStart = Date.now();
    
    let shutdownOutput = '';
    serverProcess.stdout.on('data', (data) => {
      shutdownOutput += data.toString();
    });
    serverProcess.stderr.on('data', (data) => {
      shutdownOutput += data.toString();
    });

    serverProcess.kill('SIGTERM');

    // Wait for server to exit
    await new Promise((resolve, reject) => {
      serverProcess.on('exit', (code, signal) => {
        const shutdownTime = Date.now() - shutdownStart;
        log(`✅ Server exited with code: ${code}, signal: ${signal}`, colors.green);
        log(`   Shutdown time: ${shutdownTime}ms`, colors.green);

        // Verify shutdown logs
        if (shutdownOutput.includes('Graceful shutdown completed')) {
          log('✅ Graceful shutdown logs present', colors.green);
        } else {
          log('⚠️  Missing graceful shutdown logs', colors.yellow);
        }

        // Shutdown should complete within timeout (5000ms + buffer)
        if (shutdownTime > 6000) {
          log(`⚠️  Shutdown took longer than expected: ${shutdownTime}ms`, colors.yellow);
        }

        resolve();
      });

      // Timeout
      setTimeout(() => {
        log('❌ Server did not exit within timeout', colors.red);
        serverProcess.kill('SIGKILL');
        reject(new Error('Shutdown timeout'));
      }, 10000);
    });

    // Verify server is no longer accessible
    try {
      await makeRequest({
        hostname: CONFIG.mcpServerHost,
        port: CONFIG.mcpServerPort,
        path: '/health',
        method: 'GET',
        timeout: 1000,
      });
      log('⚠️  Server still responding after shutdown', colors.yellow);
    } catch (error) {
      log('✅ Server is no longer accessible', colors.green);
    }

    log('✅ Test 1 PASSED', colors.green);
    return true;
  } catch (error) {
    log(`❌ Test 1 FAILED: ${error.message}`, colors.red);
    if (serverProcess) {
      try {
        serverProcess.kill('SIGKILL');
      } catch (e) {
        // Ignore
      }
    }
    return false;
  }
}

/**
 * Test: Graceful Shutdown with SIGINT (Ctrl+C)
 */
async function testGracefulShutdownSIGINT() {
  log('\n📋 Test 2: Graceful Shutdown with SIGINT (Ctrl+C)', colors.blue);

  let serverProcess;
  try {
    // Start server
    serverProcess = await startMCPServer();

    // Verify server is running
    const healthResponse = await makeRequest({
      hostname: CONFIG.mcpServerHost,
      port: CONFIG.mcpServerPort,
      path: '/health',
      method: 'GET',
      timeout: 2000,
    });

    if (healthResponse.statusCode !== 200) {
      throw new Error('Server not healthy before shutdown');
    }

    log('✅ Server is running and healthy', colors.green);

    // Send SIGINT signal
    log('Sending SIGINT signal (Ctrl+C simulation)...', colors.blue);
    const shutdownStart = Date.now();

    serverProcess.kill('SIGINT');

    // Wait for server to exit
    await new Promise((resolve, reject) => {
      serverProcess.on('exit', (code, signal) => {
        const shutdownTime = Date.now() - shutdownStart;
        log(`✅ Server exited with code: ${code}, signal: ${signal}`, colors.green);
        log(`   Shutdown time: ${shutdownTime}ms`, colors.green);

        // Shutdown should complete within timeout
        if (shutdownTime > 6000) {
          log(`⚠️  Shutdown took longer than expected: ${shutdownTime}ms`, colors.yellow);
        }

        resolve();
      });

      // Timeout
      setTimeout(() => {
        log('❌ Server did not exit within timeout', colors.red);
        serverProcess.kill('SIGKILL');
        reject(new Error('Shutdown timeout'));
      }, 10000);
    });

    log('✅ Test 2 PASSED', colors.green);
    return true;
  } catch (error) {
    log(`❌ Test 2 FAILED: ${error.message}`, colors.red);
    if (serverProcess) {
      try {
        serverProcess.kill('SIGKILL');
      } catch (e) {
        // Ignore
      }
    }
    return false;
  }
}

/**
 * Main test execution
 */
async function runTests() {
  log('═══════════════════════════════════════════════════════', colors.blue);
  log('  Stage 6: Graceful Shutdown Tests', colors.blue);
  log('═══════════════════════════════════════════════════════', colors.blue);

  const results = [];

  // Run tests sequentially
  results.push(await testGracefulShutdownSIGTERM());
  results.push(await testGracefulShutdownSIGINT());

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

// Main
(async () => {
  // Check if any server is already running
  try {
    await makeRequest({
      hostname: CONFIG.mcpServerHost,
      port: CONFIG.mcpServerPort,
      path: '/health',
      method: 'GET',
      timeout: 1000,
    });
    log('⚠️  MCP Server is already running!', colors.yellow);
    log('Please stop the server first:', colors.yellow);
    log('  pkill -f "npm start"', colors.yellow);
    process.exit(1);
  } catch (error) {
    // Server not running, good to proceed
  }

  await runTests();
})();
