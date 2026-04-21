# CSP AI Agent — Cursor Plugin Team Marketplace 分发方案

**文档版本：** 1.0  
**创建日期：** 2026-03-10  
**状态：** 方案设计

---

## 背景与问题

当前用户安装 CSP AI Agent 需要两步，且两步之间存在断层：

| 步骤 | 方式 | 问题 |
|------|------|------|
| 安装 MCP Server | deeplink 一键安装 | ✅ 已解决 |
| 下发 Rule 文件 | 必须打开 Agent 对话、AI 执行 sync_resources 后写入 | ❌ 需要用户主动触发，体验差 |

Cursor deeplink（`cursor://anysphere.cursor-deeplink/mcp/install`）**仅支持安装 MCP Server**，无法附带下发 `.mdc` rule 文件。

**解决方案：** 使用 Cursor **Team Marketplace（私有插件市场）** 将 MCP Server + Rule 文件打包成一个 Plugin，团队成员通过 Marketplace 一键安装，或由管理员设置为 Required 自动推送。

---

## 方案架构

```
Cursor Team Marketplace（私有）
        │
        │  管理员导入 GitHub repo
        ▼
  CSP Plugin GitHub Repo
  ├── .cursor-plugin/
  │   └── plugin.json          ← Plugin 清单
  ├── rules/
  │   └── csp-ai-prompts.mdc   ← 自动安装到用户 ~/.cursor/rules/
  └── mcp.json                 ← MCP Server 配置（含 token 注入说明）
        │
        │  用户在 Cursor Marketplace 面板安装
        ▼
  用户本地
  ├── ~/.cursor/rules/csp-ai-prompts.mdc   ✅ 自动写入
  └── ~/.cursor/mcp.json                   ✅ 自动合并
```

---

## 一、创建 Plugin GitHub 仓库

### 1.1 仓库结构

```
csp-ai-agent-plugin/
├── .cursor-plugin/
│   └── plugin.json
├── rules/
│   └── csp-ai-prompts.mdc
├── mcp.json
├── assets/
│   └── logo.svg          （可选）
└── README.md
```

### 1.2 Plugin 清单（`.cursor-plugin/plugin.json`）

```json
{
  "name": "csp-ai-agent",
  "version": "1.0.0",
  "description": "CSP AI Agent — MCP Server 接入与 AI 资源同步",
  "author": {
    "name": "CSP Team",
    "email": "csp-team@zoom.us"
  },
  "keywords": ["csp", "ai-agent", "mcp"],
  "logo": "assets/logo.svg"
}
```

> **说明：** `rules/` 和 `mcp.json` 由 Cursor 自动发现，无需在 manifest 中显式声明。

### 1.3 MCP Server 配置（`mcp.json`）

```json
{
  "mcpServers": {
    "csp-ai-agent": {
      "url": "https://zct-dev.zoomdev.us/csp-agent/sse",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

> **Token 问题：** `mcp.json` 中的 token 是静态写死的，有两个处理策略：
>
> - **策略 A（推荐）**：`mcp.json` 中不写 token，用户安装后手动填入。在 `csp-ai-prompts.mdc` 里写明填写步骤。
> - **策略 B**：网页按钮动态生成带用户 token 的 deeplink，作为 MCP 安装的补充（Plugin 负责 rule，deeplink 负责带 token 的 MCP 配置）。
> - **策略 C（企业方案）**：用 Cursor Enterprise 的 SCIM 集成，token 通过 IdP 统一配置，无需手动。

### 1.4 Rule 文件（`rules/csp-ai-prompts.mdc`）

将服务器端 `csp-ai-prompts.mdc` 的内容放在这里。格式要求：

```markdown
---
description: CSP AI Agent 初始化规则，自动同步订阅的 AI 资源
alwaysApply: true
---

<!-- rule 内容 -->
```

> **注意：** Plugin 中的 rule 文件是**静态版本**。如果 rule 内容需要频繁更新，需要通过更新 GitHub repo 并让 Cursor 重新同步 Plugin 来生效。对于动态内容，仍然依赖 sync_resources 机制。

---

## 二、配置 Team Marketplace

### 2.1 前提条件

- Cursor **Teams 计划**（支持 1 个 Team Marketplace）或 **Enterprise 计划**（支持无限个）
- 管理员权限：Dashboard → Settings → Plugins

### 2.2 导入步骤

1. 在 Cursor Dashboard 打开 **Settings → Plugins**
2. 在 **Team Marketplaces** 区域点击 **Import**
3. 粘贴 Plugin GitHub 仓库 URL（支持 private repo，需要授权）
4. Cursor 会解析仓库中的 Plugin，预览 rules、MCP servers 等组件
5. 可选：设置 **Team Access groups**（控制哪些人能看到此 Plugin）
6. 填写 Marketplace 名称和描述，点击 **Save**

### 2.3 设置分发策略

导入后，进入该 Plugin 的设置：

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **Required** | 对指定 distribution group 的所有成员自动安装，保存即生效 | 全员强制推送 |
| **Optional** | Plugin 出现在成员的 Marketplace 面板，成员自行选择安装 | 自愿使用 |

推荐：先设置为 Optional 验证效果，稳定后切换为 Required。

---

## 三、用户安装体验

### Required 模式（管理员推送）

```
管理员设置 Required
      │
      ▼
团队成员重启 Cursor 或 Reload Window
      │
      ▼
Plugin 自动安装：
  ✅ csp-ai-prompts.mdc → ~/.cursor/rules/
  ✅ mcp.json 中的 csp-ai-agent → ~/.cursor/mcp.json
      │
      ▼
成员首次打开 Cursor Agent 对话
      │
      ▼
csp-ai-agent-setup prompt 触发（已由 rule 配置）
  → 自动执行 sync_resources
  → 同步订阅的 command/skill/rule 资源
```

### Optional 模式（用户自行安装）

1. 打开 Cursor → Marketplace 面板
2. 找到 "CSP AI Agent" Plugin，点击 Install
3. 安装完成，rule 和 MCP 均生效

---

## 四、与现有 deeplink 方案的关系

两种方案**互补**，不是替代关系：

| 场景 | 推荐方案 |
|------|---------|
| 团队统一部署（有 Teams/Enterprise 计划） | Team Marketplace（Plugin） |
| 外部用户或临时用户快速接入 | deeplink（仅安装 MCP，无 rule） |
| 用户已安装 MCP，需同步最新 rule/command/skill | sync_resources（现有机制） |

**推荐组合策略：**

```
Team Marketplace Plugin（MCP + 静态 rule）
        +
sync_resources（动态 command/skill/rule 内容更新）
```

Plugin 负责"第一次到位"，sync_resources 负责"持续保鲜"。

---

## 五、Plugin 仓库维护

### 5.1 更新 Rule 文件

1. 修改 GitHub repo 中的 `rules/csp-ai-prompts.mdc`
2. Push 到 main branch
3. 在 Dashboard → Plugins 中点击 **Sync** 或等待 Cursor 定期拉取

### 5.2 更新 MCP Server URL

修改 `mcp.json` 后同步仓库即可。

### 5.3 版本管理

每次重要更新，在 `plugin.json` 中递增 `version` 字段，便于追踪。

---

## 六、注意事项

### Token 安全

- `mcp.json` 中的 token **不要写死在 GitHub repo 中**（即便是 private repo）
- 推荐：`mcp.json` 中 Authorization 留空或写占位符，配合文档引导用户手动填写
- 企业级：通过 Cursor Enterprise + SCIM 统一管理

### Rule 文件与 sync_resources 的优先级

- Plugin 安装的 rule 文件（`~/.cursor/rules/`）是静态的，不会自动随服务器更新
- `sync_resources` 通过 AI 写入的 rule 文件也在同一目录，可能覆盖 Plugin 版本
- **建议：** Plugin 中只放初始化/引导类的 rule，动态内容依赖 sync_resources

### Cursor 计划限制

| 功能 | 需要的 Cursor 计划 |
|------|-----------------|
| Team Marketplace（导入私有 repo） | Teams 或 Enterprise |
| Required Plugin（自动推送） | Teams 或 Enterprise |
| 无限个 Team Marketplace | Enterprise |
| 公共 Marketplace 发布 | 免费（需审核） |

---

## 七、实施计划

| 阶段 | 任务 | 负责人 | 预计时间 |
|------|------|--------|---------|
| 1 | 创建 Plugin GitHub repo，放入 `plugin.json`、`mcp.json`、`rules/csp-ai-prompts.mdc` | 开发 | 0.5 天 |
| 2 | 本地测试：`~/.cursor/plugins/local/csp-ai-agent` 符号链接验证 | 开发 | 0.5 天 |
| 3 | 在 Cursor Dashboard 配置 Team Marketplace，导入 repo | 管理员 | 0.5 天 |
| 4 | 小范围测试（Optional 模式，5 人以内） | QA | 1 天 |
| 5 | 确认无问题后切换为 Required，全员推送 | 管理员 | — |

### 本地测试方法

```bash
# 1. 创建本地插件目录
mkdir -p ~/.cursor/plugins/local/csp-ai-agent

# 2. 软链接到开发目录（便于迭代）
ln -s /path/to/csp-ai-agent-plugin ~/.cursor/plugins/local/csp-ai-agent

# 3. 在 Cursor 中：Developer: Reload Window
# 4. 检查 ~/.cursor/rules/ 是否有 csp-ai-prompts.mdc
# 5. 检查 ~/.cursor/mcp.json 是否有 csp-ai-agent 条目
```

---

## 八、参考资料

- [Cursor Plugins 官方文档](https://cursor.com/docs/plugins)
- [Cursor Plugins Reference（完整规范）](https://cursor.com/docs/reference/plugins)
- [Cursor MCP Install Links](https://cursor.com/docs/context/mcp/install-links)
- [Cursor Plugin Template](https://github.com/cursor/plugin-template)
- [Team Marketplace 示例仓库](https://github.com/fieldsphere/cursor-team-marketplace-template)
