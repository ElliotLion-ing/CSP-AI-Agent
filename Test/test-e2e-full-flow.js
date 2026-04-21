#!/usr/bin/env node
/**
 * End-to-End Test: Complete User Flow with SSE
 * 
 * This script tests the complete user workflow via SSE transport:
 * 1. Establish SSE connection and get sessionId
 * 2. Search for resources
 * 3. Subscribe to resources
 * 4. Sync resources to local
 * 5. Upload custom resource
 * 6. Unsubscribe from resources
 * 
 * Prerequisites:
 * - Mock Server running on http://127.0.0.1:6093
 * - MCP Server in SSE mode on http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const MCP_SERVER_URL = 'http://localhost:3000';
const RESOURCE_PATH = '/tmp/csp-resources-test';
const AUTH_TOKEN = 'test-token-12345';

// Test results tracking
const testResults = [];
let testCount = 0;
let sessionId = null;

function logTest(name, passed, error = '') {
  testCount++;
  const status = passed ? '✅ PASSED' : '❌ FAILED';
  console.log(`Test ${testCount}: ${name} - ${status}`);
  if (error) {
    console.log(`   Error: ${error}`);
  }
  testResults.push({ name, passed, error });
}

// Helper: HTTP POST request
function httpPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const urlObj = new URL(url);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(responseData) });
        } catch (err) {
          resolve({ status: res.statusCode, headers: res.headers, data: responseData });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Helper: HTTP GET request
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: headers
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (err) {
          resolve(responseData);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Helper: Establish SSE connection and get sessionId
function establishSSEConnection() {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${MCP_SERVER_URL}/sse`);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      // Extract session ID from response headers
      const sessionIdHeader = res.headers['x-session-id'];
      
      if (sessionIdHeader) {
        console.log(`   Session ID: ${sessionIdHeader}`);
        resolve(sessionIdHeader);
        req.destroy(); // Close connection after getting session ID
        return;
      }

      // If not in headers, listen for SSE data
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        
        // Parse SSE messages
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // Keep incomplete line
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              if (data.type === 'connected' && data.sessionId) {
                console.log(`   Session ID: ${data.sessionId}`);
                resolve(data.sessionId);
                req.destroy(); // Close connection after getting session ID
                return;
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      });

      res.on('end', () => {
        reject(new Error('SSE connection ended without session ID'));
      });
    });

    req.on('error', reject);
    req.write('{}'); // Send empty body to establish connection
    req.end();

    // Timeout after 5 seconds
    setTimeout(() => {
      req.destroy();
      reject(new Error('SSE connection timeout'));
    }, 5000);
  });
}

// Helper: Send MCP message
function sendMCPMessage(sessionId, method, params) {
  return httpPost(`${MCP_SERVER_URL}/message`, {
    sessionId,
    message: {
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    }
  });
}

// Helper: Wait for async operation
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test Suite
async function runTests() {
  console.log('\n========================================');
  console.log('End-to-End Test: Complete User Flow (SSE)');
  console.log('========================================\n');

  let resourceIdToTest = null;

  try {
    // Test 1: Health Check
    console.log('\n--- Phase 1: Health Check ---');
    try {
      const health = await httpGet(`${MCP_SERVER_URL}/health`);
      logTest('Health Check', health.status === 'healthy', '');
    } catch (err) {
      logTest('Health Check', false, err.message);
      console.log('\n⚠️  MCP Server is not running. Please start it first:');
      console.log('   cd SourceCode && npm start');
      process.exit(1);
    }

    // Test 2: Establish SSE Connection
    console.log('\n--- Phase 2: Establish SSE Connection ---');
    try {
      sessionId = await establishSSEConnection();
      logTest('Establish SSE Connection', !!sessionId, '');
    } catch (err) {
      logTest('Establish SSE Connection', false, err.message);
      console.log('\n⚠️  Failed to establish SSE connection');
      process.exit(1);
    }

    // Test 3: Search Resources
    console.log('\n--- Phase 3: Search Resources ---');
    try {
      const response = await sendMCPMessage(sessionId, 'tools/call', {
        name: 'search_resources',
        arguments: {
          keyword: 'debug',
          type: 'all',
          detail: true
        }
      });
      
      console.log(`   Search response status: ${response.status}`);
      console.log(`   Search response:`, JSON.stringify(response.data, null, 2));
      
      const hasResults = response.status === 200 && 
                        response.data && 
                        response.data.content &&
                        response.data.content.length > 0;
      
      if (hasResults) {
        try {
          const content = JSON.parse(response.data.content[0].text);
          if (content.results && content.results.length > 0) {
            resourceIdToTest = content.results[0].id;
            console.log(`   Found resource ID: ${resourceIdToTest}`);
          }
        } catch (e) {
          console.log(`   Warning: Could not parse search results`);
        }
      }
      
      logTest('Search Resources', hasResults, hasResults ? '' : 'No results found');
    } catch (err) {
      logTest('Search Resources', false, err.message);
    }

    // Test 4: Subscribe to Resource
    console.log('\n--- Phase 4: Subscribe to Resource ---');
    if (resourceIdToTest) {
      try {
        const response = await sendMCPMessage(sessionId, 'tools/call', {
          name: 'manage_subscription',
          arguments: {
            action: 'subscribe',
            resource_ids: [resourceIdToTest]
          }
        });
        
        console.log(`   Subscribe response:`, JSON.stringify(response.data, null, 2));
        
        const subscribed = response.status === 200 && response.data.content;
        logTest('Subscribe to Resource', subscribed, '');
      } catch (err) {
        logTest('Subscribe to Resource', false, err.message);
      }
    } else {
      logTest('Subscribe to Resource', false, 'No resource ID found');
    }

    // Test 5: List Subscriptions
    console.log('\n--- Phase 5: List Subscriptions ---');
    try {
      const response = await sendMCPMessage(sessionId, 'tools/call', {
        name: 'manage_subscription',
        arguments: {
          action: 'list',
          scope: 'all'
        }
      });
      
      console.log(`   List response:`, JSON.stringify(response.data, null, 2).substring(0, 200));
      
      const hasSubs = response.status === 200 && response.data.content;
      logTest('List Subscriptions', hasSubs, '');
    } catch (err) {
      logTest('List Subscriptions', false, err.message);
    }

    // Test 6: Sync Resources
    console.log('\n--- Phase 6: Sync Resources ---');
    try {
      const response = await sendMCPMessage(sessionId, 'tools/call', {
        name: 'sync_resources',
        arguments: {
          mode: 'incremental',
          scope: 'all'
        }
      });
      
      console.log(`   Sync response:`, JSON.stringify(response.data, null, 2).substring(0, 200));
      
      const synced = response.status === 200 && response.data.content;
      logTest('Sync Resources', synced, '');

      // Verify files exist
      if (synced && resourceIdToTest) {
        await wait(2000); // Wait for file write
        const filePath = path.join(RESOURCE_PATH, `${resourceIdToTest}.md`);
        const fileExists = fs.existsSync(filePath);
        logTest('Verify Downloaded File', fileExists, fileExists ? '' : `File not found: ${filePath}`);
        
        if (fileExists) {
          const content = fs.readFileSync(filePath, 'utf8');
          console.log(`   File content preview: ${content.substring(0, 100)}...`);
        }
      } else {
        logTest('Verify Downloaded File', false, 'Sync failed or no resource ID');
      }
    } catch (err) {
      logTest('Sync Resources', false, err.message);
    }

    // Test 7: Upload Custom Resource
    console.log('\n--- Phase 7: Upload Custom Resource ---');
    try {
      const response = await sendMCPMessage(sessionId, 'tools/call', {
        name: 'upload_resource',
        arguments: {
          name: `test-tool-${Date.now()}`,
          type: 'command',
          description: 'Test upload from E2E test',
          content: '# Test Tool\n\nThis is an automated test upload.',
          commit_message: 'Test: E2E upload'
        }
      });
      
      console.log(`   Upload response:`, JSON.stringify(response.data, null, 2).substring(0, 200));
      
      const uploaded = response.status === 200 && response.data.content;
      logTest('Upload Custom Resource', uploaded, '');
    } catch (err) {
      logTest('Upload Custom Resource', false, err.message);
    }

    // Test 8: Search for Uploaded Resource
    console.log('\n--- Phase 8: Search for Uploaded Resource ---');
    try {
      await wait(500); // Wait for upload to be indexed
      const response = await sendMCPMessage(sessionId, 'tools/call', {
        name: 'search_resources',
        arguments: {
          keyword: 'test-tool',
          type: 'command'
        }
      });
      
      const found = response.status === 200 && response.data.content;
      logTest('Search Uploaded Resource', found, '');
    } catch (err) {
      logTest('Search Uploaded Resource', false, err.message);
    }

    // Test 9: Unsubscribe from Resource
    console.log('\n--- Phase 9: Unsubscribe from Resource ---');
    if (resourceIdToTest) {
      try {
        const response = await sendMCPMessage(sessionId, 'tools/call', {
          name: 'manage_subscription',
          arguments: {
            action: 'unsubscribe',
            resource_ids: [resourceIdToTest]
          }
        });
        
        console.log(`   Unsubscribe response:`, JSON.stringify(response.data, null, 2));
        
        const unsubscribed = response.status === 200 && response.data.content;
        logTest('Unsubscribe from Resource', unsubscribed, '');
      } catch (err) {
        logTest('Unsubscribe from Resource', false, err.message);
      }
    } else {
      logTest('Unsubscribe from Resource', false, 'No resource ID found');
    }

    // Test 10: Verify Unsubscription
    console.log('\n--- Phase 10: Verify Unsubscription ---');
    try {
      const response = await sendMCPMessage(sessionId, 'tools/call', {
        name: 'manage_subscription',
        arguments: {
          action: 'list',
          scope: 'all'
        }
      });
      
      const verified = response.status === 200 && response.data.content;
      logTest('Verify Unsubscription', verified, '');
    } catch (err) {
      logTest('Verify Unsubscription', false, err.message);
    }

  } catch (err) {
    console.error('\n❌ Test suite failed:', err);
  }

  // Print summary
  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================');
  
  const passed = testResults.filter(t => t.passed).length;
  const failed = testResults.filter(t => !t.passed).length;
  const passRate = (passed / testResults.length * 100).toFixed(1);
  
  console.log(`Session ID: ${sessionId || 'N/A'}`);
  console.log(`Total Tests: ${testResults.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Pass Rate: ${passRate}%`);
  
  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    testResults.filter(t => !t.passed).forEach(t => {
      console.log(`   - ${t.name}: ${t.error}`);
    });
  }
  
  console.log('\n========================================\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
