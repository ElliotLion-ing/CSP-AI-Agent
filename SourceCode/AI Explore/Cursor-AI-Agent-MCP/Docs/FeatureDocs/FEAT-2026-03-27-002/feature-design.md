# Feature Design: 混合 Skill 同步方案

**版本：** 2.3.0  
**创建日期：** 2026-03-27  
**最后更新：** 2026-03-27  
**Feature ID：** FEAT-2026-03-27-002-hybrid-skill-sync  
**状态：** 实施完成

**变更记录：**
- v2.3.0: 新增跨资源调用指引机制（`resolve_prompt_content` 返回 Guidance）
- v2.2.0: 移除 hash 工具，使用字符串相等比对
- v2.1.0: 客户端 Git 本地扫描，移除服务端 API 依赖
- v2.0.0: 混合同步方案（MCP Prompt + 本地文件）
- v1.0.0: 初始设计

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

### 3.1 服务端资源元数据扩展

**数据库 Schema 新增字段：**

```typescript
interface ResourceMetadata {
  id: string;
  name: string;
  type: 'command' | 'skill' | 'rule' | 'mcp';
  version: string;
  content: string;  // SKILL.md 或 COMMAND.md 的内容
  
  // 新增字段 ↓
  has_scripts: boolean;            // 是否包含脚本/配置文件
  script_files?: Array<{           // 脚本文件列表
    relative_path: string;         // 相对路径（相对于资源根目录）
    content: string;                // 文件内容（base64 for binary）
    mode?: string;                  // 文件权限（如 "0755"）
    encoding?: 'utf8' | 'base64';   // 编码方式
  }>;
}
```

**判断逻辑（服务端 API）：**

```typescript
// 服务端资源扫描逻辑
function scanResourceDirectory(resourcePath: string): ResourceMetadata {
  const hasScripts = fs.existsSync(path.join(resourcePath, 'scripts')) ||
                     fs.existsSync(path.join(resourcePath, 'teams')) ||
                     fs.existsSync(path.join(resourcePath, 'references'));
  
  const scriptFiles = [];
  
  if (hasScripts) {
    // 递归扫描所有非 SKILL.md 的文件
    const allFiles = glob.sync('**/*', { 
      cwd: resourcePath, 
      nodir: true,
      ignore: ['SKILL.md', 'COMMAND.md', 'README.md']
    });
    
    for (const file of allFiles) {
      const fullPath = path.join(resourcePath, file);
      const stats = fs.statSync(fullPath);
      const isExecutable = (stats.mode & 0o111) !== 0;
      
      scriptFiles.push({
        relative_path: file,
        content: fs.readFileSync(fullPath, 'utf8'),
        mode: isExecutable ? '0755' : '0644',
        encoding: 'utf8'
      });
    }
  }
  
  return {
    id: generateResourceId(resourcePath),
    name: getResourceName(resourcePath),
    type: getResourceType(resourcePath),
    version: getVersionFromMarkdown(resourcePath),
    content: fs.readFileSync(path.join(resourcePath, 'SKILL.md'), 'utf8'),
    has_scripts: hasScripts,
    script_files: hasScripts ? scriptFiles : undefined
  };
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
    // 2. 获取资源元数据（含 has_scripts、script_files）
    const resource = await apiClient.getResourceMetadata(sub.id);
    
    // 3. Rule 和 MCP：总是需要本地文件
    if (resource.type === 'rule') {
      const actions = generateRuleWriteActions(resource);
      localActions.push(...applyIncrementalCheck(actions));
    }
    
    if (resource.type === 'mcp') {
      const action = generateMcpMergeAction(resource, configured_mcp_servers);
      localActions.push(action);
    }
    
    // 4. Skill/Command：根据 has_scripts 决定是否下载
    if (resource.type === 'skill' || resource.type === 'command') {
      // 4.1 所有 Skill/Command 都注册为 MCP Prompt（保持不变）
      registerPromptInMemory(resource.name, resource.content);
      
      // 4.2 仅 has_scripts=true 时下载到本地
      if (resource.has_scripts) {
        const actions = generateSkillWriteActions(resource);
        const filteredActions = applyIncrementalCheck(actions);
        
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
      skipped_resources: skipped  // 新增：已跳过的资源列表
    }
  };
}
```

**增量检查逻辑（客户端执行）：**

**说明：** MCP Server 不执行本地文件系统的增量检查，而是将所有需要的文件放入 `local_actions_required` 数组。**客户端（Cursor AI）**在处理这些 actions 时，**通过字符串内容相等比对**判断是否需要写入：

```typescript
// 客户端（Cursor AI）执行此逻辑（NOT on MCP Server）
function executeWriteFileAction(action: WriteFileAction) {
  const localPath = expandPath(action.path);  // 展开 ~ 为绝对路径
  
  // 检查文件是否存在
  if (!fs.existsSync(localPath)) {
    // 文件不存在 → 直接写入
    writeFile(localPath, action.content, action.mode);
    return;
  }
  
  // 文件存在 → 比对内容（字符串相等，不计算 hash）
  const localContent = fs.readFileSync(localPath, 'utf8');
  
  if (localContent === action.content) {
    // 内容完全相同 → 跳过写入（已是最新）
    console.log(`Skipped: ${action.path} (already up-to-date)`);
    return;
  }
  
  // 内容不同 → 覆盖写入
  writeFile(localPath, action.content, action.mode);
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

### 3.3 跨资源调用指引机制（v2.3.0 新增）

**问题：** 当 Command/Skill/Rule 引用其他独立 Resource 时，AI Agent 可能直接读取本地文件，绕过 telemetry 统计。

**解决方案：** 在 `resolve_prompt_content` 返回内容时，自动添加"跨资源调用指引"前缀。

**实现位置：** `SourceCode/src/prompts/manager.ts` - `resolvePromptContentForInvocation()` 方法

```typescript
async resolvePromptContentForInvocation(params): Promise<ResolvedPromptContent> {
  const resolved = await this.resolvePromptContent(params);
  
  // 记录 telemetry
  await telemetry.recordInvocation(...);
  
  // 去除 tracking header
  const strippedContent = this.stripTrackingHeader(resolved.content, resolved.meta);
  
  // 添加跨资源调用指引（自动注入）
  const guidancePrefix = this.buildCrossResourceGuidance(resolved.meta.resource_type);
  
  return {
    ...resolved,
    content: guidancePrefix + strippedContent  // Guidance + 实际内容
  };
}

private buildCrossResourceGuidance(resourceType: 'command' | 'skill'): string {
  return (
    `<!-- CROSS-RESOURCE INVOCATION GUIDANCE (auto-generated by MCP Server) -->\n` +
    `> **Important**: If this ${resourceType} references OTHER independent Commands or Skills:\n` +
    `>   - ALWAYS invoke them via resolve_prompt_content (e.g., resolve_prompt_content('/command/log-type-identification'))\n` +
    `>   - NEVER read local files directly for cross-resource calls (e.g., ~/.cursor/skills/<name>/SKILL.md)\n` +
    `>   - This ensures every independent resource invocation is tracked in telemetry.\n` +
    `>\n` +
    `> **Exception**: Internal ${resourceType} tools (scripts/, teams/, references/ subdirectories):\n` +
    `>   - These are NOT independent resources — they are internal tools of this ${resourceType}.\n` +
    `>   - Read local files directly or execute scripts via Shell tool.\n` +
    `>   - No separate telemetry needed (already counted as this ${resourceType} invocation).\n` +
    `<!-- END GUIDANCE -->\n\n`
  );
}
```

**效果：**

AI Agent 调用 `resolve_prompt_content('/command/log-analysis')` 时，返回：

```markdown
<!-- CROSS-RESOURCE INVOCATION GUIDANCE (auto-generated by MCP Server) -->
> **Important**: If this command references OTHER independent Commands or Skills:
>   - ALWAYS invoke them via `resolve_prompt_content` (e.g., ...)
>   - NEVER read local files directly for cross-resource calls
>   - This ensures every independent resource invocation is tracked in telemetry.
> ...
<!-- END GUIDANCE -->

# Log Analysis Command
[原始 Command 内容]
```

**优势：**
- ✅ 对资源创建者透明（无需修改 Command/Skill 内容）
- ✅ AI Agent 获得明确指引（不依赖自己判断）
- ✅ Telemetry 统计准确（跨资源调用必走 MCP Server）
- ✅ 区分跨资源调用 vs 内部工具（清晰的界限）

### 3.4 客户端 `uninstall_resource` 增强

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
    ]
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
- `already_up_to_date` - 本地文件与远程内容相同（字符串相等）
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
    - 存在 → 字符串内容比对（action.content === localContent）→ 不同才覆盖
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
MCP Server 扫描本地 Git → 生成所有 script_files
  ↓
返回：local_actions_required: [
  { action: write_file, path: ~/.cursor/skills/zoom-build/SKILL.md, content: ... },
  { action: write_file, path: ~/.cursor/skills/zoom-build/scripts/build-cli, content: ..., mode: 0755 },
  { action: write_file, path: ~/.cursor/skills/zoom-build/teams/client-android.json, content: ... }
]
  ↓
客户端（Cursor AI）逐个执行：
  - SKILL.md: 本地内容 === action.content → 跳过写入
  - scripts/build-cli: 本地内容 === action.content → 跳过写入
  - ... 全部相同
  ↓
结果：synced: 0, skipped: 1 (zoom-build already up-to-date)
```

**第三次同步（服务端更新了 build-cli）：**
```
sync_resources(mode: incremental)
  ↓
MCP Server 扫描本地 Git → 生成所有 script_files（包含更新后的 build-cli）
  ↓
返回：local_actions_required: [
  { action: write_file, path: ~/.cursor/skills/zoom-build/SKILL.md, content: ... },
  { action: write_file, path: ~/.cursor/skills/zoom-build/scripts/build-cli, content: ...(NEW), mode: 0755 },
  { action: write_file, path: ~/.cursor/skills/zoom-build/teams/client-android.json, content: ... }
]
  ↓
客户端（Cursor AI）逐个执行：
  - SKILL.md: 内容相同 → 跳过
  - scripts/build-cli: 内容不同 → 写入 ✅
  - teams/*.json: 内容相同 → 跳过
  ↓
结果：synced: 1 (partial update), skipped: 0
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

### 6.1 服务端变更（已废弃，采用客户端 Git 扫描）

~~原计划通过服务端 API 提供元数据，已在 v2.0 中废弃。~~

### 6.2 MCP Server 变更

| 模块 | 变更内容 | 影响范围 |
|------|---------|---------|
| **sync_resources** | 调用 `multiSourceGitManager.scanResourceMetadata()` 扫描本地 Git，生成 `local_actions_required` | 核心工具 |
| **multi-source-manager** | 新增 `scanResourceMetadata()` 和 `readDirectoryRecursive()` | Git 管理模块 |
| **uninstall_resource** | 新增脚本目录删除逻辑（`delete_file` action） | 核心工具 |

### 6.3 客户端（Cursor AI）责任

| 功能 | 实现方式 |
|------|---------|
| **增量检查** | 执行 `write_file` actions 时，通过 `localContent === action.content` 判断是否跳过 |
| **权限设置** | 执行 `write_file` actions 时，如有 `mode` 字段（如 `0755`），调用 `fs.chmod()` 设置权限 |
| **目录创建** | 写入文件前自动创建父目录（`fs.mkdirSync(parentDir, { recursive: true })`）|

### 6.4 不受影响的部分

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

**服务端（无需数据库迁移）：**

~~原计划通过数据库字段存储元数据，已在 v2.0 中废弃。采用客户端 Git 扫描，无需服务端数据库变更。~~

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
| **内容比对准确率** | 100%（字符串相等，无误判）|

---

## 9. 实施阶段划分

### 阶段 1：服务端资源扫描增强 ~~已废弃~~
~~原计划修改数据库 schema 并新增 API 端点，已在 v2.0 中废弃，采用客户端 Git 扫描。~~

### 阶段 2：MCP Server Git Manager 增强 ✅
- 新增 `multiSourceGitManager.scanResourceMetadata()` 方法
- 新增 `readDirectoryRecursive()` 递归读取文件
- `sync_resources` 调用 Git Manager 代替 API 调用

### 阶段 3：MCP Server `uninstall_resource` 增强 ✅
- 新增脚本目录删除逻辑（生成 `delete_file` action）
- 支持 `remove_from_account` 参数

### 阶段 4：端到端测试 ✅
- 创建 `Test/test-hybrid-skill-sync.js`
- 覆盖 6 个测试场景
- 验证 telemetry 正常上报
- 移除 hash 工具依赖，使用字符串比对

### 阶段 5：文档更新 ✅
- 更新 `Docs/Design/CSP-AI-Agent-API-Mapping.md`（客户端 Git 扫描）
- 更新 `Docs/Design/CSP-AI-Agent-Core-Design.md`（混合同步策略 + 双层架构）
- 更新 `Docs/Design/CSP-AI-Agent-Complete-Design.md`（完整流程 + 客户端责任）

### 阶段 6：跨资源调用指引机制 ✅
- 新增 `PromptManager.buildCrossResourceGuidance()` 方法
- `resolvePromptContentForInvocation()` 在返回内容前添加 Guidance 前缀
- AI Agent 获得明确指引：跨资源调用必须用 `resolve_prompt_content`，内部工具可读本地文件

### 阶段 7：移除 Hash 工具 ✅
- 删除 `src/utils/file-hash.ts` 和 `src/utils/file-permissions.ts`
- 更新文档中所有 hash 相关描述为"字符串相等比对"
- 简化客户端执行逻辑（直接字符串比对，无 crypto 依赖）

---

## 10. 设计权衡与决策

### 决策 1：字符串相等比对 vs Hash 对比

**选择：** 字符串相等比对（`localContent === action.content`）  
**理由：**
- Hash 计算（SHA256）引入额外 CPU 开销，字符串比对更直接
- 字符串相等判断 100% 准确（完全相同即跳过，一个字符不同即覆盖）
- 客户端执行，避免 MCP Server 访问用户本地文件系统的架构复杂性
- 简化代码，移除 `crypto` 依赖和 `file-hash.ts` 工具

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
| **字符串比对误判** | 编码不一致导致误判 | 统一使用 UTF-8 编码，确保 `action.content` 与 `localContent` 一致 |
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
- **AND** remote content (from Git) matches local content (string equality) for all files
- **WHEN** user calls sync_resources with mode=incremental
- **THEN** client SHALL skip all file writes (content equals check)
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

1. **Telemetry 不可丢失** - 所有 Skill/Command 调用必须经过 MCP Server 的 `prompts/get` 或 `resolve_prompt_content`
2. **跨资源调用必须走 MCP Server** - Command/Skill/Rule 引用其他独立 Resource 必须用 `resolve_prompt_content`（不能直接读本地文件）
3. **内部工具可用本地文件** - Skill 调用自己的 `scripts/`、`teams/`、`references/` 可以直接读本地（不需要额外 telemetry）
4. **增量检查必须准确** - 字符串相等判断不能有误判（完全相同才跳过）
5. **权限必须保留** - 可执行脚本下载后必须是 755 权限
6. **原子写入** - 文件写入失败不能留下半成品（使用临时文件 + rename）
7. **跨平台兼容** - Windows、macOS、Linux 都能正常工作
8. **客户端执行** - `local_actions_required` 必须由客户端（Cursor AI）执行，MCP Server 不访问用户本地文件系统
9. **跨资源调用指引自动注入** - `resolve_prompt_content` 返回内容时必须包含 Guidance 前缀

---

## 15. 成功标准

✅ **功能完整性**
- 复杂 Skill 的脚本能够成功调用
- 增量同步准确跳过未变化的文件
- 卸载能够完全清理本地文件

✅ **性能指标**
- 首次同步 5 个文件 < 10s
- 增量同步（无变化）< 2s
- 字符串比对开销 < 1% 总时间（无 hash 计算）

✅ **Telemetry 数据**
- 每次 `/skill/zoom-build` 调用都被记录
- 数据包含：用户 email、命令名称、时间戳

✅ **用户体验**
- 订阅 → 同步 → 使用，三步完成
- 无需手动下载或配置
- 本地文件更新透明（自动）

---

**文档状态：** 实施完成  
**版本：** v2.2.0（移除 hash 工具，使用字符串相等比对）  
**归档状态：** 等待用户确认 npm publish & Git commit
