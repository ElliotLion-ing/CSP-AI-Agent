# ⚠️ 文件已迁移

本文件已迁移至 Release Check 目录，请使用新路径：

**Checklist：** [`Test/Release Check/release-check-checklist.md`](Release%20Check/release-check-checklist.md)  
**Report 模板：** [`Test/Release Check/Reports/release-check-report-template.md`](Release%20Check/Reports/release-check-report-template.md)

---

迁移原因：将手动交互测试正式纳入发布门禁流程（Release Check），作为每次生产发布前的强制 Check 步骤。

新版本（v1.3.0）相比原版本新增：
- **Case 10**：winzr-cpp-expert md 引用懒加载链路端到端验证（BUG-2026-04-21-001 回归）
- 明确 dev 环境执行、Report 归档要求
- 发布生产的门禁说明
