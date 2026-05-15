# CODEX-001: CSP AI Agent Codex 双端支持

## Why

当前 CSP AI Agent MCP 服务器完全面向 Cursor 设计，分发路径、transport、policy 分发机制均基于 Cursor 假设。Codex 作为重要的 AI 开发平台，无法直接使用 CSP 管理的 skill/rule/command/mcp 资源，阻碍了 CSP 生态在 Codex 用户中的推广。

## What

在不破坏现有 Cursor 用户任何功能的前提下，增量添加 Codex 双端支持：

1. 引入 `ClientAdapter` 接口和适配器注册表，所有客户端特定逻辑通过适配器路由
2. 新增 Codex 分发路径（`~/.csp-ai-agent/codex/`），与 Cursor 路径完全隔离
3. `sync_resources` 通过适配器生成客户端感知的 local_actions
4. CSP routing policy 通过 `developer_instructions` 注入 `~/.codex/config.toml`
5. 新增 Streamable HTTP transport 支持 Codex 连接
6. 遥测增加 `agent_profile` 维度

## Impact

- **Cursor 用户**：零破坏性变更
- **新增代码**：约 9 个新文件，3 个文件大改（sync-resources.ts、server.ts、http.ts）
- **删除代码**：`transport/sse.ts`（遗留代码，无引用）
- **类型扩展**：`SyncResourcesParams` 新增 `agent_profile`，`LocalAction` 新增 `merge_toml` 类型
