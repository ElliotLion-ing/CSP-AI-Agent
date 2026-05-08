# CODEX-001 实施任务清单

## 阶段 0：前置清理
- [ ] 0-1: 删除 `SourceCode/src/transport/sse.ts`（已确认无引用）
- [ ] 0-2: 重构 `server.ts` 中 `startStdioServer()`，复用 `http.ts` 的 `createMcpServer()` 工厂

## 阶段 1：客户端适配器框架
- [ ] 1-1: 新建 `SourceCode/src/client-adapters/index.ts`（接口 + 注册表）
- [ ] 1-2: 新建 `SourceCode/src/client-adapters/cursor-adapter.ts`
- [ ] 1-3: 新建 `SourceCode/src/client-adapters/codex-adapter.ts`
- [ ] 1-4: 新建 `SourceCode/src/utils/codex-paths.ts`
- [ ] 1-5: 修改 `SourceCode/src/config/index.ts`（新增 `agentProfile` 字段）
- [ ] 1-6: 修改 `SourceCode/src/types/tools.ts`（新增 `agent_profile` 参数 + `merge_toml` action）

## 阶段 2：Transport 扩展
- [ ] 2-1: 新建 `SourceCode/src/server/streamable-http.ts`
- [ ] 2-2: 修改 `SourceCode/src/server.ts`（新增 streamable_http 分支）

## 阶段 3：同步分发重构
- [ ] 3-1: 重构 `SourceCode/src/tools/sync-resources.ts`（引入 adapter，新增 Codex 分支）
- [ ] 3-2: 修改 `SourceCode/src/server/http.ts`（oninitialized 感知 agent_profile）

## 阶段 4：Policy 物化
- [ ] 4-1: 新建 `SourceCode/src/utils/policy-generator.ts`
- [ ] 4-2: 修改 `sync-resources.ts`（调用 policy-generator，追加 write_file + merge_toml actions）
- [ ] 4-3: 修改 `SourceCode/src/types/tools.ts`（新增 restart_required/restart_hint 字段）

## 阶段 5：MCP-Driven Bootstrap
- [ ] 5-1: 修改 `AGENTS.md`（补充 merge_toml action 客户端处理规范）
- [ ] 5-2: 修改 `sync-resources.ts`（Codex mcp 资源的 merge_toml action）
- [ ] 5-3: 验证 restart_hint 只在 Codex profile 下返回

## 阶段 6：遥测扩展
- [ ] 6-1: 修改 `SourceCode/src/telemetry/manager.ts`（新增 agent_profile 维度）
- [ ] 6-2: 核查 `resolve-prompt-content.ts` + `track-usage.ts` 双端 telemetry

## 阶段 7：测试验证（贯穿全程，每阶段后执行）
- [ ] 7-1: `Test/test-stage0-cleanup.js`
- [ ] 7-2: `Test/test-stage1-adapter.js`
- [ ] 7-3: `Test/test-stage2-transport.js`
- [ ] 7-4: `Test/test-stage3-codex-sync.js`
- [ ] 7-5: `Test/test-stage4-policy.js`
- [ ] 7-6: `Test/test-stage5-bootstrap.js`
- [ ] 7-7: `Test/test-cursor-regression.js`（每阶段后必跑）
