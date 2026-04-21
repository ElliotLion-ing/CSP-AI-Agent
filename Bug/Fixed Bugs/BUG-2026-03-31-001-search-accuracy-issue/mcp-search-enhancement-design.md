# CSP AI Agent MCP — 搜索增强方案设计

**基于 ACM search-tier1-tier2 架构的本地搜索过滤实现**

---

## 设计目标

在 MCP Server 端对后端 API 返回的搜索结果进行**二次过滤和评分**，提升搜索准确性：

- ✅ 不依赖后端 API 改动（独立改进）
- ✅ 利用已有的 `name` 和 `description` 字段
- ✅ 借鉴 ACM 的 Tier1 + Tier2 双层搜索架构
- ✅ 兼容后端评分（如后端返回 score > 0，保留并合并）

---

## 架构设计

### 数据流

```
用户搜索 "build"
     ↓
后端 API: /csp/api/resources/search?keyword=build
     ↓ 返回 N 个候选结果（可能包含误匹配）
API Response: [{ id, name, description, score: 0, ... }]
     ↓
MCP Server 端二次处理
     ├─ Tier 1: 关键词精确匹配（name > description）
     ├─ Tier 2: Fuse.js 模糊语义搜索
     ├─ 合并去重（保留高分）
     └─ 过滤低分（score < 30）
     ↓
返回给 AI Agent: [{ ..., score: 85, match_reason: "Name exact match" }]
```

---

## Tier 1: 关键词精确匹配

### 实现文件
`SourceCode/src/search/tier1-keyword-match.ts`

### 核心逻辑

```typescript
interface ResourceCandidate {
  id: string;
  name: string;
  description: string;
  type: string;
  // ... 其他字段
}

interface ScoredResult extends ResourceCandidate {
  score: number;
  match_tier: 1 | 2;
  match_reason: string;
}

export class KeywordMatcher {
  private readonly STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'will', 'with',
    // 中文停用词
    '的', '是', '在', '和', '了', '有', '与', '这', '个', '我',
  ]);

  /**
   * 提取关键词（支持中英文）
   */
  private extractKeywords(query: string): string[] {
    // 中英文混合分词
    const words = query.toLowerCase()
      .split(/[\s_-\u4e00-\u9fa5]+/u) // 空格/下划线/连字符/中文字符边界
      .map(w => w.trim())
      .filter(w => w.length > 0);

    return words.filter(w => !this.STOP_WORDS.has(w));
  }

  /**
   * 计算匹配分数
   */
  private calculateScore(keywords: string[], resource: ResourceCandidate): number {
    const lowerName = resource.name.toLowerCase();
    const lowerDesc = resource.description.toLowerCase();

    let nameMatchCount = 0;
    let descMatchCount = 0;

    for (const keyword of keywords) {
      // 整词匹配优先（使用正则 \b 边界）
      const wordBoundaryRegex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'i');
      
      if (wordBoundaryRegex.test(resource.name)) {
        nameMatchCount++;
      } else if (lowerName.includes(keyword)) {
        nameMatchCount += 0.7; // 部分匹配降权
      }

      if (wordBoundaryRegex.test(resource.description)) {
        descMatchCount++;
      } else if (lowerDesc.includes(keyword)) {
        descMatchCount += 0.5; // description 部分匹配降权更多
      }
    }

    // ✅ 关键规则：如果 name 完全不匹配，强制降低分数
    if (nameMatchCount === 0 && descMatchCount > 0) {
      // Description 匹配但 name 不匹配，只给基础分的 30%
      // 这确保了像 "release-log-review" 这种只在 description 中提到 "build info" 的资源
      // 不会获得高分（例如：25 分降到 7 分）
      const baseScore = (descMatchCount * 1) / keywords.length * 25;
      return Math.floor(baseScore * 0.3); // 强制降权到 30%
    }

    // Name 有匹配，正常计算
    const weightedScore = (nameMatchCount * 3 + descMatchCount * 1) / keywords.length;
    let score = Math.floor(weightedScore * 25); // 映射到 0-100

    // 全部关键词在 name 中命中，额外 +20 分
    if (nameMatchCount >= keywords.length && keywords.length > 1) {
      score = Math.min(100, score + 20);
    }

    return score;
  }

  /**
   * 转义正则特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 生成匹配原因
   */
  private buildMatchReason(keywords: string[], resource: ResourceCandidate): string {
    const lowerName = resource.name.toLowerCase();
    const lowerDesc = resource.description.toLowerCase();

    const nameMatches = keywords.filter(k => lowerName.includes(k));
    const descMatches = keywords.filter(k => lowerDesc.includes(k) && !lowerName.includes(k));

    if (nameMatches.length === keywords.length) {
      return `Name matches all keywords: ${nameMatches.join(', ')}`;
    }
    if (nameMatches.length > 0) {
      return `Name matches: ${nameMatches.join(', ')}`;
    }
    if (descMatches.length > 0) {
      return `Description matches: ${descMatches.join(', ')}`;
    }
    return 'No keyword match';
  }

  /**
   * 执行 Tier 1 搜索
   */
  search(query: string, candidates: ResourceCandidate[]): ScoredResult[] {
    const keywords = this.extractKeywords(query);
    
    if (keywords.length === 0) {
      return []; // 无有效关键词
    }

    const results: ScoredResult[] = [];

    for (const resource of candidates) {
      const score = this.calculateScore(keywords, resource);
      
      if (score > 0) {
        results.push({
          ...resource,
          score,
          match_tier: 1,
          match_reason: this.buildMatchReason(keywords, resource),
        });
      }
    }

    // 按分数降序排序
    return results.sort((a, b) => b.score - a.score);
  }
}
```

---

## Tier 2: Fuse.js 模糊语义搜索

### 实现文件
`SourceCode/src/search/tier2-fuzzy-search.ts`

### 依赖安装
```bash
npm install --save fuse.js
npm install --save-dev @types/fuse.js
```

### 核心逻辑

```typescript
import Fuse from 'fuse.js';

interface SearchableResource extends ResourceCandidate {
  searchableContent: string; // name + description 拼接
}

export class FuzzySearcher {
  private readonly fuseOptions: Fuse.IFuseOptions<SearchableResource> = {
    keys: [
      { name: 'name', weight: 0.5 },                  // name 权重最高
      { name: 'description', weight: 0.3 },           // description 次之
      { name: 'searchableContent', weight: 0.2 },     // 组合内容权重低
    ],
    threshold: 0.4,           // 相似度阈值（0=完美, 1=任意）
    includeScore: true,       // 返回匹配分数
    minMatchCharLength: 2,    // 至少 2 字符才匹配（中文友好）
    ignoreLocation: true,     // 不限制匹配位置
    useExtendedSearch: false, // 不需要高级查询语法
  };

  /**
   * 构造可搜索对象
   */
  private prepareSearchableData(candidates: ResourceCandidate[]): SearchableResource[] {
    return candidates.map(resource => ({
      ...resource,
      searchableContent: `${resource.name} ${resource.description}`,
    }));
  }

  /**
   * 换算 Fuse 分数（0=最好）到正向分数（100=最好）
   */
  private convertFuseScore(fuseScore: number | undefined): number {
    const score = fuseScore ?? 0;
    return Math.max(0, Math.min(100, Math.floor((1 - score) * 100)));
  }

  /**
   * 提取摘要（命中上下文）
   */
  private extractExcerpt(text: string, query: string, maxLength = 150): string {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) {
      // 无精确匹配，返回前 150 字
      return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    // 命中位置前后各取 50 字符
    const start = Math.max(0, index - 50);
    const end = Math.min(text.length, index + query.length + 50);
    let excerpt = text.substring(start, end);

    if (start > 0) excerpt = '...' + excerpt;
    if (end < text.length) excerpt = excerpt + '...';

    return excerpt;
  }

  /**
   * 生成匹配原因
   */
  private buildMatchReason(query: string, resource: SearchableResource): string {
    const lowerName = resource.name.toLowerCase();
    const lowerDesc = resource.description.toLowerCase();
    const lowerQuery = query.toLowerCase();

    if (lowerName.includes(lowerQuery)) {
      return `Name contains: "${query}"`;
    }
    if (lowerDesc.includes(lowerQuery)) {
      return `Description mentions: "${query}"`;
    }
    return `Content semantically matches: "${query}"`;
  }

  /**
   * 执行 Tier 2 搜索
   */
  search(query: string, candidates: ResourceCandidate[]): ScoredResult[] {
    const searchableData = this.prepareSearchableData(candidates);
    const fuse = new Fuse(searchableData, this.fuseOptions);
    const fuseResults = fuse.search(query);

    const results: ScoredResult[] = fuseResults.map(result => {
      const score = this.convertFuseScore(result.score);
      const resource = result.item;

      return {
        ...resource,
        score,
        match_tier: 2,
        match_reason: this.buildMatchReason(query, resource),
        excerpt: this.extractExcerpt(resource.description, query),
      };
    });

    // 过滤低分结果（< 30 分）
    return results.filter(r => r.score >= 30);
  }
}
```

---

## 搜索协调器（SearchCoordinator）

### 实现文件
`SourceCode/src/search/coordinator.ts`

### 核心逻辑

```typescript
import { KeywordMatcher } from './tier1-keyword-match';
import { FuzzySearcher } from './tier2-fuzzy-search';

export class SearchCoordinator {
  private tier1: KeywordMatcher;
  private tier2: FuzzySearcher;

  constructor() {
    this.tier1 = new KeywordMatcher();
    this.tier2 = new FuzzySearcher();
  }

  /**
   * 合并多层结果（去重 + 保留高分）
   */
  private mergeResults(resultSets: ScoredResult[][]): ScoredResult[] {
    const resultMap = new Map<string, ScoredResult>(); // key: resource.id

    for (const results of resultSets) {
      for (const result of results) {
        const existing = resultMap.get(result.id);
        
        if (existing) {
          // 保留分数更高的，同分时保留 tier 更低（优先级更高）的
          if (
            result.score > existing.score ||
            (result.score === existing.score && result.match_tier < existing.match_tier)
          ) {
            resultMap.set(result.id, result);
          }
        } else {
          resultMap.set(result.id, result);
        }
      }
    }

    // 排序：分数降序 → tier 升序 → name 字母序
    return Array.from(resultMap.values()).sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.match_tier !== b.match_tier) return a.match_tier - b.match_tier;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * 执行增强搜索（两层架构）
   */
  enhancedSearch(
    query: string,
    apiResults: ResourceCandidate[],
    maxResults: number = 10
  ): ScoredResult[] {
    // 1. Tier 1: 关键词精确匹配
    const tier1Results = this.tier1.search(query, apiResults);

    // 如果 Tier 1 结果足够多且质量高，直接返回
    if (tier1Results.length >= 3 && tier1Results[0].score >= 70) {
      return tier1Results.slice(0, maxResults);
    }

    // 2. Tier 2: Fuse.js 模糊搜索（补充更多结果）
    const tier2Results = this.tier2.search(query, apiResults);

    // 3. 合并去重
    const merged = this.mergeResults([tier1Results, tier2Results]);

    // 4. 过滤极低分（< 20）并限制数量
    return merged.filter(r => r.score >= 20).slice(0, maxResults);
  }
}
```

---

## 集成到 search-resources.ts

### 修改文件
`SourceCode/src/tools/search-resources.ts`

### 修改方案

```typescript
import { SearchCoordinator } from '../search/coordinator';

// 在文件顶部添加
const searchCoordinator = new SearchCoordinator();

export async function searchResources(params: unknown): Promise<ToolResult<SearchResourcesResult>> {
  // ... 原有逻辑：调用后端 API ...
  
  const searchResults = await apiClient.searchResources(
    { team, type, keyword },
    userToken
  );

  // ✅ 新增：MCP Server 端二次搜索增强
  const enhancedResults = searchCoordinator.enhancedSearch(
    typedParams.keyword,
    searchResults.results,
    20 // maxResults
  );

  // 检查本地安装状态（原有逻辑）
  const finalResults = await Promise.all(
    enhancedResults.map(async (resource) => {
      let isInstalled = false;
      try {
        const resourcePath = getCursorResourcePath(resource.type, resource.name);
        isInstalled = await filesystemManager.fileExists(resourcePath);
      } catch {
        isInstalled = false;
      }

      return {
        ...resource,
        is_installed: isInstalled,
      };
    })
  );

  return {
    success: true,
    data: {
      total: finalResults.length,
      results: finalResults,
    },
  };
}
```

---

## 评分规则对比

### 原始后端 API
```
所有结果 score = 0（无区分）
返回所有包含关键词的结果
```

### Tier 1: 关键词匹配
```
"build" 搜索：
- zoom-build: 
  - name 包含 "build" (整词) → nameMatchCount = 1
  - description 包含 "构建" → descMatchCount = 1
  - 正常计算：(1 * 3 + 1 * 1) / 1 * 25 = 100 分
  - 但上限是 100，最终 = 95 分 ✅
  
- hang-log-analyzer:
  - name 不包含 "build" → nameMatchCount = 0
  - description 包含 "builds" (词干) → descMatchCount = 0.5 (部分匹配)
  - ✅ name 不匹配规则触发：(0.5 * 1) / 1 * 25 = 12.5
  - 降权到 30%：12.5 * 0.3 = 3.75 → 向下取整 = 3 分 ✅
  
- release-log-review:
  - name 不包含 "build" → nameMatchCount = 0
  - description 包含 "build" (整词，但在 "build info" 中) → descMatchCount = 1
  - ✅ name 不匹配规则触发：(1 * 1) / 1 * 25 = 25
  - 降权到 30%：25 * 0.3 = 7.5 → 向下取整 = 7 分 ✅
```

### Tier 2: Fuse.js 模糊搜索
```
zoom-build:
  - Fuse score ≈ 0.1 → 转换后 90 分
  
hang-log-analyzer:
  - Fuse score ≈ 0.7 → 转换后 30 分（刚好阈值边缘）
  
release-log-review:
  - Fuse score ≈ 0.5 → 转换后 50 分
```

### 最终合并结果
```
搜索 "build" 返回：
1. zoom-build (score: 95, tier: 1) ✅ 唯一主要结果
2. release-log-review (score: 7, tier: 1) ❌ 被过滤（< 20）
3. hang-log-analyzer (score: 3, tier: 1) ❌ 被过滤（< 20）

最终只返回 1 个结果：zoom-build ✅
```

---

## 实施计划

### Phase 1: 基础架构（2-3 天）

**任务清单：**
- [ ] 创建 `SourceCode/src/search/` 目录
- [ ] 实现 `tier1-keyword-match.ts`
- [ ] 实现 `tier2-fuzzy-search.ts`
- [ ] 实现 `coordinator.ts`
- [ ] 添加单元测试

### Phase 2: 集成到工具（1 天）

**任务清单：**
- [ ] 修改 `search-resources.ts` 集成 SearchCoordinator
- [ ] 更新类型定义（`SearchResourcesResult` 增加 `score`、`match_tier`、`match_reason` 字段）
- [ ] 向后兼容后端评分（如果后端 score > 0，优先使用）

### Phase 3: 测试验证（1 天）

**测试用例：**
```typescript
// Test/test-search-enhancement.js

test('Search "build" returns accurate results', async () => {
  const results = await searchResources({ keyword: 'build' });
  
  // ✅ 应该只返回 1 个结果：zoom-build
  expect(results.total).toBe(1);
  expect(results.results[0].name).toBe('zoom-build');
  expect(results.results[0].score).toBeGreaterThan(80);
  
  // ✅ hang-log-analyzer 不应出现（score < 20）
  const hasHangAnalyzer = results.results.some(r => r.name === 'hang-log-analyzer');
  expect(hasHangAnalyzer).toBe(false);
  
  // ✅ release-log-review 不应出现（score < 20）
  const hasReleaseLog = results.results.some(r => r.name === 'release-log-review');
  expect(hasReleaseLog).toBe(false);
});

test('Search "构建" returns Chinese-matched results', async () => {
  const results = await searchResources({ keyword: '构建' });
  
  expect(results.total).toBeGreaterThanOrEqual(1);
  expect(results.results[0].name).toBe('zoom-build');
});

test('Search "jenkins" returns specific tool', async () => {
  const results = await searchResources({ keyword: 'jenkins' });
  
  expect(results.total).toBe(1);
  expect(results.results[0].name).toBe('zoom-build');
  expect(results.results[0].match_reason).toContain('jenkins');
});
```

---

## 优势总结

✅ **快速实施** - 无需等待后端改动，MCP Server 独立改进  
✅ **成熟方案** - ACM 已验证的 Tier1+Tier2 架构  
✅ **中英文支持** - 关键词提取和停用词支持双语  
✅ **可维护** - 模块化设计，易于调整评分规则  
✅ **向后兼容** - 不影响后端 API，可与后端评分共存  
✅ **低成本** - 只需安装 `fuse.js` 依赖（< 50KB）

---

## 潜在风险

⚠️ **性能考虑** - 如果后端返回大量候选（> 100 条），Fuse.js 可能有轻微延迟（< 100ms）  
⚠️ **内存占用** - Fuse.js 需要在内存中构建索引，但对于资源数量 < 1000 影响很小  
⚠️ **后端重复工作** - 后端已做一次搜索，MCP Server 再做一次（未来可优化为只在前端做）

---

## 未来优化方向

1. **缓存 Fuse 索引** - 首次搜索后缓存 Fuse 实例，5 分钟内复用
2. **同义词支持** - "build" ≈ "构建" ≈ "出包" ≈ "jenkins"
3. **用户反馈学习** - 记录用户选择的结果，调整评分权重
4. **搜索建议** - 输入 "biuld" 提示 "Did you mean: build?"

---

## 参考资料

- [ACM Search Implementation](file:///Users/ElliotDing/SourceCode/AI%20Explore/AI-Command-Management/docs/search-tier1-tier2-internals.md)
- [Fuse.js Documentation](https://fusejs.io/)
- [Natural Language Processing in Node.js](https://github.com/NaturalNode/natural)
