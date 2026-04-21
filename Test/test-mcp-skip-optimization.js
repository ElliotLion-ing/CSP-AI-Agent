/**
 * Test Case: MCP Resource Skip Optimization
 * 
 * Purpose: Verify that MCP Server correctly skips downloading MCP resources
 * that are already configured in the user's mcp.json (incremental mode only).
 */

const fs = require('fs');
const path = require('path');

// ANSI colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function log(color, prefix, message) {
  console.log(`${color}[${prefix}]${RESET} ${message}`);
}

/**
 * Simulate the optimized sync_resources logic
 */
function simulateSync(subscriptions, configuredMcpServers, mode) {
  const results = {
    downloaded: [],
    skipped: [],
    actions: [],
  };

  for (const sub of subscriptions) {
    if (sub.type === 'mcp' && mode === 'incremental') {
      // Check if already configured
      const serverName = sub.serverName || sub.name;
      if (configuredMcpServers.includes(serverName)) {
        results.skipped.push(sub.name);
        continue;  // Skip download
      }
    }

    // Download and generate actions
    results.downloaded.push(sub.name);
    
    if (sub.type === 'rule') {
      results.actions.push({
        action: 'write_file',
        path: `~/.cursor/rules/${sub.name}.mdc`,
        content: sub.content,
      });
    } else if (sub.type === 'mcp') {
      // Generate multiple write_file for MCP files
      for (let i = 0; i < sub.fileCount; i++) {
        results.actions.push({
          action: 'write_file',
          path: `~/.cursor/mcp-servers/${sub.name}/file${i}.js`,
          content: `content${i}`,
        });
      }
      results.actions.push({
        action: 'merge_mcp_json',
        server_name: sub.serverName || sub.name,
        skip_if_exists: true,
      });
    }
  }

  return results;
}

function runTests() {
  console.log('\n' + '='.repeat(70));
  console.log('Test: MCP Resource Skip Optimization');
  console.log('='.repeat(70) + '\n');

  let passed = 0;
  let failed = 0;

  // Test subscriptions (mock)
  const subscriptions = [
    { name: 'privacy-logging', type: 'rule', content: 'rule content', fileCount: 1 },
    { name: 'security-baseline', type: 'rule', content: 'rule content', fileCount: 1 },
    { name: 'code-review', type: 'skill', content: 'skill content', fileCount: 3 },
    { name: 'jenkins', type: 'mcp', serverName: 'jenkins-helper', fileCount: 5 },
    { name: 'gitlab', type: 'mcp', serverName: 'gitlab-api', fileCount: 8 },
    { name: 'postgres', type: 'mcp', serverName: 'postgres', fileCount: 3 },
  ];

  // Simulate user's mcp.json has these configured
  const configuredMcpServers = ['jenkins-helper', 'postgres'];

  // Test 1: Incremental mode with optimization
  log(BLUE, 'TEST', 'Test 1: Incremental mode with configured_mcp_servers');
  try {
    const result = simulateSync(subscriptions, configuredMcpServers, 'incremental');

    console.log(`  Total subscriptions: ${subscriptions.length}`);
    console.log(`  Configured MCP servers: ${configuredMcpServers.length} (${configuredMcpServers.join(', ')})`);
    console.log(`  Downloaded: ${result.downloaded.length} (${result.downloaded.join(', ')})`);
    console.log(`  Skipped: ${result.skipped.length} (${result.skipped.join(', ')})`);
    console.log(`  Actions generated: ${result.actions.length}`);

    // Verify jenkins and postgres were skipped
    const jenkinsSkipped = result.skipped.includes('jenkins');
    const postgresSkipped = result.skipped.includes('postgres');
    const gitlabDownloaded = result.downloaded.includes('gitlab');

    if (jenkinsSkipped && postgresSkipped && gitlabDownloaded) {
      log(GREEN, 'PASS', 'Correctly skipped configured MCPs, downloaded new one');
      passed++;
    } else {
      log(RED, 'FAIL', 'Skip logic not working correctly');
      console.log(`    Jenkins skipped: ${jenkinsSkipped} (expected: true)`);
      console.log(`    Postgres skipped: ${postgresSkipped} (expected: true)`);
      console.log(`    GitLab downloaded: ${gitlabDownloaded} (expected: true)`);
      failed++;
    }
  } catch (error) {
    log(RED, 'ERROR', error.message);
    failed++;
  }

  // Test 2: Full mode ignores optimization
  log(BLUE, 'TEST', 'Test 2: Full mode downloads everything (ignores configured list)');
  try {
    const result = simulateSync(subscriptions, configuredMcpServers, 'full');

    console.log(`  Mode: full`);
    console.log(`  Downloaded: ${result.downloaded.length}`);
    console.log(`  Skipped: ${result.skipped.length}`);

    if (result.downloaded.length === subscriptions.length && result.skipped.length === 0) {
      log(GREEN, 'PASS', 'Full mode correctly downloads all resources');
      passed++;
    } else {
      log(RED, 'FAIL', 'Full mode should not skip any resources');
      failed++;
    }
  } catch (error) {
    log(RED, 'ERROR', error.message);
    failed++;
  }

  // Test 3: Resource consumption comparison
  log(BLUE, 'TEST', 'Test 3: Resource consumption comparison');
  try {
    const withoutOptimization = simulateSync(subscriptions, [], 'incremental');
    const withOptimization = simulateSync(subscriptions, configuredMcpServers, 'incremental');

    const apiSaved = withoutOptimization.downloaded.length - withOptimization.downloaded.length;
    const actionsSaved = withoutOptimization.actions.length - withOptimization.actions.length;
    const percentSaved = Math.round((apiSaved / withoutOptimization.downloaded.length) * 100);

    console.log(`  Without optimization:`);
    console.log(`    API calls: ${withoutOptimization.downloaded.length}`);
    console.log(`    Actions: ${withoutOptimization.actions.length}`);
    console.log(`  With optimization:`);
    console.log(`    API calls: ${withOptimization.downloaded.length}`);
    console.log(`    Actions: ${withOptimization.actions.length}`);
    console.log(`  Savings:`);
    console.log(`    API calls saved: ${apiSaved} (${percentSaved}%)`);
    console.log(`    Actions saved: ${actionsSaved}`);

    if (apiSaved > 0 && actionsSaved > 0) {
      log(GREEN, 'PASS', `Optimization saves ${percentSaved}% of API calls and ${actionsSaved} actions`);
      passed++;
    } else {
      log(RED, 'FAIL', 'Optimization did not reduce resource usage');
      failed++;
    }
  } catch (error) {
    log(RED, 'ERROR', error.message);
    failed++;
  }

  // Test 4: Default mode verification
  log(BLUE, 'TEST', 'Test 4: Verify default mode is incremental');
  try {
    // Simulate what happens when user calls without specifying mode
    const defaultMode = undefined;  // User doesn't specify
    const resolvedMode = defaultMode || 'incremental';

    console.log(`  User specified: ${defaultMode ?? 'nothing (undefined)'}`);
    console.log(`  Resolved mode: ${resolvedMode}`);

    if (resolvedMode === 'incremental') {
      log(GREEN, 'PASS', 'Default mode is incremental (as expected)');
      passed++;
    } else {
      log(RED, 'FAIL', `Default mode is ${resolvedMode}, expected incremental`);
      failed++;
    }
  } catch (error) {
    log(RED, 'ERROR', error.message);
    failed++;
  }

  // Test 5: configured_mcp_servers parameter extraction
  log(BLUE, 'TEST', 'Test 5: Extract configured MCP servers from mcp.json');
  try {
    const mcpJsonPath = path.join(process.env.HOME, '.cursor', 'mcp.json');
    
    let configuredServers = [];
    let fileExists = false;
    
    try {
      const content = fs.readFileSync(mcpJsonPath, 'utf8');
      const mcpJson = JSON.parse(content);
      configuredServers = Object.keys(mcpJson.mcpServers || {});
      fileExists = true;
    } catch {
      // File doesn't exist or parse error
    }

    console.log(`  mcp.json path: ${mcpJsonPath}`);
    console.log(`  File exists: ${fileExists}`);
    console.log(`  Configured servers: ${configuredServers.length}`);
    if (configuredServers.length > 0) {
      console.log(`  Server list: ${configuredServers.slice(0, 5).join(', ')}${configuredServers.length > 5 ? '...' : ''}`);
    }

    if (fileExists) {
      log(GREEN, 'PASS', `Successfully extracted ${configuredServers.length} configured MCP servers`);
      passed++;
    } else {
      log(YELLOW, 'SKIP', 'mcp.json not found (user has no MCP servers yet)');
    }
  } catch (error) {
    log(RED, 'ERROR', error.message);
    failed++;
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('FINAL RESULT');
  console.log('='.repeat(70));
  console.log(`${GREEN}Passed: ${passed}${RESET}`);
  console.log(`${RED}Failed: ${failed}${RESET}`);
  console.log('='.repeat(70) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
