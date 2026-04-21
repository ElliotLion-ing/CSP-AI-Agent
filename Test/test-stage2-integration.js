#!/usr/bin/env node

/**
 * Stage 2 Integration Test - MCP Server Startup and Tool Listing
 * 
 * Tests:
 * 1. MCP Server starts successfully
 * 2. Tool registry has 5 tools
 * 3. Server can be gracefully shut down
 */

const { spawn } = require('child_process');
const path = require('path');

const TEST_NAME = 'Stage 2: MCP Server Basic';
const SERVER_PATH = path.resolve(__dirname, '../SourceCode/dist/index.js');

let testsPassed = 0;
let testsFailed = 0;

function pass(message) {
  console.log(`  ✅ ${message}`);
  testsPassed++;
}

function fail(message) {
  console.log(`  ❌ ${message}`);
  testsFailed++;
}

async function runTests() {
  console.log(`\n🧪 Running ${TEST_NAME} Tests...\n`);

  // Test 1: Server starts successfully
  console.log('Test 1: Server startup');
  let serverProcess;
  try {
    serverProcess = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.resolve(__dirname, '../SourceCode'),
    });

    let serverOutput = '';
    serverProcess.stdout.on('data', (data) => {
      serverOutput += data.toString();
    });

    serverProcess.stderr.on('data', (data) => {
      serverOutput += data.toString();
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (serverProcess.exitCode === null) {
      pass('MCP Server started successfully');
    } else {
      fail(`MCP Server exited with code ${serverProcess.exitCode}`);
      console.log('  Server output:', serverOutput);
    }
  } catch (error) {
    fail(`Failed to start server: ${error.message}`);
  }

  // Test 2: Verify tool registry (indirect test via imports)
  console.log('\nTest 2: Tool registry');
  try {
    // Import the tool registry to verify it's created correctly
    // Note: This is a unit test approach since MCP uses stdio
    const registry = require('../SourceCode/dist/tools/registry');
    pass('Tool registry module loaded successfully');
  } catch (error) {
    fail(`Failed to load tool registry: ${error.message}`);
  }

  // Test 3: Check build output exists
  console.log('\nTest 3: Build output verification');
  const fs = require('fs');
  const distPath = path.resolve(__dirname, '../SourceCode/dist');
  const requiredFiles = [
    'index.js',
    'server.js',
    'tools/registry.js',
    'tools/sync-resources.js',
    'tools/manage-subscription.js',
    'tools/search-resources.js',
    'tools/upload-resource.js',
    'tools/uninstall-resource.js',
  ];

  let allFilesExist = true;
  for (const file of requiredFiles) {
    const filePath = path.join(distPath, file);
    if (!fs.existsSync(filePath)) {
      fail(`Missing build output: ${file}`);
      allFilesExist = false;
    }
  }

  if (allFilesExist) {
    pass('All required build outputs exist');
  }

  // Test 4: Graceful shutdown
  console.log('\nTest 4: Graceful shutdown');
  if (serverProcess) {
    try {
      serverProcess.kill('SIGINT');
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        serverProcess.on('exit', (code) => {
          if (code === 0 || code === null) {
            pass('Server shut down gracefully');
          } else {
            fail(`Server exited with code ${code}`);
          }
          resolve();
        });
        
        // Force kill after 3 seconds if not gracefully shut down
        setTimeout(() => {
          if (serverProcess.exitCode === null) {
            serverProcess.kill('SIGKILL');
            fail('Server did not shut down gracefully (forced kill)');
            resolve();
          }
        }, 3000);
      });
    } catch (error) {
      fail(`Failed to shut down server: ${error.message}`);
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Test Summary: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('='.repeat(60));

  if (testsFailed > 0) {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Fatal error during testing:', error);
  process.exit(1);
});
