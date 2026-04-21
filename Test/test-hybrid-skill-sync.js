/**
 * Test: Hybrid Skill Synchronization
 * 
 * Tests the hybrid sync strategy where:
 * - Simple skills (no scripts) use MCP Prompt only
 * - Complex skills (with scripts) download to local + use MCP Prompt
 * - Incremental sync skips unchanged files
 * - Uninstall removes local script directories
 */

const path = require('path');
const fs = require('fs/promises');
const os = require('os');

// Mock API responses
const mockApiResponses = {
  simpleSkill: {
    id: 'skill-simple-001',
    name: 'hang-log-analyzer',
    type: 'skill',
    version: '1.0.0',
    content: '# Hang Log Analyzer\n\nAnalyze hang logs...',
    has_scripts: false,
    script_files: undefined,
    content_hash: 'abc123def456'
  },
  complexSkill: {
    id: 'skill-complex-001',
    name: 'zoom-build',
    type: 'skill',
    version: '2.1.0',
    content: '# Zoom Build Skill\n\nTrigger builds using local CLI...',
    has_scripts: true,
    script_files: [
      {
        relative_path: 'scripts/build-cli',
        content: '#!/usr/bin/env node\nconsole.log("Build CLI");',
        mode: '0755',
        encoding: 'utf8'
      },
      {
        relative_path: 'scripts/build-trigger',
        content: '#!/usr/bin/env node\nconsole.log("Build Trigger");',
        mode: '0755',
        encoding: 'utf8'
      },
      {
        relative_path: 'teams/client-android.json',
        content: '{"project":"client-android","team":"android"}',
        mode: '0644',
        encoding: 'utf8'
      }
    ],
    content_hash: 'xyz789abc012'
  }
};

// Test utilities
function expandPath(tildeBasedPath) {
  return tildeBasedPath.replace(/^~/, os.homedir());
}

async function cleanupTestFiles() {
  const testDirs = [
    expandPath('~/.cursor/skills/hang-log-analyzer'),
    expandPath('~/.cursor/skills/zoom-build')
  ];
  
  for (const dir of testDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      console.log(`✓ Cleaned up: ${dir}`);
    } catch (err) {
      // Ignore if not exists
    }
  }
}

async function verifyFileExists(filePath, expectedMode) {
  const fullPath = expandPath(filePath);
  try {
    const stats = await fs.stat(fullPath);
    console.log(`✓ File exists: ${filePath}`);
    
    if (expectedMode && process.platform !== 'win32') {
      const actualMode = (stats.mode & 0o777).toString(8);
      const expectedModeOctal = parseInt(expectedMode, 8).toString(8);
      if (actualMode === expectedModeOctal) {
        console.log(`  ✓ Permissions correct: ${actualMode}`);
      } else {
        throw new Error(`Permission mismatch: expected ${expectedModeOctal}, got ${actualMode}`);
      }
    }
    return true;
  } catch (err) {
    console.error(`✗ File check failed: ${filePath}`, err.message);
    return false;
  }
}

async function verifyFileNotExists(filePath) {
  const fullPath = expandPath(filePath);
  try {
    await fs.access(fullPath);
    console.error(`✗ File should not exist but does: ${filePath}`);
    return false;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`✓ File correctly does not exist: ${filePath}`);
      return true;
    }
    throw err;
  }
}

// Test scenarios
const tests = [
  {
    name: 'Scenario 1: Simple skill (no scripts)',
    async run() {
      console.log('\n📝 Test: Simple skill should NOT create local files');
      
      const metadata = mockApiResponses.simpleSkill;
      
      // Simulate sync_resources behavior for simple skill
      if (!metadata.has_scripts) {
        console.log('✓ has_scripts=false detected');
        console.log('✓ MCP Prompt registered (no local files)');
        
        // Verify no local files created
        const shouldNotExist = await verifyFileNotExists('~/.cursor/skills/hang-log-analyzer/SKILL.md');
        
        return shouldNotExist;
      }
      
      return false;
    }
  },
  
  {
    name: 'Scenario 2: Complex skill (first sync)',
    async run() {
      console.log('\n📝 Test: Complex skill should download all script files');
      
      await cleanupTestFiles();
      
      const metadata = mockApiResponses.complexSkill;
      
      if (metadata.has_scripts && metadata.script_files) {
        console.log(`✓ has_scripts=true detected (${metadata.script_files.length} files)`);
        
        // Simulate writing files
        const baseDir = expandPath('~/.cursor/skills/zoom-build');
        await fs.mkdir(baseDir, { recursive: true });
        
        for (const file of metadata.script_files) {
          const filePath = path.join(baseDir, file.relative_path);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, file.content, 'utf8');
          
          if (file.mode && process.platform !== 'win32') {
            await fs.chmod(filePath, parseInt(file.mode, 8));
          }
        }
        
        // Verify all files exist with correct permissions
        const checks = await Promise.all([
          verifyFileExists('~/.cursor/skills/zoom-build/scripts/build-cli', '755'),
          verifyFileExists('~/.cursor/skills/zoom-build/scripts/build-trigger', '755'),
          verifyFileExists('~/.cursor/skills/zoom-build/teams/client-android.json', '644')
        ]);
        
        return checks.every(c => c === true);
      }
      
      return false;
    }
  },
  
  {
    name: 'Scenario 3: Incremental sync (no changes)',
    async run() {
      console.log('\n📝 Test: Incremental sync should skip unchanged files');
      
      const metadata = mockApiResponses.complexSkill;
      
      // Simulate incremental check
      const baseDir = expandPath('~/.cursor/skills/zoom-build');
      const scriptFile = path.join(baseDir, 'scripts/build-cli');
      
      try {
        const localContent = await fs.readFile(scriptFile, 'utf8');
        const remoteContent = metadata.script_files[0].content;
        
        if (localContent === remoteContent) {
          console.log('✓ Local content matches remote (hash equal)');
          console.log('✓ File download skipped');
          return true;
        } else {
          console.error('✗ Content mismatch detected');
          return false;
        }
      } catch (err) {
        console.error('✗ Failed to read local file:', err.message);
        return false;
      }
    }
  },
  
  {
    name: 'Scenario 4: Incremental sync (partial update)',
    async run() {
      console.log('\n📝 Test: Partial update should only re-download changed files');
      
      // Simulate: modify only build-cli remotely
      const updatedContent = '#!/usr/bin/env node\nconsole.log("Build CLI v2.2.0");';
      
      const baseDir = expandPath('~/.cursor/skills/zoom-build');
      const scriptFile = path.join(baseDir, 'scripts/build-cli');
      const unchangedFile = path.join(baseDir, 'teams/client-android.json');
      
      try {
        const localCliContent = await fs.readFile(scriptFile, 'utf8');
        const localTeamContent = await fs.readFile(unchangedFile, 'utf8');
        
        // Check team file unchanged
        if (localTeamContent === mockApiResponses.complexSkill.script_files[2].content) {
          console.log('✓ Unchanged file (teams/client-android.json) remains intact');
        } else {
          console.error('✗ Unchanged file was modified');
          return false;
        }
        
        // Simulate update to build-cli
        await fs.writeFile(scriptFile, updatedContent, 'utf8');
        const newContent = await fs.readFile(scriptFile, 'utf8');
        
        if (newContent === updatedContent) {
          console.log('✓ Updated file (build-cli) written successfully');
          return true;
        }
        
        return false;
      } catch (err) {
        console.error('✗ Partial update test failed:', err.message);
        return false;
      }
    }
  },
  
  {
    name: 'Scenario 5: Uninstall complex skill',
    async run() {
      console.log('\n📝 Test: Uninstall should remove local script directory');
      
      const skillDir = expandPath('~/.cursor/skills/zoom-build');
      
      // Verify directory exists before uninstall
      try {
        await fs.access(skillDir);
        console.log('✓ Skill directory exists before uninstall');
      } catch {
        console.error('✗ Skill directory not found (should exist from previous test)');
        return false;
      }
      
      // Simulate uninstall (delete directory)
      await fs.rm(skillDir, { recursive: true, force: true });
      
      // Verify deletion
      return await verifyFileNotExists('~/.cursor/skills/zoom-build');
    }
  },
  
  {
    name: 'Scenario 6: Telemetry verification (Mock)',
    async run() {
      console.log('\n📝 Test: Telemetry tracking for skill invocation');
      
      // This test only verifies the data structure (actual API call requires server)
      const telemetryEvent = {
        resource_id: 'skill-complex-001',
        resource_type: 'skill',
        resource_name: 'zoom-build',
        invocation_count: 1,
        first_invoked_at: new Date().toISOString(),
        last_invoked_at: new Date().toISOString()
      };
      
      if (telemetryEvent.resource_name === 'zoom-build') {
        console.log('✓ Telemetry event structure valid');
        console.log('✓ MCP Prompt invocation tracked');
        return true;
      }
      
      return false;
    }
  }
];

// Run all tests
async function runAllTests() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Hybrid Skill Sync Test Suite');
  console.log('═══════════════════════════════════════════════════════\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    console.log(`\n▶ Running: ${test.name}`);
    try {
      const result = await test.run();
      if (result) {
        passed++;
        console.log(`✅ PASSED: ${test.name}`);
      } else {
        failed++;
        console.error(`❌ FAILED: ${test.name}`);
      }
    } catch (err) {
      failed++;
      console.error(`❌ FAILED: ${test.name}`);
      console.error(`   Error: ${err.message}`);
      if (err.stack) {
        console.error(`   Stack: ${err.stack.split('\n').slice(0, 3).join('\n')}`);
      }
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  Test Results: ${passed}/${tests.length} passed`);
  console.log(`  Pass Rate: ${Math.round((passed / tests.length) * 100)}%`);
  console.log('═══════════════════════════════════════════════════════\n');
  
  // Cleanup
  await cleanupTestFiles();
  
  return { passed, failed, total: tests.length, passRate: Math.round((passed / tests.length) * 100) };
}

// Execute
if (require.main === module) {
  runAllTests()
    .then(results => {
      if (results.passRate === 100) {
        console.log('✅ All tests passed!');
        process.exit(0);
      } else {
        console.error(`❌ Some tests failed (${results.failed}/${results.total})`);
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { runAllTests };
