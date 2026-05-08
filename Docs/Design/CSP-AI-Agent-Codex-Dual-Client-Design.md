# CSP AI Agent 双端支持设计（Cursor 与 Codex）

## 1. 背景

当前 CSP AI Agent MCP 服务器主要为 Cursor 设计，其核心设计假设如下：
- Cursor 从 `.mdc` 文件读取规则
- Cursor 使用基于 SSE 的 MCP 连接
- Cursor 可以发现或依赖 `~/.cursor/*` 资源布局
- Cursor 特定的规则分发是路由和行为约束的主要控制平面

这些假设对 Codex 不成立。
Codex 可以直接使用 MCP，但其有效控制模型不同：
- 全局行为由 host 层的 `system` 和 `developer` 指令控制
- 仓库级行为由 `AGENTS.md` 控制
- 可复用的工作流更适合以 skill 形式表达
- `.mdc` 等本地文件不会自动成为高优先级指令

因此，本设计**不是**从 Cursor 完全迁走。
本设计定义了一个**增量式双端支持方案**：
- 保持现有 Cursor 行为可用
- 增加 Codex 兼容的 transport、打包、policy 和 launcher 层
- 在引入 Codex 路径的同时，不破坏现有 Cursor 用户路径

## 2. 目标

构建一个同时支持 Cursor 和 Codex 的 CSP AI Agent 架构。
设计必须满足以下所有条件：
1. 现有 Cursor 用户无需强制迁移，继续正常使用。
2. Codex 用户可以安装 MCP、同步资源、运行 CSP 管理的工作流。
3. CSP 全局路由规则可通过 `csp-routing-policy.md` 加 launcher/session bootstrap 在 Codex 中近似实现。
4. 资源分发同时支持 Cursor 原生布局和 Codex 导向布局。
5. 服务器 transport 支持使用 Streamable HTTP 作为 Codex 兼容的默认路径。

## 3. 非目标

本设计不尝试：
1. 移除 Cursor 支持
2. 强制所有用户切换到 Codex
3. 在 host 不暴露 session bootstrap hook 的情况下保证 Codex host 层硬注入
4. 重新设计订阅、搜索、同步、遥测或上传的业务语义

## 4. 当前状态概述

基于当前核心设计和实现，MCP 服务器已提供：
- `sync_resources`
- `manage_subscription`
- `search_resources`
- `upload_resource`
- `uninstall_resource`
- `track_usage`
- `resolve_prompt_content`
- `query_usage_stats`

当前优势：
- 订阅和同步模型已经成熟
- 基于 prompt 的 command/skill 解析已经成熟（`prompts/manager.ts` 约 1000 行的成熟实现）
- 遥测已内置到工作流中
- 基于 manifest 的隔离和混合同步设计已存在（`is_skill_manifest` 原子更新机制已生产可用）
- 复杂 skill 的附属脚本文件已隔离到 `~/.csp-ai-agent/skills/<name>/`（非 `~/.cursor/`），部分解耦已存在
- `sync_resources` 的 rule 分发已有三级 scope 策略（`global` / `workspace` / `all`），支持双层写入
- transport 选择已配置驱动（`config.transport.mode`），具备扩展第三种 transport 的基础

当前与 Cursor 耦合的假设（需迁移的部分）：
- **两套 SSE 实现并存**：`server/http.ts`（基于 MCP SDK 的 `SSEServerTransport`，是当前主路径）和 `transport/sse.ts`（自研实现，可能是遗留代码）。transport 重构前需先清理此分裂状态，明确以哪套为基础。
- **`sync-resources.ts` 直接导入 `cursor-paths.ts` 中的 5 个路径工具**（`getCursorResourcePath`、`getCursorTypeDirForClient`、`getCursorRootDirForClient`、`getCspAgentDirForClient`、`getCspAgentRootDirForClient`），缺少客户端适配器抽象层
- **`mcp` 类型资源分发目标硬编码为 `~/.cursor/mcp.json`**，无 Codex 路径分支
- **规则 `.mdc` 分发路径硬编码为 `getCursorTypeDirForClient('rule')`**（`~/.cursor/rules/`）+ 可选的 workspace 路径，无 Codex policy 注入路径分支
- **全局路由依赖 Cursor 的 `.mdc` 规则引擎**，无等效的 `csp-routing-policy.md` 生成逻辑
- **`http.ts` 中的 `oninitialized` 自动 sync 机制**将 sync 结果通过 `storeSyncActions()` 缓存到 `PromptManager`，Codex 无等效的 Prompt 交付机制，此逻辑需要针对 Codex 客户端另行设计
- 当前无 `agent_profile` 概念，所有 API 请求均无客户端标识字段

> **注意**：当前已有的解耦程度高于本文档初稿描述。复杂 skill 的 `~/.csp-ai-agent/` 隔离路径已存在，rule 的 scope 双层写入已生产可用，transport 切换已配置化。Codex 支持所需的实际工作主要集中在：（1）引入适配器层消除剩余的 Cursor 硬编码路径；（2）新增 Codex 分发目标；（3）实现 `csp-routing-policy.md` 生成；（4）清理两套 SSE 并存问题后添加 Streamable HTTP。

## 5. 设计原则

正确目标是**双端支持**，而非替换。
这意味着：
- Cursor 仍是一等公民支持的客户端
- Codex 成为额外的客户端 profile
- 共享能力保留在公共核心中
- 客户端特定的打包和 transport 移入适配器

架构应拆分为：
1. 共享服务器核心
2. 客户端 transport 适配器
3. 客户端分发适配器
4. Codex 专属 launcher/policy 层

长期来看，这应演进为**可插拔的客户端支持框架**，而非永久硬编码的 `Cursor + Codex` 分叉。
这意味着：
- Cursor 和 Codex 是前两个受支持的客户端适配器
- 未来的客户端（如面向 Claude 的 host）应通过实现新适配器来添加
- 每次引入新客户端时，共享核心不应被重写

## 6. 目标架构

### 6.1 共享核心

以下模块应在 Cursor 和 Codex 之间保持共享：
- 资源订阅模型
- 资源搜索
- 同步编排
- prompt 生成/解析
- 遥测
- 资源元数据和 manifest
- 上传和卸载流程

这些模块应尽可能保持客户端中立。

### 6.2 客户端 Profile

引入两个明确的客户端 profile：
- `cursor`
- `codex`

每个 profile 控制：
- transport 默认值
- 本地路径映射
- 资源打包规则
- policy/规则物化格式

这是 Phase 1 的视角。
从架构上看，这些客户端 profile 最终应由**客户端适配器注册表**支撑。
每个适配器应定义：
- profile 名称
- 支持的 transport 模式
- 资源映射规则
- policy 策略
- launcher 策略
- 安装策略
- 遥测标签

### 6.3 Transport 层

Transport 支持应包括：
- `stdio`
- `sse`
- `streamable_http`

推荐默认值：
- Cursor 默认：`sse` 或现有兼容模式
- Codex 默认：`streamable_http`

### 6.4 分发层

资源映射应变为客户端特定的。

#### 本地路径命名空间设计

Cursor 和 Codex 的本地资源存放路径完全隔离，不共享任何目录：
- **Cursor**：所有资源写入 `~/.cursor/` 或 `~/.csp-ai-agent/`（client-neutral 的复杂 skill 缓存目录）
- **Codex**：所有资源写入 `~/.csp-ai-agent/codex/`（在 csp-ai-agent 根目录下以 `codex/` 子目录区分）

选择在 `~/.csp-ai-agent/codex/` 下放置 Codex 资源而非 `~/.codex/` 的原因：
- CSP 管理的资源（skill、policy、state）应由 CSP AI Agent 统一管理，而非散落在 Codex 自身目录中
- `~/.csp-ai-agent/` 已是现有的 CSP 资源管理根目录，`codex/` 子目录是自然延伸
- 便于未来添加第三个客户端（如 Claude）时只需增加 `~/.csp-ai-agent/claude/` 子目录，无需新设计

#### 按资源类型的分发矩阵

| 资源类型 | `agent_profile=cursor` | `agent_profile=codex` |
|---------|----------------------|----------------------|
| `rule` | `~/.cursor/rules/<name>.mdc`（由 Cursor 规则引擎自动加载） | `~/.csp-ai-agent/codex/csp-routing-policy.md`（policy 注入，见下文） |
| `skill`（简单） | MCP Prompt 缓存（`resolve_prompt_content` 返回内容） | MCP Prompt 缓存（同 Cursor，无本地文件） |
| `skill`（复杂，含附属文件） | `~/.csp-ai-agent/skills/<name>/`（SKILL.md + scripts/ + teams/ + references/） | `~/.csp-ai-agent/codex/skills/<name>/`（结构相同，路径隔离） |
| `command` | `~/.cursor/commands/<name>.md`（Cursor slash command） | **资源转化**：转换为 Codex skill bundle，写入 `~/.csp-ai-agent/codex/skills/<name>/` |
| `mcp` | `~/.cursor/mcp.json`（合并条目） | `~/.codex/config.toml` 片段（Codex 原生配置格式） |

#### rule 的 policy 注入机制

Cursor 侧通过 `.mdc` 规则文件由编辑器引擎自动加载路由规则。Codex 侧没有等效的自动加载机制，因此采用**显式 policy 注入**：
1. `sync_resources` 将订阅的所有 `rule` 资源内容合并生成 `~/.csp-ai-agent/codex/csp-routing-policy.md`
2. Codex launcher 在启动时读取该文件，将其内容作为 `developer` 指令注入到 session 中
3. Codex session 启动后，路由规则以与 `.mdc` 等效的优先级生效

这意味着 `rule` 资源对 Codex 的作用不是「写一个文件让 Codex 自动读」，而是「生成一个中间文件，由 launcher 在启动时主动注入」。

#### skill 的简单/复杂分类

- **简单 skill**：资源内容仅为 SKILL.md prompt 文本，通过 `resolve_prompt_content` 返回，无需本地文件。两端行为相同，均依赖 MCP Prompt 缓存机制。
- **复杂 skill**：资源包含可执行脚本（`scripts/`）、团队配置（`teams/`）、参考文档（`references/`）等附属文件。Cursor 侧这些文件缓存在 `~/.csp-ai-agent/skills/<name>/`；Codex 侧对称地缓存在 `~/.csp-ai-agent/codex/skills/<name>/`，目录结构完全相同，仅路径前缀不同。

复杂 skill 在两端的调用规则相同：必须先通过 `resolve_prompt_content` 获取 SKILL.md 触发 telemetry，再由 SKILL.md 指示从本地路径读取附属文件执行。**不允许跳过 MCP Prompt 调用直接读取本地缓存文件作为入口。**

#### command 的资源转化

Cursor `command` 资源是 Cursor 特有的 slash command 格式（`.md` 文件）。Codex 不支持该格式，因此需要进行资源转化而非简单复制：
- sync 时检测到 `command` 类型资源 + `agent_profile=codex`，触发转化流程
- 将 command 的触发描述、参数说明、执行逻辑重新打包为 Codex skill 格式
- 打包结果写入 `~/.csp-ai-agent/codex/skills/<name>/`，包含 SKILL.md（从 command 内容生成）
- 原始 Cursor command 资源不受影响

#### 两端同时安装时的行为

如果用户同时安装了 Cursor 和 Codex，并对每个 profile 分别运行同步：
- 每个 profile 的同步生成各自独立的本地操作集
- 两组输出完全不冲突（输出路径命名空间不相交）
- 同一 `rule` 资源会同时写入 Cursor 的 `.mdc` **以及**贡献到 Codex 的 `csp-routing-policy.md`——两者独立发生，互不影响
- 同一复杂 `skill` 资源会同时缓存到 `~/.csp-ai-agent/skills/<name>/`（Cursor 用）和 `~/.csp-ai-agent/codex/skills/<name>/`（Codex 用）
- 两组输出之间没有共享状态；更新其中一个不会使另一个失效

> **对 sync API 的影响**：`sync_resources` 上的 `agent_profile` 参数决定生成哪组输出。以 `agent_profile=cursor` 调用 `sync_resources` 不会更新 Codex 路径，反之亦然。

### 6.5 Launcher 和 Policy 层

该层是 Codex 专属的。
负责：
- 加载 `csp-routing-policy.md`
- 在 session 启动前可选地同步资源
- 从 CSP 管理的入口点启动 Codex
- 在 host/session bootstrap 集成可用时注入 policy

该层不是 Cursor 所需的。

### 6.6 客户端适配器管理层

为避免每次添加新 AI host 时都需要重新修改服务器，引入可插拔的客户端支持管理层。
该层应提供：
1. **客户端适配器注册表** — 注册受支持的客户端适配器，根据 `agent_profile` 解析适配器
2. **Transport 能力描述符** — 定义每个客户端有效的 transport
3. **分发能力描述符** — 定义每种资源类型在每个客户端上如何物化
4. **Policy 策略** — 定义客户端使用 `.mdc`、`AGENTS.md`、`csp-routing-policy.md` 还是其他机制
5. **Launcher 策略** — 定义客户端是否需要：无 launcher / 脚本 launcher / host/session bootstrap 集成
6. **安装策略** — 定义如何为客户端安装 MCP 配置

示例概念接口：

```ts
// LocalAction 是 sync_resources 本地操作生成中使用的现有类型。
// MaterializationPlan 是在客户端侧执行的 LocalAction 列表。
type MaterializationPlan = LocalAction[];

// PolicyStrategy 决定 rule 资源如何在该客户端生效。
type PolicyStrategy =
  | { type: 'mdc'; targetDir: string }
  // Cursor：将 rule 写入 .mdc 文件，由编辑器规则引擎自动加载
  | { type: 'policy_inject'; policyFile: string; injectedBy: 'launcher' };
  // Codex：将所有 rule 合并生成 policyFile（csp-routing-policy.md），
  // 由 launcher 在启动时主动注入为 developer 指令，而非由 Codex 自动读取

// LauncherStrategy 决定是否需要 launcher 脚本。
type LauncherStrategy =
  | { type: 'none' }                              // Cursor：无需 launcher
  | { type: 'script'; scriptPath: string };        // Codex v1：bash/PowerShell launcher

// InstallStrategy 决定如何安装 MCP 配置。
type InstallStrategy =
  | { type: 'mcp_json'; configPath: string }      // Cursor：合并到 mcp.json
  | { type: 'toml'; configPath: string };          // Codex：写入 toml 片段

interface ClientAdapter {
  profile: AgentProfile;
  getDefaultTransport(): 'stdio' | 'sse' | 'streamable_http';
  getDistributionPaths(resourceType: string): MaterializationPlan;
  getPolicyStrategy(): PolicyStrategy;
  getLauncherStrategy(): LauncherStrategy;
  getInstallStrategy(): InstallStrategy;
  getTelemetryTags(): Record<string, string>;
}
```

> **注意**：`materializeResource` 重命名为 `getDistributionPaths`，以更好地反映它返回的是基于路径的本地操作，而非更高层次的物化抽象。此命名也使其更难被误用于业务逻辑目的。

Phase 1 适配器：`cursor`、`codex`

Phase 2 及以后：`claude`、其他未来 agent host

核心设计规则：**添加新客户端支持应通过实现新适配器来完成，而不是在多个无关模块中修改共享核心行为。**

## 7. 兼容性策略

### 7.1 向后兼容要求

所有变更必须默认保留现有 Cursor 行为。
这意味着：
- 现有 SSE 路径必须保持可用，直到 Streamable HTTP 完成推广
- 现有 Cursor 资源布局必须保持可用
- 现有基于 `.mdc` 的规则分发必须对 Cursor 用户保持可用
- 现有遥测语义必须保持有效

### 7.2 Codex 作为额外的交付路径

Codex 支持应作为附加路径引入：
- 新 transport 选项
- 新客户端 profile
- 新分发映射
- 新 policy 产物
- 新 launcher 流程

共享核心行为不应以破坏 Cursor 语义的方式被重写。

### 7.3 客户端识别策略

MCP 服务器应明确支持客户端身份字段：`agent_profile`

Phase 1 允许的值：`cursor`、`codex`

> **关于** `unknown` 的说明：Phase 1 不引入 `unknown` 作为有效值。不支持或缺失的值会被强制转为 `cursor` 以保持向后兼容。

#### 为什么需要该字段

双端支持架构要求服务器根据来源客户端分支行为。
这影响：本地资源映射 / 规则或 policy 物化 / skill 打包行为 / 遥测维度

应尽可能避免依赖隐式检测。

#### 向后兼容决策

- 如果明确提供了 `agent_profile`，服务器必须遵守
- 如果 `agent_profile` 缺失或不支持，服务器默认为 `cursor`

#### Transport 和配置示例

Phase 1 中 `agent_profile` 仅通过环境变量传递，这是唯一受支持的传递机制。

Cursor（环境变量，可选——`cursor` 是默认值）：
```json
{
  "env": {
    "CSP_AGENT_PROFILE": "cursor"
  }
}
```

Codex（环境变量，必需）：
```toml
[mcp_servers.csp_ai_agent.env]
CSP_AGENT_PROFILE = "codex"
```

> HTTP header、query parameter 和 session bootstrap 传播路径推迟到 Phase 2，届时 Streamable HTTP transport 部署完成后再设计。

#### 服务器侧处理

服务器将所有输入规范化为单一运行时字段：
```ts
type AgentProfile = 'cursor' | 'codex';
```

解析逻辑：
1. 读取 `CSP_AGENT_PROFILE` 环境变量
2. 如果缺失或值不支持，默认为 `cursor` 并记录警告日志
3. 将解析后的 `AgentProfile` 仅提供给客户端适配器注册表——共享核心模块不得直接读取

> **封装规则**：`agent_profile` 不得在共享核心业务逻辑中直接访问。所有客户端特定的分支必须通过适配器接口进行（如 `adapter.getDistributionPaths(resourceType)`）。这可防止 `if (profile === 'codex')` 式的分支意外蔓延到共享核心。

#### `agent_profile` 应控制的内容

Phase 1 使用 `agent_profile` 控制：
1. 资源分发映射（通过适配器）
2. 规则或 policy 输出类型（通过适配器）
3. 遥测维度（通过适配器）

Phase 2 可能额外使用它控制：
1. transport 默认值
2. launcher 特定行为
3. 客户端特定的 prompt 或 skill 打包行为

## 8. 详细变更领域

### 8.0 客户端适配器框架

当前问题：系统有风险演变为针对 Cursor、Codex、未来客户端的一系列临时特例

所需变更：
1. 定义正式的客户端适配器抽象
2. 添加以 `agent_profile` 为键的适配器注册表
3. 通过适配器路由 transport、同步规划、资源映射、policy、launcher 和安装行为
4. 将共享业务逻辑保持在适配器层之外

涉及的代码区域：新建 `client-adapters/` 模块 / 服务器启动配置 / 同步规划 / 安装规划 / launcher 规划 / 遥测标签

### 8.1 服务器 Transport 重构

当前问题：

1. **两套 SSE 实现并存**（需在重构前清理）：
   - `server/http.ts`：基于 MCP SDK 官方 `SSEServerTransport`（`@modelcontextprotocol/sdk/server/sse.js`），是**当前主路径**，包含 per-connection MCP Server 实例化、heartbeat、endpoint URL 绝对路径拦截补丁、session 管理等完整生产逻辑。
   - `transport/sse.ts`：自研 SSE 实现，直接操作 `sessionManager` + `toolRegistry`，**疑似遗留代码**。如果当前 SSE 路径已完全迁移到 `http.ts`，应在重构前确认 `transport/sse.ts` 是否仍被调用，若已不用则应删除，避免引入混淆。

2. **transport 选择已配置驱动但缺少第三选项**：`server.ts` 的 `startServer()` 已通过 `config.transport.mode` 选择 `sse` 或 `stdio`，具备扩展第三个选项的结构基础，只需在 `if (transportMode === 'sse')` 后添加 `else if (transportMode === 'streamable_http')` 分支即可。

3. **`stdio` 路径使用旧版手动 Server 实例**：`startStdioServer()` 中手动创建 `Server`、`StdioServerTransport` 并调用 `promptManager.installHandlers(server)`，未复用 `http.ts` 中封装好的 `createMcpServer()` 工厂。重构时应统一实例创建方式。

所需变更：
1. **[前置清理]** 确认 `transport/sse.ts` 当前调用路径——若已被 `http.ts` 完全替代则删除，若仍在使用则先合并到 `http.ts`
2. **[前置清理]** 将 `stdio` 路径的 `Server` 实例创建逻辑复用 `http.ts` 的 `createMcpServer()` 工厂，消除两套初始化逻辑
3. 引入 transport 抽象接口（基于现有配置化基础扩展）
4. 添加 Streamable HTTP transport 实现（在 `server.ts` `startServer()` 中新增分支）
5. 通过配置和 `agent_profile` 选择 transport（通过适配器，不直接分支）
6. 添加 transport 特定的健康检查和可观测性
7. 在服务器启动时解析 `agent_profile` 并传递给适配器注册表——不将原始值传播到共享工具或业务逻辑模块

涉及的代码区域：
- `SourceCode/src/server.ts`（主入口，需复用 `createMcpServer` 工厂 + 添加 streamable_http 分支）
- `SourceCode/src/server/http.ts`（当前 SSE 主路径，重构基础）
- `SourceCode/src/transport/sse.ts`（**待确认是否删除**）
- transport 配置类型

### 8.2 客户端感知的同步与分发

当前问题：

1. **`sync-resources.ts` 与 Cursor 深度耦合**：直接从 `cursor-paths.ts` 导入 5 个路径工具（`getCursorResourcePath`、`getCursorTypeDirForClient`、`getCursorRootDirForClient`、`getCspAgentDirForClient`、`getCspAgentRootDirForClient`），所有分发路径均为 Cursor-only。

2. **同步 API 无 `agent_profile` 概念**：`SyncResourcesParams` 中无客户端标识字段，`syncResources()` 函数无法区分目标客户端。

3. **`oninitialized` 自动 sync 与 `storeSyncActions` 需要 Codex 对应设计**：
   `http.ts` 中 SSE 连接建立后，`server.oninitialized` 回调会自动执行后台 `syncResources({ mode: 'incremental', scope: 'global' })`，并将 sync 结果中的 `local_actions_required`（如 rule 文件写入指令）通过 `promptManager.storeSyncActions(userToken, actions)` 缓存到 `PromptManager`。这些 actions 在下次 AI 调用 `GetPrompt` 时被嵌入到 `csp-ai-agent-setup` prompt 内容中，完成 rule 文件在 Cursor 侧的自动交付。
   
   **Codex 侧需要另行设计此机制**：Codex 无 MCP Prompt 概念，`storeSyncActions` 的交付路径不适用。Codex 侧的等效机制应通过 launcher 在会话启动前主动执行 sync 并将 `local_actions_required` 写入 session bootstrap 指令，而非通过 `PromptManager` 缓存。此逻辑需在 Epic E（launcher）中明确处理。

4. **rule 分发已有 scope 三级策略但需扩展**：现有 `scope` 参数（`global` / `workspace` / `all`）控制规则写入 `~/.cursor/rules/` 和/或 `.cursor/rules/`，完全覆盖了 Cursor 的需求。Codex 侧需要额外添加 `agent_profile=codex` 时的 policy 注入路径（`~/.csp-ai-agent/codex/csp-routing-policy.md`），这是新增分支而非修改现有逻辑。

所需变更：
1. 在同步 API 和内部同步规划中引入 `agent_profile`（扩展 `SyncResourcesParams`）
2. 将对 `cursor-paths` 的直接导入替换为 `adapter.getDistributionPaths(resourceType)` 调用
3. 将本地操作生成拆分为：Cursor 本地操作（行为不变）+ Codex 本地操作（新增，按 §6.4 矩阵）
4. 添加 Codex 特定路径：skill → `~/.csp-ai-agent/codex/skills/` / policy → `~/.csp-ai-agent/codex/csp-routing-policy.md` / state → `~/.csp-ai-agent/codex/state/`
5. `oninitialized` 自动 sync 中，当 `agent_profile=codex` 时，跳过 `storeSyncActions`（PromptManager 交付路径），改为在 launcher 启动流程中处理 sync actions

**依赖**：Task A0（适配器接口）必须稳定后，此重构才能开始。

涉及的代码区域：
- `SourceCode/src/tools/sync-resources.ts`（重大重构，含 `agent_profile` 分支）
- `SourceCode/src/server/http.ts`（`oninitialized` 回调需感知 `agent_profile`）
- `SourceCode/src/utils/cursor-paths.ts`（为 Cursor 适配器保留，不删除）
- 新建 `SourceCode/src/utils/codex-paths.ts`（Codex 适配器路径）
- 新建 `SourceCode/src/client-adapters/` 模块（按 Task A0）

### 8.3 Codex 的资源类型映射

- **`rule`** → policy 注入（非文件直接分发）：sync 时将所有订阅的 `rule` 资源内容合并生成 `~/.csp-ai-agent/codex/csp-routing-policy.md`，由 launcher 在启动时主动注入为 Codex `developer` 指令
- **`skill`（简单）** → MCP Prompt 缓存（与 Cursor 相同）：无需本地文件，两端行为完全一致
- **`skill`（复杂）** → `~/.csp-ai-agent/codex/skills/<name>/`：Codex 侧缓存路径与 Cursor 侧 `~/.csp-ai-agent/skills/<name>/` 对称，目录内部结构完全相同
- **`command`** → 资源转化为 Codex skill bundle：转化产物写入 `~/.csp-ai-agent/codex/skills/<name>/`，原始 Cursor command 资源不受影响
- **`mcp`** → `~/.codex/config.toml` 片段：唯一直接写入 Codex 自身配置目录的资源类型

### 8.4 全局 Policy 物化

当前问题：Cursor 全局路由通过 `.mdc` 执行；Codex 不读取 `.mdc` 文件

所需变更：
1. 定义生成的 `csp-routing-policy.md`（`csp-ai-prompts.mdc` 的 Codex 等效文件）
2. 定义其 schema/版本规则
3. 定义在 macOS 和 Windows 上的写入位置
4. 定义哪些资源可以向 policy 文件贡献内容
5. 定义 policy 缺失时的降级行为
6. 定义多个 `rule` 资源向同一 policy 文件贡献时的合并顺序

#### 文件路径

- macOS/Linux：`~/.csp-ai-agent/codex/csp-routing-policy.md`
- Windows：`%USERPROFILE%\.csp-ai-agent\codex\csp-routing-policy.md`

#### 最小格式

文件使用 YAML front matter 头部加 Markdown policy 正文。schema 有版本控制，以支持向前兼容的更新。

```markdown
---
csp_policy_version: "1.0"
generated_at: "2026-04-10T12:00:00Z"
generated_by: "csp-ai-agent sync_resources"
contributing_resources:
  - id: "0bbc520906995c7ca6ecb923aba141ca"
    name: "csp-ai-prompts"
    type: "rule"
    version: "2.1.0"
---

# CSP AI Agent 路由策略

<!-- 本文件由工具自动生成，请勿手动编辑。-->
<!-- Codex 等效文件：~/.cursor/rules/csp-ai-prompts.mdc -->

## 资源优先级规则

在执行任何任务之前，通过 `manage_subscription(action: list)` 检查 CSP 订阅。
如果找到匹配的 Skill，在使用任何降级工具之前先调用 `resolve_prompt_content`。

## Skill 调用规则

所有 Skill 调用必须通过 `resolve_prompt_content` 进行，以确保遥测被记录。
不得直接将 `~/.csp-ai-agent/skills/<name>/SKILL.md` 作为入口点读取。

<!-- 已订阅 rule 资源贡献的额外规则章节将追加在下方 -->
```

#### 并发与写入策略

- `csp-routing-policy.md` 使用原子文件替换方式写入（先写入临时路径，再重命名）
- 当多个 `rule` 资源并发同步时，其 policy 章节按订阅顺序合并
- 合并顺序具有确定性：资源在合并前按订阅 `id` 排序
- policy 文件缺失视为空文件——launcher 应向用户提示，但不得阻止启动

### 8.5 Codex Bootstrap（MCP-Driven，替代独立安装器）

**设计决策（v2，已修订）**：不再使用独立 Node.js 安装器或 bash/PowerShell launcher 脚本。改为由 `sync_resources` 在返回 `local_actions_required` 时，将所有 bootstrap 操作内嵌为标准 local action，由 Codex Agent 自行执行。

#### 核心机制

```
Codex Agent 连接 MCP Server（agent_profile=codex）
    ↓
oninitialized 触发 sync_resources
    ↓
MCP Server 生成 local_actions_required，包含：
  1. write_file     → 写入 csp-routing-policy.md（合并所有订阅 rule 内容）
  2. merge_toml     → 更新 ~/.codex/config.toml 的 developer_instructions 字段
                     （内容 = csp-routing-policy.md 的全文，每次 sync 同步更新）
  3. merge_toml     → 更新 ~/.codex/config.toml 的 mcp_servers 条目
    ↓
Agent 执行 local_actions 完成后，sync result 携带：
  restart_required: true
  restart_hint: "CSP policy 已更新，请重启 Codex 以使路由规则生效（下次启动时自动注入为 developer 指令）。"
```

#### 两个文件各司其职

| 文件 | 职责 |
|------|------|
| `~/.csp-ai-agent/codex/csp-routing-policy.md` | Policy 的本地可读副本，方便 debug 和审计，由 `write_file` action 维护 |
| `~/.codex/config.toml` 的 `developer_instructions` 字段 | Codex 每次启动时实际读取的入口，由 `merge_toml` action 维护，内容与上方文件保持同步 |

#### 为什么不用 `model_instructions_file`

`model_instructions_file` 是 **替换**（Replacement）Codex 内置指令，会丢失 Codex 系统级默认行为。`developer_instructions` 是**追加**到 session context，不破坏现有行为，风险更低。

#### Policy 生效方式

- **当前 session**：不生效（Codex 无运行时注入 API）
- **下次 session 启动**：自动生效（`config.toml` 的 `developer_instructions` 在每次启动时被读取）
- **用户侧行为**：Agent 执行完 local_actions 后，向用户展示 `restart_hint` 提示，用户手动重启 Codex

#### `merge_toml` LocalAction 类型定义

```ts
interface MergeTomlAction {
  action: 'merge_toml';
  toml_path: string;          // e.g. "~/.codex/config.toml"
  key: string;                // TOML key path, e.g. "developer_instructions"
  value: string;              // 新值（字符串内容）
  overwrite: boolean;         // true = 强制覆盖；false = skip_if_exists
}
```

#### `SyncResourcesResult` 新增字段

```ts
interface SyncResourcesResult {
  // ...现有字段...
  restart_required?: boolean;    // Codex 侧需要重启才能使 policy 生效
  restart_hint?: string;         // 给 Agent 展示给用户的提示文案
}
```

### 8.6 Codex Launcher（已废弃，合并入 §8.5）

> **设计变更说明**：原定的独立 bash/PowerShell launcher 脚本（`~/bin/csp-codex`、`csp-codex.ps1`）**不再实现**。所有 bootstrap 逻辑已内嵌到 `sync_resources` 的 `local_actions_required` 中，由 Codex Agent 直接执行，无需独立进程或外部脚本。此设计避免了「用户 Codex 被突然终止」的体验问题，且实现更简洁。

> §16.1 中的 Launcher v2（Host/Session Bootstrap）仍保留为未来规划，不影响 Phase 1 交付。

### 8.7 遥测兼容性

遥测必须保持双端兼容。所需变更：
1. 保留现有 Cursor 遥测维度
2. 添加 Codex 维度：客户端 profile / launcher 启动 vs 直接启动 / policy 存在 vs 缺失 / CSP 路径 vs 降级路径
3. 确保 `resolve_prompt_content` 和 `track_usage` 在两个客户端上的行为保持一致

### 8.8 Codex MCP 调用的 CSP Telemetry 接入（via Hook）

**背景**：目前 MCP tool 调用在 CSP 服务端有请求日志，但缺乏在 Codex session 维度上的主动上报，导致 CSP 侧无法按 session/用户/skill 聚合 Codex 的使用数据。

Codex 官方（PR #15659、#15805，2026-03-26 已合并）已在 `codex-rs/core/src/mcp_tool_call.rs` 中为每次 MCP tool 调用添加了原生 OpenTelemetry span（`mcp.tools.call`）和 metrics，这是 **Codex 自身的 OTel 统计**，与 CSP 服务端的 telemetry 是两套独立体系。

**可行方案：基于 Codex Hook 的主动上报**

Codex 支持 `after_tool_call` hook，在每次 MCP tool 调用完成后触发自定义逻辑：

```
Codex session 启动（由 CSP launcher 管理）
    ↓
launcher 注册 after_tool_call hook
    ↓
用户触发 MCP tool 调用（如 resolve_prompt_content）
    ↓
Codex 原生执行 MCP call（OTel span 由 Codex 自动记录）
    ↓
after_tool_call hook 触发
    ↓
hook 上报到 CSP telemetry 端点：
  - tool_name（如 resolve_prompt_content）
  - connector_id（CSP MCP server 标识）
  - session_id / agent_profile = codex
  - 调用结果（success / error）
  - duration_ms
```

**前提确认**：
1. ✅ Codex 原生 MCP telemetry 已就绪（PR #15659 和 #15805 已合并）
2. ⬜ `after_tool_call` hook 暴露的数据字段：确认 hook 回调中可访问 `tool_name`、`connector_id`、调用结果和 `duration_ms`
3. ⬜ CSP telemetry 端点接受 Codex 上报：确认 CSP 服务端有接受来自 launcher 侧主动上报的接口

**约束**：
- Hook 上报失败不得阻塞 MCP tool 调用本身（fire-and-forget，带超时）
- Hook 中不得记录 MCP tool 的响应内容（L4 数据，见隐私日志规范）
- Session ID 作为 L2 数据可记录，不需要 `{E}` 标签
- 此方案依赖 CSP launcher（Phase 1 已规划），无 launcher 时无法实现

**实施依赖**：Task E1（launcher v1）完成后才可实现 + 需要 CSP 服务端新增或确认 telemetry 上报接口

## 9. 任务分解

### Epic A：Transport 和服务器兼容性

| Task | 描述 | 完成定义 |
|------|------|---------|
| **A0** | 引入客户端适配器注册表和共享适配器接口 | 正式适配器接口存在；`cursor` + `codex` 适配器存在；transport 和分发逻辑可查询适配器 |
| **A1** | 引入 `agent_profile` 和 `transport_mode` 到服务器配置 | 配置支持 `cursor`/`codex`；`agent_profile` 缺失时降级为 `cursor`；仅通过适配器注册表访问 |
| **A2** | 重构服务器启动，隔离 transport 特定设置 | 共享服务器/工具注册是 transport 中立的；SSE 特定逻辑被移到适配器后面 |
| **A3** | 为 Codex 实现 Streamable HTTP transport | Codex 可通过 Streamable HTTP 连接；tools/list 和 tools/call 正常工作 |
| **A4** | 更新部署流水线和服务器配置 | 部署配置包含 Streamable HTTP 模式；网关/反向代理配置已更新 |

### Epic B：分发和打包

| Task | 描述 | 完成定义 |
|------|------|---------|
| **B1** | 定义客户端特定的资源映射矩阵 | 每种资源类型都有 Cursor 映射和 Codex 映射；矩阵在文档中记录并在代码中执行 |
| **B2** | 重构 `sync_resources` 生成客户端感知的本地操作 | Cursor 本地操作保持不变；Codex 本地操作单独生成；**前提条件：Task A0 完成** |
| **B3** | 添加 Codex 本地路径工具和状态布局 | Codex 路径集中管理；无硬编码的 Cursor 路径假设残留 |
| **B4** | 实现 Codex skill 打包 | command/skill 资源可产生 Codex 可消费的 skill bundle |
| **B5** | 更新 API 文档反映双客户端变更 | `CSP-AI-Agent-API-Mapping.md`、`Core-Design.md`、`Complete-Design.md` 已更新 |

### Epic C：Policy 和路由

| Task | 描述 | 完成定义 |
|------|------|---------|
| **C1** | 定义并版本化 `csp-routing-policy.md` | policy 格式已记录；生成逻辑已定义；更新行为具有确定性 |
| **C2** | 将 CSP 全局路由规则从 `.mdc` 映射到 Codex policy 内容 | 当前 Cursor 路由语义在 `csp-routing-policy.md` 中有所体现 |

### Epic D：安装器

| Task | 描述 |
|------|------|
| **D1** | 设计页面触发的安装流程 |
| **D2** | 实现 Node.js 安装器（MCP 配置 + 同步 + skill + policy + launcher） |
| **D3** | 实现安装验证（每阶段成功/失败报告） |

### Epic E：Launcher

| Task | 描述 |
|------|------|
| **E1** | 实现基于脚本的 launcher v1（macOS/Linux bash + Windows PowerShell） |
| **E2** | 添加 policy 感知的启动流程（读取 policy + 注入 + 缺失时提示） |
| **E3（Phase 2）** | 设计 host bootstrap launcher v2（已推迟） |

### Epic F：遥测、验证和发布

| Task | 描述 |
|------|------|
| **F1** | 为 Codex 扩展遥测维度 |
| **F4** | 实现基于 Codex Hook 的 MCP 调用 CSP Telemetry 接入（**前置条件：E1 完成**） |
| **F2** | 创建双端支持验证矩阵（Cursor + Codex 验证用例） |
| **F3** | 创建分阶段发布计划（内部测试 → 试点 → 受控发布 → 全量） |

## 10. Streamable HTTP 的服务器部署变更

当 Streamable HTTP 成为 Codex 的默认路径时，服务器侧部署必须更新：
1. 添加 Streamable HTTP 监听器和路由配置
2. 更新入口或反向代理配置
3. 验证 auth header 转发
4. 验证超时和 keepalive 行为
5. 添加新 transport 特定的健康检查
6. 添加 transport 特定故障的监控仪表板和日志
7. 记录 Cursor 和 Codex 如何选择不同的 transport 默认值

## 11. 推荐技术选型

| 组件 | 技术 | 原因 |
|------|------|------|
| 服务器 | TypeScript / Node.js / Fastify | 保留现有基础，添加 transport 适配器而不是重写工具逻辑 |
| 安装器 | TypeScript / Node.js | 跨平台文件操作；配置修补；与现有代码库复用 |
| Launcher v1 | macOS/Linux: bash / Windows: PowerShell | 原生平台集成；低运营复杂性 |
| Launcher v2（Phase 2+） | 见 §16 未来规划 | 依赖 host 特定集成 API，尚未稳定 |

## 12. 发布顺序

1. 稳定基于适配器的双端支持架构和配置模型
2. 实现带 `cursor` 和 `codex` 的适配器注册表
3. 实现 Streamable HTTP 服务器支持
4. 实现客户端感知的资源映射
5. 实现 `csp-routing-policy.md`
6. 实现安装器
7. 实现 launcher v1
8. 验证 Cursor 行为不变
9. 验证 Codex 管理行为
10. 向试点用户发布
11. 根据试点反馈评估 launcher v2 host 集成需求（Phase 2 决策）
12. 在不修改共享核心的情况下添加下一个客户端适配器（如 Claude）

## 13. 验收标准

仅当以下所有条件为真时，设计才被认为完成：
1. Cursor 用户可以继续使用现有流程，无回归。
2. Codex 用户可以通过安装流程配置 MCP。
3. Codex 用户可以同步和安装 CSP 管理的 skill。
4. `csp-routing-policy.md` 已正确生成、更新，并通过 schema 验证。
5. launcher v1 提供稳定的 CSP 管理 Codex 入口点。
6. Streamable HTTP transport 已部署并验证。
7. 遥测可以区分 Cursor 和 Codex 路径。
8. 双端支持测试覆盖存在并通过。
9. 客户端特定行为通过适配器路由，而非硬编码的客户端分支散落在代码库各处。
10. Codex 侧 MCP tool 调用通过 `after_tool_call` hook 主动上报至 CSP telemetry，CSP 后台可按 session/skill/connector 聚合 Codex 使用数据，与 Cursor 侧遥测统计对齐。

## 14. 最终建议

将此视为**双端支持架构计划**，而非弃用 Cursor 的迁移。
指导规则应是：
- 保持 Cursor 稳定
- 增量添加 Codex 支持
- 将共享逻辑移入公共层
- 将客户端特定行为隔离在适配器、打包和启动流程之后
- 通过可插拔适配器模型使未来客户端（如 Claude）可以附加添加

此方法最大程度降低风险，保留现有用户，并为长期多客户端支持创建干净的基础。

## 15. 实施计划（5 天）

### Day 1 – 2：整体架构实现

**目标**：完成所有核心架构模块的编码，达到"可在本地跑通"的状态。

**Day 1 前置清理（必须先于其他任务完成）**：

| 前置任务 | 说明 |
|---------|------|
| 确认 `transport/sse.ts` 的调用路径 | 若已被 `server/http.ts` 完全替代则删除；若仍有调用则合并后删除。消除两套 SSE 实现并存的歧义。 |
| 统一 `stdio` 路径的 MCP Server 实例化 | `server.ts` 中 `startStdioServer()` 需复用 `http.ts` 的 `createMcpServer()` 工厂，消除两套初始化逻辑 |

| 主任务 | 对应 Epic |
|--------|----------|
| 引入 `ClientAdapter` 接口和适配器注册表 | Epic A（Task A0） |
| 实现 `cursor` 和 `codex` 适配器（transport、分发路径、policy 策略） | Epic A（Task A0） |
| 重构 `sync-resources.ts`，替换 cursor-paths 直接依赖为适配器调用 | Epic B（Task B1–B3） |
| 更新 `http.ts` 中 `oninitialized` 回调，`agent_profile=codex` 时跳过 `storeSyncActions` | Epic B（Task B2） |
| 实现 Streamable HTTP transport 支持 | Epic A（Task A3） |
| 实现 `csp-routing-policy.md` 生成逻辑（rule → policy 注入） | Epic C（Task C1） |
| 实现 `command` 资源到 Codex skill bundle 的转化逻辑 | Epic B（Task B4） |
| 实现 Codex installer（`~/.codex/config.toml` 写入） | Epic D（Task D1） |
| 实现 Codex launcher v1（bash/PowerShell 脚本，启动时执行 sync + 注入 policy） | Epic E（Task E1） |

**Day 2 结束检查点**：
- `transport/sse.ts` 确认状态已明确（删除或合并）
- `agent_profile=codex` 可触发完整的 sync → distribute → launch 流程（即使有部分 mock）
- `agent_profile=cursor` 行为无回归（所有现有 Cursor 路径仍走适配器而非裸分支）

### Day 3 – 4：本地测试、Fix 问题，并向 Server 端交付

**Client 端（并行）**：
- 运行双端测试矩阵（Epic F，Task F2）
- 修复测试中发现的问题
- 验证 `agent_profile` 在两端的 telemetry 标签均正确记录

**Server 端（并行，Day 3 启动）**：
- Client 在 Day 2 结束时打出包（含 Streamable HTTP transport），交付 Server 端
- Server 端完成 Streamable HTTP 监听器和路由配置
- Client 与 Server 端进行点对点联调，确认新 transport 连接可通

**Day 4 结束检查点**：本地双端测试全部通过 + Server 端 Streamable HTTP 配置完成并可接受连接 + Client-Server 联调验证通过

### Day 5：Dev 环境上线测试

**目标**：在 dev 环境模拟真实用户流程，完成上线前验收。

| 验证项 | 对应验收标准 |
|--------|------------|
| Cursor 用户全流程无回归（sync、skill、rule、MCP 安装） | 验收标准第 1 条 |
| Codex 用户通过安装流程配置 MCP | 验收标准第 2 条 |
| Codex 用户同步并安装 CSP skill（简单 + 复杂） | 验收标准第 3 条 |
| `csp-routing-policy.md` 正确生成并通过 schema 验证 | 验收标准第 4 条 |
| launcher v1 稳定启动并注入 policy | 验收标准第 5 条 |
| Streamable HTTP transport 在 dev 环境端到端验证 | 验收标准第 6 条 |
| Telemetry 标签可区分 Cursor 和 Codex 路径 | 验收标准第 7 条 |

**Day 5 结束检查点（Go/No-Go）**：
- 所有验收标准第 1–7 条通过 → **Phase 1 完成，可进入试点发布**
- 有阻塞项 → 记录到 Bug 档案，评估是 hotfix 还是延期

### 关键依赖与风险

| 风险项 | 影响 | 缓解措施 |
|--------|------|---------|
| Server 端 Streamable HTTP 配置耗时超预期 | Day 4 联调 delay | Day 3 同步启动，保留缓冲 |
| Codex `after_tool_call` hook 接口不如预期（Task F4 前提待确认） | Telemetry 接入推迟 | Hook telemetry 不阻塞 Phase 1 主体，可作为 Day 5 后的 follow-up |
| `command` 转化逻辑复杂度超预期 | Day 1–2 delay | 优先保证架构主干，command 转化可降级为"跳过 Codex 分发"后续补齐 |

## 16. 未来规划（Phase 1 范围之外）

### 16.1 Launcher v2：Host/Session Bootstrap 集成

**目标**：从进程包装式 launcher 迁移到 session bootstrap 式 launcher，通过在 session 创建时注入 CSP policy 来消除包装脚本的需要。

**推迟原因**：Phase 1 建立基础架构。Launcher v2 需要尚未稳定的 host 特定集成 API。是否投资 v2 的决策应在 v1 部署后根据试点反馈做出。

**推荐技术**：TypeScript 加 host 特定适配器层。

**决策点**：在 Phase 1 试点发布后（发布顺序第 11 步），评估 launcher v1 的使用摩擦是否足以证明 v2 投资合理。

### 16.2 用于受控诊断的 `agent_profile = unknown`

**目标**：允许未来的诊断或测试路径将自身声明为 `unknown`，并不接收任何客户端特定行为。

**推迟原因**：Phase 1 只有两个客户端。过早引入会增加实现负担而无对应收益。

**决策点**：当实现第三个客户端适配器（如 Claude）时，重新审视。

### 16.3 通过 HTTP Header/Query Parameter 传播 `agent_profile`

**目标**：允许通过 HTTP header 或 query parameter 传递 `agent_profile`，用于远程或多租户 MCP 部署。

**推迟原因**：Phase 1 仅使用环境变量传播，这对本地进程式 MCP 已经足够。远程传播引入了认证和信任考量，应与 Streamable HTTP transport 发布一起设计。

**决策点**：在 Task A3（Streamable HTTP transport）部署并验证后，作为 Phase 2 transport 加固工作的一部分来设计传播机制。
