# Bug: Hardcoded CSP_API_TOKEN Causes All Users to Share One Token

**Bug ID:** BUG-2026-03-20-001  
**发现时间:** 2026-03-20  
**发现人:** Elliot Ding  
**严重程度:** Critical  
**状态:** In Progress  

---

## Bug 描述

MCP Server 部署在服务器上，所有用户共享同一个进程。`CSP_API_TOKEN` 被写死在服务器的 `.env` 文件中，`config/index.ts` 通过 `process.env.CSP_API_TOKEN` 读取它，并在 `api/client.ts` 的请求拦截器中统一注入到所有 HTTP 请求的 `Authorization: Bearer` 头。

结果是：无论哪个用户发起工具调用（`sync_resources`、`upload_resource`、`manage_subscription` 等），所有 CSP API 请求都携带同一个 Token，即服务器 `.env` 里硬编码的那个。

每个用户在自己 Cursor 的 `mcp.json` 中都配置了各自的 Token，但该 Token 当前完全没有被使用。

## 复现步骤

1. 在服务器 `.env` 中设置 `CSP_API_TOKEN=user-A-token`
2. 用户 B 在自己 `mcp.json` 中配置 Token：
   ```json
   {
     "mcpServers": {
       "csp-ai-agent": {
         "command": "npx",
         "args": ["@elliotding/ai-agent-mcp"],
         "env": { "CSP_API_TOKEN": "user-B-token" }
       }
     }
   }
   ```
3. 用户 B 调用 `sync_resources`
4. 观察服务器日志中的 `Authorization` 请求头

**预期结果：** CSP API 请求携带 `user-B-token`

**实际结果：** CSP API 请求携带服务器 `.env` 中的 `user-A-token`

## 受影响的文件

- `SourceCode/.env` — 硬编码了 `CSP_API_TOKEN`
- `SourceCode/.env.example` — 同样硬编码示例 Token
- `SourceCode/src/config/index.ts` — 从 `process.env.CSP_API_TOKEN` 静态读取 Token，在服务启动时固化
- `SourceCode/src/api/client.ts` — `APIClient` 构造时从 `config.csp.apiToken` 读取，整个生命周期使用同一值

## 根本原因

MCP stdio transport 模式下，Cursor 通过 `mcp.json` 的 `env` 字段向子进程注入环境变量。每个用户的 MCP 进程应当是独立的，用户自己的 Token 会通过 `process.env` 传入。但是：

1. 服务器部署模式（SSE/HTTP transport）下，所有用户共享一个 Node.js 进程，无法通过 `process.env` 区分用户
2. 即使是 stdio 模式，`config` 对象在模块初始化时就已创建，Token 在启动时固化，后续无法动态替换
3. `api/client.ts` 的 `APIClient` 在构造函数中读取 `config.csp.apiToken` 并固定到 axios 实例，无法按请求动态切换

## 环境信息

- 部署模式：SSE（服务器多用户共享进程）
- 相关文件：`src/config/index.ts`、`src/api/client.ts`、`.env`、`.env.example`
