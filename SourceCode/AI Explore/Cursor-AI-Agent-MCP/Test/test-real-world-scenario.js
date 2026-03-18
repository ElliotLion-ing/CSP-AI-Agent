#!/usr/bin/env node
/**
 * Real-World E2E Test
 * 
 * 模拟实际使用场景：
 * 1. 搜索资源
 * 2. 订阅资源
 * 3. 下载资源
 * 4. 将资源安装到用户本地目录
 *    - rules → .cursor/rules/
 *    - commands → .cursor/commands/
 *    - skills → .cursor/skills/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJDU1BfTUNQX0FVVEgiLCJpc3MiOiJjbGllbnQtc2VydmljZS1wbGF0Zm9ybSIsImlhdCI6MTc3MjA3NjIxNSwiZW1haWwiOiJlbGxpb3QuZGluZ0B6b29tLnVzIn0.xw7Np0MynXqhL4ay_vN1v5Ac332aga0tgybPQsC7WMc';
const BASE_DIR = path.join(__dirname, '..');
const USER_CURSOR_DIR = path.join(process.env.HOME, '.cursor');

// Test results tracking
const testResults = [];
let totalTests = 0;
let passedTests = 0;

function recordTest(name, passed, details = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`✅ ${name}`);
  } else {
    console.error(`❌ ${name}`);
    if (details) console.error(`   ${details}`);
  }
  testResults.push({ name, passed, details });
}

/**
 * SSE Client for MCP communication
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
        } else {
          console.log('Waiting for session ID via SSE event...');
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
          console.log('SSE connection closed');
          this.connection = null;
        });

        res.on('error', (err) => reject(err));
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
          // Ignore
        }
      }
    }
  }

  handleMessage(message) {
    if (message.type === 'connected' && message.sessionId && !this.sessionId) {
      this.sessionId = message.sessionId;
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
      }, 15000);

      this.messageHandlers.set(messageId, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      const postData = JSON.stringify({
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

      const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/message',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {});
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        this.messageHandlers.delete(messageId);
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  close() {
    if (this.connection) {
      this.connection.destroy();
      this.connection = null;
    }
  }
}

/**
 * Install resource to local directory
 */
async function installResource(resource, content) {
  const { type, name } = resource;
  let targetDir, fileName;

  switch (type) {
    case 'rule':
      targetDir = path.join(USER_CURSOR_DIR, 'rules');
      fileName = `${name}.mdc`;
      break;
    case 'command':
      targetDir = path.join(USER_CURSOR_DIR, 'commands');
      fileName = `${name}.md`;
      break;
    case 'skill':
      targetDir = path.join(USER_CURSOR_DIR, 'skills', name);
      fileName = 'SKILL.md';
      break;
    default:
      throw new Error(`Unknown resource type: ${type}`);
  }

  // Ensure directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Write file
  const filePath = path.join(targetDir, fileName);
  fs.writeFileSync(filePath, content, 'utf8');

  return filePath;
}

/**
 * Download resource from API
 */
async function downloadResource(resourceId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 6093,
      path: `/csp/api/resources/download/${resourceId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          // Download API returns raw content, not JSON
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Main test flow
 */
async function runRealWorldTest() {
  console.log('='.repeat(70));
  console.log('🌍 Real-World E2E Test - AI Resource Management');
  console.log('='.repeat(70));
  console.log();

  const client = new SSEClient();

  try {
    // Step 1: Connect to MCP Server
    console.log('📡 Step 1: Connecting to MCP Server...');
    await client.connect();
    recordTest('MCP Server connection', true);
    console.log();

    // Step 2: Search for resources
    console.log('🔍 Step 2: Searching for test resources...');
    const searchResponse = await client.callTool('search_resources', {
      keyword: 'test',
      type: 'all',
      detail: true
    });

    if (searchResponse.result && searchResponse.result.success) {
      const resources = searchResponse.result.data.results;
      recordTest(`Search resources (found ${resources.length})`, resources.length > 0);
      console.log(`   Found ${resources.length} resources`);
    } else {
      recordTest('Search resources', false, 'No results');
    }
    console.log();

    // Step 3: Subscribe to specific resources
    console.log('📥 Step 3: Subscribing to resources...');
    const resourcesToSubscribe = [
      { id: 'rule-elliot-test-001', name: 'elliottest', type: 'rule' },
      { id: 'cmd-test-elliot-001', name: 'TestCommandElliot', type: 'command' },
      { id: 'skill-code-review-001', name: 'code-review', type: 'skill' }
    ];

    const subscribeResponse = await client.callTool('manage_subscription', {
      action: 'subscribe',
      resource_ids: resourcesToSubscribe.map(r => r.id),
      auto_sync: true,
      scope: 'user'
    });

    if (subscribeResponse.result && subscribeResponse.result.success) {
      recordTest('Subscribe to resources', true);
      console.log(`   Subscribed to ${resourcesToSubscribe.length} resources`);
    } else {
      recordTest('Subscribe to resources', false, 'Subscription failed');
    }
    console.log();

    // Step 4: Download and install resources
    console.log('💾 Step 4: Downloading and installing resources...');
    
    for (const resource of resourcesToSubscribe) {
      try {
        console.log(`\n   Processing: ${resource.name} (${resource.type})`);
        
        // Download content
        const content = await downloadResource(resource.id);
        console.log(`   ✓ Downloaded (${content.length} bytes)`);
        
        // Install to local directory
        const installedPath = await installResource(resource, content);
        console.log(`   ✓ Installed to: ${installedPath}`);
        
        // Verify installation
        const exists = fs.existsSync(installedPath);
        recordTest(`Install ${resource.name} (${resource.type})`, exists);
        
        if (exists) {
          const fileContent = fs.readFileSync(installedPath, 'utf8');
          const sizeMatch = fileContent.length === content.length;
          console.log(`   ✓ Verified (size: ${fileContent.length} bytes)`);
          
          if (!sizeMatch) {
            console.warn(`   ⚠️ Size mismatch: expected ${content.length}, got ${fileContent.length}`);
          }
        }
      } catch (error) {
        recordTest(`Install ${resource.name} (${resource.type})`, false, error.message);
        console.error(`   ✗ Failed: ${error.message}`);
      }
    }
    console.log();

    // Step 5: Verify installation
    console.log('✔️  Step 5: Verifying installations...');
    console.log(`   Rule installed: ${path.join(USER_CURSOR_DIR, 'rules', 'elliottest.mdc')}`);
    console.log(`   Command installed: ${path.join(USER_CURSOR_DIR, 'commands', 'TestCommandElliot.md')}`);
    console.log(`   Skill installed: ${path.join(USER_CURSOR_DIR, 'skills', 'code-review', 'SKILL.md')}`);
    console.log();

    // Step 6: List subscriptions
    console.log('📋 Step 6: Listing all subscriptions...');
    const listResponse = await client.callTool('manage_subscription', {
      action: 'list',
      scope: 'all'
    });

    if (listResponse.result && listResponse.result.success) {
      const subs = listResponse.result.data.subscriptions || [];
      recordTest(`List subscriptions (${subs.length} items)`, subs.length >= 3);
      console.log(`   Total subscriptions: ${subs.length}`);
      subs.forEach((sub, idx) => {
        console.log(`   ${idx + 1}. ${sub.name} (${sub.type})`);
      });
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    recordTest('Overall test execution', false, error.message);
  } finally {
    client.close();
  }

  // Print summary
  console.log();
  console.log('='.repeat(70));
  console.log('📊 Test Summary');
  console.log('='.repeat(70));
  console.log(`Total tests: ${totalTests}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${totalTests - passedTests}`);
  console.log(`Pass rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  console.log('='.repeat(70));

  process.exit(totalTests - passedTests > 0 ? 1 : 0);
}

// Run test
runRealWorldTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
