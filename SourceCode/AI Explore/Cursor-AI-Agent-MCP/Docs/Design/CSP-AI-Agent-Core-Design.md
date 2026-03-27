# CSP-AI-Agent MCP Server - 核心设计文档

**版本**: v1.7  
**日期**: 2026-03-23  
**状态**: OpenSpec Validated ✅

> **📌 v1.7更新** (2026-03-27):
>
> - ✅ **Solid Prompt Content Tool**: 新增 `resolve_prompt_content` 作为动态订阅场景的稳定正文获取入口
> - ✅ **双轨调用模型**: 已注册 slash Prompt 继续走原生 `prompts/get`；同轮新订阅的 Command/Skill 走 `search -> subscribe -> sync -> resolve_prompt_content -> execute`
> - ✅ **共享解析内核**: `prompts/get` 与 `resolve_prompt_content` 复用同一套 `.prompt-cache` / 重新生成 / raw fallback 逻辑
> - ✅ **遥测扩展**: Command/Skill 使用统计不再只依赖 `GetPrompt`，tool fallback 成功解析时也会在服务端直接记 usage
>
> **📌 v1.6更新** (2026-03-23):
>
> - ✅ **track_usage 工具**: 新增第 6 个 MCP Tool，专用于遥测埋点；由 AI 在每次 Command/Skill 执行前自动调用，无需用户感知
> - ✅ **差量 Flush 修复**: `TelemetryManager.reportWithRetry` 改为差量更新 `pending_events`（按 `invocation_count` 扣减，归零后移除），解决 flush 期间新写入事件被清空的数据丢失问题
> - ✅ **await recordInvocation**: `track_usage` 工具中的 `telemetry.recordInvocation` 改为 `await`，防止定时 flush 在写入完成前读到旧状态导致 race condition
>
> **📌 v1.5更新** (FEAT-2026-03-20-002):
>
> - ✅ **MCP Prompt 模式**: Command/Skill 改为在 MCP Server 注册 MCP Prompt，不再下发实体文件到用户本地
> - ✅ **精准埋点**: 用户 `/slash` 调用经过 MCP Server handler，支持服务端统计每次调用（含可选 jira_id）
> - ✅ **中间文件缓存**: `.prompt-cache/` 目录存储展开后的 Prompt 内容（不进 Git）
> - ✅ **Telemetry 升级**: 本地文件存储于 `{MCP Server CWD}/ai-resource-telemetry.json`（非 `~/.cursor/`）；三个上报时机：每 10 秒定时、SSE 重连立即、优雅关闭最终上报；新增 `configured_mcps` 字段和 `jira_id` 可选参数
> - ✅ **Rule/MCP 策略**: 继续本地下发，仅统计已订阅/已配置列表
>
> **📌 v1.4更新**: 
>
> - ✅ 增强scope参数: 支持`general/team/user/all`四级订阅范围
> - ✅ keyword参数必填化: search_resources的keyword改为必填参数
> - ✅ 更详细的API映射关系请参考[API映射补充文档](./CSP-AI-Agent-API-Mapping.md)

> **📌 重要**: 本文档已在第五章增加了完整的订阅管理API和资源查询API,解决了MCP Tools的数据来源问题。更详细的API映射关系和实现示例请参考[API映射补充文档](https://dg01docs.zoom.us/doc/ta6fGKrsSH6SDJU7HjcTlQ)。

---

## **目录**

1. [系统概述](#一系统概述)
  - 1.1 [核心功能](#11-核心功能)
  - 1.2 [系统架构](#12-系统架构)
  - 1.3 [Resource ID命名规范](#13-resource-id-命名规范)
2. [技术选型](#二技术选型)
  - 2.1 [核心技术栈](#21-核心技术栈)
  - 2.2 [分发方式](#22-分发方式)
3. [核心架构](#三核心架构)
  - 3.1 [系统组件](#31-系统组件)
  - 3.2 [数据流向](#32-数据流向)
4. [MCP Tools API规范](#四mcp-tools-api规范)
  - 4.1 [sync_resources - 资源同步](#41-sync_resources---资源同步)
  - 4.2 [manage_subscription - 订阅管理](#42-manage_subscription---订阅管理)
  - 4.3 [search_resources - 资源搜索](#43-search_resources---资源搜索)
  - 4.4 [upload_resource - 资源上传](#44-upload_resource---资源上传)
  - 4.5 [track_usage - 遥测埋点](#45-track_usage---遥测埋点)
5. [REST API规范](#五rest-api规范)
  - 5.0 [API映射关系总览](#50-api映射关系总览) ⭐️
  - 5.1 [认证API](#51-认证api)
  - 5.2 [订阅资源清单API](#52-订阅资源清单api-合并listmanifest) 🆕
  - 5.3 [订阅管理API](#53-订阅管理api) 🆕
  - 5.4 [资源查询API](#54-资源查询api) 🆕
  - 5.5 [资源下载API](#55-资源下载api)
  - 5.6 [资源上传API](#56-资源上传api-两步)
  - 5.7 [API完整调用流程总结](#57-api完整调用流程总结) ⭐️
6. [核心流程详解](#六核心流程详解)
  - 6.1 [首次订阅并同步流程](#61-首次订阅并同步流程)
  - 6.2 [增量同步流程](#62-增量同步流程-带缓存)
  - 6.3 [上传资源流程](#63-上传资源流程-两步法)
  - 6.4 [同步失败重试流程](#64-同步失败重试流程)
7. [数据模型](#七数据模型)
  - 7.1 [本地状态文件](#71-本地状态文件)
  - 7.2 [服务端数据库](#72-服务端数据库)
8. [订阅与推送](#八订阅与推送)
  - 8.1 [资源同步机制](#资源同步机制)
  - 8.2 [资源分组](#资源分组)

---

## 一、系统概述

### 1.1 核心功能

CSP-AI-Agent 是一个**运行在 CSP Server 上的 MCP Server**，通过 SSE 连接为 Cursor IDE 提供 AI 工具的集中管理、自动分发和版本控制。

**核心能力**:

- ✅ 资源同步(commands/skills/rules) - 通过 Git 操作管理
- ✅ 订阅管理(subscribe/unsubscribe) - 调用 REST API
- ✅ 资源搜索(按团队/类型/关键词) - 调用 REST API
- ✅ 资源上传(Git 版本控制) - 调用 REST API 触发 Git 提交
- ✅ 状态追踪(同步状态+重试机制) - MCP Server 端管理
- ✅ 精准遥测(track_usage + resolve_prompt_content) - Command/Skill 调用次数按用户、资源、Jira Issue 聚合上报

**重要特性**:

- 🚀 MCP Server 部署在 CSP Server 上（服务器端部署）
- 🔗 通过 SSE 与用户 Cursor 建立长连接
- 🛠️ MCP Tools 在服务器端运行，调用 CSP REST API
- 📦 数据存储通过 Git 操作（拉取/推送），无本地数据库

### 1.2 系统架构

```plaintext
┌──────────────── 用户本机 (Cursor IDE) ─────────────────┐
│                                                          │
│  MCP Client (Cursor 内置)                               │
│    ↓                                                     │
│    ↓ SSE 长连接 (MCP 协议)                              │
│    ↓                                                     │
└──────────────────────────────────────────────────────────┘
           ↓
           ↓ SSE: 工具调用 + 状态返回
           ↓ REST: 资源文件下载/上传
           ↓
┌──────────────── CSP Server (服务器端) ─────────────────┐
│                                                          │
│  ┌────────────────────────────────────┐                 │
│  │  CSP-AI-Agent MCP Server           │                 │
│  │  (运行在 CSP Server 上)             │                 │
│  │                                    │                 │
│  │  ├─ MCP Tools (服务器端执行)       │                 │
│  │  │  ├─ sync_resources              │                 │
│  │  │  ├─ manage_subscription         │                 │
│  │  │  ├─ search_resources            │                 │
│  │  │  └─ upload_resource             │                 │
│  │  │                                 │                 │
│  │  └─ 调用 ↓ CSP REST API            │                 │
│  └────────────────────────────────────┘                 │
│             ↓                                            │
│  ┌────────────────────────────────────┐                 │
│  │  CSP REST API Service              │                 │
│  │  (内部 API，MCP Server 调用)        │                 │
│  │                                    │                 │
│  │  ├─ GET  /api/resources/subscriptions               │
│  │  ├─ POST /api/resources/subscriptions/add           │
│  │  ├─ GET  /api/resources/search                      │
│  │  ├─ GET  /api/resources/download/{id}               │
│  │  ├─ POST /api/resources/upload                      │
│  │  └─ POST /api/resources/finalize                    │
│  │                                                      │
│  │  └─ 数据存储 ↓ SQLite/PostgreSQL (REST API 管理)     │
│  └────────────────────────────────────┘                 │
│             ↓                                            │
│  ┌────────────────────────────────────┐                 │
│  │  Git Repository (本地工作目录)      │                 │
│  │  (MCP Server 通过 Git 命令操作)    │                 │
│  │                                    │                 │
│  │  ├─ git pull  (同步最新资源)        │                 │
│  │  ├─ git add   (暂存上传文件)        │                 │
│  │  ├─ git commit (提交变更)           │                 │
│  │  └─ git push  (推送到远程)          │                 │
│  │                                    │                 │
│  │  Remote: git@git.zoom.us:main/csp.git               │
│  └────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────┘
```

**架构关键点**:

1. **MCP Server 部署位置**:
  - ✅ 运行在 CSP Server 上（服务器端部署）
  - ❌ 不是运行在用户本地
2. **通信方式**:
  - **SSE 长连接**: Cursor IDE ↔ MCP Server (MCP 协议通信)
  - **REST API**: MCP Server → CSP REST API (内部调用)
  - **用户指令**: 通过 SSE 调用 MCP Tools，Tools 在服务器端执行
3. **数据存储**:
  - **MCP Server 端**: 通过 Git 命令操作本地仓库（git pull/push）
  - **CSP REST API 端**: 使用 SQLite/PostgreSQL 管理元数据（与 MCP Server 无关）
  - **无 MCP Server 本地数据库**: 所有资源通过 Git 管理，不涉及 SQLite
4. **Git 仓库说明**:
  - **项目代码仓库**: `https://github.com/ElliotLion-ing/CSP-AI-Agent`
    - 用途：MCP Server 项目源代码
  - **AI 资源仓库**: `git@git.zoom.us:main/csp.git`
    - 用途：AI 资源文件存储
    - MCP Server 通过 Git 命令操作（拉取/推送）
    - CSP REST API 负责触发 Git 提交

### 1.3 Resource ID 命名规范

所有 AI 资源使用统一的 ID 格式,确保资源的可识别性和可管理性。

#### 命名格式

`<功能分类>-<资源类型>-<数字ID>`

#### 字段说明


|           |              |          |                                                 |
| --------- | ------------ | -------- | ----------------------------------------------- |
| **字段**    | **说明**       | **长度限制** | **示例**                                          |
| **功能分类**  | 资源的功能领域或用途   | 2-20 字符  | `codereview`, `network`, `debug`, `git`, `jira` |
| **资源类型**  | 资源的技术类型(固定值) | 固定长度     | `mcp`, `command`, `skill`, `rule`               |
| **数字 ID** | 自增序列号,保证唯一性  | 3-6 位数字  | `001`, `0042`, `123456`                         |


#### 资源类型定义


|             |                           |                          |                          |
| ----------- | ------------------------- | ------------------------ | ------------------------ |
| **类型**      | **说明**                    | **存储位置**                 | **示例**                   |
| **mcp**     | MCP Server 工具(完整的 MCP 服务) | `~/.cursor/mcp-servers/` | `gitlab-mcp-001`         |
| **command** | Cursor 命令/规则(单个 AI 指令)    | `~/.cursor/rules/`       | `codereview-command-001` |
| **skill**   | Cursor 技能(可复用的 AI 能力)     | `~/.cursor/skills/`      | `debug-skill-001`        |
| **rule**    | Cursor 规则(项目级配置)          | `.cursor/rules/`         | `security-rule-001`      |


#### 功能分类建议

**代码质量类**

- `codereview`: 代码审查相关
- `refactor`: 重构相关
- `testing`: 测试相关
- `security`: 安全检查相关
- `performance`: 性能优化相关

**开发工具类**

- `git`: Git 操作相关
- `debug`: 调试相关
- `network`: 网络调试相关
- `database`: 数据库操作相关
- `docker`: Docker 相关

**集成工具类**

- `gitlab`: GitLab 集成
- `jira`: Jira 集成
- `confluence`: Confluence 集成
- `jenkins`: Jenkins 集成

**通用工具类**

- `analyze`: 分析类工具
- `format`: 格式化工具
- `convert`: 转换工具
- `generate`: 生成工具

#### 命名示例

```plaintext
✅ 正确示例:
  codereview-command-001    # 代码审查命令,第 1 个
  network-skill-042         # 网络调试技能,第 42 个
  gitlab-mcp-001            # GitLab MCP Server,第 1 个
  security-rule-123         # 安全规则,第 123 个
  debug-command-005         # 调试命令,第 5 个

❌ 错误示例:
  zNet-command-001          # ❌ 使用模块名(zNet)而非功能分类
  CodeReview-Command-1      # ❌ 大写字母和数字位数不足
  cr-c-1                    # ❌ 过度缩写,不易理解
  codereview_command_001    # ❌ 使用下划线而非连字符
  my-awesome-tool-abc       # ❌ 数字 ID 必须是纯数字
```

#### ID 生成规则

1. **功能分类**
  - 全小写字母
  - 使用连字符分隔多个单词
  - 优先使用英文完整单词,避免缩写
  - 新分类需在此文档中注册
2. **资源类型**
  - 固定值: `mcp`, `command`, `skill`, `rule`
  - 不可自定义
3. **数字 ID**
  - 纯数字,左侧补零
  - 从 001 开始
  - 每个"功能分类+资源类型"组合独立计数
  - 示例: `codereview-command-001`, `codereview-command-002`, `codereview-skill-001`

#### 资源归属与权限

- **功能分类**: 跨团队共享,按功能组织
- **团队标识**: 通过资源的 `metadata.owner_team` 字段标识归属
- **权限控制**: 基于团队的读写权限,非 ID 本身

**示例配置**

```json
{
  "id": "codereview-command-001",
  "name": "review-cpp-code",
  "type": "command",
  "metadata": {
    "owner_team": "CommonFrameWork",
    "category": "codereview",
    "tags": ["cpp", "review"]
  }
}
```

---

## 二、技术选型

### 2.1 核心技术栈


|             |                           |             |                |
| ----------- | ------------------------- | ----------- | -------------- |
| **组件**      | **技术选择**                  | **版本要求**    | **理由**         |
| **运行时**     | Node.js                   | >= 18.0     | 异步 IO 优秀、生态成熟  |
| **语言**      | TypeScript                | >= 5.3      | 类型安全、开发效率高     |
| **MCP SDK** | @modelcontextprotocol/sdk | ^1.0.0      | 官方 SDK         |
| **缓存**      | ioredis + node-cache      | ^5.3 / ^5.1 | Redis + 内存双层   |
| **数据库**     | pg                        | ^8.11       | PostgreSQL 客户端 |
| **Git 操作**  | simple-git                | ^3.22       | Git 封装         |
| **日志**      | pino                      | ^8.19       | 高性能结构化日志       |
| **测试**      | vitest                    | ^1.2        | 快速单元测试         |


### 2.2 分发方式

#### 推荐方式: NPM 包 + npx

**优势**: 零安装使用，版本管理简单

```bash
# 方式 1: 直接运行（零安装）
npx @zoom/csp-ai-agent-mcp start

# 方式 2: 全局安装
npm install -g @zoom/csp-ai-agent-mcp
csp-ai-agent-mcp start

# 方式 3: 本地安装（开发环境）
npm install @zoom/csp-ai-agent-mcp
npx csp-ai-agent-mcp start
```

**版本管理**:

```bash
# 指定版本运行
npx @zoom/csp-ai-agent-mcp@1.2.3 start

# 更新到最新版本
npm update -g @zoom/csp-ai-agent-mcp

# 查看可用版本
npm view @zoom/csp-ai-agent-mcp versions
```

#### 备选方式: Docker

**用于生产环境部署**

```bash
# 拉取镜像
docker pull ghcr.io/zoom/csp-ai-agent-mcp:latest

# 运行容器
docker run -d \
  --name csp-ai-agent \
  -p 5090:5090 \
  -e CSP_API_URL=https://csp.zoom.us \
  -e NODE_ENV=production \
  ghcr.io/zoom/csp-ai-agent-mcp:latest

# 使用 docker-compose
docker-compose up -d
```

---

## 三、核心架构

### 3.1 系统组件

```plaintext
CSP Server (服务器端)
├── MCP Server
│   ├── index.ts                    # 服务入口
│   ├── server.ts                   # SSE/stdio 连接处理
│   ├── tools/                      # MCP Tools (服务器端执行)
│   │   ├── sync-resources.ts       # 调用 REST API 获取资源
│   │   ├── manage-subscription.ts  # 调用 REST API 管理订阅
│   │   ├── search-resources.ts     # 调用 REST API 搜索
│   │   ├── upload-resource.ts      # 调用 REST API 上传
│   │   └── uninstall-resource.ts   # 卸载资源
│   ├── prompts/                    # MCP Prompt 模块 (v1.5 新增)
│   │   ├── manager.ts              # PromptManager: 注册/注销/刷新 Prompt
│   │   ├── generator.ts            # Markdown 展开 + 变量替换
│   │   ├── cache.ts                # .prompt-cache/ 文件读写
│   │   └── index.ts                # 模块导出
│   ├── telemetry/                  # 遥测埋点模块
│   │   ├── manager.ts              # TelemetryManager: 本地缓存 + 定时上报
│   │   └── index.ts                # 模块导出
│   ├── git/                        # Git 操作模块
│   │   ├── clone.ts                # git clone
│   │   ├── pull.ts                 # git pull
│   │   └── operations.ts           # git add/commit/push
│   ├── state/                      # 状态管理(内存)
│   │   ├── tracker.ts              # 同步状态追踪
│   │   └── retry-manager.ts        # 重试管理
│   └── api/
│       └── client.ts               # CSP REST API 客户端
│
├── CSP REST API (独立服务)
│   ├── resources/                  # 资源管理
│   ├── subscriptions/              # 订阅管理
│   └── db/                         # 数据库层 (SQLite/PostgreSQL)
│
└── Git Repository (本地工作目录)
    └── git@git.zoom.us:main/csp.git

### 3.2 数据流向

#### Command / Skill — MCP Prompt 模式 + Solid Tool Fallback (v1.7)

```plaintext
场景 A：已注册 Prompt 的原生 slash 调用
用户在 Cursor IDE 输入 /command/name 或 /skill/name (slash command)
  ↓  Cursor 先调用 prompts/list 获取可用 Prompt 列表（含 description）
  ↓  用户选中后，Cursor 调用 prompts/get 请求 (经过 SSE)
  ↓
MCP Server PromptManager.GetPromptHandler 处理
  ├─ 1. 先尝试读取 .prompt-cache/{type}-{resource_id}.md（cache hit）
  │     cache miss 时从内存 rawContent 重新生成并写入 cache
  ├─ 2. TelemetryManager.recordInvocation(resourceId, type, name, jiraId?)
  │     → 写入本地 ai-resource-telemetry.json（原子写）
  └─ 3. 返回 messages[{role:'user', content:{type:'text', text:content}}]
  ↓
Cursor IDE 将 Prompt 内容注入对话上下文 → AI 执行

场景 B：当前会话中刚新增订阅的 Command / Skill
AI 调用 search_resources
  ↓
AI 调用 manage_subscription(subscribe)
  ↓
AI 调用 sync_resources
  ↓
AI 调用 resolve_prompt_content(prompt_name/resource_id)
  ↓
MCP Server 复用相同的 Prompt 解析内核
  ├─ 1. 优先读取 .prompt-cache/{type}-{resource_id}.md
  ├─ 2. cache miss 时从 rawContent 重新生成并写回 cache
  ├─ 3. 服务端直接记录 telemetry invocation
  └─ 4. 返回结构化的 prompt 正文 content
  ↓
AI 执行返回的 content 作为真实 Prompt 正文
```

> **Prompt 名称格式说明 (v1.5)**：MCP Prompt 注册名为 `{type}/{resource-name}`（例：`skill/analyze-conf-status`、`command/generate-testcase`）。Cursor 在 slash 菜单中会自动加上 MCP Server 名前缀，显示为 `/user-csp-ai-agent/skill/analyze-conf-status`。注册时不含 team 段，以减少层级深度。

#### Rule / MCP — 本地下发模式 (保持不变)

```plaintext
用户调用 sync_resources / manage_subscription
  ↓
通过 SSE 连接传输到 MCP Server (CSP Server 上)
  ↓
MCP Tool 在服务器端执行
  ↓
调用 CSP REST API (同一台 CSP Server 上)
  ↓
分支处理：
├─ 查询操作 → REST API 查询数据库 → 返回结果
├─ 下载 Rule/MCP → REST API 从 Git 仓库读取文件 → 返回文件
└─ 上传操作 → REST API 执行 git add/commit/push → 返回结果
  ↓
通过 SSE 返回结果给 Cursor IDE
  ↓
Cursor IDE 将资源文件写入用户本地目录
  (~/.cursor/rules/, ~/.cursor/mcp-servers/ 等)
```

#### Prompt 中间文件生成流程

```plaintext
sync_resources / manage_subscription(subscribe) / upload_resource
  ↓  下载 Command/Skill 原件 (rawContent from API)
PromptGenerator.generatePromptContentFromString(rawContent, cacheDir)
  ├─ parseMarkdownWithImports()  ← 递归展开 import 指令
  └─ replaceMDVariables()        ← 替换 ${VAR} 变量
  ↓
promptCache.write(type, resourceId, expandedContent)
  → 写入 {CWD}/.prompt-cache/{type}-{id}.md (不进 Git)
  ↓
promptManager.registerPrompt(meta)
  → 更新内存注册表，Cursor slash 菜单立即可见
```

**关键说明**:

1. **MCP Tools 执行位置**: 在 CSP Server 上执行，不是在用户本地
2. **Command/Skill 不下发文件**: 内容以 MCP Prompt 形式注册在 MCP Server，调用经过服务端
3. **动态资源执行规则**: 同轮新订阅的 Command/Skill 不再假设客户端一定补发 `prompts/get`，统一推荐走 `resolve_prompt_content`
4. **API 调用**: MCP Server 调用同一台服务器上的 CSP REST API
5. **Git 操作**: MCP Server 通过 Git 命令管理本地仓库
6. **数据库**: CSP REST API 自己管理数据库，与 MCP Server 无关
6. **.prompt-cache/**: 存放中间文件，放在 MCP Server CWD，不进 Git 仓库

### 3.3 资源类型分发策略 (v1.5)

| 资源类型 | 下发策略 | 存储位置 | 埋点能力 |
|---------|---------|---------|---------|
| **Command** | MCP Prompt 注册（不下发文件） | `.prompt-cache/` (服务端临时) | ✅ 精准统计每次调用 + jira_id |
| **Skill** | MCP Prompt 注册（不下发文件） | `.prompt-cache/` (服务端临时) | ✅ 精准统计每次调用 + jira_id |
| **Rule** | 下发到 `~/.cursor/rules/` | 用户本地 | ⚠️ 仅统计已订阅列表 |
| **MCP** | 配置写入 `~/.cursor/mcp.json` | 用户本地 | ⚠️ 仅统计已配置列表（各 MCP 自行埋点） |

### 3.4 Telemetry 遥测设计

#### 本地文件存储

- **文件名**: `ai-resource-telemetry.json`
- **存储位置**: `{MCP Server 运行目录}/ai-resource-telemetry.json`
  - 运行目录 = MCP Server 进程的 `process.cwd()`，即 `SourceCode/` 目录（npm start 执行目录）
  - **不在** `~/.cursor/` 下，不污染用户侧 Cursor 配置目录
  - 与 `.prompt-cache/` 同级，均为服务端运行时产物
- **写入方式**: write-then-rename 原子写（防止进程中断导致文件损坏）

**文件结构**：

```json
{
  "client_version": "0.1.4",
  "last_reported_at": "2026-03-23T07:10:00Z",
  "pending_events": [
    {
      "resource_id": "cmd-client-sdk-ai-hub-generate-testcase",
      "resource_type": "command",
      "resource_name": "generate-testcase",
      "invocation_count": 3,
      "first_invoked_at": "2026-03-23T07:00:00Z",
      "last_invoked_at": "2026-03-23T07:09:30Z",
      "jira_id": "PROJ-12345"
    }
  ],
  "subscribed_rules": [
    { "resource_id": "rule-csp-openspec", "resource_name": "openspec-rule", "subscribed_at": "2026-03-01T00:00:00Z" }
  ],
  "configured_mcps": [
    { "resource_id": "mcp-client-sdk-jenkins", "resource_name": "jenkins", "configured_at": "2026-03-01T00:00:00Z" }
  ]
}
```

#### 上报时机（三个触发点）

| 触发时机 | 间隔/条件 | 实现 |
|---------|----------|------|
| **定时上报** | 每 10 秒 | `index.ts` startPeriodicFlush(10_000) |
| **重连立即上报** | SSE Client 重连（`server.oninitialized`） | `http.ts` flushOnReconnect() |
| **优雅关闭最终上报** | 收到 SIGTERM/SIGINT 后 stopPeriodicFlush + 最后一次 flush | `index.ts` shutdown() |

#### Token 获取优先级

```
1. SSE 连接的 Authorization header token（lastKnownToken）  ← SSE 模式首选
2. process.env.CSP_API_TOKEN                                ← stdio 模式 / 单测
3. 无 token → 本次 flush 静默跳过，不报错
```

#### 统计粒度

| 资源类型 | 统计内容 | 更新时机 |
|---------|---------|---------|
| Command / Skill | 精准调用次数（含 jira_id 分维度聚合） | GetPrompt handler 或 resolve_prompt_content 成功返回时触发 |
| Rule | 已订阅列表快照（无法统计调用） | sync_resources / manage_subscription 完成后 |
| MCP | 已配置列表快照（调用由各 MCP 自行埋点） | sync_resources / manage_subscription 完成后 |

---

## 四、MCP Tools API规范

### 4.1 sync_resources - 资源同步

**功能**: 同步订阅的资源到本地

#### 输入参数

```typescript
interface SyncResourcesInput {
  mode?: 'check' | 'incremental' | 'full';  // 默认: incremental
  scope?: 'global' | 'workspace' | 'all';   // 默认: global
  types?: string[];                          // 默认: [] (所有类型)
}
```

#### 返回格式

```typescript
interface SyncResourcesOutput {
  mode: string;
  health_score: number;                      // 0-100
  summary: {
    total: number;
    synced: number;
    cached: number;
    failed: number;
  };
  performance: {
    sync_duration_ms: number;
    bandwidth_saved: string;                 // "16 KB"
    cache_hit_rate: string;                  // "80%"
  };
  details: Array<{
    id: string;
    name: string;
    action: 'updated' | 'cached' | 'failed';
    version: string;
    path: string;
    sync_status: string;
    cache_hit: boolean;
  }>;
  recommendations: string[];
}
```

---

## 4.2 manage_subscription - 订阅管理

**功能**: 管理资源订阅

### 输入参数

```typescript
interface ManageSubscriptionInput {
  action: 'subscribe' | 'unsubscribe' | 'list' | 'batch_subscribe';
  resource_ids?: string[];                   // action=list时可为空
  auto_sync?: boolean;                       // 默认: true
  scope?: 'global' | 'workspace';            // 默认: global
  notify?: boolean;                          // 默认: true
}
```

### 返回格式

```typescript
interface ManageSubscriptionOutput {
  action: string;
  success: boolean;
  affected_count: number;
  subscriptions?: Array<{
    id: string;
    name: string;
    type: string;
    subscribed_at: string;
    auto_sync: boolean;
  }>;
  message: string;
}
```

---

## 4.3 search_resources - 资源搜索

**功能**: 搜索可用资源

### 输入参数

```typescript
interface SearchResourcesInput {
  team?: string;                             // 默认: "" (所有团队)
  type?: string;                             // 默认: "" (所有类型)
  keyword?: string;                          // 默认: ""
}
```

### 返回格式

```typescript
interface SearchResourcesOutput {
  total: number;
  results: Array<{
    id: string;
    name: string;
    type: 'command' | 'skill' | 'rule' | 'mcp';
    team: string;
    version: string;
    description: string;
    metadata: {
      module: string;
      tags: string[];
      author: string;
      updated_at: string;
      downloads: number;
    };
    download_url: string;
    is_subscribed: boolean;
    is_installed: boolean;
  }>;
}
```

---

## 4.4 upload_resource - 资源上传

**功能**: 上传新资源或更新已有资源

### 输入参数

```typescript
interface UploadResourceInput {
  resource_id: string;                       // 临时ID(新上传) or 永久ID(更新)
  type: 'command' | 'skill' | 'rule' | 'mcp';
  message: string;                           // Git commit消息 (5-200字符)
  team?: string;                             // 默认: "Client-Public"
}
```

### 返回格式

```typescript
interface UploadResourceOutput {
  success: boolean;
  resource_id: string;                       // 永久resource_id
  version: string;
  url: string;                               // Git仓库URL
  commit_hash: string;
  message: string;
}
```

### REST 上传接口说明

`POST /csp/api/resources/upload` 统一使用 `files[]` 数组上传，单文件只需数组中放一个元素，多文件通过 `path` 保留目录结构：

```typescript
interface UploadResourceBody {
  type: 'command' | 'skill' | 'rule' | 'mcp';
  name: string;      // 资源名称，不含扩展名
  files: Array<{
    path: string;    // 文件相对路径，保留目录结构，禁止 ../ 路径穿越
    content: string; // 文件文本内容
  }>;                // 至少包含一个元素
}
```

---

## 4.5 track_usage - 遥测埋点

**功能**: 记录 Command/Skill Prompt 调用事件到本地遥测文件，由 AI 在每次 slash command 执行前自动调用，无需用户手动触发。

### 输入参数

```typescript
interface TrackUsageInput {
  resource_id:   string;                 // 资源唯一 ID
  resource_type: 'command' | 'skill';   // 资源类型
  resource_name: string;                 // 资源名称
  user_token?:   string;                 // 由 MCP Server 从 SSE token 自动注入
  jira_id?:      string;                 // 可选，Jira Issue ID，用于用量关联
}
```

### 返回格式

```typescript
interface TrackUsageOutput {
  recorded: boolean;  // true 表示成功写入；false 表示因缺少必要字段而跳过
}
```

### 设计要点

- **自动触发**: `PromptGenerator` 在生成 Prompt 内容时，在头部注入 `track_usage` 调用指令；AI 执行时会自动先调用此工具，再执行实际任务
- **Tool fallback 直记埋点**: 对同轮动态订阅后通过 `resolve_prompt_content` 获取正文的场景，服务端会直接记录 usage，不再依赖 AI 额外调用 `track_usage`
- **await 写入**: `recordInvocation` 使用 `await` 确保文件写入完成后再返回，防止定时 flush 读到旧状态（race condition 修复）
- **差量 flush**: flush 成功后对 `pending_events` 进行差量扣减（`invocation_count -= reported`），而非整体清空，防止 flush 期间新写入的事件丢失
- **无外部依赖**: 不发起任何网络请求，只写本地文件，不阻塞主工具流程

---

## 4.6 AI Resource 随附配置文件规范

### 概述

部分类型的 AI Resource 在上传时，除资源本身的文件外，还需同步上传一个**配置描述文件**，以便 MCP Server 在将资源同步（`sync_resources`）到用户本地后，能够自动完成必要的环境配置。

目前需要随附配置文件的资源类型：

| 资源类型 | 是否需要配置文件 | 文件名 |
|---------|----------------|--------|
| `mcp`   | ✅ **必须**     | `mcp-config.json` |
| `skill` | ❌ 不需要       | — |
| `command` | ❌ 不需要     | — |
| `rule`  | ❌ 不需要       | — |

---

### 4.5.1 MCP Server — `mcp-config.json`

#### 作用

`sync_resources` 将 MCP Server 文件下载到 `~/.cursor/mcp-servers/<name>/` 之后，会读取该目录下的 `mcp-config.json`，自动将服务器注册到 `~/.cursor/mcp.json`，无需用户手动编辑。

#### 文件格式

```json
{
  "name": "jenkins",
  "command": "python3",
  "args": ["jenkins_mcp_server.py"],
  "env": {
    "JENKINS_URL": "",
    "JENKINS_USERNAME": "",
    "JENKINS_API_TOKEN": ""
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 否 | MCP server 的键名；省略时使用资源名 |
| `command` | string | ✅ | 启动命令，如 `python3`、`node`、`uvx` 等 |
| `args` | string[] | ✅ | 启动参数，**相对路径基于安装目录解析为绝对路径** |
| `env` | object | 否 | 需要用户填写的环境变量；空字符串表示用户必须配置 |

#### 注册逻辑

```
sync_resources 下载 MCP 文件
  ↓
读取 mcp-config.json（权威来源）
  ├─ 找到 → 用 command/args/env，相对 args 转绝对路径
  └─ 找不到 → 回退到启发式扫描（不可靠，产生 WARN 日志）
  ↓
原子写入 ~/.cursor/mcp.json（幂等，重复 sync 覆盖更新）
```

生成的 `mcp.json` 条目示例：

```json
{
  "mcpServers": {
    "jenkins": {
      "command": "python3",
      "args": ["/Users/<user>/.cursor/mcp-servers/jenkins/jenkins_mcp_server.py"],
      "env": {
        "JENKINS_URL": "",
        "JENKINS_USERNAME": "",
        "JENKINS_API_TOKEN": ""
      }
    }
  }
}
```

#### 上传要求

使用 `upload_resource` 上传 MCP Server 时，`files[]` 中必须包含 `mcp-config.json`：

```json
{
  "type": "mcp",
  "name": "jenkins",
  "files": [
    { "path": "mcp-config.json",          "content": "{...}" },
    { "path": "jenkins_mcp_server.py",    "content": "..." },
    { "path": "requirements.txt",         "content": "..." },
    { "path": "README_JENKINS_MCP.md",    "content": "..." }
  ]
}
```

---

# 五、REST API 规范

[CSP AI Agent API Mapping](https://dg01docs.zoom.us/doc/ta6fGKrsSH6SDJU7HjcTlQ)

## 5.0 API 映射关系总览

**每个 MCP Tool 与 CSP REST API 的完整映射**:


|                         |                                                                                                                                     |                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **MCP Tool**            | **依赖的 CSP REST API**                                                                                                                | **用途**                                                                   |
| **sync_resources**      | `GET /csp/api/resources/subscriptions``GET /csp/api/resources/download/{id}`                                                       | 1. 获取订阅资源清单【获取当前账号订阅的所有资源】 2. 下载资源文件【下载mcp zip文件，下载command文件，下载skills文件】 |
| **manage_subscription** | `GET /csp/api/resources/subscriptions``POST /csp/api/resources/subscriptions/add``DELETE /csp/api/resources/subscriptions/remove` | 1. 查看订阅【查看当前账号已经订阅】 2. 添加订阅【订阅其他的资源】 3. 取消订阅【从账号订阅列表中移除，并本地删除对应配置和文件】    |
| **search_resources**    | `GET /csp/api/resources/search`                                                                                                     | 1. 搜索资源(在所有可用资源中搜索)                                                      |
| **upload_resource**     | `POST /csp/api/resources/upload` `POST /csp/api/resources/finalize`                                                                 | 1. 上传文件内容(暂存) 2. 触发Git提交(完成上传)                                           |
| **track_usage**         | 无外部 REST 依赖                                                                                                                      | 记录 Command / Skill 调用埋点到本地遥测文件                                                  |
| **resolve_prompt_content** | 无外部 REST 依赖                                                                                                                   | 在动态订阅工作流中稳定返回 Command / Skill 的真实 Prompt 正文                                |


---

## 5.1 认证 API

### GET /csp/api/user/permissions

**功能**: 验证用户 token 并获取权限信息

**请求头**:

```plaintext
Authorization: Bearer {token}
```

**响应**:

```json
{
  "code": 2000,
  "data": {
    "user_id": "user123",
    "email": "user@example.com",
    "groups": ["zNet", "Client-Public"]
  }
}
```

**错误响应**:

```json
{
  "code": 4010,
  "message": "Invalid or expired token"
}
```

---

## 5.2 订阅资源清单 API (合并 list+manifest)

### GET /csp/api/resources/subscriptions

**功能**: 获取用户订阅的资源清单(合并了原 list+manifest 功能)

**使用场景**:

- `sync_resources`: 获取需要同步的资源列表
- `manage_subscription(action="list")`: 展示订阅列表
- `search_resources`: 标记资源的订阅状态

**请求头**:

```plaintext
Authorization: Bearer {token}
If-None-Match: "W/\"abc123\""              # ETag缓存验证
Accept-Encoding: gzip, br
```

**查询参数**:

订阅范围说明:

1. **general**: 整个团队必须订阅的基础资源(通用)
2. **team**: 用户所属团队统一订阅的资源(团队级)
3. **user**: 用户本身订阅的资源(自定义)
4. **all**: 包含general+team+user(默认)

```plaintext
?scope=all             # 可选: general / team / user / all (默认: all)
&detail=true           # 可选: 是否包含详细信息 (默认: false)
&types=command,skill   # 可选: 类型过滤(逗号分隔)
```

**响应 (200 OK)**:

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "version": "1.0.0",
    "timestamp": "2026-03-03T10:00:00Z",
    "total": 10,
    "subscriptions": [
      {
        "id": "zCodeReview-skill-001",
        "name": "debug-network",
        "type": "command",
        "team": "zNet",
        "subscribed_at": "2026-03-01T10:00:00Z",
        "auto_sync": true,
        "scope": "global",
        "notify": true,
        "resource": {
          "version": "1.0.1",
          "hash": "sha256:def456...",
          "size_bytes": 2048,
          "download_url": "https://csp.example.com/api/resources/download/zCodeReview-skill-001",
          "updated_at": "2026-03-03T09:50:00Z",
          "metadata": {
            "module": "zNet",
            "tags": ["debugging", "network"]
          }
        }
      }
    ]
  }
}
```

**响应 (304 Not Modified)**:

```plaintext
HTTP/1.1 304 Not Modified
ETag: "W/\"abc123\""
```

---

## 5.3 订阅管理 API

### POST /csp/api/resources/subscriptions/add

**功能**: 批量订阅资源,支持幂等操作(重复订阅不报错)

**请求头**:

```plaintext
Authorization: Bearer {token}
Content-Type: application/json
```

**请求体**:

```json
{
  "resource_ids": ["zCodeReview-skill-001", "Client-Public-skill-002"],
  "scope": "all"
}
```

**参数说明**:

- `resource_ids`: 要订阅的资源ID列表(必填)
- `scope`: 订阅范围 - `general` / `user` / `all` (可选,默认: all)

**响应**:

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "added_count": 2,
    "subscriptions": [
      {
        "id": "zCodeReview-skill-001",
        "name": "debug-network",
        "subscribed_at": "2026-03-03T10:00:00Z"
      },
      {
        "id": "Client-Public-skill-002",
        "name": "code-review",
        "subscribed_at": "2026-03-03T10:00:00Z"
      }
    ]
  }
}
```

**错误响应 - 资源不存在**:

```json
{
  "code": 4008,
  "result": "failed",
  "message": "Resources not found",
  "data": {
    "invalid_ids": ["invalid-resource-id"],
    "added_ids": ["zCodeReview-skill-001"]
  }
}
```

**错误响应 - 权限不足**:

```json
{
  "code": 4007,
  "result": "failed",
  "message": "Permission denied",
  "data": {
    "forbidden_ids": ["restricted-resource-id"]
  }
}
```

---

### DELETE /csp/api/resources/subscriptions/remove

**功能**: 批量取消资源订阅,幂等操作(不存在的订阅不报错)

**请求头**:

```plaintext
Authorization: Bearer {token}
Content-Type: application/json
```

**请求体**:

```json
{
  "resource_ids": ["zCodeReview-skill-001"]
}
```

**响应**:

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "removed_count": 1,
    "message": "Subscriptions removed successfully"
  }
}
```

---

## 5.4 资源查询 API

### GET /csp/api/resources/search

**功能**: 搜索平台上可用的资源,支持按团队、类型、关键词过滤,分页返回

**请求头**:

```plaintext
Authorization: Bearer {token}
```

**查询参数**:


| 参数        | 类型      | 必填  | 默认值   | 说明               |
| --------- | ------- | --- | ----- | ---------------- |
| keyword   | String  | 是   | —     | 关键词搜索(名称/描述/标签)  |
| detail    | Boolean | 否   | false | 是否包含资源详细元数据      |
| type      | String  | 否   | all   | commands, skills |
| page      | Integer | 否   | 1     | 页码               |
| page_size | Integer | 否   | 20    | 每页数量(最大100)      |


**请求示例**:

```plaintext
GET /csp/api/resources/search?keyword=debug&type=skills&detail=false&page=1&page_size=20
Authorization: Bearer {token}
```

**响应**:

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "total": 25,
    "page": 1,
    "page_size": 20,
    "results": [
      {
        "id": "zCodeReview-skill-001",
        "name": "debug-network",
        "type": "command",
        "team": "zNet",
        "version": "1.0.1",
        "description": "Network debugging tool for SDK developers",
        "metadata": {
          "module": "zNet",
          "tags": ["debugging", "network", "sdk"],
          "author": "user@example.com",
          "created_at": "2026-03-01T10:00:00Z",
          "updated_at": "2026-03-03T09:50:00Z",
          "downloads": 125
        },
        "download_url": "https://csp.example.com/api/resources/download/zCodeReview-skill-001"
      }
    ]
  }
}
```

**使用场景**:

- `search_resources`: 搜索和发现资源
- `upload_resource`: 检查资源名称冲突

---

### GET /csp/api/resources/{id}

**功能**: 获取单个资源的完整信息,用于订阅前验证资源存在性

**Path参数**:

- `id`: 资源ID,如 `zCodeReview-skill-001`

**请求头**:

```plaintext
Authorization: Bearer {token}
```

**请求示例**:

```plaintext
GET /csp/api/resources/zCodeReview-skill-001
Authorization: Bearer {token}
```

**响应 - 成功 (200)**:

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "id": "zCodeReview-skill-001",
    "name": "debug-network",
    "type": "command",
    "team": "zNet",
    "version": "1.0.1",
    "description": "Network debugging tool",
    "hash": "sha256:def456...",
    "size_bytes": 2048,
    "download_url": "https://csp.example.com/api/resources/download/zCodeReview-skill-001",
    "created_at": "2026-03-01T10:00:00Z",
    "updated_at": "2026-03-03T09:50:00Z",
    "created_by": "user@example.com",
    "metadata": {
      "module": "zNet",
      "tags": ["debugging", "network"],
      "author": "user@example.com",
      "downloads": 125
    }
  }
}
```

**响应 - 未找到 (404)**:

```json
{
  "code": 4008,
  "result": "failed",
  "message": "not found"
}
```

**响应 - 无权限 (403)**:

```json
{
  "code": 4007,
  "result": "failed",
  "message": "permission denied"
}
```

---

## 5.5 资源下载 API

### GET /csp/api/resources/download/{id}

**功能**: 下载指定资源的所有文件内容，以 JSON `files[]` 数组返回。  
支持单文件资源（command、rule）和多文件资源（skill、mcp），格式统一。

**Path参数**:

- `id`: 资源ID

**请求头**:

```plaintext
Authorization: Bearer {token}
If-None-Match: "sha256:def456..."    # ETag 缓存校验（可选）
```

**请求示例**:

```plaintext
GET /csp/api/resources/download/skill-csp-code-review
Authorization: Bearer {token}
If-None-Match: "sha256:def456..."
```

**响应 - 成功 (200)**:

```json
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "sha256:xyz789..."

{
  "code": 2000,
  "result": "success",
  "data": {
    "resource_id": "skill-csp-code-review",
    "name": "code-review",
    "type": "skill",
    "version": "1.0.0",
    "hash": "sha256:xyz789...",
    "files": [
      { "path": "SKILL.md",           "content": "# Code Review Skill\n..." },
      { "path": "examples/demo.md",   "content": "# Demo\n..." }
    ]
  }
}
```

**说明**:

- `files[].path` 是文件在资源目录内的相对路径（不含资源名前缀）
- 单文件资源（command / rule）的 `files` 数组中只有一个元素
- 客户端按 `files[].path` 在 Cursor 目录内重建目录结构：
  - skill  → `~/.cursor/skills/<name>/`
  - mcp    → `~/.cursor/mcp-servers/<name>/`
  - command → `~/.cursor/commands/<name>.md`
  - rule   → `~/.cursor/rules/<name>.mdc`

**响应 - 未修改 (304)**:

```plaintext
HTTP/1.1 304 Not Modified
ETag: "sha256:def456..."
```

资源未变更,客户端使用本地缓存。

**响应 - 未找到 (404)**:

```json
{
  "code": 4008,
  "result": "failed",
  "message": "not found"
}
```

---

## 5.6 资源上传 API (两步)

### Step 1: POST /csp/api/resources/upload

**功能**: 上传资源文件内容到服务端暂存,返回upload_id。需后续调用finalize接口完成Git提交。支持单文件和多文件两种模式，两种模式互斥。

**请求头**:

```plaintext
Authorization: Bearer {token}
Content-Type: application/json
```

**请求体**:


| 参数              | 类型     | 必填  | 说明                                         |
| --------------- | ------ | --- | ------------------------------------------ |
| type            | String | 是   | 资源类型: `command` / `skill` / `rule` / `mcp` |
| name            | String | 是   | 资源名称(不含扩展名)                                |
| files           | Array  | 是   | 文件列表，至少包含一个元素                              |
| files[].path    | String | 是   | 文件相对路径，保留目录结构，禁止 `../` 路径穿越                |
| files[].content | String | 是   | 文件文本内容                                     |


**请求示例 — 单文件(command)**:

```json
POST /csp/api/resources/upload
Authorization: Bearer {token}
Content-Type: application/json

{
  "type": "command",
  "name": "debug-network",
  "files": [
    { "path": "debug-network.md", "content": "# Debug Network Tool\n\nA tool for debugging network issues..." }
  ]
}
```

**请求示例 — 多文件(mcp 场景)**:

```json
POST /csp/api/resources/upload
Authorization: Bearer {token}
Content-Type: application/json

{
  "type": "mcp",
  "name": "my-database-mcp",
  "files": [
    { "path": "README.md", "content": "# My Database MCP\n..." },
    { "path": "server.js", "content": "const { Server } = require(...);\n..." },
    { "path": "tools/query.js", "content": "module.exports = async function query(params) { ... }" },
    { "path": "package.json", "content": "{\"name\": \"my-database-mcp\", \"version\": \"1.0.0\"}" }
  ]
}
```

**响应 — 成功**:

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "upload_id": "temp-abc123",
    "status": "pending",
    "expires_at": "2026-03-03T11:00:00Z",
    "preview_url": "https://csp.example.com/preview/temp-abc123"
  }
}
```

**响应 — 错误**:


| 错误码  | 说明                                 |
| ---- | ---------------------------------- |
| 4011 | `files` 数组为空                       |
| 4012 | `files[].path` 包含路径穿越（`../` 或绝对路径） |


**服务端处理逻辑**:

1. 验证Token → 获取用户信息
2. 校验 `files` 不为空
3. 校验每个 `files[].path` 无路径穿越
4. 校验总内容大小 < 10MB
5. 按 `path` 还原目录结构暂存
6. 检查名称冲突
7. 暂存到临时目录
8. 生成upload_id,记录过期时间

---

### Step 2: POST /csp/api/resources/finalize

**功能**: 确认暂存的上传内容,执行Git提交并生成永久资源记录

**请求头**:

```plaintext
Authorization: Bearer {token}
Content-Type: application/json
```

**请求体**:


| 参数             | 类型     | 必填  | 说明                 |
| -------------- | ------ | --- | ------------------ |
| upload_id      | String | 是   | upload接口返回的暂存ID    |
| commit_message | String | 是   | Git commit message |


**请求示例**:

```json
POST /csp/api/resources/finalize
Authorization: Bearer {token}
Content-Type: application/json

{
  "upload_id": "temp-abc123",
  "commit_message": "Add network debugging command"
}
```

**响应**:

```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "resource_id": "Client-Public-cmd-001",
    "version": "1.0.0",
    "url": "https://git.zoom.us/main/csp/-/blob/main/...",
    "commit_hash": "abc123",
    "download_url": "https://csp.example.com/api/resources/download/Client-Public-cmd-001"
  }
}
```

**错误响应 - Upload未找到/已过期**:

```json
{
  "code": 4009,
  "result": "failed",
  "message": "Upload not found or expired"
}
```

**服务端处理逻辑**:

1. 验证upload_id存在且未过期
2. 生成永久resource_id: `{team}-{type_abbr}-{seq}`
3. 移动文件到Git仓库目录 ([git@git.zoom.us](mailto:git@git.zoom.us):main/csp.git)
4. Git操作: `git add` → `git commit` → `git tag {resource_id}-v{version}`
5. 更新数据库(资源表)
6. 清理临时文件

**注意**: Git 操作针对的是 AI 资源存储仓库 ([git@git.zoom.us](mailto:git@git.zoom.us):main/csp.git)，不是项目代码仓库。

---

## 5.7 API 完整调用流程总结

**每个 MCP Tool 的完整 API 调用链**:


|                                       |                                                                            |                    |
| ------------------------------------- | -------------------------------------------------------------------------- | ------------------ |
| **MCP Tool**                          | **API 调用顺序**                                                               | **说明**             |
| **sync_resources**                    | 1. `GET /subscriptions/resources` 2. `GET /resources/download/{id}`        | 获取订阅清单 → 下载文件      |
| **manage_subscription**(subscribe)   | 1. `GET /resources/{id}` 2. `POST /subscriptions/add` 3. 触发 sync_resources | 验证资源 → 添加订阅 → 自动同步 |
| **manage_subscription**(unsubscribe) | 1. `DELETE /subscriptions/remove`                                          | 取消订阅               |
| **manage_subscription**(list)        | 1. `GET /subscriptions/resources`                                          | 查看订阅               |
| **search_resources**                  | 1. `GET /resources/search` 2. `GET /subscriptions/resources`               | 搜索资源 → 标记订阅状态      |
| **upload_resource**                   | 1. `POST /resources/upload` 2. `POST /resources/finalize`                  | 上传内容 → Git 提交      |


## 六、核心流程详解

### 6.1 首次订阅并同步流程

#### 步骤1: 用户搜索资源

```plaintext
Agent: "搜索 zNet 团队的命令工具"
  ↓
MCP Tool: search_resources({ 
  team: "zNet", 
  type: "command" 
})
  ↓
API 调用: GET /csp/api/resources/search?team=zNet&type=command
  ↓
响应: { 
  total: 5, 
  results: [...] 
}
  ↓
展示结果: "找到 5 个资源"
```

---

#### 步骤2: 用户选择订阅

```plaintext
Agent: "订阅 codereview-command-001"
  ↓
MCP Tool: manage_subscription({ 
  action: "subscribe", 
  resource_ids: ["codereview-command-001"], 
  auto_sync: true 
})
  ↓
API 调用: POST /csp/api/resources/subscriptions/add
  ↓
更新本地: ~/.cursor/.csp-subscriptions.json
  ↓
触发: sync_resources (因为 auto_sync=true)
```

---

#### 步骤3: 自动同步资源

**3.1 读取本地状态**

```plaintext
MCP Tool: sync_resources({ mode: "incremental" })
  ↓
读取: ~/.cursor/.csp-sync-state.json
  ↓
检查: codereview-command-001 本地不存在
```

**3.2 获取订阅资源清单**

```plaintext
API 调用: GET /csp/api/resources/subscriptions  
Headers: 
  Authorization: Bearer token
  ↓
响应: {
  subscriptions: [{
    id: "codereview-command-001",
    resource: {
      version: "1.0.1",
      hash: "sha256:def456...",
      download_url: "https://..."
    }
  }]
}
```

**3.3 下载资源文件**

```plaintext
API 调用: GET /csp/api/resources/download/codereview-command-001
Headers:
  If-None-Match: "{本地hash}"
  ↓
接收: JSON { data: { files: [{path, content}, ...] } }
  ↓
For each file in files[]:
  验证 path 不含 ../（防路径穿越）
  ↓
  写入 ~/.cursor/<type>/<name>/<file.path>
  （目录型资源: skill/mcp 写入子目录；文件型资源: command/rule 直接写文件）
  ↓
更新本地缓存状态
```

**3.4 更新状态并缓存**

```json
更新状态文件: sync-state.json
{
  "resources": {
    "codereview-command-001": {
      "sync_status": "synced",
      "version": "1.0.1",
      "hash": "sha256:def456...",
      "last_synced_at": "2026-03-03T10:00:00Z",
      "cache_hit": false
    }
  }
}
```

```plaintext
回填缓存: L1 内存 + L2 磁盘
  ↓
返回结果: {
  "summary": { "total": 1, "synced": 1 },
  "details": [{ "id": "codereview-command-001", "action": "updated" }]
}
```

### **6.2 增量同步流程 (带缓存)**

#### **步骤1: 触发同步**

```plaintext
Agent: "同步所有资源"
  ↓
MCP Tool: sync_resources({ mode: "incremental" })
  ↓
读取本地状态: sync-state.json
已有资源:
  - codereview-command-001: v1.0.1, hash:sha256:def456
  - Client-Public-cmd-002: v1.2.3, hash:sha256:abc789

```

#### **步骤2: 获取订阅资源清单 (带缓存验证)**

```plaintext
API调用: GET /csp/api/resources/subscriptions
Headers:
  If-None-Match: "W/\"etag-previous\""
  Authorization: Bearer token
  ↓
响应: 304 Not Modified
  ↓
使用本地缓存的清单

```

#### **步骤3: 对比版本和hash**

```plaintext
对比每个订阅的资源:

codereview-command-001:
  本地: v1.0.1, hash:sha256:def456
  服务端: v1.0.1, hash:sha256:def456
  → 完全一致,标记为"跳过"(使用缓存)

Client-Public-cmd-002:
  本地: v1.2.3, hash:sha256:abc789
  服务端: v1.2.4, hash:sha256:xyz999
  → 有更新,标记为"需更新"

```

#### **步骤4: 下载有更新的资源**

```plaintext
API调用: GET /csp/api/resources/download/Client-Public-cmd-002
Headers:
  If-None-Match: "sha256:abc789"
  ↓
响应: 200 OK — JSON { data: { files: [{path, content}] } }
  ↓
For each file in files[]:
  校验 path 不含 ../ (防路径穿越)
  ↓
  写入 ~/.cursor/<type>/<name>/<file.path>
  (command → ~/.cursor/commands/analyze-logs.md)

```

#### **步骤5: 更新状态文件**

```json
更新: sync-state.json
{
  "resources": {
    "codereview-command-001": {
      "sync_status": "synced",
      "last_verified_at": "2026-03-03T10:05:00Z",
      "cache_hit": true
    },
    "Client-Public-cmd-002": {
      "version": "1.2.4",
      "hash": "sha256:xyz999",
      "sync_status": "synced",
      "last_synced_at": "2026-03-03T10:05:02Z",
      "cache_hit": false
    }
  },
  "statistics": {
    "bandwidth_saved_bytes": 2048,
    "cache_hit_rate": 0.5
  }
}

```

#### **步骤6: 返回结果**

```json
{
  "summary": {
    "total": 2,
    "synced": 1,
    "cached": 1
  },
  "details": [
    { "id": "codereview-command-001", "action": "cached", "cache_hit": true },
    { 
      "id": "Client-Public-cmd-002", 
      "action": "updated", 
      "version": "1.2.3 → 1.2.4", 
      "cache_hit": false 
    }
  ],
  "performance": {
    "bandwidth_saved": "2 KB",
    "cache_hit_rate": "50%"
  }
}

```

---

### **6.3 上传资源流程 (两步法)**

#### **步骤1: 用户准备上传**

```plaintext
Agent: "上传文件debug-network.md作为命令"
  ↓
Cursor读取本地文件: ~/Desktop/debug-network.md
内容: "# Debug Network Tool\n..."

```

#### **步骤2: REST上传文件内容**

统一使用 `files[]` 数组，单文件只需数组中放一个元素。

**单文件示例（command）**:

```plaintext
API调用: POST /csp/api/resources/upload
Headers: Authorization: Bearer token
Body: {
  "type": "command",
  "name": "debug-network",
  "files": [
    { "path": "debug-network.md", "content": "# Debug Network Tool\n..." }
  ]
}
```

**多文件示例（mcp / skill）**:

```plaintext
API调用: POST /csp/api/resources/upload
Headers: Authorization: Bearer token
Body: {
  "type": "mcp",
  "name": "my-database-mcp",
  "files": [
    { "path": "server.js", "content": "const { Server } = require(...);\n..." },
    { "path": "tools/query.js", "content": "module.exports = async function query(params) { ... }" },
    { "path": "package.json", "content": "{\"name\": \"my-database-mcp\"}" }
  ]
}
```

```plaintext
  ↓
服务器处理:
  1. 验证token → 获取用户信息
  2. 校验 files 不为空
  3. 校验路径穿越、总大小 < 10MB
  4. 按 path 还原目录结构暂存
  5. 检查名称冲突
  6. 暂存到临时目录: /tmp/uploads/temp-abc123/
  7. 生成临时upload_id
  ↓
响应: {
  "upload_id": "temp-abc123",
  "status": "pending",
  "expires_at": "2026-03-03T11:00:00Z",
  "preview_url": "https://csp.example.com/preview/temp-abc123"
}

```

#### **步骤3: MCP Tool触发Git提交**

```plaintext
MCP Tool: upload_resource({
  resource_id: "temp-abc123",
  type: "command",
  message: "Add network debugging command",
  team: "Client-Public"
})
  ↓
API调用: POST /csp/api/resources/finalize
Body: {
  "upload_id": "temp-abc123",
  "commit_message": "Add network debugging command",
  "team": "Client-Public"
}
  ↓
服务器处理:
  1. 验证upload_id存在且未过期
  2. 生成永久resource_id: Client-Public-cmd-001
  3. 移动文件: /tmp → /git-repos/commands/debug-network.md
  4. Git操作 (在 git@git.zoom.us:main/csp.git 仓库中):
     git add commands/debug-network.md
     git commit -m "Add network debugging command"
     git tag Client-Public-cmd-001-v1.0.0
  5. 更新数据库
  6. 清理临时文件
  ↓
响应: {
  "resource_id": "Client-Public-cmd-001",
  "version": "1.0.0",
  "url": "https://git.zoom.us/main/csp/-/blob/main/...",
  "commit_hash": "abc123",
  "download_url": "https://csp.example.com/api/resources/download/Client-Public-cmd-001"
}

```

---

### **6.4 同步失败重试流程**

#### **步骤1: 同步过程中遇到错误**

```plaintext
sync_resources执行中...
  ↓
下载资源: codereview-command-001
API调用: GET /csp/api/resources/download/codereview-command-001
  ↓
错误: Network timeout after 30s

```

#### **步骤2: 记录失败状态**

```json
更新状态文件:
{
  "id": "codereview-command-001",
  "sync_status": "failed",
  "retry_count": 0,
  "next_retry_at": "2026-03-03T10:00:01Z",
  "error_message": "Network timeout after 30s",
  "error_code": "NETWORK_TIMEOUT"
}

```

#### **步骤3: 返回部分失败结果**

```json
{
  "summary": { "synced": 4, "failed": 1 },
  "details": [{
    "id": "codereview-command-001",
    "action": "failed",
    "error": "Network timeout, will retry in 1s"
  }]
}

```

#### **步骤4: 后台重试机制**

```plaintext
900ms后, RetryManager定时检查:
checkPendingRetries()
  ↓
发现codereview-command-001需要重试
  ↓
重新执行下载: GET /csp/api/resources/download/codereview-command-001
  ↓
【成功】→ 更新状态为"synced"
【失败】→ 增加retry_count, 计算下次重试时间

```

**重试策略 (指数退避)**

```plaintext
retry_count = 1 → 延迟 1s
retry_count = 2 → 延迟 4s
retry_count = 3 → 延迟 9s (达到max_retry,标记为永久失败)

```

```json
永久失败状态:
{
  "sync_status": "failed",
  "retry_count": 3,
  "next_retry_at": null,
  "error_message": "Max retry attempts (3) exceeded"
}

```

---

## **七、数据模型**

### **7.1 用户本地状态文件**

#### `**~/.cursor/.csp-sync-state.json`**

用户本地保存的同步状态文件，由 Cursor IDE 管理。

**数据来源**:

1. 用户调用 `sync_resources` Tool
2. MCP Server (CSP Server 上) 调用 REST API 获取订阅资源信息
3. MCP Server 通过 SSE 返回 JSON 数据
4. Cursor IDE 将数据保存到本地文件

**用途**:

- ✅ 记录用户已订阅的资源列表
- ✅ 记录每个资源的版本、hash 等信息
- ✅ 增量同步时的版本对比基准
- ✅ 判断资源是否需要更新

**文件结构**:

```json
{
  "version": "1.0.0",
  "last_sync_at": "2026-03-09T10:00:00Z",
  "resources": {
    "codereview-command-001": {
      "id": "codereview-command-001",
      "name": "debug-network",
      "type": "command",
      "version": "1.0.1",
      "hash": "sha256:def456...",
      "size_bytes": 2048,
      "local_path": "~/.cursor/rules/debug-network.md",
      "synced_at": "2026-03-09T10:00:05Z",
      "team": "zNet"
    },
    "Client-Public-skill-002": {
      "id": "Client-Public-skill-002",
      "name": "code-review",
      "type": "skill",
      "version": "2.1.0",
      "hash": "sha256:abc789...",
      "size_bytes": 4096,
      "local_path": "~/.cursor/skills/code-review/SKILL.md",
      "synced_at": "2026-03-09T09:55:00Z",
      "team": "Client-Public"
    }
  },
  "statistics": {
    "total_resources": 10,
    "total_size_bytes": 51200,
    "last_full_sync_at": "2026-03-08T08:00:00Z"
  }
}
```

**增量同步对比流程**:

```plaintext
1. Cursor IDE 读取本地 .csp-sync-state.json
   本地版本: codereview-command-001 v1.0.1

2. 调用 sync_resources (mode: incremental)

3. MCP Server 调用 GET /api/resources/subscriptions
   服务端版本: codereview-command-001 v1.0.2

4. MCP Server 对比版本:
   - 1.0.1 vs 1.0.2 → 需要更新
   - 调用 GET /api/resources/download/codereview-command-001

5. 下载新版本文件

6. 返回更新后的状态 JSON

7. Cursor IDE 更新本地 .csp-sync-state.json
   版本更新: v1.0.1 → v1.0.2
```

### **7.2 MCP Server 端状态管理**

MCP Server 在服务器端通过**内存**管理运行时状态，不持久化到磁盘。

**内存状态结构**:

```typescript
interface RuntimeState {
  // 活跃的同步任务
  activeSyncs: Map<userId, SyncTask>;
  
  // 重试队列
  retryQueue: Array<RetryTask>;
  
  // 统计信息
  statistics: {
    total_sync_requests: number;
    total_downloads: number;
    total_uploads: number;
  };
}
```

**状态管理说明**:

- ✅ 运行时状态存储在内存中
- ✅ 进程重启后状态丢失（无影响，可通过用户本地状态重建）
- ✅ 不写入服务器端磁盘文件
- ❌ 不使用 SQLite、PostgreSQL 等数据库（这些由 CSP REST API 管理）

### **7.3 用户本地文件系统**

Cursor IDE 将下载的资源保存到用户本地目录：

```plaintext
用户本地 (Cursor IDE 管理)
~/.cursor/
├── .csp-sync-state.json       # ⭐ 同步状态文件 (MCP Server 返回的数据)
├── rules/                      # Commands 存储位置
│   ├── debug-network.md
│   └── code-review.md
├── skills/                     # Skills 存储位置
│   ├── analyze-logs/
│   │   └── SKILL.md
│   └── refactor-code/
│       └── SKILL.md
└── mcp-servers/               # MCP 配置存储位置
    └── gitlab-mcp/
        └── config.json
```

**文件管理职责**:

- `**.csp-sync-state.json`**: Cursor IDE 读写，MCP Server 提供数据
- `**rules/skills/mcp-servers/**`: Cursor IDE 根据同步结果写入资源文件

### **7.4 CSP Server 端数据存储**

CSP REST API 服务自己管理数据库（与 MCP Server 无关）：

```plaintext
CSP Server
├── MCP Server (无数据库)
│   └── 状态管理: 内存
│
├── CSP REST API
│   └── 数据库: SQLite/PostgreSQL
│       ├── users 表
│       ├── resources 表
│       ├── subscriptions 表
│       └── metadata 表
│
└── Git Repository (本地工作目录)
    └── ai-resources/
        ├── commands/
        ├── skills/
        ├── rules/
        └── mcp/
```

**数据职责划分**:

- **MCP Server**: 不管理数据库，只通过 Git 操作文件
- **CSP REST API**: 管理元数据数据库（用户、订阅、资源信息等）
- **Git Repository**: 存储实际的资源文件内容

---

## 八、订阅与推送

### 资源同步机制

系统通过 CSP 服务器和 MCP server 的协同工作，实现资源的实时同步：

#### CSP 服务器端

1. 定时通过 Git 拉取最新版本
2. 接收到来自 MCP server 的 REST API 请求【GET /csp/api/resources/subscriptions】后，主动拉取最新版本

#### MCP Server 端

1. 接收到 sync_resources 调用后，自动推送最新版本到 CSP 服务器
2. 每次建立连接时，自动调用 sync_resources 推送最新版本到 CSP 服务器

#### 资源分组

包含三种类别

1. 整个team必须订阅的基础资源【type=general】
2. 用户所属team统一订阅的资源【type=team】
3. 用户本身锁订阅的资源【type=user】

---

## 九、认证与权限架构

### 9.1 Token 认证模型

系统采用 **CSP API Token 验证**模式，MCP Server 不签发 JWT，只负责验证和传递。

```
客户端 (Cursor)
  ↓  Authorization: Bearer <CSP_API_TOKEN>
MCP Server
  ↓  GET /csp/api/user/permissions
CSP API Server
  ↓  { user_id, email, groups: ["zNet", "Client-Public"] }
MCP Server
  ↓  基于 groups 做权限检查
执行 Tool 操作（所有 CSP API 调用均携带同一 token）
```

**核心原则**：
- `CSP_API_TOKEN` 是由 CSP 系统签发的 JWT，MCP Server 不生成也不刷新
- 验证方式：调用 `GET /csp/api/user/permissions`，Bearer token 透传
- 权限基于 `groups`（如 "zNet", "Client-Public"），不使用 roles
- 验证结果缓存 5 分钟（L1 内存），可选 Redis L2 缓存

### 9.2 权限规则

在 `SourceCode/src/auth/permissions.ts` 中定义每个工具的 `allowedGroups`：

| 工具 | allowedGroups | 说明 |
|------|--------------|------|
| `sync_resources` | `['*']` | 所有认证用户 |
| `search_resources` | `['*']` | 所有认证用户 |
| `manage_subscription` | `['*']` | 所有认证用户 |
| `upload_resource` | `['*']` | 所有认证用户 |
| `uninstall_resource` | `['*']` | 所有认证用户 |

- `'*'` 表示所有通过 token 验证的用户均可访问
- `admin` 组用户绕过所有权限检查
- 特定工具可配置为仅允许特定 groups（如 `['zNet', 'admin']`）

### 9.3 MCP Server 的认证职责边界

**负责**：
- 从 SSE 请求头提取 `Authorization: Bearer <token>`
- 调用 `GET /csp/api/user/permissions` 验证 token 有效性
- 缓存验证结果（减少 CSP API 调用）
- 基于 groups 执行工具级权限检查
- 所有下游 CSP API 调用均透传同一 token

**不负责**：
- ❌ 签发 JWT token（由 CSP 系统管理）
- ❌ 本地验证 JWT 签名（通过 API 调用完成）
- ❌ 管理 JWT secret（不需要 `JWT_SECRET`）
- ❌ Token 刷新（由 CSP 系统管理）
