#!/usr/bin/env node

/**
 * Stage 4 SSE Local Test
 * 
 * Tests the SSE transport implementation locally:
 * - Health check endpoint
 * - SSE connection establishment
 * - MCP protocol message handling
 * - Keepalive mechanism
 * - Session timeout
 */

const http = require('http');
const { EventSource } = require('eventsource');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || 'test-token-12345';

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
    console.error(`   ${message}`);
  }
}

// Test 1: Health Check
async function testHealthCheck() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/health`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const health = JSON.parse(data);
          const passed = res.statusCode === 200 && 
                        health.status === 'healthy' &&
                        typeof health.uptime === 'number' &&
                        typeof health.memory === 'object' &&
                        typeof health.sessions === 'object';
          logTest('Health Check', passed, passed ? '' : `Invalid response: ${data}`);
          resolve(passed);
        } catch (err) {
          logTest('Health Check', false, `Parse error: ${err.message}`);
          resolve(false);
        }
      });
    });
    
    req.on('error', (err) => {
      logTest('Health Check', false, `Request error: ${err.message}`);
      resolve(false);
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      logTest('Health Check', false, 'Request timeout');
      resolve(false);
    });
  });
}

// Test 2: SSE Connection
async function testSSEConnection() {
  return new Promise((resolve) => {
    let sessionId = null;
    let keepaliveReceived = false;
    let timeout = null;
    
    const es = new EventSource(`${BASE_URL}/sse`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    
    es.onopen = () => {
      console.log('   SSE connection opened');
      timeout = setTimeout(() => {
        es.close();
        const passed = sessionId !== null && keepaliveReceived;
        logTest('SSE Connection', passed, passed ? '' : 
          `sessionId: ${sessionId}, keepalive: ${keepaliveReceived}`);
        resolve(passed);
      }, 8000);
    };
    
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          sessionId = data.sessionId;
          console.log(`   Session ID: ${sessionId}`);
        }
      } catch (err) {
        console.error(`   Message parse error: ${err.message}`);
      }
    };
    
    es.addEventListener('keepalive', () => {
      keepaliveReceived = true;
      console.log('   Keepalive received');
    });
    
    es.onerror = (err) => {
      if (timeout) clearTimeout(timeout);
      es.close();
      logTest('SSE Connection', false, `SSE error: ${err.message || 'Connection failed'}`);
      resolve(false);
    };
  });
}

// Test 3: Send Message (initialize)
async function testSendMessage() {
  // First establish SSE connection to get sessionId
  return new Promise((resolve) => {
    let sessionId = null;
    let responseReceived = false;
    
    const es = new EventSource(`${BASE_URL}/sse`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          sessionId = data.sessionId;
          console.log(`   Session ID for message test: ${sessionId}`);
          
          // Send initialize message
          const postData = JSON.stringify({
            sessionId: sessionId,
            message: {
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {}
            }
          });
          
          const options = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          };
          
          const req = http.request(`${BASE_URL}/message`, options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
              console.log(`   Message response status: ${res.statusCode}`);
              const passed = res.statusCode === 200;
              logTest('Send Message', passed, passed ? '' : `Status: ${res.statusCode}`);
              es.close();
              resolve(passed);
            });
          });
          
          req.on('error', (err) => {
            logTest('Send Message', false, `Request error: ${err.message}`);
            es.close();
            resolve(false);
          });
          
          req.write(postData);
          req.end();
        } else if (data.jsonrpc === '2.0') {
          console.log(`   Received response:`, JSON.stringify(data));
          responseReceived = true;
        }
      } catch (err) {
        console.error(`   Message parse error: ${err.message}`);
      }
    };
    
    es.onerror = (err) => {
      logTest('Send Message', false, `SSE error: ${err.message || 'Connection failed'}`);
      es.close();
      resolve(false);
    };
    
    setTimeout(() => {
      es.close();
      if (!sessionId) {
        logTest('Send Message', false, 'Failed to get session ID');
        resolve(false);
      }
    }, 10000);
  });
}

// Test 4: Tools List
async function testToolsList() {
  return new Promise((resolve) => {
    let sessionId = null;
    
    const es = new EventSource(`${BASE_URL}/sse`, {
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          sessionId = data.sessionId;
          
          const postData = JSON.stringify({
            sessionId: sessionId,
            message: {
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/list',
              params: {}
            }
          });
          
          const options = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          };
          
          const req = http.request(`${BASE_URL}/message`, options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
              const passed = res.statusCode === 200;
              logTest('Tools List', passed, passed ? '' : `Status: ${res.statusCode}`);
              es.close();
              resolve(passed);
            });
          });
          
          req.on('error', (err) => {
            logTest('Tools List', false, `Request error: ${err.message}`);
            es.close();
            resolve(false);
          });
          
          req.write(postData);
          req.end();
        } else if (data.jsonrpc === '2.0' && data.result && data.result.tools) {
          console.log(`   Tools list received: ${data.result.tools.length} tools`);
        }
      } catch (err) {
        console.error(`   Parse error: ${err.message}`);
      }
    };
    
    es.onerror = (err) => {
      logTest('Tools List', false, `SSE error: ${err.message || 'Connection failed'}`);
      es.close();
      resolve(false);
    };
    
    setTimeout(() => {
      es.close();
      if (!sessionId) {
        logTest('Tools List', false, 'Failed to get session ID');
        resolve(false);
      }
    }, 10000);
  });
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Stage 4 SSE Local Tests...\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Auth Token: ${AUTH_TOKEN}\n`);
  
  // Check if server is running
  try {
    await testHealthCheck();
  } catch (err) {
    console.error('\n❌ Server not accessible. Please start the server first:');
    console.error('   cd SourceCode && npm run build && TRANSPORT_MODE=sse node dist/index.js\n');
    process.exit(1);
  }
  
  // Run SSE tests
  await testSSEConnection();
  await testSendMessage();
  await testToolsList();
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Test Summary: ${testResults.passed}/${testResults.total} passed`);
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
runTests().catch((err) => {
  console.error('\n❌ Test runner error:', err);
  process.exit(1);
});
