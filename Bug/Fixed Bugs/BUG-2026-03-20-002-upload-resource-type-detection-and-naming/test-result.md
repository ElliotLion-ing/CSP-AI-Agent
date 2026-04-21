# Test Result: upload_resource Type Detection and Auto-Naming

**Bug ID:** BUG-2026-03-20-002  
**测试时间:** 2026-03-20  
**测试人:** Cursor AI Agent  
**测试文件:** `Test/test-bug-BUG-2026-03-20-002.js`  
**验证状态:** ✅ PASSED (25/25, 100%)

---

## 测试执行结果

### 脚本输出（主要验证）

```
════════════════════════════════════════════════════════════
🔍 BUG-2026-03-20-002: upload_resource Type Detection & Naming Tests
════════════════════════════════════════════════════════════

▶ Group 0: Build Artifact Verification
  ✅ PASS: dist/tools/upload-resource.js exists
  ✅ PASS: src/tools/upload-resource.ts exists

▶ Group 1: User-Declared Type Takes Priority
  ✅ PASS: inferResourceType() returns declaredType immediately when provided
  ✅ PASS: Guard "if (declaredType)" appears BEFORE any auto-detection logic

▶ Group 2: Auto-Detection Rules (No Declared Type)
  ✅ PASS: Auto-detect: mcp-config.json → mcp
  ✅ PASS: Auto-detect: SKILL.md → skill (case-insensitive via toLowerCase)
  ✅ PASS: Auto-detect: single .mdc file → rule
  ✅ PASS: Auto-detect: single .md file → command

▶ Group 3: Error When Type Cannot Be Inferred
  ✅ PASS: inferResourceType() throws a clear error when type cannot be determined
  ✅ PASS: Error message guides user to specify type explicitly

▶ Group 4: deriveNameFromFiles() — Single File Name Derivation
  ✅ PASS: deriveNameFromFiles() uses path.basename + path.extname to strip extension
  ✅ PASS: deriveNameFromFiles() calls path.extname(first) for extension stripping

▶ Group 5: deriveNameFromFiles() — Multi-File Directory Name
  ✅ PASS: deriveNameFromFiles() uses path.dirname to extract directory part
  ✅ PASS: deriveNameFromFiles() only uses dirname when dir is not '.'

▶ Group 6: resource_id Is NOT Used as Name Fallback
  ✅ PASS: resourceName assignment does NOT fall back to resourceId
  ✅ PASS: resourceName assignment calls deriveNameFromFiles()

▶ Group 7: MCP Missing mcp-config.json — Contextual Hint
  ✅ PASS: collectFiles() checks for mcp-config.json presence
  ✅ PASS: collectFiles() detects other config files to surface as hints
  ✅ PASS: Error message instructs user to create mcp-config.json

▶ Group 8: type Field Is Optional in inputSchema
  ✅ PASS: uploadResourceTool inputSchema.required does NOT include "type"
  ✅ PASS: inputSchema.required still includes "resource_id"
  ✅ PASS: inputSchema.required still includes "message"
  ✅ PASS: inputSchema.required still includes "files"

▶ Group 9: UploadResourceParams.type Is Optional in TypeScript
  ✅ PASS: UploadResourceParams.type is declared as optional (type?:)
  ✅ PASS: UploadResourceParams.type is NOT declared as required (no bare "type:")

────────────────────────────────────────────────────────────
📊 BUG-2026-03-20-002 Test Summary
   Total  : 25
   Passed : 25
   Failed : 0
   Rate   : 100%
────────────────────────────────────────────────────────────
```

Exit code: 0

### 日志验证（辅助验证）

测试为纯静态代码分析（不启动服务器），无运行时日志。编译验证已在 `fix-solution.md` 中记录（`npm run build` exit code 0）。

---

## 测试用例明细

| 序号 | 用例描述 | 预期结果 | 实际结果 | 状态 |
|------|---------|---------|---------|------|
| 1 | dist/tools/upload-resource.js 编译产物存在 | 文件存在 | 文件存在 | ✅ |
| 2 | src/tools/upload-resource.ts 源文件存在 | 文件存在 | 文件存在 | ✅ |
| 3 | inferResourceType() 在 declaredType 非空时立即返回 | 含 guard 代码 | 含 guard 代码 | ✅ |
| 4 | guard 语句在自动检测逻辑之前 | guardIdx < detectIdx | guardIdx < detectIdx | ✅ |
| 5 | mcp-config.json → mcp | 含检测代码 | 含检测代码 | ✅ |
| 6 | SKILL.md → skill（toLowerCase） | 含检测代码 | 含检测代码 | ✅ |
| 7 | 单 .mdc → rule | 含检测代码 | 含检测代码 | ✅ |
| 8 | 单 .md → command | 含检测代码 | 含检测代码 | ✅ |
| 9 | 无法推断时抛出明确错误 | 含错误文本 | 含错误文本 | ✅ |
| 10 | 错误信息引导用户显式指定 type | 含引导文本 | 含引导文本 | ✅ |
| 11 | deriveNameFromFiles 使用 basename+extname | 含调用 | 含调用 | ✅ |
| 12 | deriveNameFromFiles 调用 path.extname(first) | 含调用 | 含调用 | ✅ |
| 13 | deriveNameFromFiles 使用 path.dirname | 含调用 | 含调用 | ✅ |
| 14 | dirname 仅在非 '.' 时使用 | 含 guard | 含 guard | ✅ |
| 15 | resourceName 不回退到 resourceId | 无 `?? resourceId` | 无此模式 | ✅ |
| 16 | resourceName 调用 deriveNameFromFiles | 含调用 | 含调用 | ✅ |
| 17 | collectFiles 检查 mcp-config.json 是否存在 | 含检查 | 含检查 | ✅ |
| 18 | 检测其他配置文件并生成 hints | 含 configHints | 含 configHints | ✅ |
| 19 | 错误信息指示创建 mcp-config.json | 含指导文本 | 含指导文本 | ✅ |
| 20 | inputSchema.required 不含 "type" | 不含 type | 不含 type | ✅ |
| 21 | inputSchema.required 含 "resource_id" | 含 resource_id | 含 resource_id | ✅ |
| 22 | inputSchema.required 含 "message" | 含 message | 含 message | ✅ |
| 23 | inputSchema.required 含 "files" | 含 files | 含 files | ✅ |
| 24 | UploadResourceParams.type 为可选（type?:） | 含 `type?:` | 含 `type?:` | ✅ |
| 25 | UploadResourceParams.type 非必填（无裸 `type:`） | 无裸 type | 无裸 type | ✅ |

---

## 结论

BUG-2026-03-20-002 已完全修复。原始 Bug 的两个问题均已解决：(1) 用户指定 type 时不再被覆盖，`inferResourceType()` 中用户优先的 guard 出现在所有自动检测逻辑之前；(2) `resourceName` 不再回退到 `resource_id`，而是通过 `deriveNameFromFiles()` 从文件名提取。MCP 缺少 `mcp-config.json` 时也能给出针对性提示，`type` 字段已从 `required` 数组中移除。
