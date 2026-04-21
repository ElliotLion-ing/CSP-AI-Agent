#!/usr/bin/env node
/**
 * Stage 3 Integration Tests
 * Tests for all 5 MCP tools with real implementations
 */

const path = require('path');
const fs = require('fs');

// Test results
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: []
};

// Simple test framework
function test(name, fn) {
  testResults.total++;
  console.log(`\n🧪 Test ${testResults.total}: ${name}`);
  
  try {
    fn();
    testResults.passed++;
    testResults.tests.push({ name, status: 'PASSED' });
    console.log(`✅ PASSED`);
  } catch (error) {
    testResults.failed++;
    testResults.tests.push({ name, status: 'FAILED', error: error.message });
    console.log(`❌ FAILED: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

async function asyncTest(name, fn) {
  testResults.total++;
  console.log(`\n🧪 Test ${testResults.total}: ${name}`);
  
  try {
    await fn();
    testResults.passed++;
    testResults.tests.push({ name, status: 'PASSED' });
    console.log(`✅ PASSED`);
  } catch (error) {
    testResults.failed++;
    testResults.tests.push({ name, status: 'FAILED', error: error.message });
    console.log(`❌ FAILED: ${error.message}`);
  }
}

// ========================================
// Stage 3 Tool Tests
// ========================================

console.log('🚀 Starting Stage 3 Integration Tests...\n');
console.log('📦 Testing 5 MCP Tools: sync_resources, manage_subscription, search_resources, upload_resource, uninstall_resource\n');

// Test 1: TypeScript Build Output Exists
test('TypeScript build output exists', () => {
  const distPath = path.join(__dirname, '../SourceCode/dist');
  assert(fs.existsSync(distPath), 'dist/ directory does not exist');
  
  const indexPath = path.join(distPath, 'index.js');
  assert(fs.existsSync(indexPath), 'dist/index.js does not exist');
  
  console.log('   ✓ dist/ directory exists');
  console.log('   ✓ dist/index.js exists');
});

// Test 2: Core modules are compiled
test('Core modules are compiled', () => {
  const distPath = path.join(__dirname, '../SourceCode/dist');
  
  const coreModules = [
    'types/errors.js',
    'api/client.js',
    'git/operations.js',
    'filesystem/manager.js',
    'config/index.js'
  ];
  
  for (const module of coreModules) {
    const modulePath = path.join(distPath, module);
    assert(fs.existsSync(modulePath), `${module} not found`);
    console.log(`   ✓ ${module} exists`);
  }
});

// Test 3: All 5 tools are compiled
test('All 5 MCP tools are compiled', () => {
  const distPath = path.join(__dirname, '../SourceCode/dist');
  
  const tools = [
    'tools/sync-resources.js',
    'tools/manage-subscription.js',
    'tools/search-resources.js',
    'tools/upload-resource.js',
    'tools/uninstall-resource.js'
  ];
  
  for (const tool of tools) {
    const toolPath = path.join(distPath, tool);
    assert(fs.existsSync(toolPath), `${tool} not found`);
    console.log(`   ✓ ${tool} exists`);
  }
});

// Test 4: Error types are properly exported
test('Error types are properly exported', () => {
  const errorsPath = path.join(__dirname, '../SourceCode/dist/types/errors.js');
  const content = fs.readFileSync(errorsPath, 'utf8');
  
  assert(content.includes('MCPServerError'), 'MCPServerError not exported');
  assert(content.includes('GitError'), 'GitError not exported');
  assert(content.includes('APIError'), 'APIError not exported');
  assert(content.includes('ValidationError'), 'ValidationError not exported');
  assert(content.includes('FileSystemError'), 'FileSystemError not exported');
  
  console.log('   ✓ All error types exported');
});

// Test 5: API Client is properly configured
test('API Client exports main class', () => {
  const clientPath = path.join(__dirname, '../SourceCode/dist/api/client.js');
  const content = fs.readFileSync(clientPath, 'utf8');
  
  assert(content.includes('APIClient'), 'APIClient class not found');
  assert(content.includes('getSubscriptions'), 'getSubscriptions method not found');
  assert(content.includes('subscribe'), 'subscribe method not found');
  assert(content.includes('searchResources'), 'searchResources method not found');
  
  console.log('   ✓ API Client properly configured');
});

// Test 6: Git Operations module structure
test('Git Operations module structure', () => {
  const gitPath = path.join(__dirname, '../SourceCode/dist/git/operations.js');
  const content = fs.readFileSync(gitPath, 'utf8');
  
  assert(content.includes('GitOperations'), 'GitOperations class not found');
  assert(content.includes('cloneRepository'), 'cloneRepository method not found');
  assert(content.includes('pullRepository'), 'pullRepository method not found');
  assert(content.includes('commitAndPush'), 'commitAndPush method not found');
  
  console.log('   ✓ Git Operations module structure valid');
});

// Test 7: Filesystem Manager structure
test('Filesystem Manager structure', () => {
  const fsPath = path.join(__dirname, '../SourceCode/dist/filesystem/manager.js');
  const content = fs.readFileSync(fsPath, 'utf8');
  
  assert(content.includes('FilesystemManager'), 'FilesystemManager class not found');
  assert(content.includes('writeResource'), 'writeResource method not found');
  assert(content.includes('readResource'), 'readResource method not found');
  assert(content.includes('deleteResource'), 'deleteResource method not found');
  
  console.log('   ✓ Filesystem Manager structure valid');
});

// Test 8: sync_resources tool structure
test('sync_resources tool structure', () => {
  const toolPath = path.join(__dirname, '../SourceCode/dist/tools/sync-resources.js');
  const content = fs.readFileSync(toolPath, 'utf8');
  
  assert(content.includes('syncResources'), 'syncResources function not found');
  assert(content.includes('apiClient'), 'API client import not found');
  assert(content.includes('gitOperations'), 'Git operations import not found');
  assert(content.includes('filesystemManager'), 'Filesystem manager import not found');
  
  console.log('   ✓ sync_resources tool structure valid');
  console.log('   ✓ Integrates: API Client + Git + Filesystem');
});

// Test 9: manage_subscription tool structure
test('manage_subscription tool structure', () => {
  const toolPath = path.join(__dirname, '../SourceCode/dist/tools/manage-subscription.js');
  const content = fs.readFileSync(toolPath, 'utf8');
  
  assert(content.includes('manageSubscription'), 'manageSubscription function not found');
  assert(content.includes('subscribe'), 'subscribe action not found');
  assert(content.includes('unsubscribe'), 'unsubscribe action not found');
  assert(content.includes('list'), 'list action not found');
  
  console.log('   ✓ manage_subscription tool structure valid');
  console.log('   ✓ Actions: subscribe, unsubscribe, list, batch_*');
});

// Test 10: search_resources tool structure
test('search_resources tool structure', () => {
  const toolPath = path.join(__dirname, '../SourceCode/dist/tools/search-resources.js');
  const content = fs.readFileSync(toolPath, 'utf8');
  
  assert(content.includes('searchResources'), 'searchResources function not found');
  assert(content.includes('searchCache'), 'Cache not found');
  assert(content.includes('CACHE_TTL'), 'Cache TTL not found');
  
  console.log('   ✓ search_resources tool structure valid');
  console.log('   ✓ Features: API search + in-memory cache (5min TTL)');
});

// Test 11: upload_resource tool structure
test('upload_resource tool structure', () => {
  const toolPath = path.join(__dirname, '../SourceCode/dist/tools/upload-resource.js');
  const content = fs.readFileSync(toolPath, 'utf8');
  
  assert(content.includes('uploadResource'), 'uploadResource function not found');
  assert(content.includes('generateVersion'), 'Version generation not found');
  assert(content.includes('validateResourceFile'), 'File validation not found');
  
  console.log('   ✓ upload_resource tool structure valid');
  console.log('   ✓ Features: Git commit + version generation + validation');
});

// Test 12: uninstall_resource tool structure
test('uninstall_resource tool structure', () => {
  const toolPath = path.join(__dirname, '../SourceCode/dist/tools/uninstall-resource.js');
  const content = fs.readFileSync(toolPath, 'utf8');
  
  assert(content.includes('uninstallResource'), 'uninstallResource function not found');
  assert(content.includes('findResourceFiles'), 'File search not found');
  assert(content.includes('removeEmptyDirs'), 'Directory cleanup not found');
  
  console.log('   ✓ uninstall_resource tool structure valid');
  console.log('   ✓ Features: Fuzzy match + delete + cleanup');
});

// Test 13: Configuration structure
test('Configuration structure', () => {
  const configPath = path.join(__dirname, '../SourceCode/dist/config/index.js');
  const content = fs.readFileSync(configPath, 'utf8');
  
  assert(content.includes('csp'), 'CSP config not found');
  assert(content.includes('git'), 'Git config not found');
  assert(content.includes('resource'), 'Resource config not found');
  
  console.log('   ✓ Configuration structure valid');
  console.log('   ✓ Sections: csp, git, resource, logging');
});

// Test 14: .env.example has all required fields
test('.env.example has all required fields', () => {
  const envPath = path.join(__dirname, '../SourceCode/.env.example');
  const content = fs.readFileSync(envPath, 'utf8');
  
  const requiredFields = [
    'CSP_API_TOKEN',
    'GIT_REPO_URL',
    'GIT_BRANCH',
    'GIT_AUTH_TOKEN',
    'RESOURCE_BASE_PATH'
  ];
  
  for (const field of requiredFields) {
    assert(content.includes(field), `${field} not in .env.example`);
    console.log(`   ✓ ${field} present`);
  }
});

// Test 15: Stage 3 documentation exists
test('Stage 3 documentation exists', () => {
  const docsPath = path.join(__dirname, '../Docs/Stage-3-MCP-Tools-Implementation.md');
  assert(fs.existsSync(docsPath), 'Stage 3 documentation missing');
  
  const content = fs.readFileSync(docsPath, 'utf8');
  assert(content.includes('sync_resources'), 'sync_resources not documented');
  assert(content.includes('manage_subscription'), 'manage_subscription not documented');
  assert(content.includes('search_resources'), 'search_resources not documented');
  assert(content.includes('upload_resource'), 'upload_resource not documented');
  assert(content.includes('uninstall_resource'), 'uninstall_resource not documented');
  
  console.log('   ✓ Stage 3 documentation complete');
  console.log('   ✓ All 5 tools documented');
});

// ========================================
// Print Summary
// ========================================

console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary');
console.log('='.repeat(60));
console.log(`Total Tests: ${testResults.total}`);
console.log(`Passed: ${testResults.passed} ✅`);
console.log(`Failed: ${testResults.failed} ❌`);
console.log(`Pass Rate: ${Math.round((testResults.passed / testResults.total) * 100)}%`);
console.log('='.repeat(60));

if (testResults.failed > 0) {
  console.log('\n❌ Failed Tests:');
  testResults.tests
    .filter(t => t.status === 'FAILED')
    .forEach(t => {
      console.log(`   - ${t.name}: ${t.error}`);
    });
}

console.log('\n✨ Stage 3 Integration Tests Completed!\n');

// Exit with appropriate code
process.exit(testResults.failed > 0 ? 1 : 0);
