#!/usr/bin/env node

/**
 * Stage 4 Integration Test
 * 
 * Validates Stage 4 implementation:
 * - File structure
 * - Configuration
 * - TypeScript compilation
 * - Module exports
 * - Documentation
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SOURCE_ROOT = path.join(PROJECT_ROOT, 'SourceCode');
const DOCS_ROOT = path.join(PROJECT_ROOT, 'Docs');
const TEST_ROOT = path.join(PROJECT_ROOT, 'Test');

let testResults = {
  passed: 0,
  failed: 0,
  total: 0
};

function logTest(name, passed, message) {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ Test ${testResults.total}: ${name} - PASSED`);
  } else {
    testResults.failed++;
    console.error(`❌ Test ${testResults.total}: ${name} - FAILED`);
    if (message) console.error(`   ${message}`);
  }
}

// Test 1: File structure
function testFileStructure() {
  const requiredFiles = [
    'SourceCode/src/server/http.ts',
    'SourceCode/src/session/manager.ts',
    'SourceCode/src/transport/sse.ts',
    'SourceCode/src/server.ts',
    'SourceCode/src/config/index.ts',
    'SourceCode/src/tools/registry.ts',
    'SourceCode/.env.example',
    'SourceCode/.env'
  ];
  
  for (const file of requiredFiles) {
    const filePath = path.join(PROJECT_ROOT, file);
    const exists = fs.existsSync(filePath);
    logTest(`File exists: ${file}`, exists, exists ? '' : 'File not found');
  }
}

// Test 2: Configuration files
function testConfiguration() {
  // Check .env.example
  const envExamplePath = path.join(SOURCE_ROOT, '.env.example');
  const envExample = fs.readFileSync(envExamplePath, 'utf8');
  
  const requiredVars = [
    'TRANSPORT_MODE',
    'HTTP_HOST',
    'HTTP_PORT',
    'SESSION_TIMEOUT',
    'CSP_API_TOKEN'
  ];
  
  for (const varName of requiredVars) {
    const exists = envExample.includes(varName);
    logTest(`Config var: ${varName}`, exists, exists ? '' : 'Variable not found in .env.example');
  }
  
  // Check .env
  const envPath = path.join(SOURCE_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    const hasSSE = env.includes('TRANSPORT_MODE=sse');
    logTest('.env has SSE mode', hasSSE, hasSSE ? '' : 'TRANSPORT_MODE should be set to sse');
  }
}

// Test 3: TypeScript compilation output
function testCompilationOutput() {
  const distPath = path.join(SOURCE_ROOT, 'dist');
  const distExists = fs.existsSync(distPath);
  logTest('dist directory exists', distExists, distExists ? '' : 'Run npm run build first');
  
  if (!distExists) return;
  
  const requiredOutputFiles = [
    'index.js',
    'server.js',
    'server/http.js',
    'session/manager.js',
    'transport/sse.js',
    'config/index.js',
    'tools/registry.js'
  ];
  
  for (const file of requiredOutputFiles) {
    const filePath = path.join(distPath, file);
    const exists = fs.existsSync(filePath);
    logTest(`Compiled: ${file}`, exists, exists ? '' : 'Compilation output missing');
  }
}

// Test 4: Module exports
function testModuleExports() {
  const distPath = path.join(SOURCE_ROOT, 'dist');
  if (!fs.existsSync(distPath)) {
    logTest('Module exports', false, 'dist directory not found');
    return;
  }
  
  try {
    // Test HTTP server exports
    const httpModule = require(path.join(distPath, 'server/http.js'));
    const hasHTTPServer = httpModule.httpServer && typeof httpModule.httpServer.start === 'function';
    logTest('HTTP Server export', hasHTTPServer, 
      hasHTTPServer ? '' : 'httpServer singleton not exported');
    
    // Test Session Manager exports
    const sessionModule = require(path.join(distPath, 'session/manager.js'));
    const hasSessionManager = typeof sessionModule.SessionManager === 'function';
    logTest('Session Manager export', hasSessionManager, 
      hasSessionManager ? '' : 'SessionManager class not exported');
    
    // Test SSE Transport exports
    const sseModule = require(path.join(distPath, 'transport/sse.js'));
    const hasSSETransport = typeof sseModule.SSETransport === 'function';
    logTest('SSE Transport export', hasSSETransport, 
      hasSSETransport ? '' : 'SSETransport class not exported');
    
  } catch (err) {
    logTest('Module exports', false, `Import error: ${err.message}`);
  }
}

// Test 5: Package dependencies
function testDependencies() {
  const packagePath = path.join(SOURCE_ROOT, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  
  const requiredDeps = ['fastify', '@fastify/cors', '@fastify/helmet'];
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  
  for (const dep of requiredDeps) {
    const exists = dep in deps;
    logTest(`Dependency: ${dep}`, exists, exists ? '' : 'Package not in dependencies');
  }
}

// Test 6: Documentation
function testDocumentation() {
  // Check README.md mentions Stage 4
  const readmePath = path.join(PROJECT_ROOT, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, 'utf8');
    const mentionsSSE = readme.includes('SSE') || readme.includes('Server-Sent Events');
    const mentionsHTTP = readme.includes('HTTP Server') || readme.includes('Fastify');
    
    logTest('README mentions SSE', mentionsSSE, mentionsSSE ? '' : 'README should mention SSE transport');
    logTest('README mentions HTTP Server', mentionsHTTP, mentionsHTTP ? '' : 'README should mention HTTP Server');
  }
  
  // Check for Stage 4 documentation
  const stage4DocPath = path.join(DOCS_ROOT, 'Stage-4-SSE-HTTP-Server.md');
  const stage4DocExists = fs.existsSync(stage4DocPath);
  logTest('Stage 4 documentation exists', stage4DocExists, 
    stage4DocExists ? '' : 'Docs/Stage-4-SSE-HTTP-Server.md should be created');
}

// Test 7: Test files
function testTestFiles() {
  const requiredTests = [
    'Test/test-stage4-integration.js',
    'Test/test-stage4-sse-local.js',
    'Test/nginx-sse-proxy.conf'
  ];
  
  for (const file of requiredTests) {
    const filePath = path.join(PROJECT_ROOT, file);
    const exists = fs.existsSync(filePath);
    logTest(`Test file: ${file}`, exists, exists ? '' : 'Test file not found');
  }
}

// Test 8: Config interface validation
function testConfigInterface() {
  const configPath = path.join(SOURCE_ROOT, 'src/config/index.ts');
  const configSource = fs.readFileSync(configPath, 'utf8');
  
  const hasTransportMode = configSource.includes('transport') && 
                          (configSource.includes("'stdio'") || configSource.includes("'sse'"));
  const hasHTTPConfig = configSource.includes('http') && configSource.includes('host') && 
                       configSource.includes('port');
  const hasSessionConfig = configSource.includes('session') && configSource.includes('timeout');
  
  logTest('Config has transport mode', hasTransportMode, 
    hasTransportMode ? '' : 'Config should define transport mode');
  logTest('Config has HTTP settings', hasHTTPConfig, 
    hasHTTPConfig ? '' : 'Config should define http host/port');
  logTest('Config has session timeout', hasSessionConfig, 
    hasSessionConfig ? '' : 'Config should define session timeout');
}

// Test 9: Server.ts dual transport
function testDualTransport() {
  const serverPath = path.join(SOURCE_ROOT, 'src/server.ts');
  const serverSource = fs.readFileSync(serverPath, 'utf8');
  
  const hasSSEMode = serverSource.includes('sse') && 
                     (serverSource.includes('startSSEServer') || serverSource.includes('httpServer'));
  const hasStdioMode = serverSource.includes('stdio');
  const hasModeCheck = serverSource.includes('transport.mode') || 
                       serverSource.includes('TRANSPORT_MODE');
  
  logTest('Server supports SSE mode', hasSSEMode, 
    hasSSEMode ? '' : 'Server should support SSE transport');
  logTest('Server supports stdio mode', hasStdioMode, 
    hasStdioMode ? '' : 'Server should support stdio transport');
  logTest('Server checks transport mode', hasModeCheck, 
    hasModeCheck ? '' : 'Server should check TRANSPORT_MODE');
}

// Main test runner
function runTests() {
  console.log('🚀 Starting Stage 4 Integration Tests...\n');
  
  testFileStructure();
  testConfiguration();
  testCompilationOutput();
  testModuleExports();
  testDependencies();
  testDocumentation();
  testTestFiles();
  testConfigInterface();
  testDualTransport();
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Test Summary: ${testResults.passed}/${testResults.total} passed`);
  const passRate = ((testResults.passed / testResults.total) * 100).toFixed(1);
  console.log(`📈 Pass Rate: ${passRate}%`);
  console.log('='.repeat(60));
  
  if (testResults.failed > 0) {
    console.log(`\n❌ ${testResults.failed} test(s) failed`);
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

// Run tests
try {
  runTests();
} catch (err) {
  console.error('\n❌ Test runner error:', err);
  process.exit(1);
}
