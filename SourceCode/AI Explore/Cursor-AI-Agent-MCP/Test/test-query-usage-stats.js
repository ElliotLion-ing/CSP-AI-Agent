/**
 * Test: query_usage_stats Tool
 * 
 * Verifies the implementation of query_usage_stats tool
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(80));
console.log('Test: query_usage_stats Tool Implementation');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`✅ PASS: ${description}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${description}`);
    failed++;
  }
}

// Test 1: Tool file exists
const toolPath = path.join(__dirname, '../SourceCode/src/tools/query-usage-stats.ts');
assert(fs.existsSync(toolPath), 'Tool file query-usage-stats.ts exists');

// Test 2: Tool is exported from index
const toolIndexPath = path.join(__dirname, '../SourceCode/src/tools/index.ts');
const toolIndexContent = fs.readFileSync(toolIndexPath, 'utf8');
assert(
  toolIndexContent.includes("export * from './query-usage-stats';"),
  'Tool is exported from tools/index.ts'
);

// Test 3: Tool is registered in server.ts
const serverPath = path.join(__dirname, '../SourceCode/src/server.ts');
const serverContent = fs.readFileSync(serverPath, 'utf8');
assert(
  serverContent.includes('queryUsageStatsTool'),
  'Tool is imported in server.ts'
);
assert(
  serverContent.includes('toolRegistry.registerTool(queryUsageStatsTool)'),
  'Tool is registered in server.ts'
);

// Test 4: API Client method exists
const apiClientPath = path.join(__dirname, '../SourceCode/src/api/client.ts');
const apiClientContent = fs.readFileSync(apiClientPath, 'utf8');
assert(
  apiClientContent.includes('async getMyUsageStats'),
  'API Client has getMyUsageStats method'
);
assert(
  apiClientContent.includes('/csp/api/mcp-telemetry/my-usage'),
  'API Client calls correct endpoint'
);

// Test 5: getTelemetryFilePath removed
const cursorPathsPath = path.join(__dirname, '../SourceCode/src/utils/cursor-paths.ts');
const cursorPathsContent = fs.readFileSync(cursorPathsPath, 'utf8');
assert(
  !cursorPathsContent.includes('export function getTelemetryFilePath'),
  'getTelemetryFilePath function removed'
);

// Test 6: Tool implementation structure
const toolContent = fs.readFileSync(toolPath, 'utf8');
assert(
  toolContent.includes('export interface QueryUsageStatsParams'),
  'QueryUsageStatsParams interface defined'
);
assert(
  toolContent.includes('export interface UsageStatsResource'),
  'UsageStatsResource interface defined'
);
assert(
  toolContent.includes('export interface UsageStatsResult'),
  'UsageStatsResult interface defined'
);
assert(
  toolContent.includes('export async function queryUsageStats'),
  'queryUsageStats function exported'
);
assert(
  toolContent.includes('export const queryUsageStatsTool'),
  'queryUsageStatsTool descriptor exported'
);

// Test 7: Tool has correct parameters
assert(
  toolContent.includes('resource_type?:'),
  'Tool supports resource_type parameter'
);
assert(
  toolContent.includes('start_date?:'),
  'Tool supports start_date parameter'
);
assert(
  toolContent.includes('end_date?:'),
  'Tool supports end_date parameter'
);
assert(
  toolContent.includes('user_token?:'),
  'Tool supports user_token parameter'
);

// Test 8: Tool has correct return type
assert(
  toolContent.includes('user_id: number'),
  'Result includes user_id'
);
assert(
  toolContent.includes('user_name: string'),
  'Result includes user_name'
);
assert(
  toolContent.includes('user_email: string'),
  'Result includes user_email'
);
assert(
  toolContent.includes('total_invocations: number'),
  'Result includes total_invocations'
);
assert(
  toolContent.includes('resource_usage: UsageStatsResource[]'),
  'Result includes resource_usage array'
);

// Test 9: Tool has proper error handling
assert(
  toolContent.includes('if (!userToken)'),
  'Tool validates user token'
);
assert(
  toolContent.includes('MISSING_TOKEN'),
  'Tool returns MISSING_TOKEN error'
);
assert(
  toolContent.includes('catch (error)'),
  'Tool has error handling'
);
assert(
  toolContent.includes('QUERY_FAILED'),
  'Tool returns QUERY_FAILED error'
);

// Test 10: Tool has logging
assert(
  toolContent.includes("logToolStep('query_usage_stats'"),
  'Tool uses logToolStep for logging'
);
assert(
  toolContent.includes("logger.error"),
  'Tool logs errors'
);

// Test 11: Compiled output exists
const distPath = path.join(__dirname, '../SourceCode/dist/tools/query-usage-stats.js');
assert(fs.existsSync(distPath), 'Compiled tool file exists in dist/');

// Test 12: API endpoint format
assert(
  apiClientContent.includes('resource_type') && 
  apiClientContent.includes('start_date') && 
  apiClientContent.includes('end_date'),
  'API Client supports all query parameters'
);

console.log('='.repeat(80));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(80));

process.exit(failed > 0 ? 1 : 0);
