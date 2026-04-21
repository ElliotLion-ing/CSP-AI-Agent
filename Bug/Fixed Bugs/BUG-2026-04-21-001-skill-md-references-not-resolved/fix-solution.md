# Fix Solution: SKILL.md 内引用的其他 Markdown 文件未被解析和下发

**Bug ID:** BUG-2026-04-21-001  
**修复日期:** 2026-04-21  
**修复版本:** v2（懒加载方案，替换 v1 内联方案）

---

## 根因分析

`sync-resources.ts` 处理 skill 资源时，`sourceFiles` 中的所有非主 md 文件（如 `references/reference.md`）被 `scriptFiles` 过滤器静默丢弃，既不内联到 `rawContent`，也不下发到用户本地，导致 Agent 读取 SKILL.md 后无法获取被引用文件的内容。

---

## 修复方案：懒加载 tool call 替换

### 为何放弃 v1 内联方案

v1 方案（≤30KB 内联，>30KB write_file local action）存在以下问题：

1. **上下文膨胀**：SKILL.md 30KB + 内联 md 20KB = 50KB，Agent 即使不需要这些内容也被强制加载
2. **剥夺 Agent 自主性**：内联后 Agent 无法按需读取，无法跳过不相关内容
3. **嵌套 bug**：Track B（大文件）不递归处理其内部引用，A→B→C 场景下 B、C 的引用全部丢失
4. **额外本地写入**：大文件需要 write_file local action，增加用户本地操作复杂度

### v2 方案：引用 → 强制 tool call 指令

**核心思路：** 将 SKILL.md 中所有内部 md 引用替换为结构化的 `resolve_prompt_content` tool call 指令，Agent 读到时确定性执行 tool call 按需获取内容。

**替换格式：**

原始 SKILL.md：
```markdown
按 [reference.md](./reference.md) 的要求编写代码
```

替换后：
```markdown
按以下规范编写代码（**必须先通过工具调用获取规范内容**）：

<!-- SKILL_RESOURCE_REF: reference.md -->
**[MANDATORY - 立即执行，不可跳过]** 调用以下工具获取必要内容后再继续：
```json
{"tool": "resolve_prompt_content", "arguments": {"resource_id": "009157d8ed498e93c0dbdbdbd47ae40c", "resource_path": "reference.md"}}
```
<!-- END_SKILL_RESOURCE_REF -->
```

**嵌套支持：** `resolve_prompt_content(resource_id, resource_path)` 服务端同样扫描子文件内容，替换其中的引用为 tool call 指令，返回替换后内容。A→B→C 天然支持，每层按需展开。

---

## 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `src/utils/md-reference-expander.ts` | **重构** | 移除内联和 largeFileActions 逻辑，改为生成 tool call 指令替换 |
| `src/tools/resolve-prompt-content.ts` | **修改** | 新增 `resource_path` 参数，支持读取 skill 内部子 md 文件 |
| `src/types/tools.ts` | **修改** | `ResolvePromptContentParams` 新增 `resource_path` 字段 |
| `src/tools/sync-resources.ts` | **修改** | 移除 `largeFileActions` md 相关逻辑，`expandedContent` 替换调用新版 expander |

---

## 各方案对比

| 维度 | v1 内联方案 | v2 懒加载方案 |
|------|------------|-------------|
| 首次上下文消耗 | SKILL.md + 所有小 md | 只有 SKILL.md 本身 |
| Agent 自主性 | 被强制内联 | 按需调用，但调用是强制的 |
| 嵌套支持 | 有 bug（Track B 不递归） | 天然支持任意层级 |
| 本地写入 | 有大文件 write_file action | 零 md 相关 local action |
| 30KB 阈值判断 | 需要 | 不需要 |
