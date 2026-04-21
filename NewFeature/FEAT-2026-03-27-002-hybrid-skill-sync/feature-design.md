# Feature Design: 混合 Skill 同步方案（客户端本地扫描版）

**版本：** 2.0.0  
**创建日期：** 2026-03-27  
**修订日期：** 2026-03-27（架构重大改进：移除服务端 API 依赖）  
**Feature ID：** FEAT-2026-03-27-002-hybrid-skill-sync  
**状态：** 实施中

---

## 🎯 架构改进亮点（v2.0）

**重大发现：** MCP Server 已通过 Git 仓库完整拉取所有 AI 资源到本地（`AI-Resources/` 目录），无需依赖服务端 API 提供元数据！

**v1.0 → v2.0 变更：**

| 方案版本 | 元数据来源 | 服务端依赖 | 部署复杂度 |
|---------|----------|---------|----------|
| v1.0 | REST API `/resources/{id}/metadata` | ❌ 需要后端团队新增 API | 高（需协调） |
| **v2.0** | **MCP Server 本地 Git 扫描** | ✅ 零依赖 | **低（即刻可用）** |

---

## 📋 目录

1. [背景与问题](#1-背景与问题)
2. [需求描述](#2-需求描述)
3. [技术方案](#3-技术方案)
4. [API 设计](#4-api-设计)
5. [数据流设计](#5-数据流设计)
6. [影响范围](#6-影响范围)
7. [兼容性保证](#7-兼容性保证)
8. [测试策略](#8-测试策略)

---

## 1. 背景与问题

### 1.1 设计演进历史

**阶段 1（早期）：** 纯本地下载模式
- `sync_resources` 将所有 Skill/Command 下载到本地文件系统
- AI 直接读取本地 `.md` 文件执行
- **问题**：无法统计用户使用数据（telemetry）

**阶段 2（当前）：** 纯远程 Prompt 模式
- `sync_resources` 将 Skill/Command 注册为 MCP Prompt（远程调用）
- 仅 Rule 和 MCP 类型的资源写入本地文件
- **优势**：可以统计 telemetry（每次调用都经过 MCP Server）
- **问题**：无法支持依赖本地脚本的复杂 Skill（如 `zoom-build`）

### 1.2 典型问题场景

**复杂 Skill 示例：`zoom-build`**

```
目录结构：
AI-Resources/csp/ai-resources/skills/zoom-build/
├── SKILL.md              ← AI 指导文档
├── scripts/
│   ├── build-cli         ← 主执行脚本（可执行文件）
│   ├── build-trigger     ← 构建触发器
│   ├── build-poll        ← 构建轮询器
│   └── *.py, *.sh        ← 辅助脚本
├── teams/
│   ├── client-android.json
│   ├── client-ios.json
│   └── ...               ← 团队配置文件
└── references/           ← 参考文档
```

**当前问题：**
- `resolve_prompt_content` 只返回 `SKILL.md` 的文本内容
- `SKILL.md` 指引 AI 调用 `~/.cursor/skills/build/scripts/build-cli`
- 但本地 `~/.cursor/skills/build/` 目录不存在（未下载）
- AI 调用脚本失败 ❌

---

## 2. 需求描述

### 2.1 核心诉求

1. **保留远程调用（Prompt 机制）** → 必须继续统计 telemetry 数据
2. **支持本地脚本执行** → 复杂 Skill 需要本地可执行文件和配置
3. **自动化安装** → 用户无需手动下载，`sync_resources` 自动处理
4. **增量更新** → 本地已存在的文件不重复下载（除非版本更新）
5. **卸载支持** → `uninstall_resource` 能够清理本地脚本文件

### 2.2 资源分类

| 资源类型 | 本地下载需求 | MCP Prompt 注册 | 判断标准 |
|---------|------------|----------------|---------|
| **简单 Command** | ❌ 不需要 | ✅ 需要 | 单 `.md` 文件，无外部依赖 |
| **简单 Skill** | ❌ 不需要 | ✅ 需要 | 单 `SKILL.md` 文件，无外部依赖 |
| **复杂 Skill** | ✅ 需要 | ✅ 需要 | 含 `scripts/`、`teams/`、`references/` 等目录 |
| **Rule** | ✅ 需要 | ❌ 不需要 | `.cursor/rules/*.mdc` |
| **MCP Server** | ✅ 需要 | ❌ 不需要 | `.cursor/mcp.json` 配置 |

### 2.3 用户体验目标

```
用户视角：
1. 订阅 zoom-build skill
2. 运行 sync_resources → 自动下载所有脚本到本地
3. 使用 /skill/zoom-build → MCP Server 记录 telemetry，AI 获取 SKILL.md 内容
4. AI 按照 SKILL.md 指引，调用本地脚本 ~/.cursor/skills/zoom-build/scripts/build-cli
5. 脚本成功执行 ✅
```

---

## 3. 技术方案

### 3.1 客户端 Git 本地扫描（核心架构）

**不再需要服务端 API！** MCP Server 自身已通过 `multiSourceGitManager` 管理本地 Git 仓库。

**关键模块：** `SourceCode/src/git/multi-source-manager.ts`

**新增方法：**

```typescript
/**
 * Scan resource directory and generate metadata.
 * 
 * @param resourceName - Resource name (e.g., 'zoom-build')
 * @param resourceType - Resource type ('skill' or 'command')
 * @returns Metadata with has_scripts and script_files
 */
async scanResourceMetadata(
  resourceName: string,
  resourceType: 'command' | 'skill' | 'rule' | 'mcp'
): Promise<{
  has_scripts: boolean;
  script_files?: Array<{
    relative_path: string;
    content: string;
    mode?: string;
    encoding: 'utf8' | 'base64';
  }>;
}>
```

**扫描逻辑：**

1. **递归读取目录：** 调用 `readResourceFiles(name, type, includeAllFiles: true)`
2. **启发式检测：** 检查文件路径是否包含 `scripts/`、`teams/`、`references/`
3. **权限推断：**
   - `scripts/` 下非 `.json`/`.md`/`.txt` → `0755`（可执行）
   - 其他文件 → `0644`
4. **返回元数据：** `{ has_scripts, script_files[] }`

**示例输出：**

```json
{
  "has_scripts": true,
  "script_files": [
    {
      "relative_path": "scripts/build-cli",
      "content": "#!/usr/bin/env node\nconsole.log('Build');",
      "mode": "0755",
      "encoding": "utf8"
    },
    {
      "relative_path": "teams/client-android.json",
      "content": "{\"project\":\"client-android\"}",
      "mode": "0644",
      "encoding": "utf8"
    }
  ]
}
```

### 3.2 客户端 `sync_resources` 增强

**核心逻辑（MCP Server 端）：**

```typescript
async function syncResources(params: SyncResourcesParams): Promise<SyncResourcesResult> {
  const { mode, types, configured_mcp_servers } = params;
  
  // 1. 获取订阅列表
  const subscriptions = await apiClient.getSubscriptions({ types });
  
  const localActions: LocalAction[] = [];
  const skipped: string[] = [];
  
  for (const sub of subscriptions.subscriptions) {
    // 2. 使用本地 Git 扫描生成元数据（取代 API 调用）
    const metadata = await multiSourceGitManager.scanResourceMetadata(
      sub.name,
      sub.type as 'command' | 'skill'
    );
    
    // 3. Rule 和 MCP：总是需要本地文件
    if (resource.type === 'rule') {
      const actions = generateRuleWriteActions(resource);
      localActions.push(...applyIncrementalCheck(actions));
    }
    
    if (resource.type === 'mcp') {
      const action = generateMcpMergeAction(resource, configured_mcp_servers);
      localActions.push(action);
    }
    
    // 4. Skill/Command：根据本地扫描结果决定是否下载
    if (resource.type === 'skill' || resource.type === 'command') {
      // 4.1 所有 Skill/Command 都注册为 MCP Prompt（保持不变）
      registerPromptInMemory(resource.name, resource.content);
      
      // 4.2 仅 has_scripts=true 时下载到本地
      if (metadata.has_scripts && metadata.script_files) {
        const actions = generateSkillWriteActions(metadata.script_files);
        const filteredActions = applyIncrementalCheck(actions, sub.name);
        
        if (filteredActions.length > 0) {
          localActions.push(...filteredActions);
        } else {
          skipped.push(resource.name);  // 本地已是最新，跳过
        }
      }
    }
  }
  
  return {
    success: true,
    data: {
      summary: {
        total: subscriptions.subscriptions.length,
        synced: subscriptions.subscriptions.length - skipped.length,
        skipped: skipped.length,
        failed: 0
      },
      local_actions_required: localActions,
      skipped_resources: skipped
    }
  };
}
    }
  };
}
```

**增量检查逻辑：**

```typescript
function applyIncrementalCheck(actions: WriteFileAction[]): WriteFileAction[] {
  const filtered: WriteFileAction[] = [];
  
  for (const action of actions) {
    const localPath = expandPath(action.path);  // 展开 ~ 为绝对路径
    
    // 检查文件是否存在
    if (!fs.existsSync(localPath)) {
      filtered.push(action);  // 文件不存在 → 需要下载
      continue;
    }
    
    // 检查内容哈希是否一致
    const localContent = fs.readFileSync(localPath, 'utf8');
    const localHash = crypto.createHash('sha256').update(localContent).digest('hex');
    const remoteHash = crypto.createHash('sha256').update(action.content).digest('hex');
    
    if (localHash !== remoteHash) {
      filtered.push(action);  // 内容不同 → 需要更新
    }
    // 内容相同 → 跳过
  }
  
  return filtered;
}
```

**生成脚本文件 actions：**

```typescript
function generateSkillWriteActions(resource: ResourceMetadata): WriteFileAction[] {
  const actions: WriteFileAction[] = [];
  
  // 1. 写入 SKILL.md
  actions.push({
    action: 'write_file',
    path: `~/.cursor/skills/${resource.name}/SKILL.md`,
    content: resource.content,
    encoding: 'utf8'
  });
  
  // 2. 写入所有脚本文件
  if (resource.script_files) {
    for (const file of resource.script_files) {
      actions.push({
        action: 'write_file',
        path: `~/.cursor/skills/${resource.name}/${file.relative_path}`,
        content: file.content,
        encoding: file.encoding || 'utf8',
        mode: file.mode  // 可执行权限
      });
    }
  }
  
  return actions;
}
```

### 3.3 客户端 `uninstall_resource` 增强

```typescript
async function uninstallResource(params: UninstallResourceParams): Promise<UninstallResourceResult> {
  const { name, remove_from_account } = params;
  
  const deleted: Array<{ type: string; path: string }> = [];
  
  // 1. 查找资源元数据
  const resource = await apiClient.searchResourceByName(name);
  
  if (!resource) {
    throw new Error(`Resource not found: ${name}`);
  }
  
  // 2. 删除本地文件（如果有）
  if (resource.has_scripts) {
    const localDir = expandPath(`~/.cursor/skills/${resource.name}`);
    
    if (fs.existsSync(localDir)) {
      fs.rmSync(localDir, { recursive: true, force: true });
      deleted.push({ type: 'directory', path: localDir });
    }
  }
  
  // 3. 取消订阅（可选）
  let unsubscribed = false;
  if (remove_from_account) {
    await apiClient.unsubscribe(resource.id);
    unsubscribed = true;
  }
  
  // 4. MCP Prompt 在下次 restart/sync 时自动移除（动态注册）
  
  return {
    success: true,
    data: {
      name: resource.name,
      deleted_files: deleted,
      unsubscribed,
      note: unsubscribed 
        ? 'Resource unsubscribed and local files removed'
        : 'Local files removed, but still subscribed (will re-sync on next sync_resources)'
    }
  };
}
```

---

## 4. API 设计

### 4.1 新增 API 端点（服务端）

**`GET /api/v1/resources/:id/metadata`**

获取资源完整元数据（含脚本文件列表）。

**Request:**
```http
GET /api/v1/resources/6dea7a2c8cf83e5d227ee39035411730/metadata
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "6dea7a2c8cf83e5d227ee39035411730",
    "name": "zoom-build",
    "type": "skill",
    "version": "2.1.0",
    "content": "# Zoom Build Skill\n\n...",
    "has_scripts": true,
    "script_files": [
      {
        "relative_path": "scripts/build-cli",
        "content": "#!/usr/bin/env node\n...",
        "mode": "0755",
        "encoding": "utf8",
        "size": 4096
      },
      {
        "relative_path": "teams/client-android.json",
        "content": "{\"project\":\"client-android\",...}",
        "mode": "0644",
        "encoding": "utf8",
        "size": 512
      }
    ],
    "content_hash": "a7f8e3b2c1d4f5a6..."
  }
}
```

### 4.2 `sync_resources` 返回格式扩展

**新增字段：**

```typescript
interface SyncResourcesResult {
  summary: {
    total: number;
    synced: number;
    skipped: number;  // 新增：本地已是最新，跳过下载的数量
    failed: number;
  };
  local_actions_required: LocalAction[];
  skipped_resources?: string[];  // 新增：跳过的资源名称列表
  details: Array<{
    id: string;
    name: string;
    type: string;
    status: 'synced' | 'skipped' | 'failed';
    reason?: string;  // status=skipped 时的原因
  }>;
}
```

**`skipped` 原因类型：**
- `already_up_to_date` - 本地文件与远程内容一致（哈希相同）
- `no_local_sync_needed` - 简单 Skill/Command 不需要本地文件
- `mcp_already_configured` - MCP Server 已在 mcp.json 中配置

---

## 5. 数据流设计

### 5.1 完整调用流程（复杂 Skill）

```
用户：小助手，订阅 zoom-build skill
  ↓
① manage_subscription(action: subscribe, resource_ids: [zoom-build])
  ↓
② sync_resources(mode: incremental)
  ↓
③ 服务端：获取 zoom-build 元数据
  - has_scripts: true
  - script_files: [build-cli, build-trigger, ...]
  ↓
④ 服务端：生成 local_actions_required
  [
    { action: write_file, path: ~/.cursor/skills/zoom-build/SKILL.md, content: ... },
    { action: write_file, path: ~/.cursor/skills/zoom-build/scripts/build-cli, content: ..., mode: 0755 },
    { action: write_file, path: ~/.cursor/skills/zoom-build/teams/client-android.json, content: ... },
    ...
  ]
  ↓
⑤ 客户端（Cursor AI）：执行 local_actions_required
  - 检查 ~/.cursor/skills/zoom-build/SKILL.md 是否存在
    - 不存在 → 写入文件
    - 存在 → 比较哈希 → 不同才覆盖
  - 对每个脚本文件重复检查
  ↓
⑥ MCP Server 内存：注册 Prompt
  server.registerPrompt('skill/zoom-build', ...)
  ↓
⑦ 用户：/skill/zoom-build 构建一个 dev 包
  ↓
⑧ Cursor → MCP Server：prompts/get('skill/zoom-build')
  ↓
⑨ MCP Server：
  - tracking('/skill/zoom-build') → 统计 telemetry ✅
  - 返回 SKILL.md 内容
  ↓
⑩ AI 读取 SKILL.md，发现指令：
  "调用 ~/.cursor/skills/zoom-build/scripts/build-cli trigger --preset dev"
  ↓
⑪ AI 执行 Shell 命令：
  node ~/.cursor/skills/zoom-build/scripts/build-cli trigger --preset dev
  ↓
⑫ 本地脚本运行成功，返回构建 URL ✅
```

### 5.2 增量更新流程

**第一次同步：**
```
sync_resources(mode: incremental)
  ↓
本地 ~/.cursor/skills/zoom-build/ 不存在
  ↓
下载所有文件（5 个文件，1.2MB）
  ↓
返回：synced: 1, skipped: 0
```

**第二次同步（内容未变）：**
```
sync_resources(mode: incremental)
  ↓
本地 ~/.cursor/skills/zoom-build/ 已存在
  ↓
逐文件哈希对比：
  - SKILL.md: 本地 hash = a7f8e3b2, 远程 hash = a7f8e3b2 → 跳过
  - scripts/build-cli: 本地 hash = c1d4f5a6, 远程 hash = c1d4f5a6 → 跳过
  - ... 全部相同
  ↓
返回：synced: 0, skipped: 1 (zoom-build already up-to-date)
```

**第三次同步（服务端更新了 build-cli）：**
```
sync_resources(mode: incremental)
  ↓
本地 ~/.cursor/skills/zoom-build/ 已存在
  ↓
逐文件哈希对比：
  - SKILL.md: 哈希相同 → 跳过
  - scripts/build-cli: 哈希不同 → 需要更新 ✅
  - teams/*.json: 哈希相同 → 跳过
  ↓
返回：local_actions_required: [
  { action: write_file, path: ~/.cursor/skills/zoom-build/scripts/build-cli, ... }
]
synced: 1 (partial update), skipped: 0
```

### 5.3 本地文件写入逻辑（客户端）

```typescript
// 客户端执行（Cursor AI 或本地脚本）
async function executeLocalActions(actions: LocalAction[]) {
  for (const action of actions) {
    if (action.action === 'write_file') {
      const fullPath = expandPath(action.path);  // ~ → /Users/xxx
      
      // 确保父目录存在
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      
      // 写入文件
      const content = action.encoding === 'base64' 
        ? Buffer.from(action.content, 'base64')
        : action.content;
      
      await fs.promises.writeFile(fullPath, content, { 
        encoding: action.encoding === 'base64' ? null : 'utf8' 
      });
      
      // 设置文件权限（仅 Unix-like 系统）
      if (action.mode && process.platform !== 'win32') {
        await fs.promises.chmod(fullPath, parseInt(action.mode, 8));
      }
      
      console.log(`✅ Wrote file: ${action.path}`);
    }
  }
}
```

---

## 6. 影响范围

### 6.1 服务端变更

| 模块 | 变更内容 | 影响范围 |
|------|---------|---------|
| **数据库 Schema** | 新增 `has_scripts`, `script_files`, `content_hash` 字段 | 需要数据库迁移 |
| **API 端点** | 新增 `GET /api/v1/resources/:id/metadata` | 新增接口 |
| **资源扫描器** | 扫描时识别 `scripts/` 目录并打包 | 构建流程调整 |
| **Git 仓库监听** | 检测文件变化时重新计算 `content_hash` | 缓存失效逻辑 |

### 6.2 MCP Server（客户端）变更

| 模块 | 变更内容 | 影响范围 |
|------|---------|---------|
| **sync_resources** | 新增增量检查逻辑 | 核心工具 |
| **api-client** | 新增 `getResourceMetadata()` 方法 | API 模块 |
| **filesystem-manager** | 新增文件哈希计算、chmod 权限设置 | 文件系统模块 |
| **uninstall_resource** | 新增脚本目录删除逻辑 | 核心工具 |

### 6.3 不受影响的部分

- ✅ `resolve_prompt_content` - 保持不变，继续返回 SKILL.md 内容
- ✅ `search_resources` - 保持不变
- ✅ `upload_resource` - 保持不变（未来可扩展支持多文件上传）
- ✅ MCP Prompt 注册机制 - 保持不变
- ✅ Telemetry 统计 - 保持不变

---

## 7. 兼容性保证

### 7.1 向后兼容

**简单 Skill（无脚本）：**
- 行为与当前完全一致
- 不下载到本地，仅通过 MCP Prompt 远程调用
- 用户无感知变化

**已订阅资源：**
- 首次升级到新版本后，运行 `sync_resources` 会自动下载复杂 Skill 的脚本
- 已有的 Rule 和 MCP 配置不受影响

### 7.2 升级路径

**用户侧（零操作）：**
```
1. 用户重启 Cursor → MCP Server 自动更新到新版本
2. 运行 sync_resources（用户主动或定时任务）
3. 复杂 Skill 自动下载脚本到本地
4. 可立即使用 /skill/zoom-build
```

**服务端（需要数据迁移）：**
```sql
-- 新增字段（默认值：has_scripts=false）
ALTER TABLE ai_resources 
  ADD COLUMN has_scripts BOOLEAN DEFAULT FALSE,
  ADD COLUMN content_hash VARCHAR(64);

-- 触发资源重新扫描（生成 script_files JSON）
UPDATE ai_resources SET needs_rescan = TRUE WHERE type IN ('skill', 'command');
```

---

## 8. 测试策略

### 8.1 测试用例设计

**场景 1：简单 Skill（无脚本）**
- 订阅 `hang-log-analyzer`
- 运行 `sync_resources` → 本地无文件写入
- 使用 `/skill/hang-log-analyzer` → 成功 ✅

**场景 2：复杂 Skill（首次同步）**
- 订阅 `zoom-build`
- 本地 `~/.cursor/skills/zoom-build/` 不存在
- 运行 `sync_resources` → 下载 SKILL.md + 5 个脚本
- 验证文件存在、权限正确（`build-cli` 为 755）
- 使用 `/skill/zoom-build` → 脚本成功调用 ✅

**场景 3：增量同步（无变化）**
- 本地已有 `zoom-build` 全部文件
- 服务端内容未变化
- 运行 `sync_resources` → skipped: 1
- 验证：无文件被重新下载

**场景 4：增量同步（部分更新）**
- 本地已有 `zoom-build` 全部文件
- 服务端仅更新了 `scripts/build-cli`（版本升级）
- 运行 `sync_resources` → 仅下载 `build-cli`
- 验证：其他文件未被覆盖

**场景 5：卸载复杂 Skill**
- 本地有 `zoom-build` 文件夹
- 运行 `uninstall_resource(name: zoom-build, remove_from_account: true)`
- 验证：目录被删除，订阅被取消 ✅

**场景 6：Telemetry 验证**
- 使用 `/skill/zoom-build` 触发构建
- 验证：服务端日志记录了 `prompts/get` 调用
- 验证：Telemetry API 收到事件上报 ✅

### 8.2 测试目标

| 指标 | 目标 |
|------|-----|
| **Pass Rate** | 100% |
| **性能** | 首次同步 < 10s（5个文件），增量同步 < 2s |
| **存储开销** | 复杂 Skill ≤ 5MB/个 |
| **哈希对比准确率** | 100%（无误判，无漏判）|

---

## 9. 实施阶段划分

### 阶段 1：服务端资源扫描增强 ✅
- 修改资源扫描逻辑，识别 `scripts/` 目录
- 生成 `has_scripts` 和 `script_files` 字段
- 新增 `/api/v1/resources/:id/metadata` 端点

### 阶段 2：MCP Server `sync_resources` 增强 ✅
- 新增 `apiClient.getResourceMetadata()` 方法
- 实现增量检查逻辑（文件哈希对比）
- 生成 `write_file` actions（含权限设置）

### 阶段 3：MCP Server `uninstall_resource` 增强 ✅
- 新增脚本目录删除逻辑
- 支持 `remove_from_account` 参数

### 阶段 4：端到端测试 ✅
- 创建 `Test/test-hybrid-skill-sync.js`
- 覆盖6个测试场景
- 验证 telemetry 正常上报

### 阶段 5：文档更新 ✅
- 更新 `Docs/Design/CSP-AI-Agent-API-Mapping.md`（新增 metadata 接口）
- 更新 `Docs/Design/CSP-AI-Agent-Core-Design.md`（混合同步策略）

---

## 10. 设计权衡与决策

### 决策 1：哈希对比 vs 版本号对比

**选择：** 哈希对比  
**理由：**
- 版本号可能不准确（用户手动修改本地文件）
- 哈希对比 100% 准确（内容级精确比较）
- 性能开销可接受（SHA256 对 5MB 文件 < 50ms）

### 决策 2：增量 vs 强制覆盖

**选择：** 默认增量，提供 `mode: full` 强制覆盖  
**理由：**
- 节省带宽和时间（大部分时候内容未变）
- `mode: full` 可以修复本地文件损坏问题

### 决策 3：脚本文件存放位置

**选择：** `~/.cursor/skills/<skill-name>/`  
**理由：**
- 与 Cursor 官方 Skill 路径规范一致
- 用户容易找到和调试
- 与 Rule（`~/.cursor/rules/`）、MCP（`~/.cursor/mcp.json`）保持同级

### 决策 4：权限传递

**选择：** 服务端扫描时记录权限，客户端应用  
**理由：**
- 保留原始可执行属性（如 `build-cli`）
- 避免用户手动 `chmod +x`

### 决策 5：简单 Skill 不下载

**选择：** 单文件 Skill 仅注册 Prompt，不写本地  
**理由：**
- 减少磁盘占用
- 简化用户本地目录结构
- 内容通过 MCP Prompt 获取，效率更高

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **网络传输大文件** | 同步慢 | 使用 gzip 压缩，分块传输 |
| **本地磁盘空间** | 占用用户磁盘 | 限制单个 Skill ≤ 10MB，提供清理命令 |
| **权限问题（Windows）** | chmod 不支持 | 检测 `process.platform`，Windows 跳过权限设置 |
| **哈希对比误判** | 不必要的下载 | 使用 SHA256，碰撞概率 < 10^-60 |
| **脚本恶意代码** | 安全风险 | 资源上传时人工审核，签名验证（未来）|

---

## 12. 未来扩展

### 12.1 增量同步优化

- **文件级增量**：仅下载变化的文件（当前已支持）
- **内容级增量**：使用 `rsync` 或二进制 diff 算法，仅传输变化的字节块

### 12.2 多版本并存

```
~/.cursor/skills/zoom-build/
├── v2.1.0/    ← 当前版本
├── v2.0.3/    ← 回滚备份
└── active -> v2.1.0/  ← 软链接
```

### 12.3 脚本沙箱

- 使用 Node.js VM 或 Docker 容器隔离脚本执行
- 限制文件系统访问范围
- 超时和资源限制

---

## 13. OpenSpec 对齐

此 Feature 需要创建 OpenSpec 提案：

**变更 ID：** `feat-hybrid-skill-sync`

**涉及能力：**
- `resource-sync`（修改）
- `resource-uninstall`（修改）

**Spec Delta：**
```markdown
## MODIFIED Requirements

### Requirement: Sync Subscribed Resources
System SHALL synchronize subscribed AI resources with incremental update support and script file handling.

#### Scenario: Sync complex skill with scripts (first time)
- **GIVEN** user has subscribed to skill "zoom-build" with has_scripts=true
- **AND** local directory ~/.cursor/skills/zoom-build/ does not exist
- **WHEN** user calls sync_resources with mode=incremental
- **THEN** system SHALL download SKILL.md and all script files
- **AND** system SHALL set executable permissions (mode=0755) for script files
- **AND** system SHALL return synced=1, skipped=0

#### Scenario: Sync complex skill with scripts (no remote changes)
- **GIVEN** local directory ~/.cursor/skills/zoom-build/ exists with all files
- **AND** remote content hash matches local content hash for all files
- **WHEN** user calls sync_resources with mode=incremental
- **THEN** system SHALL skip all file downloads
- **AND** system SHALL return synced=0, skipped=1
- **AND** skipped_resources SHALL include "zoom-build" with reason "already_up_to_date"

#### Scenario: Sync simple skill without scripts
- **GIVEN** user has subscribed to skill "hang-log-analyzer" with has_scripts=false
- **WHEN** user calls sync_resources
- **THEN** system SHALL NOT write any local files
- **AND** system SHALL register MCP Prompt for remote access
- **AND** system SHALL return synced=1, skipped=0

### Requirement: Uninstall Resource with Local Cleanup
System SHALL remove local script files when uninstalling complex skills.

#### Scenario: Uninstall complex skill with local files
- **GIVEN** skill "zoom-build" has local directory ~/.cursor/skills/zoom-build/
- **WHEN** user calls uninstall_resource with name="zoom-build", remove_from_account=true
- **THEN** system SHALL delete ~/.cursor/skills/zoom-build/ directory recursively
- **AND** system SHALL unsubscribe from the resource
- **AND** return deleted_files list with directory path
```

---

## 14. 关键约束

1. **Telemetry 不可丢失** - 所有 Skill/Command 调用必须经过 MCP Server 的 `prompts/get`
2. **增量检查必须准确** - 哈希对比不能有误判（避免覆盖用户本地修改）
3. **权限必须保留** - 可执行脚本下载后必须是 755 权限
4. **原子写入** - 文件写入失败不能留下半成品（使用临时文件 + rename）
5. **跨平台兼容** - Windows、macOS、Linux 都能正常工作

---

## 15. 成功标准

✅ **功能完整性**
- 复杂 Skill 的脚本能够成功调用
- 增量同步准确跳过未变化的文件
- 卸载能够完全清理本地文件

✅ **性能指标**
- 首次同步 5 个文件 < 10s
- 增量同步（无变化）< 2s
- 哈希计算开销 < 5% 总时间

✅ **Telemetry 数据**
- 每次 `/skill/zoom-build` 调用都被记录
- 数据包含：用户 email、命令名称、时间戳

✅ **用户体验**
- 订阅 → 同步 → 使用，三步完成
- 无需手动下载或配置
- 本地文件更新透明（自动）

---

**文档状态：** 待用户确认  
**下一步：** 用户确认后创建 OpenSpec 提案
