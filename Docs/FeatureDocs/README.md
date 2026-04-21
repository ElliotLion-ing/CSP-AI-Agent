# Docs/FeatureDocs — 已归档的 Feature 设计文档

本目录存放**已完成开发并通过测试验证**的新功能设计文档归档。

## 目录结构

```
Docs/FeatureDocs/
└── FEAT-YYYY-MM-DD-序号-简短标题/
    └── feature-design.md       # 归档的 Feature 设计文档
```

## 归档条件

Feature 必须满足以下全部条件才可归档：
1. ✅ 开发完成，所有测试用例通过（100% Pass Rate）
2. ✅ 测试报告已生成（`test-report.md`）
3. ✅ 测试报告已经用户确认
4. ✅ OpenSpec 已执行 `openspec archive`
5. ✅ `Docs/Design/` 中的核心设计文档已同步更新

## 参见

- 活跃 Feature：`NewFeature/`
- 测试报告：`Test/Test Reports/`
- 完整规则：`AGENTS.md` 规则 #10
