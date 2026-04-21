# Bug Description

**Bug ID:** BUG-2026-03-27-001  
**Title:** Hash Calculation Mismatch Between MCP Server and AI Agent  
**Severity:** High  
**Status:** Fixed  
**Reported Date:** 2026-03-27  
**Reported By:** User (ElliotDing)

---

## Problem Summary

When `sync_resources` tool returns `local_actions_required` with `write_file` actions containing `content_hash` fields, the AI Agent (Cursor) was potentially using shell commands like `cat file | sha256sum` to verify if local files need updating.

This approach causes hash mismatches because:
1. Shell pipes may alter content (e.g., adding trailing newlines)
2. Different hash calculation tools may handle binary/text mode differently
3. `cat` command behavior varies across platforms (macOS/BSD vs Linux)

**Impact:** The AI Agent might unnecessarily rewrite files on every sync, or fail to update files that should be updated, breaking the content_hash optimization mechanism.

---

## Reproduction Steps

### User's Test Case

**Test Environment:**
- OS: macOS (darwin 25.3.0)
- MCP Server: Deployed in Docker container (remote)
- AI Agent: Running locally in Cursor IDE

**Test Commands:**
```bash
# Test 1: AI Agent's approach (wrong)
cat ~/.cursor/rules/csp-ai-prompts.mdc | sha256sum
# Result: a94b1188d407061b86e57c94c365d156166eb871291195c79d612f9b3efdda71

# Test 2: Correct approach
shasum -a 256 ~/.cursor/rules/csp-ai-prompts.mdc
# Result: 3f0535ad1e578867b24d240ea855b2664b66b0b0afb888517864698327159c74
```

**Expected Result:** Both should produce the same hash  
**Actual Result:** Different hashes

---

## Root Cause Analysis

### Issue 1: `cat | sha256sum` Adds Extra Bytes

On macOS, when `cat` outputs to a pipe, it may add trailing newlines to ensure POSIX text file compliance:

```bash
# File size
wc -c < file.mdc  # 4468 bytes

# Cat output size
cat file.mdc | wc -c  # 4469 bytes (added 1 newline)
```

This extra byte changes the hash completely.

### Issue 2: UTF-8 Char Count vs Byte Count Confusion

The MCP Server log shows `contentLength: 2608`, but the actual file size is `4468 bytes`.

This is because:
- `string.length` in JavaScript returns **character count** (2608 chars)
- Chinese characters are 1 char but occupy 3 bytes in UTF-8
- Actual byte size: `Buffer.byteLength(string, 'utf8')` = 4468 bytes

This confusion in logs may mislead debugging.

---

## Evidence from Logs

**MCP Server Log Entry (line 3043):**
```json
{
  "level": 30,
  "time": "2026-03-27T06:13:44.504Z",
  "resourceId": "0bbc520906995c7ca6ecb923aba141ca",
  "resourceName": "csp-ai-prompts",
  "files": [{
    "destPath": "~/.cursor/rules/csp-ai-prompts.mdc",
    "hash": "3f0535ad1e578867b24d240ea855b2664b66b0b0afb888517864698327159c74",
    "contentLength": 2608
  }]
}
```

**User's Local Test:**
```bash
cat ~/.cursor/rules/csp-ai-prompts.mdc | sha256sum
# a94b1188d407061b86e57c94c365d156166eb871291195c79d612f9b3efdda71
```

**Correct Calculation:**
```bash
shasum -a 256 ~/.cursor/rules/csp-ai-prompts.mdc
# 3f0535ad1e578867b24d240ea855b2664b66b0b0afb888517864698327159c74 ✅
```

---

## Files Affected

- `SourceCode/src/tools/sync-resources.ts` - Tool description and hash calculation
- `SourceCode/src/types/tools.ts` - WriteFileAction type definition and comments

---

## Impact Assessment

**Severity: High**

- **Functional Impact:** Content_hash optimization may not work correctly, causing unnecessary file rewrites
- **User Experience:** Slower sync operations, potential file timestamp changes
- **Data Integrity:** No data loss, but inefficient resource usage

---

## Notes

The issue was discovered when the user compared hash values between:
1. MCP Server's expected hash (from logs)
2. AI Agent's calculated hash (using `cat | sha256sum`)
3. Correct hash calculation (using `shasum -a 256`)

The mismatch revealed that shell-based hash calculation is unreliable due to:
- Platform-specific `cat` behavior
- Pipe-induced content modifications
- Text mode vs binary mode differences in hash tools
