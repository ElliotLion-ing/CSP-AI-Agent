# Feature: Solid Prompt Content Tool for Dynamic MCP Resources

**Feature ID:** FEAT-2026-03-27-001  
**版本:** 1.0.0  
**创建日期:** 2026-03-27  
**状态:** 设计确认中

---

## 1. 背景与问题定义

### 1.1 当前现状

当前项目已经支持两类与 Prompt 相关的能力：

1. `sync_resources` 在服务端根据订阅结果动态注册 MCP Prompt
2. `PromptManager` 支持 `prompts/list` 与 `prompts/get`
3. Command / Skill 的展开内容会缓存到服务端 `.prompt-cache/`

这套设计对“连接建立前已经存在的订阅资源”是合理的，因为服务端可以在连接初始化后完成同步与注册。

### 1.2 当前失败根因

本次问题不是 Prompt 内容生成失败，而是 **Cursor / Agent 在动态订阅后的当次调用链中，没有稳定继续走 `prompts/get`**。

表现为：

1. Agent 可以拿到 prompt metadata
2. Agent 可以完成 `search_resources`、`manage_subscription`、`sync_resources`
3. 但在同一轮任务里，没有稳定发起真正的 `GetPrompt`
4. 最终 AI 只能基于描述字段推理，而不是基于 prompt 正文执行

这说明当前系统把“动态资源可被 slash 发现”和“当前任务能立即拿到正文”混成了一个能力，但实际上它们不是同一条链路。

### 1.3 设计目标

本 Feature 的目标不是替代 MCP Prompt，而是补齐一条**不依赖 Cursor 是否继续正确调用 `prompts/get` 的稳定正文获取路径**。

换句话说：

- 原生 Prompt 继续保留，用于 slash 体验
- 新增一个 solid call 的 Tool，用于动态订阅后的即时正文拉取
- 两者共享同一套 Prompt 内容解析内核，避免逻辑漂移

---

## 2. 目标与非目标

### 2.1 目标

本 Feature 要达成以下目标：

1. 对“连接建立后已同步完成”的 Prompt，继续支持原生 slash 使用
2. 对“当前对话中刚刚新增订阅”的 Prompt，提供稳定的 Tool 方式拿正文
3. Tool 返回的正文必须与 `prompts/get` 返回的正文一致
4. Tool 路径必须支持复用 `.prompt-cache` 与现有 Prompt 生成逻辑
5. Tool 路径必须支持与现有埋点体系兼容，不能丢失使用统计
6. 整体设计不破坏当前 SSE MCP Server 架构，不引入新的传输协议

### 2.2 非目标

本 Feature 当前不解决以下问题：

1. 不保证 Cursor 在“本轮动态注册后”立即刷新 slash 菜单
2. 不试图修改 Cursor 客户端对 MCP Prompt 的内部调度行为
3. 不把 Tool 方案作为唯一方案替换原生 Prompt
4. 不在第一阶段解决 Git 拉取失败、证书链或 SSH 环境问题

---

## 3. 核心设计决策

### 3.1 双轨制架构

本 Feature 采用双轨制：

1. **原生 Prompt 轨**
   - 用于已注册 Prompt 的 slash 场景
   - 继续使用 `prompts/list` + `prompts/get`

2. **Solid Tool 轨**
   - 用于动态订阅后的即时正文获取
   - 不依赖 Cursor 是否补发 `prompts/get`

### 3.2 共享解析内核

无论是 `prompts/get` 还是新 Tool，都不能各自维护一份正文生成逻辑。

必须新增一层共享能力，例如：

- `PromptManager.resolvePromptContent(...)`
- 或 `PromptManager.getPromptPayload(...)`

由这层统一负责：

1. 根据 `prompt_name` 或 `resource_id` 查找注册项
2. 优先读取 `.prompt-cache`
3. cache miss 时重新展开 markdown/import
4. 生成统一的 `description + messages/content`
5. 在需要时记录 usage telemetry

### 3.3 Tool 不是“模拟 MCP 协议”，而是“提供等价业务能力”

新 Tool 不应在服务端内部再发一次 MCP `GetPrompt` 请求。

原因：

1. 这样只是把协议绕了一圈，没有提升稳定性
2. 会把协议层与业务层耦合得更重
3. 未来很难复用与测试

正确做法是：

- Tool 直接调用共享的 Prompt 内容解析内核
- `GetPrompt` handler 也调用同一个内核

### 3.4 埋点策略调整

对原生 Prompt 路径，现有埋点策略继续保留。

对 Tool 路径，不能再依赖“prompt 正文里的 `track_usage` 指令头”才能完成统计，因为 Tool 已经是一次明确的资源调用。

因此 Tool 路径应支持：

1. 服务端直接记录一次资源调用
2. 或在返回结果中明确标记 `usage_tracked: true`

推荐方案是 **Tool 内直接记录 usage**，避免再次依赖模型遵循指令。

---

## 4. 总体方案

### 4.1 新增 Tool

建议新增 Tool：`resolve_prompt_content`

推荐输入：

```json
{
  "prompt_name": "command/acm-helper",
  "jira_id": "ZOOM-12345"
}
```

也支持按资源 ID 调用，便于在 `search -> subscribe -> sync` 后直接衔接：

```json
{
  "resource_id": "cmd-client-sdk-ai-hub-acm-helper",
  "jira_id": "ZOOM-12345"
}
```

### 4.2 Tool 返回结构

推荐返回：

```json
{
  "result": "success",
  "data": {
    "prompt_name": "command/acm-helper",
    "resource_id": "cmd-client-sdk-ai-hub-acm-helper",
    "description": "Analyze ACM related issues",
    "content": "# Prompt body ...",
    "content_source": "cache",
    "usage_tracked": true
  }
}
```

说明：

1. `content` 是 AI 真正要执行的正文
2. `content_source` 用于排查问题，值可为 `cache`、`generated`、`raw_fallback`
3. `usage_tracked` 用于明确声明这次 Tool 路径已完成埋点

### 4.3 共享能力抽象

建议在 `PromptManager` 中新增两层方法：

1. **解析层**

```typescript
resolvePromptContent(params): Promise<ResolvedPromptContent>
```

负责：

- 名称或 ID 解析
- 注册项查找
- cache 读取
- cache miss 重建
- 返回标准化正文结构

2. **调用层**

```typescript
invokePromptResource(params): Promise<ResolvedPromptContent>
```

在解析层基础上再补：

- telemetry 记录
- 调用日志
- 输出给 Tool 的结构

而 `GetPrompt` handler 则调用解析层，不直接走调用层，避免 double track。

### 4.4 推荐执行链路

#### 场景 A：连接已建立，资源已存在

```text
用户输入 /slash
  ↓
Cursor -> prompts/list
  ↓
Cursor -> prompts/get
  ↓
MCP Server 返回 prompt 正文
  ↓
AI 执行正文
```

#### 场景 B：当前会话中刚新增订阅资源

```text
search_resources
  ↓
manage_subscription
  ↓
sync_resources
  ↓
resolve_prompt_content
  ↓
AI 使用返回的 content 继续执行
```

这里不再赌 Cursor 会不会在这轮里自动补发 `prompts/get`。

---

## 5. API / Tool 设计

### 5.1 Tool 名称

推荐正式名称：

- `resolve_prompt_content`

不建议名称：

- `get_prompt`
  - 容易和 MCP 协议原语混淆
- `prompts_get`
  - 暗示这是协议代理，不利于边界清晰

### 5.2 Input Schema

```json
{
  "type": "object",
  "properties": {
    "prompt_name": {
      "type": "string",
      "description": "MCP prompt name, e.g. command/acm-helper"
    },
    "resource_id": {
      "type": "string",
      "description": "Canonical CSP resource ID, e.g. cmd-client-sdk-ai-hub-acm-helper"
    },
    "jira_id": {
      "type": "string",
      "description": "Optional Jira issue ID for usage correlation"
    }
  },
  "anyOf": [
    { "required": ["prompt_name"] },
    { "required": ["resource_id"] }
  ]
}
```

### 5.3 输出约束

Tool 返回必须满足：

1. 永远返回结构化 JSON，不返回裸 Markdown
2. 正文放在 `data.content`
3. 错误时给出明确错误码或错误原因
4. 找不到资源时提示先执行 `sync_resources`

错误示例：

```json
{
  "result": "failed",
  "error": {
    "code": "PROMPT_NOT_FOUND",
    "message": "Prompt \"command/acm-helper\" is not available. Please run sync_resources first."
  }
}
```

---

## 6. 模块改造方案

### 6.1 `src/prompts/manager.ts`

新增或重构：

1. 抽出共享的 Prompt 解析方法
2. 支持通过 `prompt_name` 查找
3. 支持通过 `resource_id` 反查 prompt
4. 返回统一的 `ResolvedPromptContent`
5. 区分“仅解析”和“解析并记 usage”

### 6.2 `src/tools/`

新增：

- `resolve-prompt-content.ts`

职责：

1. 参数校验
2. 调用 `PromptManager.invokePromptResource(...)`
3. 返回结构化结果
4. 记录 tool 调用日志

### 6.3 `src/tools/index.ts` / `src/tools/registry.ts`

需要注册新 Tool，并确保其在 `tools/list` 中可见。

### 6.4 `src/server/http.ts`

无需新增协议能力。

本 Feature 不增加新的 transport、endpoint 或 capability，只是在现有 Tool 框架内增加一个稳定入口。

---

## 7. 用户体验设计

### 7.1 对用户的期望行为

用户层面分为两种体验：

1. **已存在资源**
   - 继续直接 `/slash`

2. **本轮刚新增资源**
   - AI 在工具链中自动调用 `resolve_prompt_content`
   - 用户不需要理解 `prompts/get`、cache 或动态注册细节

### 7.2 对 Agent 的推荐工作流

当 Agent 在当前会话中刚完成订阅与同步时，推荐工作流为：

```text
search_resources
→ manage_subscription
→ sync_resources
→ resolve_prompt_content
→ 按 content 执行任务
```

### 7.3 与原生 slash 的关系

本 Feature 不是放弃 slash，而是明确边界：

1. slash 适合“连接后已注册完成”的 Prompt
2. Tool fallback 适合“同轮动态新增”的 Prompt

---

## 8. 兼容性与风险

### 8.1 兼容性

该方案是增量增强，不是破坏性改造：

1. 现有 `prompts/list` / `prompts/get` 继续保留
2. 现有 `.prompt-cache` 继续保留
3. 现有 `sync_resources` 注册 Prompt 逻辑继续保留
4. 新 Tool 只是补一条稳定消费链路

### 8.2 主要风险

#### 风险 1：双重埋点

如果 Tool 路径和 Prompt 路径都记 usage，可能产生重复统计。

缓解方式：

1. `GetPrompt` 与 Tool 分开控制埋点策略
2. Tool 直接记 usage 时，返回正文可不再强制依赖 `track_usage` 指令头
3. 或保留指令头但标记 Tool 已完成埋点，后续统计层去重

推荐第一阶段直接采用：

- Tool 路径服务端记 usage
- `GetPrompt` 路径保持现有逻辑

#### 风险 2：两套调用入口导致结果不一致

缓解方式：

必须强制两条路径共用同一套解析内核，禁止复制逻辑。

#### 风险 3：Agent 拿到 content 后仍未按正文执行

这是模型执行质量问题，不是 Prompt 获取链路问题。

本 Feature 目标是先保证“服务端稳定返回正文”，不把“模型是否完全遵守正文”与“正文能否拿到”混为一谈。

---

## 9. 实施建议

### 9.1 推荐分阶段实施

#### 阶段 1：共享解析内核

1. 在 `PromptManager` 中抽出统一解析方法
2. 让 `GetPrompt` handler 改为调用共享方法
3. 保持现有行为不变

#### 阶段 2：新增 Tool

1. 实现 `resolve_prompt_content`
2. 支持 `prompt_name` / `resource_id` 两种入口
3. 接入 usage telemetry

#### 阶段 3：Agent 使用策略

1. 补充 setup prompt / tool description
2. 明确告诉 AI：动态订阅后不要等待原生 prompt，而是直接调用 `resolve_prompt_content`

### 9.2 验证标准

Feature 完成后，至少要验证以下场景：

1. 连接初始化后，已存在 prompt 仍可正常 slash
2. 当前会话动态订阅一个 command 后，可通过 Tool 拿到完整正文
3. 当前会话动态订阅一个 skill 后，可通过 Tool 拿到完整正文
4. `.prompt-cache` 缺失时，Tool 仍可 fallback 生成正文
5. telemetry 不出现明显重复计数

---

## 10. 影响范围

### 10.1 代码模块

预计影响：

- `SourceCode/src/prompts/manager.ts`
- `SourceCode/src/tools/index.ts`
- `SourceCode/src/tools/registry.ts`
- `SourceCode/src/tools/resolve-prompt-content.ts`（新增）
- `Docs/Design/CSP-AI-Agent-Core-Design.md`
- `Docs/Design/CSP-AI-Agent-API-Mapping.md`

### 10.2 OpenSpec 影响

该 Feature 属于新增能力，后续需要创建 OpenSpec 提案，至少涉及：

1. MCP tools capability 扩展
2. Prompt 获取链路补强
3. telemetry 行为补充说明

---

## 11. 最终结论

本 Feature 的结论是：

1. **不能再把“动态 prompt 已注册”与“当前轮一定能拿到正文”视为同一个保障**
2. **原生 Prompt 保留，但不再作为动态订阅场景的唯一正文入口**
3. **新增 `resolve_prompt_content` Tool 是当前架构下最稳妥、最可控的 solid call 方案**
4. **实现关键不在于多加一个 Tool，而在于把 Prompt 正文解析收敛成唯一内核**

如果该设计确认通过，下一步进入：

1. 创建 OpenSpec proposal / tasks / spec delta
2. 再开始实现与测试

