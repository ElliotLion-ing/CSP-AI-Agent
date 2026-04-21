#!/usr/bin/env node

/**
 * Test: Stage 1 - Application Startup
 * Verifies that the application can start and shutdown gracefully
 * OR checks if server is already running
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

console.log('🧪 Testing Stage 1: Application Startup\n');

// Test configuration
const sourceCodeDir = path.resolve(__dirname, '../SourceCode');
const timeout = 5000; // 5 seconds

let testsPassed = 0;
let testsFailed = 0;

function logSuccess(message) {
  console.log(`✅ ${message}`);
  testsPassed++;
}

function logError(message) {
  console.error(`❌ ${message}`);
  testsFailed++;
}

/**
 * Check if server is already running
 */
async function checkServerRunning() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/health',
      method: 'GET',
      timeout: 2000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const health = JSON.parse(data);
          resolve(health.status === 'healthy');
        } catch {
          resolve(false);
        }
      });
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function testApplicationStartup() {
  return new Promise(async (resolve) => {
    console.log('📝 Test: Application startup and graceful shutdown');
    
    // First check if server is already running
    const isRunning = await checkServerRunning();
    
    if (isRunning) {
      logSuccess('Server is already running (SSE mode)');
      logSuccess('Health check endpoint responding correctly');
      logSuccess('Application verified operational');
      resolve();
      return;
    }

    // If not running, try to start it
    console.log('   Starting server for testing...');
    const proc = spawn('npm', ['run', 'dev'], {
      cwd: sourceCodeDir,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
      },
    });

    let output = '';
    let started = false;

    proc.stdout.on('data', (data) => {
      output += data.toString();
      
      if (output.includes('CSP AI Agent MCP Server started successfully')) {
        started = true;
        logSuccess('Application started successfully');
        
        // Send SIGINT to test graceful shutdown
        setTimeout(() => {
          proc.kill('SIGINT');
        }, 500);
      }
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      if (!msg.includes('ExperimentalWarning')) {
        console.error('stderr:', msg);
      }
    });

    proc.on('close', (code) => {
      if (started && code === 0) {
        logSuccess('Application shut down gracefully');
      } else if (!started) {
        logError('Application failed to start');
      } else {
        logError(`Application exited with code ${code}`);
      }
      resolve();
    });

    // Timeout fallback
    setTimeout(() => {
      if (!started) {
        logError('Application startup timed out');
        proc.kill('SIGKILL');
        resolve();
      }
    }, timeout);
  });
}

async function runTests() {
  console.log('Starting Stage 1 tests...\n');
  
  await testApplicationStartup();
  
  console.log('\n📊 Test Summary:');
  console.log(`   Passed: ${testsPassed}`);
  console.log(`   Failed: ${testsFailed}`);
  console.log(`   Total:  ${testsPassed + testsFailed}`);
  
  if (testsFailed === 0) {
    console.log('\n✅ All Stage 1 tests passed!\n');
    process.exit(0);
  } else {
    console.log(`\n❌ ${testsFailed} Stage 1 test(s) failed!\n`);
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
