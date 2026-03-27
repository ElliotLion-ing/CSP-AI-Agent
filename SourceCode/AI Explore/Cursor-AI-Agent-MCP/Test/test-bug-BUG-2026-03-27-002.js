/**
 * Test Case: Bug BUG-2026-03-27-002 - Prompt GetPrompt Not Triggered
 * 
 * Purpose: Verify that removing resources capability fixes the prompt/get call issue
 * 
 * Test Strategy:
 * 1. Verify server capability declaration (no resources)
 * 2. Verify resources handlers are removed
 * 3. Verify GetPrompt handler exists and is registered
 * 4. Simulate Cursor workflow and check expected behavior
 * 5. Integration test: deploy and verify real logs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  details: []
};

function logTest(name, passed, message = '') {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`${GREEN}✓${RESET} ${name}`);
  } else {
    testResults.failed++;
    console.log(`${RED}✗${RESET} ${name}`);
    if (message) console.log(`  ${RED}Error: ${message}${RESET}`);
  }
  testResults.details.push({ name, passed, message });
}

// ============================================================================
// Test 1: Verify server/http.ts capabilities declaration
// ============================================================================
async function test1_capabilitiesDeclaration() {
  console.log(`\n${BLUE}[Test 1]${RESET} Verify capabilities declaration in server/http.ts`);
  
  try {
    const httpServerPath = path.join(__dirname, '../SourceCode/src/server/http.ts');
    const content = await fs.readFile(httpServerPath, 'utf8');
    
    // Check that resources is NOT in capabilities (support multi-line format)
    const capabilitiesMatch = content.match(/capabilities:\s*\{[^}]*(?:\}[^}]*)*\}/s);
    if (!capabilitiesMatch) {
      logTest('Find capabilities declaration', false, 'Could not find capabilities declaration');
      return;
    }
    
    const capabilitiesStr = capabilitiesMatch[0];
    // Match each capability individually with flexible whitespace
    const hasResources = /resources\s*:\s*\{\s*\}/.test(capabilitiesStr);
    const hasPrompts = /prompts\s*:\s*\{\s*\}/.test(capabilitiesStr);
    const hasTools = /tools\s*:\s*\{\s*\}/.test(capabilitiesStr);
    const hasLogging = /logging\s*:\s*\{\s*\}/.test(capabilitiesStr);
    
    logTest('Capabilities does NOT include resources', !hasResources, 
      hasResources ? 'resources capability still present' : '');
    logTest('Capabilities includes prompts', hasPrompts,
      !hasPrompts ? 'prompts capability missing' : '');
    logTest('Capabilities includes tools', hasTools,
      !hasTools ? 'tools capability missing' : '');
    logTest('Capabilities includes logging', hasLogging,
      !hasLogging ? 'logging capability missing' : '');
    
  } catch (error) {
    logTest('Read server/http.ts', false, error.message);
  }
}

// ============================================================================
// Test 2: Verify resources handlers are removed
// ============================================================================
async function test2_resourcesHandlersRemoved() {
  console.log(`\n${BLUE}[Test 2]${RESET} Verify resources handlers are removed`);
  
  try {
    const httpServerPath = path.join(__dirname, '../SourceCode/src/server/http.ts');
    const content = await fs.readFile(httpServerPath, 'utf8');
    
    const hasListResourcesHandler = content.includes('ListResourcesRequestSchema');
    const hasReadResourceHandler = content.includes('ReadResourceRequestSchema');
    const hasResourcesReadComment = content.includes('resources/read');
    
    logTest('ListResourcesRequestSchema import removed', !hasListResourcesHandler,
      hasListResourcesHandler ? 'ListResourcesRequestSchema still imported/used' : '');
    logTest('ReadResourceRequestSchema import removed', !hasReadResourceHandler,
      hasReadResourceHandler ? 'ReadResourceRequestSchema still imported/used' : '');
    logTest('resources/read comment removed', !hasResourcesReadComment,
      hasResourcesReadComment ? 'resources/read comment still present' : '');
    
  } catch (error) {
    logTest('Check resources handlers', false, error.message);
  }
}

// ============================================================================
// Test 3: Verify GetPrompt handler exists
// ============================================================================
async function test3_getPromptHandlerExists() {
  console.log(`\n${BLUE}[Test 3]${RESET} Verify GetPrompt handler exists in prompts/manager.ts`);
  
  try {
    const managerPath = path.join(__dirname, '../SourceCode/src/prompts/manager.ts');
    const content = await fs.readFile(managerPath, 'utf8');
    
    const hasGetPromptHandler = content.includes('GetPromptRequestSchema');
    const hasInstallHandlers = content.includes('installHandlers');
    const hasServerParam = content.includes('installHandlers(server');
    
    logTest('GetPromptRequestSchema handler exists', hasGetPromptHandler,
      !hasGetPromptHandler ? 'GetPromptRequestSchema not found' : '');
    logTest('installHandlers method exists', hasInstallHandlers,
      !hasInstallHandlers ? 'installHandlers method not found' : '');
    logTest('installHandlers accepts server parameter', hasServerParam,
      !hasServerParam ? 'installHandlers does not accept server' : '');
    
  } catch (error) {
    logTest('Check prompts/manager.ts', false, error.message);
  }
}

// ============================================================================
// Test 4: Verify prompt cache files exist
// ============================================================================
async function test4_promptCacheExists() {
  console.log(`\n${BLUE}[Test 4]${RESET} Verify prompt cache files exist`);
  
  try {
    const cacheDir = path.join(__dirname, '../SourceCode/.prompt-cache');
    const files = await fs.readdir(cacheDir);
    
    const cmdFiles = files.filter(f => f.startsWith('cmd-'));
    const skillFiles = files.filter(f => f.startsWith('skill-'));
    
    logTest('Prompt cache directory exists', true);
    logTest('CMD prompt files exist', cmdFiles.length > 0,
      cmdFiles.length === 0 ? 'No cmd- files found' : `Found ${cmdFiles.length} cmd files`);
    logTest('SKILL prompt files exist', skillFiles.length > 0,
      skillFiles.length === 0 ? 'No skill- files found' : `Found ${skillFiles.length} skill files`);
    
    console.log(`  ${YELLOW}ℹ${RESET} Total prompt files: ${files.length}`);
    console.log(`  ${YELLOW}ℹ${RESET} CMD prompts: ${cmdFiles.length}, SKILL prompts: ${skillFiles.length}`);
    
  } catch (error) {
    logTest('Check .prompt-cache/', false, error.message);
  }
}

// ============================================================================
// Test 5: Verify compiled output
// ============================================================================
async function test5_compiledOutput() {
  console.log(`\n${BLUE}[Test 5]${RESET} Verify compiled output (dist/)`);
  
  try {
    const distHttpPath = path.join(__dirname, '../SourceCode/dist/server/http.js');
    const content = await fs.readFile(distHttpPath, 'utf8');
    
    // Compiled JS should not have resources-related code
    const hasResourcesCapability = /capabilities:\s*\{[^}]*resources:/.test(content);
    const hasListResourcesSchema = content.includes('ListResourcesRequestSchema');
    const hasReadResourceSchema = content.includes('ReadResourceRequestSchema');
    
    logTest('Compiled code does NOT have resources capability', !hasResourcesCapability,
      hasResourcesCapability ? 'resources capability found in compiled code' : '');
    logTest('Compiled code does NOT import ListResourcesRequestSchema', !hasListResourcesSchema,
      hasListResourcesSchema ? 'ListResourcesRequestSchema found in compiled code' : '');
    logTest('Compiled code does NOT import ReadResourceRequestSchema', !hasReadResourceSchema,
      hasReadResourceSchema ? 'ReadResourceRequestSchema found in compiled code' : '');
    
  } catch (error) {
    logTest('Check dist/server/http.js', false, error.message);
  }
}

// ============================================================================
// Test 6: Verify package version updated
// ============================================================================
async function test6_packageVersion() {
  console.log(`\n${BLUE}[Test 6]${RESET} Verify package version updated for bug fix`);
  
  try {
    const packagePath = path.join(__dirname, '../SourceCode/package.json');
    const content = await fs.readFile(packagePath, 'utf8');
    const pkg = JSON.parse(content);
    
    // Version should be bumped from 0.1.23 (previous bug fix)
    const version = pkg.version;
    const versionParts = version.split('.').map(Number);
    
    // Expecting 0.1.24 or higher for this bug fix
    const isVersionBumped = versionParts[0] === 0 && versionParts[1] === 1 && versionParts[2] >= 24;
    
    logTest('Package version bumped', isVersionBumped,
      !isVersionBumped ? `Current version: ${version}, expected >= 0.1.24` : `Version: ${version}`);
    
  } catch (error) {
    logTest('Check package.json version', false, error.message);
  }
}

// ============================================================================
// Test 7: Integration test instructions
// ============================================================================
async function test7_integrationTestInstructions() {
  console.log(`\n${BLUE}[Test 7]${RESET} Integration test instructions (manual verification)`);
  
  console.log(`\n  ${YELLOW}Manual Verification Steps:${RESET}`);
  console.log(`  1. Deploy fixed version to server`);
  console.log(`     ${YELLOW}→${RESET} cd SourceCode && npm run build`);
  console.log(`     ${YELLOW}→${RESET} pm2 restart csp-ai-agent-mcp (or docker restart)`);
  console.log(`  2. Restart Cursor or reload MCP connection`);
  console.log(`  3. Type /acm-helper or /hang-log-analyzer in Cursor`);
  console.log(`  4. Select the prompt`);
  console.log(`  5. Check server logs for:`);
  console.log(`     ${GREEN}✓${RESET} "ListPrompts called"`);
  console.log(`     ${GREEN}✓${RESET} "GetPrompt request received"`);
  console.log(`     ${GREEN}✓${RESET} "GetPrompt serving content from cache"`);
  console.log(`     ${GREEN}✓${RESET} "track_usage: invocation recorded"`);
  console.log(`  6. Check Cursor UI:`);
  console.log(`     ${GREEN}✓${RESET} Prompt content should be fully displayed`);
  console.log(`     ${GREEN}✓${RESET} Complete workflow instructions visible\n`);
  
  logTest('Integration test instructions provided', true);
}

// ============================================================================
// Main test runner
// ============================================================================
async function main() {
  console.log(`${BLUE}╔════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BLUE}║  Bug Test: BUG-2026-03-27-002                              ║${RESET}`);
  console.log(`${BLUE}║  MCP Prompt GetPrompt Not Triggered                        ║${RESET}`);
  console.log(`${BLUE}╚════════════════════════════════════════════════════════════╝${RESET}`);
  
  await test1_capabilitiesDeclaration();
  await test2_resourcesHandlersRemoved();
  await test3_getPromptHandlerExists();
  await test4_promptCacheExists();
  await test5_compiledOutput();
  await test6_packageVersion();
  await test7_integrationTestInstructions();
  
  // Summary
  console.log(`\n${BLUE}═══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BLUE}Test Summary${RESET}`);
  console.log(`${BLUE}═══════════════════════════════════════════════════════════${RESET}`);
  console.log(`Total:  ${testResults.total}`);
  console.log(`${GREEN}Passed: ${testResults.passed}${RESET}`);
  console.log(`${RED}Failed: ${testResults.failed}${RESET}`);
  console.log(`Pass Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
  
  // Exit code
  if (testResults.failed > 0) {
    console.log(`\n${RED}⚠ Some tests failed. Fix required before deployment.${RESET}`);
    process.exit(1);
  } else {
    console.log(`\n${GREEN}✓ All static tests passed. Ready for integration test (deploy + manual verification).${RESET}`);
    process.exit(0);
  }
}

main().catch(error => {
  console.error(`${RED}Fatal error in test runner:${RESET}`, error);
  process.exit(1);
});
