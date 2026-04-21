# Fix Solution: Remove Resources Capability to Align with Standard Prompt Flow

**Bug ID:** BUG-2026-03-27-002

**Fixed Date:** 2026-03-27

**Fixed By:** AI Agent (based on user's async-pilot comparison analysis)

---

## 🎯 Root Cause

### The Problem Chain

```
Server declares resources: {} capability
  ↓
Cursor sees both prompts: {} and resources: {}
  ↓
Cursor tries to resolve prompt:// URIs as resources
  ↓
Cursor fails to complete resources/read flow (no request sent to server)
  ↓
Cursor does NOT fall back to prompts/get
  ↓
User sees empty/no content
```

### Key Insight from async-pilot

async-pilot 只声明 `prompts: {}` capability，强制 Cursor 走**唯一路径**：标准 prompt 流程（`prompts/list` → `prompts/get`）。

我们的实现多声明了 `resources: {}`，给了 Cursor **两条路径**：
1. 标准 prompt 路径：`prompts/list` → `prompts/get`
2. Resource 路径：`prompt://` URI → `resources/read`

**Cursor 优先选择了路径 2，但无法完成，也没有回退到路径 1。**

---

## 🔧 Fix Details

### Modified File
`SourceCode/src/server/http.ts`

### Change 1: Remove resources from capabilities

**Before (Line 159):**
```typescript
{ capabilities: { tools: {}, prompts: {}, resources: {}, logging: {} } }
```

**After:**
```typescript
{ capabilities: { tools: {}, prompts: {}, logging: {} } }
```

**Rationale**: 
- 对齐 async-pilot 的 capability 声明
- 移除 resources 选项，强制 Cursor 走标准 prompt 流程
- 保留 `logging: {}` 用于 server.sendLoggingMessage() 支持

---

### Change 2: Remove resources/list handler

**Before (Line 167):**
```typescript
server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [] }));
```

**After:**
```typescript
// Removed
```

**Rationale**: 
- 既然不声明 resources capability，就不需要 list handler
- 避免混淆信号

---

### Change 3: Remove resources/read handler

**Before (Lines 169-177):**
```typescript
// resources/read — Cursor probes `prompt://<name>` URIs to check if a
// prompt can be read as a resource.  Return an empty text content so the
// client does not display an error; it will fall back to prompts/get for
// actual content.
server.setRequestHandler(ReadResourceRequestSchema, (request) => {
  const uri = request.params.uri;
  logger.debug({ uri }, 'resources/read probe received — returning empty content');
  return { contents: [{ uri, text: '' }] };
});
```

**After:**
```typescript
// Removed
```

**Rationale**: 
- **这是短路的根源**
- 返回空内容并不会触发 Cursor 回退（假设错误）
- Cursor 可能在客户端层面已经判断"资源为空"，不再尝试其他路径
- 移除后，Cursor 只能走 `prompts/get`，符合 MCP 标准

---

### Change 4: Remove unused imports

**Before (Lines 15-16):**
```typescript
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
```

**After:**
```typescript
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
```

**Rationale**: Clean up unused imports after removing resources handlers

---

## 📝 Updated Code Comments

**New Comment (Lines 155-158):**
```typescript
// Declare prompts, tools, and logging capabilities only.
// REMOVED resources capability to align with async-pilot's working implementation.
// Cursor should use standard prompts/get instead of probing prompt:// as resources.
```

---

## 🧪 Why This Fix Should Work

### Theory
1. **单一路径原则**：
   - 移除 resources capability 后，Cursor 只有一条路径：`prompts/get`
   - 无分支选择，无短路可能

2. **对齐标准实现**：
   - async-pilot 证明了"只声明 prompts capability"在 stdio transport 下工作正常
   - SSE transport 应该遵循相同的 MCP 协议规范
   - 两者在 prompt 处理上应该一致

3. **GetPrompt handler 本身正常**：
   - `prompts/manager.ts` 中的 handler 代码完整且功能正常
   - `.prompt-cache/` 文件都已准备好
   - **只需让 Cursor 调用它**

---

## 🔍 Verification Plan

### 1. Deploy Fixed Version
```bash
cd SourceCode
npm run build
pm2 restart csp-ai-agent-mcp  # or docker restart
```

### 2. Test in Cursor
1. 重新连接 MCP Server（重启 Cursor 或重新加载 MCP）
2. 输入 `/acm-helper` 或其他 slash command
3. 选中 prompt

### 3. Check Logs
应该看到：
```json
{"level":30,"msg":"ListPrompts called"}
{"level":30,"msg":"GetPrompt request received","name":"acm-helper"}
{"level":30,"msg":"GetPrompt serving content from cache","cachePath":"..."}
{"level":30,"msg":"track_usage: invocation recorded","operation":"getPrompt","promptName":"acm-helper"}
```

### 4. Check Cursor UI
- ✅ Prompt 正文应该完整显示在对话框中
- ✅ 包含完整的指令和工作流程
- ✅ 用户可以正常使用 slash command

---

## 🚨 Rollback Plan

如果修复无效（GetPrompt 仍未触发）：

### Alternative Hypothesis
可能不是 resources capability 本身的问题，而是：
1. **Prompt metadata 格式**：`prompts/list` 返回的 metadata 可能缺少关键字段
2. **SSE transport 特性**：SSE 可能需要特殊处理（但可能性低，tools 工作正常）
3. **Cursor 版本特性**：某些 Cursor 版本可能有特殊行为

### Fallback Investigation
1. 检查 `promptManager.installHandlers()` 的 `ListPrompts` 返回格式
2. 对比 async-pilot 的 `prompts/list` 响应格式
3. 检查是否需要在 prompt metadata 中添加额外字段（如 `arguments`）

---

## 📊 Impact Assessment

### Positive Impact
- ✅ 简化代码：移除不必要的 resources handlers
- ✅ 对齐标准：与 async-pilot 和 MCP 最佳实践一致
- ✅ 降低复杂度：减少客户端分支选择的可能性
- ✅ 提高可维护性：更清晰的 capability 声明

### Risk Assessment
- ⚠️ **如果修复无效**：需要深入 Cursor 客户端行为，可能需要：
  - 抓包分析 Cursor 与 MCP Server 的完整交互
  - 对比 stdio 和 SSE 的实际协议差异
  - 检查 Cursor 版本特性
- ✅ **回退容易**：可以快速恢复 resources capability（如果证明此修复无效）

---

## 🔗 Related Files

### Modified
- `SourceCode/src/server/http.ts` (lines 12-17, 152-164)

### Unchanged (但相关)
- `SourceCode/src/prompts/manager.ts` (GetPrompt handler 实现正确，无需修改)
- `SourceCode/src/prompts/cache.ts` (prompt 缓存机制正常)
- `.prompt-cache/` (所有 prompt 文件完整)

---

## 📚 Lessons Learned

1. **最简化原则**：
   - MCP Server 应该只声明**真正实现**的 capabilities
   - 不要"预防性"声明额外 capabilities（如 resources）
   - 避免"兼容层"逻辑，除非有明确证据证明其必要性

2. **对标工作实现**：
   - 当某个功能不工作时，优先对比**已验证工作**的实现（如 async-pilot）
   - 找出关键差异点（这里是 capabilities 声明）
   - 最小化差异进行验证

3. **假设验证**：
   - 代码注释中的假设（"Cursor 会回退"）需要通过**实际日志**验证
   - 如果日志中没有预期行为（`resources/read` → `prompts/get` 回退），说明假设错误

4. **客户端行为不可控**：
   - MCP Server 只能控制服务端行为
   - 客户端（Cursor）的分支选择逻辑是黑盒
   - **最安全的策略**：提供**单一、标准、明确**的路径（标准 prompt 流程）

---

## 🎯 Success Criteria

修复成功的标准：
1. ✅ 编译通过（已完成）
2. ✅ 无 linter 错误（已完成）
3. ⏳ 部署后日志中出现 `GetPrompt request received`
4. ⏳ Cursor UI 中 prompt 正文正常显示
5. ⏳ 用户可以正常使用所有 slash commands
6. ⏳ 测试用例全部通过
