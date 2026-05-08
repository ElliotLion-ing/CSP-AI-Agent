# CODEX-001 实施规划：CSP AI Agent Codex 双端支持

**版本:** 1.0.0 | **创建日期:** 2026-05-08 | **状态:** 待执行

> 参考设计文档：`Docs/Design/CSP-AI-Agent-Codex-Dual-Client-Design.md`
> 参考 Feature 文档：`NewFeature/FEAT-2026-05-08-001-Codex-Dual-Client/feature-design.md`
> 执行前必须：创建 OpenSpec 提案 → validate → 用户批准 → 按阶段执行

---

## 执行总览

| 阶段 | 名称 | 主要产出 | 预计时长 | 依赖 |
|------|------|---------|---------|------|
| **0** | 前置清理 | 删除遗留 SSE 文件，统一 Server 初始化 | 0.5d | 无 |
| **1** | 客户端适配器框架 | `client-adapters/`、`codex-paths.ts`、config 扩展 | 1d | 阶段 0 |
| **2** | Transport 扩展 | Streamable HTTP transport | 1d | 阶段 1 |
| **3** | 同步分发重构 | `sync-resources.ts` Codex 分支、`oninitialized` 更新 | 1.5d | 阶段 1 |
| **4** | Policy 物化 | `policy-generator.ts`、`csp-routing-policy.md` 生成 | 0.5d | 阶段 3 |
| **5** | MCP-Driven Bootstrap | `merge_toml` action、`developer_instructions` 注入 | 0.5d | 阶段 4 |
| **6** | 遥测扩展 | `agent_profile` 维度 | 0.5d | 阶段 1 |
| **7** | 测试验证 | 回归测试 + Codex 端到端测试 | 贯穿全程 | — |

---

## 阶段 0：前置清理

**目标**：消除两套 SSE 实现并存的问题，统一 Server 初始化逻辑，为后续重构打好基础。

### 任务清单

- [ ] **0-1** 删除 `SourceCode/src/transport/sse.ts`
  - 确认依据：全局搜索确认无任何文件 `import` 该文件（已验证）
  - 操作：直接删除

- [ ] **0-2** 重构 `SourceCode/src/server.ts` 中的 `startStdioServer()`
  - 当前问题：`startStdioServer()` 手动创建 `Server` + 手动注册 handlers，与 `http.ts` 的 `createMcpServer()` 工厂逻辑重复
  - 修改方式：提取 `createMcpServer()` 到 `server.ts` 可访问的共享位置，或从 `http.ts` 导出，`startStdioServer()` 复用它
  - 验证：stdio 路径功能不变，`promptManager.installHandlers` 正常工作

### 完成标准

- `transport/sse.ts` 已删除，编译无报错
- `startStdioServer()` 与 `http.ts` 的 `createMcpServer()` 共享同一套初始化逻辑
- 现有 Cursor SSE 功能回归测试通过

---

## 阶段 1：客户端适配器框架

**目标**：建立 `ClientAdapter` 抽象层，让后续所有客户端特定逻辑通过适配器路由，不在共享核心中出现 `if (profile === 'codex')` 分支。

### 新建文件

#### `SourceCode/src/client-adapters/index.ts`

定义核心接口和注册表：

```typescript
export type AgentProfile = 'cursor' | 'codex';

export interface MaterializationPath {
  localPath: string;        // e.g. "~/.cursor/rules/<name>.mdc"
  actionType: 'write_file' | 'merge_mcp_json' | 'merge_toml' | 'skip';
}

export interface PolicyStrategy {
  type: 'mdc' | 'policy_inject';
  targetDir?: string;           // for 'mdc'
  policyFile?: string;          // for 'policy_inject'
  configTomlKey?: string;       // for 'policy_inject' → developer_instructions
  configTomlPath?: string;      // for 'policy_inject' → ~/.codex/config.toml
}

export interface ClientAdapter {
  profile: AgentProfile;
  getSkillDir(skillName: string): string;
  getCommandDir(commandName: string): string;
  getRuleTargetDirs(scope: string): string[];
  getMcpConfigPath(): string;
  getPolicyStrategy(): PolicyStrategy;
  getTelemetryTags(): Record<string, string>;
}

export class ClientAdapterRegistry {
  private adapters = new Map<AgentProfile, ClientAdapter>();
  register(adapter: ClientAdapter): void { ... }
  get(profile: AgentProfile): ClientAdapter { ... }  // 缺失时返回 cursor 适配器
}

export const adapterRegistry = new ClientAdapterRegistry();
```

#### `SourceCode/src/client-adapters/cursor-adapter.ts`

封装现有 `cursor-paths.ts` 行为，行为与当前完全一致：

```typescript
// skill/command → ~/.csp-ai-agent/skills/<name>/（复杂）or MCP Prompt（简单）
// rule → ~/.cursor/rules/<name>.mdc（global/workspace/all scope）
// mcp → ~/.cursor/mcp.json（merge_mcp_json action）
// policy strategy: { type: 'mdc', targetDir: '~/.cursor/rules' }
```

#### `SourceCode/src/client-adapters/codex-adapter.ts`

新增 Codex 分发路径：

```typescript
// skill（复杂）→ ~/.csp-ai-agent/codex/skills/<name>/
// skill（简单）→ MCP Prompt（同 Cursor）
// command → 转化为 Codex skill bundle → ~/.csp-ai-agent/codex/skills/<name>/
// rule → 贡献到 csp-routing-policy.md（不写 .mdc 文件）
// mcp → ~/.codex/config.toml（merge_toml action）
// policy strategy: { type: 'policy_inject', policyFile: '~/.csp-ai-agent/codex/csp-routing-policy.md',
//                    configTomlKey: 'developer_instructions', configTomlPath: '~/.codex/config.toml' }
```

#### `SourceCode/src/utils/codex-paths.ts`

```typescript
export function getCodexRootDirForClient(): string  // "~/.csp-ai-agent/codex"
export function getCodexSkillDirForClient(name: string): string
export function getCodexPolicyPathForClient(): string
export function getCodexConfigTomlPathForClient(): string  // "~/.codex/config.toml"
```

### 修改文件

#### `SourceCode/src/config/index.ts`

新增字段：
```typescript
agentProfile: (process.env.CSP_AGENT_PROFILE === 'codex' ? 'codex' : 'cursor') as AgentProfile
```

#### `SourceCode/src/types/tools.ts`

扩展 `SyncResourcesParams`：
```typescript
agent_profile?: 'cursor' | 'codex';  // 可选，默认 'cursor'
```

新增 `merge_toml` action 类型：
```typescript
interface MergeTomlAction {
  action: 'merge_toml';
  toml_path: string;
  key: string;
  value: string;
  overwrite: boolean;
}
```

### 完成标准

- `ClientAdapter` 接口存在，cursor + codex 适配器均实现
- config 中 `CSP_AGENT_PROFILE=codex` 可读取，缺失时默认 `cursor`
- 编译无报错，不修改任何现有工具逻辑

---

## 阶段 2：Transport 扩展

**目标**：新增 Streamable HTTP transport，保持 `sse` / `stdio` 完全不变。

### 新建文件

#### `SourceCode/src/server/streamable-http.ts`

参照 `http.ts` 结构，使用 MCP SDK 的 `StreamableHTTPServerTransport`：

```typescript
// 端点：POST /mcp（统一接收所有 JSON-RPC 消息）
// 认证：复用 tokenAuthOrLegacyMiddleware
// Server 实例：复用 createMcpServer() 工厂
// 健康检查：GET /health（与 http.ts 一致）
```

关键区别：Streamable HTTP 是无状态的（每个 POST 请求独立），不需要 SSE 的 sessionId 和 heartbeat 机制。

### 修改文件

#### `SourceCode/src/server.ts`

在 `startServer()` 中新增分支：

```typescript
if (transportMode === 'sse') {
  await startSSEServer();
} else if (transportMode === 'streamable_http') {
  await startStreamableHttpServer();  // 新增
} else {
  await startStdioServer();
}
```

在服务器启动时将 `config.agentProfile` 传入适配器注册表（不传入共享工具）。

### 完成标准

- `transport_mode=streamable_http` 可启动服务器
- Codex 可通过 Streamable HTTP 连接，`tools/list` 和 `tools/call` 正常工作
- `sse` / `stdio` 路径功能回归测试通过

---

## 阶段 3：同步分发重构

**目标**：`sync-resources.ts` 通过适配器分发，Cursor 路径行为零变更，Codex 路径纯新增。

**依赖**：阶段 1 完成（适配器接口稳定）

### 修改文件

#### `SourceCode/src/tools/sync-resources.ts`（重大重构）

**改动原则**：
- 不改变任何现有 Cursor 路径的逻辑
- 在资源类型处理的末尾新增 Codex 分支（通过 `adapter` 参数路由）
- 将 5 个 `cursor-paths` 直接导入替换为 `adapter.getXxx()` 调用

**具体改动**：

1. 函数签名引入 `adapter` 参数（由外部传入，不在函数内部解析）
2. **`rule` 类型**：Cursor 分支保持不变（`scope` 三级策略）；Codex 分支：收集 rule 内容，传给 policy-generator（阶段 4 实现）
3. **`mcp` 类型**：Cursor 分支保持不变（`merge_mcp_json`）；Codex 分支：生成 `merge_toml` action 写入 `~/.codex/config.toml` 的 `mcp_servers` 条目
4. **`command` 类型**：Cursor 分支保持不变（MCP Prompt）；Codex 分支：转化为 skill bundle 写入 `~/.csp-ai-agent/codex/skills/<name>/`
5. **复杂 `skill` 类型**：Cursor 分支保持不变（`~/.csp-ai-agent/skills/<name>/`）；Codex 分支：写入 `~/.csp-ai-agent/codex/skills/<name>/`

#### `SourceCode/src/server/http.ts`

在 `oninitialized` 回调中，当 `agent_profile=codex` 时，跳过 `storeSyncActions()`：

```typescript
if (agentProfile !== 'codex') {
  // PromptManager 交付路径仅适用于 Cursor
  promptManager.storeSyncActions(userToken ?? '', actions);
}
```

### 完成标准

- `agent_profile=cursor` 的所有现有行为零变更（回归测试通过）
- `agent_profile=codex` 触发时，Codex 分发路径正确生成 local_actions
- `oninitialized` 在 codex profile 下不调用 `storeSyncActions`

---

## 阶段 4：Policy 物化

**目标**：将所有订阅的 `rule` 资源内容合并生成 `csp-routing-policy.md`，并通过 `merge_toml` action 同步到 `~/.codex/config.toml` 的 `developer_instructions` 字段。

**依赖**：阶段 3 完成

### 新建文件

#### `SourceCode/src/utils/policy-generator.ts`

```typescript
interface PolicyInput {
  resourceId: string;
  resourceName: string;
  version: string;
  content: string;
}

/**
 * 将多个 rule 资源内容合并为 csp-routing-policy.md 格式。
 * - YAML front matter（版本、生成时间、contributing_resources）
 * - 各 rule 内容按 resourceId 字典序排列（确定性合并）
 * - 原子写入（先写临时文件，再 rename）
 */
export function generatePolicyContent(inputs: PolicyInput[]): string { ... }
```

### 修改文件

#### `SourceCode/src/tools/sync-resources.ts`

在 Codex 路径的 rule 处理完成后（收集完所有 rule 内容），调用 `generatePolicyContent()` 生成 policy 字符串，然后追加两个 local_actions：

```typescript
// Action 1: 写入可读副本
localActions.push({
  action: 'write_file',
  path: getCodexPolicyPathForClient(),  // "~/.csp-ai-agent/codex/csp-routing-policy.md"
  content: policyContent,
  encoding: 'utf8',
});

// Action 2: 写入 ~/.codex/config.toml 的 developer_instructions
localActions.push({
  action: 'merge_toml',
  toml_path: getCodexConfigTomlPathForClient(),  // "~/.codex/config.toml"
  key: 'developer_instructions',
  value: policyContent,
  overwrite: true,  // 每次 sync 强制覆盖，保持最新
});
```

### 修改 `SyncResourcesResult` 类型

在 `SourceCode/src/types/tools.ts` 中补充：

```typescript
restart_required?: boolean;
restart_hint?: string;
```

在 sync 返回值中，Codex profile 且有 policy 更新时设置：

```typescript
restart_required: true,
restart_hint: "CSP routing policy 已更新。请重启 Codex 以使路由规则作为 developer 指令生效。",
```

### 完成标准

- 订阅的 rule 资源内容被正确合并为 `csp-routing-policy.md`
- `~/.codex/config.toml` 的 `developer_instructions` 字段被正确写入
- 合并顺序具有确定性（按 resourceId 排序）
- `restart_required: true` 在 Codex profile 下正确返回

---

## 阶段 5：MCP-Driven Bootstrap（完整）

**目标**：确保 `merge_toml` action 被客户端正确处理，并补充 Codex MCP 配置写入逻辑。

**依赖**：阶段 4 完成

### 阶段 5 任务

- [ ] **5-1** 在 `AGENTS.md` 中的「local_actions 处理规范」补充 `merge_toml` action 的客户端处理说明
  - TOML 解析：读取 `~/.codex/config.toml`（不存在则创建）
  - 按 `key` 写入/覆盖指定字段
  - 注意 TOML 多行字符串的正确格式（`developer_instructions` 内容可能包含换行）

- [ ] **5-2** 在 `sync-resources.ts` 中，Codex profile 的 `mcp` 资源处理增加 `merge_toml` action
  - 格式：向 `~/.codex/config.toml` 的 `[mcp_servers.<name>]` 表中写入 MCP 配置
  - 对应 Codex MCP 配置格式：`url`（streamable HTTP）或 `command`（stdio）

- [ ] **5-3** 验证 `restart_hint` 文案在 Cursor SSE 连接的 `csp-ai-agent-setup` prompt 中不出现（仅 Codex profile 返回）

### 完成标准

- Codex 首次连接后，`~/.codex/config.toml` 包含正确的 `developer_instructions` 和 `mcp_servers` 配置
- Codex 重启后，policy 以 developer 指令形式生效（可手动验证）
- Agent 向用户展示 `restart_hint` 提示

---

## 阶段 6：遥测扩展

**目标**：所有 telemetry 事件携带 `agent_profile` 维度，Cursor 和 Codex 路径可区分。

### 修改文件

#### `SourceCode/src/telemetry/manager.ts`

- 在 telemetry 初始化时从 `config.agentProfile` 读取 profile 值
- 所有 `track()` 调用的事件 payload 中追加 `agent_profile` 字段
- 向后兼容：对 Cursor profile 不变，仅新增字段

#### `SourceCode/src/tools/resolve-prompt-content.ts` + `track-usage.ts`

- 核查两个工具在 Codex profile 下的 telemetry 调用路径
- 确保 `agent_profile=codex` 时 telemetry 正常上报（不因 profile 不同而跳过）

### 完成标准

- `track_usage` 事件包含 `agent_profile` 字段
- `resolve_prompt_content` 在两端均触发 telemetry
- Cursor 遥测语义不变

---

## 阶段 7：测试验证

**目标**：每阶段完成后创建并运行对应测试，最终达到双端全覆盖。

### 测试文件规划

| 测试文件 | 覆盖内容 | 对应阶段 |
|---------|---------|---------|
| `Test/test-stage0-cleanup.js` | `transport/sse.ts` 已删除，stdio Server 初始化正常 | 阶段 0 后 |
| `Test/test-stage1-adapter.js` | 适配器注册表、cursor/codex 适配器路径正确 | 阶段 1 后 |
| `Test/test-stage2-transport.js` | Streamable HTTP 连接、tools/list、tools/call | 阶段 2 后 |
| `Test/test-stage3-codex-sync.js` | Codex sync：skill/command/mcp 各类型分发路径正确 | 阶段 3 后 |
| `Test/test-stage4-policy.js` | policy 内容生成、合并顺序、merge_toml action 正确 | 阶段 4 后 |
| `Test/test-stage5-bootstrap.js` | config.toml 写入、developer_instructions 字段、restart_hint | 阶段 5 后 |
| `Test/test-cursor-regression.js` | Cursor 全路径回归：sync/rule/skill/mcp，所有行为与改前一致 | 每阶段后 |

### 双重验证要求（AGENTS.md 规则 #2）

每阶段完成：
1. 运行对应测试脚本，Pass Rate = 100%
2. 查看 `Logs/` 日志，无 ERROR/FATAL
3. 两者一致 → 才能进入下一阶段

---

## OpenSpec 提案信息

```
Change ID: CODEX-001
提案路径: openspec/changes/CODEX-001/
```

创建命令：
```bash
mkdir -p openspec/changes/CODEX-001/specs/client-adapter
mkdir -p openspec/changes/CODEX-001/specs/codex-distribution
mkdir -p openspec/changes/CODEX-001/specs/policy-injection
mkdir -p openspec/changes/CODEX-001/specs/codex-transport
openspec validate CODEX-001 --strict
```

---

## 里程碑完成标准（AGENTS.md 规则 #2）

每个阶段必须满足以下所有条件才能进入下一阶段：
1. ✅ 该阶段所有单元测试通过（Pass Rate 100%）
2. ✅ Mock/端到端测试通过
3. ✅ `Test Reports/` 中有测试报告
4. ✅ `Memory/` 中有本阶段决策记录
5. ✅ 已执行阶段性 git commit（用户确认后）
