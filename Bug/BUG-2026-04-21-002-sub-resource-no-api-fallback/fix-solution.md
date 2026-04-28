# Fix Solution: BUG-2026-04-21-002

## 修复版本

**v0.2.18**

## 修复方案

在 `resolveSubResource` 中引入三级优先级 fallback 链，彻底消除对本地 git checkout 的强依赖：

```
优先级 1（最高）: CSP API download
  → apiClient.downloadResource(resolvedResourceId, userToken)
  → 返回资源所有文件，包含 reference.md 等子文件
  → 不依赖任何本地 git checkout，最可靠

优先级 2: 本地文件系统 / git checkout
  → multiSourceGitManager.readResourceFiles(resourceName, resourceType)
  → 读取 Docker 挂载目录或手动 clone 的 checkout
  → git 是此层内部的最低 fallback（已有）

只有两者均失败时，才返回 RESOURCE_FILE_NOT_FOUND。
```

## 代码变更

**文件：** `SourceCode/src/tools/resolve-prompt-content.ts`

核心改动：在调用 `readResourceFiles` 之前，先尝试 `apiClient.downloadResource()`：

```typescript
// Tier 1: CSP API download
try {
  const downloadResult = await apiClient.downloadResource(resolvedResourceId, userToken || undefined);
  const apiFile = downloadResult.files.find((f) => normFilePath(f.path) === normPath);
  if (apiFile) {
    // Found via API — expand references and return
    const { expandedContent } = expandMdReferences(apiFile.content, resolvedResourceId);
    return { success: true, data: { ..., content: expandedContent, content_source: 'api' } };
  }
} catch (apiErr) {
  // API failed — fall through to local filesystem
}

// Tier 2: Local filesystem / git checkout (existing logic)
const sourceFiles = await multiSourceGitManager.readResourceFiles(resourceName, resourceType);
const localFile = sourceFiles.find(f => normFilePath(f.path) === normPath);
if (!localFile) {
  return RESOURCE_FILE_NOT_FOUND with improved error message;
}
```

**文件：** `SourceCode/src/types/tools.ts`

`content_source` 类型扩展，增加 `'api'` 值：

```typescript
// Before
content_source: 'cache' | 'generated' | 'raw_fallback';

// After
content_source: 'cache' | 'generated' | 'raw_fallback' | 'api';
```

## 验证方法

1. 在 git checkout 不可用（SSH 未配置）的 dev 环境中
2. 调用 `resolve_prompt_content(resource_id="009157d8...", resource_path="reference.md")`
3. 期望：Tier-1 API 命中，正确返回 `reference.md` 内容，`content_source: "api"`
4. 日志中应出现：`resolveSubResource: tier-1 hit — sub-file found via API download`

## 设计原则记录

> sub-resource 查找的正确优先级应为：
> **API（最可靠）→ 本地文件系统 → git（最不可靠）**
>
> git 操作不应作为主路径，因为服务器上 git SSH 权限、网络访问、checkout 时效性等均不可控。
> API 端点已包含所有文件内容，是最稳定的来源。
