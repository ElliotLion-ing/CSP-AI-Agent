# Bug 档案库

本目录是项目的 Bug 管理中心。所有已发现的 Bug 必须在此建档，遵循 `AGENTS.md` 规则 #7。

## 目录结构

```
Bug/
├── Fixed Bugs/                              # 已修复归档区（只读）
│   └── BUG-YYYY-MM-DD-序号-简短标题/
│       ├── bug-description.md               # 原始 Bug 描述
│       └── fix-solution.md                  # 修复方案
│
└── BUG-YYYY-MM-DD-序号-简短标题/            # 活跃中的 Bug
    ├── bug-description.md
    └── fix-solution.md                      # 修复完成后补充
```

## 文件夹命名规范

```
BUG-YYYY-MM-DD-序号-简短标题（英文，kebab-case）
例：BUG-2026-03-20-001-workflow-card-buttons-not-clickable
```

## Bug 处理流程

1. **发现 Bug** → 在 `Bug/` 根目录创建以 `BUG-` 开头的文件夹
2. **建档** → 编写 `bug-description.md`（必须包含复现步骤）
3. **修复** → 代码改动
4. **记录方案** → 编写 `fix-solution.md`（必须包含根因和验证方法）
5. **验证** → 按 `fix-solution.md` 的验证方法确认修复有效
6. **归档** → 将整个 Bug 文件夹移入 `Fixed Bugs/`

## 严重程度说明

| 级别 | 含义 |
|------|------|
| Critical | 功能完全不可用，阻塞主流程 |
| High | 核心功能受损，影响大多数用户 |
| Medium | 功能部分受损，有 workaround |
| Low | 体验问题或边缘 case |

> 详细规则见 `AGENTS.md` — 规则 #7 Bug 管理规范
