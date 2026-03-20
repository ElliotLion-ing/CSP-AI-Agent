# AI Agent 工作规范

本文档定义了 AI Agent 在 Cursor-AI-Agent-MCP 项目中的工作规范和约束条件。所有 AI Agent 在处理任务时必须遵守以下规则。

---

## 📋 核心规则概览

本项目定义了 9 条核心规则，按优先级排序：

0. **OpenSpec 驱动开发流程** - 所有功能变更必须通过 OpenSpec 流程（最高优先级）
1. **设计文档优先原则** - 所有设计基于 @Docs 中的架构文档
2. **测试验证强制要求** - 所有代码必须通过 @Test 验证，结果通过脚本输出和 @Logs 日志双重验证
3. **自动生成文档规范** - 系统完成后必须生成 README.md
4. **Git 提交控制规范** - 所有提交必须获得用户确认
5. **发布流程规范** - npm 发布成功后再进行 Git 代码提交
6. **错误记录与持续改进** - 所有错误必须记录和学习
7. **Bug 管理规范** - 所有 Bug 必须在 `Bug/` 目录建档；修复后生成专属测试用例并运行，测试结果写入 `test-result.md`，验证通过后归档到 `Bug/Fixed Bugs/`

**重要补充规则：**
8. **设计文档符合性自检** - 重大变更完成后必须执行四项设计文档符合性检查（符合度 >= 90%）
9. **上下文接力规范** - 当上下文即将耗尽时，必须使用 context-relay skill 保存进度并无缝接力

---

## 📋 核心规则

### 0. OpenSpec 驱动开发流程（最高优先级）

**规则描述：**
- 所有功能变更、架构调整、新增能力都必须通过 OpenSpec 流程驱动
- 使用 OpenSpec CLI 命令创建和管理变更提案，不得手动创建 OpenSpec 规格文档
- OpenSpec 中的设计必须遵循 `@Docs` 中的整体架构设计
- 每次 `openspec archive` 后，必须同步更新 `@Docs` 中的相关文档

**OpenSpec 三阶段工作流：**

#### 阶段 1: 创建变更提案（Creating Changes）

**何时创建提案：**
- ✅ 添加新功能或能力
- ✅ 破坏性变更（API、数据结构）
- ✅ 架构或设计模式变更
- ✅ 性能优化（改变行为）
- ✅ 安全模式更新

**无需提案的情况：**
- ❌ Bug 修复（恢复预期行为）
- ❌ 拼写、格式、注释修正
- ❌ 依赖更新（非破坏性）
- ❌ 配置变更
- ❌ 为现有行为添加测试

**标准工作流程：**
```bash
# 1. 探索当前状态
openspec spec list --long          # 查看现有能力
openspec list                      # 查看活跃变更
rg -n "Requirement:" openspec/specs  # 全文搜索（可选）

# 2. 选择唯一的 change-id（kebab-case，动词开头）
CHANGE=add-user-authentication

# 3. 搭建目录结构（使用 OpenSpec 命令，不要手动创建）
mkdir -p openspec/changes/$CHANGE/specs/auth

# 4. 创建 proposal.md
cat > openspec/changes/$CHANGE/proposal.md << 'EOF'
# Change: Add User Authentication

## Why
Users need secure login to access protected resources.

## What Changes
- Add JWT-based authentication
- Implement login/logout endpoints
- Add user session management

## Impact
- Affected specs: auth, user-management
- Affected code: SourceCode/src/auth/, SourceCode/src/middleware/
EOF

# 5. 创建 tasks.md
cat > openspec/changes/$CHANGE/tasks.md << 'EOF'
## 1. Implementation
- [ ] 1.1 Design database schema
- [ ] 1.2 Implement auth endpoints
- [ ] 1.3 Add JWT middleware
- [ ] 1.4 Write tests
EOF

# 6. 创建 spec deltas（必须包含 Scenario）
cat > openspec/changes/$CHANGE/specs/auth/spec.md << 'EOF'
## ADDED Requirements
### Requirement: JWT Authentication
The system SHALL provide JWT-based authentication.

#### Scenario: Successful login
- **WHEN** user provides valid credentials
- **THEN** system returns JWT token
- **AND** token is valid for 24 hours
EOF

# 7. 验证提案（必须通过才能继续）
openspec validate $CHANGE --strict

# 8. 等待批准（不得在批准前开始实施）
```

**关键约束：**
- ❌ 不要手动创建 OpenSpec 文档结构
- ❌ 不要跳过 `openspec validate --strict` 验证
- ❌ 不要在提案批准前开始实施
- ✅ 使用 OpenSpec CLI 命令管理变更
- ✅ 每个 Requirement 必须至少有一个 Scenario
- ✅ 使用正确的格式：`#### Scenario: Name`

#### 阶段 2: 实施变更（Implementing Changes）

**实施步骤（按顺序执行）：**
1. **阅读 proposal.md** - 理解要构建什么
2. **阅读 design.md** - 审查技术决策（如果存在）
3. **阅读 tasks.md** - 获取实施清单
4. **按顺序实施任务** - 逐个完成
5. **确认完成** - 确保 tasks.md 中的每项都已完成
6. **更新清单** - 所有工作完成后，将每个任务标记为 `- [x]`
7. **批准门槛** - 提案未批准前不得开始实施

**必须遵守：**
- ✅ OpenSpec 设计必须符合 `@Docs` 中的架构约束
- ✅ 实施前先验证设计是否违反 `@Docs` 规范
- ✅ 如有冲突，先更新 `@Docs` 获得批准，再继续
- ✅ 实施完成后运行 `@Test` 中的测试验证

**设计冲突处理：**
```
发现 OpenSpec 设计与 @Docs 冲突时：
1. 停止实施
2. 分析冲突原因
3. 评估哪个设计更合理
4. 如需调整 @Docs：
   - 在 OpenSpec 的 design.md 中说明理由
   - 请求批准
   - 批准后同步更新 @Docs
5. 继续实施
```

#### 阶段 3: 归档变更（Archiving Changes）

**归档流程：**
```bash
# 1. 确认部署完成
# 2. 使用 OpenSpec 命令归档（必须显式传递 change-id）
openspec archive add-user-authentication --yes

# 3. 归档会自动：
#    - 移动 changes/[name]/ → changes/archive/YYYY-MM-DD-[name]/
#    - 更新 specs/ 目录（如果能力有变化）
#    - 运行验证检查

# 4. 对于仅工具变更（不影响能力）
openspec archive [change-id] --skip-specs --yes

# 5. 验证归档后的状态
openspec validate --strict
```

**归档后必须执行：**
1. ✅ 检查 `specs/` 目录是否正确更新
2. ✅ 对比归档前后的 `@Docs` 差异
3. ✅ 将 OpenSpec 中的重要架构变更同步到 `@Docs`
4. ✅ 更新 `@Docs` 中受影响的设计文档
5. ✅ 运行完整测试套件验证

**需要同步到 @Docs 的内容：**
- 新的架构模式或组件
- API 接口的重大变更
- 多线程模型的调整
- 安全策略的更新
- 性能优化的设计决策
- 破坏性变更的迁移指南

**同步检查清单：**
```
□ 检查 OpenSpec 归档的 specs/ 变化
□ 识别影响整体架构的变更
□ 更新 Docs/CSP-AI-Agent-Core-Design.md（如有核心架构变更）
□ 更新 Docs/CSP-AI-Agent-Complete-Design.md（如有完整设计变更）
□ 更新 Docs/CSP-AI-Agent-API-Mapping.md（如有 API 变更）
□ 更新 Docs/CSP-AI-Agent-MultiThread-Architecture.md（如有并发模型变更）
□ 在 @Docs 更新日志中记录同步内容
□ 验证文档一致性
```

**OpenSpec 与 @Docs 的关系：**
```
@Docs (整体架构设计)
   ↓ 指导
OpenSpec (变更提案设计)
   ↓ 实施
代码实现
   ↓ 归档后
OpenSpec specs/ 更新
   ↓ 同步
@Docs 更新（如有架构级变更）
```

---

### 1. 设计文档优先原则

**规则描述：**
- `@Docs` 目录存储了整套系统的设计文档和实现细节
- 所有开发、修改、重构工作必须基于 Docs 中的文档进行
- 任何设计决策都不得违背文档中已定义的设计规则和架构约束

**必须遵守的文档：**
- `Docs/CSP-AI-Agent-Core-Design.md` - 核心架构设计
- `Docs/CSP-AI-Agent-Complete-Design.md` - 完整系统设计
- `Docs/CSP-AI-Agent-API-Mapping.md` - API 接口规范
- `Docs/CSP-AI-Agent-MultiThread-Architecture.md` - 多线程架构设计

**工作流程：**
1. **开始任务前**：先阅读相关设计文档，理解现有架构和约束
2. **设计阶段**：确保新设计符合文档规范，不违背已有设计原则
3. **实现阶段**：严格按照文档规范实现功能
4. **完成后**：如有新的设计或架构变更，必须同步更新相关文档

**文档更新要求：**
```
当以下情况发生时，必须更新文档：
- ✅ 新增功能或模块
- ✅ 修改现有架构
- ✅ 变更 API 接口
- ✅ 调整设计规则
- ✅ 纠正设计错误
- ✅ 优化架构方案
```

**违规处理：**
- 如果发现设计违背文档规范，必须立即停止并重新评估
- 如果文档规范不合理，需要先讨论并更新文档，再进行实现
- 所有被纠正的违规设计都要记录在本文档的「经验教训」章节

---

### 2. 测试验证强制要求

**规则描述：**
- `@Test` 目录包含所有测试代码和测试环境
- **每完成一个研发阶段，必须立即在 `@Test` 中创建对应的测试用例**
- 使用 `@Test` 中的测试脚本进行验证，测试通过后方可进入下一阶段
- 测试未通过前，不得认为该阶段完成
- **测试结果必须通过双重验证：**
  1. **主要验证**：Test 脚本或命令行执行的直接输出结果
  2. **辅助验证**：`@Logs` 目录中的日志文件

**测试类型：**
```
必须执行的测试：
1. 单元测试 - 验证单个函数/模块的正确性
2. 集成测试 - 验证模块间交互的正确性
3. API 测试 - 验证接口行为和响应格式
4. 回归测试 - 确保新改动不破坏现有功能
```

**阶段性测试流程（强制要求）：**
1. **每个研发阶段开始前**：明确该阶段的测试目标和验收标准
2. **阶段开发中**：边开发边思考测试场景
3. **阶段开发完成**：
   - ✅ 立即在 `@Test` 目录中创建该阶段的测试用例
   - ✅ 测试用例必须覆盖该阶段的所有核心功能
   - ✅ 测试用例必须包含正常场景和异常场景
4. **运行测试验证**：
   - ✅ 使用 `@Test` 中的测试脚本执行测试
   - ✅ 查看 Test 脚本执行结果（主要验证）
   - ✅ 检查 `@Logs` 中的日志文件（辅助验证）
5. **测试通过后，创建阶段性文档**：
   - ✅ 在 `@Docs` 目录创建阶段性文档（命名：`Stage-[N]-[feature-name].md`）
   - ✅ 记录该阶段完成的功能和实现细节
   - ✅ 记录关键代码实现和设计决策
   - ✅ 记录与初始设计的差异（如有）
6. **测试失败**：分析原因，修复问题，重新测试
7. **阶段验收**：
   - ✅ 确认双重验证一致性
   - ✅ 确认阶段性文档已创建
   - ✅ 该阶段验收完成
   - ✅ 继续下一个研发阶段

**阶段性文档规范：**
```markdown
# Stage [N]: [Feature Name] - 阶段性实现记录

**文档版本：** 1.0  
**创建日期：** YYYY-MM-DD  
**阶段状态：** 已完成/进行中

---

## 📋 阶段目标

- 本阶段计划实现的功能
- 验收标准

## ✅ 已完成功能

1. 功能 1：描述
   - 实现文件：`SourceCode/src/xxx/xxx.js`
   - 关键代码：简要说明
   - 测试用例：`Test/test-xxx.js`

2. 功能 2：描述
   - 实现文件：`SourceCode/src/xxx/xxx.js`
   - 关键代码：简要说明
   - 测试用例：`Test/test-xxx.js`

## 🏗️ 关键实现

### 实现 1: [名称]
```javascript
// 关键代码片段
function example() {
  // 实现逻辑
}
```
**设计说明**：解释实现思路

### 实现 2: [名称]
```javascript
// 关键代码片段
```
**设计说明**：解释实现思路

## 🎯 设计决策

- **决策 1**：为什么这样实现
- **决策 2**：技术选型理由
- **决策 3**：与原设计的差异说明

## ⚠️ 与初始设计的差异

### 差异 1: [描述]
- **原设计**：...
- **实际实现**：...
- **原因**：...
- **影响**：...

### 差异 2: [描述]
- **原设计**：...
- **实际实现**：...
- **原因**：...
- **影响**：...

## 📊 测试情况

- 测试用例数量：X 个
- 测试通过率：100%
- 覆盖的场景：正常场景、异常场景、边界情况

## 🔗 相关文档

- 初始设计文档：`@Docs/CSP-AI-Agent-Complete-Design.md`
- OpenSpec 提案：`openspec/changes/[change-id]/`
- 测试用例：`Test/test-[feature-name]-*.js`

## 📝 备注

- 其他需要说明的内容
```

**研发结束后的设计偏移检查：**
1. **收集所有阶段性文档**：`Docs/Stage-*.md`
2. **对比初始设计文档**：
   - 阅读 `@Docs/CSP-AI-Agent-Complete-Design.md`（或相关设计文档）
   - 阅读 `openspec/changes/[change-id]/design.md`（如有）
3. **检查设计偏移**：
   - ✅ 检查每个阶段文档中的"与初始设计的差异"章节
   - ✅ 汇总所有差异，评估影响范围
   - ✅ 判断差异是否合理（技术原因、需求变更等）
4. **设计偏移处理**：
   - **无偏移或合理偏移**：
     - 更新初始设计文档，反映实际实现
     - 继续后续流程（归档、发布等）
   - **不合理偏移**：
     - 识别偏移的根本原因
     - 评估修复成本和影响
     - **继续执行研发**，修正偏移部分
     - 重新测试和验证
     - 更新阶段性文档
5. **最终验收**：
   - ✅ 所有阶段文档已创建
   - ✅ 设计偏移已检查和处理
   - ✅ 初始设计文档已更新
   - ✅ 可以进入归档和发布流程

**研发阶段与测试用例映射：**
```
示例：MCP Server 开发

阶段 1: 核心框架搭建
├─ 测试用例：
│  ├─ Test/test-framework-init.js          # 框架初始化测试
│  ├─ Test/test-config-loading.js          # 配置加载测试
│  └─ Test/test-basic-connection.js        # 基础连接测试
└─ 阶段性文档：Docs/Stage-1-Framework.md

阶段 2: MCP Tool - sync_resources 实现
├─ 测试用例：
│  ├─ Test/test-sync-resources-normal.js   # 正常同步测试
│  ├─ Test/test-sync-resources-incremental.js  # 增量同步测试
│  └─ Test/test-sync-resources-error.js    # 错误处理测试
└─ 阶段性文档：Docs/Stage-2-SyncResources.md

阶段 3: MCP Tool - manage_subscription 实现
├─ 测试用例：
│  ├─ Test/test-manage-subscription-subscribe.js    # 订阅测试
│  ├─ Test/test-manage-subscription-unsubscribe.js  # 取消订阅测试
│  └─ Test/test-manage-subscription-list.js         # 列表查询测试
└─ 阶段性文档：Docs/Stage-3-ManageSubscription.md

阶段 4: REST API 集成
├─ 测试用例：
│  ├─ Test/test-api-client-get.js          # GET 请求测试
│  ├─ Test/test-api-client-post.js         # POST 请求测试
│  └─ Test/test-api-error-handling.js      # API 错误处理测试
└─ 阶段性文档：Docs/Stage-4-APIIntegration.md

阶段 5: 完整流程测试
├─ 测试用例：
│  ├─ Test/test-integration-full-flow.js   # 完整流程测试
│  ├─ Test/test-integration-concurrent.js  # 并发测试
│  └─ Test/test-integration-recovery.js    # 故障恢复测试
└─ 阶段性文档：Docs/Stage-5-Integration.md
```

**测试用例创建规范：**
```javascript
// Test/test-[feature-name].js
// 示例：Test/test-sync-resources-normal.js

const { describe, it, expect } = require('./test-framework');
const { syncResources } = require('../SourceCode/src/tools/sync-resources');

describe('sync_resources - Normal Flow', () => {
  it('should sync resources successfully', async () => {
    // 准备测试数据
    const params = {
      mode: 'incremental',
      scope: 'global'
    };
    
    const context = {
      userId: 'test-user-001',
      userToken: 'test-token-123'
    };
    
    // 执行测试
    const result = await syncResources(params, context);
    
    // 验证结果
    expect(result.success).toBe(true);
    expect(result.resourceCount).toBeGreaterThan(0);
  });
  
  it('should handle empty subscriptions', async () => {
    // 测试空订阅场景
    const params = { mode: 'full', scope: 'global' };
    const context = { userId: 'test-user-002', userToken: 'test-token-456' };
    
    const result = await syncResources(params, context);
    
    expect(result.success).toBe(true);
    expect(result.resourceCount).toBe(0);
  });
});
```

**测试环境：**
- Mock Server: `Test/mock-csp-resource-server.js`
- 自动化测试: `Test/test-runner.js`
- 快速验证: `Test/test-examples.sh`

**验证清单（双重验证）：**
```bash
# ========== 阶段 1: 运行测试并查看执行结果（主要验证） ==========

# 1. 启动 Mock Server（终端1）
cd Test
node mock-csp-resource-server.js

# 2. 运行自动化测试（终端2）
cd Test
node test-runner.js

# 3. 查看测试脚本输出结果（主要验证点）
# - 检查终端输出的 Pass Rate
# - 查看失败的测试用例
# - 确认测试总数和通过数量
# 预期输出示例：
#   ✅ Test 1/10: sync_resources - PASSED
#   ✅ Test 2/10: manage_subscription - PASSED
#   ...
#   📊 Test Summary: 10/10 passed (100% Pass Rate)

# 或使用快速验证脚本
cd Test
./test-examples.sh
# 查看脚本返回的退出码和输出信息

# ========== 阶段 2: 检查日志文件（辅助验证） ==========

# 4. 查看最新的日志文件
ls -lt logs/app-*.log | head -1

# 5. 查看测试相关的日志条目
grep '"type":"test"' logs/app-$(date +%Y-%m-%d).log | npx pino-pretty

# 6. 查看测试失败的日志
grep '"level":50' logs/app-$(date +%Y-%m-%d).log | grep '"type":"test"'

# 7. 统计测试通过率（与脚本输出对比）
grep '"type":"test"' logs/app-$(date +%Y-%m-%d).log | \
  jq -r 'select(.testResult) | .testResult' | \
  sort | uniq -c

# ========== 阶段 3: 双重验证确认 ==========

# 8. 确认双重验证一致性
# - Test 脚本输出显示 100% Pass Rate
# - Logs 日志无 ERROR/FATAL 级别测试错误
# - 两者结果一致，测试通过 ✅
```

**双重验证要点：**

**主要验证（Test 脚本输出）：**
- ✅ 测试脚本正常执行完成（退出码 0）
- ✅ 终端输出显示所有测试通过
- ✅ Pass Rate 达到 100% 或符合预期
- ✅ 无失败或错误的测试用例
- ✅ 测试摘要信息完整清晰

**辅助验证（Logs 日志文件）：**
- ✅ 所有测试用例的执行日志必须存在
- ✅ 日志中包含完整的测试上下文（用户ID、工具名称、时间戳）
- ✅ 成功的测试有对应的 INFO 级别日志
- ✅ 失败的测试有详细的 ERROR 级别日志（含错误堆栈）
- ✅ 测试耗时和性能指标已记录
- ✅ 日志结果与脚本输出一致

**不合格标准：**
- ❌ 测试覆盖率低于 80%
- ❌ 关键路径未测试
- ❌ 测试用例设计不合理
- ❌ **阶段完成后未创建测试用例**
- ❌ **测试用例未覆盖该阶段核心功能**
- ❌ **测试未通过就进入下一阶段**
- ❌ **阶段完成后未创建阶段性文档**
- ❌ **阶段性文档未记录关键实现**
- ❌ **研发结束后未执行设计偏移检查**
- ❌ **存在不合理设计偏移未修正**
- ❌ 忽略测试失败继续提交
- ❌ Test 脚本输出显示失败
- ❌ 日志中缺少测试执行记录
- ❌ 测试失败但日志无错误信息
- ❌ 脚本输出与日志结果不一致

---

### 3. 自动生成文档规范

**规则描述：**
- 系统代码 coding 完成后，必须自动生成 `README.md` 文档
- README.md 必须描述当前系统的主要功能和使用方法
- 文档内容应清晰、准确、易于理解

**README.md 必须包含的内容：**
```markdown
必须包含的章节：
1. 项目简介 - 系统是什么，解决什么问题
2. 主要功能 - 核心功能列表和简要说明
3. 快速开始 - 安装、配置、运行步骤
4. 使用方法 - 主要使用场景和示例
5. API 文档 - 主要接口说明（如适用）
6. 配置说明 - 重要配置项和环境变量
7. 测试指南 - 如何运行测试
8. 故障排除 - 常见问题和解决方案
9. 贡献指南 - 如何参与开发（可选）
10. 许可证 - 项目许可证信息
```

**生成时机：**
- ✅ 新功能实施完成后
- ✅ 重大架构变更后
- ✅ API 接口修改后
- ✅ 配置项调整后
- ✅ OpenSpec 归档后（如有重要功能变更）

**文档质量要求：**
- 代码示例必须可运行
- 命令必须经过验证
- 配置示例必须完整
- 错误信息必须准确
- 链接必须有效

---

### 4. Git 提交控制规范

**规则描述：**
- 所有代码提交到 Git 仓库前，必须获得用户明确确认
- 不得在用户未确认的情况下自动提交或推送代码
- **项目代码仓库**：`git@github.com:ElliotLion-ing/CSP-AI-Agent.git`（项目开发代码）
- **AI 资源仓库**：`git@git.zoom.us:main/csp.git`（存储 AI 资源，由 mock server 的 finalize 接口负责，不由本脚本处理）

**AI Agent 执行 Git 提交时必须使用发布脚本：**

> **AI Agent 执行项目代码提交时，必须通过 `Publish/git-commit-push.sh`，不得直接调用 `git add .` / `git push`。**
> 原因：项目 git root 是 home 目录（`~/`），直接 `git add .` 会把整个系统的文件纳入提交，非常危险。脚本做了严格的路径隔离。
>
> 用户自己手动执行 git 命令不受此限制。

```bash
# AI Agent 提交项目代码（使用脚本）
cd Publish
./git-commit-push.sh "feat: add auto-sync after subscribe"

# 指定目标分支
./git-commit-push.sh "fix: unsubscribe cleanup" develop
```

**脚本提交的内容（仅限项目代码）：**
```
✅ SourceCode/    — MCP Server TypeScript 源代码
✅ Test/          — 测试脚本和 mock server
✅ Docs/          — 设计文档
✅ Publish/       — 发布脚本（含本脚本）
✅ openspec/      — OpenSpec 变更提案
✅ AGENTS.md      — AI Agent 工作规范
✅ README.md      — 项目说明
✅ .cursor/       — 根目录 Cursor workspace rules

❌ AI-Resources/         — AI 资源文件（由独立 git 仓库管理）
❌ */. cursor/            — 各子目录的 Cursor 本地缓存
❌ Logs/                  — 运行时日志
❌ SourceCode/.env        — 本地密钥配置
❌ SourceCode/node_modules/ — 依赖包
❌ SourceCode/dist/       — 编译产物
```

**脚本自动处理的安全保障：**
- 自动检测 / 添加 remote `git@github.com:ElliotLion-ing/CSP-AI-Agent.git`
- 如果 remote 指向其他仓库，会告警并要求用户确认才能继续
- 自动补全 `.gitignore` 中的排除规则（`AI-Resources/`、`Logs/`、`.env` 等）
- 仅 stage 项目目录内的指定文件，不会影响 home 目录下的其他内容
- 敏感文件检测（`.env`、`.key`、`.pem`、`credentials*` 等）

**Git 操作流程（配合脚本）：**
```bash
# 1. 代码完成并通过测试后
# 2. 生成或更新 README.md
# 3. 向用户展示变更内容（脚本会自动展示 git status）

# 4. 明确询问用户
"我已完成以下变更：
- [列出变更内容]
- 已通过所有测试
- 已更新 README.md

是否可以运行 Publish/git-commit-push.sh 提交代码？"

# 5. 获得用户明确确认后执行
cd Publish
./git-commit-push.sh "commit message"

# 6. 如果用户不确认，停止操作
```

**AI Agent 严禁的操作：**
- ❌ 不询问直接 `git push`
- ❌ 直接调用 `git add .`（git root 是 home 目录，会把整个系统纳入提交）
- ❌ 假设用户同意自动提交
- ❌ 在用户不知情的情况下修改远程仓库
- ❌ 强制推送 (`git push --force`) 除非用户明确要求
- ❌ 提交 `AI-Resources/` 目录（AI 资源由独立仓库管理）

**推送前检查清单：**
```
Git 提交前必须检查：
□ 所有测试通过
□ README.md 已更新
□ 提交信息清晰准确
□ 没有包含敏感信息（密钥、密码等）
□ 使用 Publish/git-commit-push.sh（不手动 git add）
□ 没有提交 AI-Resources/ 目录
□ 用户已明确确认可以提交
□ 目标仓库正确（git@github.com:ElliotLion-ing/CSP-AI-Agent.git）
□ 分支名称正确
```

**提交信息规范：**
```
格式：<type>: <subject>

type 类型：
- feat: 新功能
- fix: Bug 修复
- docs: 文档更新
- style: 代码格式调整
- refactor: 重构
- test: 测试相关
- chore: 构建/工具变更

示例：
feat: add user authentication with JWT
fix: resolve memory leak in resource manager
docs: update API documentation for v2.0
```

---

### 5. 发布流程规范

**规则描述：**
- `@Publish` 目录存储了发布到 npm 的脚本和 Git 提交脚本
- **重要**：Publish 脚本是用来发布 `@SourceCode` 目录中的 TypeScript 源代码包
- **发布顺序强制要求**：必须先通过 npm 成功发布包，再使用 Git 脚本提交代码
- 所有发布操作必须获得用户明确确认

**项目目录结构：**
```
Cursor-AI-Agent-MCP/
├── SourceCode/                 # 🔥 所有源代码生成在这里
│   ├── package.json           # npm 包配置
│   ├── tsconfig.json          # TypeScript 配置
│   ├── src/                   # TypeScript 源代码
│   │   ├── index.ts           # 入口文件
│   │   ├── server.ts          # MCP Server
│   │   ├── config/            # 配置模块
│   │   ├── utils/             # 工具函数
│   │   ├── tools/             # MCP Tools 实现
│   │   └── ...
│   ├── dist/                  # 编译输出（npm 发布此目录）
│   └── node_modules/          # 依赖
├── Publish/                   # 发布脚本（发布 SourceCode 中的包）
│   ├── npm-publish.sh         # npm 发布脚本
│   ├── git-commit-push.sh     # Git 提交推送脚本
│   ├── publish-config.json    # 发布配置文件
│   └── README.md              # 发布指南
├── Test/                      # 测试代码和 Mock Server
├── Docs/                      # 设计文档
├── Logs/                      # 日志输出
└── AGENTS.md                  # 本规范文档
```

**关键说明：**
- ✅ 所有 TypeScript/JavaScript 源代码都在 `SourceCode/` 目录中
- ✅ `Publish/` 脚本负责发布 `SourceCode/` 中的代码到 npm
- ✅ npm 发布时，发布的是 `SourceCode/dist/` 编译后的代码
- ✅ `Test/` 目录的测试代码会 require/import `SourceCode/` 中的模块

**发布流程（严格按顺序执行）：**
```bash
# 阶段 1: 准备发布
# 1. 确认所有测试通过
cd Test
node test-runner.js

# 2. 检查日志验证测试结果
grep '"type":"test"' logs/app-$(date +%Y-%m-%d).log | npx pino-pretty

# 3. 确认所有文档已更新
□ README.md 已更新
□ CHANGELOG.md 已更新（如有）
□ package.json 版本号已更新

# 阶段 2: npm 发布（必须先执行）
# 4. 询问用户确认 npm 发布
"准备发布到 npm：
- 包名：<package-name>
- 版本：<version>
- 标签：<tag> (latest/beta/alpha)

是否确认发布到 npm？"

# 5. 获得用户确认后，执行 npm 发布
cd Publish
./npm-publish.sh  # 发布 SourceCode/ 中的包

# 6. 验证 npm 发布成功
npm view <package-name>@<version>

# 阶段 3: Git 提交（npm 成功后执行）
# 7. 仅在 npm 发布成功后，询问用户确认 Git 提交
"npm 发布成功！

准备提交代码到 Git 仓库：
- 变更内容：[列出变更]
- 提交信息：<commit-message>
- 目标分支：<branch-name>

是否确认提交代码？"

# 8. 获得用户确认后，执行 Git 提交
cd Publish
./git-commit-push.sh

# 9. 验证 Git 推送成功
git log -1
git status
```

**发布脚本规范：**

**npm-publish.sh 示例**:
```bash
#!/bin/bash
set -e

echo "📦 Starting npm publish from SourceCode directory..."

# 切换到 SourceCode 目录
cd "$(dirname "$0")/../SourceCode"

# 1. 验证 package.json
if [ ! -f "package.json" ]; then
  echo "❌ Error: package.json not found in SourceCode/"
  exit 1
fi

# 2. 运行构建（如需要）
npm run build

# 3. 运行测试
npm test

# 4. 发布到 npm
npm publish --access public

echo "✅ npm publish successful!"
```

**git-commit-push.sh 示例**:
```bash
#!/bin/bash
set -e

echo "🚀 Starting git commit and push..."

# 回到项目根目录
cd "$(dirname "$0")/.."

# 1. 检查 Git 状态
git status

# 2. 添加所有变更（包括 SourceCode 目录）
git add .

# 3. 提交（从参数获取提交信息）
COMMIT_MSG=${1:-"chore: release new version"}
git commit -m "$COMMIT_MSG"

# 4. 推送到远程
BRANCH=${2:-"main"}
git push origin $BRANCH

echo "✅ Git push successful!"
```

**发布前检查清单：**
```
准备阶段：
□ 所有测试通过（100% Pass Rate）
□ 日志中无错误（ERROR/FATAL 级别）
□ README.md 已更新
□ SourceCode/package.json 版本号已更新
□ 构建无错误（如适用）
□ 依赖项已更新到最新兼容版本

npm 发布阶段：
□ 用户已明确确认 npm 发布
□ npm 发布脚本从 SourceCode/ 目录执行
□ SourceCode/ 中的代码已编译到 dist/
□ npm 发布脚本执行成功
□ 包已成功发布到 npm registry
□ 可以通过 npm view 查看到新版本
□ 包可以正常安装（npm install 测试）

Git 提交阶段（仅在 npm 成功后）：
□ npm 发布已成功完成
□ 用户已明确确认 Git 提交
□ 提交信息清晰准确
□ 目标分支正确
□ Git 仓库包含 SourceCode/ 目录的所有变更
□ 未包含 @csp 目录
□ 未包含敏感信息
□ Git 推送成功
```

**严禁的操作：**
- ❌ 跳过 npm 发布，直接 Git 提交
- ❌ npm 发布失败后仍然 Git 提交
- ❌ 不询问用户直接发布
- ❌ 发布未经测试的代码
- ❌ 发布时不更新版本号
- ❌ 在 npm 发布前 Git 推送

**发布失败处理：**
```
npm 发布失败：
1. 停止发布流程，不执行 Git 提交
2. 分析失败原因（权限、网络、版本冲突等）
3. 修复问题后重新发布
4. 仅在 npm 发布成功后继续 Git 提交

Git 提交失败：
1. npm 包已发布成功，无需回滚
2. 修复 Git 问题（冲突、权限等）
3. 重新执行 Git 提交脚本
4. 确认代码已成功推送
```

**版本管理规范：**
```
语义化版本：MAJOR.MINOR.PATCH

- MAJOR: 破坏性变更（不兼容的 API 修改）
- MINOR: 新功能（向后兼容）
- PATCH: Bug 修复（向后兼容）

示例：
- 1.0.0 → 1.0.1 (Bug 修复)
- 1.0.1 → 1.1.0 (新功能)
- 1.1.0 → 2.0.0 (破坏性变更)

预发布版本：
- 1.0.0-alpha.1 (内部测试)
- 1.0.0-beta.1 (公开测试)
- 1.0.0-rc.1 (候选版本)
```

---

### 6. 错误记录与持续改进

**规则描述：**
- 每次犯错被纠正后，必须将错误原因和正确做法记录到本文档
- 建立错误知识库，避免重复犯同样的错误
- 定期回顾错误记录，优化工作流程

**记录格式：**
```markdown
#### 错误 ID: ERR-YYYY-MM-DD-序号
- **错误描述**: 简要描述犯了什么错误
- **发生时间**: YYYY-MM-DD
- **错误原因**: 分析为什么会犯这个错误
- **正确做法**: 说明应该怎么做
- **预防措施**: 如何避免再次发生
- **相关规则**: 关联到具体的规则章节
```

**触发记录的情况：**
- 违反设计文档规范
- 遗漏必要的测试
- 代码质量问题（内存泄漏、崩溃风险等）
- 安全问题
- 性能问题
- 逻辑错误
- 理解偏差

---

### 7. Bug 管理规范

**规则描述：**
- `Bug/` 目录是项目唯一的 Bug 档案库，所有已发现的 Bug 必须在此建档
- 每个 Bug 独占一个子文件夹，文件夹内包含 Bug 描述文件和修复方案文件
- Bug 修复并验证通过后，必须将整个 Bug 文件夹归档到 `Bug/Fixed Bugs/` 子目录

**Bug 目录结构：**
```
Bug/
├── Fixed Bugs/                        # 已修复归档区（只读，不得手动修改内容）
│   ├── BUG-YYYY-MM-DD-序号-简短标题/
│   │   ├── bug-description.md         # 原始 Bug 描述（保持不变）
│   │   └── fix-solution.md            # 修复方案记录
│   └── ...
├── BUG-YYYY-MM-DD-序号-简短标题/      # 活跃 Bug（尚未修复）
│   ├── bug-description.md
│   └── fix-solution.md                # 修复后补充，归档前必须存在
└── ...
```

**文件夹命名规范：**
```
BUG-YYYY-MM-DD-序号-简短标题
例：BUG-2026-03-15-001-workflow-card-buttons-not-clickable
```

**`bug-description.md` 必须包含的内容：**
```markdown
# Bug: [简短标题]

**Bug ID:** BUG-YYYY-MM-DD-序号  
**发现时间:** YYYY-MM-DD  
**发现人:** [姓名]  
**严重程度:** Critical / High / Medium / Low  
**状态:** Open / In Progress / Fixed  

---

## Bug 描述

[清晰描述问题现象，包括：出错的功能、错误信息、异常行为]

## 复现步骤

1. [步骤一]
2. [步骤二]
3. [步骤三]
...

**预期结果：** [正常情况下应该发生什么]

**实际结果：** [实际发生了什么]

## 环境信息

- 操作系统: [OS]
- 浏览器/运行环境: [版本]
- 相关文件: [涉及的源文件路径]

## 附加信息

[截图描述、日志片段、其他相关信息]
```

**`fix-solution.md` 必须包含的内容：**
```markdown
# Fix: [简短标题]

**Bug ID:** BUG-YYYY-MM-DD-序号  
**修复人:** [姓名]  
**修复时间:** YYYY-MM-DD  
**验证状态:** Verified / Pending Verification  

---

## 根本原因分析

[分析导致 Bug 的根本原因，而不仅仅是表面现象]

## 修复方案

[描述采用的修复方案和设计思路]

## 修改的文件

| 文件路径 | 修改内容摘要 |
|---------|------------|
| `path/to/file.ts` | 修改了 xxx 函数，增加了 yyy 校验 |

## 关键代码变更

```diff
// 关键改动示例（可选）
- 旧代码
+ 新代码
```

## 验证方法

1. [验证步骤一]
2. [验证步骤二]

## 预防措施

[如何避免类似问题再次出现]
```

**完整 Bug 处理流程：**

```
1. 发现 Bug
   ↓
2. 在 Bug/ 目录创建文件夹（命名：BUG-YYYY-MM-DD-序号-简短标题）
   ↓
3. 编写 bug-description.md（必须包含：描述、复现步骤、环境信息）
   ↓
4. 分析并修复 Bug（代码改动）
   ↓
5. 编写 fix-solution.md（必须包含：根因、方案、修改文件、验证方法）
   ↓
6. 在 @Test 目录生成该 Bug 专属的测试用例文件
   ↓
7. 运行测试用例，验证 Bug 已修复（查看脚本输出 + 日志双重验证）
   ↓
8. 将测试结果写入 Bug 文件夹的 test-result.md
   ↓
9. 将整个 Bug 文件夹（含测试结果）移动到 Bug/Fixed Bugs/ 目录
   ↓
10. 完成归档（Fixed Bugs/ 中的内容保持不变，不再修改）
```

---

**Bug 测试用例规范（强制）：**

**测试文件命名：**
```
Test/test-bug-BUG-YYYY-MM-DD-序号.js
例：Test/test-bug-BUG-2026-03-20-001.js
```

**测试用例必须覆盖：**
- ✅ 复现原始 Bug 的场景（验证旧行为已消失）
- ✅ 修复后的正确行为（验证新行为符合预期）
- ✅ 边界条件（如空值、缺失参数等）

**测试结果文件 `test-result.md` 模板：**
```markdown
# Test Result: [Bug 简短标题]

**Bug ID:** BUG-YYYY-MM-DD-序号
**测试时间:** YYYY-MM-DD HH:MM
**测试人:** [AI Agent / 用户名]
**测试文件:** `Test/test-bug-BUG-YYYY-MM-DD-序号.js`
**验证状态:** ✅ PASSED / ❌ FAILED

---

## 测试执行结果

### 脚本输出（主要验证）

```
[粘贴测试脚本的终端输出，包含 Pass Rate 和各用例结果]
```

### 日志验证（辅助验证）

```
[粘贴 @Logs 中相关的日志条目]
```

## 测试用例明细

| 序号 | 用例描述 | 预期结果 | 实际结果 | 状态 |
|------|---------|---------|---------|------|
| 1 | [用例名称] | [预期] | [实际] | ✅/❌ |

## 结论

[一句话总结：Bug 是否已修复，修复是否完整覆盖所有场景]
```

**执行测试的标准流程：**
```bash
# 1. 启动 Mock Server（若需要）
cd Test && node mock-csp-resource-server.js &

# 2. 运行 Bug 专属测试
node Test/test-bug-BUG-YYYY-MM-DD-序号.js

# 3. 查看输出（主要验证：Pass Rate、退出码）
echo "Exit code: $?"

# 4. 检查日志（辅助验证）
grep "BUG-YYYY-MM-DD-序号" ../Logs/app-$(date +%Y-%m-%d).log 2>/dev/null || echo "No log entries found"

# 5. 将结果写入 test-result.md
```

---

**强制要求：**
- ✅ 每个 Bug 必须创建独立文件夹，不得将多个 Bug 混在同一文件夹
- ✅ `bug-description.md` 必须在开始修复**之前**创建
- ✅ `fix-solution.md` 必须在归档**之前**完成
- ✅ **修复完成后必须在 `@Test` 中生成专属测试用例**（命名：`test-bug-BUG-YYYY-MM-DD-序号.js`）
- ✅ **必须运行测试用例并验证通过后才能归档**
- ✅ **测试结果必须写入 Bug 文件夹的 `test-result.md`**（含脚本输出 + 日志双重验证）
- ✅ 归档前检查清单：Bug 文件夹必须包含以下三个文件才可归档：
  - `bug-description.md`（Bug 描述 + 复现步骤）
  - `fix-solution.md`（根因分析 + 修复方案）
  - `test-result.md`（测试脚本输出 + 验证结论，Pass Rate 必须 100%）
- ✅ 归档操作：将完整 Bug 文件夹（含上述三个文件）整体移入 `Bug/Fixed Bugs/`，不得仅移动部分文件
- ✅ `Fixed Bugs/` 中已归档的内容不得修改（含 `test-result.md`，归档后只读）

**禁止的操作：**
- ❌ 修复 Bug 后不创建任何文档记录
- ❌ 直接在 `Bug/` 根目录放置文件（必须建子文件夹）
- ❌ `bug-description.md` 中缺少复现步骤
- ❌ **修复后不生成测试用例直接归档**
- ❌ **测试未通过就归档**
- ❌ **归档时缺少 `test-result.md`**（三文件缺一不可）
- ❌ **归档时只移动部分文件，而非整个 Bug 文件夹**
- ❌ 未验证修复有效就归档
- ❌ 归档后修改 `Fixed Bugs/` 中的已有内容

---

### 8. 上下文接力规范

**规则描述：**
- 当 **Cursor 显示"上下文即将耗尽"警告**时，必须立即调用 `context-relay` skill 保存进度
- **触发条件**：Cursor 系统警告，而非 Token 百分比或工具调用次数
- **接力机制**：完全由 `~/.cursor/skills/context-relay/SKILL.md` 和 `~/.cursor/rules/context-relay-auto.mdc` 定义
- **项目约束**：本规则仅确保 Agent 在收到警告时正确调用 skill，具体接力流程见 skill 文档

**详细实现：**
- 📄 **Skill 文档**：`~/.cursor/skills/context-relay/SKILL.md`（接力流程、文件格式、恢复步骤）
- 📄 **自动检测规则**：`~/.cursor/rules/context-relay-auto.mdc`（自动触发、监控机制）
- 📂 **接力文件**：`{workspace}/.cursor/context-relay/handoff.md`（保存进度）

**关键原则：**
- ✅ **响应系统警告** - 当 Cursor 提示"上下文即将耗尽"时立即行动
- ✅ **委托给 Skill** - 所有接力逻辑由 context-relay skill 处理
- ✅ **保持项目专注** - AGENTS.md 专注于项目特定规则，接力机制解耦到 skill

**违规处理：**
- 如果收到 Cursor"上下文即将耗尽"警告但未调用 skill → 违规
- 如果手动编写接力逻辑而非使用 skill → 违规
- 详见「常见违规行为」章节

---
## 🚨 常见违规行为

### 违规行为清单

| 违规类型 | 描述 | 后果 | 正确做法 |
|---------|------|------|---------|
| **跳过 OpenSpec** | 重大变更不创建提案直接实施 | 缺乏设计评审和追踪 | 使用 OpenSpec 流程 |
| **手动创建规格** | 不用 OpenSpec CLI 手动创建文档 | 格式错误、验证失败 | 使用 openspec 命令 |
| **忽略 @Docs** | OpenSpec 设计违背整体架构 | 架构不一致、技术债 | 先检查 @Docs 约束 |
| **不同步文档** | 归档后不更新 @Docs | 文档与代码不一致 | 归档后同步 @Docs |
| **跳过验证** | 不执行 validate --strict | 规格格式错误 | 强制验证提案 |
| **提前实施** | 提案未批准就开始编码 | 浪费工作、返工 | 等待批准后实施 |
| **忽略归档** | 完成后不执行 archive | 变更状态不清晰 | 部署后立即归档 |
| **跳过测试** | 编码完成后不运行测试 | 潜在 Bug 未被发现 | 强制运行测试验证 |
| **阶段无测试** | 阶段完成后未创建测试用例 | 功能未经验证 | 每阶段必须创建测试 |
| **测试覆盖不全** | 测试用例未覆盖核心功能 | 关键路径未测试 | 覆盖所有核心场景 |
| **测试未过就继续** | 测试失败仍进入下一阶段 | 带病开发 | 测试通过后再继续 |
| **阶段无文档** | 阶段完成后未创建阶段性文档 | 缺乏实现记录 | 每阶段必须创建文档 |
| **文档无关键信息** | 阶段性文档未记录关键实现 | 无法追溯设计 | 记录实现和决策 |
| **不查设计偏移** | 研发结束后未执行设计偏移检查 | 偏离设计未发现 | 强制执行偏移检查 |
| **偏移未修正** | 存在不合理设计偏移未修正 | 实现与设计不符 | 修正后再继续 |
| **不执行自检** | 重大变更后未执行符合性自检 | 设计规范未遵守 | 归档前强制自检 |
| **自检不达标** | 符合度 < 90% 仍继续流程 | 代码质量不达标 | 修复后重新自检 |
| **缺少自检报告** | 未生成符合性检查报告 | 缺乏检查记录 | 生成报告归档 |
| **架构设计偏离** | 实现与核心架构设计不一致 | 架构混乱 | 遵守 Core-Design.md |
| **多线程不合规** | 使用单线程阻塞或同步操作 | 性能问题 | 遵守 MultiThread-Architecture.md |
| **日志不规范** | 使用 console.log 或非结构化日志 | 日志质量差 | 遵守 Logging-Design.md |
| **API 不一致** | API 路径/参数与文档不一致 | 接口混乱 | 遵守 API-Mapping.md |
| **硬编码资源路径** | 代码中硬编码 AI 资源路径 | 无法支持多源 | 使用 ResourceLoader |
| **直接访问资源** | 绕过 ResourceLoader 直接读取 | 破坏架构 | 通过接口访问 |
| **配置文件缺失** | ai-resources-config.json 不存在 | 系统无法运行 | 创建配置文件 |
| **默认源配置错误** | csp 默认源配置不正确 | 向后兼容性破坏 | 修正默认源配置 |
| **资源目录未排除** | AI-Resources/ 未在 .gitignore | 提交外部资源 | 添加到 .gitignore |
| **优先级冲突** | 扩展源优先级高于默认源 | 破坏冲突解决 | 调整优先级配置 |
| **不查日志** | 测试后不检查日志验证结果 | 测试问题未被发现 | 双重验证（脚本+日志） |
| **只看日志** | 只检查日志不看脚本输出 | 遗漏主要验证信息 | 优先查看脚本输出 |
| **验证不一致** | 脚本输出与日志结果不一致 | 存在隐藏问题 | 调查并修复不一致 |
| **缺少 README** | 完成开发不生成 README.md | 缺乏使用文档 | 自动生成 README |
| **README 不完整** | README 缺少关键信息 | 用户无法理解使用 | 包含必需章节 |
| **发布顺序错误** | Git 提交在 npm 发布之前 | 代码和包不一致 | 先 npm 后 Git |
| **npm 失败仍提交** | npm 发布失败后仍 Git 提交 | 版本不一致 | npm 成功后才 Git |
| **未经确认发布** | 不询问用户直接发布/提交 | 违反流程控制 | 必须获得确认 |
| **未经确认提交** | 不询问用户直接推送代码 | 违反流程控制 | 必须获得确认 |
| **Bug 无测试用例** | 修复 Bug 后未生成专属测试文件 | 修复效果未经验证 | 生成 `test-bug-BUG-*.js` |
| **Bug 测试未通过** | 测试失败仍执行归档 | 带病归档 | 测试通过后再归档 |
| **缺少测试结果文件** | 归档时 Bug 文件夹无 `test-result.md` | 验证记录缺失 | 生成并写入 `test-result.md` |
| **测试覆盖不完整** | Bug 测试未覆盖原始复现场景 | 旧行为可能残留 | 必须覆盖原始 Bug 场景 |
| **错误的仓库** | 推送到错误的远程仓库 | 代码泄漏风险 | 验证仓库地址 |
| **提交敏感信息** | 提交密钥、密码等敏感数据 | 安全风险 | 检查提交内容 |
| **提交 @csp 目录** | 将外部资源仓库提交到项目 | 架构混乱 | .gitignore 排除 |
| **不更新文档** | 架构变更后未同步更新文档 | 文档与实现不一致 | 及时更新相关文档 |
| **忽略错误** | 犯错被纠正后不记录 | 重复犯同样的错误 | 记录到经验教训章节 |
| **违背规范** | 代码不符合项目规范 | 代码质量下降 | 遵守代码规范 |
| **单线程阻塞** | 使用单线程处理所有请求 | 一个用户阻塞所有用户 | 使用多线程架构 |
| **上下文压力不保存** | 上下文即将耗尽仍不保存进度 | 工作进度丢失 | 启动自动接力 |
| **不用 Subagent 接力** | 有 Subagent 可用却不使用 | 需要用户干预 | 优先用 Subagent |
| **接力文件格式错误** | handoff.md 格式不符合规范 | 无法正确恢复 | 遵守接力文件模板 |
| **未检测接力文件** | Subagent 未读取 handoff.md | 任务中断 | 自动读取 handoff.md |
| **Subagent 不监控** | Subagent 不监控上下文压力 | 链式接力失败 | 监控工具调用次数 |
| **提前删除接力文件** | 任务未完成就删除接力文件 | 进度丢失 | 完成后再清理 |
| **接力内容模糊** | 接力文件内容不具体 | 无法恢复上下文 | 详细记录决策和状态 |
| **未通知用户接力** | 保存/恢复时不通知用户 | 用户体验差 | 明确告知接力状态 |

---

## 📚 经验教训记录

### 说明
本章节记录所有被纠正的错误和经验教训，供后续参考。

---

#### 错误 ID: ERR-2026-03-09-001
- **错误描述**: 创建 AGENTS.md 时遗漏了重要的多线程架构设计文档
- **发生时间**: 2026-03-09
- **错误原因**: 在创建文档时没有完整扫描 Docs 目录，仅基于已知的三个主要文档进行记录
- **正确做法**: 创建文档索引前应先完整扫描目标目录，列出所有相关文档后再编写
- **预防措施**: 
  - 每次创建文档索引时，先运行 `ls Docs/` 查看所有文件
  - 询问用户是否有其他重要文档需要记录
  - 建立文档检查清单，确保不遗漏
- **相关规则**: 核心规则 #1 - 设计文档优先原则
- **已修复**: 已将 `CSP-AI-Agent-MultiThread-Architecture.md` 添加到必读文档列表

---

#### 错误 ID: ERR-2026-03-10-002
- **错误描述**: 在阶段1实施中，没有按照 OpenSpec 流程驱动开发，直接开始编码
- **发生时间**: 2026-03-10
- **错误原因**: 
  - 过于急切地开始实施，忽略了核心规则 #0（OpenSpec 驱动开发流程）
  - 虽然创建了 OpenSpec 目录，但没有完成提案验证就开始编码
  - 误以为可以边做边补充 OpenSpec 文档
- **正确做法**: 
  1. 先创建完整的 OpenSpec 提案（proposal.md + tasks.md + spec.md）
  2. 运行 `openspec validate --strict` 验证提案
  3. 等待用户批准（如需要）
  4. 批准后才开始实施
  5. 实施完成后运行 `openspec archive`
- **预防措施**: 
  - 每次开始新功能前，先检查是否需要 OpenSpec 提案
  - 如需提案，必须先完成提案并验证通过
  - 在 tasks.md 的第一项加上"验证 OpenSpec 提案"
  - 养成习惯：提案 → 验证 → 批准 → 实施 → 归档
- **相关规则**: 核心规则 #0 - OpenSpec 驱动开发流程
- **已修复**: 补充创建了完整的 OpenSpec 提案并通过验证，所有任务已标记为完成

---

```
后续所有被纠正的错误都将记录在此处，格式如上。
每条记录必须包含：ID、描述、时间、原因、正确做法、预防措施、相关规则。
```

---

## 🔧 特殊规则

### 代码质量要求

1. **内存安全**
   - 每次代码改动后必须检查内存泄漏风险
   - 每次代码改动后必须检查潜在崩溃风险
   - 使用智能指针和 RAII 模式管理资源

2. **C++ 标准**
   - 所有 C++ 代码必须符合 C++20 标准
   - 优先使用现代 C++ 高级语法特性
   - 避免使用已废弃的语法

3. **注释和语言**
   - 代码中的注释必须使用英文
   - 与用户的交流必须使用简体中文
   - 不要在代码注释中解释正在做的改动（除非必要）

### Git 提交规范

1. **提交控制**
   - 每次 Git 提交前必须询问用户意见并获得明确确认
   - 不得在用户未确认的情况下自动推送代码
   - **项目代码仓库**：`git@github.com:ElliotLion-ing/CSP-AI-Agent.git`
   - **AI 资源仓库**（外部）：`git@git.zoom.us:main/csp.git`（由 mock server finalize 接口处理，不由本脚本提交）

2. **AI Agent 执行提交时必须使用发布脚本**
   - **AI Agent 不得直接调用 `git add .` 或 `git push`，必须通过 `Publish/git-commit-push.sh`**
   - 因为 git root 是 home 目录，直接 `git add .` 会把整个系统文件纳入提交，极其危险
   - 脚本封装了路径隔离、remote 验证、.gitignore 补全、敏感文件检测等安全保障
   - 用户自己手动执行 git 命令不受此限制
   ```bash
   cd Publish
   ./git-commit-push.sh "feat: description of change"
   ```

3. **提交范围（仅项目代码）**
   - ✅ 提交：`SourceCode/`、`Test/`、`Docs/`、`Publish/`、`openspec/`、`AGENTS.md`、`README.md`、`.cursor/`（根目录）
   - ❌ 排除：`AI-Resources/`（AI 资源独立仓库）、`*/. cursor/`（子目录缓存）、`Logs/`、`SourceCode/.env`、`SourceCode/dist/`

4. **提交信息**
   - 提交信息要清晰描述改动内容
   - 遵循项目的 Git 提交规范（type: subject）
   - 使用英文编写提交信息

5. **安全检查**
   - 不得提交敏感信息（密钥、密码、token 等）
   - 不得提交临时文件或调试代码
   - 不得提交 `AI-Resources/` 目录（脚本已自动排除）
   - `.gitignore` 由脚本自动补全，无需手动维护

### 文档生成要求

1. **README.md 自动生成**
   - 系统代码 coding 完成后必须生成 README.md
   - README.md 必须描述主要功能和使用方法
   - 包含必需的章节（见核心规则 #3）

2. **文档质量**
   - 代码示例必须可运行
   - 命令必须经过验证
   - 配置示例必须完整

3. **文档同步**
   - 功能变更时更新 README.md
   - OpenSpec 归档后检查是否需要更新 README.md
   - 保持文档与代码一致

### 测试和日志要求

1. **阶段性测试创建（强制要求）**
   - **每完成一个研发阶段**，必须立即在 `@Test` 中创建该阶段的测试用例
   - 测试用例必须覆盖该阶段的所有核心功能
   - 测试用例必须包含正常场景和异常场景
   - 测试用例文件命名规范：`Test/test-[feature-name]-[scenario].js`
   - 测试用例必须包含清晰的测试描述和预期结果

2. **测试验证（双重验证机制）**
   - 所有代码必须通过 `@Test` 测试
   - 测试覆盖率不低于 80%
   - 关键路径必须有测试覆盖
   - 每个阶段测试通过后，才能进入下一阶段

3. **主要验证（Test 脚本输出）**
   - 查看测试脚本执行的终端输出
   - 确认 Pass Rate 达到 100% 或符合预期
   - 检查脚本退出码（0 表示成功）
   - 查看失败测试用例的详细信息
   ```bash
   # 阶段性测试验证
   cd Test
   node test-runner.js --stage [stage-name]
   
   # 完整测试验证
   cd Test
   node test-runner.js
   
   # 或使用快速验证脚本
   ./test-examples.sh
   echo $?  # 检查退出码
   ```

4. **辅助验证（Logs 日志文件）**
   - 测试完成后检查 `@Logs` 日志
   - 验证日志中包含完整的测试执行记录
   - 确认日志无 ERROR/FATAL 级别错误
   - 统计测试通过率并与脚本输出对比
   ```bash
   # 查看测试日志
   grep '"type":"test"' logs/app-$(date +%Y-%m-%d).log | npx pino-pretty
   
   # 查看错误日志
   grep '"level":50' logs/app-$(date +%Y-%m-%d).log
   
   # 统计测试结果
   grep '"testResult"' logs/app-$(date +%Y-%m-%d).log | jq -r '.testResult' | sort | uniq -c
   ```

5. **双重验证一致性**
   - Test 脚本输出与 Logs 日志结果必须一致
   - 如不一致，需要调查原因并修复
   - 只有两者都验证通过，才能继续后续流程

### 发布流程要求

1. **npm 发布优先**
   - 必须先完成 npm 发布
   - npm 发布失败则停止流程
   - 验证包已成功发布到 npm registry

2. **Git 提交在后**
   - 仅在 npm 发布成功后执行
   - Git 提交必须获得用户确认
   - 验证推送成功

3. **发布脚本**
   - 使用 `@Publish/npm-publish.sh` 发布到 npm
   - 使用 `@Publish/git-commit-push.sh` 提交代码
   - 遵循版本管理规范（语义化版本）

4. **版本号管理**
   - MAJOR.MINOR.PATCH 格式
   - 破坏性变更：MAJOR 版本
   - 新功能：MINOR 版本
   - Bug 修复：PATCH 版本

### 安全基线

参考 `.cursor/rules/security-security-baseline.mdc` 中的安全开发原则：
- 输入验证
- 输出编码
- 密钥管理
- 错误处理
- 日志安全

### 多线程架构要求

参考 `Docs/CSP-AI-Agent-MultiThread-Architecture.md` 的设计规范：

1. **并发模型**
   - 必须使用多线程架构，避免单线程阻塞
   - 每个用户请求在独立线程中处理
   - 耗时操作（Git、文件 I/O）不得阻塞主线程

2. **线程安全**
   - 所有共享资源必须有适当的同步机制
   - 使用线程池管理并发请求
   - 避免死锁和竞态条件

3. **性能要求**
   - 读操作响应时间 < 100ms
   - 写操作响应时间 < 2s
   - 支持至少 50 并发用户

4. **资源管理**
   - 线程池大小可配置
   - 实现优雅关闭机制
   - 防止资源泄漏

### AI Resources 开发约束

参考 `Docs/AI-Resources-Multi-Source-Architecture.md` 的架构设计：

#### 1. 资源目录架构规范

**目录结构要求：**
```
AI-Resources/                      # 所有 AI 资源的根目录（必须使用）
├── csp/                           # CSP 团队资源（默认源，必须保留）
│   └── ai-resources/              # 默认资源目录
│       ├── commands/              # Command 类型资源
│       ├── skills/                # Skill 类型资源
│       ├── mcp/                   # MCP Server 资源
│       └── rules/                 # Rule 类型资源
├── [team-name]/                   # 其他团队资源（扩展源，可配置）
│   └── ...
└── ai-resources-config.json       # 全局配置文件（必需）
```

**关键约束：**
- ✅ 所有资源必须放在 `@AI-Resources` 根目录下
- ✅ 默认资源源 `csp/ai-resources` 必须始终存在
- ✅ 扩展资源源必须在配置文件中声明
- ✅ 配置文件必须符合标准 JSON Schema
- ❌ 不得硬编码资源路径（必须从配置读取）
- ❌ 不得直接访问文件系统（必须通过 ResourceLoader）
- ❌ 不得绕过优先级机制直接选择资源

#### 2. 配置文件约束

**配置文件位置**：`@AI-Resources/ai-resources-config.json`

**必需字段检查：**
```json
{
  "version": "1.0",
  "default_source": {
    "name": "csp",
    "path": "csp/ai-resources",
    "enabled": true,
    "priority": 100,
    "resources": {
      "commands": "commands",
      "skills": "skills",
      "mcp": "mcp",
      "rules": "rules"
    }
  },
  "extended_sources": [...],
  "resource_types": ["commands", "skills", "mcp", "rules"],
  "loading_order": "priority_desc",
  "conflict_resolution": "highest_priority_wins"
}
```

**配置验证规则：**
- ✅ `version` 必须为 "1.0"
- ✅ `default_source` 必须存在且不可禁用
- ✅ `default_source.priority` 必须为最高值（建议 100）
- ✅ `extended_sources` 中每个源的 `priority` 必须唯一
- ✅ `resource_types` 必须包含所有四种类型
- ✅ `loading_order` 必须为 "priority_desc"（按优先级降序）
- ✅ `conflict_resolution` 必须为 "highest_priority_wins"
- ❌ 不得修改默认源的 `name` 和 `path`
- ❌ 不得将扩展源的 `priority` 设置高于默认源

#### 3. 资源加载约束

**加载流程强制要求：**
```typescript
// ✅ 正确的资源加载方式
import { ResourceLoader } from '@/resources/loader';

const loader = new ResourceLoader();
await loader.loadConfig();  // 必须先加载配置
await loader.scanResources(); // 扫描所有资源源
const resources = loader.getResourcesByType('commands'); // 按类型获取

// ❌ 错误的资源加载方式
const commandPath = './AI-Resources/csp/ai-resources/commands'; // 硬编码路径
const files = fs.readdirSync(commandPath); // 直接访问文件系统
```

**资源查询约束：**
- ✅ 必须通过 `ResourceLoader` 接口查询资源
- ✅ 必须使用资源 ID 而非文件路径
- ✅ 必须考虑资源优先级
- ✅ 必须处理资源不存在的情况
- ❌ 不得缓存资源路径（路径可能动态变化）
- ❌ 不得假设资源在特定目录

#### 4. 资源冲突处理约束

**冲突解决策略：**
```
场景：多个源提供相同名称的资源
策略：highest_priority_wins（最高优先级获胜）

示例：
- csp/ai-resources/commands/test.md (priority=100)
- client-sdk-ai-hub/.cursor/commands/test.md (priority=50)
→ 使用 csp 源的资源（优先级更高）
```

**必须遵守的规则：**
- ✅ 默认源（csp）始终具有最高优先级
- ✅ 资源冲突时，自动选择高优先级资源
- ✅ 日志中必须记录冲突和选择结果
- ✅ 不同类型的同名资源不视为冲突
- ❌ 不得覆盖配置文件中的冲突策略
- ❌ 不得在代码中实现自定义冲突逻辑

**上传资源前的冲突检查（重要）：**
```typescript
// ✅ 正确的上传流程
async function uploadResource(params) {
  const { name, type, content } = params;
  
  // 1. 必须先检查是否存在重名资源
  const existingResources = await searchResources({
    query: name,
    type: type,
    exactMatch: true
  });
  
  // 2. 发现重名资源，提示用户
  if (existingResources.length > 0) {
    const conflictInfo = existingResources.map(r => ({
      name: r.name,
      type: r.type,
      source: r.source,
      priority: r.priority
    }));
    
    logger.warn({
      type: 'resource',
      operation: 'upload_conflict',
      resourceName: name,
      conflicts: conflictInfo
    }, 'Duplicate resource name detected');
    
    // 返回冲突警告，由用户决定
    return {
      success: false,
      error: 'RESOURCE_NAME_CONFLICT',
      message: `资源名称 "${name}" 已存在，请确认是否覆盖或使用不同名称`,
      conflictingResources: conflictInfo
    };
  }
  
  // 3. 无冲突，继续上传
  return await performUpload(params);
}

// ❌ 错误的做法 - 直接上传不检查
async function uploadResource(params) {
  return await performUpload(params); // 没有冲突检查
}
```

**冲突提示要求：**
- ✅ 上传前必须调用 `search_resources` 检查重名
- ✅ 发现重名时必须明确告知用户
- ✅ 提示信息必须包含：资源名称、类型、所属源、优先级
- ✅ 由用户决定是否继续上传（覆盖）或取消
- ✅ 用户确认覆盖后，记录操作日志
- ❌ 不得静默覆盖已存在的资源
- ❌ 不得在不告知用户的情况下自动重命名

#### 5. 代码实现约束

**模块职责：**
| 模块 | 文件 | 职责 | 约束 |
|------|------|------|------|
| 配置管理 | `src/config/index.ts` | 加载和验证配置 | 必须验证所有必需字段 |
| 资源加载器 | `src/resources/loader.ts` | 扫描和索引资源 | 必须支持多源和优先级 |
| 文件系统管理 | `src/filesystem/manager.ts` | 文件操作 | 必须通过 ResourceLoader |
| 工具实现 | `src/tools/*.ts` | MCP 工具逻辑 | 不得硬编码资源路径 |

**代码规范检查：**
```bash
# 检查硬编码路径（违规）
rg "csp/ai-resources" SourceCode/src/ --type ts
rg "AI-Resources/" SourceCode/src/ --type ts

# 检查直接文件系统访问（违规）
rg "fs\.(readdir|readFile).*AI-Resources" SourceCode/src/

# 检查正确使用（合规）
rg "ResourceLoader|resourceLoader" SourceCode/src/
rg "getResourcesByType|getResourceById" SourceCode/src/
```

#### 6. 测试约束

**必须测试的场景：**
- ✅ 配置文件加载和验证（正常、缺失字段、格式错误）
- ✅ 默认源始终加载
- ✅ 扩展源按配置加载
- ✅ 资源冲突按优先级解决
- ✅ 不同目录结构（标准、Cursor 风格）
- ✅ 启用/禁用资源源
- ✅ 资源查询和订阅
- ✅ 向后兼容性（默认配置下）
- ✅ **上传前的重名检查（必须测试）**
- ✅ **重名资源的提示和处理流程**

**测试文件位置：**
```
Test/
├── test-resource-config-loading.js      # 配置加载测试
├── test-resource-multi-source.js        # 多源资源测试
├── test-resource-conflict.js            # 冲突处理测试
├── test-resource-priority.js            # 优先级测试
├── test-resource-upload-conflict.js     # 上传前重名检查测试（新增）
└── test-resource-integration.js         # 集成测试
```

**上传前冲突检查测试用例：**
```javascript
// Test/test-resource-upload-conflict.js
describe('upload_resource - Conflict Detection', () => {
  it('should detect duplicate resource name before upload', async () => {
    // 1. 先上传一个资源
    const firstUpload = await uploadResource({
      name: 'test-command',
      type: 'command',
      content: 'original content'
    });
    expect(firstUpload.success).toBe(true);
    
    // 2. 尝试上传同名资源（应该被拦截）
    const duplicateUpload = await uploadResource({
      name: 'test-command',
      type: 'command',
      content: 'duplicate content'
    });
    
    // 3. 验证冲突检测
    expect(duplicateUpload.success).toBe(false);
    expect(duplicateUpload.error).toBe('RESOURCE_NAME_CONFLICT');
    expect(duplicateUpload.conflictingResources).toBeDefined();
    expect(duplicateUpload.conflictingResources.length).toBeGreaterThan(0);
  });
  
  it('should allow upload with force flag after conflict warning', async () => {
    // 用户确认覆盖后的上传流程
    const forceUpload = await uploadResource({
      name: 'test-command',
      type: 'command',
      content: 'updated content',
      force: true  // 用户确认覆盖
    });
    
    expect(forceUpload.success).toBe(true);
    expect(forceUpload.message).toContain('overwritten');
  });
});
```

#### 7. 文档更新要求

**必须同步更新的文档：**
- ✅ `Docs/CSP-AI-Agent-API-Mapping.md` - 更新资源路径说明
- ✅ `Docs/CSP-AI-Agent-Complete-Design.md` - 更新架构设计
- ✅ `README.md` - 添加多源配置指南
- ✅ `Test/README.md` - 更新测试说明
- ✅ `AGENTS.md` - 更新开发约束（本文档）

**配置文件文档化：**
- ✅ 每个扩展源必须有 `description` 字段
- ✅ 配置示例必须包含所有必需字段
- ✅ 说明文档必须解释冲突解决机制

#### 8. Git 提交约束

**@AI-Resources 目录处理：**
- ⚠️ `@AI-Resources` 目录属于外部资源，不属于项目源代码
- ✅ 必须在 `.gitignore` 中排除 `AI-Resources/` 目录
- ✅ 配置文件 `ai-resources-config.json` 可以提交（作为默认配置）
- ✅ 测试用的 Mock 资源可以提交到 `Test/mock-resources/`
- ❌ 不得将实际的 AI 资源提交到项目仓库
- ❌ 不得将用户的本地配置提交到仓库

**检查清单：**
```
Git 提交前检查（AI Resources 相关）：
□ @AI-Resources 目录已在 .gitignore 中排除
□ 默认配置文件已更新（如有变更）
□ Mock 资源仅用于测试且已标注
□ 未包含真实的 AI 资源文件
□ 代码中无硬编码资源路径
□ ResourceLoader 实现符合规范
```

#### 9. 向后兼容性约束

**兼容性要求：**
- ✅ 现有代码在默认配置下必须正常运行
- ✅ 默认资源路径 `csp/ai-resources` 必须保持不变
- ✅ 现有 API 接口不得破坏
- ✅ 配置文件缺失时，使用默认配置
- ⚠️ 升级时提供迁移脚本或指南

**迁移检查：**
```typescript
// 旧代码（兼容）
const resources = await getResources('commands');

// 新代码（推荐）
const loader = new ResourceLoader();
await loader.loadConfig();
const resources = loader.getResourcesByType('commands');
```

#### 10. 性能和缓存约束

**性能要求：**
- ✅ 配置文件加载时间 < 100ms
- ✅ 资源扫描时间 < 500ms（每个源）
- ✅ 资源查询时间 < 10ms（缓存命中）
- ✅ 支持至少 10 个扩展资源源

**缓存策略：**
- ✅ 配置文件默认缓存 TTL: 300s
- ✅ 资源索引默认缓存 TTL: 300s
- ✅ 支持手动刷新缓存
- ✅ 配置文件变更时自动失效缓存
- ❌ 不得无限期缓存（必须设置 TTL）

#### 11. 错误处理约束

**必须处理的错误：**
```typescript
// 配置文件错误
- 文件不存在
- JSON 格式错误
- 必需字段缺失
- 字段类型错误
- 优先级冲突

// 资源加载错误
- 资源源目录不存在
- 资源文件读取失败
- 资源格式不正确
- 循环依赖检测

// 资源上传错误（新增）
- 资源名称重复（RESOURCE_NAME_CONFLICT）
- 资源名称格式非法
- 资源内容为空
- 资源大小超限
- 目标源不可写

// 运行时错误
- 资源不存在
- 资源访问权限不足
- 资源源禁用
```

**错误日志要求：**
```typescript
// ✅ 正确的错误日志
logger.error({
  type: 'resource',
  operation: 'load_config',
  error: err.message,
  configPath: configPath
}, 'Failed to load resource configuration');

// ✅ 资源上传冲突日志
logger.warn({
  type: 'resource',
  operation: 'upload_conflict',
  resourceName: name,
  resourceType: type,
  conflictCount: existingResources.length,
  conflictSources: existingResources.map(r => r.source)
}, 'Resource name conflict detected during upload');

// ❌ 错误的日志方式
console.error('Config load failed');
throw new Error('Failed');
```

---

## 📊 质量指标

### 最低质量标准

| 指标 | 要求 | 检查方式 |
|------|------|---------|
| **测试覆盖率** | ≥ 80% | 运行测试并查看覆盖率报告 |
| **文档完整性** | 100% | 所有公开 API 必须有文档 |
| **代码规范符合度** | 100% | Linter 检查无错误 |
| **安全漏洞** | 0 | 安全扫描无高危漏洞 |
| **内存泄漏** | 0 | Valgrind/ASan 检查通过 |

### 代码审查要点

```
必须审查的方面：
□ 功能正确性
□ 边界条件处理
□ 错误处理
□ 资源管理
□ 并发安全性
□ 性能影响
□ 安全性
□ 可维护性
```

---

## 🚀 OpenSpec 快速参考

### 常用命令

```bash
# 探索现状
openspec spec list --long          # 列出所有能力规格
openspec list                      # 列出活跃变更
openspec show [item]               # 查看变更或规格详情

# 创建变更
mkdir -p openspec/changes/<change-id>/specs/<capability>
# 编写 proposal.md, tasks.md, spec.md
openspec validate <change-id> --strict  # 验证提案

# 实施变更
# 按 tasks.md 顺序实施
# 完成后更新 tasks.md 标记完成

# 归档变更
openspec archive <change-id> --yes      # 归档变更（部署后）
openspec validate --strict              # 验证归档结果
```

### Spec Delta 格式规范

**正确格式：**
```markdown
## ADDED Requirements
### Requirement: Feature Name
System SHALL provide feature description.

#### Scenario: Success case
- **WHEN** user performs action
- **THEN** expected result occurs
- **AND** additional constraint met

## MODIFIED Requirements
### Requirement: Existing Feature
[完整的修改后需求，包含所有场景]

#### Scenario: Updated behavior
- **WHEN** condition
- **THEN** new behavior

## REMOVED Requirements
### Requirement: Deprecated Feature
**Reason**: Why removing
**Migration**: How to migrate

## RENAMED Requirements
- FROM: `### Requirement: Old Name`
- TO: `### Requirement: New Name`
```

**关键规则：**
- ✅ 必须使用 `#### Scenario:` 格式（4 个 #）
- ✅ 每个 Requirement 至少一个 Scenario
- ✅ MODIFIED 必须包含完整的需求内容
- ✅ 使用 SHALL/MUST 表示规范性需求
- ❌ 不要使用 `- **Scenario:**` 或 `**Scenario:**`
- ❌ 不要在 MODIFIED 中只写变更部分

### 何时创建 design.md

仅在以下情况创建 `design.md`：
- ✅ 跨模块变更或新架构模式
- ✅ 新的外部依赖或重大数据模型变更
- ✅ 安全、性能或迁移复杂性
- ✅ 存在歧义，需要技术决策

否则省略 `design.md`，在 `proposal.md` 中简要说明即可。

### OpenSpec 与文档同步检查

```bash
# 归档后执行
openspec archive <change-id> --yes

# 检查同步项
□ specs/ 目录是否正确更新
□ 是否有架构级变更需要同步到 @Docs
□ 是否有 API 变更需要更新 API-Mapping.md
□ 是否有并发模型调整需要更新 MultiThread-Architecture.md
□ 是否有核心设计变更需要更新 Core-Design.md
□ 是否有完整系统变更需要更新 Complete-Design.md

# 同步完成后验证
openspec validate --strict
# 手动检查 @Docs 一致性
```

### 常见 OpenSpec 错误

| 错误信息 | 原因 | 解决方法 |
|---------|------|---------|
| "Change must have at least one delta" | 缺少 spec 变更文件 | 创建 `specs/<capability>/spec.md` |
| "Requirement must have at least one scenario" | 缺少 Scenario | 添加 `#### Scenario:` |
| "Silent scenario parsing failures" | Scenario 格式错误 | 使用 `#### Scenario: Name` |
| "Invalid delta operation" | 操作前缀错误 | 使用 `## ADDED/MODIFIED/REMOVED Requirements` |

---

## 🎓 推荐实践

### 开发最佳实践

1. **理解优先**：先理解，再动手
2. **小步快跑**：小改动，频繁测试
3. **文档同步**：代码和文档同步更新
4. **主动测试**：不等 Bug 出现才测试
5. **持续改进**：从错误中学习

### 问题解决流程

```
遇到问题时：
1. 停下来，不要盲目尝试
2. 查阅相关文档和规范
3. 分析问题根本原因
4. 设计解决方案
5. 验证方案可行性
6. 实施并测试
7. 记录经验教训
```

---

## 🔄 文档维护

### 维护责任

- **所有 AI Agent** 都有责任维护本文档
- **每次犯错** 被纠正后必须更新「经验教训」章节
- **新规则** 形成后必须添加到相应章节
- **定期回顾** 确保规则仍然适用

### 更新日志

#### 2026-03-12 (v1.8.1) - 修正上下文压力监控机制 🔥
- **关键修复**：将触发条件从"工具调用次数"改为"Token 使用量百分比"
- **设计漏洞**：
  - ❌ **问题**：工具调用次数不能准确反映上下文使用情况
  - ❌ **后果**：不同工具消耗差异巨大（500 tokens - 50,000 tokens），导致触发时机不准确
  - ✅ **解决**：使用 Token 使用量百分比作为精确监控指标
- **触发条件更新**：
  - ❌ **移除**：25 次工具调用阈值（不可靠指标）
  - ✅ **新增**：Token 使用量 ≥ 95% 阈值（精确监控）
  - ✅ **容量**：200,000 tokens（Cursor 上下文窗口）
  - ✅ **安全余量**：5% (10,000 tokens) 用于执行接力操作
- **监控机制优化**：
  - 新增 `getCurrentTokenUsage()` 函数从系统消息提取 Token 信息
  - 新增 `checkContextPressure()` 函数检查 Token 百分比
  - 新增 `CONTEXT_CONFIG` 配置对象（TOTAL_TOKENS, RELAY_THRESHOLD, SAFETY_MARGIN）
  - 每次工具调用后检查 Token 使用量，而非计数
- **代码示例完全重写**：
  - 主 Agent: 监控逻辑从 `toolCallCount >= 25` 改为 `usage.percentage >= 0.95`
  - Subagent: 同样使用 Token 百分比监控
  - 链式接力: 每个 Subagent 新上下文从 0% 开始计算
- **所有示例流程更新**：
  - 示例 1: "工具调用 1→25" 改为 "Token 使用 0%→95%"
  - 示例 2: 链式接力每次新 Subagent 都从 0% 开始
  - 示例 3: 降级备用同样使用 Token 百分比
- **上下文压力评估表重构**：
  ```
  旧表（工具调用次数）:
  < 15 次 | 15-25 次 | 25-35 次 | 35+ 次
  
  新表（Token 百分比）:
  < 80% | 80-90% | 90-95% | ≥ 95%
  ```
- **违规行为更新**：新增 3 条 Token 监控相关违规
  - 使用工具调用计数（错误方法）
  - 未监控 Token（无预警）
  - 阈值设置错误（不是 95%）
- **用户通知模板更新**：
  - 旧: "上下文即将耗尽（已使用 28 次工具调用）"
  - 新: "上下文即将耗尽（Token 使用: 190,000/200,000, 95%）剩余: 10,000 (5% 安全余量)"
- **实现文件需同步更新**：
  - `Test/subagent-auto-relay-implementation.js` 需要更新监控逻辑
  - 替换所有 `toolCallCount` 相关代码为 Token 监控
- **影响范围**：
  - 规则 #8 完整章节（触发条件、代码示例、流程描述）
  - 7 处触发条件描述
  - 3 处代码示例
  - 3 个示例流程
  - 上下文压力评估表
  - 违规行为清单
  - 用户通知模板
- **版本**: 更新到 v1.8.1
- **更新日期**: 2026-03-12
- **重要性**: 🔥🔥🔥 **极高** - 关键设计漏洞修复，直接影响接力机制可靠性

#### 2026-03-12 (v1.8.0) - Subagent 自动接力机制
- **重大更新**：规则 #8 增强为「Subagent 自动接力」优先策略
- **完全自动化**：
  - 上下文耗尽时自动启动 subagent 继续任务
  - 无需用户任何操作（"继续"输入）
  - Subagent 在新上下文中自动恢复并执行
- **接力策略**：
  1. **策略 1：Subagent 自动接力（推荐）** - 默认策略，所有情况优先使用
  2. **策略 2：用户确认接力（备用）** - 仅在 subagent 不可用时降级使用
- **Subagent 自动接力流程**：
  1. 主 agent 检测上下文压力（25+ 工具调用）
  2. 保存 handoff.md
  3. 启动 subagent（使用 Task 工具）
  4. 通知用户："任务已自动接力，在后台继续，无需干预"
  5. Subagent 自动读取 handoff.md
  6. Subagent 执行剩余任务
  7. Subagent 监控自己的上下文
  8. 如 subagent 也耗尽：启动新 subagent（链式接力）
  9. 完成后删除 handoff.md 并通知用户
- **实现代码示例**：
  - 详细的 JavaScript 实现代码
  - Subagent prompt 模板
  - 上下文监控逻辑
  - 链式接力机制
- **通知用户示例**：
  - 主 agent 保存时的通知
  - Subagent 恢复时的报告
  - Subagent 完成时的总结
  - 链式接力时的状态更新
- **示例流程**：
  - 示例 A：Subagent 自动接力（推荐）
  - 示例 B：链式 Subagent 接力（超大任务）
  - 示例 C：用户确认接力（备用）
- **违规行为更新**：新增 3 种 Subagent 相关违规
  - 不用 Subagent 接力
  - Subagent 未读取 handoff.md
  - Subagent 不监控上下文压力
- **最佳实践更新**：
  - 默认使用 Subagent 自动接力
  - Subagent 必须监控自己的上下文
  - 每次接力后向用户报告
  - 备用方案作为降级选项
- **关键优势**：
  - 🚀 完全自动化 - 零用户干预
  - 🔗 支持链式接力 - 可无限级联
  - 📊 实时报告 - 用户随时了解进度
  - 🛡️ 可靠降级 - 备用方案保障
- 强调：Subagent 自动接力是默认策略，用户无需输入"继续"

#### 2026-03-12 (v1.7.0) - 上下文接力规范（已被 v1.8.0 增强）
- **新增规则 #8**：「上下文接力规范」- 当上下文即将耗尽时必须使用 context-relay skill 保存进度
- **Context-Relay Skill**：
  - Skill 位置：`~/.cursor/skills/context-relay/SKILL.md`
  - 接力文件位置：`{workspace}/.cursor/context-relay/handoff.md`
  - 自动触发机制：上下文刷新后自动检测接力文件并恢复
- **三个阶段**：
  1. **保存进度（Save）**：工具调用 25+ 次或复杂任务时主动保存
  2. **恢复并继续（Restore）**：上下文刷新后自动检测并恢复
  3. **清理（Cleanup）**：所有任务完成后删除接力文件
- **触发条件**：
  - 工具调用次数达到 25+ 次（启发式规则）
  - 用户提示上下文即将满
  - 多步骤任务到达自然停顿点
  - 即将开始可能耗尽上下文的大任务
- **接力文件格式**：严格遵守模板，包含原始请求、已完成工作、剩余任务、关键决策、当前状态、警告等
- **链式接力**：支持跨 3+ 个会话的超大任务，累积所有历史会话的工作成果
- **上下文压力评估**：
  - < 80% Token：低风险，正常继续
  - 80-90% Token：中风险，计划保存点
  - 90-95% Token：高风险，准备接力
  - ≥ 95% Token：危急，**立即触发接力**
- **用户体验**：
  - 所有操作在同一聊天中完成，无需创建新聊天
  - 上下文耗尽后，用户发送"继续"即可自动恢复
  - Always-applied 规则自动检测和恢复接力文件
- **违规行为**：新增 6 种上下文接力相关违规
  - 上下文压力不保存
  - 接力文件格式错误
  - 未检测接力文件
  - 提前删除接力文件
  - 接力内容模糊
  - 未通知用户接力
- **最佳实践**：
  - 主动监控上下文使用（工具调用次数）
  - 在自然断点保存（测试通过后、功能完成后）
  - 接力文件内容详细具体
  - 恢复后立即向用户报告状态
  - 链式接力时累积所有历史
  - 完成后及时清理
- 强调：当不确定时，尽早保存。保存接力文件是一种防御性措施，避免工作进度丢失。

#### 2026-03-12 (v1.6.0) - AI Resources 多源架构开发约束
- **新增功能**：增加「AI Resources 开发约束」章节
- **架构支持**：
  1. 多源资源目录架构（默认源 + 扩展源）
  2. 可配置的资源目录结构
  3. 资源优先级和冲突解决机制
  4. 统一的资源加载接口（ResourceLoader）
- **配置管理**：
  - 新增 `ai-resources-config.json` 配置文件规范
  - 默认源（csp）始终优先级最高（priority=100）
  - 支持多个扩展资源源（client-sdk-ai-hub 等）
  - 灵活的目录映射（标准、Cursor 风格等）
- **开发约束**：
  - 11 条核心约束规则（目录架构、配置、加载、冲突处理等）
  - 禁止硬编码资源路径
  - 必须通过 ResourceLoader 访问资源
  - AI-Resources 目录必须在 .gitignore 中排除
- **符合性检查**：
  - 新增「AI Resources 配置符合性检查」（第 5 项检查）
  - 检查配置文件格式和必需字段
  - 检查硬编码路径和直接文件系统访问
  - 验证默认源和扩展源配置
- **文档更新**：
  - 更新「文档结构说明」，添加 @AI-Resources 目录
  - 更新「代码提交前检查清单」，添加 AI Resources 检查项
  - 更新「违规行为清单」，添加 7 种 AI Resources 相关违规
  - 更新「Git 提交控制规范」，明确 AI-Resources 目录处理
- **参考文档**：`Docs/AI-Resources-Multi-Source-Architecture.md`
- 强调：所有 AI 资源必须通过 ResourceLoader 访问，禁止硬编码路径

#### 2026-03-10 (v1.5.0) - 设计文档符合性自检模块
- **新增功能**：增加「设计文档符合性自检模块」
- **四项核心检查**：
  1. 核心架构设计符合性（参考 CSP-AI-Agent-Core-Design.md）
  2. 多线程架构符合性（参考 CSP-AI-Agent-MultiThread-Architecture.md）
  3. 日志规范符合性（参考 CSP-AI-Agent-Logging-Design.md）
  4. API 使用符合性（参考 CSP-AI-Agent-API-Mapping.md）
- **自检时机**：OpenSpec 归档前、Git 提交前、发布前必须执行
- **检查标准**：符合度必须 >= 90% 才能继续后续流程
- **检查报告**：生成结构化报告到 Docs/Compliance-Check-YYYY-MM-DD.md
- **自动化脚本**：提供 Test/check-design-compliance.sh 脚本模板
- **工作流集成**：更新「代码提交前检查清单」，新增符合性自检项
- 强调：所有重大变更完成后必须执行四项设计文档符合性检查

#### 2026-03-10 (v1.4.0) - 阶段性文档和设计偏移检查
- **重大变更**：强制要求每个研发阶段完成后创建阶段性文档
- **阶段性文档规范**：在 @Docs 创建 `Stage-[N]-[feature-name].md`
- **设计偏移检查**：研发结束后对比初始设计，检查并处理设计偏移
- 新增"阶段性测试流程"步骤 5、7（测试通过后创建文档，确认文档完成）
- 新增"阶段性文档规范"（完整的文档模板和章节要求）
- 新增"研发结束后的设计偏移检查"流程（5个步骤）
- 更新"研发阶段与测试用例映射"（每个阶段增加阶段性文档）
- 更新工作流程步骤 9（拆分为 9个子步骤：9a-9i，新增文档创建步骤）
- 新增工作流程步骤 14（设计偏移检查，6个子步骤：14a-14f）
- 更新代码提交检查清单（新增 5 项阶段性文档和设计偏移检查）
- 新增 4 种违规行为：阶段无文档、文档无关键信息、不查设计偏移、偏移未修正
- 更新不合格标准（新增 4 项阶段性文档和设计偏移相关）
- 强调：每个阶段必须创建文档记录关键实现和设计决策，研发结束后必须执行设计偏移检查

#### 2026-03-10 (v1.3.2) - 阶段性测试强制要求
- **重大变更**：强制要求每个研发阶段完成后立即创建测试用例
- **阶段性测试流程**：开发阶段 → 创建测试用例 → 运行测试 → 验证通过 → 下一阶段
- 新增"阶段性测试流程"（6个步骤）
- 新增"研发阶段与测试用例映射"示例（5个阶段示例）
- 新增"测试用例创建规范"（代码模板和命名规范）
- 更新工作流程步骤 9（拆分为 6 个子步骤：9a-9f）
- 更新代码提交检查清单（新增 2 项阶段性测试检查）
- 新增 3 种违规行为：阶段无测试、测试覆盖不全、测试未过就继续
- 更新"测试和日志要求"特殊规则（5个子规则，新增阶段性测试创建）
- 更新不合格标准（新增 3 项阶段性测试相关）
- 强调：每个阶段测试通过后，才能进入下一阶段

#### 2026-03-10 (v1.3.1) - 测试双重验证机制明确化
- **重要澄清**：明确测试验证是双重验证机制，而非单一日志验证
- **主要验证**：Test 脚本或命令行执行的直接输出结果（Pass Rate、退出码）
- **辅助验证**：@Logs 目录中的日志文件（测试记录、错误详情）
- **验证优先级**：优先查看脚本输出，日志作为辅助验证和详细分析
- 更新核心规则 #2 概览描述
- 完全重写测试验证流程（3阶段验证清单）
- 新增双重验证要点（主要验证 + 辅助验证）
- 更新工作流程步骤（分离脚本输出验证和日志验证）
- 更新代码提交检查清单（3项测试验证相关）
- 新增 3 种违规行为：只看日志、验证不一致
- 更新「测试和日志要求」特殊规则（4个子规则）
- 强调：Test 脚本输出与 Logs 日志结果必须一致

#### 2026-03-09 (v1.3.0) - 测试日志验证和发布流程规范
- **新增规则 #5**：发布流程规范（npm 优先，Git 在后）
- **核心规则数量**：从 6 条增加到 7 条
- **测试验证增强**：要求通过 @Logs 日志验证测试结果
- **重要说明**：明确 Publish 脚本是发布 SourceCode/ 目录中的 TypeScript 代码包
- 添加详细的发布流程（准备 → npm 发布 → Git 提交）
- 新增 @Publish 目录说明和脚本规范
- 新增 @SourceCode 目录结构说明
- 扩展测试验证清单，增加日志检查步骤
- 更新工作流程，增加日志验证和发布阶段（步骤 11、19-22）
- 更新代码提交检查清单，增加日志验证和发布检查
- 新增 5 种违规行为：发布顺序错误、npm失败仍提交、不查日志等
- 新增「测试和日志要求」和「发布流程要求」特殊规则
- 更新「获取帮助」章节，增加发布流程问题指引
- 强调：必须先 npm 发布成功，再进行 Git 代码提交
- 强调：所有源代码都在 SourceCode/ 目录中

#### 2026-03-09 (v1.2.2) - 明确两个独立 Git 仓库的用途
- **纠正理解偏差**：明确项目有两个独立的 Git 仓库，用途不同
- **项目代码仓库**：`https://github.com/ElliotLion-ing/CSP-AI-Agent` 用于提交项目源代码
- **AI 资源仓库**：`git@git.zoom.us:main/csp.git` 是系统设计中用于存储 AI 资源的外部仓库
- **重要变更**：`@csp` 目录应从项目提交中排除（在 .gitignore 中配置）
- **更新检查清单**：新增验证 @csp 目录未被提交的检查项
- **新增违规类型**：提交 @csp 目录属于违规行为

#### 2026-03-09 (v1.2.0) - 文档和 Git 规范
- **新增规则 #3**：自动生成文档规范（README.md 生成要求）
- **新增规则 #4**：Git 提交控制规范（强制用户确认）
- 明确 README.md 必须包含的 10 个章节
- 详细说明 Git 操作流程和确认机制
- 新增 Git 提交信息规范（type: subject 格式）
- 扩展代码提交检查清单，新增 6 项 Git 相关检查
- 更新违规行为清单，新增 5 种文档和 Git 相关违规
- 重构「特殊规则」章节，分为代码质量、Git 提交、文档生成三部分
- 强调：未经用户确认不得推送代码

#### 2026-03-09 (v1.1.0) - OpenSpec 集成
- **重大更新**：添加核心规则 #0 - OpenSpec 驱动开发流程（最高优先级）
- 详细说明 OpenSpec 三阶段工作流：创建、实施、归档
- 明确 OpenSpec 与 @Docs 的关系和同步机制
- 更新标准工作流程，整合 OpenSpec 流程
- 扩展代码提交检查清单，添加 OpenSpec 相关检查项
- 重构文档结构说明，区分整体架构和变更管理
- 更新违规行为清单，新增 7 种 OpenSpec 相关违规类型
- 新增「OpenSpec 快速参考」章节，包含常用命令和格式规范
- 强化规则：所有功能变更必须通过 OpenSpec 流程

#### 2026-03-09 (v1.0.1)
- 添加 `CSP-AI-Agent-MultiThread-Architecture.md` 到必读文档列表
- 新增「多线程架构要求」特殊规则
- 记录 ERR-2026-03-09-001: 文档遗漏错误
- 更新违规行为清单，添加「单线程阻塞」违规类型

#### 2026-03-09 (v1.0.0)
- 创建初始版本
- 定义 3 条核心规则
- 建立错误记录机制

---

## 🔍 设计文档符合性自检模块

本模块用于验证代码实现是否符合 `@Docs` 中的设计规范。在每次重大变更完成后，AI Agent 必须执行此自检流程。

---

### 自检时机

**必须执行自检的情况：**
- ✅ 完成 OpenSpec 阶段 2（实施变更）后
- ✅ 归档 OpenSpec 变更前
- ✅ 提交代码到 Git 前
- ✅ 发布新版本前
- ✅ 用户明确要求时

**可选执行自检的情况：**
- 完成单个功能模块后
- 进行架构重构时
- 发现潜在设计偏移时

---

### 自检清单

#### 1. 核心架构设计符合性检查

**参考文档**: `@Docs/CSP-AI-Agent-Core-Design.md`

```bash
# 检查项清单
□ 模块划分是否符合核心架构设计
□ 依赖关系是否符合设计文档
□ 接口定义是否与设计一致
□ 错误处理机制是否符合规范
□ 配置管理是否按设计实现
□ 资源管理（Git、文件系统）是否符合设计
```

**自检命令**:
```bash
# 1. 阅读核心架构设计
cat Docs/CSP-AI-Agent-Core-Design.md

# 2. 检查模块结构
ls -R SourceCode/src/

# 3. 检查关键模块是否存在
test -d SourceCode/src/config && echo "✅ config/" || echo "❌ config/ missing"
test -d SourceCode/src/utils && echo "✅ utils/" || echo "❌ utils/ missing"
test -d SourceCode/src/tools && echo "✅ tools/" || echo "❌ tools/ missing"
test -d SourceCode/src/api && echo "✅ api/" || echo "❌ api/ missing"
test -d SourceCode/src/git && echo "✅ git/" || echo "❌ git/ missing"
test -d SourceCode/src/filesystem && echo "✅ filesystem/" || echo "❌ filesystem/ missing"

# 4. 检查核心接口文件
test -f SourceCode/src/types/errors.ts && echo "✅ errors.ts" || echo "❌ errors.ts missing"
test -f SourceCode/src/types/tools.ts && echo "✅ tools.ts" || echo "❌ tools.ts missing"
```

**违规示例**:
- ❌ 将业务逻辑放在 utils 工具模块中
- ❌ 工具直接访问文件系统，绕过 filesystem manager
- ❌ 没有使用自定义错误类型
- ❌ 配置硬编码在代码中

---

#### 2. 多线程架构符合性检查

**参考文档**: `@Docs/CSP-AI-Agent-MultiThread-Architecture.md`

```bash
# 检查项清单
□ HTTP Server 是否支持多请求并发
□ Session 管理是否线程安全
□ 工具调用是否不阻塞主线程
□ 是否使用了适当的异步模式（async/await）
□ 长时间操作是否异步执行
□ 是否避免了单线程阻塞
```

**自检命令**:
```bash
# 1. 检查是否使用异步模式
rg "async function" SourceCode/src/ --stats | grep "async function"
rg "await " SourceCode/src/ --stats | grep "await"

# 2. 检查 HTTP Server 并发支持
rg "Fastify|express" SourceCode/src/server/

# 3. 检查是否有同步阻塞调用（潜在问题）
rg "\.sync\(" SourceCode/src/ | head -20

# 4. 检查 Session 管理的并发安全性
rg "SessionManager|sessionManager" SourceCode/src/ -A 5 | grep -E "(Map|mutex|lock)"
```

**违规示例**:
- ❌ 使用同步文件操作（`fs.readFileSync`）
- ❌ 在请求处理中使用 `sleep()` 同步等待
- ❌ Session 数据未使用线程安全的数据结构
- ❌ 单个请求阻塞整个服务器

**符合规范的实现**:
- ✅ 使用 `async/await` 处理异步操作
- ✅ 使用 Promise 处理并发请求
- ✅ Session 使用 Map + 定时清理
- ✅ HTTP Server（Fastify）支持并发

---

#### 3. 日志规范符合性检查

**参考文档**: `@Docs/CSP-AI-Agent-Logging-Design.md`

```bash
# 检查项清单
□ 所有日志是否使用结构化格式（pino）
□ 日志级别是否正确使用（debug/info/warn/error）
□ 敏感信息是否已脱敏
□ 日志是否包含必要的上下文字段
□ 错误日志是否包含错误堆栈
□ 是否使用了 logToolCall 记录工具调用
□ 日志是否输出到正确的目录
```

**自检命令**:
```bash
# 1. 检查日志导入
rg "from.*logger.*import" SourceCode/src/ | head -20
rg "logger\.(debug|info|warn|error)" SourceCode/src/ --stats

# 2. 检查是否使用了 console.log（不规范）
rg "console\.(log|error|warn|debug)" SourceCode/src/ && echo "❌ Found console.log" || echo "✅ No console.log"

# 3. 检查日志结构化字段
rg "logger\.(info|error)" SourceCode/src/tools/ -A 1 | grep -E "\{.*\}" | head -10

# 4. 检查敏感信息脱敏
rg "(password|token|secret|key)" SourceCode/src/ -i | grep logger | head -10

# 5. 检查工具调用日志
rg "logToolCall" SourceCode/src/tools/ | wc -l

# 6. 检查日志配置
cat SourceCode/src/utils/logger.ts | grep -E "(pino|logger|stream)"
```

**日志格式检查**:
```typescript
// ✅ 正确的日志格式
logger.info(
  { 
    type: 'tool',
    tool: 'sync_resources',
    userId: 'user-123',
    duration: 1500
  },
  'Resources synchronized successfully'
);

// ❌ 错误的日志格式
console.log('Resources synchronized');
logger.info('Resources synchronized for ' + userId);  // 非结构化
```

**违规示例**:
- ❌ 使用 `console.log()` 而非 `logger`
- ❌ 日志消息中包含动态值（非结构化）
- ❌ 敏感信息未脱敏（如完整 token）
- ❌ 错误日志缺少 error 对象

**符合规范的实现**:
- ✅ 使用 pino 结构化日志
- ✅ 日志包含 `type`, `operation`, `userId` 等上下文
- ✅ 敏感信息脱敏（如 `token: token.substring(0, 10) + '...'`）
- ✅ 使用 `logToolCall()` 记录工具调用

---

#### 4. API 使用符合性检查

**参考文档**: `@Docs/CSP-AI-Agent-API-Mapping.md`

```bash
# 检查项清单
□ API 端点路径是否与文档一致
□ 请求参数是否与文档定义匹配
□ 响应数据结构是否与文档一致
□ HTTP 方法是否正确（GET/POST/DELETE）
□ 认证方式是否符合规范（Bearer Token）
□ 错误处理是否覆盖文档中的错误码
```

**自检命令**:
```bash
# 1. 检查 API Client 定义
cat SourceCode/src/api/client.ts | grep -E "(get|post|put|delete).*resources"

# 2. 对比 API 端点
echo "=== 文档定义的 API ==="
grep "URL.*:" Docs/CSP-AI-Agent-API-Mapping.md | head -10

echo "=== 实际实现的 API ==="
rg "\/resources\/" SourceCode/src/api/client.ts | head -10

# 3. 检查认证实现
rg "Authorization.*Bearer" SourceCode/src/

# 4. 检查 API 调用位置
rg "apiClient\." SourceCode/src/tools/ --stats
```

**API 对比表**:

| API 端点 | 文档定义 | 实现状态 | 位置 |
|---------|---------|---------|------|
| GET /resources/search | ✅ | ✅ | api/client.ts:243 |
| GET /resources/{id} | ✅ | ❌ | 未实现 |
| GET /resources/download/{id} | ✅ | ✅ | api/client.ts:266 |
| POST /resources/upload | ✅ | ❌ | 未实现 |
| POST /resources/finalize | ✅ | ❌ | 未实现 |
| GET /resources/subscriptions | ✅ | ✅ | api/client.ts:193 |
| POST /resources/subscriptions/add | ✅ | ⚠️ | api/client.ts:218（路径不同） |
| DELETE /resources/subscriptions/remove | ✅ | ⚠️ | api/client.ts:236（路径不同） |
| GET /user/permissions | ✅ | ⚠️ | auth/token-validator.ts:44（路径不同） |

**违规示例**:
- ❌ API 路径与文档不一致（`/subscriptions` vs `/subscriptions/add`）
- ❌ 缺少文档定义的参数（如 `page`, `page_size`）
- ❌ 响应数据结构与文档不匹配
- ❌ 使用了文档未定义的 API

**符合规范的实现**:
- ✅ API 路径完全匹配文档
- ✅ 请求参数与文档一致
- ✅ 响应数据按文档格式解析
- ✅ 错误处理覆盖文档中的错误码

---

#### 5. AI Resources 配置符合性检查

**参考文档**: `@Docs/AI-Resources-Multi-Source-Architecture.md`

```bash
# 检查项清单
□ @AI-Resources 目录结构是否符合规范
□ ai-resources-config.json 是否存在且格式正确
□ 默认资源源（csp）是否存在且优先级最高
□ 扩展资源源是否正确配置
□ 资源加载是否通过 ResourceLoader
□ 代码中是否无硬编码资源路径
□ .gitignore 是否排除 AI-Resources 目录
```

**自检命令**:
```bash
# 1. 检查目录结构
test -d AI-Resources/csp/ai-resources && echo "✅ 默认资源源存在" || echo "❌ 默认资源源缺失"
test -f AI-Resources/ai-resources-config.json && echo "✅ 配置文件存在" || echo "❌ 配置文件缺失"

# 2. 验证配置文件格式
cat AI-Resources/ai-resources-config.json | python3 -m json.tool > /dev/null 2>&1 && echo "✅ JSON 格式正确" || echo "❌ JSON 格式错误"

# 3. 检查默认源配置
cat AI-Resources/ai-resources-config.json | jq '.default_source | select(.name == "csp" and .priority == 100)' && echo "✅ 默认源配置正确" || echo "❌ 默认源配置错误"

# 4. 检查资源类型目录
for type in commands skills mcp rules; do
  test -d "AI-Resources/csp/ai-resources/$type" && echo "✅ $type/ 目录存在" || echo "⚠️  $type/ 目录缺失"
done

# 5. 检查硬编码路径（违规检查）
echo "=== 检查硬编码资源路径 ==="
rg "csp/ai-resources|AI-Resources/" SourceCode/src/ --type ts -n | head -10

if [ $(rg "csp/ai-resources|AI-Resources/" SourceCode/src/ --type ts | wc -l) -gt 0 ]; then
  echo "❌ 发现硬编码资源路径"
else
  echo "✅ 无硬编码资源路径"
fi

# 6. 检查 ResourceLoader 使用
echo "=== 检查 ResourceLoader 使用情况 ==="
LOADER_COUNT=$(rg "ResourceLoader|resourceLoader" SourceCode/src/ | wc -l)
echo "ResourceLoader 引用次数: $LOADER_COUNT"

if [ "$LOADER_COUNT" -gt 0 ]; then
  echo "✅ 使用了 ResourceLoader"
else
  echo "⚠️  未使用 ResourceLoader"
fi

# 7. 检查 .gitignore
grep "AI-Resources/" .gitignore > /dev/null && echo "✅ .gitignore 正确配置" || echo "❌ .gitignore 未排除 AI-Resources"

# 8. 检查配置必需字段
echo "=== 检查配置文件必需字段 ==="
cat AI-Resources/ai-resources-config.json | jq -e '.version' && echo "✅ version 字段存在" || echo "❌ version 字段缺失"
cat AI-Resources/ai-resources-config.json | jq -e '.default_source' && echo "✅ default_source 字段存在" || echo "❌ default_source 字段缺失"
cat AI-Resources/ai-resources-config.json | jq -e '.resource_types' && echo "✅ resource_types 字段存在" || echo "❌ resource_types 字段缺失"
cat AI-Resources/ai-resources-config.json | jq -e '.loading_order' && echo "✅ loading_order 字段存在" || echo "❌ loading_order 字段缺失"
cat AI-Resources/ai-resources-config.json | jq -e '.conflict_resolution' && echo "✅ conflict_resolution 字段存在" || echo "❌ conflict_resolution 字段缺失"
```

**配置文件结构检查**:
```json
// ✅ 正确的配置文件
{
  "version": "1.0",
  "default_source": {
    "name": "csp",
    "path": "csp/ai-resources",
    "enabled": true,
    "priority": 100,
    "resources": {
      "commands": "commands",
      "skills": "skills",
      "mcp": "mcp",
      "rules": "rules"
    }
  },
  "extended_sources": [],
  "resource_types": ["commands", "skills", "mcp", "rules"],
  "loading_order": "priority_desc",
  "conflict_resolution": "highest_priority_wins"
}

// ❌ 错误的配置文件
{
  "default_source": {
    "name": "csp",
    "priority": 50  // ❌ 优先级不是 100
  }
  // ❌ 缺少 version, resource_types 等必需字段
}
```

**违规示例**:
- ❌ 配置文件缺失或格式错误
- ❌ 默认源 `csp` 不存在
- ❌ 默认源优先级不是 100
- ❌ 代码中硬编码资源路径（如 `./AI-Resources/csp/ai-resources/commands`）
- ❌ 直接使用 `fs.readdir` 访问资源目录
- ❌ AI-Resources 目录未在 .gitignore 中排除

**符合规范的实现**:
- ✅ 配置文件存在且格式正确
- ✅ 默认源配置完整且优先级为 100
- ✅ 所有资源类型目录存在
- ✅ 代码通过 ResourceLoader 访问资源
- ✅ 无硬编码资源路径
- ✅ .gitignore 正确配置

---

**自检命令**:
```bash
# 1. 检查 API Client 定义
cat SourceCode/src/api/client.ts | grep -E "(get|post|put|delete).*resources"

# 2. 对比 API 端点
echo "=== 文档定义的 API ==="
grep "URL.*:" Docs/CSP-AI-Agent-API-Mapping.md | head -10

echo "=== 实际实现的 API ==="
rg "\/resources\/" SourceCode/src/api/client.ts | head -10

# 3. 检查认证实现
rg "Authorization.*Bearer" SourceCode/src/

# 4. 检查 API 调用位置
rg "apiClient\." SourceCode/src/tools/ --stats
```

**API 对比表**:

| API 端点 | 文档定义 | 实现状态 | 位置 |
|---------|---------|---------|------|
| GET /resources/search | ✅ | ✅ | api/client.ts:243 |
| GET /resources/{id} | ✅ | ❌ | 未实现 |
| GET /resources/download/{id} | ✅ | ✅ | api/client.ts:266 |
| POST /resources/upload | ✅ | ❌ | 未实现 |
| POST /resources/finalize | ✅ | ❌ | 未实现 |
| GET /resources/subscriptions | ✅ | ✅ | api/client.ts:193 |
| POST /resources/subscriptions/add | ✅ | ⚠️ | api/client.ts:218（路径不同） |
| DELETE /resources/subscriptions/remove | ✅ | ⚠️ | api/client.ts:236（路径不同） |
| GET /user/permissions | ✅ | ⚠️ | auth/token-validator.ts:44（路径不同） |

**违规示例**:
- ❌ API 路径与文档不一致（`/subscriptions` vs `/subscriptions/add`）
- ❌ 缺少文档定义的参数（如 `page`, `page_size`）
- ❌ 响应数据结构与文档不匹配
- ❌ 使用了文档未定义的 API

**符合规范的实现**:
- ✅ API 路径完全匹配文档
- ✅ 请求参数与文档一致
- ✅ 响应数据按文档格式解析
- ✅ 错误处理覆盖文档中的错误码

---

### 自检执行流程

#### Step 1: 准备阶段

```bash
cd "/Users/ElliotDing/SourceCode/AI Explore/Cursor-AI-Agent-MCP"

# 确保在最新代码上执行
npm run build
```

#### Step 2: 执行四项检查

```bash
echo "🔍 开始设计文档符合性自检..."
echo ""

# 1. 核心架构检查
echo "1️⃣ 核心架构设计检查..."
echo "参考文档: Docs/CSP-AI-Agent-Core-Design.md"
# [执行核心架构检查命令]

# 2. 多线程架构检查
echo "2️⃣ 多线程架构检查..."
echo "参考文档: Docs/CSP-AI-Agent-MultiThread-Architecture.md"
# [执行多线程检查命令]

# 3. 日志规范检查
echo "3️⃣ 日志规范检查..."
echo "参考文档: Docs/CSP-AI-Agent-Logging-Design.md"
# [执行日志检查命令]

# 4. API 使用检查
echo "4️⃣ API 使用符合性检查..."
echo "参考文档: Docs/CSP-AI-Agent-API-Mapping.md"
# [执行 API 检查命令]

# 5. AI Resources 配置检查（新增）
echo "5️⃣ AI Resources 配置符合性检查..."
echo "参考文档: Docs/AI-Resources-Multi-Source-Architecture.md"
# [执行 AI Resources 检查命令]
```

#### Step 3: 记录检查结果

创建检查报告：`Docs/Compliance-Check-YYYY-MM-DD.md`

```markdown
# 设计文档符合性检查报告

**日期**: 2026-03-10  
**检查者**: AI Agent  
**代码版本**: v0.3.0

## 检查摘要

| 检查项 | 状态 | 符合度 | 问题数 |
|--------|------|--------|--------|
| 核心架构设计 | ✅ | 95% | 2 |
| 多线程架构 | ✅ | 90% | 3 |
| 日志规范 | ⚠️ | 85% | 5 |
| API 使用 | ⚠️ | 70% | 8 |
| AI Resources 配置 | ✅ | 90% | 3 |

## 详细结果

### 1. 核心架构设计检查

✅ **通过**: 模块划分符合设计
✅ **通过**: 依赖关系正确
⚠️ **问题**: 工具模块中发现直接文件系统操作
   - 位置: `tools/upload-resource.ts:95`
   - 建议: 使用 `filesystemManager`

### 2. 多线程架构检查

✅ **通过**: HTTP Server 支持并发
✅ **通过**: 全部使用 async/await
⚠️ **问题**: 发现同步文件操作
   - 位置: `utils/log-cleaner.ts:42`
   - 建议: 改用异步 API

### 3. 日志规范检查

✅ **通过**: 使用 pino 结构化日志
⚠️ **问题**: 发现 3 处 console.log
   - 位置: `server.ts:12`, `config/index.ts:218`, `tools/registry.ts:45`
   - 建议: 替换为 logger

### 4. API 使用检查

⚠️ **问题**: API 路径与文档不一致
   - `/subscriptions` 应为 `/subscriptions/add`
   - `/subscriptions/{id}` 应为 `/subscriptions/remove`

### 5. AI Resources 配置检查

✅ **通过**: 配置文件存在且格式正确
✅ **通过**: 默认资源源配置正确
⚠️ **问题**: 发现 2 处硬编码资源路径
   - 位置: `tools/search-resources.ts:78`, `filesystem/manager.ts:125`
   - 建议: 使用 ResourceLoader

## 改进建议

1. 【高优先级】统一 API 路径
2. 【高优先级】消除硬编码资源路径
3. 【中优先级】消除 console.log
4. 【低优先级】完善错误处理

## 总体评价

符合度: 86%  
状态: ⚠️ 需要改进
```

#### Step 4: 处理检查结果

**如果符合度 >= 90%**:
- ✅ 可以继续后续流程（归档、提交、发布）
- 记录检查通过日志
- 将报告归档到 `Docs/` 目录

**如果符合度 < 90%**:
- ⚠️ 必须修复高优先级问题
- 重新执行自检
- 达标后才能继续

---

### 自检脚本（可选）

创建自动化自检脚本：`Test/check-design-compliance.sh`

```bash
#!/bin/bash

# 设计文档符合性自检脚本

PROJECT_ROOT="/Users/ElliotDing/SourceCode/AI Explore/Cursor-AI-Agent-MCP"
cd "$PROJECT_ROOT"

REPORT_FILE="Docs/Compliance-Check-$(date +%Y-%m-%d).md"

echo "🔍 开始设计文档符合性自检..."
echo ""

# 初始化报告
cat > "$REPORT_FILE" << EOF
# 设计文档符合性检查报告

**日期**: $(date +%Y-%m-%d)  
**检查者**: AI Agent  
**代码版本**: $(grep '"version"' SourceCode/package.json | head -1 | cut -d'"' -f4)

---

EOF

# ===== 1. 核心架构检查 =====
echo "1️⃣ 核心架构设计检查..."
{
  echo "## 1. 核心架构设计检查"
  echo ""
  echo "**参考文档**: \`Docs/CSP-AI-Agent-Core-Design.md\`"
  echo ""
  
  # 检查模块结构
  if [ -d "SourceCode/src/config" ] && \
     [ -d "SourceCode/src/utils" ] && \
     [ -d "SourceCode/src/tools" ] && \
     [ -d "SourceCode/src/api" ]; then
    echo "✅ **通过**: 核心模块结构完整"
  else
    echo "❌ **失败**: 核心模块结构不完整"
  fi
  echo ""
} >> "$REPORT_FILE"

# ===== 2. 多线程架构检查 =====
echo "2️⃣ 多线程架构检查..."
{
  echo "## 2. 多线程架构检查"
  echo ""
  echo "**参考文档**: \`Docs/CSP-AI-Agent-MultiThread-Architecture.md\`"
  echo ""
  
  # 检查是否使用 async/await
  ASYNC_COUNT=$(rg "async function" SourceCode/src/ | wc -l)
  echo "- 异步函数数量: $ASYNC_COUNT"
  
  # 检查同步阻塞调用
  SYNC_ISSUES=$(rg "\.sync\(" SourceCode/src/ | wc -l)
  if [ "$SYNC_ISSUES" -gt 0 ]; then
    echo "⚠️ **警告**: 发现 $SYNC_ISSUES 处同步阻塞调用"
  else
    echo "✅ **通过**: 无同步阻塞调用"
  fi
  echo ""
} >> "$REPORT_FILE"

# ===== 3. 日志规范检查 =====
echo "3️⃣ 日志规范检查..."
{
  echo "## 3. 日志规范检查"
  echo ""
  echo "**参考文档**: \`Docs/CSP-AI-Agent-Logging-Design.md\`"
  echo ""
  
  # 检查 console.log
  CONSOLE_COUNT=$(rg "console\.(log|error|warn)" SourceCode/src/ | wc -l)
  if [ "$CONSOLE_COUNT" -gt 0 ]; then
    echo "⚠️ **警告**: 发现 $CONSOLE_COUNT 处 console.log"
    rg "console\.(log|error|warn)" SourceCode/src/ -n >> "$REPORT_FILE"
  else
    echo "✅ **通过**: 无 console.log"
  fi
  echo ""
} >> "$REPORT_FILE"

# ===== 4. API 使用检查 =====
echo "4️⃣ API 使用符合性检查..."
{
  echo "## 4. API 使用符合性检查"
  echo ""
  echo "**参考文档**: \`Docs/CSP-AI-Agent-API-Mapping.md\`"
  echo ""
  
  # 检查 API 端点定义
  API_COUNT=$(rg "async (get|post|put|delete)" SourceCode/src/api/client.ts | wc -l)
  echo "- 已实现 API 数量: $API_COUNT"
  echo ""
  
  echo "⚠️ **提示**: 请手动对比 API 端点与文档一致性"
  echo ""
} >> "$REPORT_FILE"

# ===== 生成摘要 =====
{
  echo "---"
  echo ""
  echo "## 检查完成"
  echo ""
  echo "**报告位置**: \`$REPORT_FILE\`"
  echo ""
  echo "请查看详细报告并处理发现的问题。"
} >> "$REPORT_FILE"

echo ""
echo "✅ 自检完成！报告已生成："
echo "   $REPORT_FILE"
echo ""
cat "$REPORT_FILE"
```

---

### 集成到工作流程

#### 在 OpenSpec 归档前执行

```bash
# openspec/changes/[change-id]/tasks.md 中添加

## X. 设计文档符合性自检（必需）
- [ ] X.1 执行核心架构检查
- [ ] X.2 执行多线程架构检查
- [ ] X.3 执行日志规范检查
- [ ] X.4 执行 API 使用检查
- [ ] X.5 生成检查报告
- [ ] X.6 处理发现的问题（符合度 >= 90%）
```

#### 在代码提交前执行

更新「代码提交前检查清单」：

```
代码质量：
□ 代码实现符合 OpenSpec 提案和 @Docs 规范
□ **已执行设计文档符合性自检（符合度 >= 90%）**
□ **自检报告已归档到 @Docs 目录**
□ 已运行相关测试并全部通过
...
```

---

### 常见问题处理

#### Q1: 发现设计偏移怎么办？

**处理流程**:
1. 评估偏移是否合理（技术原因、需求变更等）
2. 如果合理：
   - 更新 `@Docs` 设计文档
   - 在 OpenSpec design.md 中说明理由
   - 继续流程
3. 如果不合理：
   - 修正代码实现
   - 重新测试
   - 重新执行自检

#### Q2: 符合度低于 90% 怎么办？

**处理流程**:
1. 按优先级排序问题
2. 修复高优先级问题
3. 重新执行自检
4. 达到 90% 后继续

#### Q3: 文档过时怎么办？

**处理流程**:
1. 识别过时内容
2. 更新设计文档
3. 记录更新原因
4. 重新执行自检

---

### 自检模块维护

- 定期更新检查命令（随工具演进）
- 补充新的检查项（随规范演进）
- 记录常见问题和解决方案
- 优化自检脚本性能

---

## 📞 获取帮助

遇到不确定的情况时：

**OpenSpec 相关问题：**
1. 阅读 `@/openspec/AGENTS.md` 了解详细用法
2. 运行 `openspec list` 查看当前状态
3. 使用 `openspec validate --strict` 检查问题
4. 参考本文档的「OpenSpec 快速参考」章节

**设计和架构问题：**
1. 查阅本文档的相关规则
2. 阅读 `@Docs` 中的设计文档
3. 检查 `openspec/specs/` 中的当前规格
4. 查看 `openspec/changes/archive/` 中的历史变更

**测试和验证问题：**
1. 参考 `@Test` 中的测试用例
2. 查阅 `Test/test-cases-design.md`
3. 运行 Mock Server 进行手动验证
4. 检查 `@Logs` 日志验证测试结果

**发布流程问题：**
1. 参考 `@Publish` 中的发布脚本
2. 遵循先 npm 后 Git 的发布顺序
3. 查看版本管理规范

**仍有疑问时：**
- 向用户询问澄清
- 记录问题和解决方案到本文档

---

**重要提醒：**

> 本文档是 AI Agent 工作的最高准则。
> 所有规则都是为了保证项目质量和可维护性。
> 遵守规则不是束缚，而是高效协作的基础。

---

**版本：** 2.1.0  
**创建日期：** 2026-03-09  
**最后更新：** 2026-03-20  
**维护者：** All AI Agents

**重要提示：**
- v1.1.0 引入 OpenSpec 驱动开发作为最高优先级规则
- v1.2.0 强化文档生成和 Git 提交控制，所有代码推送必须获得用户确认
- v1.2.2 明确两个独立 Git 仓库的用途，@csp 目录应从项目提交中排除
- v1.3.0 新增测试日志验证和发布流程规范，必须先 npm 发布成功再 Git 提交
- v1.3.1 明确测试双重验证机制，优先查看脚本输出，日志作为辅助验证
- v1.3.2 强制阶段性测试，每个研发阶段完成后必须立即创建并通过测试
- v1.4.0 强制阶段性文档和设计偏移检查，记录实现并验证与初始设计的一致性
- v1.5.0 新增设计文档符合性自检模块，验证核心架构、多线程、日志、API 四大设计规范
- v1.6.0 新增 AI Resources 多源架构开发约束，支持可配置的资源目录和优先级管理
- v1.7.0 新增上下文接力规范，使用 context-relay skill 实现长任务的无缝接力
- v1.8.0 增强为 Subagent 自动接力，默认使用 Task 工具实现完全自动化的上下文接力
- **v1.8.1 🔥 关键修复：将触发条件从工具调用次数改为 Token 使用量百分比（95%阈值），解决触发时机不准确的设计漏洞**
- v1.9.0 新增 Bug 管理规范（规则 #7）：所有 Bug 必须在 `Bug/` 目录建档，含描述文件和修复方案，修复验证后归档到 `Bug/Fixed Bugs/`
- **v2.0.0 Bug 管理规范增强：修复完成后强制生成 `@Test` 专属测试用例（`test-bug-BUG-*.js`），运行测试并将结果写入 `test-result.md`，测试通过后才可归档；新增 4 种 Bug 测试相关违规类型**
- **v2.1.0 明确 Bug 归档携带规则：`test-result.md` 必须在归档前完成并存放于 Bug 文件夹内，归档时整个文件夹（含 `bug-description.md`、`fix-solution.md`、`test-result.md`）一起移入 `Bug/Fixed Bugs/`，缺少任一文件不得归档**
