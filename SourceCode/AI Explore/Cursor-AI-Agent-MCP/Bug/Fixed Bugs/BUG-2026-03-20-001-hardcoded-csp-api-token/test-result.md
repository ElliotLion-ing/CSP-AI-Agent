# Test Result: Hardcoded CSP_API_TOKEN

**Bug ID:** BUG-2026-03-20-001  
**测试时间:** 2026-03-20  
**测试人:** Cursor AI Agent  
**测试文件:** `Test/test-bug-BUG-2026-03-20-001.js`  
**验证状态:** ✅ PASSED (30/30, 100%)

---

## 测试执行结果

### 脚本输出（主要验证）

```
════════════════════════════════════════════════════════════
🔍 BUG-2026-03-20-001: CSP_API_TOKEN Per-Request Token Tests
════════════════════════════════════════════════════════════

▶ Group 1: Build Artifact Verification
  ✅ PASS: dist/api/client.js exists (build succeeded)

▶ Group 2: APIClient Structure Verification
✓ Loaded .env from: .../SourceCode/.env
🔑 CSP_API_TOKEN from env: NOT SET
  ✅ PASS: dist/api/client.js loads without require error
  ✅ PASS: apiClient singleton is exported
  ✅ PASS: apiClient.authConfig() method exists

▶ Group 3: authConfig() Method Behaviour
  ✅ PASS: authConfig(undefined) returns an object
  ✅ PASS: authConfig(undefined) does NOT inject Authorization header
  ✅ PASS: authConfig(token) injects "Bearer eyJtest.payload.signature" header
  ✅ PASS: authConfig(token, extra) merges extra config and injects Authorization
  ✅ PASS: authConfig("") (empty string) does NOT inject Authorization header

▶ Group 4: Interceptor Rejects Missing Token (Bug Scenario)
  ✅ PASS: Interceptor contains the expected error message for missing token
  ✅ PASS: Error message guides user to configure token in mcp.json
  ✅ PASS: Interceptor does NOT silently fall back to server-level config token

▶ Group 5: Tool Parameter Types Carry user_token
  ✅ PASS: src/types/tools.ts exists
  ✅ PASS: SyncResourcesParams contains user_token field
  ✅ PASS: ManageSubscriptionParams contains user_token field
  ✅ PASS: SearchResourcesParams contains user_token field
  ✅ PASS: UploadResourceParams contains user_token field
  ✅ PASS: UninstallResourceParams contains user_token field

▶ Group 6: API Methods Accept userToken Parameter
  ✅ PASS: getSubscriptions() accepts userToken parameter
  ✅ PASS: subscribe() accepts userToken parameter
  ✅ PASS: unsubscribe() accepts userToken parameter
  ✅ PASS: searchResources() accepts userToken parameter
  ✅ PASS: downloadResource() accepts userToken parameter
  ✅ PASS: getResourceDetail() accepts userToken parameter
  ✅ PASS: uploadResourceFiles() accepts userToken parameter
  ✅ PASS: finalizeResourceUpload() accepts userToken parameter

▶ Group 7: Tool Implementations Pass user_token
  ✅ PASS: sync_resources: reads user_token from params and forwards it to API calls
  ✅ PASS: manage_subscription: reads user_token from params and forwards it to API calls
  ✅ PASS: search_resources: reads user_token from params and forwards it to API calls
  ✅ PASS: upload_resource: reads user_token from params and forwards it to API calls

────────────────────────────────────────────────────────────
📊 BUG-2026-03-20-001 Test Summary
   Total  : 30
   Passed : 30
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
| 1 | dist/api/client.js 编译产物存在 | 文件存在 | 文件存在 | ✅ |
| 2 | apiClient 模块可加载 | 无报错 | 无报错 | ✅ |
| 3 | apiClient 单例已导出 | 对象非空 | 对象非空 | ✅ |
| 4 | authConfig() 方法存在 | typeof function | typeof function | ✅ |
| 5 | authConfig(undefined) 返回对象 | 返回 {} | 返回 {} | ✅ |
| 6 | authConfig(undefined) 不注入 Authorization | 无 header | 无 header | ✅ |
| 7 | authConfig(token) 注入 Bearer 头 | `Bearer eyJ...` | `Bearer eyJ...` | ✅ |
| 8 | authConfig(token, extra) 合并 extra 并注入头 | 头+params 存在 | 头+params 存在 | ✅ |
| 9 | authConfig("") 空字符串不注入头 | 无 header | 无 header | ✅ |
| 10 | 拦截器包含明确错误信息 | 含错误文本 | 含错误文本 | ✅ |
| 11 | 错误信息引导用户配置 mcp.json | 含 mcp.json 引导 | 含 mcp.json 引导 | ✅ |
| 12 | 拦截器不回退到服务器级 token | 无 fallback | 无 fallback | ✅ |
| 13-17 | 5 个 Tool Params 接口含 user_token | 含 user_token | 全部含 | ✅ |
| 18-25 | 8 个 API 方法接受 userToken 参数 | 签名含 userToken | 全部含 | ✅ |
| 26-29 | 4 个 Tool 实现透传 user_token | 读取并传递 | 全部透传 | ✅ |

---

## 结论

BUG-2026-03-20-001 已完全修复。原始 Bug 场景（服务器级 fallback token 静默覆盖用户 token）已消除：拦截器在无 `Authorization` 头时立即报错，`authConfig()` 提供 per-request 注入，所有 5 个 Tool Params 类型和 8 个 API 方法均已更新，4 个 Tool 实现正确读取并透传 `user_token`。
