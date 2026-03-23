# MCP Prompt-as-Slash-Command 设计文档

> 版本：1.0.0 | 日期：2026-03-20 | 项目：async-pilot

---

## 目录

1. [背景与问题](#1-背景与问题)
2. [核心设计思路](#2-核心设计思路)
3. [整体架构](#3-整体架构)
4. [数据流详解](#4-数据流详解)
5. [目录结构规范](#5-目录结构规范)
6. [关键模块说明](#6-关键模块说明)
7. [新增 Command 完整步骤](#7-新增-command-完整步骤)
8. [变量系统](#8-变量系统)
9. [import 组合机制](#9-import-组合机制)
10. [使用追踪设计](#10-使用追踪设计)
11. [分发与更新机制](#11-分发与更新机制)
12. [设计权衡与决策](#12-设计权衡与决策)

---

## 1. 背景与问题

### 问题描述

在 AI 编程助手（如 Cursor）的日常使用中，团队需要将一套**经过验证的工程实践**（代码审查规范、提交规范、测试用例生成模板等）标准化，并让所有成员都能方便地调用。

最初的方案是直接在项目中维护 `.cursor/prompts/` 文件夹，但这带来以下问题：

| 问题 | 描述 |
|---|---|
| **分发困难** | 每个人需要手动同步 Prompt 文件到自己的项目 |
| **版本不一致** | 各人使用的 Prompt 版本不同，结果差异大 |
| **路径硬编码** | Prompt 内容中的路径无法跨机器兼容 |
| **更新成本高** | 改一个 Prompt 需要通知所有人手动更新 |
| **没有统计** | 无法知道哪些命令被使用、使用频率如何 |

### 解决方向

借助 **MCP（Model Context Protocol）** 的 `Prompt` 原语，将团队规范封装为可集中分发、按需调用的 Slash Command，实现：

- 用户通过 `/command` 调用，无需关心实现细节
- 内容集中维护，一次更新全员生效
- 支持路径动态注入，跨机器兼容
- 内置使用追踪，支持数据驱动迭代

---

## 2. 核心设计思路

### MCP Prompt 原语

MCP 协议定义了三种核心原语：

| 原语 | 对应概念 | Cursor 中的表现 |
|---|---|---|
| `Tool` | 可调用函数 | AI 自主调用的工具 |
| `Resource` | 可读数据源 | AI 可访问的上下文数据 |
| **`Prompt`** | **可复用提示模板** | **用户触发的 `/slash` 命令** |

**关键洞察**：Cursor 将 MCP Server 注册的每个 `Prompt` 自动暴露为 `/slash-command`，`description` 字段即为菜单中的简介文字。

### 设计口诀

```
Prompt 是 Command 的载体
Markdown 是 Prompt 内容的载体
import 是 Markdown 模块化的机制
变量是跨机器路径兼容的桥梁
```

### 为什么内容不需要下发到用户本地？

MCP Server 本身以**本地 Node.js 进程**的形式运行（Cursor 启动时自动拉起），所有文件读取都是 **Server 进程行为**，用户感知不到。用户只看到 Cursor 将 Prompt 内容注入了对话上下文。

```
用户机器上运行的：
  Cursor (MCP Client) ←──stdio──→ Node.js 进程 (MCP Server)
                                        │
                                   读取本地 .md 文件
                                   （随 npm 包安装）
```

---

## 3. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                          Cursor IDE                               │
│                                                                  │
│   用户输入 /code-review                                           │
│        │                                                         │
│        ▼                                                         │
│   Slash Command 菜单（description 来自 registerPrompt）           │
│        │                                                         │
│        ▼                                                         │
│   MCP Client 发送 prompts/get 请求                                │
│        │                          ▲                              │
│        │                          │ 返回 messages[]              │
│        └──────── stdio ───────────┘                              │
└──────────────────────────────────────────────────────────────────┘
                           │ stdio (JSON-RPC over stdin/stdout)
┌──────────────────────────▼───────────────────────────────────────┐
│                   MCP Server（本地 Node.js 进程）                 │
│                                                                  │
│  index.js                                                        │
│  ├── server.registerPrompt("code-review", desc, handler)         │
│  └── handler()                                                   │
│      ├── 1. parseMarkdown(filePath)                              │
│      │       ├── parseMarkdownWithImports()  ← 递归展开 import    │
│      │       └── replaceMDVariables()        ← 注入运行时路径     │
│      ├── 2. tracking("/code-review")         ← 上报使用统计       │
│      └── 3. return { messages: [...] }       ← 返回 Prompt 内容  │
│                                                                  │
│  文件系统（随 npm 包安装在本地）：                                  │
│  async-pilot/                                                    │
│  ├── src/commands/      ← 命令入口 Markdown（一对一对应 Prompt）   │
│  ├── src/workflows/     ← 可复用工作流子模块                      │
│  ├── src/utils/         ← Node.js 工具脚本（供 AI 调用）          │
│  └── knowledge/         ← 知识库（编码规范、文档模板）             │
└──────────────────────────────────────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼───────────────────────────────────────┐
│                       后端服务                                    │
│  /console-tracking/create  ← 接收使用统计                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. 数据流详解

以用户触发 `/code-review` 为例：

```
① 用户在 Cursor 输入 /code-review，选中该命令回车

② Cursor (MCP Client) 通过 stdio 发送请求：
   {"method": "prompts/get", "params": {"name": "code-review"}}

③ MCP Server index.js 中对应的 handler 被调用：
   - filePath = ".../async-pilot/src/commands/dev/code-review-new.md"

④ parseMarkdown(filePath) 执行：

   a. parseMarkdownWithImports(filePath)：
      - 读取 code-review-new.md 原始内容
      - 正则匹配所有 import '...' 语句
      - 对每个 import 递归调用 parseMarkdownWithImports()
      - 将 import 语句替换为对应文件的完整内容
      - 最终返回一个"拼合后"的完整 Markdown 字符串

   b. replaceMDVariables(content)：
      - 扫描所有 ${VARIABLE_NAME} 占位符
      - 查表替换为 const.js 中定义的实际路径
      - 例：${ASYNC_PILOT_KNOWLEDGE_RULES_PATH}
          → /Users/xxx/.../async-pilot/knowledge/rules

⑤ tracking("/code-review") 异步执行（不阻塞响应）：
   - 读取 ~/.ai-hub-connector/prod/token.json
   - POST 到统计后端 API

⑥ 返回响应给 Cursor：
   {
     "messages": [{
       "role": "user",
       "content": { "type": "text", "text": "# 代码审查\n\n..." }
     }]
   }

⑦ Cursor 将 text 内容注入当前对话上下文
   AI 开始按 Prompt 指令执行代码审查任务
```

---

## 5. 目录结构规范

```
project-root/
├── index.js                        # MCP Server 入口 & Prompt 注册中心
├── const.js                        # 路径常量 & MD_VARIABLES 定义
├── utils.js                        # parseMarkdown / tracking 等核心工具
├── package.json                    # npm 包配置（bin / files / dependencies）
│
└── async-pilot/                    # 核心内容目录（随包分发）
    ├── src/
    │   ├── commands/               # 命令入口（每个 .md 对应一个 /slash 命令）
    │   │   ├── help.md
    │   │   ├── dev/
    │   │   │   ├── code-review-new.md
    │   │   │   ├── code-commit-push.md
    │   │   │   ├── generate-design-spec.md
    │   │   │   └── acceptance-test-case.md
    │   │   ├── bug/
    │   │   │   ├── create-bug.md
    │   │   │   ├── check-bug-quality.md
    │   │   │   └── update-bug.md
    │   │   ├── test/
    │   │   │   ├── test-case.md
    │   │   │   └── test-zoom.md
    │   │   └── log/
    │   │       └── check-log.md
    │   │
    │   ├── workflows/              # 工作流子模块（被 commands 通过 import 引用）
    │   │   ├── git/
    │   │   │   ├── commit.md
    │   │   │   ├── review.md
    │   │   │   └── api-operations.md
    │   │   ├── test/
    │   │   │   ├── case-generation.md
    │   │   │   └── zoom-integration.md
    │   │   └── plan/
    │   │       ├── plan-create.md
    │   │       └── plan-update.md
    │   │
    │   └── utils/                  # Node.js 工具脚本（AI 通过 shell 调用）
    │       ├── getMRDiff.cjs
    │       ├── createMR.cjs
    │       ├── notification.cjs
    │       └── sendNotification.js
    │
    └── knowledge/                  # 知识库（AI 审查时读取）
        ├── rules/                  # 编码规范
        │   └── frontend/
        │       └── async/
        │           ├── code-style.mdc
        │           └── component/
        ├── stacks/                 # 技术栈最佳实践
        │   ├── backend/
        │   │   ├── java/
        │   │   └── go/
        │   └── frontend/
        └── templates/             # 文档模板
            ├── engineer-tds.md
            ├── test-cases.md
            └── mr-description.md
```

**命名约定：**
- `commands/` 下按功能域分子目录，文件名即命令名（可含 `/`，如 `bug/create-bug.md`）
- `workflows/` 下的文件不直接注册为 Prompt，只被 `commands/` import
- 知识库文件使用 `.mdc` 后缀（Markdown with Cursor rules 格式）

---

## 6. 关键模块说明

### 6.1 `index.js` — Prompt 注册中心

负责：MCP Server 实例化、所有 Prompt 注册、Server 启动。

每个 Prompt 的注册格式固定：

```javascript
server.registerPrompt(
  "command-name",          // Slash 命令名（支持 / 分隔层级，如 "bug/create-bug"）
  {
    description: "...",    // Cursor 菜单中显示的一行简介
  },
  async () => {
    const filePath = join(__dirname, "async-pilot/src/commands/xxx.md");
    tracking("/command-name");
    const content = await parseMarkdown(filePath);
    return {
      messages: [{ role: "user", content: { type: "text", text: content } }],
    };
  },
);
```

### 6.2 `utils.js` — 核心工具库

| 函数 | 作用 |
|---|---|
| `getModuleDir(import.meta.url)` | 获取当前模块绝对路径（ESM 兼容） |
| `parseMarkdownWithImports(filePath)` | 递归解析并展开 `import` 语句 |
| `replaceMDVariables(content)` | 将 `${VARIABLE}` 替换为实际路径 |
| `parseMarkdown(filePath)` | 上两者的组合封装（主要入口） |
| `tracking(command)` | 上报使用统计（含防抖） |
| `getUserTokenAndEmailContent()` | 读取本地 token 文件获取认证信息 |

### 6.3 `const.js` — 路径常量与变量表

集中定义所有在 Markdown 中可用的 `${VARIABLE}` 变量：

```javascript
export const MD_VARIABLES = {
  // 工具脚本绝对路径（AI 执行 shell 命令时使用）
  CREATE_MR_SCRIPT:        join(ASYNC_PILOT_UTILS, "createMR.cjs"),
  GET_MR_DIFF_SCRIPT:      join(ASYNC_PILOT_UTILS, "getMRDiff.cjs"),
  NOTIFICATION_SCRIPT:     join(ASYNC_PILOT_UTILS, "notification.cjs"),

  // 知识库路径（AI 读取规则时使用）
  ASYNC_PILOT_KNOWLEDGE_RULES_PATH: join(ASYNC_PILOT_ROOT, "knowledge", "rules"),

  // 用户配置路径
  ASYNC_PILOT_CONFIG_PATH:        ".cursor/.async-pilot-config.json",
  ASYNC_PILOT_GLOBAL_CONFIG_PATH: join(HOME_DIR, ".cursor", "async-pilot", "config.json"),
};
```

---

## 7. 新增 Command 完整步骤

以新增 `/my-module/do-something` 命令为例：

### Step 1：创建命令入口 Markdown

新建文件 `async-pilot/src/commands/my-module/do-something.md`：

```markdown
---
name: Do Something
description: 执行某项任务的简要说明
---

## 角色

你是 xxx 执行者，负责...

## 任务

根据用户提供的 xxx，完成以下步骤：

1. 步骤一：...
2. 步骤二：...

## 规则来源

读取规则文件：${ASYNC_PILOT_KNOWLEDGE_RULES_PATH}/your-rules/

import '../../workflows/shared-context.md'
```

**要点：**
- frontmatter（`---` 块）是可选的，仅作文档说明用，不影响执行
- `import` 语句引用可复用的工作流子模块
- `${变量名}` 引用 `const.js` 中定义的路径

### Step 2：（可选）创建工作流子模块

如果有需要复用的内容，新建 `async-pilot/src/workflows/my-module/shared.md`：

```markdown
## 公共上下文

以下是执行任务前需要了解的共享信息...
```

### Step 3：（可选）添加新的变量

如果需要新的路径变量，在 `const.js` 的 `MD_VARIABLES` 中添加：

```javascript
export const MD_VARIABLES = {
  // ...已有变量
  MY_MODULE_RULES_PATH: join(ASYNC_PILOT_ROOT, "knowledge", "rules", "my-module"),
};
```

### Step 4：在 `index.js` 注册 Prompt

```javascript
server.registerPrompt(
  "my-module/do-something",
  {
    description: "执行某项任务的简要说明（显示在 Cursor slash 菜单）",
  },
  async () => {
    const filePath = join(
      __dirname,
      "async-pilot/src/commands/my-module/do-something.md",
    );
    tracking("/my-module/do-something");
    const content = await parseMarkdown(filePath);
    return {
      messages: [{ role: "user", content: { type: "text", text: content } }],
    };
  },
);
```

### Step 5：本地验证

```bash
# 启动本地 MCP Server，确认新命令出现在输出列表中
node index.js

# 预期输出中应包含新命令名：
# ..., my-module/do-something
```

在 Cursor 中重新加载 MCP（或重启 Cursor），输入 `/my-module` 验证命令出现在菜单中。

---

## 8. 变量系统

### 设计动机

Markdown 文件中的 Prompt 内容往往需要引用**本地绝对路径**（如工具脚本路径、知识库路径），这些路径因人而异（不同用户名、不同安装位置）。变量系统解决了跨机器兼容问题。

### 变量分类

| 类型 | 示例 | 说明 |
|---|---|---|
| **工具脚本路径** | `${CREATE_MR_SCRIPT}` | AI 执行 `node ${CREATE_MR_SCRIPT}` 调用本地脚本 |
| **知识库路径** | `${ASYNC_PILOT_KNOWLEDGE_RULES_PATH}` | AI 读取规则文件时的根路径 |
| **用户配置路径** | `${ASYNC_PILOT_CONFIG_PATH}` | 读取项目级 / 全局配置 |

### 替换机制

```javascript
// utils.js
function replaceMDVariables(content) {
  for (const [key, value] of Object.entries(MD_VARIABLES)) {
    const regex = new RegExp(`\\$\\{${key}\\}`, "g");
    content = content.replace(regex, value);
  }
  return content;
}
```

替换在 `parseMarkdown()` 最后一步执行，作用于完全展开（import 处理完毕）后的文本。

### 在 Markdown 中使用

```markdown
请执行以下命令获取 MR 差异：

```bash
node ${GET_MR_DIFF_SCRIPT} --mr-id <MR_ID>
```

审查时请参考前端规则：${ASYNC_PILOT_KNOWLEDGE_RULES_PATH}/frontend/async/
```

---

## 9. import 组合机制

### 语法

```markdown
import 'relative/path/to/file.md'
```

- 路径相对于**当前 Markdown 文件**所在目录
- 支持无限层级递归
- 被 import 的文件本身也可以包含 import 语句

### 解析实现

```javascript
// utils.js - parseMarkdownWithImports
const importRegex = /^import\s+['"]([^'"]+)['"]\s*$/gm;

// 扫描所有 import 语句
while ((match = importRegex.exec(content)) !== null) {
  imports.push({ statement: match[0], path: resolve(fileDir, match[1]) });
}

// 递归替换
for (const imp of imports) {
  const importedContent = await parseMarkdownWithImports(imp.path); // 递归
  result = result.replace(imp.statement, importedContent);
}
```

### 典型用法

**命令入口引用公共上下文：**
```markdown
<!-- commands/dev/code-review.md -->
## 角色
你是代码审查执行者...

import '../../workflows/git/review.md'
import '../../workflows/git/api-operations.md'
```

**分层拆分大型 Prompt：**
```markdown
<!-- workflows/git/review.md -->
## 审查工作流

import '../shared/gitlab-setup.md'
import '../shared/output-format.md'
```

---

## 10. 使用追踪设计

### 目标

- 了解哪些命令被频繁使用，驱动优先级决策
- 了解团队整体 AI 工具使用趋势
- 为命令迭代提供数据支撑

### 实现

```javascript
// utils.js
export async function tracking(command) {
  // 防抖：5 秒内同一命令不重复上报
  const now = Date.now();
  const lastTracked = trackingCache.get(command);
  if (lastTracked && now - lastTracked < 5000) return;
  trackingCache.set(command, now);

  // 获取用户认证信息（从本地 token 文件）
  const { token, email } = await fetchTokenContent();

  // 上报（失败静默处理）
  try {
    await fetch(`${BASE_URL}?email=${email}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        eventType: "async_pilot_command_execute",
        sessionId: Date.now().toString(),
        sourcePage: command,
      }),
    });
  } catch (error) {
    console.error(`Tracking failed: ${error.message}`);  // 不抛出，不影响主流程
  }
}
```

### 隐私注意事项

- 上报的数据：`eventType`、`sessionId`（时间戳）、`sourcePage`（命令名）
- 不上报：Prompt 具体内容、用户代码、对话内容
- 认证：使用用户已登录的 token，email 仅用于区分用户维度统计

---

## 11. 分发与更新机制

### 分发方式：npx 拉取

用户在 `~/.cursor/mcp.json` 中配置：

```json
{
  "async-pilot": {
    "command": "npx",
    "args": ["-y", "https://async-pilot.zoomdev.us/download/mcp/latest"]
  }
}
```

Cursor 每次启动时，`npx` 自动下载最新版本并执行。

### 内容更新流程

```
开发者修改 Markdown / 添加新 Command
        │
        ▼
提交 MR → 审核 → 合并到 release 分支
        │
        ▼
CI/CD 打包新版本 npm 包，发布到私有 registry
        │
        ▼
用户下次重启 Cursor → npx 自动拉取新版本
        │
        ▼
新命令 / 更新后的 Prompt 内容生效
```

### 本地开发模式

开发者调试新命令时，切换到本地版本：

```json
{
  "async-pilot-local": {
    "command": "node",
    "args": ["/path/to/local/async-pilot/index.js"]
  }
}
```

在 Cursor Settings 中禁用远程 `async-pilot`，启用 `async-pilot-local`，修改后即时生效（无需重启）。

---

## 12. 设计权衡与决策

### 为什么使用 Prompt 而非 Tool？

| 维度 | Prompt | Tool |
|---|---|---|
| **触发方式** | 用户主动 `/slash` | AI 自主决策调用 |
| **适用场景** | 工作流引导、复杂任务启动 | 具体操作执行（读文件、调 API）|
| **输入参数** | 目前不支持带参数（或通过对话补充）| 支持结构化参数 |
| **用户感知** | 直观，用户知道在调用什么 | 对用户透明 |

本项目的命令大多是**启动一个多步骤工作流**，更适合 Prompt。实际执行中 AI 会进一步调用 Tool（如读文件、执行脚本）来完成子任务。

### 为什么用 Markdown 而非直接写在 JS 里？

- Markdown 文件可以被非工程师（PM、QA）直接阅读和修改
- 支持 `import` 模块化，避免重复内容
- 与代码解耦，Prompt 迭代不需要改 JS 代码
- 可以在编辑器中预览效果

### 为什么用自研 import 而非其他方案？

MCP SDK 没有内置的 Prompt 模块化机制，自研 `import` 语法成本低、可控性强，正则解析简单可靠，满足当前需求。

### 命令名中的 `/` 层级

Cursor 对 `/bug/create-bug` 这类带斜杠的命令名会显示为分级菜单，有助于命令分类整理。这是利用了 Cursor 对 Prompt name 的处理规则。

---

*文档维护：如有命令新增或架构调整，请同步更新本文档的目录结构和数据流章节。*
