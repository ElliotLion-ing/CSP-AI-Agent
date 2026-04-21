#!/usr/bin/env node

/**
 * Test: Dual-Layer Rule Sync (v1.6)
 * 
 * Validates that Rule resources are correctly synced to BOTH global and workspace
 * locations when scope='all', and that content comparison is done independently
 * for each location.
 * 
 * Test scenarios:
 *   1. Both locations missing → write to both
 *   2. Global up-to-date, workspace missing → write to workspace only
 *   3. Global outdated, workspace up-to-date → write to global only
 *   4. Both outdated → write to both
 *   5. Both up-to-date → skip both (no writes)
 *   6. Uninstall → delete from both locations
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Test configuration
const MOCK_WORKSPACE = path.join(__dirname, '../Test/mock-workspace-dual-layer');
const GLOBAL_RULES_DIR = path.join(os.homedir(), '.cursor-test', 'rules');
const WORKSPACE_RULES_DIR = path.join(MOCK_WORKSPACE, '.cursor', 'rules');

// Cleanup and setup
function setupTestEnv() {
  // Clean up previous test artifacts
  if (fs.existsSync(MOCK_WORKSPACE)) {
    fs.rmSync(MOCK_WORKSPACE, { recursive: true, force: true });
  }
  if (fs.existsSync(GLOBAL_RULES_DIR)) {
    fs.rmSync(GLOBAL_RULES_DIR, { recursive: true, force: true });
  }
  
  // Create directories
  fs.mkdirSync(GLOBAL_RULES_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_RULES_DIR, { recursive: true });
  
  console.log('[SETUP] Test environment created');
  console.log(`  Global:    ${GLOBAL_RULES_DIR}`);
  console.log(`  Workspace: ${WORKSPACE_RULES_DIR}`);
}

function cleanupTestEnv() {
  if (fs.existsSync(MOCK_WORKSPACE)) {
    fs.rmSync(MOCK_WORKSPACE, { recursive: true, force: true });
  }
  if (fs.existsSync(path.dirname(GLOBAL_RULES_DIR))) {
    fs.rmSync(path.dirname(GLOBAL_RULES_DIR), { recursive: true, force: true });
  }
  console.log('[CLEANUP] Test environment cleaned');
}

// Mock LocalAction executor (simulates AI Agent behavior)
function executeMockLocalActions(actions) {
  const results = [];
  
  for (const action of actions) {
    if (action.action !== 'write_file') {
      results.push({ action: action.action, path: action.path, result: 'skipped' });
      continue;
    }
    
    // Expand path (simplified for test)
    let localPath = action.path;
    if (localPath.startsWith('~/.cursor-test/rules/')) {
      localPath = localPath.replace('~/.cursor-test/rules/', GLOBAL_RULES_DIR + '/');
    } else if (localPath.startsWith('.cursor/rules/')) {
      localPath = path.join(MOCK_WORKSPACE, localPath);
    }
    
    // Content comparison (THE CRITICAL LOGIC)
    if (fs.existsSync(localPath)) {
      const existingContent = fs.readFileSync(localPath, action.encoding || 'utf8');
      if (existingContent === action.content) {
        results.push({ action: 'write_file', path: action.path, result: 'skipped_identical' });
        continue; // ⚠️ Only skip THIS action, must process next action!
      }
    }
    
    // Write file
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, action.content, action.encoding || 'utf8');
    results.push({ action: 'write_file', path: action.path, result: 'written' });
  }
  
  return results;
}

// Test cases
function testScenario1_BothMissing() {
  console.log('\n=== Test 1: Both locations missing ===');
  
  const actions = [
    { action: 'write_file', path: '~/.cursor-test/rules/test-rule.mdc', content: 'version 1.0' },
    { action: 'write_file', path: '.cursor/rules/test-rule.mdc', content: 'version 1.0' },
  ];
  
  const results = executeMockLocalActions(actions);
  
  const globalWritten = results[0].result === 'written';
  const workspaceWritten = results[1].result === 'written';
  
  console.log(`  Global:    ${globalWritten ? '✅ written' : '❌ not written'}`);
  console.log(`  Workspace: ${workspaceWritten ? '✅ written' : '❌ not written'}`);
  
  return globalWritten && workspaceWritten;
}

function testScenario2_GlobalUpdated_WorkspaceMissing() {
  console.log('\n=== Test 2: Global up-to-date, workspace missing ===');
  
  // Setup: global already has v2.0
  const globalPath = path.join(GLOBAL_RULES_DIR, 'test-rule.mdc');
  fs.writeFileSync(globalPath, 'version 2.0');
  
  // Workspace file doesn't exist
  const workspacePath = path.join(WORKSPACE_RULES_DIR, 'test-rule.mdc');
  if (fs.existsSync(workspacePath)) {
    fs.unlinkSync(workspacePath);
  }
  
  // Sync v2.0 from server
  const actions = [
    { action: 'write_file', path: '~/.cursor-test/rules/test-rule.mdc', content: 'version 2.0' },
    { action: 'write_file', path: '.cursor/rules/test-rule.mdc', content: 'version 2.0' },
  ];
  
  const results = executeMockLocalActions(actions);
  
  const globalSkipped = results[0].result === 'skipped_identical';
  const workspaceWritten = results[1].result === 'written';
  
  console.log(`  Global:    ${globalSkipped ? '✅ skipped (already v2.0)' : '❌ unexpected'}`);
  console.log(`  Workspace: ${workspaceWritten ? '✅ written (was missing)' : '❌ not written'}`);
  
  // Verify workspace file exists with correct content
  const workspaceContent = fs.readFileSync(workspacePath, 'utf8');
  const workspaceCorrect = workspaceContent === 'version 2.0';
  console.log(`  Workspace content: ${workspaceCorrect ? '✅ v2.0' : '❌ wrong'}`);
  
  return globalSkipped && workspaceWritten && workspaceCorrect;
}

function testScenario3_GlobalOutdated_WorkspaceUpdated() {
  console.log('\n=== Test 3: Global outdated, workspace up-to-date ===');
  
  // Setup: global has v1.0, workspace has v2.0
  const globalPath = path.join(GLOBAL_RULES_DIR, 'test-rule.mdc');
  const workspacePath = path.join(WORKSPACE_RULES_DIR, 'test-rule.mdc');
  
  fs.writeFileSync(globalPath, 'version 1.0');
  fs.writeFileSync(workspacePath, 'version 2.0');
  
  // Sync v2.0 from server
  const actions = [
    { action: 'write_file', path: '~/.cursor-test/rules/test-rule.mdc', content: 'version 2.0' },
    { action: 'write_file', path: '.cursor/rules/test-rule.mdc', content: 'version 2.0' },
  ];
  
  const results = executeMockLocalActions(actions);
  
  const globalWritten = results[0].result === 'written';
  const workspaceSkipped = results[1].result === 'skipped_identical';
  
  console.log(`  Global:    ${globalWritten ? '✅ written (was v1.0)' : '❌ not updated'}`);
  console.log(`  Workspace: ${workspaceSkipped ? '✅ skipped (already v2.0)' : '❌ unexpected'}`);
  
  // Verify global file updated
  const globalContent = fs.readFileSync(globalPath, 'utf8');
  const globalCorrect = globalContent === 'version 2.0';
  console.log(`  Global content: ${globalCorrect ? '✅ v2.0' : '❌ still v1.0'}`);
  
  return globalWritten && workspaceSkipped && globalCorrect;
}

function testScenario4_BothOutdated() {
  console.log('\n=== Test 4: Both outdated ===');
  
  // Setup: both have v1.0
  const globalPath = path.join(GLOBAL_RULES_DIR, 'test-rule.mdc');
  const workspacePath = path.join(WORKSPACE_RULES_DIR, 'test-rule.mdc');
  
  fs.writeFileSync(globalPath, 'version 1.0');
  fs.writeFileSync(workspacePath, 'version 1.0');
  
  // Sync v2.0 from server
  const actions = [
    { action: 'write_file', path: '~/.cursor-test/rules/test-rule.mdc', content: 'version 2.0' },
    { action: 'write_file', path: '.cursor/rules/test-rule.mdc', content: 'version 2.0' },
  ];
  
  const results = executeMockLocalActions(actions);
  
  const globalWritten = results[0].result === 'written';
  const workspaceWritten = results[1].result === 'written';
  
  console.log(`  Global:    ${globalWritten ? '✅ updated' : '❌ not updated'}`);
  console.log(`  Workspace: ${workspaceWritten ? '✅ updated' : '❌ not updated'}`);
  
  // Verify both files updated
  const globalContent = fs.readFileSync(globalPath, 'utf8');
  const workspaceContent = fs.readFileSync(workspacePath, 'utf8');
  const bothCorrect = globalContent === 'version 2.0' && workspaceContent === 'version 2.0';
  console.log(`  Both content: ${bothCorrect ? '✅ v2.0' : '❌ wrong'}`);
  
  return globalWritten && workspaceWritten && bothCorrect;
}

function testScenario5_BothUpToDate() {
  console.log('\n=== Test 5: Both up-to-date (no writes needed) ===');
  
  // Setup: both already have v2.0
  const globalPath = path.join(GLOBAL_RULES_DIR, 'test-rule.mdc');
  const workspacePath = path.join(WORKSPACE_RULES_DIR, 'test-rule.mdc');
  
  fs.writeFileSync(globalPath, 'version 2.0');
  fs.writeFileSync(workspacePath, 'version 2.0');
  
  // Sync v2.0 from server
  const actions = [
    { action: 'write_file', path: '~/.cursor-test/rules/test-rule.mdc', content: 'version 2.0' },
    { action: 'write_file', path: '.cursor/rules/test-rule.mdc', content: 'version 2.0' },
  ];
  
  const results = executeMockLocalActions(actions);
  
  const globalSkipped = results[0].result === 'skipped_identical';
  const workspaceSkipped = results[1].result === 'skipped_identical';
  
  console.log(`  Global:    ${globalSkipped ? '✅ skipped' : '❌ unexpected write'}`);
  console.log(`  Workspace: ${workspaceSkipped ? '✅ skipped' : '❌ unexpected write'}`);
  
  return globalSkipped && workspaceSkipped;
}

function testScenario6_Uninstall() {
  console.log('\n=== Test 6: Uninstall from both locations ===');
  
  // Setup: both have the rule file
  const globalPath = path.join(GLOBAL_RULES_DIR, 'test-rule.mdc');
  const workspacePath = path.join(WORKSPACE_RULES_DIR, 'test-rule.mdc');
  
  fs.writeFileSync(globalPath, 'version 2.0');
  fs.writeFileSync(workspacePath, 'version 2.0');
  
  // Uninstall actions
  const actions = [
    { action: 'delete_file', path: '~/.cursor-test/rules/test-rule.mdc' },
    { action: 'delete_file', path: '.cursor/rules/test-rule.mdc' },
  ];
  
  // Execute delete
  for (const action of actions) {
    if (action.action !== 'delete_file') continue;
    
    let localPath = action.path;
    if (localPath.startsWith('~/.cursor-test/rules/')) {
      localPath = localPath.replace('~/.cursor-test/rules/', GLOBAL_RULES_DIR + '/');
    } else if (localPath.startsWith('.cursor/rules/')) {
      localPath = path.join(MOCK_WORKSPACE, localPath);
    }
    
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  }
  
  const globalDeleted = !fs.existsSync(globalPath);
  const workspaceDeleted = !fs.existsSync(workspacePath);
  
  console.log(`  Global:    ${globalDeleted ? '✅ deleted' : '❌ still exists'}`);
  console.log(`  Workspace: ${workspaceDeleted ? '✅ deleted' : '❌ still exists'}`);
  
  return globalDeleted && workspaceDeleted;
}

// Main test runner
async function runTests() {
  console.log('🧪 Dual-Layer Rule Sync Test Suite\n');
  
  setupTestEnv();
  
  const results = {
    scenario1: testScenario1_BothMissing(),
    scenario2: testScenario2_GlobalUpdated_WorkspaceMissing(),
    scenario3: testScenario3_GlobalOutdated_WorkspaceUpdated(),
    scenario4: testScenario4_BothOutdated(),
    scenario5: testScenario5_BothUpToDate(),
    scenario6: testScenario6_Uninstall(),
  };
  
  cleanupTestEnv();
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Results Summary:');
  console.log('='.repeat(60));
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  
  Object.entries(results).forEach(([name, pass]) => {
    console.log(`  ${pass ? '✅' : '❌'} ${name.replace('scenario', 'Scenario ')}`);
  });
  
  console.log('='.repeat(60));
  console.log(`Pass Rate: ${passed}/${total} (${Math.round(passed/total*100)}%)`);
  
  if (passed === total) {
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed!');
    process.exit(1);
  }
}

// Run tests
runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
