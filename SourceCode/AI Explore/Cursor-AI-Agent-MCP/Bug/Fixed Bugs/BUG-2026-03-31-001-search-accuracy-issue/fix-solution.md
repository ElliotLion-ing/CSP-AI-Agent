# Fix Solution

**Bug ID:** BUG-2026-03-31-001  
**Fix Author:** AI Agent  
**Fix Date:** 2026-03-31  

---

## Root Cause Summary

后端 `/csp/api/resources/search` 端点使用简单的全文模糊匹配（类似 SQL `LIKE '%keyword%'`），缺乏：
1. 整词匹配优先级
2. 字段权重（name vs description）
3. 评分算法（TF-IDF / BM25 / 语义向量）
4. 词形归一化（builds → build）

导致搜索 "build" 时，"builds timeline" 和 "build info" 等弱相关词组被误匹配。

---

## Proposed Solutions (按推荐优先级排序)

### ✅ Solution 1: Implement Full-Text Search with Ranking (Recommended)

**原理：** 使用数据库原生的全文搜索功能 + 评分算法

**PostgreSQL 实现：**

```sql
-- 1. 创建全文搜索索引（支持多语言）
CREATE INDEX idx_resources_fts ON resources 
USING gin(to_tsvector('english', name || ' ' || description));

-- 2. 添加中文支持（可选，如果使用 zhparser 扩展）
CREATE INDEX idx_resources_fts_chinese ON resources 
USING gin(to_tsvector('zhparser', name || ' ' || description));

-- 3. 改进后的搜索查询（带评分和权重）
SELECT 
  id, name, type, description,
  -- 评分计算（name 权重 2x, description 权重 1x）
  (
    ts_rank(to_tsvector('english', name), plainto_tsquery('english', $1)) * 2.0 +
    ts_rank(to_tsvector('english', description), plainto_tsquery('english', $1)) * 1.0
  ) AS score
FROM resources
WHERE 
  to_tsvector('english', name || ' ' || description) @@ plainto_tsquery('english', $1)
ORDER BY score DESC
LIMIT 20;
```

**优点：**
- ✅ 原生数据库支持，性能高
- ✅ 支持词干化（builds → build）
- ✅ 支持停用词过滤
- ✅ 可配置权重和评分算法
- ✅ 支持多语言（英文 + 中文）

**缺点：**
- ⚠️ 需要数据库扩展（PostgreSQL 默认支持，MySQL 需要额外配置）
- ⚠️ 中文支持可能需要额外插件（zhparser / jieba）

---

### ✅ Solution 2: Elasticsearch / Meilisearch Integration (Best Quality)

**原理：** 使用专业搜索引擎，提供语义搜索和相关性排序

**Elasticsearch 实现：**

```javascript
// 1. 创建索引（带中文分词器）
PUT /csp_resources
{
  "settings": {
    "analysis": {
      "analyzer": {
        "multilang_analyzer": {
          "tokenizer": "ik_max_word",  // 中文分词
          "filter": ["lowercase", "english_stop"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "name": {
        "type": "text",
        "analyzer": "multilang_analyzer",
        "boost": 3.0  // name 字段权重 3x
      },
      "description": {
        "type": "text",
        "analyzer": "multilang_analyzer",
        "boost": 1.0  // description 字段权重 1x
      },
      "type": { "type": "keyword" },
      "team": { "type": "keyword" }
    }
  }
}

// 2. 搜索查询（带 BM25 评分）
GET /csp_resources/_search
{
  "query": {
    "multi_match": {
      "query": "build",
      "fields": ["name^3", "description"],
      "type": "best_fields",
      "fuzziness": "AUTO"
    }
  },
  "highlight": {
    "fields": {
      "name": {},
      "description": {}
    }
  }
}
```

**Meilisearch 实现（更轻量级）：**

```javascript
// 1. 创建索引（配置权重）
client.index('resources').updateSettings({
  searchableAttributes: ['name', 'description'],
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attribute',  // name 优先于 description
    'sort',
    'exactness'
  ],
  attributesForFaceting: ['type', 'team']
});

// 2. 搜索查询
const results = await client.index('resources').search('build', {
  attributesToHighlight: ['name', 'description'],
  limit: 20
});
```

**优点：**
- ✅ 最佳搜索质量（BM25 / TF-IDF / 向量相似度）
- ✅ 支持拼写纠错（typo tolerance）
- ✅ 支持同义词（synonyms）
- ✅ 支持多语言分词（中文 + 英文）
- ✅ 高亮匹配关键词
- ✅ 可扩展到百万级数据

**缺点：**
- ❌ 需要额外部署搜索引擎服务
- ❌ 增加系统复杂度
- ⚠️ Elasticsearch 资源占用较大，Meilisearch 更轻量

---

### ⚠️ Solution 3: Application-Layer Scoring (Quick Fix)

**原理：** 在后端代码中实现简单的评分算法，无需数据库改动

**Node.js 后端实现：**

```typescript
import natural from 'natural'; // 自然语言处理库

interface ResourceSearchResult {
  id: string;
  name: string;
  description: string;
  type: string;
  score: number;
}

async function searchResources(keyword: string): Promise<ResourceSearchResult[]> {
  // 1. 从数据库获取所有可能匹配的资源（宽松查询）
  const candidates = await db.query(`
    SELECT * FROM resources 
    WHERE LOWER(name) LIKE LOWER($1) 
       OR LOWER(description) LIKE LOWER($1)
  `, [`%${keyword}%`]);

  // 2. 在应用层计算评分
  const tokenizer = new natural.WordTokenizer();
  const keywordTokens = tokenizer.tokenize(keyword.toLowerCase());

  const scoredResults = candidates.map(resource => {
    let score = 0;

    // 2.1 检查 name 字段（权重 3x）
    const nameTokens = tokenizer.tokenize(resource.name.toLowerCase());
    const nameMatches = keywordTokens.filter(t => nameTokens.includes(t)).length;
    score += nameMatches * 3.0;

    // 2.2 检查完整关键词在 name 中出现（额外加分）
    if (resource.name.toLowerCase().includes(keyword.toLowerCase())) {
      score += 5.0;
    }

    // 2.3 检查 description 字段（权重 1x）
    const descTokens = tokenizer.tokenize(resource.description.toLowerCase());
    const descMatches = keywordTokens.filter(t => descTokens.includes(t)).length;
    score += descMatches * 1.0;

    // 2.4 惩罚词形变化（builds vs build）
    const stemmer = natural.PorterStemmer;
    const keywordStem = stemmer.stem(keyword.toLowerCase());
    const allTokens = [...nameTokens, ...descTokens];
    const exactMatches = allTokens.filter(t => t === keyword.toLowerCase()).length;
    const stemMatches = allTokens.filter(t => stemmer.stem(t) === keywordStem).length;
    
    if (exactMatches === 0 && stemMatches > 0) {
      score *= 0.7; // 只有词干匹配，降权 30%
    }

    return { ...resource, score };
  });

  // 3. 过滤低分结果并排序
  return scoredResults
    .filter(r => r.score > 0.5) // 过滤掉分数过低的结果
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}
```

**优点：**
- ✅ 无需数据库改动
- ✅ 快速实现
- ✅ 可灵活调整评分逻辑
- ✅ 支持词干化（natural 库）

**缺点：**
- ❌ 性能较差（需要在内存中处理所有候选结果）
- ❌ 无法处理大量数据（> 10,000 条记录）
- ⚠️ 中文支持需要额外库（nodejieba）

---

### ❌ Solution 4: Strict Whole-Word Matching (Not Recommended)

**原理：** 只匹配完整单词，不匹配词组中的部分词

**SQL 实现（PostgreSQL）：**

```sql
SELECT * FROM resources
WHERE 
  name ~* '\mbuild\M' OR  -- \m 和 \M 是单词边界标记
  description ~* '\mbuild\M'
ORDER BY 
  CASE 
    WHEN name ~* '\mbuild\M' THEN 1  -- name 匹配优先
    ELSE 2
  END,
  created_at DESC
LIMIT 20;
```

**优点：**
- ✅ 简单直接
- ✅ 避免 "builds" 这种误匹配

**缺点：**
- ❌ 过于严格，会漏掉 "Jenkins build" 这种组合词
- ❌ 无法支持拼写纠错
- ❌ 中文无法使用（中文没有空格分词）
- ❌ 无法处理同义词（build / 构建 / 出包）

---

## Recommended Implementation Plan

### Phase 1: Quick Fix (1-2 days)

**Goal:** 立即改善搜索准确性，使用 Solution 3（应用层评分）

**Steps:**
1. 在后端添加评分逻辑（使用 `natural` 库）
2. 更新 API 返回真实的 `score` 字段（当前全是 0）
3. 添加最低分数阈值过滤（score > 0.5）
4. 添加单元测试验证搜索结果

**Expected Results:**
- 搜索 "build" 返回 1-2 个高分结果（zoom-build 排第一）
- hang-log-analyzer 被过滤掉或排名靠后（score < 0.5）

---

### Phase 2: Database-Level Search (1-2 weeks)

**Goal:** 使用数据库原生全文搜索，提升性能和质量

**Steps:**
1. 评估数据库类型（PostgreSQL / MySQL）
2. 添加全文搜索索引（Solution 1）
3. 更新搜索查询使用 `ts_rank` 评分
4. 添加中文分词支持（如需要）
5. 性能测试（10,000+ 条记录）

**Expected Results:**
- 搜索响应时间 < 100ms
- 支持词干化和停用词
- 中文和英文混合搜索准确

---

### Phase 3: Search Engine Integration (Long-term)

**Goal:** 接入专业搜索引擎，实现最佳搜索体验

**Options:**
- **Meilisearch** - 推荐（轻量级，易部署，开源）
- **Elasticsearch** - 备选（功能强大，但资源占用大）

**Steps:**
1. 评估团队资源和部署能力
2. 选择搜索引擎并搭建服务
3. 实现数据同步（资源创建/更新时同步到搜索引擎）
4. 迁移搜索逻辑到搜索引擎
5. A/B 测试对比搜索质量

**Expected Results:**
- 支持拼写纠错（"biuld" → "build"）
- 支持同义词（"build" ≈ "构建" ≈ "出包"）
- 支持向量相似度搜索（语义理解）
- 可扩展到百万级资源

---

## Modified Files

### Backend（需要修改，不在当前仓库）

**File:** `backend/src/api/resources/search.ts`（推测路径）

**Changes:**
- 添加评分算法（Phase 1）
- 或修改数据库查询使用全文搜索（Phase 2）
- 或接入搜索引擎 API（Phase 3）

**Example Diff（Phase 1 - Application Layer）:**

```typescript
// 修改前
async searchResources(keyword: string) {
  const results = await db.query(
    'SELECT * FROM resources WHERE name LIKE $1 OR description LIKE $1',
    [`%${keyword}%`]
  );
  return results.map(r => ({ ...r, score: 0 })); // ❌ score 始终为 0
}

// 修改后
async searchResources(keyword: string) {
  const candidates = await db.query(
    'SELECT * FROM resources WHERE name ILIKE $1 OR description ILIKE $1',
    [`%${keyword}%`]
  );
  
  // ✅ 应用层计算评分
  const scored = calculateScores(candidates, keyword);
  
  // ✅ 过滤低分 + 排序
  return scored
    .filter(r => r.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}
```

---

## Testing Strategy

### Test Case 1: Keyword "build"
```bash
search_resources({ keyword: "build" })

Expected:
- zoom-build (score: 5.0+) ← 主要结果
- release-log-review (score: 1.0-2.0) ← 次要结果
- hang-log-analyzer (score: < 0.5 或不返回) ← 应被过滤

Actual (before fix):
- 3 个结果，score 全为 0，无法区分相关性
```

### Test Case 2: Chinese Keyword "构建"
```bash
search_resources({ keyword: "构建" })

Expected:
- zoom-build (score: 5.0+)

Actual (before fix):
- 1 个结果 ✅（中文匹配准确，因为 description 中只有 zoom-build 包含"构建"）
```

### Test Case 3: Specific Keyword "jenkins"
```bash
search_resources({ keyword: "jenkins" })

Expected:
- zoom-build (score: 3.0+)

Actual (before fix):
- 1 个结果 ✅（匹配准确）
```

### Test Case 4: Multi-Word Query "build android"
```bash
search_resources({ keyword: "build android" })

Expected:
- zoom-build (score: 5.0+, description 提到 Android)

Actual (before fix):
- 需测试（可能返回多个不相关结果）
```

### Test Case 5: Typo Tolerance "biuld" (Phase 3 only)
```bash
search_resources({ keyword: "biuld" })

Expected (Phase 3 with Elasticsearch/Meilisearch):
- zoom-build (拼写纠错)

Actual (before fix):
- 0 个结果（无拼写纠错）
```

---

## Performance Considerations

### Phase 1 (Application Layer)
- **Time Complexity:** O(n * m)，n = 候选数量，m = 评分计算复杂度
- **Expected QPS:** 10-50 queries/sec（取决于候选结果数量）
- **Memory Usage:** O(n)，需加载所有候选到内存

### Phase 2 (Database Full-Text Search)
- **Time Complexity:** O(log n)，利用索引
- **Expected QPS:** 100-500 queries/sec
- **Memory Usage:** 索引大小约为表大小的 50%

### Phase 3 (Search Engine)
- **Time Complexity:** O(log n)，高度优化的倒排索引
- **Expected QPS:** 500-5000 queries/sec（取决于硬件）
- **Memory Usage:** 完全在搜索引擎中管理

---

## Rollback Plan

如果修复后出现问题，回滚步骤：

1. **Phase 1 回滚**：
   - 恢复原始的简单 SQL 查询
   - 移除评分逻辑
   - 部署时间：< 5 分钟

2. **Phase 2 回滚**：
   - 删除全文搜索索引
   - 恢复原始查询
   - 部署时间：< 15 分钟

3. **Phase 3 回滚**：
   - 切换到备用搜索逻辑（Phase 2 或 Phase 1）
   - 不删除搜索引擎服务（保留用于调试）
   - 部署时间：< 10 分钟

---

## Related Resources

- [PostgreSQL Full-Text Search Documentation](https://www.postgresql.org/docs/current/textsearch.html)
- [Meilisearch Documentation](https://www.meilisearch.com/docs)
- [Elasticsearch BM25 Scoring](https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-similarity.html)
- [Natural NLP Library for Node.js](https://github.com/NaturalNode/natural)
- [nodejieba - Chinese Word Segmentation](https://github.com/yanyiwu/nodejieba)

---

## Sign-off

- **Developer:** AI Agent
- **Reviewer:** [Pending]
- **QA:** [Pending]
- **Product Owner:** [Pending]
