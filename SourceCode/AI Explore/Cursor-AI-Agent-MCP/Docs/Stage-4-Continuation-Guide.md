# Stage 4 开发续接文档 - SSE Transport 待完成

**文档版本：** 1.0  
**创建日期：** 2026-03-10  
**状态：** 核心实现已完成，测试和配置待完成

---

## 📊 当前进度总结

### ✅ 已完成的核心实现（2026-03-10）

#### 1. HTTP Server 实现 ✅
**文件：** `SourceCode/src/server/http.ts`

**已实现：**
- Fastify HTTP 服务器配置
- CORS 和安全头（@fastify/cors, @fastify/helmet）
- 请求/响应日志记录
- **4个核心端点**：
  - `GET /` - 服务器信息
  - `GET /health` - 健康检查（返回 uptime, memory, active sessions）
  - `POST /sse` - SSE 连接建立（Bearer token 认证）
  - `POST /message` - 客户端消息处理
- Keepalive 机制（30秒心跳）
- 优雅关闭（关闭所有活跃连接）

**验证状态：** ✅ TypeScript 编译通过

---

#### 2. Session Manager ✅
**文件：** `SourceCode/src/session/manager.ts`

**已实现：**
- Session 生成（UUID）和追踪
- Session 元数据（userId, token, ip, createdAt, lastActivity）
- SSE 连接注册和管理
- 消息发送到客户端（via ServerResponse）
- Session 超时自动清理（默认 1 小时）
- 活跃 Session 统计

**核心方法：**
```typescript
createSession(token, ip) -> Session
getSession(sessionId) -> Session | undefined
registerConnection(sessionId, connection)
sendMessage(sessionId, message) -> boolean
closeSession(sessionId)
closeAllSessions()
getActiveSessionCount() -> number
```

**验证状态：** ✅ TypeScript 编译通过

---

#### 3. SSE Transport 实现 ✅
**文件：** `SourceCode/src/transport/sse.ts`

**已实现：**
- MCP 协议消息处理
- **支持的方法**：
  - `initialize` - 初始化握手
  - `tools/list` - 列出所有工具
  - `tools/call` - 调用工具
  - `ping` - Keepalive 心跳
- JSON-RPC 2.0 格式支持
- 错误处理和错误响应
- 与 Tool Registry 集成

**验证状态：** ✅ TypeScript 编译通过

---

#### 4. 配置更新 ✅
**文件：** 
- `SourceCode/src/config/index.ts` - 配置加载
- `SourceCode/.env.example` - 环境变量模板

**新增配置项：**
```bash
# Transport Configuration
TRANSPORT_MODE=stdio          # stdio (dev) or sse (prod)

# HTTP Server (for SSE)
HTTP_HOST=0.0.0.0
HTTP_PORT=3000

# Session Management
SESSION_TIMEOUT=3600          # seconds (1 hour)
```

**Config 接口更新：**
```typescript
interface Config {
  transport: { mode: 'stdio' | 'sse' };
  http?: { host: string; port: number };
  session?: { timeout: number };
  // ... existing config
}
```

**验证状态：** ✅ TypeScript 编译通过

---

#### 5. 双传输支持 ✅
**文件：** `SourceCode/src/server.ts`

**已实现：**
- 基于 `TRANSPORT_MODE` 环境变量选择传输模式
- **stdio 模式**：启动 stdio transport（原有逻辑）
- **sse 模式**：启动 HTTP server + SSE transport
- 工具注册对两种传输模式通用
- 优雅关闭支持两种模式

**验证状态：** ✅ TypeScript 编译通过，构建成功

---

#### 6. Tool Registry 增强 ✅
**文件：** `SourceCode/src/tools/registry.ts`

**新增方法：**
```typescript
async callTool(name: string, args: Record<string, unknown>): Promise<unknown>
```

用于 SSE Transport 调用工具（避免重复 MCP SDK 逻辑）

**验证状态：** ✅ TypeScript 编译通过

---

#### 7. 依赖安装 ✅
```bash
npm install --save fastify @fastify/cors @fastify/helmet
```

**package.json 状态：** ✅ 已更新

---

## 🚧 待完成任务（下一个对话）

### 任务清单

#### 8. 创建测试环境配置 🔴 **高优先级**

##### 8.1 创建本地 .env 配置
**文件：** `SourceCode/.env`

```bash
# 从 .env.example 复制并配置
cp SourceCode/.env.example SourceCode/.env

# 关键配置：
TRANSPORT_MODE=sse
HTTP_HOST=127.0.0.1
HTTP_PORT=3000
CSP_API_TOKEN=test-token-12345
```

##### 8.2 创建 Cursor MCP 配置
**文件：** `~/.cursor/mcp.json` 或项目级 `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "csp-ai-agent-local": {
      "command": "node",
      "args": [
        "/Users/ElliotDing/SourceCode/AI Explore/Cursor-AI-Agent-MCP/SourceCode/dist/index.js"
      ],
      "env": {
        "TRANSPORT_MODE": "sse",
        "HTTP_HOST": "127.0.0.1",
        "HTTP_PORT": "3000"
      },
      "transport": {
        "type": "sse",
        "url": "http://127.0.0.1:3000/sse",
        "messageEndpoint": "http://127.0.0.1:3000/message"
      },
      "auth": {
        "type": "bearer",
        "token": "test-token-12345"
      }
    }
  }
}
```

**注意：** 需要确认 Cursor 支持的 SSE MCP 配置格式（可能需要调整）

##### 8.3 创建本地测试脚本
**文件：** `Test/test-stage4-sse-local.js`

**测试内容：**
- 启动本地 SSE 服务器
- 建立 SSE 连接
- 发送 initialize 请求
- 发送 tools/list 请求
- 发送 tools/call 请求（测试 sync_resources）
- 验证响应格式
- 测试 keepalive 心跳
- 测试 session 超时

##### 8.4 创建 Nginx 反向代理配置
**文件：** `Test/nginx-sse-proxy.conf`

```nginx
upstream mcp_sse_backend {
    server 127.0.0.1:3000;
}

server {
    listen 8080;
    server_name localhost;

    # SSE endpoint
    location /sse {
        proxy_pass http://mcp_sse_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # SSE specific
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
        proxy_connect_timeout 5s;
        
        # Keep-alive
        chunked_transfer_encoding on;
        tcp_nodelay on;
    }

    # Message endpoint
    location /message {
        proxy_pass http://mcp_sse_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Health check
    location /health {
        proxy_pass http://mcp_sse_backend;
        proxy_http_version 1.1;
    }
}
```

**使用方法：**
```bash
# 测试配置
nginx -t -c Test/nginx-sse-proxy.conf

# 启动 Nginx
nginx -c Test/nginx-sse-proxy.conf
```

---

#### 9. 手动测试 SSE 连接 🔴 **高优先级**

##### 9.1 启动本地 SSE 服务器
```bash
cd SourceCode

# 设置环境变量
export TRANSPORT_MODE=sse
export HTTP_HOST=127.0.0.1
export HTTP_PORT=3000

# 启动服务器
npm run build
node dist/index.js

# 或使用 dev 模式
npm run dev
```

##### 9.2 测试健康检查
```bash
curl http://127.0.0.1:3000/health
```

**预期响应：**
```json
{
  "status": "healthy",
  "uptime": 123,
  "memory": {
    "used": 45,
    "total": 128,
    "percentage": 35
  },
  "sessions": {
    "active": 0,
    "total": 0
  },
  "timestamp": "2026-03-10T12:00:00.000Z"
}
```

##### 9.3 测试 SSE 连接（使用 curl）
```bash
# 建立 SSE 连接
curl -N -H "Authorization: Bearer test-token-12345" \
  -H "Accept: text/event-stream" \
  -X POST http://127.0.0.1:3000/sse

# 预期输出：
# data: {"type":"connected","sessionId":"<uuid>"}
# :keepalive
# :keepalive
# ...
```

##### 9.4 发送消息到服务器
```bash
# 获取 session ID（从上一步的响应）
SESSION_ID="<uuid-from-sse-response>"

# 发送 initialize 请求
curl -X POST http://127.0.0.1:3000/message \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "'$SESSION_ID'",
    "message": {
      "jsonrpc": "2.0",
      "id": 1,
      "method": "initialize",
      "params": {}
    }
  }'

# 发送 tools/list 请求
curl -X POST http://127.0.0.1:3000/message \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "'$SESSION_ID'",
    "message": {
      "jsonrpc": "2.0",
      "id": 2,
      "method": "tools/list"
    }
  }'

# 发送 tools/call 请求
curl -X POST http://127.0.0.1:3000/message \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "'$SESSION_ID'",
    "message": {
      "jsonrpc": "2.0",
      "id": 3,
      "method": "tools/call",
      "params": {
        "name": "sync_resources",
        "arguments": {
          "mode": "check"
        }
      }
    }
  }'
```

**注意：** 响应会通过 SSE 连接返回，需要在第一个终端（curl -N）中查看

---

#### 10. 创建集成测试 🟡 **中优先级**

**文件：** `Test/test-stage4-integration.js`

**测试内容：**
1. 编译输出验证（dist/ 目录）
2. 配置文件验证（.env.example）
3. HTTP Server 模块验证
4. Session Manager 模块验证
5. SSE Transport 模块验证
6. 双传输模式切换验证
7. 文档完整性验证

**运行命令：**
```bash
cd Test
node test-stage4-integration.js
```

---

#### 11. 创建阶段性文档 📝 **必需**

**文件：** `Docs/Stage-4-SSE-HTTP-Server.md`

**内容大纲：**
```markdown
# Stage 4: SSE Transport and HTTP Server - 阶段性实现记录

## 📋 阶段目标
实现 SSE 传输协议和 HTTP Server，使 MCP Server 能够部署到远程服务器

## ✅ 已完成功能
1. HTTP Server 实现（Fastify）
2. Session Manager
3. SSE Transport
4. 配置更新
5. 双传输支持

## 🏗️ 关键实现
[详细记录每个模块的实现细节]

## 🎯 设计决策
1. 为什么选择 Fastify？
2. Session 超时时间选择
3. Keepalive 间隔选择

## ⚠️ 与初始设计的差异
[记录实际实现与设计文档的差异]

## 📊 测试情况
[测试用例和结果]

## 🔗 相关文档
- OpenSpec: openspec/changes/stage-4-sse-http-server/
- README.md 更新
```

---

#### 12. 更新 README.md 📝

**更新内容：**
```markdown
### ✅ 已实现功能 (Stage 1, 2, 3 & 4)

- **SSE Transport and HTTP Server** ✅ (Stage 4)
  - Fastify HTTP server
  - SSE (Server-Sent Events) 传输协议
  - Session 管理和追踪
  - 双传输支持（stdio + SSE）
  - Health check 和监控
  - Bearer token 认证
  - Keepalive 机制
```

---

#### 13. 归档 OpenSpec 🟢 **完成后**

```bash
cd "/Users/ElliotDing/SourceCode/AI Explore/Cursor-AI-Agent-MCP"

# 更新 tasks.md 标记所有任务完成
# 然后归档
openspec archive stage-4-sse-http-server --skip-specs --yes
```

---

## 🔧 开发指南（下一个对话）

### 开始工作流程

1. **确认当前状态**
   ```bash
   cd SourceCode
   npm run type-check  # 应该通过
   npm run build       # 应该成功
   ```

2. **创建测试环境配置**
   - 创建 `.env` 文件
   - 配置 Cursor mcp.json
   - 创建 Nginx 配置

3. **启动本地 SSE 服务器测试**
   ```bash
   export TRANSPORT_MODE=sse
   npm run build
   node dist/index.js
   ```

4. **手动测试 SSE 端点**
   - 测试 /health
   - 测试 /sse 连接
   - 测试 /message 处理

5. **创建自动化测试**
   - test-stage4-integration.js
   - test-stage4-sse-local.js

6. **验证编译和测试**
   ```bash
   npm run type-check
   npm run build
   node ../Test/test-stage4-integration.js
   ```

---

## 📦 核心文件清单

**已创建的核心文件：**
- ✅ `SourceCode/src/server/http.ts` - HTTP Server
- ✅ `SourceCode/src/session/manager.ts` - Session Manager
- ✅ `SourceCode/src/transport/sse.ts` - SSE Transport
- ✅ `SourceCode/src/server.ts` - 双传输支持（已更新）
- ✅ `SourceCode/src/config/index.ts` - 配置（已更新）
- ✅ `SourceCode/src/tools/registry.ts` - Tool Registry（已更新）
- ✅ `SourceCode/.env.example` - 环境变量模板（已更新）

**待创建的文件：**
- ⏳ `SourceCode/.env` - 本地配置
- ⏳ `Test/test-stage4-integration.js` - 集成测试
- ⏳ `Test/test-stage4-sse-local.js` - SSE 本地测试
- ⏳ `Test/nginx-sse-proxy.conf` - Nginx 配置
- ⏳ `Docs/Stage-4-SSE-HTTP-Server.md` - 阶段性文档
- ⏳ `.cursor/mcp.json` 或 `~/.cursor/mcp.json` - Cursor 配置

---

## 🎯 成功标准

完成 Stage 4 后，应满足以下标准：

1. ✅ HTTP Server 启动并监听配置端口
2. ⏳ SSE 连接可以成功建立
3. ⏳ MCP 协议消息正常处理（initialize, tools/list, tools/call）
4. ⏳ Session 管理正常工作（创建、追踪、超时）
5. ⏳ Keepalive 心跳正常工作
6. ⏳ 多个并发连接支持
7. ⏳ 优雅关闭工作正常
8. ⏳ 所有自动化测试通过（100%）
9. ⏳ 可以从 Cursor IDE 通过 SSE 连接服务器
10. ⏳ 通过 Nginx 反向代理可以访问

---

## 🚨 注意事项

### 1. SSE 连接测试
- SSE 是单向流（server → client），客户端消息通过 POST /message 发送
- 需要保持 SSE 连接打开才能接收服务器响应
- Keepalive 每 30 秒发送一次，防止连接超时

### 2. Cursor MCP 配置
- **重要**：需要确认 Cursor 支持的 SSE MCP 配置格式
- 可能需要查看 Cursor 文档或 MCP SDK 的 SSE client 示例
- Bearer token 认证方式需要与 Cursor 兼容

### 3. 测试策略
- 先用 curl 手动测试验证 SSE 端点工作正常
- 再用自动化测试脚本测试完整流程
- 最后用 Cursor IDE 测试真实集成

### 4. 性能考虑
- Session 超时默认 1 小时，可根据实际情况调整
- Keepalive 间隔 30 秒，可根据网络情况调整
- 内存监控：定期检查 Session Map 大小

---

## 📞 继续开发的命令

```bash
# 1. 确认当前状态
cd "/Users/ElliotDing/SourceCode/AI Explore/Cursor-AI-Agent-MCP/SourceCode"
npm run type-check
npm run build

# 2. 创建本地 .env 配置
cp .env.example .env
# 编辑 .env，设置 TRANSPORT_MODE=sse

# 3. 启动本地 SSE 服务器
export TRANSPORT_MODE=sse
node dist/index.js

# 4. 测试健康检查（新终端）
curl http://127.0.0.1:3000/health

# 5. 测试 SSE 连接（新终端）
curl -N -H "Authorization: Bearer test-token-12345" \
  -H "Accept: text/event-stream" \
  -X POST http://127.0.0.1:3000/sse

# 6. 创建测试脚本
cd ../Test
# 创建 test-stage4-integration.js 和 test-stage4-sse-local.js

# 7. 运行测试
node test-stage4-integration.js
```

---

## 📋 OpenSpec 状态

**OpenSpec 提案：** `openspec/changes/stage-4-sse-http-server/`

**状态：** ✅ 已创建并验证通过

**待完成：**
- 更新 tasks.md 标记完成的任务
- 测试完成后归档：`openspec archive stage-4-sse-http-server --skip-specs --yes`

---

**文档完成日期：** 2026-03-10  
**核心实现状态：** ✅ 完成并通过编译  
**下一个对话起点：** 创建测试环境配置和手动测试 SSE 连接（任务 8-9）

---

## 🔑 关键提示

**最重要的下一步是：**
1. 创建 `.env` 配置文件（设置 `TRANSPORT_MODE=sse`）
2. 启动本地 SSE 服务器
3. 用 `curl` 手动测试 SSE 连接是否正常工作
4. 如果 SSE 连接正常，再配置 Cursor mcp.json
5. 最后创建自动化测试和文档

**如果遇到问题：**
- 检查日志：`Logs/app-2026-03-10.log`
- 查看 HTTP Server 启动日志
- 验证 Session 创建和 SSE 连接建立
- 确认消息处理正常工作

祝顺利完成 Stage 4！🚀
