# Bug: SKILL.md 内引用的其他 Markdown 文件未被解析和下发

**Bug ID:** BUG-2026-04-21-001  
**发现日期:** 2026-04-21  
**严重程度:** High  
**状态:** Open  
**报告者:** 用户反馈

---

## 问题描述

当用户通过 `resolve_prompt_content` 获取 Skill 的 SKILL.md 内容时，SKILL.md 中可能引用了同一 Skill 目录下的其他 Markdown 文件（如 `references/reference.md`）。由于这些被引用的 Markdown 文件既不会被内联到 SKILL.md 内容中，也不会以 local action 的形式下发到用户本地，导致 Agent 在尝试读取这些文件时找不到对应内容，从而无法正常执行 Skill 的完整指令。

**典型场景（winzr-cpp-expert）：**

```markdown
# winzr-cpp-expert

## Instructions

### For Code Writing
1. 阅读现有代码与上下文
2. 按 [reference.md](./reference.md) 的要求编写或修改代码  ← 引用了内部 md
3. 遵循 reference.md 中定义的系统化评审流程

### For Code Review
1. 阅读待评审的代码/diff
2. 遵循 [reference.md](./reference.md) 中定义的系统化评审流程  ← 再次引用
```

Agent 按照指令去 `~/.csp-ai-agent/skills/winzr-cpp-expert/references/reference.md` 读取文件，但该文件从未被下发到本地，**文件不存在**。

---

## 复现步骤

1. 订阅并 sync 一个 SKILL.md 中含有 `[text](./relative/path.md)` 引用的 Skill（如 `winzr-cpp-expert`）
2. 调用 `resolve_prompt_content` 获取该 Skill 内容
3. Agent 按照 SKILL.md 的指令尝试读取被引用的 `reference.md`
4. 读取失败：文件不存在于 `~/.csp-ai-agent/skills/<name>/` 路径下

---

## 根因（初步）

在 `sync-resources.ts` 处理 skill 类型资源时（第 468–481 行），仅将 `SKILL.md` 的内容作为 `rawContent` 注册进 `PromptManager`。其他 Markdown 文件（如 `references/reference.md`）虽然已被 API 或 git checkout 读取到 `sourceFiles` 数组中，但：

1. **不是非 md 脚本文件** → 不进入 `scriptFiles` 过滤，不生成 `write_file` local action
2. **不是主 SKILL.md** → 不被放入 `rawContent`
3. **结果：直接丢弃** — 既不内联，也不下发

```typescript
// sync-resources.ts ~L516
const scriptFiles = sourceFiles.filter(f =>
  !f.path.endsWith('.md') &&      // ← 所有 .md 都被过滤掉，包括 reference.md
  f.path !== 'SKILL.md' &&
  !f.path.endsWith('/SKILL.md')
);
```

---

## 影响范围

- **受影响资源类型：** `skill`、`command`（含内部 Markdown 引用的所有资源）
- **受影响流程：** `sync_resources` + `resolve_prompt_content` 调用链
- **受影响用户：** 所有订阅了含内部 md 引用 Skill 的用户
- **已知受影响资源：** `winzr-cpp-expert`（引用 `references/reference.md`）

---

## 期望行为

Agent 调用 `resolve_prompt_content` 拿到 SKILL.md 内容后，其中所有内部 md 引用应被替换为**强制性的 `resolve_prompt_content` tool call 指令**，Agent 读到该指令时确定性地再次调用 tool 获取子文件内容，实现懒加载：

- 首次调用：`resolve_prompt_content(resource_id="xxx")` → 返回主 SKILL.md，引用链接已替换为 tool call 指令
- Agent 读到指令后调用：`resolve_prompt_content(resource_id="xxx", resource_path="references/reference.md")` → 返回子文件内容，若子文件内还有引用，同样替换为 tool call 指令（支持任意层嵌套）

**关键约束：**
- 不内联任何 md 文件内容，防止上下文膨胀
- 不生成任何 md 相关的 write_file local action
- 嵌套引用（A→B→C）天然支持，每层按需展开
- tool call 指令为强制格式，Agent 确定性执行，不依赖 Agent 自主判断
