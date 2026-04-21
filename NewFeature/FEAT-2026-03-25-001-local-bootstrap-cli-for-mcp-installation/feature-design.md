# Feature: Local Bootstrap CLI for Remote MCP-Driven MCP Installation

**Feature ID:** FEAT-2026-03-25-001  
**版本:** 1.0.0  
**创建日期:** 2026-03-25  
**状态:** 设计确认中

---

## 1. 背景与问题定义

### 1.1 当前约束

当前 CSP-AI-Agent 的 MCP Server 部署在 CSP Server 上，通过 SSE 与 Cursor 建立连接。这意味着：

1. 远端 MCP Server 可以感知连接事件、返回工具结果、下发资源元信息
2. 远端 MCP Server 无法直接在用户电脑上执行下载、解压、写文件、修改 `~/.cursor/mcp.json`
3. Cursor / Codex 侧的 AI Agent 并不会因为“远端 MCP 发来一个事件”就自动执行一次本地安装动作

因此，“远端 MCP A 在连接时自动安装另一个 MCP B”这个需求，单靠远端 A 无法闭环。

### 1.2 根因

缺失的是一个**用户本机可执行、可被稳定触发、具备文件系统写权限**的执行入口。

如果没有这个本地执行入口，系统最多只能做到：
- A 告诉客户端“建议安装 B”
- AI 或用户稍后手动触发安装

但做不到真正稳定的“连接即本机自动 bootstrap”。

### 1.3 升级方向

引入一个安装在用户本机的轻量级辅助 CLI，作为本机 bootstrap 执行器：

- 远端 MCP A 负责判断“是否需要安装/修复/升级 B”
- 本地 CLI 负责执行真正的本机动作
  - 下载 MCP 包
  - 校验包完整性
  - 解压/安装到用户指定目录
  - 原子更新 `~/.cursor/mcp.json`
  - 返回执行结果

这个方案可以把“远端可决策”和“本地可执行”拼起来，形成完整闭环。

---

## 2. 目标与非目标

### 2.1 目标

本 Feature 的目标是为远端 MCP 驱动的本地 MCP 安装提供一个可落地的 bootstrap 机制，满足：

1. 用户本机只需预装一次辅助 CLI
2. 后续每次连接远端 MCP A 时，都可以幂等地检查目标 MCP B 是否存在/完整/版本正确
3. 当 B 缺失或异常时，可以自动在用户指定路径完成下载和安装
4. 当 `~/.cursor/mcp.json` 缺失 B 的配置时，可以自动追加配置，且不覆盖用户已有配置
5. 变更结果可回传给远端 MCP A，用于 UI 提示或遥测

### 2.2 非目标

本 Feature 当前不解决以下问题：

1. 不保证 Cursor 在当前会话内立刻热加载新写入的 `mcp.json`
2. 不依赖 AI Agent 自动执行安装逻辑
3. 不尝试让远端 MCP 直接获得用户本机的任意执行权限
4. 不在第一阶段支持任意来源 URL 的无约束下载

---

## 3. 可行性结论

### 3.1 结论

**可行，且是当前架构下最合理的升级方向。**

原因：

1. 远端 MCP A 继续保留服务端部署，不破坏现有核心架构
2. 本地 CLI 提供缺失的“本机执行能力”
3. 连接触发可以转化为“远端发出 bootstrap 指令，本地 CLI 执行幂等安装”
4. 即便 Cursor AI Agent 不主动触发，只要宿主侧或现有本地组件能调起 CLI，闭环就成立

### 3.2 前提条件

该方案成立依赖以下前提：

1. 用户本机允许预装一个辅助 CLI
2. 远端 MCP A 能返回安装 manifest 或 bootstrap 指令
3. 用户本机存在一个稳定的触发入口调用 CLI
4. CLI 具备写入目标安装目录和 `~/.cursor/mcp.json` 的权限

### 3.3 最大收益

1. 把“安装/修复 B”从 AI 决策问题转为工程可控的系统行为
2. 把“连接时自动检查”变成真正可执行的幂等动作
3. 降低对 Cursor/Codex agent 自动执行语义的依赖

---

## 4. 总体方案

### 4.1 组件划分

引入 3 个角色：

1. **远端 MCP A**
   - 部署在 CSP Server
   - 负责判断是否需要安装/修复/升级 MCP B
   - 提供 bootstrap manifest

2. **本地 Bootstrap CLI**
   - 部署在用户电脑
   - 负责下载、校验、安装、写配置
   - 负责向上层返回本机执行结果

3. **目标 MCP B**
   - 被安装的 MCP 包
   - 安装后由 Cursor 通过 `mcp.json` 启动

### 4.2 核心链路

```text
Cursor 连接远端 MCP A
    ↓
A 判断本地目标 MCP B 是否应存在
    ↓
A 返回 bootstrap manifest / install instruction
    ↓
本地 Bootstrap CLI 执行
    ├─ 检查 installDir 中的 B 是否存在且完整
    ├─ 检查 ~/.cursor/mcp.json 是否已有 B 配置
    ├─ 若缺失则下载并安装 B
    ├─ 若缺失则追加 mcp.json 配置
    └─ 返回 changed / reload_required / error
    ↓
宿主提示用户 reload Cursor（若需要）
```

### 4.3 关键原则

1. **幂等优先**
   - 每次连接都可触发检查
   - 但只有缺失/损坏/版本不符时才执行下载和写入

2. **不覆盖用户配置**
   - 若 `mcpServers.<serverName>` 已存在，则默认跳过
   - 仅在显式允许 repair/update 时修改

3. **原子更新**
   - 下载到临时目录
   - 校验通过后再替换正式目录
   - `mcp.json` 写入采用“读 -> merge -> 临时文件 -> rename”

4. **安全下载**
   - URL 域名白名单
   - 包 hash/signature 校验
   - 禁止无校验执行

---

## 5. 详细设计

### 5.1 Bootstrap Manifest

远端 MCP A 不直接执行安装，而是返回结构化 manifest 给本地 CLI：

```json
{
  "serverName": "example-mcp-b",
  "version": "1.2.3",
  "downloadUrl": "https://example.com/mcp-b-1.2.3.tar.gz",
  "sha256": "abc123...",
  "installDir": "/Users/{user}/.cursor/mcp-packages/example-mcp-b",
  "entryCommand": "node",
  "entryArgs": [
    "/Users/{user}/.cursor/mcp-packages/example-mcp-b/dist/index.js"
  ],
  "env": {
    "NODE_ENV": "production"
  },
  "updatePolicy": "install_if_missing_or_invalid"
}
```

### 5.2 本地 CLI 能力

建议本地 CLI 提供如下子命令：

```bash
cursor-ai-agent-bootstrap install-from-manifest --manifest <file-or-json>
cursor-ai-agent-bootstrap check --server-name <name> --install-dir <dir>
cursor-ai-agent-bootstrap repair --server-name <name>
cursor-ai-agent-bootstrap configure --manifest <file-or-json>
```

其中主路径是：

```bash
cursor-ai-agent-bootstrap install-from-manifest --manifest '<json>'
```

CLI 内部步骤：

1. 解析 manifest
2. 校验 serverName / version / downloadUrl / installDir / entryCommand
3. 检查本地包是否已存在且版本一致
4. 检查 `~/.cursor/mcp.json` 是否已有 server entry
5. 若包缺失或损坏：
   - 下载到临时文件
   - 校验 sha256
   - 解压到临时目录
   - 原子替换正式安装目录
6. 若配置缺失：
   - 读取 `~/.cursor/mcp.json`
   - merge `mcpServers[serverName]`
   - 原子写回
7. 输出结果 JSON

### 5.3 本地目录建议

建议统一落盘到以下目录：

```text
~/.cursor/mcp-packages/<serverName>/
  ├── current/
  ├── versions/<version>/
  ├── manifest.json
  └── install.log
```

优点：

1. 与项目源码目录解耦
2. 方便按 serverName / version 管理
3. 支持未来扩展版本回滚

### 5.4 mcp.json Merge 策略

目标文件：

```text
~/.cursor/mcp.json
```

CLI 写入策略：

1. 文件不存在：创建基础结构
2. `mcpServers` 不存在：补建对象
3. 若 `mcpServers[serverName]` 已存在：
   - 默认返回 `already_configured`
   - 不覆盖用户现有配置
4. 若不存在：
   - 追加如下结构

```json
{
  "mcpServers": {
    "example-mcp-b": {
      "command": "node",
      "args": [
        "/Users/xxx/.cursor/mcp-packages/example-mcp-b/current/dist/index.js"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### 5.5 返回结果

CLI 应标准化输出：

```json
{
  "status": "ok",
  "serverName": "example-mcp-b",
  "packageInstalled": true,
  "configWritten": true,
  "alreadyInstalled": false,
  "alreadyConfigured": false,
  "changed": true,
  "reloadRequired": true,
  "installPath": "/Users/xxx/.cursor/mcp-packages/example-mcp-b/current",
  "configPath": "/Users/xxx/.cursor/mcp.json"
}
```

这样远端 MCP A 或宿主可以明确知道：
- 是否真的发生变更
- 是否需要提示 reload Cursor

---

## 6. 触发模式设计

### 6.1 推荐模式

推荐采用：

**“每次连接触发检查，但只在缺失/异常时实际变更”**

这是当前讨论里最稳妥的模式，因为它兼顾：

1. 自动化
2. 幂等性
3. 最小副作用

### 6.2 不推荐模式

不建议：

1. 每次连接都强制重新下载
2. 每次连接都覆盖 `mcp.json`
3. 完全依赖 AI Agent 触发本机动作

原因：

1. 启动慢
2. 风险高
3. 易破坏用户配置
4. 对 Cursor/Codex 的 agent 时序依赖过强

### 6.3 关于“谁来调用 CLI”

这是本方案里最关键的集成点。

本地 CLI 只是“可执行入口”，还需要一个本机触发者。可选路径：

1. **本地 launcher / wrapper**
   - 最推荐
   - 用户本机已有一个轻量本地组件，在连接流程中调用 CLI

2. **Cursor 宿主侧 hook**
   - 若 Cursor 后续支持“连接事件 -> 本地脚本”则可直接接入

3. **显式安装命令**
   - 退化方案
   - 用户或上层工具手动执行一次 bootstrap

如果没有本地触发者，单独的 CLI 仍然无法在“连接事件”发生时自动运行。

---

## 7. 与现有架构的兼容性分析

### 7.1 与现有服务端架构兼容

兼容。原因：

1. 不改变远端 MCP A 的部署位置
2. 不要求服务端直接操作用户文件系统
3. 只新增 manifest 输出和安装状态返回能力

### 7.2 与资源同步设计兼容

兼容。当前系统已经有：

1. 资源元信息管理
2. 资源下载 URL 概念
3. 远端与本地状态不对称的明确架构

本方案只是把 “MCP 类型资源” 从“仅配置元信息”推进到“可通过本地 CLI 完成 bootstrap 安装”。

### 7.3 与 Cursor / Codex 行为兼容

兼容，但有边界：

1. 不依赖 AI 自动执行
2. 不假设新写入的 `mcp.json` 会立刻生效
3. 安装后通常仍需要 reload/restart Cursor 才能稳定加载新 MCP B

---

## 8. 风险与应对

### 8.1 风险清单

1. **缺少本地触发者**
   - 只有 CLI 没有调用者，仍无法自动执行

2. **下载安全风险**
   - 远端 URL 被篡改或包被污染

3. **配置文件损坏风险**
   - `mcp.json` 写入失败或并发写坏

4. **安装中断导致半成品**
   - 下载中断、解压失败、旧版本被破坏

5. **版本漂移**
   - manifest 声明版本与本地实际版本不一致

### 8.2 应对策略

1. 本地必须有稳定调用入口
2. 下载必须校验 sha256 或签名
3. `mcp.json` 必须原子写
4. 安装必须使用临时目录 + replace
5. 结果必须输出 machine-readable JSON

---

## 9. 分阶段落地建议

### Phase 1: CLI 最小可用版

目标：

1. 支持从 manifest 安装 MCP B
2. 支持原子写 `~/.cursor/mcp.json`
3. 支持幂等检查
4. 输出标准结果 JSON

成功标准：

1. B 缺失时可成功安装
2. B 已存在时不会重复下载
3. `mcp.json` 已有配置时不会覆盖

### Phase 2: 服务端 Manifest 能力

目标：

1. 远端 MCP A 生成 bootstrap manifest
2. A 能返回 install/check/reload 建议
3. 打通 CLI 调用链路

成功标准：

1. A 能判断是否需要安装 B
2. A 能返回完整 manifest 给本地侧

### Phase 3: 自动触发集成

目标：

1. 接入本地 launcher 或宿主 hook
2. 实现“连接时自动检查，缺失才安装”

成功标准：

1. 用户无需手动运行 CLI
2. 首次缺失时自动补装
3. 结果可明确提示 reload

---

## 10. API / 接口草案

### 10.1 远端 MCP A 输出草案

建议新增一个结构化响应能力，例如：

```json
{
  "bootstrapRequired": true,
  "manifest": {
    "serverName": "example-mcp-b",
    "version": "1.2.3",
    "downloadUrl": "https://example.com/mcp-b-1.2.3.tar.gz",
    "sha256": "abc123...",
    "installDir": "~/.cursor/mcp-packages/example-mcp-b",
    "entryCommand": "node",
    "entryArgs": [
      "~/.cursor/mcp-packages/example-mcp-b/current/dist/index.js"
    ],
    "env": {}
  }
}
```

### 10.2 CLI 退出码建议

```text
0  安装成功或已就绪
10 manifest 非法
11 下载失败
12 hash 校验失败
13 解压失败
14 mcp.json 读写失败
15 权限不足
16 目标包已存在但损坏
```

---

## 11. Open Questions

以下问题在进入 OpenSpec 前建议先确认：

1. 本地 CLI 由谁分发和升级？
2. 谁是“本地触发者”？
   - 独立 launcher
   - Cursor 宿主 hook
   - 现有本地插件
3. B 包格式是 `tar.gz`、`zip` 还是单文件二进制？
4. 是否允许自定义 installDir，还是统一落到 `~/.cursor/mcp-packages/`？
5. 是否支持升级和回滚，还是第一版只处理“缺失即安装”？
6. `mcp.json` 已存在但配置不一致时，默认跳过还是 repair？

---

## 12. 建议结论

建议将“本地辅助 CLI + 远端 manifest + 本地触发者”作为后续升级方向推进。

原因：

1. 这是在现有“远端 MCP 部署”前提下最符合权限边界的方案
2. 它能真正解决“远端可感知，但本机不可执行”的核心断点
3. 方案具备明显的分阶段可实施性，第一阶段就能验证核心闭环

建议下一步在用户确认本设计后，再进入 OpenSpec，拆成至少两个 capability：

1. `local-bootstrap-cli`
2. `remote-mcp-bootstrap-manifest`

