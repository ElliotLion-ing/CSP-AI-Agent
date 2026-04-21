# Feature Design: Multi-Directory Resource Paths Support

**Feature ID:** FEAT-2026-04-16-001-multi-dir-resources  
**版本：** 1.1.0  
**创建日期：** 2026-04-16  
**最后更新：** 2026-04-16  
**状态：** 待确认

---

## 一、背景与动机

当前 `ai-resources-config.json` 中每个 resource type（`commands`、`skills`、`mcp`、`rules`）只能指定**单一目录路径**（`string`）。

随着团队规模扩大和资源组织方式多样化，出现了以下真实场景：

- 一个 source（如 `client-sdk-ai-hub`）希望将 skills 分散在多个子目录下（如 `.cursor/skills` 和 `.cursor/extra-skills`）
- 不同团队维护的资源放在同一个 repo 的不同目录中，希望同时被加载
- 需要从 legacy 路径和新路径同时加载资源，实现平滑迁移

当前架构下，以上场景只能通过新增 `extended_sources`（整个新 source）来绕行，造成配置冗余。

---

## 二、需求描述

### 核心需求

允许 `resources` 配置节点中的每个 resource type 支持**字符串或字符串数组**两种格式：

```json
"resources": {
  "commands": "ai-resources/commands",
  "skills": ["ai-resources/skills", "ai-resources/extra-skills"],
  "mcp": "ai-resources/mcp",
  "rules": ["ai-resources/rules", "ai-resources/legacy-rules"]
}
```

- **向后兼容**：原有的字符串格式继续有效，无需迁移现有配置
- **全量索引**：同一 source 内多目录下的所有资源都独立注册，每个物理路径对应唯一 key
- **全量暴露**：搜索/列出资源时，展示所有来源的所有条目，不静默过滤
- **精确读取**：`readResourceFiles()` 支持按 source 精确定位，避免同名资源混淆
- **适用范围**：`default_source` 和 `extended_sources` 中的所有 source 均支持

---

## 三、技术方案

### 3.1 影响范围

| 文件 | 改动说明 |
|------|---------|
| `SourceCode/src/types/resources.ts` | `ResourceSource.resources` 类型：`string` → `string \| string[]`；`ResourceMetadata` 新增 `dir` 字段记录所在子目录 |
| `SourceCode/src/git/multi-source-manager.ts` | 内部 `SourceConfig.resources` 接口同步修改；`readResourceFiles()` 新增可选 `sourceName` 参数支持精确定位 |
| `SourceCode/src/resources/loader.ts` | `scanSource()` 遍历多目录，每个物理路径独立注册为唯一 key |
| `AI-Resources/ai-resources-config.json` | 保持现有单字符串格式不变（向后兼容示例） |

### 3.2 工具函数

在 `loader.ts` 和 `multi-source-manager.ts` 各自引入本地工具函数（不共享，保持模块独立）：

```typescript
function normalizePaths(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
```

### 3.3 类型定义变更（`types/resources.ts`）

```typescript
// ResourceSource.resources: string → string | string[]
export interface ResourceSource {
  resources: Partial<Record<ResourceType, string | string[]>>;
}

// ResourceMetadata 新增 dir 字段，记录资源所在的具体子目录
export interface ResourceMetadata {
  id: string;       // 格式改为 "type:name@source/subDir"，保证全局唯一
  name: string;
  type: ResourceType;
  source: string;
  priority: number;
  path: string;     // 完整文件系统路径
  dir: string;      // 资源所在子目录（相对于 source.path），用于精确定位
  version?: string;
  description?: string;
  tags?: string[];
}
```

### 3.4 `loader.ts` — `scanSource()` 变更

**核心原则：每个物理路径对应唯一 key，全量注册，不丢弃任何资源。**

```typescript
// Before: 单目录
const subDir = source.resources[type]; // string
const resourceDir = path.join(baseDir, subDir);
await this.scanResourceType(source, type, resourceDir, stats);

// After: 多目录全量遍历
const subDirs = normalizePaths(source.resources[type]);
for (const subDir of subDirs) {
  const resourceDir = path.join(baseDir, subDir);
  try {
    await fs.access(resourceDir);
  } catch {
    logger.debug({ source: source.name, type, path: resourceDir }, 'Resource directory not found, skipping');
    continue;
  }
  // 将 subDir 传入，用于生成唯一 key
  await this.scanResourceType(source, type, resourceDir, subDir, stats);
}
```

**`resourceIndex` key 格式变更：**

```typescript
// Before: "type:name"（同 source 内同名资源会碰撞）
const resourceKey = `${type}:${name}`;

// After: "type:name@source/subDir"（物理路径唯一，永不碰撞）
const resourceKey = `${type}:${name}@${source.name}/${subDir}`;
```

**搜索时的行为：** `getResourcesByType()` 和 `searchResourcesByName()` 直接返回全量结果，不做去重，调用方看到所有来源的所有条目。

### 3.5 `multi-source-manager.ts` — `readResourceFiles()` 变更

**核心原则：支持按 `sourceName` 精确定位，避免同名资源混淆。**

```typescript
// Before
async readResourceFiles(
  resourceName: string,
  resourceType: 'command' | 'skill' | 'rule' | 'mcp',
  includeAllFiles: boolean = false,
): Promise<Array<{ path: string; content: string }>>

// After: 新增可选 sourceName 参数
async readResourceFiles(
  resourceName: string,
  resourceType: 'command' | 'skill' | 'rule' | 'mcp',
  includeAllFiles: boolean = false,
  sourceName?: string,  // 若指定，只在该 source 的多目录中查找
): Promise<Array<{ path: string; content: string }>>
```

**查找逻辑：**

```
若 sourceName 指定：
  只遍历该 source 的所有子目录（normalizePaths(source.resources[typeDir])）
  在每个子目录中查找该资源
  找到即返回（first-match in dirs of that source）

若 sourceName 未指定（兼容旧调用）：
  按 priority 遍历所有 source
  每个 source 内遍历所有子目录
  找到即返回（保持现有 first-match 行为）
```

**`sync_resources` 调用方不需要改动**，因为 `sub.id` 来自服务端且唯一，服务端负责保证订阅项与 source 的对应关系。`readResourceFiles()` 的 `sourceName` 参数是能力扩展，未来服务端可在订阅数据中下发 `source` 字段，届时直接透传即可。

---

## 四、API 设计

无新增 MCP Tool，无 REST API 变更。属于**配置结构扩展 + 内部实现升级**，对外接口向后兼容。

配置文件数组格式示例（新增能力）：

```json
{
  "version": "1.0",
  "default_source": {
    "resources": {
      "commands": "ai-resources/commands",
      "skills": ["ai-resources/skills", "ai-resources/extra-skills"],
      "mcp": "ai-resources/mcp",
      "rules": "ai-resources/rules"
    }
  }
}
```

---

## 五、影响范围评估

| 维度 | 评估 |
|------|------|
| 向后兼容 | ✅ 字符串格式完全兼容，旧配置无需修改 |
| API 变更 | ❌ 无 MCP Tool / REST API 变更 |
| 配置变更 | ✅ 仅扩展，支持数组格式，无破坏性 |
| `resourceIndex` key 格式 | ⚠️ 从 `type:name` 改为 `type:name@source/subDir`，影响所有依赖 key 的查询逻辑，需全面检查调用方 |
| 性能影响 | ⚠️ 极小：多目录时多几次 `fs.access`，可忽略不计 |
| 测试范围 | 见第六节 |

### `resourceIndex` key 变更影响的调用方（需全面检查）

| 调用位置 | 影响 | 处理方式 |
|---|---|---|
| `getResourceById(id)` | key 格式变了，旧 id 失效 | 调用方改用新 key 格式，或新增 `getResourcesByName(name, type)` 方法 |
| `searchResourcesByName()` | 不依赖 key，不受影响 | 无需改动 |
| `getResourcesByType()` | 不依赖 key，不受影响 | 无需改动 |

---

## 六、测试计划

| 场景 | 预期结果 |
|------|---------|
| `skills` 为单字符串（已有行为） | 正常扫描，行为与改造前完全一致 |
| `skills` 为包含一个元素的数组 | 等价于字符串，正常扫描 |
| `skills` 为包含两个目录的数组，两目录都存在 | 两个目录下的资源全部独立注册，`resourceIndex` 中各有唯一 key |
| `skills` 为包含两个目录的数组，第二个不存在 | 第一个正常加载，第二个跳过并打 debug 日志，无报错 |
| 两个目录中有同名 skill | 两者都注册，key 不同（含不同 subDir），搜索时两者都出现在结果中 |
| `readResourceFiles()` 不传 sourceName | 按优先级遍历所有 source，找到即返回（兼容现有行为） |
| `readResourceFiles()` 传入 sourceName | 只在指定 source 的所有子目录中查找，其他 source 不参与 |
| `getResourceById()` 使用新 key 格式 | 正确返回对应 `ResourceMetadata` |
