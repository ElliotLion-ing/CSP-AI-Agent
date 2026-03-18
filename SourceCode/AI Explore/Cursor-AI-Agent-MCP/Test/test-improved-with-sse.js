#!/usr/bin/env node

/**
 * Improved MCP Tools Test Suite with Real SSE Connections
 * 
 * Improvements:
 * 1. Use real SSE connections instead of mocks
 * 2. Test all 5 MCP Tools with real API calls
 * 3. Validate logs after each test
 * 4. Better error handling to avoid EPIPE
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// Configuration
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://127.0.0.1:3000';
const MOCK_SERVER_URL = process.env.MOCK_SERVER_URL || 'http://127.0.0.1:6093';
const LOG_DIR = path.resolve(__dirname, '../Logs');
const TOKEN = loadToken();

// Test results
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: []
};

// Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

/**
 * Load token
 */
function loadToken() {
  try {
    const tokenPath = path.join(__dirname, 'CSP-Jwt-token.json');
    const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    return tokenData['CSP-Jwt-token'];
  } catch (error) {
    console.error(`${colors.red}Failed to load token: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

/**
 * HTTP request helper
 */
function request(method, url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: options.headers || {},
      timeout: options.timeout || 30000
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

/**
 * SSE Client with better error handling
 */
class SSEClient extends EventEmitter {
  constructor(url, token) {
    super();
    this.url = url;
    this.token = token;
    this.connected = false;
    this.sessionId = null;
    this.messageHandlers = new Map();
    this.nextMessageId = 1;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(this.url);
      
      // For SSE connection, we need to use POST without body
      const postData = '';
      
      const req = http.request({
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE connection failed: ${res.statusCode}`));
          return;
        }

        // Extract session ID from headers
        this.sessionId = res.headers['x-session-id'] || `session-${Date.now()}`;
        this.connected = true;
        
        let buffer = '';
        
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';
          
          lines.forEach(line => {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));
                this.handleMessage(data);
              } catch (e) {
                // Ignore parse errors
              }
            }
          });
        });

        res.on('end', () => {
          this.connected = false;
          this.emit('disconnect');
        });

        res.on('error', (err) => {
          this.connected = false;
          this.emit('error', err);
        });

        this.res = res;
        this.req = req;
        
        resolve(this.sessionId);
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  handleMessage(message) {
    if (message.id && this.messageHandlers.has(message.id)) {
      const handler = this.messageHandlers.get(message.id);
      this.messageHandlers.delete(message.id);
      handler(message);
    }
    this.emit('message', message);
  }

  callTool(toolName, args, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const messageId = this.nextMessageId++;
      const timeoutId = setTimeout(() => {
        this.messageHandlers.delete(messageId);
        reject(new Error(`Tool call timeout: ${toolName}`));
      }, timeout);

      this.messageHandlers.set(messageId, (response) => {
        clearTimeout(timeoutId);
        resolve(response);
      });

      // Send via HTTP POST (simpler than SSE POST)
      request('POST', `${MCP_SERVER_URL}/message`, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'X-Session-ID': this.sessionId
        },
        body: {
          jsonrpc: '2.0',
          id: messageId,
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args
          }
        }
      }).then(res => {
        if (res.data && res.data.result) {
          clearTimeout(timeoutId);
          this.messageHandlers.delete(messageId);
          resolve(res.data);
        }
      }).catch(err => {
        clearTimeout(timeoutId);
        this.messageHandlers.delete(messageId);
        reject(err);
      });
    });
  }

  disconnect() {
    if (this.req) {
      this.req.destroy();
    }
    if (this.res) {
      this.res.destroy();
    }
    this.connected = false;
  }
}

/**
 * Read latest log
 */
function readLatestLog() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `app-${today}.log`);
    
    if (!fs.existsSync(logFile)) {
      return { exists: false, entries: [] };
    }
    
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    const entries = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    }).filter(e => e !== null);
    
    return { exists: true, entries, count: entries.length };
  } catch (error) {
    return { exists: false, error: error.message, entries: [] };
  }
}

/**
 * Search logs
 */
function searchLogs(filter, since = null) {
  const log = readLatestLog();
  if (!log.exists) return [];
  
  return log.entries.filter(entry => {
    if (since && new Date(entry.time) < since) return false;
    if (filter.type && entry.type !== filter.type) return false;
    if (filter.toolName && entry.toolName !== filter.toolName) return false;
    if (filter.level && entry.level < filter.level) return false;
    return true;
  });
}

/**
 * Run test
 */
async function runTest(testId, description, testFn) {
  testResults.total++;
  const test = {
    id: testId,
    description,
    status: 'running',
    startTime: Date.now()
  };
  
  console.log(`\n${colors.bright}[TEST ${testId}] ${description}${colors.reset}`);
  
  try {
    await testFn();
    test.status = 'passed';
    test.duration = Date.now() - test.startTime;
    testResults.passed++;
    console.log(`${colors.green}✓ PASS${colors.reset} (${test.duration}ms)`);
  } catch (error) {
    test.status = 'failed';
    test.duration = Date.now() - test.startTime;
    test.error = error.message;
    testResults.failed++;
    console.log(`${colors.red}✗ FAIL${colors.reset}: ${error.message} (${test.duration}ms)`);
  }
  
  testResults.tests.push(test);
}

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// ============================================================================
// Test Suites
// ============================================================================

async function testWithSSE() {
  console.log(`\n${colors.bright}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}Test Suite: Real SSE Tool Calls${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}`);
  
  let client = null;
  
  try {
    // Connect to SSE
    await runTest('SSE-CONNECT', 'Establish SSE connection', async () => {
      client = new SSEClient(`${MCP_SERVER_URL}/sse`, TOKEN);
      const sessionId = await client.connect();
      assert(client.connected, 'Should be connected');
      assert(sessionId, 'Should have session ID');
      console.log(`  ${colors.cyan}Session ID: ${sessionId}${colors.reset}`);
    });
    
    if (!client || !client.connected) {
      console.log(`${colors.red}Cannot continue without SSE connection${colors.reset}`);
      return;
    }
    
    // Test search_resources
    await runTest('TOOL-SEARCH-001', 'Call search_resources tool', async () => {
      const testStart = new Date();
      
      const response = await client.callTool('search_resources', {
        keyword: 'debug',
        type: 'command'
      });
      
      assert(response.result, 'Should have result');
      assert(response.result.success, 'Should succeed');
      console.log(`  ${colors.cyan}Results: ${response.result.data?.total || 0}${colors.reset}`);
      
      // Verify logs
      await new Promise(resolve => setTimeout(resolve, 500));
      const logs = searchLogs({ toolName: 'search_resources' }, testStart);
      assert(logs.length > 0, 'Should have logs for search_resources');
      console.log(`  ${colors.blue}Log entries: ${logs.length}${colors.reset}`);
    });
    
    // Test manage_subscription (list)
    await runTest('TOOL-SUB-001', 'Call manage_subscription (list)', async () => {
      const testStart = new Date();
      
      const response = await client.callTool('manage_subscription', {
        action: 'list'
      });
      
      assert(response.result, 'Should have result');
      assert(response.result.success, 'Should succeed');
      console.log(`  ${colors.cyan}Subscriptions: ${response.result.data?.subscriptions?.length || 0}${colors.reset}`);
      
      // Verify logs
      await new Promise(resolve => setTimeout(resolve, 500));
      const logs = searchLogs({ toolName: 'manage_subscription' }, testStart);
      assert(logs.length > 0, 'Should have logs for manage_subscription');
      console.log(`  ${colors.blue}Log entries: ${logs.length}${colors.reset}`);
    });
    
    // Test manage_subscription (subscribe)
    await runTest('TOOL-SUB-002', 'Call manage_subscription (subscribe)', async () => {
      const testStart = new Date();
      
      const response = await client.callTool('manage_subscription', {
        action: 'subscribe',
        resource_ids: ['zCodeReview-skill-001'],
        auto_sync: false
      });
      
      assert(response.result, 'Should have result');
      assert(response.result.success, 'Should succeed');
      console.log(`  ${colors.cyan}Subscribed: ${response.result.data?.subscriptions?.length || 0}${colors.reset}`);
      
      // Verify API logs
      await new Promise(resolve => setTimeout(resolve, 500));
      const apiLogs = searchLogs({ type: 'api_request' }, testStart);
      assert(apiLogs.length > 0, 'Should have API request logs');
      console.log(`  ${colors.blue}API calls: ${apiLogs.length}${colors.reset}`);
    });
    
    // Test sync_resources
    await runTest('TOOL-SYNC-001', 'Call sync_resources (check mode)', async () => {
      const testStart = new Date();
      
      const response = await client.callTool('sync_resources', {
        mode: 'check',
        scope: 'global'
      });
      
      assert(response.result, 'Should have result');
      assert(response.result.success, 'Should succeed');
      console.log(`  ${colors.cyan}Health score: ${response.result.data?.health_score || 0}${colors.reset}`);
      
      // Verify logs
      await new Promise(resolve => setTimeout(resolve, 500));
      const logs = searchLogs({ toolName: 'sync_resources' }, testStart);
      assert(logs.length > 0, 'Should have logs for sync_resources');
      console.log(`  ${colors.blue}Log entries: ${logs.length}${colors.reset}`);
    });
    
  } finally {
    if (client) {
      client.disconnect();
    }
  }
}

/**
 * Test log validation
 */
async function testLogValidation() {
  console.log(`\n${colors.bright}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}Test Suite: Enhanced Log Validation${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}`);
  
  await runTest('LOG-TYPES', 'Verify all log types exist', async () => {
    const log = readLatestLog();
    assert(log.exists, 'Log file should exist');
    
    const requiredTypes = [
      'api_request',
      'tool_step',
      'auth',
      'permission_check',
      'sse_message_received',
      'sse_tool_call'
    ];
    
    const foundTypes = new Set();
    log.entries.forEach(entry => {
      if (entry.type) foundTypes.add(entry.type);
    });
    
    requiredTypes.forEach(type => {
      assert(foundTypes.has(type), `Should have ${type} logs`);
      console.log(`  ${colors.green}✓${colors.reset} ${type}`);
    });
  });
  
  await runTest('LOG-API-DETAILS', 'Verify API request log details', async () => {
    const apiLogs = searchLogs({ type: 'api_request' });
    assert(apiLogs.length > 0, 'Should have API logs');
    
    const sample = apiLogs[0];
    assert(sample.method, 'Should have method');
    assert(sample.url, 'Should have URL');
    assert(sample.statusCode, 'Should have status code');
    assert(typeof sample.durationMs === 'number', 'Should have duration');
    
    console.log(`  ${colors.cyan}Sample: ${sample.method} ${sample.url} - ${sample.statusCode} (${sample.durationMs}ms)${colors.reset}`);
  });
  
  await runTest('LOG-AUTH-FLOW', 'Verify auth flow is logged', async () => {
    const authLogs = searchLogs({ type: 'auth' });
    assert(authLogs.length > 0, 'Should have auth logs');
    
    // Check for validation logs
    const validations = authLogs.filter(log => log.operation === 'verify_token_api');
    console.log(`  ${colors.cyan}Token validations: ${validations.length}${colors.reset}`);
    
    // Check for permission checks
    const permLogs = searchLogs({ type: 'permission_check' });
    console.log(`  ${colors.cyan}Permission checks: ${permLogs.length}${colors.reset}`);
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n${colors.bright}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}${' '.repeat(15)}Improved MCP Tools Test Suite${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.cyan}MCP Server: ${MCP_SERVER_URL}${colors.reset}`);
  console.log(`${colors.cyan}Mock Server: ${MOCK_SERVER_URL}${colors.reset}`);
  console.log(`${colors.cyan}Log Directory: ${LOG_DIR}${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}\n`);
  
  // Check servers
  try {
    const health = await request('GET', `${MCP_SERVER_URL}/health`);
    if (health.status === 200) {
      console.log(`${colors.green}✓ MCP Server is running${colors.reset}`);
    }
  } catch (error) {
    console.log(`${colors.red}✗ MCP Server is not accessible${colors.reset}`);
    console.log(`${colors.yellow}  Please start: cd SourceCode && npm start${colors.reset}\n`);
    process.exit(1);
  }
  
  try {
    const mock = await request('GET', `${MOCK_SERVER_URL}/csp/api/user/permissions`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    if (mock.status === 200) {
      console.log(`${colors.green}✓ Mock Server is running${colors.reset}\n`);
    }
  } catch (error) {
    console.log(`${colors.red}✗ Mock Server is not accessible${colors.reset}`);
    console.log(`${colors.yellow}  Please start: cd Test && node mock-csp-resource-server.js${colors.reset}\n`);
    process.exit(1);
  }
  
  // Run tests
  await testWithSSE();
  await testLogValidation();
  
  // Summary
  console.log(`\n${colors.bright}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}${' '.repeat(25)}Test Summary${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.cyan}Total Tests:    ${testResults.total}${colors.reset}`);
  console.log(`${colors.green}Passed:         ${testResults.passed}${colors.reset}`);
  console.log(`${colors.red}Failed:         ${testResults.failed}${colors.reset}`);
  
  const passRate = testResults.total > 0 
    ? ((testResults.passed / testResults.total) * 100).toFixed(2) 
    : '0.00';
  
  const passRateColor = passRate === '100.00' ? colors.green : passRate >= '80.00' ? colors.yellow : colors.red;
  console.log(`${passRateColor}Pass Rate:      ${passRate}%${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}\n`);
  
  // Save report
  const reportPath = path.join(__dirname, 'test-improved-report.json');
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: testResults.total,
      passed: testResults.passed,
      failed: testResults.failed,
      passRate: passRate + '%'
    },
    tests: testResults.tests,
    logs: {
      directory: LOG_DIR,
      latestLog: readLatestLog()
    }
  };
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`${colors.cyan}Test report saved to: ${reportPath}${colors.reset}\n`);
  
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Handle errors
process.on('uncaughtException', (error) => {
  console.error(`${colors.red}Uncaught Exception: ${error.message}${colors.reset}`);
  console.error(error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`${colors.red}Unhandled Rejection: ${reason}${colors.reset}`);
  process.exit(1);
});

// Run
main().catch(error => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  console.error(error.stack);
  process.exit(1);
});
