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

## 修复记录

### 2026-04-07

#### BUG-2026-04-07-002: Complex Skill Sync Skipped (High)
- **问题**: incremental 模式下 ~/.csp-ai-agent/skills/ 脚本未同步
- **根因**: HYBRID SYNC 依赖 Git scan，但 Git clone 失败导致误判为 "simple skill"
- **影响**: zoom-build 等复杂 skill 的脚本无法执行
- **修复方案**: 优先使用 API 下载的 files[] 检测脚本，Git scan 降级为 fallback
- **修复版本**: v0.2.4
- **提交**: 7001771
- **测试**: 7/7 passed (test-complex-skill-api-priority.js)
- **性能提升**: API 检测比 Git scan 快 50-100x

#### BUG-2026-04-07-001: Check Mode Container Filesystem (High)
- **问题**: check 模式在 MCP Server 容器内检查文件，而非用户本地
- **根因**: check 逻辑使用 fs.access() 检查服务器路径 (/root/.cursor/)
- **影响**: 每次 check 都报告不一致，要求 sync（即使文件已同步）
- **修复方案**: 生成 check_file LocalAction，由 AI Agent 在客户端比对
- **修复版本**: v0.2.3
- **提交**: e9d0e3d
- **跨平台支持**: Windows (多路径检查) + macOS + .csp-ai-agent 目录

> 详细规则见 `AGENTS.md` — 规则 #7 Bug 管理规范
