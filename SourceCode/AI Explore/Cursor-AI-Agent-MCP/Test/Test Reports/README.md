# Test/Test Reports — Feature 测试报告归档

本目录存放所有新功能开发完成后生成的测试报告。

## 目录结构

```
Test/Test Reports/
└── FEAT-YYYY-MM-DD-序号-简短标题/
    └── test-report.md          # Feature 测试报告
```

## 测试报告内容

每份 `test-report.md` 必须包含：
- Feature ID 和测试时间
- 脚本输出（Pass Rate、各用例状态）—— 主要验证
- 日志验证摘要 —— 辅助验证
- 测试用例明细表
- 结论（是否通过、是否可归档）

## 归档条件

- 测试报告**须经用户明确确认**后方可归档
- 归档时必须创建对应 Feature 的子文件夹，不得将报告直接放在根目录

## 参见

- Feature 设计归档：`Docs/FeatureDocs/`
- Bug 测试报告：`Bug/Fixed Bugs/`（Bug 专属，不在此处）
- 完整规则：`AGENTS.md` 规则 #10
