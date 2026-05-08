# Feature Design: CSP AI Agent Codex 双端支持

**Feature ID:** FEAT-2026-05-08-001
**版本:** 1.0.0
**创建日期:** 2026-05-08
**状态:** 待开发

---

## 1. 背景

当前 CSP AI Agent MCP 服务器完全面向 Cursor 设计，所有分发路径、transport、policy 分发机制均基于 Cursor 假设。Codex 作为另一个重要的 AI 开发平台，需要独立的兼容支持。

详细架构设计参见：`Docs/Design/CSP-AI-Agent-Codex-Dual-Client-Design.md`

---

## 2. 需求描述

在不破坏现有 Cursor 用户任何功能的前提下，增量添加 Codex 支持：

1. Codex 用户可以连接 MCP server 并正常使用 CSP 管理的 skill/rule/command/mcp 资源
2. CSP 全局路由 policy（`csp-routing-policy.md`）通过 `developer_instructions` 注入 Codex session
3. MCP server 支持 Streamable HTTP transport（Codex 推荐连接方式）
4. 遥测可区分 Cursor / Codex 来源

---

## 3. 技术方案（7 阶段）

完整实施计划参见：`Docs/Design/CODEX-001-Implementation-Plan.md`

### 核心架构变化

- 引入 `ClientAdapter` 接口和适配器注册表（`client-adapters/`）
- `sync_resources` 通过适配器分发，Cursor 路径不变，Codex 新增独立路径
- `~/.csp-ai-agent/codex/` 作为 Codex 资源根目录（与 Cursor 路径完全隔离）
- `developer_instructions` 字段写入 `~/.codex/config.toml`，policy 每次 sync 同步更新

### 关键设计决策

| 决策点 | 选择 | 原因 |
|--------|------|------|
| Policy 注入方式 | `developer_instructions` 字段（追加） | 不破坏 Codex 内置指令，风险低 |
| Launcher | 废弃独立脚本，改用 `local_actions` 内嵌 | 避免突然终止用户 Codex 进程 |
| 资源路径 | `~/.csp-ai-agent/codex/`（隔离） | 与 Cursor 路径不冲突，易扩展 |
| Transport | 新增 `streamable_http`，保留 `sse`/`stdio` | 向后兼容 |

---

## 4. API 设计变更

- `sync_resources` 新增 `agent_profile` 参数（可选，默认 `cursor`）
- `SyncResourcesResult` 新增 `restart_required` 和 `restart_hint` 字段
- 新增 `merge_toml` LocalAction 类型
- 服务器配置新增 `CSP_AGENT_PROFILE` 环境变量

---

## 5. 影响范围

- **Cursor 用户**：零影响（所有变更均为新增分支）
- **新增文件**：约 9 个（适配器、路径工具、transport、policy 生成器）
- **修改文件**：`sync-resources.ts`（大改）、`server.ts`、`http.ts`、`config/index.ts`、`types/tools.ts`
- **删除文件**：`transport/sse.ts`（遗留代码，无引用）
