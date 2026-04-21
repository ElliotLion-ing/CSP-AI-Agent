# BUG-2026-04-21-002: resolveSubResource 仅依赖本地 git checkout，无 API fallback

## 基本信息

| 项目 | 内容 |
|------|------|
| **Bug ID** | BUG-2026-04-21-002 |
| **发现日期** | 2026-04-21 |
| **严重程度** | High |
| **影响版本** | v0.2.17 及之前 |
| **发现方式** | Release Check Checklist Case 10 执行失败，日志分析 |
| **状态** | 已修复（v0.2.18） |

---

## 问题描述

`resolve_prompt_content(resource_path="reference.md")` 在 dev 服务器环境上返回 `RESOURCE_FILE_NOT_FOUND`，即使该文件在 GitLab 远端仓库中确实存在。

## 根因

`resolveSubResource` 函数在查找子文件时**只走本地文件系统（git checkout 目录）**，没有任何 API fallback。

```typescript
// 修复前：唯一的查找路径
const sourceFiles = await multiSourceGitManager.readResourceFiles(resourceName, resourceType);
const target = sourceFiles.find(f => normFilePath(f.path) === normPath);
if (!target) {
  return RESOURCE_FILE_NOT_FOUND;  // 直接失败，无 fallback
}
```

而 `downloadResource(resourceId)` API 端点本来就会返回该资源的**所有文件**（包括 `reference.md`），完全不依赖本地 git checkout。

## 日志证据

来自服务器 `app.2026-04-21.1.log`（UTC `07:35:28`）：

```json
{ "msg": "AI-Resources base resolved", "aiResourcesBase": "/AI-Resources" }
{ "msg": "readResourceFiles: trying source",
  "tryDirPath": "/AI-Resources/csp/ai-resources/skills/winzr-cpp-expert" }
{ "msg": "readResourceFiles: resource not found in this source — trying next" }
{ "msg": "readResourceFiles: resource not found in any git source" }
{ "msg": "resolve_prompt_content: requested sub-resource file not found in git checkout",
  "availablePaths": [] }
```

同时 git clone 全天均以 SSH 权限失败（`error: cannot run ssh: No such file or directory`），导致 `/AI-Resources/csp` 目录从未成功建立。

## 直接触发条件

服务器 git clone 失败（SSH 不可用）导致 `/AI-Resources/csp/` 目录为空，而 `resolveSubResource` 没有 API fallback 只能返回空列表。

## 为何其他 Case 不受影响

`sync_resources` 订阅 skill 时走的是 `downloadResource(resourceId)` API，API 有文件则直接使用，不需要 git checkout。只有 `resolveSubResource`（懒加载子文件专用）强依赖本地文件系统，才出现此问题。

## 影响范围

所有 SKILL.md 中包含 `[MANDATORY] resolve_prompt_content(resource_path=...)` 的子文件懒加载，在 git checkout 不可用时全部失败。
