# Fixed Bugs 归档区

本目录存放所有已修复并验证通过的 Bug 档案。

**归档规则：**
- 本目录内容只读，已归档的文件不得修改
- 每个子文件夹对应一个已修复的 Bug，包含原始描述和修复方案
- 归档操作：将 `Bug/` 根目录下的 Bug 文件夹整体移入此目录

## 归档记录

### 2026-04-07

1. **BUG-2026-04-07-002-complex-skill-sync-skipped** (High)
   - 修复版本: v0.2.4
   - 提交: 7001771
   - 问题: incremental 模式下复杂 skill 脚本未同步
   - 方案: API 优先检测脚本，绕过 Git scan

2. **BUG-2026-04-07-001-check-mode-container-filesystem** (High)
   - 修复版本: v0.2.3
   - 提交: e9d0e3d
   - 问题: check 模式在服务器容器内检查文件
   - 方案: 使用 check_file LocalAction 客户端比对

### 2026-03-31

3. **BUG-2026-03-31-001-search-accuracy-issue** (Medium)
   - 修复版本: v0.2.0
   - 问题: 搜索结果准确性问题

### 2026-03-27

4. **BUG-2026-03-27-002-prompt-get-not-triggered** (High)
   - 修复版本: v0.1.x
   - 问题: Prompt 获取未触发

5. **BUG-2026-03-27-001-hash-calculation-mismatch** (Critical)
   - 修复版本: v0.1.x
   - 问题: 哈希计算不匹配导致增量同步失败

### 2026-03-20

6. **BUG-2026-03-20-002-upload-resource-type-detection-and-naming** (Medium)
   - 修复版本: v0.1.x
   - 问题: 上传资源类型检测和命名问题

7. **BUG-2026-03-20-001-hardcoded-csp-api-token** (Critical)
   - 修复版本: v0.1.x
   - 问题: CSP API Token 硬编码（安全漏洞）

> 详细规则见 `AGENTS.md` — 规则 #7 Bug 管理规范
