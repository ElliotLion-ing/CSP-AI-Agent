# Fix Solution: upload_resource Type Detection and Auto-Naming

**Bug ID:** BUG-2026-03-20-002  
**修复人:** Cursor AI Agent  
**修复时间:** 2026-03-20  
**验证状态:** ✅ 编译通过  

---

## 根本原因分析

### 问题 1（错误类型识别 + 改名 SKILL.md）

根本原因在于 **Tool description** 中的示例错误引导了 AI Agent：

```
'Examples (type="skill"): [{path: "SKILL.md", content: "..."}]'
```

AI Agent 看到这个示例后，将所有单 `.md` 文件也命名为 `SKILL.md` 上传，并将类型设为 `skill`。同时代码层面没有对文件名进行自动类型推断，只依赖调用方传入的 `type`。

### 问题 2（name 未使用文件名）

`resourceName` 的计算逻辑是 `typedParams.name ?? resourceId`，当用户未填 `name` 时回退到 `resource_id`（一个内部标识符如 `res-20260320-001`），而非从文件名中提取有意义的名称。

## 修复方案

### 新增 `inferResourceType()` 函数（用户优先）

**用户明确指定类型时，直接使用，不做任何覆盖。**  
只有用户未指定时，才从文件结构自动推断：

| 检测条件 | 推断类型 |
|---------|---------|
| 包含 `mcp-config.json` | `mcp` |
| 包含 `SKILL.md`（大小写不敏感） | `skill` |
| 单一 `.mdc` 文件 | `rule` |
| 单一 `.md` 文件 | `command` |
| 无法判断 | 抛出错误，要求用户显式指定 |

`type` 字段在 inputSchema 中改为**可选**（不在 `required` 列表）。

### 新增 `deriveNameFromFiles()` 函数

从文件列表提取人类可读的名称：
- 多文件上传（skill/mcp）：取第一个文件路径中的目录名（`code-review/SKILL.md` → `code-review`）
- 单文件上传：取文件名去掉扩展名（`code-review.md` → `code-review`）

### 修改 `resourceName` 计算逻辑

```typescript
// 旧代码（错误：回退到 resource_id）
const resourceName = typedParams.name ?? resourceId;

// 新代码（正确：回退到文件名，不能推导时报错）
const derivedName = typedParams.name ?? deriveNameFromFiles(typedParams.files);
if (!derivedName) throw createValidationError(...);
const resourceName = derivedName;
```

`resource_id` 不再参与 `name` 的推导，它仅作为内部标识符使用。

### `collectFiles` 增强 MCP 缺失提示

当用户明确指定 `type="mcp"` 但未提供 `mcp-config.json` 时，检查其他已上传文件（如 `.toml`、`.json`、`.py`、`README.md` 等），在错误信息中列出这些文件名，并提示用户基于这些文件创建 `mcp-config.json`。

### 更新 Tool description 和 schema

- 明确说明：**用户指定类型优先，不覆盖**
- 明确说明：**保留原始文件名，不改名**
- 说明 name 从文件名自动推导，不回退到 resource_id
- `type` 字段从 `required` 中移除（改为可选）

## 修改的文件

| 文件 | 修改位置 | 说明 |
|------|---------|------|
| `src/tools/upload-resource.ts` | 新增 `inferResourceType()` | 按规则自动推断类型 |
| `src/tools/upload-resource.ts` | 新增 `deriveNameFromFiles()` | 从文件名提取资源名称 |
| `src/tools/upload-resource.ts` | `resourceType` / `resourceName` 计算 | 使用新函数替代硬编码逻辑 |
| `src/tools/upload-resource.ts` | `description` 字段 | 明确说明类型自动检测规则和命名规则 |
| `src/tools/upload-resource.ts` | `type` inputSchema description | 说明 auto-detect 优先 |

## 验证方法

1. 上传单个 `.md` 文件不传 `name`，观察：
   - `type` 应为 `command`
   - `name` 应为文件名（去扩展名）
2. 上传包含 `SKILL.md` 的文件集，观察 `type` 应为 `skill`
3. 上传单个 `.mdc` 文件，观察 `type` 应为 `rule`
4. 上传包含 `mcp-config.json` 的文件集，观察 `type` 应为 `mcp`
5. 编译验证：`npm run build` 成功（已验证，exit code 0）

## 预防措施

- Tool description 明确禁止 AI Agent 将 `.md` 文件改名为 `SKILL.md`
- 类型推断逻辑在服务器端执行，不依赖 AI Agent 的判断
- `name` 自动从文件名提取，减少用户填写负担
