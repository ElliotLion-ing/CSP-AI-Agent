# Bug Description

**Bug ID:** BUG-2026-03-31-001  
**Title:** Search accuracy issue - "build" returns irrelevant results  
**Severity:** Medium  
**Type:** Functionality / Search Quality  
**Reported by:** User  
**Reported at:** 2026-03-31  

---

## Problem Summary

当用户搜索 "build" 关键词时，`search_resources` 工具返回 3 个结果，其中只有 1 个真正相关，另外 2 个是误匹配：

- ✅ **zoom-build** - 正确结果（description: "触发 Jenkins 构建..."）
- ❌ **hang-log-analyzer** - 误匹配（description 中包含 "**builds** timeline"）
- ⚠️ **release-log-review** - 半相关（description 中包含 "**build** info"）

## Reproduction Steps

1. 调用 MCP 工具：
   ```javascript
   search_resources({ keyword: "build" })
   ```

2. 观察返回结果：
   ```json
   {
     "total": 3,
     "results": [
       { "name": "hang-log-analyzer", "score": 0, ... },
       { "name": "zoom-build", "score": 0, ... },
       { "name": "release-log-review", "score": 0, ... }
     ]
   }
   ```

3. 对比使用更精确的关键词（"构建"、"jenkins"、"出包"）：
   - 这些关键词都只返回 1 个正确结果：`zoom-build`

## Root Cause Analysis

### 1. 后端搜索算法过于简单

后端的 `/csp/api/resources/search` 端点应该是使用**全文模糊匹配**（类似 SQL `LIKE '%keyword%'`），没有考虑：

- **整词匹配优先**：
  - "build" 不应该匹配 "builds"（复数形式）
  - "build" 作为动词和名词应该有不同的语义权重

- **字段权重**：
  - `name` 字段匹配应该比 `description` 字段权重更高
  - 关键词在 description 开头出现应该比在中间/末尾权重更高

- **无评分机制**：
  - 所有结果的 `score` 都是 `0`
  - 无法根据相关性排序

### 2. 误匹配案例分析

**Case 1: hang-log-analyzer**
```
Description: "Extracts main thread ID, builds timeline, locates..."
                                    ^^^^^^ 
误匹配原因：description 中包含 "builds"（动词，"构建时间线"）
实际相关性：与用户搜索的 "build"（构建/出包）完全不相关
```

**Case 2: release-log-review**
```
Description: "Analyzes build info, login, database/storage..."
                      ^^^^^ 
半相关原因：description 中包含 "build info"
实际相关性：与构建有些关系，但主要功能是 release check 而非构建操作
```

### 3. 前端无能为力

前端 MCP 工具（`SourceCode/src/tools/search-resources.ts`）只是简单调用后端 API：

```typescript
const searchResults = await apiClient.searchResources(
  { team, type, keyword },
  userToken
);
```

前端无法改进搜索质量，因为：
- 后端返回的结果已经是过滤后的
- 前端只能接受后端的 `score` 排序
- 前端没有访问完整数据库的能力

## Expected Behavior

搜索 "build" 应该返回：

1. **Primary Results（主要结果）**：
   - `zoom-build`（name 或 description 中 "build" 是核心关键词）

2. **Secondary Results（次要结果，可选）**：
   - `release-log-review`（description 中提到 "build info"，有一定关联）

3. **Should NOT Return（不应返回）**：
   - `hang-log-analyzer`（"builds timeline" 中的 "builds" 与搜索意图完全不相关）

## Impact

- **用户体验下降**：用户需要手动过滤不相关结果
- **搜索效率降低**：3 个结果中只有 1 个有用，浪费用户时间
- **对 AI Agent 的困扰**：AI 可能会选错资源或给用户推荐不相关的工具
- **资源推荐准确性受损**：影响 CSP AI Agent 的资源推荐功能

## Evidence

### Test 1: 搜索 "build"
```bash
search_resources({ keyword: "build" })
# 返回 3 个结果（2 个误匹配）
```

### Test 2: 搜索 "构建"（中文）
```bash
search_resources({ keyword: "构建" })
# 返回 1 个结果（正确）✅
```

### Test 3: 搜索 "jenkins"
```bash
search_resources({ keyword: "jenkins" })
# 返回 1 个结果（正确）✅
```

### Test 4: 搜索 "出包"（中文）
```bash
search_resources({ keyword: "出包" })
# 返回 1 个结果（正确）✅
```

### Conclusion

- 英文关键词 "build" 匹配过于宽泛，返回不相关结果
- 中文关键词 "构建"、"出包" 或更具体的英文关键词 "jenkins" 匹配准确
- 说明后端搜索逻辑缺乏语义理解和评分机制

## Related Files

### Frontend（MCP 工具层 - 无需修改）
- `SourceCode/src/tools/search-resources.ts` - 前端只是 API 调用者
- `SourceCode/src/api/client.ts` - HTTP 客户端

### Backend（需修改 - 不在当前仓库）
- 后端 API 端点：`/csp/api/resources/search`
- 后端数据库查询逻辑（未知具体实现）

## Metadata

- **Components:** Search / Backend API / Database Query
- **Affected Versions:** v0.2.0（当前版本）
- **Environment:** Production (zct-dev.zoomdev.us)
- **Browser/Client:** N/A（MCP 工具，非浏览器）
- **Database:** CSP Resource Server Database（推测为 PostgreSQL / MySQL）
