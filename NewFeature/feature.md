# CSP AI Agent - 新需求设计文档

**文档版本：** 1.0  
**创建日期：** 2026-03-10  
**状态：** 需求阶段

---

## 需求一：资源联动订阅与依赖感知机制

### 背景

当前 CSP AI Agent 支持独立订阅、上传、同步 Rules、Skills、MCP 等资源类型。但在实际使用中，某些资源之间存在**强依赖关系**：

- 某个 Rule 需要配合特定 Skill 才能生效（如 openspec-rule 依赖 openspec-mcp）
- 某个 Skill 需要调用特定 MCP 工具（如 code-review-skill 配合 gitlab-mcp）
- 某个工作流需要 Rule + Skill + MCP + Command 四者协同

这些依赖关系在**三个场景**中都应该被感知和处理：
1. **订阅/同步时**：自动处理依赖资源
2. **卸载时**：检查被依赖方，防止孤立
3. **上传资源时**：检测上传内容的相互依赖，主动通知用户

### 需求描述

#### 1.1 资源依赖关系定义

在资源元数据中增加依赖声明字段，支持描述资源间的关联关系：

```yaml
# 资源元数据示例
id: code-review-rule
type: rule
name: "Code Review Rule"
dependencies:
  - id: code-review-skill
    type: skill
    required: true          # 强依赖（必须一起使用）
    description: "需要配合 Code Review Skill 才能生效"
  - id: gitlab-mcp
    type: mcp
    required: false         # 弱依赖（建议配合使用）
    description: "建议同时安装 GitLab MCP 以支持 MR 创建"
```

依赖类型：
- **强依赖（required: true）**：资源无法独立工作，必须配套使用
- **弱依赖（required: false）**：资源可独立工作，但配套使用体验更佳

#### 1.2 联动订阅行为

**触发时机：**
- 用户通过 `manage_subscription` 订阅资源 A 时
- 系统自动扫描资源 A 的 `dependencies` 字段
- 对所有 `required: true` 的依赖，自动执行 `subscribe` + `sync`
- 对所有 `required: false` 的依赖，在响应中附上建议提示，由用户确认

**触发示例：**

```
用户: 订阅 code-review-rule

系统响应:
✅ 已订阅 code-review-rule
✅ 检测到强依赖，已自动订阅并同步 code-review-skill
💡 建议同时订阅 gitlab-mcp（支持 MR 创建功能），是否一并订阅？
```

**弱依赖用户确认流程：**
- AI 主动询问用户是否要订阅弱依赖资源
- 用户回答"是"后，AI 调用 `manage_subscription` 执行订阅
- 用户回答"否"后，记录用户决策，不再重复询问（本次会话内）

#### 1.3 联动卸载行为

卸载时，同样检查依赖关系：
- 卸载资源 A 时，扫描所有已订阅资源，找出依赖 A 的资源 B、C
- 提示用户：「资源 B、C 依赖 code-review-rule，卸载后可能无法正常工作，是否级联卸载？」
- 用户可选择：**级联卸载**（一并移除依赖方）或 **仅卸载当前资源**（保留依赖方，风险自担）

#### 1.4 上传资源时的依赖检测与通知

> **核心新增场景**：用户通过 `upload_resource` 上传一个或多个资源时，系统需要主动分析上传内容，检测资源间的依赖关系，并向用户发出通知。

**触发时机：**
- 用户调用 `upload_resource` 上传资源时（单个或批量）

**检测逻辑（分两步）：**

**Step 1：分析上传内容本身的互相依赖**

当用户一次性上传多个资源时，系统扫描这批资源的 `dependencies` 字段，识别它们之间是否存在相互依赖关系，并在响应中标注出来：

```
用户上传：[code-review-rule, code-review-skill, gitlab-mcp]

系统分析：
  code-review-rule → 强依赖 code-review-skill ✅（已在上传列表中）
  code-review-rule → 弱依赖 gitlab-mcp ✅（已在上传列表中）

系统通知：
📦 检测到资源依赖关系：
  ✅ code-review-rule 的强依赖 code-review-skill 已包含在本次上传中
  ✅ code-review-rule 的弱依赖 gitlab-mcp 已包含在本次上传中
  → 这三个资源将作为一个资源组发布，建议用户订阅时一并订阅
```

**Step 2：检测上传资源是否与 CSP 已有资源重复或相似**

> 此步骤与依赖关系**无关**，专注于识别**重复/相似资源**，避免平台出现功能相近的冗余资源。

系统查询 CSP 已有资源列表，通过资源名称、类型、描述的相似度比对，识别是否存在潜在重复：

**匹配维度：**
- 资源 `id` 或 `name` 相同/相近（如 `code-review-rule` vs `code-review-rules`）
- 同类型资源（rule/skill/mcp）描述语义相近
- 文件内容哈希相同（完全重复）

**通知行为（不论是否重复都告知）：**

```
✅ 资源上传成功：new-code-review-rule

📋 上传摘要：
  类型：Rule | 大小：2.3KB

⚠️ 检测到平台已有相似资源：
  - code-review-rule（Rule，发布于 2026-01-15，作者：elliotding）
    相似度：名称高度相似

是否需要与已有资源进行内容对比？
  → [是] 系统将从 CSP 拉取 code-review-rule 与本次上传内容逐行对比
  → [否] 直接完成上传，两个资源独立存在
```

**用户选择对比后的行为：**

用户确认需要对比时，系统从 CSP 拉取已有资源内容，与上传内容进行对比，输出差异报告：

```
📊 内容对比报告：new-code-review-rule vs code-review-rule

新增内容（仅在上传版本中）：
  + Rule: "所有 C++ 代码必须符合 C++20 标准"
  + Rule: "优先使用现代 C++ 高级语法特性"

移除内容（仅在已有版本中）：
  - Rule: "使用 C++17 标准"

相同内容：14 条规则一致

建议操作：
  [A] 覆盖更新已有资源（替换 code-review-rule）
  [B] 保留为独立新资源（两个资源并存）
  [C] 取消上传
```

**无相似资源时的通知：**

```
✅ 资源上传成功：new-code-review-rule

📋 上传摘要：
  类型：Rule | 大小：2.3KB
  平台检测：未发现相似资源，资源已独立发布
```

### 技术实现要点

| 模块 | 变更内容 |
|------|---------|
| 资源元数据 | 新增 `dependencies[]` 字段（`id`, `type`, `required`, `description`） |
| `upload_resource` | 上传完成后执行两项检测：① 分析批量上传资源间的互相依赖；② 与 CSP 已有资源进行相似度对比（名称、类型、内容哈希），发现重复时通知用户并提供内容对比选项 |
| `manage_subscription` | 订阅/取消时递归处理依赖链；弱依赖询问用户确认 |
| `sync_resources` | 支持批量同步依赖资源 |
| AI-Resources 仓库 | 各资源 `metadata.yaml` 补充依赖声明 |
| 依赖分析引擎 | 新增 `DependencyAnalyzer` 模块，提供：批量依赖扫描、依赖摘要生成 |
| 相似资源检测器 | 新增 `DuplicateDetector` 模块（独立于依赖分析），提供：名称相似度匹配、同类型资源语义对比、内容哈希完全重复检测、按需拉取已有资源做逐行 diff |

---

## 需求二：自定义工作流系统

### 背景

当前开发者在 Cursor 中使用 AI 能力时，需要手动知道"何时用哪个工具"。缺乏结构化引导，导致：
- 工具使用不系统，遗漏关键步骤
- 团队工作方式不统一
- 无法将最佳实践沉淀为可复用的流程

参考 OpenClaw（opclaw）的 Skill 组装方式，可以将固定流程、OpenSpec 和其他 Tools 组装成新的工作流，并统一下发到 Team 的 Cursor 环境。

### 2.1 工作流数据模型

工作流由**节点（Node）** 和**边（Edge）** 构成，支持有向图（含显式回退边）。

#### 节点类型

| 类型 | 标识 | 说明 |
|------|------|------|
| 入口节点 | `entry` | 工作流唯一起点，绿色标识 |
| 步骤节点 | `step` | 执行阶段，绑定 Rules / Skills / MCPs / Commands |
| 决策节点 | `decision` | 条件判断，可引出多条出边（正向/条件/拒绝） |
| 结束节点 | `end` | 工作流终点，紫色标识 |

#### 边类型（连线属性）

边通过**连线属性弹窗**设置，支持 4 种类型：

| 类型 | 颜色 | 线型 | 含义 |
|------|------|------|------|
| `next`（正向） | 蓝色 | 实线 | 正常流程推进 |
| `back`（回退） | 黄色 | 虚线 | 回退到前序节点 |
| `condition`（条件） | 绿色 | 实线 | 满足特定条件时推进（决策节点常用） |
| `reject`（拒绝） | 红色 | 虚线 | 审查不通过、任务失败时的分支 |

边还支持设置**标签**（如"通过"、"返工"），在画布连线中间显示。

#### 节点资源绑定

每个节点可绑定四类资源：

```
Rules    → 约束 AI 行为的规则文件（.mdc）
Skills   → Agent Skill，提供特定领域能力
MCPs     → MCP Server 工具，提供外部系统接入能力
Commands → 具体可执行命令（如 openspec archive、npm publish）
```

#### 工作流 JSON Schema

```json
{
  "id": "dev-workflow-standard",
  "name": "标准开发工作流",
  "version": "1.0",
  "status": "active",
  "nodes": [
    {
      "id": "t1",
      "type": "entry",
      "title": "需求调研",
      "desc": "理解需求、分析技术背景",
      "x": 240,
      "y": 30,
      "resources": [],
      "prompts": ["分析当前需求，梳理技术方案和背景"]
    },
    {
      "id": "t2",
      "type": "step",
      "title": "方案设计",
      "desc": "创建 OpenSpec 提案",
      "x": 240,
      "y": 175,
      "resources": [
        {"id": "openspec-mcp", "type": "mcp", "name": "OpenSpec MCP"},
        {"id": "openspec-rule", "type": "rule", "name": "OpenSpec Rule"}
      ],
      "prompts": ["创建 OpenSpec 提案，描述变更内容和影响范围"]
    },
    {
      "id": "t4",
      "type": "decision",
      "title": "代码审查",
      "desc": "审查通过则发布，否则返工",
      "x": 240,
      "y": 470,
      "resources": [
        {"id": "code-review-skill", "type": "skill", "name": "Code Review Skill"},
        {"id": "gitlab-mcp", "type": "mcp", "name": "GitLab MCP"}
      ],
      "prompts": ["执行代码审查，检查安全性、正确性和规范性"]
    }
  ],
  "edges": [
    {"from": "t1", "to": "t2", "type": "next",      "fromPort": "s", "toPort": "n", "label": ""},
    {"from": "t4", "to": "t5", "type": "condition",  "fromPort": "s", "toPort": "n", "label": "通过"},
    {"from": "t4", "to": "t3", "type": "back",       "fromPort": "e", "toPort": "e", "label": "返工"}
  ]
}
```

**节点坐标说明：** `x`/`y` 为节点在画布上的绝对像素位置。无坐标时，编辑器自动执行拓扑排序布局（Kahn 算法分层）。

---

### 2.2 工作流管理平台（页面设计）

平台分为两个页面，通过 `localStorage` 共享工作流数据，`sessionStorage` 传递当前编辑 ID。

#### 页面一：工作流列表（`workflow-list.html`）

**功能概览：**

```
┌─────────────────────────────────────────────────┐
│  CSP Agent  工作流管理              [+ 新建工作流] │
├─────────────────────────────────────────────────┤
│  工作流  (3个)              [🔍 搜索工作流名称...]  │
│  [全部] [已发布] [草稿] [已归档]                   │
├─────────────────────────────────────────────────┤
│  ┌─────────────────────┐  ┌─────────────────────┐│
│  │ 标准开发工作流  [已发布]│  │ Bug 修复工作流 [已发布]││
│  │ 覆盖需求调研、方案设计..│  │ 快速定位问题、修复并验..││
│  │ ⬡ 5节点 → 5连线       │  │ ⬡ 4节点 → 4连线       ││
│  │ [入口]›[设计]›[编码]›..│  │ [入口]›[修复]›[验证]›..││
│  │ openspec-mcp +2个资源 │  │ security-rule +1个资源 ││
│  │ 更新于 1天前            │  │ 更新于 3小时前          ││
│  │ [复制][归档][删除][编辑→]│  │ [复制][归档][删除][编辑→]││
│  └─────────────────────┘  └─────────────────────┘│
└─────────────────────────────────────────────────┘
```

**卡片信息规格：**

| 区域 | 内容 |
|------|------|
| 顶部 | 工作流名称 + 状态徽章（已发布 / 草稿 / 已归档） |
| 描述 | 工作流描述文字 |
| 元信息 | 节点数 / 连线数 / 绑定资源数 / 版本号 |
| 节点预览条 | 前 4 个节点用小圆点+名称展示（彩色点区分类型），超出显示 "+N" |
| 资源标签 | 所有节点绑定资源去重后的 chip 展示（最多 6 个） |
| 底部操作 | 复制 / 发布或归档 / 删除（带二次确认弹窗） / 编辑 → |

**筛选与搜索：**
- 状态筛选 Tab：全部 / 已发布 / 草稿 / 已归档
- 实时搜索：按名称和描述过滤
- 列表按 `updatedAt` 降序排列

**工作流状态流转：**

```
draft（草稿）
  ↓ [发布]
active（已发布）
  ↓ [归档]
archived（已归档）
  ↓ [恢复]
draft（草稿）
```

**数据存储：** `localStorage['csp_workflows']`（JSON 数组，包含完整工作流定义）

---

#### 页面二：工作流编辑器（`workflow-builder.html`）

**整体布局（三栏）：**

```
┌──────────┬────────────────────────────────┬──────────┐
│ 资源库    │         工作流画布              │ 节点配置  │
│ (252px)  │                                │ (272px)  │
│          │  [←工作流列表] CSP Agent        │          │
│ [🔍搜索] │  [名称输入框]  [保存][导出][发布]│          │
│          │                                │          │
│ 全部 Rule│   ╔═══════╗  ╔═══════╗         │ 节点类型  │
│ Skill MCP│   ║ 入口  ║→ ║ 步骤  ║         │ 名称/描述 │
│          │   ╚═══════╝  ╚═══════╝         │          │
│ ┌──────┐ │       ↓          ↓             │ Rules    │
│ │Rule  │ │   ╔═══════╗  ╔═══════╗         │ Skills   │
│ │  拖  │ │   ║ 决策  ║  ║ 结束  ║         │ MCPs     │
│ └──────┘ │   ╚═══════╝  ╚═══════╝         │ Commands │
│          │                                │ Prompts  │
│ ┌──────┐ │   [选择/连线]                   │ 连线说明  │
│ │Skill │ │                                │          │
│ └──────┘ │                                │          │
└──────────┴────────────────────────────────┴──────────┘
│ 节点: 5  连线: 5  绑定资源: 8                         │
```

**左侧：资源库面板**

- 搜索框（实时过滤名称 + 描述）
- 类型 Tab 筛选：全部 / Rule / Skill / MCP / Command
- 资源卡片可拖拽到画布（创建绑定该资源的新节点）或拖拽到已有节点/右侧配置区域

**中间：工作流画布**

顶部工具栏：
- `← 工作流列表`（返回列表页，有未保存修改时询问确认）
- 工作流名称输入框（实时编辑，改动后显示"未保存"）
- `💾 保存`：保存为草稿到 `localStorage`
- `导出 JSON`：输出工作流 JSON 到剪贴板
- `🚀 发布`：状态设为 `active` 并保存

画布操作：

| 操作 | 交互方式 |
|------|---------|
| 新建节点 | 从左侧拖入资源（自动创建 step 节点）/ 点击顶部「+ 节点」按钮 |
| 移动节点 | 鼠标拖拽节点体 |
| 开始连线 | 悬停节点显示 4 个方向端口圆点，点击起始端口 |
| 完成连线 | 点击目标节点的任意端口（支持一对多出边） |
| 设置连线属性 | 点击已有连线，弹出属性面板 |
| 删除连线 | 在连线属性弹窗中点击「🗑 删除连线」 |
| 取消连线 | 按 `Esc` 或点击画布空白区域 |
| 选中节点 | 点击节点体，右侧面板展示配置 |
| 复制节点 | 悬停节点后点击「⧉」按钮 |
| 删除节点 | 悬停节点后点击「✕」按钮 |

节点视觉规范：

| 节点类型 | 边框颜色 | 圆点颜色 |
|---------|---------|---------|
| Entry | 绿色 | 绿色 |
| Step | 蓝色（默认） | 蓝色 |
| Decision | 黄色 | 黄色 |
| End | 紫色 | 紫色 |

**连线属性弹窗（点击连线触发）：**

```
┌──────────────────────┐
│ 连线属性              │
│ [正向][回退][条件][拒绝] │
│ 连线标签（可选）_______ │
│ [🗑 删除连线]    [完成] │
└──────────────────────┘
```

**右侧：节点配置面板**

选中节点后展示，未选中时显示空状态提示：

- 节点类型切换（下拉选）
- 名称 / 描述输入
- Rules / Skills / MCPs / Commands 各分区，支持：
  - 点击「＋ 添加」打开资源选择弹窗（支持搜索 + 类型过滤）
  - 拖拽资源到插槽
  - 点击「✕」移除已绑定资源
- 入口 Prompts：多条，支持添加/删除/编辑
- 连线操作说明（端口颜色含义等）

**资源选择弹窗：**

```
┌─────────────────────────────────────┐
│ 选择资源  绑定到节点「方案设计」  [✕] │
│ [搜索资源名称或描述...]              │
│ [全部][Rule][Skill][MCP][Command]   │
│ ┌──────────────────────────────┐   │
│ │ [MCP] OpenSpec MCP       [＋]│   │
│ │ 管理 OpenSpec 变更提案...    │   │
│ ├──────────────────────────────┤   │
│ │ [Rule] OpenSpec Rule  [已添加]│   │
│ │ OpenSpec 驱动开发流程规范... │   │
│ └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

**自动布局算法：**

加载无坐标的工作流时，自动执行拓扑分层布局：
1. Kahn 算法计算节点层次（入度为 0 的节点为第 0 层）
2. 同层节点水平展开，层间垂直间距 145px
3. 已有有效坐标的节点跳过布局，保留原位

**状态指示（底部状态栏）：**

```
● 就绪  |  节点: 5  |  连线: 5  |  绑定资源: 8
```

---

### 2.3 工作流下发机制

工作流作为新资源类型存储在 AI-Resources 仓库：

```
AI-Resources/
└── csp/
    └── workflow/
        ├── README.md
        ├── dev-workflow-standard/
        │   ├── workflow.json       # 完整工作流定义（含节点、边、资源绑定）
        │   └── metadata.yaml       # 元数据（名称、描述、版本、状态、适用团队）
        └── hotfix-workflow/
            ├── workflow.json
            └── metadata.yaml
```

**metadata.yaml 规范：**

```yaml
id: dev-workflow-standard
name: 标准开发工作流
version: 1.0
status: active           # draft / active / archived
description: 适用于日常功能开发的标准流程
author: elliotding
updatedAt: 2026-03-10T00:00:00Z
teams:                   # 适用范围（空表示全团队）
  - csp-backend
dependencies:            # 工作流依赖的资源（订阅工作流时自动联动订阅）
  - id: openspec-mcp
    type: mcp
  - id: code-review-skill
    type: skill
  - id: security-rule
    type: rule
```

**订阅行为：**
- 用户通过 `manage_subscription` 订阅工作流时，自动触发联动订阅 `dependencies` 中列出的所有资源（见需求一 1.2）
- `sync_resources` 支持 `workflow` 资源类型，同步时拉取 `workflow.json` 到本地

---

### 2.4 工作流引擎（Cursor 侧）

**MCP Tool：`navigate_workflow`**

推进或回退工作流状态：

```typescript
interface NavigateWorkflowParams {
  workflow_id: string;
  action: 'start' | 'next' | 'back' | 'jump';
  target_node_id?: string;  // jump 时必填
  branch?: string;          // decision 节点选择分支时填写（如 'approved'/'rejected'）
}

interface NavigateWorkflowResult {
  current_node: WorkflowNode;
  entry_prompt: string;           // 当前节点入口 Prompt
  recommended_tools: Resource[];  // 当前节点绑定的资源列表
  next_nodes: WorkflowNode[];     // 可达的下一节点
  back_nodes: WorkflowNode[];     // 可回退的节点
}
```

**MCP Tool：`get_workflow_status`**

查询当前工作流执行状态：

```typescript
interface GetWorkflowStatusParams {
  workflow_id: string;
}

interface GetWorkflowStatusResult {
  workflow_name: string;
  current_node_id: string;
  current_node_title: string;
  progress: number;          // 0.0 ~ 1.0（基于已完成节点数 / 总节点数）
  unsubscribed_resources: Resource[];  // 当前节点所需但未订阅的资源
}
```

**主动提醒行为：**

| 时机 | AI 行为 |
|------|---------|
| 进入节点 | 输出节点入口 Prompt + 推荐工具列表 |
| 发现未订阅资源 | 主动提示并询问是否联动订阅（接入需求一） |
| 节点完成 | 提示「下一步是 [节点名]，需要使用 [工具列表]」 |
| 用户回退 | 说明当前回到哪个阶段，重新激活该节点的入口 Prompt |

**节点状态持久化：** 工作流执行状态（当前节点 ID、已完成节点集合）保存在会话上下文中，跨消息保持。

---

### 2.5 内置基础工作流

系统预置以下工作流模板（对应列表页 Demo 数据）：

| 工作流 | 节点数 | 适用场景 |
|--------|--------|---------|
| 标准开发工作流 | 5（需求调研→设计→编码→审查→发布） | 日常功能开发 |
| Bug 修复工作流 | 4（定位→修复→验证→上线） | 线上紧急问题处理 |
| Code Review 工作流 | 5（提交MR→自动检查→审查→判断→合并） | PR 审查流程 |

---

### 技术实现要点

| 模块 | 变更内容 |
|------|---------|
| `HTML-Page/workflow-list.html` | 工作流列表页（✅ 已实现 Demo） |
| `HTML-Page/workflow-builder.html` | 工作流编辑器页（✅ 已实现 Demo） |
| `localStorage['csp_workflows']` | 工作流本地存储（✅ 已实现，JSON 数组） |
| 资源类型扩展 | 新增 `workflow` 类型，扩展 `sync_resources` 资源加载器 |
| 工作流引擎 | 新增 `workflow-engine` 模块，管理节点状态与分支逻辑 |
| MCP Tool | 新增 `navigate_workflow`：推进/回退/跳转工作流节点 |
| MCP Tool | 新增 `get_workflow_status`：查询当前节点和推荐操作 |
| AI-Resources | 新增 `csp/workflow/` 目录，存储工作流 JSON + metadata |
| `sync_resources` | 支持同步 `workflow` 类型资源 |
| 自动布局 | `autoLayout()`：Kahn 拓扑排序，为无坐标节点自动分配画布位置 |

---

## 需求优先级与实施顺序

```
Phase 1（基础设施）:
  ├─ 1.1 资源依赖关系元数据定义
  └─ 1.2 联动订阅/卸载逻辑

Phase 2（工作流平台页面）:  ← 当前 Demo 已覆盖
  ├─ 2.1 工作流列表页（workflow-list.html）
  ├─ 2.2 工作流编辑器页（workflow-builder.html）
  └─ 2.3 localStorage 数据持久化

Phase 3（工作流存储与下发）:
  ├─ 3.1 AI-Resources csp/workflow/ 目录与 Schema 规范
  ├─ 3.2 sync_resources 支持 workflow 类型
  └─ 3.3 manage_subscription 联动订阅工作流依赖资源

Phase 4（工作流引擎）:
  ├─ 4.1 MCP Tool: navigate_workflow
  ├─ 4.2 MCP Tool: get_workflow_status
  └─ 4.3 节点状态持久化（会话上下文）

Phase 5（智能提醒）:
  ├─ 5.1 节点入场提醒（入口 Prompt + 推荐工具）
  ├─ 5.2 节点完成提醒（下一步操作引导）
  └─ 5.3 未订阅资源自动检测与联动订阅触发
```

---

## 相关文档

- 现有架构：`Docs/CSP-AI-Agent-Core-Design.md`
- API 规范：`Docs/CSP-AI-Agent-API-Mapping.md`
- 工作流列表页 Demo：`HTML-Page/workflow-list.html`
- 工作流编辑器 Demo：`HTML-Page/workflow-builder.html`
