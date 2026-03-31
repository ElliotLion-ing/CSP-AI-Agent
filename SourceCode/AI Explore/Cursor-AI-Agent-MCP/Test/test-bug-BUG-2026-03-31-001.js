/**
 * Test Case: BUG-2026-03-31-001 - Search Accuracy Enhancement
 * 
 * Test the MCP server-side search enhancement (Tier 1 + Tier 2)
 * to ensure accurate results for keyword searches.
 */

const { SearchCoordinator } = require('../SourceCode/dist/search/coordinator');

// Mock resource data (simulating API response)
const mockResources = [
  {
    id: '6dea7a2c8cf83e5d227ee39035411730',
    name: 'zoom-build',
    type: 'skill',
    team: 'csp',
    version: '1.0.0',
    description: '多平台构建出包全流程工具。触发 Jenkins 构建、查询状态、分析失败日志、查找 JFrog 产物、Zoom Chat 通知。支持 10 个团队（Android/iOS/Mac/Windows）、11 个预设模板。当用户说"出包"、"触发构建"、"build"、"查看构建状态"、"下载构建日志"、"查找产物"时触发。',
    is_subscribed: false,
    download_url: 'https://zct-dev.zoomdev.us/csp/api/resources/download/6dea7a2c8cf83e5d227ee39035411730'
  },
  {
    id: '7b7c653e1fee5a30962a4019411c128b',
    name: 'hang-log-analyzer',
    type: 'skill',
    team: 'csp',
    version: '1.0.0',
    description: 'Analyze Zoom client hang logs to identify root cause of UI/main thread hangs. Extracts main thread ID, builds timeline, locates last activity before hang detection, correlates with CrashRpt/ThreadMonitor events, and identifies blocking periods. Use when analyzing hang dumps, hang logs, hang crashes, or when user mentions hang/freeze/卡死/卡顿 with a log file.',
    is_subscribed: false,
    download_url: 'https://zct-dev.zoomdev.us/csp/api/resources/download/7b7c653e1fee5a30962a4019411c128b'
  },
  {
    id: '467c2cce201a5b55a2f8e8f71c1f82c6',
    name: 'release-log-review',
    type: 'command',
    team: 'csp',
    version: '1.0.0',
    description: 'AI-powered release check by reviewing QA logs after code freeze. Analyzes build info, login, database/storage, zNet/libcurl, webservice core APIs, and overall stability. Produces a GO/NO-GO release check report. Use when the user mentions release check, release log review, code freeze log analysis, QA log review, or release readiness.',
    is_subscribed: false,
    download_url: 'https://zct-dev.zoomdev.us/csp/api/resources/download/467c2cce201a5b55a2f8e8f71c1f82c6'
  },
  {
    id: 'bdba66f05d2bf4ef4a71051fe4fc8f18',
    name: 'zoom-design-doc',
    type: 'skill',
    team: 'csp',
    version: '1.0.0',
    description: 'Generate a Zoom-standard Design Spec from a local document and Jira issue via DevHelper CLI or MCP, then attach the link to the Jira issue.',
    is_subscribed: false,
    download_url: 'https://zct-dev.zoomdev.us/csp/api/resources/download/bdba66f05d2bf4ef4a71051fe4fc8f18'
  }
];

// Test runner
async function runTests() {
  const coordinator = new SearchCoordinator();
  let passCount = 0;
  let failCount = 0;

  console.log('========================================');
  console.log('Test: Search Enhancement (BUG-2026-03-31-001)');
  console.log('========================================\n');

  // Test 1: Search "build" - should return only zoom-build
  console.log('Test 1: Search "build" - should return only zoom-build');
  const result1 = coordinator.enhancedSearch('build', mockResources, 10);
  
  console.log(`  Result count: ${result1.length}`);
  console.log(`  Results:`);
  result1.forEach((r, i) => {
    console.log(`    ${i + 1}. ${r.name} (score: ${r.score}, tier: ${r.match_tier})`);
  });

  if (result1.length === 1 && result1[0].name === 'zoom-build' && result1[0].score >= 80) {
    console.log('  ✅ PASS: Only zoom-build returned with high score\n');
    passCount++;
  } else {
    console.log('  ❌ FAIL: Expected 1 result (zoom-build with score ≥ 80)\n');
    failCount++;
  }

  // Test 2: Verify hang-log-analyzer is filtered out
  console.log('Test 2: Verify hang-log-analyzer is NOT in results (score < 20)');
  const hasHangAnalyzer = result1.some(r => r.name === 'hang-log-analyzer');
  
  if (!hasHangAnalyzer) {
    console.log('  ✅ PASS: hang-log-analyzer filtered out\n');
    passCount++;
  } else {
    console.log('  ❌ FAIL: hang-log-analyzer should be filtered (score < 20)\n');
    failCount++;
  }

  // Test 3: Verify release-log-review is filtered out
  console.log('Test 3: Verify release-log-review is NOT in results (score < 20)');
  const hasReleaseLog = result1.some(r => r.name === 'release-log-review');
  
  if (!hasReleaseLog) {
    console.log('  ✅ PASS: release-log-review filtered out\n');
    passCount++;
  } else {
    console.log('  ❌ FAIL: release-log-review should be filtered (score < 20)\n');
    failCount++;
  }

  // Test 4: Search "构建" (Chinese) - should return zoom-build
  console.log('Test 4: Search "构建" (Chinese) - should return zoom-build');
  const result2 = coordinator.enhancedSearch('构建', mockResources, 10);
  
  console.log(`  Result count: ${result2.length}`);
  console.log(`  Results:`);
  result2.forEach((r, i) => {
    console.log(`    ${i + 1}. ${r.name} (score: ${r.score}, tier: ${r.match_tier})`);
  });

  if (result2.length >= 1 && result2[0].name === 'zoom-build') {
    console.log('  ✅ PASS: zoom-build is top result for Chinese keyword\n');
    passCount++;
  } else {
    console.log('  ❌ FAIL: Expected zoom-build as top result\n');
    failCount++;
  }

  // Test 5: Search "jenkins" - should return zoom-build
  console.log('Test 5: Search "jenkins" - should return zoom-build');
  const result3 = coordinator.enhancedSearch('jenkins', mockResources, 10);
  
  console.log(`  Result count: ${result3.length}`);
  console.log(`  Results:`);
  result3.forEach((r, i) => {
    console.log(`    ${i + 1}. ${r.name} (score: ${r.score}, tier: ${r.match_tier})`);
  });

  if (result3.length >= 1 && result3[0].name === 'zoom-build') {
    console.log('  ✅ PASS: zoom-build returned for "jenkins" keyword\n');
    passCount++;
  } else {
    console.log('  ❌ FAIL: Expected zoom-build as top result\n');
    failCount++;
  }

  // Test 6: Search "design" - should return zoom-design-doc
  console.log('Test 6: Search "design" - should return zoom-design-doc');
  const result4 = coordinator.enhancedSearch('design', mockResources, 10);
  
  console.log(`  Result count: ${result4.length}`);
  console.log(`  Results:`);
  result4.forEach((r, i) => {
    console.log(`    ${i + 1}. ${r.name} (score: ${r.score}, tier: ${r.match_tier})`);
  });

  if (result4.length >= 1 && result4[0].name === 'zoom-design-doc') {
    console.log('  ✅ PASS: zoom-design-doc is top result\n');
    passCount++;
  } else {
    console.log('  ❌ FAIL: Expected zoom-design-doc as top result\n');
    failCount++;
  }

  // Summary
  console.log('========================================');
  console.log('Test Summary');
  console.log('========================================');
  console.log(`Total: ${passCount + failCount} tests`);
  console.log(`✅ Pass: ${passCount}`);
  console.log(`❌ Fail: ${failCount}`);
  console.log(`Pass Rate: ${((passCount / (passCount + failCount)) * 100).toFixed(1)}%`);
  
  // Exit with error code if any test failed
  process.exit(failCount > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
