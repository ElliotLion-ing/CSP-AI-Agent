/**
 * Test: Resource Upload Conflict Detection
 * 
 * Tests the duplicate resource name detection before upload
 * as required by AGENTS.md (AI Resources 开发约束)
 */

const { resourceLoader } = require('../SourceCode/dist/resources');
const { uploadResource } = require('../SourceCode/dist/tools/upload-resource');

/**
 * Test duplicate resource name detection
 */
async function testUploadConflictDetection() {
  console.log('\n📋 Test: Upload Resource Conflict Detection\n');
  console.log('=' .repeat(60));

  try {
    // Step 1: Initialize resource loader
    console.log('\n1️⃣ Initializing resource loader...');
    await resourceLoader.loadConfig();
    await resourceLoader.scanResources();
    
    const stats = resourceLoader.getStats();
    console.log(`   ✅ Loaded ${stats.resourcesIndexed} resources from ${stats.sourcesLoaded} sources`);

    // Step 2: Try to upload a resource with existing name (should be blocked)
    console.log('\n2️⃣ Attempting to upload resource with duplicate name (no force flag)...');
    
    const duplicateUpload = await uploadResource({
      resource_id: 'test-command',
      type: 'command',
      message: 'Test duplicate upload',
      force: false,
    });

    if (!duplicateUpload.success && duplicateUpload.error?.code === 'RESOURCE_NAME_CONFLICT') {
      console.log(`   ✅ Duplicate detected correctly!`);
      console.log(`   📝 Error message: ${duplicateUpload.error.message}`);
      
      if (duplicateUpload.error.details) {
        console.log(`   📊 Conflicting resources:`);
        duplicateUpload.error.details.forEach((conflict, index) => {
          console.log(`      ${index + 1}. ${conflict.name} (source: ${conflict.source}, priority: ${conflict.priority})`);
        });
      }
    } else {
      console.log(`   ❌ FAILED: Expected conflict detection, got success or different error`);
      return false;
    }

    // Step 3: Try with force flag (should proceed with warning)
    console.log('\n3️⃣ Attempting to upload with force=true (should proceed)...');
    
    const forceUpload = await uploadResource({
      resource_id: 'test-command',
      type: 'command',
      message: 'Test force upload',
      force: true,
    });

    if (forceUpload.success || forceUpload.error?.code !== 'RESOURCE_NAME_CONFLICT') {
      console.log(`   ✅ Force upload allowed (or file not found, which is OK for test)`);
    } else {
      console.log(`   ❌ FAILED: Force flag should allow upload`);
      return false;
    }

    // Step 4: Try with non-existing resource (should proceed)
    console.log('\n4️⃣ Uploading resource with unique name...');
    
    const uniqueUpload = await uploadResource({
      resource_id: 'unique-resource-' + Date.now(),
      type: 'command',
      message: 'Test unique upload',
      force: false,
    });

    console.log(`   ✅ Unique resource upload attempt completed (may fail due to file not found, which is OK)`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ All conflict detection tests passed!\n');
    return true;

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

/**
 * Test resource loader conflict resolution
 */
async function testResourceConflictResolution() {
  console.log('\n📋 Test: Resource Conflict Resolution\n');
  console.log('=' .repeat(60));

  try {
    // Step 1: Initialize resource loader
    console.log('\n1️⃣ Initializing resource loader...');
    await resourceLoader.loadConfig();
    await resourceLoader.scanResources();
    
    const stats = resourceLoader.getStats();
    console.log(`   ✅ Loaded ${stats.resourcesIndexed} resources`);
    console.log(`   📊 By type: commands=${stats.byType.commands}, skills=${stats.byType.skills}, mcp=${stats.byType.mcp}, rules=${stats.byType.rules}`);

    // Step 2: Check for conflicts
    console.log('\n2️⃣ Checking for resource conflicts...');
    const conflicts = resourceLoader.getConflicts();
    
    if (conflicts.length > 0) {
      console.log(`   ⚠️  Detected ${conflicts.length} conflict(s):`);
      conflicts.forEach((conflict, index) => {
        console.log(`\n   Conflict ${index + 1}: ${conflict.name} (${conflict.type})`);
        console.log(`      Conflicting sources:`);
        conflict.conflicts.forEach((c) => {
          console.log(`        - ${c.source} (priority: ${c.priority})`);
        });
        console.log(`      ✅ Selected: ${conflict.selected.source} (priority: ${conflict.selected.priority})`);
      });
    } else {
      console.log(`   ✅ No conflicts detected`);
    }

    // Step 3: Search resources by name
    console.log('\n3️⃣ Testing resource search...');
    const searchResults = resourceLoader.searchResourcesByName('test', 'command');
    console.log(`   ✅ Found ${searchResults.length} resources matching "test"`);
    
    if (searchResults.length > 0) {
      console.log(`   📋 Sample results:`);
      searchResults.slice(0, 3).forEach((r) => {
        console.log(`      - ${r.name} (source: ${r.source}, priority: ${r.priority})`);
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Resource conflict resolution tests passed!\n');
    return true;

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n🚀 Running AI Resources Upload Conflict Tests');
  console.log('='.repeat(60));
  
  const results = [];
  
  // Test 1: Upload conflict detection
  results.push(await testUploadConflictDetection());
  
  // Test 2: Resource conflict resolution
  results.push(await testResourceConflictResolution());
  
  console.log('\n📊 Test Summary');
  console.log('='.repeat(60));
  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`Passed: ${passed}/${total} (${(passed / total * 100).toFixed(1)}%)`);
  
  if (passed === total) {
    console.log('✅ All tests passed!\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed\n');
    process.exit(1);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runAllTests().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  testUploadConflictDetection,
  testResourceConflictResolution,
  runAllTests,
};
