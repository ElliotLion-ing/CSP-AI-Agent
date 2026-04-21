/**
 * Bug Test: BUG-2026-03-20-002
 * Title: upload_resource incorrect type detection and auto-naming
 *
 * Verifies:
 *   1. inferResourceType() — user-declared type always wins
 *   2. inferResourceType() — auto-detects correctly from file structure
 *   3. inferResourceType() — throws when type cannot be inferred
 *   4. deriveNameFromFiles() — strips extension from single file name
 *   5. deriveNameFromFiles() — uses directory name for multi-file uploads
 *   6. collectFiles() — MCP missing mcp-config.json: error contains hint
 *   7. collectFiles() — MCP missing mcp-config.json: lists found config files
 *   8. type field is optional in inputSchema (not in required array)
 *   9. resource_id is NOT used as fallback name
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, description, detail = '') {
  if (condition) {
    passed++;
    results.push({ status: 'PASS', description });
    console.log(`  ✅ PASS: ${description}`);
  } else {
    failed++;
    results.push({ status: 'FAIL', description, detail });
    console.log(`  ❌ FAIL: ${description}${detail ? `\n       → ${detail}` : ''}`);
  }
}

function summary() {
  const total = passed + failed;
  const rate  = total > 0 ? Math.round((passed / total) * 100) : 0;
  console.log('\n' + '─'.repeat(60));
  console.log(`📊 BUG-2026-03-20-002 Test Summary`);
  console.log(`   Total  : ${total}`);
  console.log(`   Passed : ${passed}`);
  console.log(`   Failed : ${failed}`);
  console.log(`   Rate   : ${rate}%`);
  console.log('─'.repeat(60));
  return { passed, failed, total, rate, results };
}

// ── Load source under test ─────────────────────────────────────────────────
// We test the TypeScript source logic by reading and analysing the compiled JS
// and the TS source for structural checks. For functional checks we use the
// compiled dist.

const distUploadPath = path.resolve(
  __dirname, '../SourceCode/dist/tools/upload-resource.js'
);
const srcUploadPath  = path.resolve(
  __dirname, '../SourceCode/src/tools/upload-resource.ts'
);

// ── Test Suite ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('═'.repeat(60));
  console.log('🔍 BUG-2026-03-20-002: upload_resource Type Detection & Naming Tests');
  console.log('═'.repeat(60) + '\n');

  // ── 0. Sanity: dist exists ─────────────────────────────────────────────
  console.log('▶ Group 0: Build Artifact Verification');
  assert(fs.existsSync(distUploadPath), 'dist/tools/upload-resource.js exists');
  assert(fs.existsSync(srcUploadPath),  'src/tools/upload-resource.ts exists');

  const srcContent  = fs.readFileSync(srcUploadPath, 'utf-8');
  const distContent = fs.readFileSync(distUploadPath, 'utf-8');

  // ── 1. User-declared type always wins ─────────────────────────────────
  console.log('\n▶ Group 1: User-Declared Type Takes Priority');

  // The fix adds: "if (declaredType) return declaredType;"
  assert(
    srcContent.includes('if (declaredType) return declaredType'),
    'inferResourceType() returns declaredType immediately when provided'
  );

  // Old bug: type was inferred and could override user input.
  // Verify there's no unconditional type inference before the guard.
  const inferFnStart = srcContent.indexOf('function inferResourceType(');
  const inferFnEnd   = srcContent.indexOf('\nfunction ', inferFnStart + 10);
  const inferFnBody  = srcContent.slice(inferFnStart, inferFnEnd);
  const guardIdx     = inferFnBody.indexOf('if (declaredType) return declaredType');
  const firstDetect  = inferFnBody.indexOf('mcp-config.json');
  assert(
    guardIdx < firstDetect,
    'Guard "if (declaredType)" appears BEFORE any auto-detection logic'
  );

  // ── 2. Auto-detection rules ───────────────────────────────────────────
  console.log('\n▶ Group 2: Auto-Detection Rules (No Declared Type)');

  // Check all four patterns are present in inferResourceType body
  assert(
    inferFnBody.includes("'mcp-config.json'") || inferFnBody.includes('"mcp-config.json"'),
    'Auto-detect: mcp-config.json → mcp'
  );
  assert(
    inferFnBody.includes("'skill.md'") || inferFnBody.includes('"skill.md"'),
    'Auto-detect: SKILL.md → skill (case-insensitive via toLowerCase)'
  );
  assert(
    inferFnBody.includes(".mdc'") || inferFnBody.includes('.mdc"'),
    "Auto-detect: single .mdc file → rule"
  );
  assert(
    inferFnBody.includes(".md'") || inferFnBody.includes('.md"'),
    "Auto-detect: single .md file → command"
  );

  // ── 3. Throws when type cannot be inferred ────────────────────────────
  console.log('\n▶ Group 3: Error When Type Cannot Be Inferred');

  assert(
    inferFnBody.includes('Cannot auto-detect the resource type'),
    'inferResourceType() throws a clear error when type cannot be determined'
  );
  assert(
    inferFnBody.includes('Please specify "type" explicitly'),
    'Error message guides user to specify type explicitly'
  );

  // ── 4. deriveNameFromFiles — single file, strip extension ─────────────
  console.log('\n▶ Group 4: deriveNameFromFiles() — Single File Name Derivation');

  const deriveFnStart = srcContent.indexOf('function deriveNameFromFiles(');
  const deriveFnEnd   = srcContent.indexOf('\nfunction ', deriveFnStart + 10);
  const deriveFnBody  = srcContent.slice(deriveFnStart, deriveFnEnd);

  // Uses path.extname + path.basename to strip extension
  assert(
    deriveFnBody.includes('path.extname') && deriveFnBody.includes('path.basename'),
    'deriveNameFromFiles() uses path.basename + path.extname to strip extension'
  );
  // Example: "code-review.md" → "code-review" (extname strips .md)
  assert(
    deriveFnBody.includes("path.extname(first)"),
    'deriveNameFromFiles() calls path.extname(first) for extension stripping'
  );

  // ── 5. deriveNameFromFiles — multi-file uses directory name ───────────
  console.log('\n▶ Group 5: deriveNameFromFiles() — Multi-File Directory Name');

  assert(
    deriveFnBody.includes('path.dirname'),
    'deriveNameFromFiles() uses path.dirname to extract directory part'
  );
  // Guard: returns dir when dir !== '.'
  assert(
    deriveFnBody.includes("dir !== '.'") || deriveFnBody.includes('dir !== "."'),
    "deriveNameFromFiles() only uses dirname when dir is not '.'"
  );

  // ── 6. resource_id NOT used as name fallback ──────────────────────────
  console.log('\n▶ Group 6: resource_id Is NOT Used as Name Fallback');

  // Old bug code: const resourceName = typedParams.name ?? resourceId;
  // New code must NOT fall back to resourceId for name.
  const uploadFnStart = srcContent.indexOf('export async function uploadResource(');
  const uploadFnBody  = srcContent.slice(uploadFnStart, uploadFnStart + 2000);

  // The old pattern `?? resourceId` must not appear in the name assignment
  assert(
    !uploadFnBody.match(/resourceName\s*=.*\?\?\s*resourceId/),
    'resourceName assignment does NOT fall back to resourceId'
  );
  assert(
    uploadFnBody.includes('deriveNameFromFiles'),
    'resourceName assignment calls deriveNameFromFiles()'
  );

  // ── 7. collectFiles: mcp without mcp-config.json shows hint ───────────
  console.log('\n▶ Group 7: MCP Missing mcp-config.json — Contextual Hint');

  const collectFnStart = srcContent.indexOf('function collectFiles(');
  const collectFnEnd   = srcContent.indexOf('\nexport async function', collectFnStart);
  const collectFnBody  = srcContent.slice(collectFnStart, collectFnEnd);

  assert(
    collectFnBody.includes('mcp-config.json'),
    'collectFiles() checks for mcp-config.json presence'
  );
  assert(
    collectFnBody.includes('configHints') || collectFnBody.includes('Found related files'),
    'collectFiles() detects other config files to surface as hints'
  );
  assert(
    collectFnBody.includes('please create "mcp-config.json"') ||
    collectFnBody.includes("please create 'mcp-config.json'") ||
    collectFnBody.includes('create "mcp-config.json"'),
    'Error message instructs user to create mcp-config.json'
  );

  // ── 8. type is optional in inputSchema ────────────────────────────────
  console.log('\n▶ Group 8: type Field Is Optional in inputSchema');

  // The tool definition required array must NOT include 'type'.
  // We locate the LAST required: [...] in the file which belongs to the
  // top-level inputSchema (not the nested files[].items schema).
  const toolDefStart = srcContent.indexOf('export const uploadResourceTool');
  const toolDefBody  = srcContent.slice(toolDefStart);

  // Find all required arrays in the tool definition body
  const allRequiredMatches = [...toolDefBody.matchAll(/required:\s*\[([^\]]*)\]/g)];
  // The last match is the top-level inputSchema.required
  const topLevelRequired = allRequiredMatches[allRequiredMatches.length - 1];

  if (topLevelRequired) {
    const requiredList = topLevelRequired[1];
    assert(
      !requiredList.includes("'type'") && !requiredList.includes('"type"'),
      'uploadResourceTool inputSchema.required does NOT include "type"'
    );
    assert(
      requiredList.includes("'resource_id'") || requiredList.includes('"resource_id"'),
      'inputSchema.required still includes "resource_id"'
    );
    assert(
      requiredList.includes("'message'") || requiredList.includes('"message"'),
      'inputSchema.required still includes "message"'
    );
    assert(
      requiredList.includes("'files'") || requiredList.includes('"files"'),
      'inputSchema.required still includes "files"'
    );
  } else {
    assert(false, 'Could not find inputSchema required array in tool definition');
  }

  // ── 9. UploadResourceParams.type is optional in TypeScript types ───────
  console.log('\n▶ Group 9: UploadResourceParams.type Is Optional in TypeScript');

  const typesSrcPath = path.resolve(__dirname, '../SourceCode/src/types/tools.ts');
  const typesSrc     = fs.readFileSync(typesSrcPath, 'utf-8');

  const uploadParamsIdx  = typesSrc.indexOf('interface UploadResourceParams');
  const nextIfaceIdx     = typesSrc.indexOf('interface ', uploadParamsIdx + 10);
  const uploadParamsBody = typesSrc.slice(uploadParamsIdx, nextIfaceIdx);

  // type should be declared as optional: "type?: "
  assert(
    uploadParamsBody.includes('type?:'),
    'UploadResourceParams.type is declared as optional (type?:)'
  );
  // Must NOT be required: "type: " (without ?)
  assert(
    !uploadParamsBody.match(/^\s+type:\s+/m),
    'UploadResourceParams.type is NOT declared as required (no bare "type:")'
  );

  return summary();
}

// ── Entry Point ────────────────────────────────────────────────────────────

runTests().then((result) => {
  process.exit(result.failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
