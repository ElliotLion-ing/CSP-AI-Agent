# Change: MCP Prompt 模式 + AI Resource 使用埋点

## Why

当前架构将 Command/Skill 实体文件下发到用户本地（`~/.cursor/commands/` 等），导致调用完全发生在 Cursor 客户端内部，MCP Server 无法感知，资源使用埋点不可能实现。

需要架构性调整：将 Command/Skill 改为在 MCP Server 注册 Prompt，用户调用经过 MCP Server handler，从而实现服务端埋点统计。

## What Changes

1. **Command/Skill 分发模式改变**：从下发实体文件 → 在 MCP Server 动态注册 MCP Prompt
2. **中间文件机制**：每次 git pull/上传后实时生成 Prompt 中间文件到 `.prompt-cache/`（不进 Git）
3. **TelemetryManager 改造**：增加 `jira_id` 可选参数、`configured_mcps` 字段、文件路径移至运行目录
4. **Telemetry API 新增 `jira_id`**：`POST /csp/api/resources/telemetry` 的事件条目支持可选 `jira_id` 字段
5. **新增 PromptManager/PromptGenerator 模块**：管理 Prompt 注册生命周期和中间文件生成
6. **工具改造**：`sync_resources`、`manage_subscription`、`upload_resource`、`uninstall_resource` 按新架构调整

## Impact

- **Affected specs**: `telemetry`, `mcp-server`
- **Affected code**:
  - `SourceCode/src/prompts/` (新增)
  - `SourceCode/src/tools/sync-resources.ts`
  - `SourceCode/src/tools/manage-subscription.ts`
  - `SourceCode/src/tools/upload-resource.ts`
  - `SourceCode/src/tools/uninstall-resource.ts`
  - `SourceCode/src/telemetry/manager.ts`
  - `SourceCode/src/api/client.ts`
  - `SourceCode/src/server.ts`
  - `SourceCode/src/server/http.ts`
  - `Docs/Design/CSP-AI-Agent-API-Mapping.md`
- **Not Changed**: `search_resources` 无需修改
- **Rule/MCP**: 继续本地下发，仅统计已订阅/已配置列表
