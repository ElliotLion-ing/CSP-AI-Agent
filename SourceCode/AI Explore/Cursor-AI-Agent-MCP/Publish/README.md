# 📦 发布流程指南

本目录包含项目的 npm 发布脚本和 Git 提交脚本。

## 🚨 重要：发布顺序

**必须严格按照以下顺序执行：**

1. ✅ **先 npm 发布** - 将包发布到 npm registry
2. ✅ **后 Git 提交** - 将代码提交到 GitHub

**禁止逆序操作！** 如果 npm 发布失败，禁止执行 Git 提交。

---

## 📋 发布前检查清单

在开始发布流程前，请确认：

```
准备工作：
□ 所有测试已通过（100% Pass Rate）
□ 已检查 @Logs 日志验证测试结果
□ 日志中无 ERROR/FATAL 级别错误
□ README.md 已更新
□ CHANGELOG.md 已更新（如有）
□ package.json 版本号已更新
□ 依赖项已更新到最新兼容版本
□ 构建无错误（如适用）
□ 已获得用户明确确认可以发布
```

---

## 🚀 发布流程

### 阶段 1: npm 发布

```bash
# 1. 进入 Publish 目录
cd Publish

# 2. 执行 npm 发布脚本（需要用户确认）
./npm-publish.sh

# 3. 验证发布成功
npm view <package-name>@<version>

# 4. 测试安装（可选）
npm install -g <package-name>@<version>
```

### 阶段 2: Git 提交（仅在 npm 成功后）

```bash
# 1. 确认 npm 发布已成功
# 2. 执行 Git 提交脚本（需要用户确认）
./git-commit-push.sh "chore: release v<version>"

# 3. 验证推送成功
git log -1
git status
```

---

## 📜 脚本说明

### npm-publish.sh

npm 发布脚本，负责：
- 验证 package.json
- 运行构建（如需要）
- 运行测试
- 发布到 npm registry

**使用方法：**
```bash
./npm-publish.sh
```

### git-commit-push.sh

Git 提交推送脚本，负责：
- 检查 Git 状态
- 添加所有变更
- 提交代码
- 推送到远程仓库

**使用方法：**
```bash
# 使用默认提交信息
./git-commit-push.sh

# 自定义提交信息
./git-commit-push.sh "feat: add new feature"

# 指定分支
./git-commit-push.sh "fix: bug fix" "main"
```

### publish-config.json

发布配置文件，包含：
- npm registry 配置
- 版本号规则
- 发布标签（latest/beta/alpha）
- Git 仓库信息

---

## 🔢 版本管理规范

### 语义化版本（Semantic Versioning）

格式：`MAJOR.MINOR.PATCH`

- **MAJOR**：破坏性变更（不兼容的 API 修改）
- **MINOR**：新功能（向后兼容）
- **PATCH**：Bug 修复（向后兼容）

### 示例

```
1.0.0 → 1.0.1  (Bug 修复)
1.0.1 → 1.1.0  (新功能)
1.1.0 → 2.0.0  (破坏性变更)
```

### 预发布版本

```
1.0.0-alpha.1  (内部测试)
1.0.0-beta.1   (公开测试)
1.0.0-rc.1     (候选版本)
```

---

## ⚠️ 失败处理

### npm 发布失败

```
问题：npm 发布失败
原因：权限、网络、版本冲突等

处理步骤：
1. ❌ 停止发布流程，不执行 Git 提交
2. 🔍 分析失败原因
3. 🛠️ 修复问题
4. 🔄 重新执行 npm 发布
5. ✅ npm 成功后再执行 Git 提交
```

### Git 提交失败

```
问题：Git 提交/推送失败
原因：冲突、权限、网络等

处理步骤：
1. ℹ️ npm 包已成功发布，无需回滚
2. 🔍 分析 Git 问题（冲突、权限等）
3. 🛠️ 修复问题（解决冲突、检查权限）
4. 🔄 重新执行 Git 提交脚本
5. ✅ 确认代码已成功推送
```

---

## 🔐 权限要求

### npm 发布权限

- 需要有 npm 账号
- 需要有包的发布权限
- 需要登录 npm（`npm login`）
- 需要配置正确的 registry

### Git 推送权限

- 需要有仓库的写权限
- 需要配置 SSH key 或 Personal Access Token
- 需要有目标分支的推送权限

---

## 📊 发布日志

建议在每次发布后记录：

```markdown
### v1.0.0 (2026-03-09)

**npm 发布**:
- 包名：<package-name>
- 版本：1.0.0
- 标签：latest
- 发布时间：2026-03-09 10:00:00
- 发布人：<developer>

**Git 提交**:
- 仓库：https://github.com/ElliotLion-ing/CSP-AI-Agent
- 分支：main
- Commit Hash：abc1234
- 提交时间：2026-03-09 10:05:00

**变更内容**:
- 初始版本发布
- 实现核心功能
- 完成文档
```

---

## 🔗 相关文档

- [@AGENTS.md](../AGENTS.md) - AI Agent 工作规范（核心规则 #5）
- [@Docs](../Docs/) - 系统设计文档
- [@Test](../Test/) - 测试文档和脚本
- [@Logs](../Logs/) - 日志文件目录

---

## 💡 最佳实践

1. **每次发布前运行完整测试**
2. **检查日志确认无错误**
3. **更新 CHANGELOG.md**
4. **更新版本号（package.json）**
5. **先 npm 发布，再 Git 提交**
6. **验证 npm 包可正常安装**
7. **记录发布日志**

---

**版本：** 1.0.0  
**创建日期：** 2026-03-09  
**最后更新：** 2026-03-09  
**维护者：** All Developers
