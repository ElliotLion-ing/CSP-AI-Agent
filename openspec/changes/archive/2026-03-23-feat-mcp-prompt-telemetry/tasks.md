## 阶段 1: PromptGenerator — 中间文件生成

- [x] 1.1 新建 `src/prompts/generator.ts`，实现 `parseMarkdownWithImports(content, basePath)` 递归展开 `import` 指令
- [x] 1.2 实现 `replaceMDVariables(content, vars)` 变量替换逻辑
- [x] 1.3 新建 `src/prompts/cache.ts`，实现 `.prompt-cache/` 目录读写（`write`, `read`, `delete`, `exists`）
- [x] 1.4 新建 `src/prompts/index.ts` 统一导出
- [x] 1.5 编写阶段 1 测试用例（`Test/test-feat-prompt-generator.js`）并通过

## 阶段 2: PromptManager — 动态注册机制

- [x] 2.1 新建 `src/prompts/manager.ts`，实现 `PromptManager` 类（含 `installHandlers`）
- [x] 2.2 实现 `registerPrompt(meta)` — 生成中间文件 + 内存注册 + 埋点
- [x] 2.3 实现 `unregisterPrompt(...)` — 从注册表移除 + 删缓存文件
- [x] 2.4 实现 `refreshPrompt(meta)` — 更新中间文件 + 重注册
- [x] 2.5 实现 `refreshAllPrompts(resources)` — 批量刷新（用于 Server 启动时）
- [x] 2.6 在 `src/server.ts` 和 `src/server/http.ts` 中启动时安装 Prompt handlers + 声明 `prompts: {}` capability
- [x] 2.7 编写阶段 2 测试用例（`Test/test-feat-prompt-manager.js`）并通过

## 阶段 3: 工具改造 — sync_resources + manage_subscription

- [x] 3.1 改造 `sync_resources`：Command/Skill 调用 `PromptGenerator` 生成中间文件 + `PromptManager.registerPrompt()`，不再写 `~/.cursor/commands/` 或 `~/.cursor/skills/`
- [x] 3.2 `sync_resources` Rule：沿用旧逻辑，完成后更新 `telemetry.subscribed_rules`
- [x] 3.3 `sync_resources` MCP：沿用旧逻辑，完成后更新 `telemetry.configured_mcps`
- [x] 3.4 改造 `manage_subscription`：订阅 Command/Skill 后动态注册 Prompt；取消订阅后注销
- [ ] 3.5 编写阶段 3 测试用例（`Test/test-feat-tools-sync-sub.js`）并通过

## 阶段 4: 工具改造 — upload_resource + uninstall_resource

- [x] 4.1 改造 `upload_resource`：Command/Skill 上传成功后生成中间文件 + 注册 Prompt
- [x] 4.2 改造 `uninstall_resource`：Command/Skill 注销 Prompt + 删除 `.prompt-cache/` 缓存文件
- [ ] 4.3 编写阶段 4 测试用例（`Test/test-feat-tools-upload-uninstall.js`）并通过

## 阶段 5: TelemetryManager 改造 + API 更新

- [x] 5.1 改造 `src/telemetry/manager.ts`：文件路径改为运行目录，`recordInvocation()` 新增可选 `jira_id` 参数
- [x] 5.2 新增 `configured_mcps` 字段和对应的 `updateConfiguredMcps()` 方法
- [x] 5.3 本地聚合 key 改为 `{resource_id}|{jira_id ?? ''}`
- [x] 5.4 改造 `src/api/client.ts`：`reportTelemetry` payload 新增 `configured_mcps` + `jira_id`
- [ ] 5.5 更新 Mock Server (`Test/mock-csp-resource-server.js`)：新增 `jira_id` + `configured_mcps` 字段验证
- [x] 5.6 更新 `Docs/Design/CSP-AI-Agent-API-Mapping.md`：telemetry API 新增 `jira_id` + `configured_mcps`
- [x] 5.7 编写阶段 5 测试用例（`Test/test-feat-telemetry-v2.js`）并通过

## 阶段 6: 集成测试 + 文档

- [ ] 6.1 端到端测试：订阅 Command → slash 触发 → 埋点记录 → 上报 API（`Test/test-feat-integration-mcp-prompt.js`）
- [ ] 6.2 更新 README.md
- [ ] 6.3 创建阶段性文档 `Docs/Stage-1~6-MCP-Prompt-Telemetry.md`（各阶段完成后分别创建）
