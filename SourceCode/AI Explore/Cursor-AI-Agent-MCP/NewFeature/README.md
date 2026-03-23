# NewFeature — 活跃中的 Feature 设计文档

本目录存放**正在设计或开发中**的新功能设计文档。

## 目录结构

```
NewFeature/
└── FEAT-YYYY-MM-DD-序号-简短标题/
    └── feature-design.md       # Feature 设计文档
```

## 使用规则

- 每当用户提出新功能需求，AI Agent 自动在此创建对应文件夹并生成 `feature-design.md`
- 设计文档须经用户**明确确认**后方可进入 OpenSpec 驱动的开发阶段
- 开发、测试完成并通过用户确认后，整个 Feature 文件夹**归档到 `Docs/FeatureDocs/`**，本目录随即清空对应子目录
- 本目录**仅保留进行中的 Feature**，已完成的不在此处

## 命名规范

```
FEAT-YYYY-MM-DD-序号-简短标题（kebab-case）

示例：
  FEAT-2026-03-20-001-per-request-user-token
  FEAT-2026-03-21-001-workflow-engine
```

## 参见

- 归档目录：`Docs/FeatureDocs/`
- 测试报告：`Test/Test Reports/`
- 完整规则：`AGENTS.md` 规则 #10
