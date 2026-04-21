# Bug: upload_resource Incorrect Type Detection and Auto-Naming

**Bug ID:** BUG-2026-03-20-002  
**发现时间:** 2026-03-20  
**发现人:** Elliot Ding  
**严重程度:** High  
**状态:** In Progress  

---

## Bug 描述

`upload_resource` 工具存在两个关联问题：

### 问题 1：上传单个 .md 文件被错误识别为 skill 并改名为 SKILL.md

用户上传一个普通 `.md` 文件时，工具将其类型识别为 `skill`，并将文件路径重命名为 `SKILL.md`，导致用户实际上传的是一个 `command`（单一 `.md` slash-command 文件）却被当成 skill 处理。

### 问题 2：用户未提供 name 时不使用文件名作为资源名称

`name` 字段未填写时，代码回退到 `resource_id`（`name: typedParams.name ?? resourceId`），但 `resource_id` 是一个内部唯一标识符，不适合作为人类可读的资源名称。正确行为应是从上传文件名中提取名称（去掉扩展名）作为默认 `name`。

### 正确的资源类型判断规则（用户定义）

| 上传内容 | 判断结果 |
|---------|---------|
| 单一 `.md` 文件 | `command` |
| 目录/多文件，含 `SKILL.md` | `skill` |
| 单一 `.mdc` 文件 | `rule` |
| 含 `mcp-config.json` 的目录 | `mcp` |

## 复现步骤

### 复现问题 1（.md 被当 skill）

1. 调用 `upload_resource`，传入：
   ```json
   {
     "type": "skill",
     "files": [{ "path": "my-command.md", "content": "# My Command\n..." }]
   }
   ```
2. 观察工具描述中说明：`path: "SKILL.md"` 是 skill 的示例
3. AI Agent 按照 tool description 的指引，将文件命名为 `SKILL.md` 上传

**预期结果：** 单一 `.md` 文件应被识别/建议为 `command` 类型，保留原文件名

**实际结果：** 文件被重命名为 `SKILL.md`，类型设为 `skill`

### 复现问题 2（name 未使用文件名）

1. 调用 `upload_resource`，传入：
   ```json
   {
     "resource_id": "res-20260320-001",
     "type": "command",
     "files": [{ "path": "code-review.md", "content": "..." }]
   }
   ```
   （不传 `name` 字段）
2. 检查上传到 CSP API 的 `name` 字段值

**预期结果：** `name` = `"code-review"`（取自文件名去扩展名）

**实际结果：** `name` = `"res-20260320-001"`（使用了 resource_id）

## 受影响的文件

- `SourceCode/src/tools/upload-resource.ts`：
  - `resourceName` 计算逻辑（第 84 行）：`typedParams.name ?? resourceId`
  - 工具 `description` 字段中的示例引导 AI 将 `.md` 命名为 `SKILL.md`
  - `inputSchema.properties.type.description` 中缺少自动推断说明

## 环境信息

- 操作系统: macOS
- 相关文件: `SourceCode/src/tools/upload-resource.ts`
