#!/usr/bin/env node

/**
 * Stage 5 Integration Test
 * Tests authentication, permissions, and caching
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SOURCE_ROOT = path.join(PROJECT_ROOT, 'SourceCode');

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
    'SourceCode/src/auth/token-validator.ts',
    'SourceCode/src/auth/permissions.ts',
    'SourceCode/src/auth/middleware.ts',
    'SourceCode/src/auth/index.ts',
    'SourceCode/src/cache/redis-client.ts',
    'SourceCode/src/cache/cache-manager.ts',
    'SourceCode/src/cache/index.ts',
    'SourceCode/src/api/cached-client.ts',
  ];
  
  for (const file of requiredFiles) {
    const filePath = path.join(PROJECT_ROOT, file);
    const exists = fs.existsSync(filePath);
    logTest(`File exists: ${file}`, exists, exists ? '' : 'File not found');
  }
}

// Test 2: Dependencies
function testDependencies() {
  const packagePath = path.join(SOURCE_ROOT, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  
  const requiredDeps = [
    'ioredis',
    'lru-cache',
  ];
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  
  for (const dep of requiredDeps) {
    const exists = dep in deps;
    logTest(`Dependency: ${dep}`, exists, exists ? '' : 'Package not in dependencies');
  }
  
  // Verify jsonwebtoken is removed
  const hasJsonWebToken = 'jsonwebtoken' in deps;
  logTest('jsonwebtoken removed', !hasJsonWebToken, 
    hasJsonWebToken ? 'jsonwebtoken should be removed (no longer used)' : '');
}

// Test 3: Configuration
function testConfiguration() {
  const envExamplePath = path.join(SOURCE_ROOT, '.env.example');
  const envExample = fs.readFileSync(envExamplePath, 'utf8');
  
  const requiredVars = [
    'CSP_API_TOKEN',
    'CSP_API_BASE_URL',
    'REDIS_URL',
    'ENABLE_CACHE',
  ];
  
  for (const varName of requiredVars) {
    const exists = envExample.includes(varName);
    logTest(`Config var: ${varName}`, exists, exists ? '' : 'Variable not found in .env.example');
  }
}

// Test 4: Compilation output
function testCompilationOutput() {
  const distPath = path.join(SOURCE_ROOT, 'dist');
  const distExists = fs.existsSync(distPath);
  logTest('dist directory exists', distExists, distExists ? '' : 'Run npm run build first');
  
  if (!distExists) return;
  
  const requiredOutputFiles = [
    'auth/token-validator.js',
    'auth/permissions.js',
    'auth/middleware.js',
    'cache/redis-client.js',
    'cache/cache-manager.js',
    'api/cached-client.js',
  ];
  
  for (const file of requiredOutputFiles) {
    const filePath = path.join(distPath, file);
    const exists = fs.existsSync(filePath);
    logTest(`Compiled: ${file}`, exists, exists ? '' : 'Compilation output missing');
  }
}

// Test 5: Module exports
function testModuleExports() {
  const distPath = path.join(SOURCE_ROOT, 'dist');
  if (!fs.existsSync(distPath)) {
    logTest('Module exports', false, 'dist directory not found');
    return;
  }
  
  try {
    // Test token-validator exports
    const tokenValidatorModule = require(path.join(distPath, 'auth/token-validator.js'));
    const hasVerifyToken = typeof tokenValidatorModule.verifyToken === 'function';
    logTest('Token validator exports', hasVerifyToken, 
      hasVerifyToken ? '' : 'verifyToken function not exported');
    
    // Test permissions exports
    const permModule = require(path.join(distPath, 'auth/permissions.js'));
    const hasCheckPermission = typeof permModule.checkPermission === 'function';
    logTest('Permissions export', hasCheckPermission, 
      hasCheckPermission ? '' : 'checkPermission function not exported');
    
    // Test Redis client exports
    const redisModule = require(path.join(distPath, 'cache/redis-client.js'));
    const hasRedisClient = typeof redisModule.RedisClient === 'function';
    logTest('Redis client export', hasRedisClient, 
      hasRedisClient ? '' : 'RedisClient class not exported');
    
    // Test cache manager exports
    const cacheModule = require(path.join(distPath, 'cache/cache-manager.js'));
    const hasCacheManager = typeof cacheModule.CacheManager === 'function';
    logTest('Cache manager export', hasCacheManager, 
      hasCacheManager ? '' : 'CacheManager class not exported');
    
  } catch (err) {
    logTest('Module exports', false, `Import error: ${err.message}`);
  }
}

// Test 6: Updated HTTP server
function testHTTPServerUpdates() {
  const httpPath = path.join(SOURCE_ROOT, 'src/server/http.ts');
  const httpSource = fs.readFileSync(httpPath, 'utf8');
  
  const hasJWTImport = httpSource.includes('jwtAuth') || httpSource.includes('../auth');
  const hasPreHandler = httpSource.includes('preHandler');
  
  logTest('HTTP server has JWT auth', hasJWTImport, 
    hasJWTImport ? '' : 'HTTP server should import JWT auth');
  logTest('HTTP server has preHandler', hasPreHandler, 
    hasPreHandler ? '' : 'SSE endpoint should have preHandler');
}

// Test 7: SSE transport permissions
function testSSETransportPermissions() {
  const ssePath = path.join(SOURCE_ROOT, 'src/transport/sse.ts');
  const sseSource = fs.readFileSync(ssePath, 'utf8');
  
  const hasPermissionCheck = sseSource.includes('checkToolCallPermission') || 
                             sseSource.includes('checkPermission');
  
  logTest('SSE transport has permission check', hasPermissionCheck, 
    hasPermissionCheck ? '' : 'SSE transport should check permissions');
}

// Test 8: Session manager updates
function testSessionManagerUpdates() {
  const sessionPath = path.join(SOURCE_ROOT, 'src/session/manager.ts');
  const sessionSource = fs.readFileSync(sessionPath, 'utf8');
  
  const hasGroups = sessionSource.includes('groups');
  const hasUserId = sessionSource.includes('userId');
  const hasEmail = sessionSource.includes('email');
  
  logTest('Session has groups field', hasGroups, 
    hasGroups ? '' : 'Session should have groups field (not roles)');
  logTest('Session has userId field', hasUserId, 
    hasUserId ? '' : 'Session should have userId field');
  logTest('Session has email field', hasEmail, 
    hasEmail ? '' : 'Session should have email field');
}

// Main test runner
function runTests() {
  console.log('🚀 Starting Stage 5 Integration Tests...\n');
  
  testFileStructure();
  testDependencies();
  testConfiguration();
  testCompilationOutput();
  testModuleExports();
  testHTTPServerUpdates();
  testSSETransportPermissions();
  testSessionManagerUpdates();
  
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
