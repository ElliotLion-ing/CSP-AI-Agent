#!/usr/bin/env node
/**
 * Stage 6 Complete Test Suite
 * Runs all Stage 6 tests: Health Check, Shutdown, Validation
 */

const { spawn } = require('child_process');
const path = require('path');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

/**
 * Run a test script
 */
function runTest(scriptName) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, scriptName);
    
    log(`\n${'='.repeat(60)}`, colors.cyan);
    log(`  Running: ${scriptName}`, colors.cyan);
    log('='.repeat(60), colors.cyan);

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
 * Main test execution
 */
async function runAllTests() {
  log('\n' + '='.repeat(60), colors.blue);
  log('  Stage 6: Complete Test Suite', colors.blue);
  log('='.repeat(60), colors.blue);

  const tests = [
    'test-stage6-health.js',      // Health check tests
    'test-stage6-validation.js',  // Request validation tests
    // Shutdown tests are manual (require server restart)
  ];

  const results = [];

  for (const test of tests) {
    const result = await runTest(test);
    results.push({ test, passed: result });
  }

  // Summary
  log('\n' + '='.repeat(60), colors.blue);
  log('  Test Summary', colors.blue);
  log('='.repeat(60), colors.blue);

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const passRate = ((passed / total) * 100).toFixed(1);

  results.forEach(({ test, passed }) => {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    const color = passed ? colors.green : colors.red;
    log(`  ${status}: ${test}`, color);
  });

  log('\n' + '='.repeat(60), colors.blue);
  if (passed === total) {
    log(`  ✅ All tests passed! (${passed}/${total}, ${passRate}%)`, colors.green);
  } else {
    log(`  ⚠️  Some tests failed (${passed}/${total}, ${passRate}%)`, colors.yellow);
  }
  log('='.repeat(60), colors.blue);

  log('\n📝 Note: Shutdown tests must be run manually:', colors.yellow);
  log('   cd Test && node test-stage6-shutdown.js', colors.yellow);

  process.exit(passed === total ? 0 : 1);
}

// Run all tests
runAllTests().catch((error) => {
  log(`\n❌ Test suite error: ${error.message}`, colors.red);
  process.exit(1);
});
