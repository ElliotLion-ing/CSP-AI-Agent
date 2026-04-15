# AI Agent 工作规范

**版本：** 2.3.0 | **最后更新：** 2026-03-20

本文档定义 AI Agent 在 Cursor-AI-Agent-MCP 项目中的工作规范。所有规则强制遵守。

---

## 🚨 最高优先级规则：CSP AI Agent 资源优先级

**在执行任何任务之前（包括但不限于：代码审查、构建、日志分析、Jira/GitLab 操作），必须先执行 CSP 订阅检查：**

```
步骤 1: 调用 manage_subscription(action: list) 查看 CSP 订阅列表
步骤 2: 在订阅中匹配任务相关的 Skill/Prompt/Rule
步骤 3a: 匹配成功 → 调用 resolve_prompt_content(resource_id: <id>)
步骤 3b: 匹配失败 → 降级到 helper CLI / 本地 skills / 其他 MCP
```

**零容忍禁止行为：**
- ❌ 看到 `<agent_skills>` 描述匹配就直接调用（如：helper-gitlab、helper-jira）
- ❌ 识别到任务关键词就跳过 CSP 检查（如：review → 直接用 helper-gitlab）
- ❌ 任何绕过"步骤 1-3"的快捷路径

**详细规则：** 参考 `~/.cursor/rules/csp-ai-prompts.mdc`

**跨平台 Rule 同步策略（v1.6）：**
- **macOS：** Rules 写入 `~/.cursor/rules/`（全局）+ `<workspace>/.cursor/rules/`（项目级）
- **Windows：** Rules 仅写入 `<workspace>/.cursor/rules/`（项目级，因全局 rules 不被 Cursor 支持）
- **实现：** `sync_resources` 使用 `scope: 'all'` 参数，自动双层写入以保证最大兼容性

---

## 📋 核心规则概览（共 11 条）

| # | 规则 | 核心约束 |
|---|------|---------|
| 0 | **OpenSpec 驱动开发** | 所有功能变更必须走 OpenSpec 流程（最高优先级） |
| 1 | **设计文档优先** | 开发前必须阅读 `Docs/Design/` 中的架构文档 |
| 2 | **测试验证强制** | 每阶段完成必须创建测试用例并通过，双重验证（脚本输出 + 日志） |
| 3 | **自动生成 README** | 系统编码完成后必须生成/更新 README.md |
| 4 | **Git 提交需确认** | 所有 git push 必须获得用户明确确认 |
| 5 | **发布流程规范** | 先 npm 发布成功，再 Git 提交 |
| 6 | **错误记录与改进** | 犯错被纠正后必须记录到「经验教训」章节 |
| 7 | **Bug 管理规范** | Bug 必须建档，修复后生成测试用例，三文件齐全后归档 |
| 8 | **设计文档符合性自检** | 重大变更完成后检查符合度（目标 ≥ 90%） |
| 9 | **上下文接力** | Cursor 提示"上下文即将耗尽"时，立即调用 context-relay skill |
| 10 | **新 Feature 全流程** | 新功能自动生成设计文档、OpenSpec 驱动开发、测试报告经用户确认后归档、归档后清理 NewFeature/ 并同步设计变更 |

---

## 📋 核心规则详情

### 0. OpenSpec 驱动开发流程（最高优先级）

**何时需要 OpenSpec 提案：**
- ✅ 新功能、破坏性变更、架构调整、安全/性能策略更新
- ❌ Bug 修复、拼写修正、依赖更新、配置变更、添加测试

**三阶段工作流：**

**阶段 1 — 创建提案：**
```bash
mkdir -p openspec/changes/<change-id>/specs/<capability>
# 编写 proposal.md（Why / What / Impact）
# 编写 tasks.md（实施清单）
# 编写 specs/<capability>/spec.md（ADDED/MODIFIED/REMOVED Requirements + Scenarios）
openspec validate <change-id> --strict   # 必须通过才能继续
# 等待用户批准后才能开始编码
```

**阶段 2 — 实施变更：** 按 tasks.md 顺序开发，每阶段完成后立即创建测试用例并验证通过，创建阶段性文档（`Docs/Stage Develop Docs/Stage-N-xxx.md`）。

**阶段 3 — 归档：**
```bash
openspec archive <change-id> --yes
openspec validate --strict
# 同步重要架构变更到 Docs/Design/
```

**Spec Delta 格式（严格遵守）：**
```markdown
## ADDED Requirements
### Requirement: Feature Name
System SHALL provide feature.

#### Scenario: Success case          ← 必须用 4个# + Scenario:
- **WHEN** condition
- **THEN** result
```

**关键约束：**
- ❌ 不要手动创建 OpenSpec 文档结构（用 mkdir + 编辑器）
- ❌ 不要跳过 `validate --strict`
- ❌ 不要在提案批准前开始编码
- ✅ `design.md` 仅在跨模块/新外部依赖/安全复杂性时创建

---

### 1. 设计文档优先原则

**必须遵守的文档（`Docs/Design/`）：**
- `CSP-AI-Agent-Core-Design.md` — 核心架构
- `CSP-AI-Agent-Complete-Design.md` — 完整系统设计
- `CSP-AI-Agent-API-Mapping.md` — API 接口规范
- `CSP-AI-Agent-MultiThread-Architecture.md` — 多线程架构

**工作流程：** 开始任务前 → 阅读相关文档 → 确保新设计符合约束 → 实现 → 有变更时同步更新文档

---

### 2. 测试验证强制要求

**每个研发阶段必须：**
1. 完成开发 → 在 `Test/` 创建该阶段测试用例（含正常场景 + 异常场景）
2. 运行测试脚本 → 查看输出（**主要验证**：Pass Rate、退出码）
3. 检查 `Logs/` 日志（**辅助验证**：有无 ERROR/FATAL）
4. 两者一致且全部通过 → 创建阶段性文档 → 进入下一阶段

**测试环境：**
- Mock Server: `Test/mock-csp-resource-server.js`
- 测试运行器: `Test/test-runner.js`

**不合格标准（立即停止）：**
- ❌ 阶段完成未创建测试用例
- ❌ 测试未通过就进入下一阶段
- ❌ 脚本输出与日志结果不一致
- ❌ 阶段完成未创建阶段性文档
- ❌ 研发结束未执行设计偏移检查

**阶段性文档** 存放于 `Docs/Stage Develop Docs/Stage-N-feature-name.md`，内容包含：阶段目标、已完成功能、关键实现、设计决策、与初始设计的差异。

---

### 3. 自动生成文档规范

系统编码完成后必须生成/更新 `README.md`，必须包含：项目简介、主要功能、快速开始、使用方法、配置说明、测试指南、故障排除。

---

### 4. Git 提交控制规范

**提交前必须展示给用户确认（`git status` + `git diff`），禁止自动推送。**

- **项目代码仓库：** `https://github.com/ElliotLion-ing/CSP-AI-Agent`
- **目标分支：** `main`（直接推送到 main，禁止推送到其他分支再手动合并）
- `AI-Resources/`、`.cursor/` 目录已在 `.gitignore` 排除，禁止提交

**提交信息规范：** `<type>: <subject>`（feat / fix / docs / refactor / test / chore）

**提交前检查清单：**
```
□ 所有测试通过
□ README.md 已更新
□ 无敏感信息（密钥、密码）
□ .gitignore 已排除不应提交的目录
□ 用户已明确确认
□ 目标仓库地址正确
□ 目标分支为 main
```

---

### 5. 发布流程规范

**顺序：npm 发布 → 验证 → Git 提交（不可颠倒）**

```bash
# Step 1: npm 发布（需用户确认）
cd SourceCode && npm run build && npm publish --access public

# Step 2: 验证发布
npm view @elliotding/ai-agent-mcp@<version>

# Step 3: Git 提交（仅在 npm 成功后，需用户确认）
git add . && git commit -m "..." && git push origin main
```

- ❌ npm 发布失败不得执行 Git 提交
- ❌ 未经用户确认不得发布或提交
- 版本号遵循语义化版本：MAJOR.MINOR.PATCH

---

### 6. 错误记录与持续改进

每次犯错被纠正后，在「📚 经验教训记录」章节添加：

```
#### 错误 ID: ERR-YYYY-MM-DD-序号
- 错误描述 / 发生时间 / 错误原因 / 正确做法 / 预防措施 / 相关规则
```

---

### 7. Bug 管理规范

**目录结构：**
```
Bug/
├── BUG-YYYY-MM-DD-序号-简短标题/   # 活跃 Bug
│   ├── bug-description.md          # 必须在修复前创建（含描述+复现步骤）
│   ├── fix-solution.md             # 必须在归档前完成（含根因+方案+修改文件）
│   └── test-result.md              # 测试通过后写入（含脚本输出+日志摘要）
└── Fixed Bugs/                     # 归档区（只读）
    └── BUG-xxx/                    # 整个文件夹移入，三文件缺一不可
```

**完整流程（10 步）：**
1. 建文件夹 → 2. 写 `bug-description.md` → 3. 分析修复代码 → 4. 写 `fix-solution.md` → 5. 在 `Test/` 生成专属测试用例（`test-bug-BUG-xxx.js`）→ 6. 运行测试（双重验证）→ 7. 写 `test-result.md` → 8. 三文件齐全后整体移入 `Bug/Fixed Bugs/`

**测试文件命名：** `Test/test-bug-BUG-YYYY-MM-DD-序号.js`

**归档条件（三文件缺一不可）：**
- `bug-description.md` + `fix-solution.md` + `test-result.md`（Pass Rate 100%）

**禁止：** 未生成测试就归档 / 测试未通过就归档 / 归档时缺少 `test-result.md` / 归档后修改 `Fixed Bugs/` 内容

---

### 8. 设计文档符合性自检

**触发时机：** 重大功能开发完成后、OpenSpec 归档前

**四项检查（符合度目标 ≥ 90%）：**

| 检查项 | 验证内容 |
|--------|---------|
| 核心架构 | 模块结构、关键模块存在、核心接口是否按设计实现 |
| 多线程架构 | 使用异步模式、HTTP Server 并发支持、无同步阻塞调用 |
| 日志规范 | 使用 pino logger、无 `console.log`、结构化字段、敏感信息脱敏 |
| API 使用 | 端点与 `API-Mapping.md` 一致、认证实现正确 |

**处理结果：**
- 符合度 ≥ 90%：更新设计文档反映实际实现，继续归档流程
- 符合度 < 90%：必须修复偏移后重新检查，禁止带偏移归档

---

### 9. 上下文接力规范

**触发条件：** Cursor 系统显示「上下文即将耗尽」警告

**执行：** 立即调用 `~/.cursor/skills/context-relay/SKILL.md` 中定义的 context-relay skill，保存进度到 `{workspace}/.cursor/context-relay/handoff.md`

- ❌ 收到警告但未调用 skill → 违规
- ❌ 手动编写接力逻辑而非使用 skill → 违规

---

### 10. 新 Feature 全流程开发规范

**触发条件：** 用户提出新功能需求（关键词：新增 feature、新功能、实现…功能等）

**目录结构：**
```
NewFeature/FEAT-YYYY-MM-DD-序号-简短标题/
└── feature-design.md           # 活跃中的设计文档

Docs/FeatureDocs/FEAT-xxx/
└── feature-design.md           # 归档后移入

Test/Test Reports/FEAT-xxx/
└── test-report.md              # 测试报告归档
```

**完整流程（强制按序）：**
```
1. 自动在 NewFeature/ 创建文件夹并生成 feature-design.md
   （含：背景、需求描述、技术方案、API 设计、影响范围）
   ↓
2. 等待用户确认设计文档（不得跳过）
   ↓
3. 创建 OpenSpec 提案 → validate --strict → 等待批准
   ↓
4. 按阶段开发（遵循规则 #2 测试验证要求）
   ↓
5. 完整测试通过 → 生成 test-report.md → 展示给用户确认
   ↓
6. 用户确认后执行归档：
   a. openspec archive <change-id> --yes
   b. 同步更新 Docs/Design/ 三个核心文档（见下表）
   c. 复制 NewFeature/FEAT-xxx/ → Docs/FeatureDocs/FEAT-xxx/
   d. 移动 test-report.md → Test/Test Reports/FEAT-xxx/
   e. 删除 NewFeature/FEAT-xxx/ 文件夹（归档后必须清理）
   ↓
7. 询问用户是否 npm 发布和 Git 提交
```

**设计变更同步规则（强制）：**

若用户在 Feature 开发期间或归档前提出设计修改或新增需求：
1. **立即更新** `NewFeature/FEAT-xxx/feature-design.md`，反映最新设计
2. 若已进入实施阶段，同步评估是否影响 OpenSpec 提案（需要时更新 `tasks.md` 或重新 validate）
3. 若已归档到 `Docs/FeatureDocs/`，**同时更新归档文件**，保持两处一致
4. 修改设计后需在 feature-design.md 顶部更新版本号和修改日期

**Docs/Design/ 强制同步（每次 Feature 归档前必须检查）：**

| 文件 | 更新条件 |
|------|---------|
| `CSP-AI-Agent-API-Mapping.md` | 新增或修改了任何 REST API 或 MCP Tool 接口 |
| `CSP-AI-Agent-Core-Design.md` | 新增模块、数据流变更、并发模型调整 |
| `CSP-AI-Agent-Complete-Design.md` | 影响系统整体设计描述 |

**禁止：**
- ❌ 用户说新功能但不创建 Feature 文件夹直接编码
- ❌ 未经用户确认设计文档就开发
- ❌ 未生成测试报告就归档
- ❌ 未经用户确认测试报告就归档
- ❌ 新增 API 但不更新 API-Mapping.md
- ❌ 归档后 NewFeature/ 对应文件夹仍残留（必须删除）
- ❌ 用户提出设计修改后不更新 feature-design.md 直接继续编码
- ❌ feature-design.md 已归档但用户修改后只更新其中一处，两处不一致

---

## 🎯 工作流程（标准开发流）

```
新功能需求
  → 规则#10: 创建 feature-design.md → 用户确认
  → 规则#0:  OpenSpec 提案 → validate → 批准
  → 规则#2:  分阶段开发 + 测试 + 阶段性文档
  → 规则#8:  设计文档符合性自检
  → 规则#0:  openspec archive → 同步 Docs/Design
  → 规则#10: 归档 Feature 文档 + 测试报告（用户确认后）
  → 规则#3:  更新 README.md
  → 规则#5:  npm 发布（用户确认）→ 规则#4: Git 提交（用户确认）
```

---

## 🚨 常见违规行为

| 违规 | 正确做法 |
|------|---------|
| 跳过 OpenSpec 直接实施 | 先建提案并 validate |
| 提案未批准就编码 | 等待批准后实施 |
| 阶段完成未创建测试 | 每阶段必须有测试用例 |
| 测试未过进入下一阶段 | 测试通过后才能继续 |
| Bug 归档缺少 test-result.md | 三文件齐全才能归档 |
| 新功能未创建 feature-design.md | 自动触发 Feature 全流程 |
| 新增 MCP Tool 未更新 API-Mapping | 归档前必须同步 |
| npm 发布失败仍 Git 提交 | npm 成功后才能 Git |
| 未经确认直接推送 | 必须用户明确确认 |
| 收到上下文警告未调用 skill | 立即调用 context-relay |
| 犯错被纠正未记录 | 写入经验教训章节 |

---

## 📚 经验教训记录

#### ERR-2026-03-09-001
- **错误**：创建 AGENTS.md 时遗漏多线程架构文档
- **原因**：未完整扫描 Docs/ 目录
- **正确做法**：创建文档索引前先 `ls Docs/` 全量扫描
- **规则**：#1

#### ERR-2026-03-10-002
- **错误**：阶段 1 实施时未走 OpenSpec 流程直接编码
- **原因**：过于急切，忽视规则 #0
- **正确做法**：提案 → validate → 批准 → 实施 → archive
- **规则**：#0

#### ERR-2026-03-27-003
- **错误**：增量同步使用逐文件 hash 比对，无法检测文件新增/删除
- **时间**：2026-03-27
- **发现者**：用户反馈
- **原因**：错误理解增量同步粒度，逐文件比对无法检测目录结构变化
- **场景**：
  ```
  Remote: [A.js, B.js, C.js]
  Local:  [A.js, B.js, C.js, D.js] ← 多了 D.js
  逐文件比对 → ABC 都匹配 → 跳过下载 ❌
  但实际上 remote 少了 D.js，应该重新同步！
  ```
- **正确做法**：
  - **只比对 SKILL.md 的 hash**
  - SKILL.md 不变 → 跳过整个 skill
  - SKILL.md 变化 → 重新下载所有脚本文件
- **原理**：SKILL.md 是 skill 的"版本标识符"，任何脚本变更都应在 SKILL.md 中体现
- **预防措施**：增量同步永远以"资源级别"为粒度，不以"文件级别"为粒度
- **相关规则**：#2（测试验证强制）

---

## 📁 项目目录说明

```
SourceCode/         TypeScript 源代码（npm 发布此目录）
Test/               测试代码、Mock Server、测试报告
  Test Reports/     Feature 测试报告归档（FEAT-xxx/test-report.md）
Bug/                Bug 档案库
  Fixed Bugs/       已归档 Bug（只读）
Docs/
  Design/           整体架构设计文档（持续同步更新）
  FeatureDocs/      归档的 Feature 设计文档
  Stage Develop Docs/  初期开发阶段文档（历史）
NewFeature/         进行中的 Feature 设计文档（归档后清空）
openspec/           OpenSpec 变更管理
  changes/          活跃变更提案
  specs/            当前能力规格（真实状态）
Publish/            发布脚本
Logs/               运行日志
```

---

## 🔧 特殊规则补充

**代码质量：**
- C++ 代码必须符合 C++20 标准，优先使用现代语法
- 每次代码改动后检查内存泄漏和崩溃风险
- 代码注释用英文，与用户交流用中文

**多线程架构：**
- 必须使用多线程/异步架构，禁止单线程阻塞
- 读操作响应 < 100ms，写操作 < 2s，支持 ≥ 50 并发

**安全基线：** 参考 `.cursor/rules/security-security-baseline.mdc`

---

## 🔗 OpenSpec 快速参考

```bash
openspec spec list --long          # 查看现有能力
openspec list                      # 查看活跃变更
openspec validate <id> --strict    # 验证提案
openspec archive <id> --yes        # 归档变更
```

**常见错误：**
| 错误 | 原因 | 解决 |
|------|------|------|
| "Change must have at least one delta" | 缺少 spec 文件 | 创建 `specs/<cap>/spec.md` |
| "Requirement must have at least one scenario" | 缺少 Scenario | 添加 `#### Scenario: Name` |
| "Silent scenario parsing failures" | Scenario 格式错 | 用 `#### Scenario:` 不是 `**Scenario:**` |

---

## 🚀 OpenSpec 与 @Docs 的关系

```
Docs/Design/ (整体架构，持续更新)
   ↓ 指导
OpenSpec changes/ (变更提案，功能级)
   ↓ 实施并归档后
OpenSpec specs/ (当前能力规格)
   ↓ 重要架构变更同步回
Docs/Design/
```

---

**重要提示（版本历史精要）：**
- v1.1.0: OpenSpec 驱动开发成为最高优先级
- v1.2.0: Git 提交强制用户确认
- v1.3.x: 双重测试验证机制 + 阶段性测试强制
- v1.4.0: 阶段性文档 + 设计偏移检查
- v1.5.0: 设计文档符合性自检（≥90%）
- v1.7.0-v1.8.1: 上下文接力规范（context-relay skill）
- v1.9.0: Bug 管理规范
- v2.0.0: Bug 测试用例强制（三文件归档）
- v2.1.0: Bug 归档三文件缺一不可
- v2.2.0: 新 Feature 全流程开发规范（规则 #10）
- v2.3.0: 规则 #10 补充——归档后必须删除 NewFeature/ 对应文件夹；用户设计变更时必须同步更新 feature-design.md，归档版本与 NewFeature 版本保持一致
