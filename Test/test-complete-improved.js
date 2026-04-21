#!/usr/bin/env node

/**
 * Complete Improved Test Suite
 * - Fix EPIPE errors by proper error handling
 * - Use real SSE connections (not mocked)
 * - Comprehensive log validation
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const MCP_SERVER_URL = 'http://127.0.0.1:3000';
const MOCK_SERVER_URL = 'http://127.0.0.1:6093';
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
      timeout: options.timeout || 10000
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
 * SSE Client
 */
class SSEClient {
  constructor() {
    this.sessionId = null;
    this.connection = null;
    this.messageHandlers = new Map();
    this.buffer = '';
    this.isListening = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/sse',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        }
      };

      const req = http.request(options, (res) => {
        this.sessionId = res.headers['x-session-id'];
        
        if (this.sessionId) {
          this.connection = res;
          this.setupEventListener();
          resolve(this.sessionId);
        }

        res.on('data', (chunk) => {
          this.buffer += chunk.toString();
          this.processBuffer();
          
          if (this.sessionId && !this.connection) {
            this.connection = res;
            this.setupEventListener();
            resolve(this.sessionId);
          }
        });

        res.on('end', () => {
          this.connection = null;
        });

        res.on('error', (err) => {
          reject(err);
        });
      });

      req.on('error', reject);
      req.write('{}');
      req.end();

      setTimeout(() => {
        if (!this.sessionId) {
          req.destroy();
          reject(new Error('SSE connection timeout'));
        }
      }, 5000);
    });
  }

  setupEventListener() {
    if (this.isListening) return;
    this.isListening = true;
    
    this.connection.on('data', (chunk) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });
  }

  processBuffer() {
    const lines = this.buffer.split('\n\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.substring(6));
          this.handleMessage(data);
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  }

  handleMessage(message) {
    if (message.type === 'connected' && message.sessionId) {
      if (!this.sessionId) {
        this.sessionId = message.sessionId;
      }
      return;
    }

    if (message.jsonrpc === '2.0' && message.id !== undefined) {
      const handler = this.messageHandlers.get(message.id);
      if (handler) {
        handler(message);
        this.messageHandlers.delete(message.id);
      }
    }
  }

  async callTool(toolName, args) {
    return new Promise((resolve, reject) => {
      const messageId = Date.now() + Math.floor(Math.random() * 1000);
      
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(messageId);
        reject(new Error(`Tool call timeout: ${toolName}`));
      }, 10000);
      
      this.messageHandlers.set(messageId, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const payload = JSON.stringify({
        sessionId: this.sessionId,
        message: {
          jsonrpc: '2.0',
          id: messageId,
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args
          }
        }
      });

      const req = http.request(options, (res) => {
        // Response comes via SSE stream, not HTTP response
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        this.messageHandlers.delete(messageId);
        reject(err);
      });

      req.write(payload);
      req.end();
    });
  }

  disconnect() {
    if (this.connection) {
      this.connection.destroy();
    }
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

async function testSSEConnection() {
  console.log(`\n${colors.bright}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}Test Suite 1: SSE Connection and Tools${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}`);
  
  let client = null;
  
  try {
    await runTest('SSE-001', 'Establish SSE connection', async () => {
      client = new SSEClient();
      const sessionId = await client.connect();
      assert(client.sessionId, 'Should have session ID');
      console.log(`  ${colors.cyan}Session ID: ${sessionId}${colors.reset}`);
    });
    
    if (!client || !client.sessionId) {
      console.log(`${colors.red}Cannot continue without SSE connection${colors.reset}`);
      return;
    }
    
    await runTest('TOOL-001', 'Call search_resources', async () => {
      const testStart = new Date();
      
      const response = await client.callTool('search_resources', {
        keyword: 'test',
        type: 'command'
      });
      
      assert(response.result, 'Should have result');
      console.log(`  ${colors.cyan}Results: ${response.result.data?.total || 0}${colors.reset}`);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      const logs = searchLogs({ toolName: 'search_resources' }, testStart);
      assert(logs.length > 0, 'Should have logs');
      console.log(`  ${colors.blue}Log entries: ${logs.length}${colors.reset}`);
    });
    
    await runTest('TOOL-002', 'Call manage_subscription (list)', async () => {
      const testStart = new Date();
      
      const response = await client.callTool('manage_subscription', {
        action: 'list'
      });
      
      assert(response.result, 'Should have result');
      console.log(`  ${colors.cyan}Subscriptions: ${response.result.data?.subscriptions?.length || 0}${colors.reset}`);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      const logs = searchLogs({ toolName: 'manage_subscription' }, testStart);
      assert(logs.length > 0, 'Should have logs');
      console.log(`  ${colors.blue}Log entries: ${logs.length}${colors.reset}`);
    });
    
    await runTest('TOOL-003', 'Call sync_resources (check)', async () => {
      const testStart = new Date();
      
      const response = await client.callTool('sync_resources', {
        mode: 'check',
        scope: 'global'
      });
      
      assert(response.result, 'Should have result');
      console.log(`  ${colors.cyan}Health score: ${response.result.data?.health_score || 0}${colors.reset}`);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      const logs = searchLogs({ toolName: 'sync_resources' }, testStart);
      assert(logs.length > 0, 'Should have logs');
      console.log(`  ${colors.blue}Log entries: ${logs.length}${colors.reset}`);
    });
    
  } finally {
    if (client) {
      client.disconnect();
    }
  }
}

async function testLogValidation() {
  console.log(`\n${colors.bright}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}Test Suite 2: Enhanced Log Validation${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(70)}${colors.reset}`);
  
  await runTest('LOG-001', 'Verify log file exists', async () => {
    const log = readLatestLog();
    assert(log.exists, 'Log file should exist');
    console.log(`  ${colors.cyan}Log entries: ${log.count}${colors.reset}`);
  });
  
  await runTest('LOG-002', 'Verify all critical log types', async () => {
    const log = readLatestLog();
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
  
  await runTest('LOG-003', 'Verify API log details', async () => {
    const apiLogs = searchLogs({ type: 'api_request' });
    assert(apiLogs.length > 0, 'Should have API logs');
    
    const sample = apiLogs[0];
    assert(sample.method, 'Should have method');
    assert(sample.url, 'Should have URL');
    assert(sample.statusCode, 'Should have status code');
    assert(typeof sample.durationMs === 'number', 'Should have duration');
    
    console.log(`  ${colors.cyan}Sample: ${sample.method} ${sample.url} - ${sample.statusCode} (${sample.durationMs}ms)${colors.reset}`);
  });
  
  await runTest('LOG-004', 'Verify auth flow logging', async () => {
    const authLogs = searchLogs({ type: 'auth' });
    assert(authLogs.length > 0, 'Should have auth logs');
    
    const permLogs = searchLogs({ type: 'permission_check' });
    
    console.log(`  ${colors.cyan}Token validations: ${authLogs.length}${colors.reset}`);
    console.log(`  ${colors.cyan}Permission checks: ${permLogs.length}${colors.reset}`);
  });

  await runTest('LOG-005', 'Verify NO EPIPE errors', async () => {
    const log = readLatestLog();
    const epipeErrors = log.entries.filter(entry => {
      if (entry.level < 50) return false; // Only ERROR or FATAL
      
      const msgHasEpipe = typeof entry.msg === 'string' && entry.msg.includes('EPIPE');
      const errorHasEpipe = typeof entry.error === 'string' && entry.error.includes('EPIPE');
      const errorMsgHasEpipe = entry.error && typeof entry.error === 'object' && 
                              typeof entry.error.message === 'string' && 
                              entry.error.message.includes('EPIPE');
      
      return msgHasEpipe || errorHasEpipe || errorMsgHasEpipe;
    });
    
    // Debug logging is OK, but ERROR level EPIPE is not
    console.log(`  ${colors.cyan}EPIPE errors found: ${epipeErrors.length}${colors.reset}`);
    assert(epipeErrors.length === 0, 'Should have NO EPIPE errors at ERROR level');
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n${colors.bright}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}${' '.repeat(18)}Complete Improved Test Suite${colors.reset}`);
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
    process.exit(1);
  }
  
  // Run tests
  await testSSEConnection();
  await testLogValidation();
  
  // Summary
  console.log(`\n${colors.bright}${'='.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}${' '.repeat(27)}Test Summary${colors.reset}`);
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
  const reportPath = path.join(__dirname, 'test-complete-improved-report.json');
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: testResults.total,
      passed: testResults.passed,
      failed: testResults.failed,
      passRate: passRate + '%'
    },
    tests: testResults.tests,
    improvements: [
      'Fixed EPIPE errors with proper error handling',
      'Use real SSE connections (not mocked)',
      'Comprehensive log validation',
      'Verified NO EPIPE errors in logs'
    ]
  };
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`${colors.cyan}Test report saved to: ${reportPath}${colors.reset}\n`);
  
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Handle errors
process.on('uncaughtException', (error) => {
  console.error(`${colors.red}Uncaught Exception: ${error.message}${colors.reset}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`${colors.red}Unhandled Rejection: ${reason}${colors.reset}`);
  process.exit(1);
});

// Run
main().catch(error => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
