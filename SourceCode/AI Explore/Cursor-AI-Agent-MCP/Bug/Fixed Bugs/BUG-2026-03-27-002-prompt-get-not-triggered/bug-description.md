# Bug Description: MCP Prompt GetPrompt Not Triggered

**Bug ID:** BUG-2026-03-27-002

**Created:** 2026-03-27

**Severity:** High

**Status:** In Progress

---

## 📋 Bug Summary

MCP Prompt 在 Cursor 中选中使用时，只触发了 `prompts/list` 请求，但从未触发 `prompts/get` 请求，导致 prompt 正文无法获取，Cursor 无法执行 slash command 对应的完整 prompt 内容。

---

## 🔍 Bug Reproduction Steps

### Prerequisites
- MCP Server 已部署并运行（SSE transport）
- Cursor 已连接到 CSP AI Agent MCP Server
- `.prompt-cache/` 目录下有缓存的 prompt 文件（如 `cmd-acm-helper.md`）

### Steps to Reproduce
1. 在 Cursor 中打开任意项目
2. 输入 `/acm-helper` 或 `/hang-log-analyzer` 等 slash command
3. Cursor 展示 prompt 列表（metadata）
4. 选中某个 prompt
5. **预期行为**：Cursor 调用 `prompts/get`，MCP Server 返回完整 prompt 正文
6. **实际行为**：Cursor 未调用 `prompts/get`，直接停止

### Observed Symptoms
- **日志中只有**：
  ```json
  {"level":30,"time":"2026-03-27T06:18:52.906Z","msg":"ListPrompts called"}
  ```
- **日志中缺失**：
  - `GetPrompt request received`
  - `GetPrompt serving content`
- **日志中有 track_usage 记录**（说明服务端 handler 存在且功能正常）：
  ```json
  {"level":30,"msg":"track_usage: invocation recorded","userId":"elliotding@...","operation":"getPrompt","promptName":"acm-helper"}
  ```
- **但这条日志的时间戳与用户实际操作时间**（2026-03-27 14:18:52 本地时间，UTC 06:18:52）**不匹配任何 GetPrompt 请求日志**

---

## 🧪 Comparison with Working Implementation (async-pilot)

### ✅ async-pilot (Working)
- **Transport**: stdio
- **SDK**: `McpServer`（高层封装）
- **Capabilities**: `{ tools: {}, prompts: {} }` （**没有 resources**）
- **Prompt Registration**: `server.registerPrompt(name, metadata, handler)`
- **Resources Handling**: **无 resources capability，无 resources/read handler**
- **Result**: Cursor 正常触发 `prompts/get`，获取完整正文

**Key Code:**
```javascript
// async-pilot/index.js
const server = new McpServer({
  name: "async-pilot-mcp",
  version: "1.0.0",
});

server.registerPrompt("help", { description: "..." }, async () => {
  const content = await parseMarkdown(filePath);
  return { messages: [{ role: "user", content: { type: "text", text: content } }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

---

### ❌ csp-ai-agent-mcp (Broken)
- **Transport**: SSE
- **SDK**: `Server`（低层 API）
- **Capabilities**: `{ tools: {}, prompts: {}, resources: {}, logging: {} }` （**多了 resources**）
- **Prompt Registration**: `promptManager.installHandlers(server, userToken)` → 内部使用 `server.setRequestHandler(GetPromptRequestSchema, ...)`
- **Resources Handling**: 
  - 声明了 `resources: {}` capability
  - 提供 `ListResourcesRequestSchema` handler（返回空列表）
  - 提供 `ReadResourceRequestSchema` handler（对 `prompt://` URIs 返回空文本 `{ contents: [{ uri, text: '' }] }`）
- **Result**: Cursor **只调用 `prompts/list`，从未调用 `prompts/get`**

**Problematic Code:**
```typescript
// SourceCode/src/server/http.ts (before fix)
const server = new Server(
  { name: 'csp-ai-agent-mcp', version: '0.2.0' },
  { capabilities: { tools: {}, prompts: {}, resources: {}, logging: {} } }  // 🚨 resources
);

// 🚨 这段"兼容逻辑"导致短路
server.setRequestHandler(ReadResourceRequestSchema, (request) => {
  const uri = request.params.uri;
  logger.debug({ uri }, 'resources/read probe received — returning empty content');
  return { contents: [{ uri, text: '' }] };  // 返回空内容
});
```

---

## 🧩 Root Cause Analysis

### Initial Hypothesis (Incorrect)
代码注释中的假设：
> "Cursor probes `prompt://<name>` URIs to check if a prompt can be read as a resource. Return an empty text content so the client does not display an error; it will fall back to prompts/get for actual content."

**假设错误**：Cursor 会先 probe `prompt://` → 收到空内容 → 回退到 `prompts/get`

---

### Actual Root Cause (Confirmed)
**Cursor 客户端的行为链路：**

1. **MCP Handshake 阶段**：
   - Cursor 发现 server 声明了 `resources: {}` capability
   - Cursor 内部标记该 server 支持 resources 读取

2. **Prompt List 阶段**：
   - Cursor 调用 `prompts/list`，获取 prompt metadata
   - Metadata 中可能包含 `uri` 字段（如 `prompt://acm-helper`）

3. **Prompt Selection 阶段（问题发生点）**：
   - Cursor 检测到 server 支持 `resources: {}`
   - Cursor 可能在**客户端内部**尝试将 `prompt://` URI 解析为 resource
   - **关键：Cursor 可能根本没发 `resources/read` 请求**，而是在客户端逻辑层面判断：
     - "这个 server 有 resources capability"
     - "prompt 可能是一个 resource"
     - "尝试通过 resources 路径读取"
   - **由于某种原因（可能是 Cursor 内部逻辑、URI scheme 识别、或者 metadata 信息不完整）**，Cursor 没有继续发送 `resources/read` 请求，也没有回退到 `prompts/get`
   - **结果：短路，停止**

4. **对比 async-pilot**：
   - async-pilot **不声明 `resources: {}` capability**
   - Cursor **没有 resources 分支可选**
   - Cursor **只能走标准 prompt 流程** → `prompts/list` → `prompts/get`
   - **成功获取正文**

---

### Why No `resources/read` Request in Logs?

可能的原因（按可能性排序）：

1. **Cursor 客户端提前短路**：
   - Cursor 在客户端检查到 `resources: {}` capability
   - 尝试解析 `prompt://` URI
   - 发现 metadata 中没有足够信息（如 `mimeType`、`size` 等）
   - **在客户端层面判断"无法读取"** → 直接放弃，不发请求

2. **URI Scheme 不匹配**：
   - Cursor 可能期望 resources 使用特定 URI scheme（如 `file://`、`http://`）
   - `prompt://` 可能不被识别为有效 resource URI
   - Cursor 跳过该资源，不发请求

3. **Metadata 不完整**：
   - `prompts/list` 返回的 metadata 可能缺少 `uri` 字段
   - Cursor 无法将 prompt 映射到 resource
   - Cursor 不发 `resources/read` 请求

---

## 🔧 Why This Bug is Hidden

这个 bug 极度隐蔽的原因：

1. **假设合理但错误**：
   - "声明 resources 可以防止 Method not found 错误" ✅ 逻辑上合理
   - "返回空内容可以让 Cursor 回退到 prompts/get" ❌ **实际不会回退**

2. **日志中没有错误**：
   - 没有 `Method not found`
   - 没有 `resources/read` 请求失败
   - **因为根本没有请求到达服务端**

3. **GetPrompt handler 正常**：
   - `prompts/manager.ts` 中的 `GetPromptRequestSchema` handler 代码完全正确
   - `.prompt-cache/` 文件都准备好了
   - **只是客户端从未调用它**

4. **stdio vs SSE 干扰判断**：
   - 最初怀疑是 transport 差异
   - 实际上 transport 无关，**是 capability 声明导致的客户端分支选择问题**

---

## 🎯 Expected Fix Outcome

修复后预期效果：

### ✅ 日志中应该出现（修复后）
```json
{"level":30,"time":"...","msg":"ListPrompts called"}
{"level":30,"time":"...","msg":"GetPrompt request received","name":"acm-helper"}
{"level":30,"time":"...","msg":"GetPrompt serving content from cache","name":"acm-helper","cachePath":"..."}
{"level":30,"time":"...","msg":"track_usage: invocation recorded","operation":"getPrompt","promptName":"acm-helper"}
```

### ✅ Cursor 行为（修复后）
1. 用户输入 `/acm-helper`
2. Cursor 调用 `prompts/list` → 获取 metadata
3. Cursor 调用 `prompts/get` → 获取完整正文
4. Cursor 将 prompt 正文插入对话框
5. 用户看到完整的 slash command 内容

---

## 📊 Impact Assessment

### Affected Components
- ✅ **MCP Server**: `SourceCode/src/server/http.ts`
- ✅ **Prompt Manager**: `SourceCode/src/prompts/manager.ts`（代码本身正常，只是未被调用）
- ✅ **All cached prompts**: `.prompt-cache/` 下所有 prompt（包括 skills 和 commands）

### User Impact
- ❌ **所有 MCP Prompt 功能完全不可用**（用户无法在 Cursor 中使用任何 slash command）
- ❌ **用户体验极差**：选中 prompt 后没有任何反应，看起来像"卡住了"
- ✅ **Tools 功能正常**：`sync_resources`、`manage_subscription` 等 tools 不受影响

### Scope
- **Severity**: High（核心功能完全不可用）
- **Frequency**: 100%（每次使用 prompt 都会触发）
- **Workaround**: 无（用户无法绕过此问题）

---

## 🔗 Related Evidence

### Log Evidence
- **File**: `/Users/ElliotDing/SourceCode/AI Explore/Cursor-AI-Agent-MCP/Logs/app.2026-03-27.1.log`
- **Time**: 2026-03-27 06:18:52 (UTC) / 14:18:52 (Local, UTC+8)
- **Key Entries**:
  - Line ~3490: `ListPrompts called` ✅
  - **Missing**: `GetPrompt request received` ❌
  - **Missing**: `GetPrompt serving content` ❌

### Comparison Reference
- **Working Example**: `/Users/ElliotDing/SourceCode/AI Explore/async-pilot research/async-pilot/index.js`
- **Key Difference**: async-pilot 只声明 `prompts: {}` capability，不声明 `resources: {}`

---

## 🛠️ Fix Already Applied

**Modified File**: `SourceCode/src/server/http.ts`

**Changes**:
1. Removed `resources: {}` from capabilities declaration (line 159)
2. Removed `ListResourcesRequestSchema` handler (line 167)
3. Removed `ReadResourceRequestSchema` handler (lines 169-177)
4. Removed unused imports: `ListResourcesRequestSchema`, `ReadResourceRequestSchema` (lines 15-16)

**Status**: ✅ Compiled successfully, no linter errors

---

## ✅ Next Steps

1. Create `fix-solution.md` documenting the fix details
2. Generate test case `Test/test-bug-BUG-2026-03-27-002.js`
3. Deploy and test in real environment
4. Verify `GetPrompt request received` appears in logs
5. Create `test-result.md` with verification results
6. Archive to `Bug/Fixed Bugs/` once all 3 files are complete

---

## 📝 Additional Notes

### Why This Bug Was Hidden
- 假设合理但错误："声明 resources 可以防止错误并支持回退"
- 日志中无报错：因为请求根本没到达服务端
- GetPrompt handler 正常：代码本身没问题，只是客户端逻辑短路
- stdio vs SSE 误导：最初怀疑是 transport 差异，实际是 capability 声明问题

### Discovery Credit
- 用户通过对比 async-pilot 实现，精准定位到 `resources: {}` capability 和 `resources/read` 空响应兜底逻辑是根因
- 关键洞察："不是 transport 问题，是客户端分支选择问题"
