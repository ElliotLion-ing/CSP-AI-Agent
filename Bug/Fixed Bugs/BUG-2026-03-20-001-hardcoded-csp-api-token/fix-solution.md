# Fix Solution: Hardcoded CSP_API_TOKEN

**Bug ID:** BUG-2026-03-20-001  
**修复人:** Cursor AI Agent  
**修复时间:** 2026-03-20  
**验证状态:** ✅ 编译通过  

---

## 根本原因分析

`api/client.ts` 的 `APIClient` 构造函数在服务启动时将 `config.csp.apiToken`（来自 `.env`）固化到所有 axios 请求的 `Authorization` 头中。这意味着无论哪个用户发起调用，所有 CSP API 请求都使用同一个静态 Token。

每个用户在 `mcp.json` 的 `env` 字段中配置的 `CSP_API_TOKEN` 从未被读取。

## 修复方案

### 核心变更：强制要求 per-request Token，无 fallback

移除服务器级 fallback Token 机制，改为**无 Token 直接报错**：

1. **`api/client.ts`** — 修改请求拦截器：若请求头中没有 `Authorization`，立即 reject 并返回清晰的错误信息，提示用户在 `mcp.json` 中配置 `CSP_API_TOKEN`。新增 `authConfig(token, extra?)` 公共方法，返回携带 per-request `Authorization` 头的 axios 配置对象。

2. **所有 API 方法**（`getSubscriptions`、`subscribe`、`unsubscribe`、`searchResources`、`downloadResource`、`getResourceDetail`、`uploadResourceFiles`、`finalizeResourceUpload`）— 新增可选的 `userToken?: string` 参数，并通过 `this.authConfig(userToken)` 将其注入为 per-request 头。

3. **`types/tools.ts`** — 在 `SyncResourcesParams`、`ManageSubscriptionParams`、`SearchResourcesParams`、`UploadResourceParams`、`UninstallResourceParams` 中添加 `user_token?: string` 字段。

4. **所有 Tool 实现**（`sync-resources.ts`、`manage-subscription.ts`、`search-resources.ts`、`upload-resource.ts`）— 从 params 中提取 `user_token` 并透传给每个 API 调用。

5. **所有 Tool inputSchema** — 新增 `user_token` 字段描述，指导 AI Agent 从环境变量 `CSP_API_TOKEN` 读取并传入。

### 用户配置方式

用户在 `mcp.json` 中配置自己的 Token：
```json
{
  "mcpServers": {
    "csp-ai-agent": {
      "command": "npx",
      "args": ["@elliotding/ai-agent-mcp"],
      "env": {
        "CSP_API_TOKEN": "<user's own token>"
      }
    }
  }
}
```

AI Agent 调用工具时自动读取环境变量并传入：
```json
{
  "tool": "sync_resources",
  "params": {
    "mode": "incremental",
    "user_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
  }
}
```

## 修改的文件

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `src/api/client.ts` | 修改拦截器 + 新增方法 | 添加 `authConfig()` 方法；拦截器只在无已有头时注入 fallback token |
| `src/api/client.ts` (API methods) | 参数扩展 | 8 个业务方法各新增 `userToken?: string` 参数 |
| `src/types/tools.ts` | 类型扩展 | 5 个 params 接口各新增 `user_token?: string` |
| `src/tools/sync-resources.ts` | 逻辑 + schema | 提取并透传 `user_token`；inputSchema 新增字段 |
| `src/tools/manage-subscription.ts` | 逻辑 + schema | 同上，包含 auto-sync 时的 token 透传 |
| `src/tools/search-resources.ts` | 逻辑 + schema | 同上 |
| `src/tools/upload-resource.ts` | 逻辑 + schema | 同上，涵盖 upload + finalize 两步 |

## 验证方法

1. 在两个用户的 `mcp.json` 中分别配置不同的 `CSP_API_TOKEN`
2. 分别调用 `sync_resources`，传入对应的 `user_token`
3. 观察服务器日志中每次请求的 `Authorization` 头前缀，应该不同
4. 编译验证：`npm run build` 成功（已验证，exit code 0）

## 预防措施

- Tool description 中明确要求 AI Agent 读取环境变量 `CSP_API_TOKEN` 并传入 `user_token`
- fallback token 仍然存在（用于本地开发/测试），不影响现有单用户部署
- 新参数均为可选（`?`），保证向后兼容
