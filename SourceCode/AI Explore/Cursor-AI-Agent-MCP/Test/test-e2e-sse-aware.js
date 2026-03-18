#!/usr/bin/env node
/**
 * SSE-Aware E2E Test Script
 * Properly handles SSE event stream and tool call responses
 */

const http = require('http');
const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJDU1BfTUNQX0FVVEgiLCJpc3MiOiJjbGllbnQtc2VydmljZS1wbGF0Zm9ybSIsImlhdCI6MTc3MjA3NjIxNSwiZW1haWwiOiJlbGxpb3QuZGluZ0B6b29tLnVzIn0.xw7Np0MynXqhL4ay_vN1v5Ac332aga0tgybPQsC7WMc';

// Test results
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  details: []
};

/**
 * Establish SSE connection and keep it alive
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
        // Check for session ID in header first
        this.sessionId = res.headers['x-session-id'];
        
        if (this.sessionId) {
          console.log(`✅ SSE connected (via header): ${this.sessionId}`);
          this.connection = res;
          this.setupEventListener();
          resolve(this.sessionId);
        } else {
          console.log('Waiting for session ID via SSE event...');
        }

        // Listen for SSE events
        res.on('data', (chunk) => {
          this.buffer += chunk.toString();
          this.processBuffer();
          
          // If we got session ID from event and haven't resolved yet
          if (this.sessionId && !this.connection) {
            console.log(`✅ SSE connected (via event): ${this.sessionId}`);
            this.connection = res;
            this.setupEventListener();
            resolve(this.sessionId);
          }
        });

        res.on('end', () => {
          console.log('❌ SSE connection closed by server');
          this.connection = null;
        });

        res.on('error', (err) => {
          console.error('❌ SSE connection error:', err.message);
          reject(err);
        });
      });

      req.on('error', reject);
      req.write('{}');
      req.end();

      setTimeout(() => {
        if (!this.sessionId) {
          req.destroy();
          reject(new Error('SSE connection timeout - no session ID received'));
        }
      }, 5000);
    });
  }

  setupEventListener() {
    if (this.isListening) return; // Prevent duplicate listeners
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
          console.warn('Failed to parse SSE message:', line);
        }
      }
    }
  }

  handleMessage(message) {
    // Handle initial connection message
    if (message.type === 'connected' && message.sessionId) {
      if (!this.sessionId) {
        this.sessionId = message.sessionId;
        console.log(`✅ SSE connected via event: ${this.sessionId}`);
      }
      return;
    }

    // Handle JSON-RPC response
    if (message.jsonrpc === '2.0' && message.id !== undefined) {
      const handler = this.messageHandlers.get(message.id);
      if (handler) {
        console.log(`📥 Response received for message ID: ${message.id}`);
        handler(message);
        this.messageHandlers.delete(message.id);
      } else {
        console.warn(`⚠️ No handler found for message ID: ${message.id}`);
      }
    }
  }

  async callTool(toolName, args) {
    return new Promise((resolve, reject) => {
      const messageId = Date.now() + Math.floor(Math.random() * 1000);
      
      // Register handler FIRST, before sending request
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(messageId);
        reject(new Error(`Tool call timeout: ${toolName}`));
      }, 15000); // Increase timeout to 15s

      this.messageHandlers.set(messageId, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      // Then send tool call via /message endpoint
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
        res.on('end', () => {
          // The /message endpoint just acknowledges receipt
          // The actual response comes via SSE
          console.log(`📤 Tool call sent: ${toolName} (message ID: ${messageId})`);
        });
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
 * Test helper
 */
function recordTest(name, passed, details) {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ ${name}`);
  } else {
    testResults.failed++;
    console.error(`❌ ${name}`);
    console.error(`   ${details}`);
  }
  testResults.details.push({ name, passed, details });
}

/**
 * Main test flow
 */
async function runTests() {
  console.log('=== SSE-Aware E2E Test ===\n');
  
  const client = new SSEClient();

  try {
    // Connect
    await client.connect();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test 1: search_resources
    console.log('\n--- Test 1: search_resources ---');
    try {
      const response = await client.callTool('search_resources', {
        keyword: 'debug',
        type: 'all',
        detail: true
      });

      if (response.result && response.result.success) {
        const data = response.result.data;
        recordTest('search_resources returns success', true);
        recordTest('search_resources returns results', 
          data && data.results && data.results.length > 0,
          `Got ${data?.results?.length || 0} results`);
        console.log(`   Total results: ${data?.total || 0}`);
      } else if (response.error) {
        recordTest('search_resources returns success', false, 
          `Error: ${response.error.message}`);
      } else {
        recordTest('search_resources returns success', false, 
          'No result or error in response');
      }
    } catch (error) {
      recordTest('search_resources call', false, error.message);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 2: manage_subscription (list)
    console.log('\n--- Test 2: manage_subscription (list) ---');
    try {
      const response = await client.callTool('manage_subscription', {
        action: 'list',
        scope: 'all'
      });

      if (response.result && response.result.success) {
        const data = response.result.data;
        recordTest('manage_subscription returns success', true);
        console.log(`   Action: ${data?.action}`);
        console.log(`   Message: ${data?.message}`);
      } else if (response.error) {
        recordTest('manage_subscription returns success', false,
          `Error: ${response.error.message}`);
      } else {
        recordTest('manage_subscription returns success', false,
          'No result or error in response');
      }
    } catch (error) {
      recordTest('manage_subscription call', false, error.message);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 3: manage_subscription (subscribe)
    console.log('\n--- Test 3: manage_subscription (subscribe) ---');
    try {
      const response = await client.callTool('manage_subscription', {
        action: 'subscribe',
        resource_ids: ['zCodeReview-skill-001'],  // Fixed: use array
        auto_sync: true,
        scope: 'user'
      });

      if (response.result && response.result.success) {
        const data = response.result.data;
        recordTest('manage_subscription subscribe success', true);
        console.log(`   Action: ${data?.action}`);
        console.log(`   Message: ${data?.message}`);
      } else if (response.error) {
        recordTest('manage_subscription subscribe success', false,
          `Error: ${response.error.message}`);
      } else {
        recordTest('manage_subscription subscribe success', false,
          'No result or error in response');
      }
    } catch (error) {
      recordTest('manage_subscription subscribe call', false, error.message);
    }

  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
  } finally {
    client.close();
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  console.log(`Total tests: ${testResults.total}`);
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`Pass rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
  console.log('='.repeat(60));

  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(console.error);
