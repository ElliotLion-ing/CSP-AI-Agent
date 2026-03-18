# CSP-AI-Agent MCP Server - 整体设计方案

**版本**: v1.5  
**日期**: 2026-03-09  
**状态**: OpenSpec Validated ✅  
**补充文档**: 
- [API映射补充文档](./CSP-AI-Agent-API-Mapping.md) ⭐️
- [多线程架构文档](./CSP-AI-Agent-MultiThread-Architecture.md) ⭐️
- [日志记录模块设计](./CSP-AI-Agent-Logging-Design.md) 🆕

> **📌 v1.5更新** (2026-03-09): 
> - ✅ 新增日志记录模块设计，详见 [日志记录模块设计文档](./CSP-AI-Agent-Logging-Design.md)
> - ✅ 明确使用 pino + pino-roll 作为日志解决方案
> - ✅ 实现自动清理 3 天前的日志文件

> **📌 v1.4更新** (2026-03-03): 
> - ✅ 增强scope参数: 支持`general/team/user/all`四级订阅范围
> - ✅ keyword参数必填化: search_resources的keyword改为必填参数
> - ✅ 修复API路径: 所有订阅相关API统一到`/csp/api/resources/subscriptions`
> - ✅ 新增多线程架构设计: 主线程+工作线程池,完全隔离用户操作
> - ✅ 更新参数命名: `scope`使用`general/team/user/all`, `detail`替代`include_metadata`
> - ✅ 统一响应格式: 所有成功响应包含`result: "success"`字段

---

## 目录

1. [项目概述](#一项目概述)
   - 1.1 [项目背景](#11-项目背景)
   - 1.2 [核心价值](#12-核心价值)
   - 1.3 [系统定位](#13-系统定位)
2. [系统架构](#二系统架构)
   - 2.1 [整体架构图](#21-整体架构图)
   - 2.2 [核心设计原则](#22-核心设计原则)
   - 2.3 [Resource ID命名规范](#23-resource-id命名规范)
3. [核心功能模块](#三核心功能模块)
   - 3.1 [六大MCP Tools](#31-六大mcp-tools)
   - 3.2 [下载流程](#32-下载流程sync_resources---增强缓存机制)
   - 3.3 [上传流程](#33-上传流程两步法)
4. [工具详细设计规范](#四工具详细设计规范)
   - 4.1 [sync_resources - 资源同步工具](#41-sync_resources---资源同步工具)
   - 4.2 [manage_subscription - 订阅管理工具](#42-manage_subscription---订阅管理工具)
   - 4.3 [search_resources - 资源搜索工具](#43-search_resources---资源搜索工具)
   - 4.4 [upload_resource - 资源上传工具](#44-upload_resource---资源上传工具)
   - 4.5 [AI Resource 随附配置文件规范](#45-ai-resource-随附配置文件规范)
   - 4.6 [uninstall_resource - 资源卸载工具](#46-uninstall_resource---资源卸载工具)
   - 4.7 [工具组合使用最佳实践](#47-工具组合使用最佳实践)
5. [技术选型与架构](#五技术选型与架构)
   - 5.1 [核心技术栈选型](#51-核心技术栈选型)
6. [技术实现细节](#六技术实现细节)
   - 6.0 [多线程架构实现](#60-多线程架构实现-️-新增) ⭐️
   - 6.1 [SSE连接与鉴权](#61-sse连接与鉴权-已更新为多线程)
   - 6.2 [Manifest格式](#62-manifest格式)
   - 6.3 [原子文件操作](#63-原子文件操作)
   - 6.4 [多层缓存架构](#64-多层缓存架构学习verdaccio)
   - 6.5 [同步状态追踪系统](#65-同步状态追踪系统)
   - 6.6 [日志记录模块](#66-日志记录模块) 🆕
7. [API接口规范](#七api接口规范)
   - 7.1 [认证API](#71-认证api)
   - 7.2 [资源下载API](#72-资源下载api)
   - 7.3 [资源上传API](#73-资源上传api两步)
8. [部署方案](#八部署方案)
   - 8.1 [Docker部署](#81-docker部署推荐)
   - 8.2 [Nginx配置](#82-nginx配置https)
9. [安全设计](#九安全设计)
   - 9.1 [认证与授权](#91-认证与授权)
   - 9.2 [数据传输](#92-数据传输)
   - 9.3 [Git操作安全](#93-git操作安全)
10. [监控与运维](#十监控与运维)
    - 10.1 [关键指标](#101-关键指标)
    - 10.2 [健康检查](#102-健康检查)
    - 10.3 [Prometheus监控配置](#103-prometheus监控配置)
    - 10.4 [告警规则](#104-告警规则)
    - 10.5 [日志管理](#105-日志管理)
    - 10.6 [性能优化建议](#106-性能优化建议)
11. [实施计划](#十一实施计划)
    - 11.1 [四阶段实施](#111-四阶段实施)
    - 11.2 [风险与缓解](#112-风险与缓解)
12. [未来规划](#十二未来规划)
    - 12.1 [短期（3个月）](#121-短期3个月)
    - 12.2 [中期（6个月）](#122-中期6个月)
    - 12.3 [长期（1年）](#123-长期1年)

---

## 一、项目概述

### 1.1 项目背景

**当前问题**：
- 部门内AI开发工具（commands、skills、rules、MCP配置）分散管理
- 开发者无法快速发现和安装团队精选工具
- 工具更新依赖手动操作，导致版本不一致
- 自定义工具难以分享给团队其他成员

**解决方案**：
构建 **CSP-AI-Agent MCP Server**，实现AI工具的集中管理、自动分发和版本控制。

### 1.2 核心价值

| 角色 | 收益 |
|------|------|
| **开发者** | 一键安装团队工具，自动同步更新，快速发现可用资源 |
| **团队管理者** | 统一工具标准，跟踪使用情况，集中版本管理 |
| **工具贡献者** | 便捷分享自定义工具，自动化Git提交流程 |

### 1.3 系统定位

```
CSP Platform（中央服务平台）
    ↓ 通过 SSE + REST API
CSP-AI-Agent MCP Server（分发服务）
    ↓ 集成到
Cursor IDE（开发环境）
```

---

## 二、系统架构

### 2.1 整体架构图

```
┌──────────────── CSP 服务器机器 ────────────────┐
│                                                  │
│  ┌─────────────────────────────────────┐        │
│  │   CSP-AI-Agent MCP Server           │        │
│  │   - 监听 /sse (SSE连接)             │        │
│  │   - 监听 /message (MCP协议)         │        │
│  │   - 提供 6 个核心 Tools             │        │
│  │   - 部署为服务（systemd/Docker）     │        │
│  └─────────────────────────────────────┘        │
│             ↕ (本地调用)                        │
│  ┌─────────────────────────────────────┐        │
│  │   CSP REST API Service              │        │
│  │   - GET  /api/resources/subscriptions│       │
│  │   - GET  /api/resources/download/   │        │
│  │   - POST /api/resources/upload      │        │
│  │   - POST /api/resources/finalize    │        │
│  │   - GET  /api/user/permissions      │        │
│  └─────────────────────────────────────┘        │
│             ↕ (本地文件系统)                    │
│  ┌─────────────────────────────────────┐        │
│  │   Git Repository + File System      │        │
│  │   (git@git.zoom.us:main/csp.git)    │        │
│  │   - commands/                        │        │
│  │   - skills/                          │        │
│  │   - rules/                           │        │
│  │   - temp_uploads/                    │        │
│  └─────────────────────────────────────┘        │
└──────────────────────────────────────────────────┘
           ↕ SSE (元数据) + REST (文件)
┌──────────────── 用户本机 ──────────────────────┐
│                                                  │
│  ┌─────────────────────────────────────┐        │
│  │   Cursor IDE                         │        │
│  │   - mcp.json配置远端SSE URL          │        │
│  │   - 接收订阅资源清单通过SSE          │        │
│  │   - 下载/上传文件通过REST            │        │
│  │   - 写入本地文件系统                 │        │
│  │     * ~/.cursor/rules/              │        │
│  │     * ~/.cursor/skills/             │        │
│  └─────────────────────────────────────┘        │
└──────────────────────────────────────────────────┘
```

### 2.2 核心设计原则

| 原则 | 说明 | 实现方式 |
|------|------|---------|
| **职责分离** | SSE传元数据，REST传文件 | SSE: manifest/事件；REST: 文件传输 |
| **远程部署** | MCP Server在服务器 | 部署为服务，SSE远程连接 |
| **两步上传** | 先上传文件，再触发Git | Step1: REST→upload_id；Step2: MCP tool→Git |
| **订阅模式** | 用户控制下载内容 | 订阅→同步→自动加载 |
| **原子操作** | 防止文件损坏 | 临时文件→验证→原子重命名 |
| **智能缓存** | 多层缓存减少网络开销 | 本地缓存 + 服务端CDN + ETag验证 |
| **状态追踪** | 全生命周期状态监控 | 同步状态 + 验证状态 + 重试机制 |

---

### 2.3 Resource ID命名规范

所有AI资源使用统一的ID格式,确保资源的可识别性和可管理性。

#### 命名格式

```
<功能分类>-<资源类型>-<数字ID>
```

#### 字段说明

| 字段 | 说明 | 长度限制 | 示例 |
|------|------|---------|------|
| **功能分类** | 资源的功能领域或用途 | 2-20字符 | codereview, network, debug, git, jira |
| **资源类型** | 资源的技术类型(固定值) | 固定长度 | mcp, command, skill, rule |
| **数字ID** | 自增序列号,保证唯一性 | 3-6位数字 | 001, 0042, 123456 |

#### 资源类型定义

| 类型 | 说明 | 存储位置 | 示例 |
|------|------|---------|------|
| **mcp** | MCP Server工具(完整的MCP服务) | `~/.cursor/mcp-servers/` | `gitlab-mcp-001` |
| **command** | Cursor命令/规则(单个AI指令) | `~/.cursor/rules/` | `codereview-command-001` |
| **skill** | Cursor技能(可复用的AI能力) | `~/.cursor/skills/` | `debug-skill-001` |
| **rule** | Cursor规则(项目级配置) | `.cursor/rules/` | `security-rule-001` |

#### 功能分类建议

**代码质量类**:
- `codereview`: 代码审查相关
- `refactor`: 重构相关
- `testing`: 测试相关
- `security`: 安全检查相关
- `performance`: 性能优化相关

**开发工具类**:
- `git`: Git操作相关
- `debug`: 调试相关
- `network`: 网络调试相关
- `database`: 数据库操作相关
- `docker`: Docker相关

**集成工具类**:
- `gitlab`: GitLab集成
- `jira`: Jira集成
- `confluence`: Confluence集成
- `jenkins`: Jenkins集成

**通用工具类**:
- `analyze`: 分析类工具
- `format`: 格式化工具
- `convert`: 转换工具
- `generate`: 生成工具

#### 命名示例

```
✅ 正确示例:
  codereview-command-001    # 代码审查命令,第1个
  network-skill-042         # 网络调试技能,第42个
  gitlab-mcp-001            # GitLab MCP Server,第1个
  security-rule-123         # 安全规则,第123个
  debug-command-005         # 调试命令,第5个

❌ 错误示例:
  zNet-command-001          # ❌ 使用模块名(zNet)而非功能分类
  CodeReview-Command-1      # ❌ 大写字母和数字位数不足
  cr-c-1                    # ❌ 过度缩写,不易理解
  codereview_command_001    # ❌ 使用下划线而非连字符
  my-awesome-tool-abc       # ❌ 数字ID必须是纯数字
```

#### ID生成规则

1. **功能分类**: 
   - 全小写字母
   - 使用连字符分隔多个单词
   - 优先使用英文完整单词,避免缩写
   - 新分类需在此文档中注册

2. **资源类型**:
   - 固定值: `mcp`, `command`, `skill`, `rule`
   - 不可自定义

3. **数字ID**:
   - 纯数字,左侧补零
   - 从001开始
   - 每个"功能分类+资源类型"组合独立计数
   - 示例: `codereview-command-001`, `codereview-command-002`, `codereview-skill-001`

#### 资源归属与权限

- **功能分类**: 跨团队共享,按功能组织
- **团队标识**: 通过资源的`metadata.owner_team`字段标识归属
- **权限控制**: 基于团队的读写权限,非ID本身

```json
{
  "id": "codereview-command-001",
  "name": "review-cpp-code",
  "type": "command",
  "metadata": {
    "owner_team": "zNet",
    "category": "codereview",
    "tags": ["cpp", "review"]
  }
}
```

---

## 三、核心功能模块

### 3.1 六大MCP Tools

| Tool | 功能 | 关键参数 |
|------|------|---------|
| **sync_resources** | 同步并加载资源 | mode, scope, types |
| **manage_subscription** | 订阅管理 | action, resource_ids, auto_sync(默认true), scope(默认global), notify(默认true) |
| **search_resources** | 资源搜索 | team, type, keyword |
| **upload_resource** | 上传资源 | resource_id, type, message, team(默认Client-Public) |
| **uninstall_resource** | 卸载资源 | resource_id_or_name, remove_from_account(默认false) |

### 3.2 下载流程（sync_resources - 增强缓存机制）

```
用户调用 sync_resources(mode="incremental", scope="global")
   ↓
【步骤1: 读取本地状态】
   读取 ~/.cursor/.csp-sync-state.json
   获取已缓存资源的元数据:
   - resource_id
   - version
   - hash (sha256)
   - last_synced_at
   - last_verified_at
   - sync_status (synced/failed/verifying)
   ↓
【步骤2: 获取订阅资源清单（带缓存头）】
   MCP Server → GET /csp/api/resources/subscriptions
   Headers:
     - If-None-Match: "{本地清单的ETag}"
     - Authorization: Bearer token
   
   响应:
   - 304 Not Modified → 跳过下载,使用本地缓存
   - 200 OK → 继续处理资源清单
   ↓
【步骤3: 智能差异对比】
   对比本地状态 vs 服务端资源清单:
   
   For each resource in subscriptions:
     ├─ 本地不存在? → 标记为"需下载"
     ├─ version不同? → 标记为"需更新"
     ├─ hash不同? → 标记为"需重新验证"
     └─ 完全一致? → 标记为"跳过"(使用缓存)
   ↓
【步骤4: 带缓存验证的下载】
   For each 标记为"需下载/需更新"的资源:
   
     HTTP GET /csp/api/resources/download/{id}
     Headers:
       - If-None-Match: "{本地文件的hash}"
     
     响应处理:
       ├─ 304 Not Modified
       │    → 本地缓存有效,标记sync_status="cached"
       │    → 更新last_verified_at
       │
       └─ 200 OK  (JSON: { data: { files: [{path, content}] } })
            → 遍历 files[] 数组
            → 校验每个 file.path 不含 ../ (防路径穿越)
            → 按 file.path 写入 ~/.cursor/<type>/<name>/<file.path>
              ├─ skill/mcp  → ~/.cursor/skills/<name>/<path>
              ├─ command    → ~/.cursor/commands/<name>.md
              └─ rule       → ~/.cursor/rules/<name>.mdc
            → 更新sync状态
   ↓
【步骤5: 失败重试机制】
   For each 下载失败的资源:
     - retry_count < 3 → 指数退避重试(1s, 2s, 4s)
     - retry_count >= 3 → 标记为"failed", 记录错误信息
   ↓
【步骤6: 更新本地状态文件】
   更新 ~/.cursor/.csp-sync-state.json:
   {
     "version": "1.0.0",
     "last_sync_at": "2026-03-03T10:00:00Z",
     "manifest_etag": "W/\"abc123\"",
     "manifest_modified": "2026-03-03T09:55:00Z",
     "resources": [
       {
         "id": "codereview-command-001",
         "name": "debug-network",
         "version": "1.0.1",
         "hash": "sha256:def456...",
         "size_bytes": 2048,
         "last_synced_at": "2026-03-03T10:00:05Z",
         "last_verified_at": "2026-03-03T10:00:05Z",
         "sync_status": "synced",
         "retry_count": 0,
         "error_message": null,
         "cache_hit": true  // 本次是否命中缓存
       }
     ],
     "statistics": {
       "total_resources": 10,
       "cached": 8,
       "downloaded": 2,
       "failed": 0,
       "bandwidth_saved_bytes": 16384  // 缓存节省的带宽
     }
   }
   ↓
【步骤7: 返回同步报告】
   {
     "mode": "incremental",
     "health_score": 95,
     "summary": {
       "total": 10,
       "synced": 2,
       "cached": 8,  // 新增: 缓存命中
       "failed": 0
     },
     "performance": {
       "bandwidth_saved": "16 KB",
       "cache_hit_rate": "80%",
       "sync_duration_ms": 1250
     },
     "details": [...],
     "recommendations": [
       "✅ 缓存命中率80%, 性能优秀"
     ]
   }
```

### 3.3 上传流程（两步法）

```
用户: "上传analyze-logs.md，commit消息: Add tool"
   ↓
【判断: 新上传 or 更新已有?】
   ├─ 新上传:
   │    【Step 1: REST上传】
   │       Cursor读取文件 → POST /api/resources/upload
   │       → 收到: {upload_id: "temp-abc123"}  // 临时ID
   │    【Step 2: MCP触发Git】
   │       upload_resource(upload_id, type, message, team)
   │       → MCP Server:
   │          1. 验证upload_id(临时)
   │          2. 生成永久resource_id(如 "Client-Public-cmd-001")
   │          3. 获取文件(upload_id)
   │          4. 写入磁盘
   │          5. git add/commit/push
   │       → 返回: {resource_id, url, version, commit_hash}
   │
   └─ 更新已有:
        【Step 1: 查询现有资源】
           search_resources(team, type, keyword)
           → 找到: {resource_id: "Client-Public-cmd-001", version: "1.2.0"}
        【Step 2: 上传新内容】
           Cursor读取文件 → POST /api/resources/upload
           Query: ?resource_id=Client-Public-cmd-001  // 指定要更新的资源
           → 收到: {upload_id: "temp-xyz789", existing_resource_id: "Client-Public-cmd-001"}
        【Step 3: MCP触发更新】
           upload_resource(
             resource_id: "Client-Public-cmd-001",  // 使用永久ID
             type, message, team
           )
           → MCP Server:
              1. 识别为更新操作(resource_id已存在)
              2. 获取现有版本(1.2.0)
              3. 递增版本号(1.2.1)
              4. 覆盖文件
              5. git add/commit/push
           → 返回: {resource_id, url, version: "1.2.1", commit_hash}
```

---

## 四、工具详细设计规范

本章节详细描述5个核心MCP Tools的参数设计、调用流程、使用场景和最佳实践。

### 4.1 sync_resources - 资源同步工具

**功能**: 同步订阅的资源到本地,同时提供状态查询功能(mode=check)

#### 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| mode | string | 否 | "incremental" | **check**: 仅检查状态,不下载<br>**incremental**: 增量同步,仅更新有变化的<br>**full**: 完全同步,下载所有订阅 |
| scope | string | 否 | "global" | **global**: 全局目录(~/.cursor/)<br>**workspace**: 工作空间(.cursor/)<br>**all**: 两者都同步 |
| types | string[] | 否 | [] | 资源类型过滤,如["command", "skill"]<br>空数组表示所有类型 |

#### 核心流程

1. **参数验证**: 检查mode、scope、types合法性
2. **权限检查**: 验证用户token和下载权限
3. **获取订阅资源清单**: 调用 `/csp/api/resources/subscriptions` 获取订阅的资源列表
4. **增量对比**: 读取本地状态,对比版本和hash,识别需要更新的资源
5. **执行同步**: 
   - mode=check: 返回状态报告,不下载
   - mode=incremental: 仅下载有更新的资源
   - mode=full: 下载所有订阅的资源
6. **原子写入**: 临时文件 → hash校验 → rename(原子操作)
7. **更新状态**: 更新 `~/.cursor/.csp-sync-state.json`

#### 使用场景

```javascript
// 场景1: 检查状态(不下载)
sync_resources({ mode: "check" })
// 返回: 健康分数、过期资源列表、建议操作

// 场景2: 增量更新(默认)
sync_resources({ mode: "incremental" })
// 仅下载有更新的资源

// 场景3: 首次完全同步
sync_resources({ mode: "full", scope: "global" })
// 下载所有订阅的资源到全局目录

// 场景4: 仅同步特定类型
sync_resources({ 
  mode: "incremental", 
  types: ["command"] 
})
// 仅同步命令类型资源
```

#### 返回格式

```json
{
  "mode": "incremental",
  "health_score": 95,
  "summary": {
    "total": 10,
    "synced": 2,
    "cached": 8,
    "skipped": 0,
    "failed": 0
  },
  "performance": {
    "sync_duration_ms": 1250,
    "bandwidth_saved": "16 KB",
    "cache_hit_rate": "80%",
    "avg_download_speed": "2.5 MB/s"
  },
  "details": [
    {
      "id": "codereview-command-001",
      "name": "debug-network",
      "action": "updated",
      "version": "1.0.0 → 1.0.1",
      "path": "~/.cursor/rules/debug-network.md",
      "sync_status": "synced",
      "last_synced_at": "2026-03-03T10:00:05Z",
      "last_verified_at": "2026-03-03T10:00:05Z",
      "cache_hit": false,
      "size_bytes": 2048,
      "download_time_ms": 120
    },
    {
      "id": "Client-Public-cmd-002",
      "name": "analyze-logs",
      "action": "cached",
      "version": "1.2.3",
      "path": "~/.cursor/rules/analyze-logs.md",
      "sync_status": "synced",
      "last_synced_at": "2026-03-02T15:30:00Z",
      "last_verified_at": "2026-03-03T10:00:02Z",
      "cache_hit": true,
      "size_bytes": 4096,
      "verification_time_ms": 5
    }
  ],
  "sync_state": {
    "manifest_etag": "W/\"abc123\"",
    "manifest_modified": "2026-03-03T09:55:00Z",
    "total_bandwidth_saved_bytes": 32768,
    "resources_with_errors": []
  },
  "recommendations": [
    "✅ 缓存命中率80%, 性能优秀",
    "✅ 所有资源已同步到最新版本"
  ]
}
```

---

### 4.2 manage_subscription - 订阅管理工具

**功能**: 管理资源订阅,支持订阅、取消订阅、查看订阅列表

#### 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| action | string | 是 | - | **subscribe**: 订阅资源<br>**unsubscribe**: 取消订阅<br>**list**: 查看订阅列表<br>**batch_subscribe**: 批量订阅<br>**batch_unsubscribe**: 批量取消 |
| resource_ids | string[] | 条件 | - | 资源ID列表,action=list时可为空 |
| auto_sync | boolean | 否 | true | 订阅后是否自动同步到本地 |
| scope | string | 否 | "global" | **global**: 全局安装<br>**workspace**: 工作空间安装 |
| notify | boolean | 否 | true | 是否接收资源更新通知 |

#### 核心流程

**订阅流程**:
1. 验证resource_ids是否存在且有权限访问
2. 调用 `/csp/api/resources/subscriptions/add` 添加订阅记录
3. 更新本地订阅配置 `~/.cursor/.csp-subscriptions.json`
4. 如果auto_sync=true,自动调用sync_resources下载

**取消订阅流程**:
1. 调用 `/csp/api/resources/subscriptions/remove` 删除服务端记录
2. 更新本地订阅配置
3. 询问用户是否删除本地文件(可选调用uninstall_resource)

#### 使用场景

```javascript
// 场景1: 订阅单个资源
manage_subscription({
  action: "subscribe",
  resource_ids: ["Client-Public-cmd-001"],
  auto_sync: true  // 自动下载
})

// 场景2: 批量订阅
manage_subscription({
  action: "batch_subscribe",
  resource_ids: ["codereview-command-001", "zNet-cmd-003"],
  scope: "workspace"  // 安装到工作空间
})

// 场景3: 查看订阅列表
manage_subscription({
  action: "list"
})

// 场景4: 取消订阅
manage_subscription({
  action: "unsubscribe",
  resource_ids: ["codereview-command-001"]
})
// 会询问是否删除本地文件
```

#### 订阅配置文件格式

```json
{
  "version": "1.0.0",
  "last_updated": "2026-03-02T10:00:00Z",
  "subscriptions": [
    {
      "id": "Client-Public-cmd-001",
      "name": "analyze-logs",
      "type": "command",
      "subscribed_at": "2026-03-01T10:00:00Z",
      "auto_sync": true,
      "scope": "global",
      "notify": true,
      "metadata": {
        "module": "zNet",
        "tags": ["debugging"]
      }
    }
  ]
}
```

---

### 4.3 search_resources - 资源搜索工具

**功能**: 按团队、类型、关键词搜索可用资源

#### 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| team | string | 否 | "" | 团队过滤,如"zNet"、"Client-Public"<br>空字符串表示搜索所有有权限的团队 |
| type | string | 否 | "" | 资源类型,如"command"、"skill"、"rule"<br>空字符串表示所有类型 |
| keyword | string | 是 | — | 关键词,在名称/描述/标签中搜索 |

#### 核心流程

1. **获取用户信息**: 从session获取用户所属团队
2. **处理team参数**: 空字符串时使用用户所有团队
3. **调用搜索API**: `GET /csp/api/resources/search`
4. **多字段搜索**: 在name、description、tags、module中搜索
5. **权限过滤**: 仅返回用户有权访问的资源
6. **相关度排序**: 按匹配度和更新时间排序
7. **增强结果**: 标记is_subscribed、is_installed状态

#### 使用场景

```javascript
// 场景1: 查看团队所有资源
search_resources({
  team: "zNet",
  type: "",
  keyword: ""
})

// 场景2: 搜索特定类型
search_resources({
  team: "",  // 所有团队
  type: "command",
  keyword: ""
})

// 场景3: 关键词搜索
search_resources({
  team: "",
  type: "",
  keyword: "debug network"
})

// 场景4: 组合搜索
search_resources({
  team: "zNet",
  type: "skill",
  keyword: "performance"
})
```

#### 返回格式

```json
{
  "total": 25,
  "results": [
    {
      "id": "Client-Public-cmd-001",
      "name": "analyze-logs",
      "type": "command",
      "team": "Client-Public",
      "version": "1.2.3",
      "description": "分析Zoom SDK日志文件",
      "score": 9.5,
      "metadata": {
        "module": "zNet",
        "tags": ["debugging", "logs"],
        "author": "user@example.com",
        "updated_at": "2026-02-28",
        "downloads": 125
      },
      "download_url": "https://.../download/Client-Public-cmd-001",
      "is_subscribed": false,
      "is_installed": false
    }
  ]
}
```

#### 资源组织结构

```
teams/
├── Client-Public/
│   ├── commands/
│   ├── skills/
│   └── rules/
├── zNet/
│   ├── commands/
│   ├── skills/
│   └── rules/
└── zMedia/
    └── ...
```

---

### 4.4 upload_resource - 资源上传工具

**功能**: 上传新资源或更新已有资源到Git仓库

#### 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| resource_id | string | 是 | - | 新上传: 使用Step1返回的临时upload_id<br>更新: 使用已有的永久resource_id |
| type | string | 是 | - | 资源类型: command/skill/rule/mcp |
| message | string | 是 | - | Git提交信息(5-200字符) |
| team | string | 否 | "Client-Public" | 资源所属团队 |

#### 核心流程(两步上传法)

**Step 1: REST上传文件内容**
1. Cursor读取本地文件（单文件或整个目录）
2. 提取文件元数据(名称、类型、描述等)
3. `POST /csp/api/resources/upload` 上传内容，统一使用 `files[]` 数组
   - 单文件资源（command / rule）：数组中放一个元素
   - 多文件资源（skill / mcp）：数组中放多个元素，`path` 字段保留目录结构
4. 服务器验证(大小、路径安全、权限、重复检测)
5. 暂存文件/目录结构,生成临时upload_id
6. 返回upload_id和预览信息

**Step 2: MCP触发Git提交**
1. 用户确认并提供commit消息
2. 调用upload_resource工具
3. 服务器识别新增还是更新:
   - 临时ID(temp-xxx) → 新增,生成永久resource_id
   - 永久ID → 更新,版本号递增
4. 写入Git仓库(teams/{team}/{type}/{name}/ 或 teams/{team}/{type}/{name}.md)
5. Git提交和推送
6. 更新数据库索引
7. 清理临时文件

#### resource_id生成规则

```javascript
// 格式: {team}-{type}-{序号}
// 示例:
"Client-Public-cmd-001"  // Client-Public团队的第1个命令
"zNet-skill-005"         // zNet团队的第5个技能
```

#### 使用场景

```javascript
// 场景1: 上传新资源（单文件，command / rule）
// Step 1: 先上传文件，files[] 中放单个元素
const result = await REST.post('/csp/api/resources/upload', {
  type: "command",
  name: "debug-network",
  files: [
    { path: "debug-network.md", content: fileContent },
  ],
});
// 收到: {upload_id: "temp-abc123"}

// Step 2: 触发Git提交
upload_resource({
  resource_id: "temp-abc123",  // 使用临时ID
  type: "command",
  message: "Add network debugging command",
  team: "Client-Public"
})
// 返回: {resource_id: "Client-Public-cmd-001", version: "1.0.0"}

// 场景2: 上传新资源（多文件，mcp / skill）
// Step 1: 先上传多文件，保留目录结构
const result = await REST.post('/csp/api/resources/upload', {
  type: "mcp",
  name: "my-database-mcp",
  files: [
    { path: "server.js",        content: "const { Server } = require(...);\n..." },
    { path: "tools/query.js",   content: "module.exports = async function query(params) { ... }" },
    { path: "tools/schema.js",  content: "module.exports = async function schema(params) { ... }" },
    { path: "package.json",     content: "{\"name\": \"my-database-mcp\", \"version\": \"1.0.0\"}" },
  ],
});
// 收到: {upload_id: "temp-xyz789"}

// Step 2: 触发Git提交
upload_resource({
  resource_id: "temp-xyz789",
  type: "mcp",
  message: "Add my-database-mcp",
  team: "Client-Public"
})
// 返回: {resource_id: "Client-Public-mcp-003", version: "1.0.0"}

// 场景3: 更新已有资源
// 先搜索找到resource_id
const existing = search_resources({keyword: "debug-network"});
// → resource_id: "Client-Public-cmd-001"

// Step 1: 上传新版本
const result = await REST.post('/csp/api/resources/upload', {
  type: "command",
  name: "debug-network",
  files: [
    { path: "debug-network.md", content: newContent },
  ],
}, {
  params: { resource_id: "Client-Public-cmd-001" }
});

// Step 2: 触发更新
upload_resource({
  resource_id: "Client-Public-cmd-001",  // 使用永久ID
  type: "command",
  message: "Fix connection timeout bug"
})
// 返回: {resource_id: "Client-Public-cmd-001", version: "1.0.1"}
```

#### 版本号递增规则

```javascript
// patch: x.y.z+1 (默认,bug修复)
"1.0.0" → "1.0.1"

// minor: x.y+1.0 (功能更新,向后兼容)
"1.0.5" → "1.1.0"

// major: x+1.0.0 (重大更新,不兼容)
"1.5.3" → "2.0.0"
```

---

### 4.5 AI Resource 随附配置文件规范

#### 概述

部分类型的 AI Resource 在上传时，除资源本身的文件外，还需同步上传一个**配置描述文件**，以便 MCP Server 在将资源同步（`sync_resources`）到用户本地后，能够自动完成必要的环境配置。

目前需要随附配置文件的资源类型：

| 资源类型 | 是否需要配置文件 | 文件名 |
|---------|----------------|--------|
| `mcp`   | ✅ **必须**     | `mcp-config.json` |
| `skill` | ❌ 不需要       | — |
| `command` | ❌ 不需要     | — |
| `rule`  | ❌ 不需要       | — |

---

#### 4.5.1 MCP Server — `mcp-config.json`

**作用**：`sync_resources` 将 MCP Server 文件下载到 `~/.cursor/mcp-servers/<name>/` 后，读取该目录下的 `mcp-config.json`，自动将服务器注册到 `~/.cursor/mcp.json`，无需用户手动编辑。

**文件格式**：

```json
{
  "name": "jenkins",
  "command": "python3",
  "args": ["jenkins_mcp_server.py"],
  "env": {
    "JENKINS_URL": "",
    "JENKINS_USERNAME": "",
    "JENKINS_API_TOKEN": ""
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 否 | MCP server 的键名；省略时使用资源名 |
| `command` | string | ✅ | 启动命令，如 `python3`、`node`、`uvx` 等 |
| `args` | string[] | ✅ | 启动参数，**相对路径基于安装目录解析为绝对路径** |
| `env` | object | 否 | 需要用户填写的环境变量；空字符串表示用户必须配置 |

**注册流程**：

```
sync_resources 下载 MCP 文件到 ~/.cursor/mcp-servers/<name>/
  ↓
读取 mcp-config.json（权威来源）
  ├─ 找到 → 用 command/args/env，相对 args 转绝对路径
  └─ 找不到 → 回退到启发式扫描（不可靠，产生 WARN 日志）
  ↓
原子写入 ~/.cursor/mcp.json（幂等，重复 sync 覆盖更新）
```

生成的 `mcp.json` 条目示例：

```json
{
  "mcpServers": {
    "jenkins": {
      "command": "python3",
      "args": ["/Users/<user>/.cursor/mcp-servers/jenkins/jenkins_mcp_server.py"],
      "env": {
        "JENKINS_URL": "",
        "JENKINS_USERNAME": "",
        "JENKINS_API_TOKEN": ""
      }
    }
  }
}
```

**上传时的 `files[]` 要求**：

使用 `upload_resource` 上传 MCP Server 时，`files[]` 中必须包含 `mcp-config.json`：

```json
{
  "type": "mcp",
  "name": "jenkins",
  "files": [
    { "path": "mcp-config.json",          "content": "{...}" },
    { "path": "jenkins_mcp_server.py",    "content": "..." },
    { "path": "requirements.txt",         "content": "..." },
    { "path": "README_JENKINS_MCP.md",    "content": "..." }
  ]
}
```

---

### 4.6 uninstall_resource - 资源卸载工具

**功能**: 从本地删除资源,可选择是否同时取消账户订阅

#### 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| resource_id_or_name | string | 是 | - | 支持多种格式:<br>**精确ID**: "Client-Public-cmd-001"<br>**资源名称**: "debug-network"<br>**模糊匹配**: "debug"<br>**序号**: "1" 或 "1,2,5"<br>**all**: 卸载所有 |
| remove_from_account | boolean | 否 | false | **false**: 仅删除本地文件,保留订阅<br>**true**: 删除本地 + 取消账户订阅 |

#### 核心流程

1. **智能匹配资源**:
   - 读取本地已安装资源
   - 读取账户订阅列表
   - 合并并标记状态(is_installed, is_subscribed)
   - 根据输入智能匹配(ID/名称/模糊/序号)

2. **处理匹配结果**:
   - 0个匹配 → 返回"未找到"
   - 1个匹配 → 直接使用
   - 多个匹配 → 展示列表让用户选择

3. **二次确认**:
   - 显示要删除的资源列表
   - 显示操作范围(本地/订阅)
   - 要求用户输入"yes"确认

4. **执行删除**:
   - 删除本地文件
   - 更新本地状态(sync-state.json)
   - 如果remove_from_account=true:
     - 调用 `/csp/api/resources/subscriptions/remove`
     - 更新订阅配置(subscriptions.json)

#### 使用场景

```javascript
// 场景1: 使用名称卸载(仅删除本地)
uninstall_resource({
  resource_id_or_name: "debug-network",
  remove_from_account: false  // 默认,保留订阅
})
// 结果: 删除本地文件,可随时sync_resources重新下载

// 场景2: 完全移除(包括订阅)
uninstall_resource({
  resource_id_or_name: "debug-network",
  remove_from_account: true
})
// 结果: 删除本地 + 取消订阅,需重新搜索订阅才能使用

// 场景3: 模糊匹配(多个结果)
uninstall_resource({
  resource_id_or_name: "debug"
})
// 找到3个匹配,显示列表让用户选择序号

// 场景4: 使用序号(从列表选择)
// 用户先查看列表
sync_resources({mode: "check"})
// 显示带序号的列表

// 然后删除
uninstall_resource({
  resource_id_or_name: "1,3"  // 删除第1和第3个
})

// 场景5: 清理孤立文件
uninstall_resource({
  resource_id_or_name: "orphaned-file-id",
  remove_from_account: false  // 未订阅,无需取消
})
```

#### 智能匹配逻辑

```javascript
function matchResources(input, allResources) {
  // 1. 精确ID匹配
  if (/^[A-Za-z]+-[a-z]+-\d{3}$/.test(input)) {
    return [allResources.find(r => r.id === input)];
  }
  
  // 2. 序号匹配
  if (/^\d+(,\d+)*$/.test(input)) {
    const indices = input.split(',').map(i => parseInt(i) - 1);
    return indices.map(i => lastDisplayedList[i]);
  }
  
  // 3. all关键词
  if (input === 'all') {
    return allResources.filter(r => r.is_installed);
  }
  
  // 4. 模糊名称匹配
  return allResources.filter(r => 
    r.name.toLowerCase().includes(input.toLowerCase())
  );
}
```

#### 确认提示示例

```
⚠️ 即将卸载以下资源:

1. debug-network (命令, 3.2 KB) - 已订阅
   路径: ~/.cursor/rules/debug-network.md

2. debug-analyzer (技能, 5.1 KB) - 已订阅
   路径: ~/.cursor/skills/debug-analyzer.md

📦 操作范围:
• ✅ 删除本地文件
• ❌ 保留账户订阅 (可随时重新同步)

💡 如需完全移除(取消订阅), 请使用 remove_from_account=true

确认卸载吗? (输入 'yes' 确认)
```

---

### 4.7 工具组合使用最佳实践

#### 完整工作流示例

```javascript
// 1. 搜索需要的工具
const results = search_resources({
  team: "zNet",
  type: "command",
  keyword: "debug"
});
// 找到: debug-network

// 2. 订阅工具(自动下载)
manage_subscription({
  action: "subscribe",
  resource_ids: ["codereview-command-001"],
  auto_sync: true
});
// 自动下载到 ~/.cursor/rules/

// 3. 检查状态
sync_resources({ mode: "check" });
// 查看健康分数和同步状态

// 4. 增量更新
sync_resources({ mode: "incremental" });
// 仅更新有新版本的资源

// 5. 上传自定义工具
upload_resource({
  resource_id: "temp-abc123",
  type: "command",
  message: "Add my custom tool",
  team: "Client-Public"
});
// 分享给团队其他成员

// 6. 清理不需要的工具
uninstall_resource({
  resource_id_or_name: "old-tool",
  remove_from_account: false  // 保留订阅
});
```

#### 常见场景快速指南

| 场景 | 使用工具 | 说明 |
|------|---------|------|
| 首次使用 | search_resources → manage_subscription | 搜索并订阅需要的工具 |
| 每日更新 | sync_resources(mode="incremental") | 增量同步,仅更新变化的 |
| 检查状态 | sync_resources(mode="check") | 查看健康分数和过期资源 |
| 清理磁盘 | uninstall_resource(remove_from_account=false) | 删除本地,保留订阅 |
| 完全移除 | uninstall_resource(remove_from_account=true) | 删除本地 + 取消订阅 |
| 分享工具 | upload_resource | 上传到Git,团队共享 |
| 取消工具 | manage_subscription(action="unsubscribe") | 仅取消订阅,不删本地 |

#### 错误处理最佳实践

```javascript
// 1. 网络错误自动重试
try {
  await sync_resources({ mode: "incremental" });
} catch (error) {
  if (error.code === 'NETWORK_ERROR') {
    // 自动重试3次
    await retryWithBackoff(sync_resources, 3);
  }
}

// 2. Token过期自动刷新
if (error.code === 4010) {
  await refreshToken();
  await retryOperation();
}

// 3. 权限不足提示用户
if (error.code === 4030) {
  showMessage("您没有权限访问该资源,请联系团队管理员");
}

// 4. 冲突时提示解决方案
if (error.code === 4090) {
  showMessage("资源名称冲突,请修改名称或更新现有资源");
}
```

---

## 五、技术选型与架构

### 5.1 核心技术栈选型

#### 5.1.1 编程语言: TypeScript/Node.js

**选型理由**:

| 维度 | 说明 |
|------|------|
| **轻量级分发** | 完美支持npx方式: `npx @your-org/csp-ai-agent-mcp` |
| **版本管理** | npm生态成熟,版本发布简单: `npm version patch && npm publish` |
| **官方SDK支持** | MCP官方提供TypeScript SDK: `@modelcontextprotocol/sdk` |
| **开发效率** | 类型安全 + 快速迭代 + 丰富的工具链 |
| **生态成熟度** | 海量npm包可用(express, ioredis, pg, simple-git等) |
| **异步IO优势** | 天然适合IO密集型场景(SSE连接、文件下载、Git操作) |
| **JSON处理** | 原生支持,无需额外序列化/反序列化 |
| **社区活跃** | 庞大的开发者社区,问题解决快 |

**对比其他方案**:

| 语言 | 优势 | 劣势 | 综合评分 |
|------|------|------|---------|
| **TypeScript/Node.js** | npx完美支持、官方SDK、开发快 | 内存占用相对较高 | ⭐️⭐️⭐️⭐️⭐️ |
| Go | 性能高、部署简单、单二进制 | 分发不如npx方便、JSON繁琐 | ⭐️⭐️⭐️⭐️ |
| Rust | 极致性能、内存安全 | 学习曲线陡、开发慢、生态弱 | ⭐️⭐️⭐️ |
| Python | 开发快、生态丰富 | 性能差、打包难、类型弱 | ⭐️⭐️ |

**版本要求**:
- Node.js: >= 18.0.0 (LTS)
- TypeScript: >= 5.3.0
- 目标: ES2022

#### 5.1.2 核心依赖库

**精简依赖原则**: 只使用必要的依赖，避免过度依赖第三方库。

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",  // MCP 官方 SDK
    "axios": "^1.6.0",                       // HTTP 客户端（调用 REST API）
    "simple-git": "^3.22.0",                 // Git 操作
    "pino": "^8.19.0",                       // 结构化日志
    "dotenv": "^16.4.0"                      // 环境变量管理
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "tsx": "^4.7.0",                         // 开发时热重载
    "vitest": "^1.2.0",                      // 单元测试
    "@types/node": "^20.11.0",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.19.0",
    "prettier": "^3.2.0"
  }
}
```

**依赖说明**:
- ✅ `@modelcontextprotocol/sdk` - MCP 协议支持（必需）
- ✅ `axios` - 调用 CSP REST API（必需）
- ✅ `simple-git` - Git 操作，拉取/推送资源（必需）
- ✅ `pino` - 高性能结构化日志（必需）
- ❌ 移除 `express` - MCP Server 使用 SSE，不需要 HTTP 服务器
- ❌ 移除 `ioredis`、`pg`、`node-cache` - MCP Server 不管理数据库
- ❌ 移除 `compression`、`zod` - 简化依赖

#### 5.1.3 项目结构

```
csp-ai-agent-mcp/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── src/
│   ├── index.ts                    # CLI入口
│   ├── server.ts                   # MCP Server主逻辑
│   ├── config/
│   │   ├── index.ts                # 配置管理
│   │   └── constants.ts            # 常量定义
│   ├── tools/                      # MCP Tools实现
│   │   ├── sync-resources.ts       # sync_resources工具
│   │   ├── manage-subscription.ts  # manage_subscription工具
│   │   ├── search-resources.ts     # search_resources工具
│   │   ├── upload-resource.ts      # upload_resource工具
│   │   └── uninstall-resource.ts   # uninstall_resource工具
│   ├── cache/                      # 缓存层实现
│   │   ├── index.ts                # 缓存管理器
│   │   ├── memory-cache.ts         # L1内存缓存
│   │   ├── disk-cache.ts           # L2磁盘缓存
│   │   └── redis-cache.ts          # L3 Redis缓存
│   ├── state/                      # 状态追踪
│   │   ├── tracker.ts              # 状态追踪器
│   │   ├── retry-manager.ts        # 重试管理
│   │   └── health-checker.ts       # 健康检查
│   ├── api/                        # API客户端
│   │   ├── csp-client.ts           # CSP REST API客户端
│   │   └── types.ts                # API类型定义
│   ├── transport/                  # 传输层
│   │   ├── sse-server.ts           # SSE服务器
│   │   └── auth.ts                 # 认证中间件
│   ├── utils/                      # 工具函数
│   │   ├── logger.ts               # 日志工具
│   │   ├── hash.ts                 # Hash计算
│   │   ├── file.ts                 # 文件操作
│   │   └── validation.ts           # 数据验证
│   └── types/                      # 全局类型定义
│       ├── resources.ts
│       ├── state.ts
│       └── cache.ts
├── dist/                           # 编译输出(生产代码)
├── tests/                          # 测试文件
│   ├── unit/
│   ├── integration/
│   └── fixtures/
└── scripts/                        # 构建脚本
    ├── build.sh
    └── release.sh
```

#### 5.1.4 构建和打包

**开发模式**:
```bash
# 安装依赖
npm install

# 开发模式(热重载)
npm run dev

# 类型检查
npm run type-check

# 代码检查
npm run lint

# 运行测试
npm test
```

**生产构建**:
```bash
# 编译TypeScript
npm run build

# 输出: dist/目录
# - dist/index.js (入口)
# - dist/**/*.js (所有模块)
# - dist/**/*.d.ts (类型声明)
```

**单文件打包(可选)**:
```bash
# 使用@vercel/ncc打包成单文件
npm install -g @vercel/ncc
ncc build src/index.ts -o standalone

# 或使用pkg打包成可执行文件
npm install -g pkg
pkg package.json --targets node18-linux-x64,node18-macos-arm64,node18-win-x64
```

#### 5.1.5 分发方式

**方式1: NPM包(推荐)**
```bash
# 用户使用(零安装)
npx @your-org/csp-ai-agent-mcp start

# 或全局安装
npm install -g @your-org/csp-ai-agent-mcp
csp-ai-agent-mcp start

# 版本发布
npm version patch  # 1.0.0 -> 1.0.1
npm publish
```

**方式2: Docker镜像**
```bash
# 构建镜像
docker build -t csp-ai-agent-mcp:1.0.0 .

# 运行
docker run -p 5090:5090 csp-ai-agent-mcp:1.0.0

# 推送到Registry
docker push ghcr.io/your-org/csp-ai-agent-mcp:1.0.0
```

**方式3: 单二进制文件(备选)**
```bash
# 使用pkg打包
pkg package.json

# 生成文件:
# - csp-ai-agent-mcp-linux
# - csp-ai-agent-mcp-macos
# - csp-ai-agent-mcp-win.exe
```

#### 5.1.6 配置管理

**环境变量(.env)**:
```bash
# 服务配置
NODE_ENV=production
PORT=5090
LOG_LEVEL=info

# CSP API
CSP_API_BASE_URL=https://csp.example.com/api
CSP_API_TIMEOUT=30000

# 缓存配置
REDIS_URL=redis://localhost:6379
REDIS_TTL=900
MEMORY_CACHE_SIZE=20
DISK_CACHE_PATH=~/.cursor/.csp-cache

# 数据库(可选,如果使用PostgreSQL)
DATABASE_URL=postgresql://user:pass@localhost:5432/csp

# Git配置
GIT_REPO_PATH=/path/to/git/repos
GIT_USER_NAME=CSP Agent
GIT_USER_EMAIL=agent@example.com

# 监控(可选)
ENABLE_METRICS=true
METRICS_PORT=9090
SENTRY_DSN=https://xxx@sentry.io/xxx
```

**配置类型定义**:
```typescript
// src/config/index.ts
import { z } from 'zod';

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']),
  port: z.number().min(1024).max(65535),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  
  csp: z.object({
    apiBaseUrl: z.string().url(),
    timeout: z.number().positive()
  }),
  
  cache: z.object({
    redis: z.object({
      url: z.string(),
      ttl: z.number().positive()
    }),
    memory: z.object({
      maxSize: z.number().positive()
    }),
    disk: z.object({
      path: z.string()
    })
  }),
  
  git: z.object({
    repoPath: z.string(),
    userName: z.string(),
    userEmail: z.string().email()
  }),
  
  metrics: z.object({
    enabled: z.boolean(),
    port: z.number().optional()
  })
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '5090'),
    logLevel: process.env.LOG_LEVEL || 'info',
    // ... 其他配置
  });
}
```

#### 5.1.7 日志和监控

**结构化日志(Pino)**:
```typescript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  },
  serializers: {
    error: pino.stdSerializers.err
  }
});

// 使用示例
logger.info({ resourceId: 'codereview-command-001' }, 'Resource synced');
logger.error({ error, userId: 'user123' }, 'Sync failed');
```

**Prometheus指标**:
```typescript
import client from 'prom-client';

// 创建Registry
const register = new client.Registry();

// 定义指标
export const metrics = {
  sseConnections: new client.Gauge({
    name: 'csp_sse_connections_active',
    help: 'Number of active SSE connections',
    registers: [register]
  }),
  
  apiRequests: new client.Counter({
    name: 'csp_api_requests_total',
    help: 'Total API requests',
    labelNames: ['method', 'path', 'status'],
    registers: [register]
  }),
  
  cacheHits: new client.Counter({
    name: 'csp_cache_hits_total',
    help: 'Cache hit count',
    labelNames: ['layer'],
    registers: [register]
  }),
  
  syncDuration: new client.Histogram({
    name: 'csp_sync_duration_seconds',
    help: 'Sync operation duration',
    buckets: [0.1, 0.5, 1, 2, 5, 10],
    registers: [register]
  })
};

// 暴露metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

---

## 六、技术实现细节

### 6.0 多线程架构实现 ⭐️ 新增

#### 6.0.1 为什么需要多线程?

**单线程阻塞问题**:
```
❌ 单线程模式:
用户A: upload_resource → Git操作卡死(30s) → 主线程阻塞
                                                ↓
用户B: sync_resources → 无法响应 ❌
用户C: search_resources → 无法响应 ❌

✅ 多线程模式:
用户A: upload_resource → 工作线程1处理(阻塞30s)
用户B: sync_resources → 工作线程2处理 ✅ 正常执行
用户C: search_resources → 工作线程3处理 ✅ 正常执行
```

#### 6.0.2 线程模型设计

```
┌────────────────────────────────────────────────────────┐
│                   主线程 (Main Thread)                  │
│  【职责】                                               │
│  - 维护所有SSE连接 (每个用户独立)                      │
│  - 接收MCP请求,立即返回"accepted"                      │
│  - 将任务分发到工作线程池                              │
│  - 不执行任何阻塞操作                                  │
│                                                         │
│  【绝对不做】                                           │
│  ❌ REST API调用                                       │
│  ❌ Git操作                                            │
│  ❌ 文件IO                                             │
│  ❌ 任何超过10ms的操作                                 │
└─────────────────┬──────────────────────────────────────┘
                  │ 通过MessageChannel分发任务
                  ↓
┌────────────────────────────────────────────────────────┐
│              工作线程池 (Worker Thread Pool)            │
│  【配置】                                               │
│  - 线程数: CPU核心数 * 2 (最小4,最大16)               │
│  - 每个线程独立处理用户请求                            │
│                                                         │
│  【职责】                                               │
│  - 执行所有阻塞操作: REST API、Git、文件IO            │
│  - 资源追踪和清理                                      │
│  - 超时检测和强制终止                                  │
│  - 完成后通过MessageChannel返回结果                   │
│                                                         │
│  【隔离机制】                                           │
│  - 用户A的任务在线程1 → 阻塞不影响其他线程            │
│  - 用户B的任务在线程2 → 独立执行                      │
│  - 用户C的任务在线程3 → 独立执行                      │
└────────────────────────────────────────────────────────┘
```

#### 6.0.3 用户隔离和并发保证

**每个用户独立的SSE连接**:
```typescript
// 主线程维护所有用户会话
interface UserSession {
  user_id: string;
  connection_id: string;        // 唯一SSE连接ID
  token: string;                // 用户token
  sse_response: Response;       // 专属SSE响应对象
  active_tasks: Set<string>;    // 当前用户的活跃任务列表
}

const sessions = new Map<string, UserSession>();

// 用户A的会话
sessions.set('connection_a', {
  user_id: 'user_a',
  connection_id: 'connection_a',
  token: 'token_a',
  sse_response: res_a,
  active_tasks: new Set(['task_a1', 'task_a2'])
});

// 用户B的会话
sessions.set('connection_b', {
  user_id: 'user_b',
  connection_id: 'connection_b',
  token: 'token_b',
  sse_response: res_b,
  active_tasks: new Set(['task_b1'])
});
```

**任务独立执行保证**:
```typescript
interface Task {
  task_id: string;              // 任务唯一ID (uuid)
  connection_id: string;        // 关联的SSE连接
  user_id: string;              // 用户ID
  tool_name: string;            // MCP Tool名称
  params: any;                  // 参数
  timeout: number;              // 超时时间(ms)
  created_at: number;           // 创建时间戳
}

// 工作线程执行任务时的完全隔离
class WorkerThread {
  async executeTask(task: Task): Promise<any> {
    // 1. 创建独立的执行上下文
    const context = new ExecutionContext(task);
    
    // 2. 注册资源追踪 (防止泄漏)
    const resourceTracker = new ResourceTracker(task.task_id);
    
    try {
      // 3. 执行任务 (可能阻塞,但不影响其他线程)
      const result = await this.executeToolLogic(task, resourceTracker);
      return result;
    } catch (error) {
      throw error;
    } finally {
      // 4. 强制清理资源 (即使超时或异常)
      await resourceTracker.cleanupAll();
    }
  }
}
```

**并发执行示例**:
```
时间线:
0s   用户A: upload_resource(文件1) → 工作线程1开始处理
     主线程: 立即返回"Task accepted, task_id: a1"
     
1s   用户B: sync_resources() → 工作线程2开始处理 ✅ 不受用户A影响
     主线程: 立即返回"Task accepted, task_id: b1"
     
2s   用户C: search_resources() → 工作线程3开始处理 ✅ 不受A/B影响
     主线程: 立即返回"Task accepted, task_id: c1"
     
5s   工作线程3: 完成搜索 → 发送结果给主线程
     主线程: 通过SSE连接C推送结果给用户C ✅
     
15s  工作线程2: 完成同步 → 发送结果给主线程
     主线程: 通过SSE连接B推送结果给用户B ✅
     
30s  工作线程1: 完成上传 → 发送结果给主线程
     主线程: 通过SSE连接A推送结果给用户A ✅
     
【关键】整个过程中,主线程从未阻塞,所有用户请求都立即响应
```

#### 6.0.4 超时和死锁防护

**多级超时保护**:
```typescript
// 1. 任务级超时 (工具指定)
const toolTimeouts = {
  search_resources: 10000,      // 10s (查询操作)
  sync_resources: 60000,        // 60s (下载文件)
  upload_resource: 120000,      // 120s (上传+Git操作)
  manage_subscription: 15000,   // 15s (订阅管理)
  uninstall_resource: 5000      // 5s (删除文件)
};

// 2. 工作线程级超时 (超时+5s buffer)
workerThread.execute(task, task.timeout + 5000);

// 3. 全局超时 (超时+10s buffer,兜底保护)
globalTimeout = setTimeout(() => {
  if (taskStillRunning(task.task_id)) {
    logger.error(`Task ${task.task_id} exceeded global timeout, force killing`);
    forceKillTask(task.task_id);
  }
}, task.timeout + 10000);
```

**强制终止机制**:
```typescript
async function forceKillTask(taskId: string) {
  logger.warn(`Force killing task: ${taskId}`);
  
  // 1. 标记为已终止
  terminatedTasks.add(taskId);
  
  // 2. 发送终止信号到工作线程
  workerThread.postMessage({ 
    type: 'terminate', 
    task_id: taskId 
  });
  
  // 3. 清理所有资源
  // - 关闭文件句柄
  // - 中止HTTP请求
  // - 杀死Git进程
  // - 释放Redis锁
  await resourceTracker.cleanupTask(taskId);
  
  // 4. 返回错误给用户
  sessionManager.pushMessage(connectionId, {
    type: 'task_failed',
    task_id: taskId,
    error: {
      code: 'TASK_TIMEOUT',
      message: 'Task execution timeout, all resources have been cleaned up'
    }
  });
  
  // 5. 5秒后强制释放工作线程 (防止卡死)
  setTimeout(() => {
    const worker = workerPool.getWorkerByTaskId(taskId);
    if (worker && worker.current_task_id === taskId) {
      logger.error(`Worker still stuck on ${taskId}, force releasing`);
      worker.busy = false;
      worker.current_task_id = null;
      workerPool.processQueue(); // 处理下一个任务
    }
  }, 5000);
}
```

#### 6.0.5 资源泄漏防护

**所有可能泄漏的资源**:
1. **文件句柄**: 临时文件未关闭
2. **网络连接**: HTTP请求未中止
3. **子进程**: Git进程未杀死
4. **Redis锁**: 锁未释放
5. **内存**: 缓存未清理

**资源追踪实现**:
```typescript
// src/worker/resource-tracker.ts
interface Resource {
  type: 'file' | 'network' | 'process' | 'redis_lock' | 'memory';
  handle: any;
  metadata: any; // path, url, pid, lockKey等
  close: () => Promise<void>;
}

class ResourceTracker {
  private readonly taskResources = new Map<string, Set<Resource>>();
  
  registerTask(taskId: string) {
    this.taskResources.set(taskId, new Set());
  }
  
  trackResource(taskId: string, resource: Resource) {
    const resources = this.taskResources.get(taskId);
    if (!resources) {
      logger.warn(`Task ${taskId} not registered, auto-registering`);
      this.registerTask(taskId);
    }
    this.taskResources.get(taskId)!.add(resource);
    logger.debug(`Tracked ${resource.type} for task ${taskId}`, resource.metadata);
  }
  
  async cleanupTask(taskId: string): Promise<void> {
    const resources = this.taskResources.get(taskId);
    if (!resources || resources.size === 0) {
      logger.debug(`No resources to cleanup for task ${taskId}`);
      return;
    }
    
    logger.info(`Cleaning up ${resources.size} resources for task ${taskId}`);
    const startTime = Date.now();
    
    // 并行清理所有资源
    const cleanupResults = await Promise.allSettled(
      Array.from(resources).map(async (resource) => {
        try {
          await resource.close();
          logger.debug(`✅ Cleaned ${resource.type}:`, resource.metadata);
        } catch (error) {
          logger.error(`❌ Failed to clean ${resource.type}:`, {
            taskId,
            type: resource.type,
            metadata: resource.metadata,
            error: error.message
          });
          throw error;
        }
      })
    );
    
    // 统计清理结果
    const failed = cleanupResults.filter(r => r.status === 'rejected').length;
    const duration = Date.now() - startTime;
    
    if (failed > 0) {
      logger.warn(`Task ${taskId} cleanup partial failure: ${failed}/${resources.size} failed in ${duration}ms`);
    } else {
      logger.info(`Task ${taskId} cleanup success: all ${resources.size} resources freed in ${duration}ms`);
    }
    
    this.taskResources.delete(taskId);
  }
  
  // Helper methods for tools
  trackFileHandle(taskId: string, filePath: string, handle: any) {
    this.trackResource(taskId, {
      type: 'file',
      handle,
      metadata: { path: filePath },
      close: async () => {
        await handle.close();
        // 也删除临时文件
        if (filePath.includes('.tmp')) {
          await fs.unlink(filePath).catch(() => {});
        }
      }
    });
  }
  
  trackHttpRequest(taskId: string, url: string, abortController: AbortController) {
    this.trackResource(taskId, {
      type: 'network',
      handle: abortController,
      metadata: { url },
      close: async () => {
        abortController.abort();
      }
    });
  }
  
  trackGitProcess(taskId: string, process: ChildProcess, command: string) {
    this.trackResource(taskId, {
      type: 'process',
      handle: process,
      metadata: { pid: process.pid, command },
      close: async () => {
        if (!process.killed) {
          process.kill('SIGTERM');
          // 等待2秒,如果还没死就SIGKILL
          await new Promise<void>(resolve => {
            setTimeout(() => {
              if (!process.killed) {
                process.kill('SIGKILL');
              }
              resolve();
            }, 2000);
          });
        }
      }
    });
  }
  
  trackRedisLock(taskId: string, lockKey: string) {
    this.trackResource(taskId, {
      type: 'redis_lock',
      handle: null,
      metadata: { lockKey, taskId },
      close: async () => {
        await redis.unlock(lockKey, taskId);
      }
    });
  }
}
```

**在MCP Tool中使用资源追踪**:
```typescript
// src/tools/sync-resources.ts
async function syncResources(
  params: any, 
  resourceTracker: ResourceTracker, 
  taskId: string
): Promise<any> {
  // 1. 创建临时文件
  const tempFilePath = `/tmp/sync-${taskId}.tmp`;
  const fileHandle = await fs.open(tempFilePath, 'w');
  resourceTracker.trackFileHandle(taskId, tempFilePath, fileHandle);
  
  // 2. HTTP请求下载
  const abortController = new AbortController();
  resourceTracker.trackHttpRequest(taskId, downloadUrl, abortController);
  const response = await fetch(downloadUrl, { 
    signal: abortController.signal 
  });
  
  // 3. Git操作
  const gitProcess = spawn('git', ['commit', '-m', message]);
  resourceTracker.trackGitProcess(taskId, gitProcess, `git commit`);
  
  // 4. Redis锁
  await redis.lock('sync-lock', taskId);
  resourceTracker.trackRedisLock(taskId, 'sync-lock');
  
  // 5. 执行业务逻辑...
  // 如果超时或异常,resourceTracker.cleanupTask()会自动被调用
  // 所有资源都会被强制清理
  
  return result;
}
```

#### 6.0.6 线程池配置和监控

**动态线程池配置**:
```typescript
// src/worker/pool.ts
class WorkerPool {
  // 根据CPU核心数动态配置
  private static calculateThreadCount(): number {
    const cpuCores = require('os').cpus().length;
    const threadCount = cpuCores * 2;
    
    // 限制范围: [4, 16]
    return Math.max(4, Math.min(16, threadCount));
  }
  
  // 示例:
  // 2-core CPU → 4 threads (最小值)
  // 4-core CPU → 8 threads
  // 8-core CPU → 16 threads (最大值)
  // 16-core CPU → 16 threads (最大值)
}
```

**线程池监控指标**:
```typescript
interface WorkerPoolMetrics {
  total_threads: number;         // 总线程数
  active_threads: number;        // 活跃线程数
  idle_threads: number;          // 空闲线程数
  queue_size: number;            // 队列中等待的任务数
  total_tasks_executed: number;  // 总执行任务数
  total_tasks_failed: number;    // 总失败任务数
  total_tasks_timeout: number;   // 总超时任务数
  avg_task_duration_ms: number;  // 平均任务执行时间
  avg_queue_wait_ms: number;     // 平均队列等待时间
}

// Prometheus metrics
const workerPoolMetrics = {
  activeThreads: new Gauge({
    name: 'worker_pool_active_threads',
    help: 'Number of active worker threads'
  }),
  queueSize: new Gauge({
    name: 'worker_pool_queue_size',
    help: 'Number of tasks waiting in queue'
  }),
  taskDuration: new Histogram({
    name: 'worker_pool_task_duration_seconds',
    help: 'Task execution duration',
    labelNames: ['tool_name', 'status'],
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120]
  })
};
```

### 6.1 SSE连接与鉴权 (已更新为多线程)

**mcp.json配置**：
\`\`\`json
{
  "mcpServers": {
    "csp-ai-agent": {
      "transport": "sse",
      "url": "https://csp.example.com/sse",
      "headers": {
        "Authorization": "Bearer user-token-xxx"
      }
    }
  }
}
\`\`\`

**鉴权流程**：
1. Cursor发起SSE连接（带Authorization header）
2. MCP Server调用 /csp/api/user/permissions 验证token
3. 验证成功→建立SSE流，生成session ID
4. 每30s发送heartbeat防止超时

**Token传递与验证机制**：
```
┌─────────── SSE连接建立 ───────────┐
│ Cursor → MCP Server                │
│ Header: Authorization: Bearer xxx  │
│ → 验证token → 保存到session        │
└────────────────────────────────────┘
           ↓
┌─────────── 后续所有REST API请求 ──────────┐
│ 1. 用户触发操作(如订阅/下载/上传)          │
│    ↓                                       │
│ 2. MCP Server发送指令给Cursor(通过SSE)    │
│    {                                       │
│      action: "download",                   │
│      url: "https://.../api/resources/...", │
│      token: session.token  // 传递token    │
│    }                                       │
│    ↓                                       │
│ 3. Cursor执行REST请求                     │
│    HTTP GET/POST {url}                     │
│    Header: Authorization: Bearer {token}   │
│    ↓                                       │
│ 4. CSP REST API验证token                  │
│    - 解析Authorization header              │
│    - 验证token有效性(过期/签名/权限)       │
│    - 检查用户对资源的访问权限              │
│    ↓                                       │
│ 5. 返回结果                                │
│    - 成功: 200 + 数据                      │
│    - 鉴权失败: 401 Unauthorized            │
│    - 权限不足: 403 Forbidden               │
│    - 资源不存在: 404 Not Found             │
│    ↓                                       │
│ 6. Cursor接收结果                          │
│    - 成功: 继续处理(写文件/更新状态)       │
│    - 失败: 通过SSE返回错误给MCP Server     │
│    ↓                                       │
│ 7. MCP Server汇总结果返回给Agent           │
│    - 格式化错误信息                        │
│    - 生成用户友好的提示                    │
│    - 返回给Cursor Agent显示                │
└───────────────────────────────────────────┘
```

**关键点**：
- ✅ 所有REST API请求必须携带 `Authorization: Bearer {token}` header
- ✅ Token在SSE连接时验证一次，后续REST请求每次都验证
- ✅ Token验证失败时，MCP Server应提示用户重新连接或刷新token
- ✅ 支持token自动刷新机制(通过refresh_token)

### 6.2 Manifest格式

\`\`\`json
{
  "version": "1.0.0",
  "timestamp": "2026-02-28T10:00:00Z",
  "resources": [
    {
      "id": "cmd-001",
      "name": "analyze-logs",
      "type": "command",
      "version": "1.2.3",
      "download_url": "https://csp.example.com/api/resources/download/cmd-001",
      "hash": "sha256:abc123...",
      "metadata": {
        "module": "zNet",
        "tags": ["debugging"]
      }
    }
  ]
}
\`\`\`

### 6.3 原子文件操作

\`\`\`typescript
async function safeWriteFile(path, content) {
  const tempPath = \`\${path}.tmp-\${uuid()}\`;
  await fs.writeFile(tempPath, content);
  await fs.rename(tempPath, path);  // 原子操作
}
\`\`\`

### 6.4 多层缓存架构（学习Verdaccio）

#### 6.4.1 缓存层级设计

\`\`\`
┌─────────────────────────────────────────────────────────┐
│                    客户端层 (Cursor)                      │
│  ┌──────────────────────────────────────────────────┐   │
│  │  L1: 内存缓存 (Memory Cache)                      │   │
│  │  - manifest对象缓存 (5分钟TTL)                    │   │
│  │  - 文件内容缓存 (最近访问的10个资源)              │   │
│  │  - 用途: 避免重复读取磁盘                         │   │
│  └──────────────────────────────────────────────────┘   │
│                      ↓ miss                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │  L2: 磁盘缓存 (Disk Cache)                        │   │
│  │  - ~/.cursor/.csp-cache/                          │   │
│  │    ├── resources/                                 │   │
│  │    │   ├── {resource_id}@{version}.md            │   │
│  │    │   └── {resource_id}@{version}.meta.json     │   │
│  │    └── manifests/                                 │   │
│  │        └── manifest@{etag}.json                   │   │
│  │  - 用途: 持久化缓存,断网可用                     │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                      ↓ miss
┌─────────────────────────────────────────────────────────┐
│                    服务端层 (CSP)                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  L3: 服务端缓存 (Server-side Cache)               │   │
│  │  - Redis缓存层:                                   │   │
│  │    * manifest缓存 (1分钟TTL)                      │   │
│  │    * 热门资源内容缓存 (15分钟TTL)                 │   │
│  │  - 用途: 减轻Git仓库和数据库压力                  │   │
│  └──────────────────────────────────────────────────┘   │
│                      ↓ miss                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │  L4: CDN层 (CloudFlare/Akamai)                    │   │
│  │  - 静态资源CDN缓存:                               │   │
│  │    * /api/resources/download/{id} (60分钟)        │   │
│  │  - Cache-Control: public, max-age=3600           │   │
│  │  - 用途: 全球分发,降低源站压力                   │   │
│  └──────────────────────────────────────────────────┘   │
│                      ↓ miss                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │  源数据 (Git Repository + PostgreSQL)             │   │
│  │  - Git仓库: teams/{team}/{type}/{name}.md        │   │
│  │  - 数据库: 元数据索引                            │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
\`\`\`

#### 6.4.2 缓存验证机制

\`\`\`typescript
// 1. ETag验证 (优先)
async function fetchWithCache(url: string, localHash: string) {
  const response = await fetch(url, {
    headers: {
      'If-None-Match': \`"\${localHash}"\`,
      'Accept-Encoding': 'gzip, br'
    }
  });
  
  if (response.status === 304) {
    // 缓存有效,使用本地文件
    return { cached: true, content: null };
  }
  
  // 下载新内容
  const content = await response.text();
  const newHash = await sha256(content);
  return { cached: false, content, hash: newHash };
}

// 2. 时间戳验证 (备用)
async function fetchSubscriptionsWithCache(lastModified: string) {
  const response = await fetch('/csp/api/resources/subscriptions', {
    headers: {
      'If-None-Match': lastETag,
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (response.status === 304) {
    return { cached: true, subscriptions: localSubscriptions };
  }
  
  const data = await response.json();
  const etag = response.headers.get('ETag');
  return { cached: false, subscriptions: data.subscriptions, etag };
}

// 3. 增量更新 (delta sync)
async function fetchSubscriptionsDelta(sinceVersion: string) {
  // 服务端仅返回变化的资源
  const response = await fetch(
    `/csp/api/resources/subscriptions?since=${sinceVersion}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  const delta = await response.json();
  // {
  //   base_version: "1.2.0",
  //   current_version: "1.2.3",
  //   added: [...],
  //   updated: [...],
  //   deleted: [...]
  // }
  
  return mergeSubscriptionsDelta(localData, delta);
}
\`\`\`

#### 6.4.3 缓存失效策略

\`\`\`typescript
interface CachePolicy {
  // 本地内存缓存 (L1)
  memoryCache: {
    maxSize: 10,        // 最多缓存10个资源
    ttl: 300,           // 5分钟过期
    eviction: 'LRU'     // 最近最少使用淘汰
  },
  
  // 本地磁盘缓存 (L2)
  diskCache: {
    maxSize: 100,       // 最多缓存100个资源
    maxAge: 86400 * 7,  // 7天过期
    autoClean: true     // 启动时自动清理过期文件
  },
  
  // 服务端缓存 (L3)
  serverCache: {
    manifest: {
      ttl: 60,          // 1分钟
      invalidateOn: ['resource_update', 'subscription_change']
    },
    resource: {
      ttl: 900,         // 15分钟
      invalidateOn: ['git_push']
    }
  },
  
  // CDN缓存 (L4)
  cdnCache: {
    ttl: 3600,          // 1小时
    purgeOn: ['version_update'],  // 版本更新时清除CDN缓存
    cacheControl: 'public, max-age=3600, stale-while-revalidate=86400'
  }
}

// 缓存失效触发器
class CacheInvalidator {
  // 资源更新时
  async onResourceUpdate(resourceId: string) {
    // 清除L3服务端缓存
    await redis.del(\`resource:\${resourceId}\`);
    
    // 触发CDN purge
    await cdn.purge(\`/api/resources/download/\${resourceId}\`);
    
    // 通知所有订阅者(通过SSE)
    await notifySubscribers(resourceId, 'update');
  }
  
  // 用户订阅变化时
  async onSubscriptionChange(userId: string) {
    // 清除用户的manifest缓存
    await redis.del(\`manifest:user:\${userId}\`);
  }
}
\`\`\`

#### 6.4.4 压缩传输优化

\`\`\`typescript
// 服务端启用压缩
app.use(compression({
  level: 6,  // zlib压缩级别 (1-9)
  threshold: 1024,  // 大于1KB才压缩
  filter: (req, res) => {
    // 对markdown文件启用压缩
    return /\\.md$/.test(req.path);
  }
}));

// 客户端请求压缩
const response = await fetch(url, {
  headers: {
    'Accept-Encoding': 'gzip, br, deflate'
  }
});

// 压缩效果统计
// 原始大小: 50KB markdown文件
// gzip压缩后: ~12KB (76%压缩率)
// brotli压缩后: ~10KB (80%压缩率)
\`\`\`

### 6.5 同步状态追踪系统

#### 6.5.1 状态定义

\`\`\`typescript
enum SyncStatus {
  PENDING = 'pending',           // 等待同步
  DOWNLOADING = 'downloading',   // 下载中
  VERIFYING = 'verifying',       // 验证hash中
  SYNCED = 'synced',             // 已同步
  CACHED = 'cached',             // 使用缓存(304)
  FAILED = 'failed',             // 同步失败
  CONFLICT = 'conflict',         // 本地修改冲突
  OUTDATED = 'outdated'          // 版本过时
}

enum VerificationStatus {
  NOT_VERIFIED = 'not_verified', // 未验证
  VERIFYING = 'verifying',       // 验证中
  VERIFIED = 'verified',         // 已验证通过
  MISMATCH = 'mismatch',         // hash不匹配
  CORRUPTED = 'corrupted'        // 文件损坏
}

interface ResourceState {
  // 基础信息
  id: string;
  name: string;
  version: string;
  hash: string;
  size_bytes: number;
  
  // 同步状态
  sync_status: SyncStatus;
  verification_status: VerificationStatus;
  
  // 时间戳
  created_at: string;           // 首次下载时间
  last_synced_at: string;       // 最后同步时间
  last_verified_at: string;     // 最后验证时间
  last_accessed_at: string;     // 最后访问时间
  
  // 重试机制
  retry_count: number;          // 重试次数
  max_retry: number;            // 最大重试次数
  next_retry_at: string | null; // 下次重试时间
  
  // 错误信息
  error_message: string | null;
  error_code: string | null;
  error_stacktrace: string | null;
  
  // 性能统计
  download_time_ms: number;     // 下载耗时
  verification_time_ms: number; // 验证耗时
  cache_hit: boolean;           // 是否命中缓存
  
  // 本地修改检测
  local_modified: boolean;      // 本地是否被修改
  local_hash: string | null;    // 本地文件当前hash
}
\`\`\`

#### 6.5.2 用户本地状态文件结构

**文件位置**: `~/.cursor/.csp-sync-state.json`

**数据来源**:
1. 用户调用 `sync_resources` Tool
2. MCP Server (在 CSP Server 上) 调用 REST API 获取订阅资源信息
3. MCP Server 通过 SSE 返回 JSON 数据
4. Cursor IDE 将数据保存到本地文件

**用途**:
- ✅ 记录用户已订阅的资源列表
- ✅ 记录每个资源的版本、hash 等信息
- ✅ 增量同步时的版本对比基准
- ✅ 判断资源是否需要更新

**文件结构**:

```json
// ~/.cursor/.csp-sync-state.json
{
  "version": "1.0.0",
  "last_sync_at": "2026-03-09T10:00:00Z",
  
  "resources": {
    "codereview-command-001": {
      "id": "codereview-command-001",
      "name": "debug-network",
      "type": "command",
      "version": "1.0.1",
      "hash": "sha256:def456...",
      "size_bytes": 2048,
      "local_path": "~/.cursor/rules/debug-network.md",
      "synced_at": "2026-03-09T10:00:05Z",
      "team": "zNet"
    },
    "Client-Public-skill-002": {
      "id": "Client-Public-skill-002",
      "name": "code-review",
      "type": "skill",
      "version": "2.1.0",
      "hash": "sha256:abc789...",
      "size_bytes": 4096,
      "local_path": "~/.cursor/skills/code-review/SKILL.md",
      "synced_at": "2026-03-09T09:55:00Z",
      "team": "Client-Public"
    }
  },
  
  "statistics": {
    "total_resources": 10,
    "total_size_bytes": 51200,
    "last_full_sync_at": "2026-03-08T08:00:00Z"
  }
}
```

**增量同步对比流程**:

```plaintext
1. Cursor IDE 读取本地状态文件
   本地版本: codereview-command-001 v1.0.1

2. 调用 sync_resources(mode: "incremental")
   通过 SSE 发送请求到 MCP Server

3. MCP Server 调用 GET /api/resources/subscriptions
   服务端版本: codereview-command-001 v1.0.2

4. MCP Server 对比版本:
   - 本地 v1.0.1 vs 服务端 v1.0.2 → 需要更新
   - 调用 GET /api/resources/download/codereview-command-001

5. 下载新版本文件并通过 Git pull 获取

6. MCP Server 通过 SSE 返回更新后的状态 JSON

7. Cursor IDE 更新本地 .csp-sync-state.json
   版本更新: v1.0.1 → v1.0.2
   hash 更新: sha256:old... → sha256:new...

8. Cursor IDE 写入新的资源文件
   ~/.cursor/rules/debug-network.md
```

---

#### 6.5.3 MCP Server 端状态管理

MCP Server 在服务器端通过**内存**管理运行时状态，不持久化到磁盘。

**内存状态结构**:

```typescript
interface RuntimeState {
  // 活跃的同步任务
  activeSyncs: Map<userId, SyncTask>;
  
  // 重试队列
  retryQueue: Array<RetryTask>;
  
  // 统计信息
  statistics: {
    total_sync_requests: number;
    total_downloads: number;
    total_uploads: number;
  };
}

interface SyncTask {
  userId: string;
  resourceIds: string[];
  mode: 'check' | 'incremental' | 'full';
  startedAt: Date;
  status: 'running' | 'completed' | 'failed';
}

interface RetryTask {
  userId: string;
  resourceId: string;
  retryCount: number;
  nextRetryAt: Date;
  errorMessage: string;
}
```

**状态管理说明**:
- ✅ 运行时状态存储在内存中 (Map/Set)
- ✅ 进程重启后状态丢失（无影响，Cursor 有本地状态文件）
- ✅ 不写入服务器端磁盘文件
- ❌ 不使用 SQLite、PostgreSQL 等数据库（这些由 CSP REST API 管理）

#### 6.5.4 状态转换流程

```
用户发起同步请求
    ↓
MCP Server 接收请求 (SSE)
    ↓
调用 REST API 获取订阅信息
    ↓
对比版本 (本地状态 vs 服务端状态)
    ├─ 一致 → 返回 "cached" 状态
    └─ 不一致 → 下载新版本
        ↓
    通过 REST API 下载资源
        ├─ 成功 → 验证 hash → 返回新状态
        └─ 失败 → 加入重试队列 → 返回失败状态
            ↓
        重试机制 (指数退避)
            ├─ retry_count < max_retry → 延迟重试
            └─ retry_count >= max_retry → 标记为永久失败
```

#### 6.5.5 重试机制实现

\`\`\`typescript
class RetryManager {
  // 指数退避算法
  calculateNextRetry(retryCount: number): Date {
    // 退避时间: 2^n * 1000ms (1s, 2s, 4s, 8s, ...)
    const delayMs = Math.pow(2, retryCount) * 1000;
    // 添加随机抖动 (±20%)
    const jitter = delayMs * (0.8 + Math.random() * 0.4);
    return new Date(Date.now() + jitter);
  }
  
  async retrySync(resource: ResourceState): Promise<void> {
    if (resource.retry_count >= resource.max_retry) {
      // 达到最大重试次数
      resource.sync_status = SyncStatus.FAILED;
      await this.notifyUser(resource, 'max_retry_exceeded');
      return;
    }
    
    // 计算下次重试时间
    resource.next_retry_at = this.calculateNextRetry(
      resource.retry_count
    ).toISOString();
    
    // 增加重试计数
    resource.retry_count++;
    
    // 记录重试日志
    logger.warn(\`Retry \${resource.retry_count}/\${resource.max_retry}\`, {
      resource_id: resource.id,
      error: resource.error_message,
      next_retry: resource.next_retry_at
    });
    
    // 更新状态文件
    await this.saveState();
  }
  
  // 定期检查需要重试的资源
  async checkPendingRetries(): Promise<void> {
    const now = new Date();
    const pendingRetries = Object.values(this.state.resources).filter(
      r => r.next_retry_at && new Date(r.next_retry_at) <= now
    );
    
    for (const resource of pendingRetries) {
      try {
        await this.syncResource(resource);
      } catch (error) {
        await this.retrySync(resource);
      }
    }
  }
}
\`\`\`

#### 6.5.5 健康检查和诊断

\`\`\`typescript
class HealthChecker {
  async calculateHealthScore(): Promise<number> {
    const resources = Object.values(this.state.resources);
    
    // 权重计算
    const weights = {
      synced: 10,      // 同步成功 +10分
      cached: 10,      // 缓存命中 +10分
      outdated: -5,    // 版本过时 -5分
      failed: -20,     // 同步失败 -20分
      conflict: -15,   // 本地冲突 -15分
      mismatch: -25    // hash不匹配 -25分
    };
    
    let totalScore = 0;
    for (const resource of resources) {
      totalScore += weights[resource.sync_status] || 0;
      
      // 验证状态影响
      if (resource.verification_status === 'mismatch') {
        totalScore -= 25;
      }
    }
    
    // 归一化到0-100
    const maxPossibleScore = resources.length * 10;
    const normalizedScore = Math.max(0, Math.min(100,
      (totalScore / maxPossibleScore) * 100 + 50
    ));
    
    return Math.round(normalizedScore);
  }
  
  async diagnose(): Promise<HealthReport> {
    const score = await this.calculateHealthScore();
    const issues: Issue[] = [];
    
    // 检查失败的资源
    const failed = this.getResourcesByStatus(SyncStatus.FAILED);
    if (failed.length > 0) {
      issues.push({
        severity: 'error',
        category: 'sync_failure',
        count: failed.length,
        message: \`\${failed.length} resources failed to sync\`,
        resources: failed.map(r => r.id),
        recommendation: 'Check network connection and retry'
      });
    }
    
    // 检查过时的资源
    const outdated = this.getResourcesByStatus(SyncStatus.OUTDATED);
    if (outdated.length > 0) {
      issues.push({
        severity: 'warning',
        category: 'outdated',
        count: outdated.length,
        message: \`\${outdated.length} resources have updates available\`,
        resources: outdated.map(r => r.id),
        recommendation: 'Run sync_resources(mode="incremental")'
      });
    }
    
    // 检查长时间未验证的资源
    const now = Date.now();
    const needVerification = Object.values(this.state.resources).filter(
      r => now - new Date(r.last_verified_at).getTime() > 86400000 * 7
    );
    if (needVerification.length > 0) {
      issues.push({
        severity: 'info',
        category: 'verification_needed',
        count: needVerification.length,
        message: \`\${needVerification.length} resources not verified in 7 days\`,
        recommendation: 'Run periodic verification'
      });
    }
    
    // 检查缓存命中率
    const cacheHitRate = this.state.statistics.cache_hit_rate;
    if (cacheHitRate < 0.5) {
      issues.push({
        severity: 'warning',
        category: 'low_cache_hit',
        message: \`Low cache hit rate: \${(cacheHitRate * 100).toFixed(1)}%\`,
        recommendation: 'Consider increasing cache TTL or checking invalidation logic'
      });
    }
    
    return {
      score,
      status: score >= 90 ? 'healthy' : score >= 70 ? 'degraded' : 'unhealthy',
      issues,
      statistics: this.state.statistics,
      timestamp: new Date().toISOString()
    };
  }
}
```

---

### 6.6 日志记录模块

MCP Server 使用结构化日志记录所有关键操作，日志保存在本地 `logs/` 目录，自动清理 3 天前的日志文件。

**完整设计文档**: [日志记录模块设计](./CSP-AI-Agent-Logging-Design.md) 🆕

#### 6.6.1 日志方案概览

**技术选型**: `pino` + `pino-roll`

| 特性 | 说明 |
|------|------|
| **日志库** | pino（业界最快的 Node.js 日志库） |
| **文件轮转** | pino-roll（按日期轮转，支持大小限制） |
| **日志格式** | JSON 结构化日志 |
| **日志目录** | `logs/` |
| **保留策略** | 自动清理 3 天前的日志 |
| **轮转策略** | 按日期轮转（每天一个文件） |

#### 6.6.2 日志文件结构

```plaintext
csp-ai-agent-mcp/
├── logs/                          # 日志目录（运行时生成）
│   ├── app-2026-03-09.log         # 当天日志
│   ├── app-2026-03-08.log         # 昨天日志
│   └── app-2026-03-07.log         # 前天日志（第 4 天自动删除）
├── src/
│   └── utils/
│       ├── logger.ts              # 日志工具模块
│       └── log-cleaner.ts         # 日志清理模块
```

#### 6.6.3 日志记录场景

| 场景 | 日志级别 | 示例 |
|------|---------|------|
| MCP Tool 调用 | INFO | `sync_resources called by user:123` |
| REST API 请求 | INFO | `GET /api/resources/subscriptions - 200 (120ms)` |
| Git 操作 | INFO | `git pull completed: 5 files updated` |
| 错误处理 | ERROR | `Failed to download resource: Network timeout` |
| 性能追踪 | INFO | `sync_resources completed in 1.2s` |
| 调试信息 | DEBUG | `Cache hit: codereview-command-001` |

#### 6.6.4 使用示例

```typescript
import { logger, logToolCall, logError } from './utils/logger';

// 基础日志
logger.info('MCP Server started on port 5090');
logger.info({ userId: 'user-123' }, 'User connected via SSE');

// Tool 调用日志
logToolCall('sync_resources', 'user-123', { mode: 'incremental' }, 1200);

// 错误日志
try {
  await downloadResource(resourceId);
} catch (error) {
  logError(error as Error, { resourceId, userId });
}

// 性能日志
logPerformance('sync_resources', 1200, { resourceCount: 10 });
```

#### 6.6.5 自动清理机制

```typescript
// 启动时自动开始清理任务
import { startLogCleanupSchedule } from './utils/log-cleaner';

// 每天凌晨 2 点自动清理 3 天前的日志
const cleanupSchedule = startLogCleanupSchedule();
```

**详细实现请参考**: [日志记录模块设计文档](./CSP-AI-Agent-Logging-Design.md)

---

## 七、API接口规范

### 7.1 认证API

**GET /csp/api/user/permissions**

请求头：
\`\`\`
Authorization: Bearer {token}
\`\`\`

响应：
\`\`\`json
{
  "code": 2000,
  "result": "success",
  "data": {
    "user_id": "user123",
    "email": "user@example.com",
    "groups": ["team-a"]
  }
}
\`\`\`

### 7.2 资源下载API

**GET /csp/api/resources/subscriptions**

请求头：
```
Authorization: Bearer {token}
If-None-Match: "W/\"abc123\""        # ETag缓存验证
Accept-Encoding: gzip, br             # 请求压缩
```

查询参数：
```
?scope=all             # 可选: general / team / user / all (默认: all)
&detail=true           # 可选: 是否包含详细信息 (默认: false)
&types=command,skill   # 可选: 类型过滤(逗号分隔)
&since=1.2.0          # 可选：仅返回此版本之后的变化(增量更新)
```

响应（成功 - 有更新）：
```json
HTTP/1.1 200 OK
ETag: "W/\"def456\""
Last-Modified: "Wed, 03 Mar 2026 09:55:00 GMT"
Cache-Control: private, max-age=60
Content-Encoding: gzip
Content-Type: application/json

{
  "code": 2000,
  "result": "success",
  "data": {
    "version": "1.0.0",
    "timestamp": "2026-03-03T09:55:00Z",
    "total": 10,
    "subscriptions": [
      {
        "id": "codereview-command-001",
        "name": "debug-network",
        "type": "command",
        "team": "zNet",
        "subscribed_at": "2026-03-01T10:00:00Z",
        "auto_sync": true,
        "scope": "global",
        "notify": true,
        "resource": {
          "version": "1.0.1",
          "hash": "sha256:def456...",
          "size_bytes": 2048,
          "download_url": "https://csp.example.com/api/resources/download/codereview-command-001",
          "cdn_url": "https://cdn.example.com/resources/codereview-command-001@1.0.1",
          "updated_at": "2026-03-03T09:50:00Z",
          "metadata": {
            "module": "zNet",
            "tags": ["debugging"]
          }
        }
      }
    ]
  }
}
\`\`\`

响应（缓存有效 - 304）：
\`\`\`
HTTP/1.1 304 Not Modified
ETag: "W/\"abc123\""
Cache-Control: private, max-age=60
\`\`\`

响应（增量更新模式）：
```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "code": 2000,
  "result": "success",
  "data": {
    "delta": true,
    "base_version": "1.2.0",
    "current_version": "1.2.3",
    "changes": {
      "added": [
        { 
          "id": "zNet-cmd-005", 
          "name": "new-tool",
          "subscribed_at": "2026-03-03T10:00:00Z",
          "resource": { "version": "1.0.0", ... }
        }
      ],
      "updated": [
        { 
          "id": "codereview-command-001", 
          "resource": { "version": "1.0.1", ... }
        }
      ],
      "deleted": [
        "Client-Public-cmd-999"
      ]
    }
  }
}
\`\`\`

响应（鉴权失败）：
\`\`\`json
{
  "code": 4010,
  "message": "Token expired or invalid",
  "data": null
}
\`\`\`

**GET /csp/api/resources/download/{id}**

下载资源所有文件，以 JSON `files[]` 数组返回，支持单文件和多文件资源。

请求头：
\`\`\`
Authorization: Bearer {token}
If-None-Match: "sha256:abc123..."   # ETag 缓存校验（可选）
\`\`\`

响应（成功 - 200）：
\`\`\`json
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "sha256:def456..."

{
  "code": 2000,
  "result": "success",
  "data": {
    "resource_id": "codereview-command-001",
    "name": "debug-network",
    "type": "command",
    "version": "1.0.1",
    "hash": "sha256:def456...",
    "files": [
      { "path": "debug-network.md", "content": "# Debug Network\n..." }
    ]
  }
}
\`\`\`

**Skill 多文件示例**：
\`\`\`json
{
  "data": {
    "resource_id": "skill-csp-code-review",
    "name": "code-review",
    "type": "skill",
    "files": [
      { "path": "SKILL.md",         "content": "..." },
      { "path": "examples/demo.md", "content": "..." }
    ]
  }
}
\`\`\`

客户端按 `files[].path` 在 Cursor 目录内重建结构：
- skill  → `~/.cursor/skills/<name>/<path>`
- mcp    → `~/.cursor/mcp-servers/<name>/<path>`
- command → `~/.cursor/commands/<name>.md`
- rule   → `~/.cursor/rules/<name>.mdc`

响应（缓存有效 - 304）：
\`\`\`
HTTP/1.1 304 Not Modified
ETag: "sha256:abc123..."
\`\`\`

响应（权限不足）：
\`\`\`json
{
  "code": 4007,
  "result": "failed",
  "message": "permission denied"
}
\`\`\`

响应（资源不存在）：
\`\`\`json
{
  "code": 4008,
  "result": "failed",
  "message": "not found"
}
\`\`\`

### 7.3 资源上传API（两步）

**Step 1: POST /csp/api/resources/upload**

统一使用 `files[]` 数组上传，单文件只需数组中放一个元素，多文件通过 `path` 保留目录结构。

请求头：
\`\`\`
Authorization: Bearer {token}
Content-Type: application/json
\`\`\`

请求体（单文件，command）：
\`\`\`json
{
  "type": "command",
  "name": "analyze-logs",
  "files": [
    { "path": "analyze-logs.md", "content": "# Content..." }
  ]
}
\`\`\`

请求体（多文件，mcp，保留目录结构）：
\`\`\`json
{
  "type": "mcp",
  "name": "analyze-logs-mcp",
  "files": [
    { "path": "server.js", "content": "const { Server } = require(...);\n..." },
    { "path": "tools/analyze.js", "content": "module.exports = async function analyze(params) { ... }" },
    { "path": "package.json", "content": "{\"name\": \"analyze-logs-mcp\"}" }
  ]
}
\`\`\`

响应（成功）：
\`\`\`json
{
  "code": 2000,
  "result": "success",
  "data": {
    "upload_id": "temp-abc123",
    "status": "pending",
    "expires_at": "2026-02-28T11:00:00Z"
  }
}
\`\`\`

响应（鉴权失败）：
\`\`\`json
{
  "code": 4010,
  "message": "Invalid or expired token"
}
\`\`\`

响应（权限不足）：
\`\`\`json
{
  "code": 4030,
  "message": "No permission to upload resources"
}
\`\`\`

响应（files 为空数组）：
\`\`\`json
{
  "code": 4011,
  "result": "failed",
  "message": "files array must not be empty"
}
\`\`\`

响应（files[].path 路径穿越）：
\`\`\`json
{
  "code": 4012,
  "result": "failed",
  "message": "Invalid file path: path traversal not allowed"
}
\`\`\`

**Step 2: POST /csp/api/resources/finalize**

请求头：
\`\`\`
Authorization: Bearer {token}
Content-Type: application/json
\`\`\`

请求体：
\`\`\`json
{
  "upload_id": "temp-abc123",
  "commit_message": "Add tool",
  "auto_commit": true
}
\`\`\`

响应（成功）：
\`\`\`json
{
  "code": 2000,
  "result": "success",
  "data": {
    "url": "https://git.zoom.us/main/csp/-/blob/main/...",
    "version": "1.0.0",
    "commit_hash": "abc123",
    "resource_id": "cmd-001"
  }
}
\`\`\`

响应（upload_id无效）：
\`\`\`json
{
  "code": 4009,
  "result": "failed",
  "message": "Upload not found or expired"
}
\`\`\`

响应（Git操作失败）：
\`\`\`json
{
  "code": 5000,
  "message": "Git commit failed",
  "data": {
    "error": "Merge conflict",
    "details": "..."
  }
}
\`\`\`

---

## 八、部署方案

### 8.1 Docker部署（推荐）

**Dockerfile**:
\`\`\`dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 5090
CMD ["node", "dist/index-sse.js"]
\`\`\`

**docker-compose.yml**:
\`\`\`yaml
version: '3.8'
services:
  csp-ai-agent:
    build: .
    ports:
      - "5090:5090"
    environment:
      - PORT=5090
    volumes:
      - ./git-repos:/app/git-repos
    restart: unless-stopped
\`\`\`

### 8.2 Nginx配置（HTTPS）

\`\`\`nginx
server {
    listen 443 ssl;
    server_name csp.example.com;
    
    location /sse {
        proxy_pass http://localhost:5090;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
    }
}
\`\`\`

---

## 九、安全设计

### 9.1 认证与授权

**多层验证机制**：
- **连接层**: SSE连接时验证token，建立session
- **请求层**: 每个REST API请求都验证Authorization header
- **用户层**: 根据用户组过滤资源
- **操作层**: 上传/下载权限检查
- **存储层**: 文件权限（0644文件，0755目录）

**Token生命周期管理**：
\`\`\`
1. Token获取
   - 用户通过CSP平台登录获取token
   - Token包含: access_token + refresh_token
   
2. Token使用
   - SSE连接: 传递access_token
   - REST请求: 每次都携带access_token
   
3. Token过期处理
   - access_token过期(如1小时)
   - MCP Server检测到401响应
   - 自动使用refresh_token获取新token
   - 更新session中的token
   - 重试失败的请求
   
4. Token刷新失败
   - refresh_token也过期
   - 通知用户重新登录
   - 断开SSE连接
\`\`\`

**错误码规范**：
| 错误码 | 含义 | MCP Server处理 |
|--------|------|----------------|
| 2000 | 成功 | 继续处理 |
| 4010 | Token无效/过期 | 尝试刷新token，失败则提示重新登录 |
| 4030 | 权限不足 | 返回友好提示："您没有权限访问此资源" |
| 4040 | 资源不存在 | 返回："资源未找到，可能已被删除" |
| 5000 | 服务器错误 | 返回："服务器错误，请稍后重试" |

### 9.2 数据传输

- 强制HTTPS
- Token通过TLS加密
- Git凭证不出现在日志

### 9.3 Git操作安全

- 输入验证（commit message、文件路径）
- 防目录穿越（禁止..）
- 用户权限检查

---

## 十、监控与运维

### 10.1 关键指标

#### 10.1.1 性能指标

| 指标分类 | 指标名称 | 说明 | 告警阈值 | 监控工具 |
|---------|---------|------|---------|---------|
| **连接层** | SSE连接成功率 | SSE建立成功的比例 | < 95% | Prometheus |
| | 活跃SSE连接数 | 当前活跃的SSE连接 | > 1000 | Grafana |
| | SSE心跳失败率 | 心跳包失败比例 | > 5% | Alertmanager |
| **API层** | sync_resources响应时间 | P50/P95/P99延迟 | P95 > 5s | APM |
| | API错误率 | 4xx+5xx错误比例 | > 5% | Prometheus |
| | API QPS | 每秒请求数 | > 1000 | Grafana |
| **缓存层** | 缓存命中率 | L1+L2+L3命中率 | < 70% | Redis监控 |
| | L1内存缓存命中率 | 内存缓存命中比例 | < 80% | 应用metrics |
| | L2磁盘缓存命中率 | 磁盘缓存命中比例 | < 60% | 应用metrics |
| | L3服务端缓存命中率 | Redis缓存命中比例 | < 85% | Redis INFO |
| | CDN缓存命中率 | CDN层命中比例 | < 90% | CloudFlare |
| | 缓存失效率 | 过期/驱逐的比例 | > 20% | Redis监控 |
| **同步状态** | 同步成功率 | 资源同步成功比例 | < 95% | 应用日志 |
| | 同步失败重试次数 | 平均重试次数 | > 2 | 应用metrics |
| | 过时资源数量 | outdated状态资源数 | > 10% | 状态追踪 |
| | 健康分数 | 系统整体健康度 | < 70 | 健康检查API |
| **资源层** | Git仓库延迟 | Git操作响应时间 | > 3s | GitLab监控 |
| | 数据库查询时间 | PostgreSQL查询延迟 | > 500ms | pgBadger |
| | 磁盘IO等待 | 磁盘IO wait% | > 20% | iostat |
| **网络层** | 带宽使用率 | 网络带宽占用 | > 80% | 网络监控 |
| | 缓存节省带宽 | 通过缓存节省的流量 | 记录统计 | 应用metrics |
| | 下载速度 | 平均下载速度 | < 1 MB/s | 应用metrics |

#### 10.1.2 业务指标

| 指标 | 说明 | 监控方式 |
|------|------|---------|
| 资源总数 | 系统中资源总量 | PostgreSQL计数 |
| 活跃用户数 | 7天内活跃用户 | SSE连接记录 |
| 订阅总数 | 所有用户订阅资源数 | 订阅表统计 |
| 上传频率 | 每日新增/更新资源数 | Git提交统计 |
| 热门资源Top10 | 下载次数最多的资源 | 下载日志分析 |

### 10.2 健康检查

#### 10.2.1 服务端健康检查

**GET /health**

响应（健康）：
\`\`\`json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime_seconds": 86400,
  "timestamp": "2026-03-03T10:00:00Z",
  
  "components": {
    "sse_server": {
      "status": "healthy",
      "active_connections": 125,
      "uptime_seconds": 86400
    },
    "rest_api": {
      "status": "healthy",
      "request_rate_qps": 45.2,
      "error_rate": 0.02
    },
    "database": {
      "status": "healthy",
      "connection_pool": {
        "active": 5,
        "idle": 15,
        "max": 20
      },
      "avg_query_time_ms": 12.5
    },
    "redis_cache": {
      "status": "healthy",
      "memory_used_mb": 256,
      "memory_max_mb": 1024,
      "hit_rate": 0.87,
      "evicted_keys": 125
    },
    "git_repository": {
      "status": "healthy",
      "repository": "git@git.zoom.us:main/csp.git",
      "branch": "main",
      "last_sync": "2026-03-03T09:55:00Z",
      "pending_commits": 0
    },
    "cdn": {
      "status": "healthy",
      "hit_rate": 0.92,
      "origin_requests": 120
    }
  },
  
  "cache_statistics": {
    "l1_memory": {
      "hit_rate": 0.82,
      "size_mb": 50,
      "entries": 10
    },
    "l3_redis": {
      "hit_rate": 0.87,
      "keys": 1523,
      "memory_mb": 256
    },
    "l4_cdn": {
      "hit_rate": 0.92,
      "requests_per_min": 450
    },
    "total_bandwidth_saved_gb": 125.6
  },
  
  "sync_statistics": {
    "resources_synced_24h": 2340,
    "sync_success_rate": 0.97,
    "avg_sync_time_ms": 850,
    "failed_syncs_24h": 45,
    "retry_queue_size": 12
  }
}
\`\`\`

响应（降级）：
\`\`\`json
{
  "status": "degraded",
  "version": "1.0.0",
  "issues": [
    {
      "component": "redis_cache",
      "status": "degraded",
      "message": "High memory usage: 95%",
      "severity": "warning"
    },
    {
      "component": "sync_statistics",
      "status": "degraded",
      "message": "Sync success rate dropped to 88%",
      "severity": "warning"
    }
  ]
}
\`\`\`

#### 10.2.2 客户端健康检查

通过`sync_resources(mode="check")`实现，返回详细的本地状态：

\`\`\`json
{
  "health_score": 85,
  "status": "healthy",
  "resources": {
    "total": 25,
    "synced": 20,
    "cached": 18,
    "outdated": 3,
    "failed": 2
  },
  "cache_performance": {
    "hit_rate": 0.72,
    "bandwidth_saved": "45 MB",
    "last_cleanup": "2026-03-03T08:00:00Z"
  },
  "issues": [
    {
      "severity": "warning",
      "resource_id": "zNet-cmd-003",
      "message": "Resource failed to sync (retry 2/3)",
      "recommendation": "Check network connection"
    },
    {
      "severity": "info",
      "message": "3 resources have updates available",
      "recommendation": "Run sync_resources(mode='incremental')"
    }
  ]
}
\`\`\`

### 10.3 Prometheus监控配置

\`\`\`yaml
# prometheus.yml
scrape_configs:
  - job_name: 'csp-ai-agent'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:5090']
    metrics_path: /metrics

# 关键metrics定义
# csp_sse_connections_total - SSE连接总数
# csp_sse_connections_active - 活跃SSE连接数
# csp_api_requests_total{method,path,status} - API请求计数
# csp_api_request_duration_seconds{method,path} - API请求延迟
# csp_cache_hits_total{layer} - 缓存命中次数
# csp_cache_misses_total{layer} - 缓存未命中次数
# csp_sync_operations_total{status} - 同步操作计数
# csp_sync_duration_seconds - 同步操作耗时
# csp_resource_downloads_total - 资源下载次数
# csp_bandwidth_saved_bytes_total - 缓存节省的带宽
\`\`\`

### 10.4 告警规则

\`\`\`yaml
# alertmanager.yml
groups:
  - name: csp_ai_agent_alerts
    interval: 30s
    rules:
      # SSE连接异常
      - alert: HighSSEDisconnectionRate
        expr: rate(csp_sse_disconnections_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High SSE disconnection rate"
          description: "{{ $value }} disconnections per second"
      
      # API错误率过高
      - alert: HighAPIErrorRate
        expr: |
          sum(rate(csp_api_requests_total{status=~"5.."}[5m]))
          / sum(rate(csp_api_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "API error rate above 5%"
      
      # 缓存命中率过低
      - alert: LowCacheHitRate
        expr: |
          sum(rate(csp_cache_hits_total[10m]))
          / sum(rate(csp_cache_hits_total[10m]) + rate(csp_cache_misses_total[10m]))
          < 0.7
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Cache hit rate below 70%"
          description: "Current: {{ $value | humanizePercentage }}"
      
      # 同步失败率过高
      - alert: HighSyncFailureRate
        expr: |
          sum(rate(csp_sync_operations_total{status="failed"}[10m]))
          / sum(rate(csp_sync_operations_total[10m])) > 0.05
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Sync failure rate above 5%"
      
      # Redis内存使用过高
      - alert: RedisHighMemoryUsage
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.9
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Redis memory usage above 90%"
      
      # 数据库连接池耗尽
      - alert: DatabaseConnectionPoolExhausted
        expr: |
          pg_stat_database_numbackends
          / pg_settings_max_connections > 0.9
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Database connection pool 90% used"
\`\`\`

### 10.5 日志管理

\`\`\`typescript
// 结构化日志格式
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: 'csp-ai-agent';
  component: string;
  event: string;
  user_id?: string;
  resource_id?: string;
  duration_ms?: number;
  error?: {
    message: string;
    code: string;
    stack?: string;
  };
  cache?: {
    layer: 'L1' | 'L2' | 'L3' | 'L4';
    hit: boolean;
    size_bytes?: number;
  };
  sync?: {
    status: SyncStatus;
    retry_count: number;
  };
  trace_id: string;  // 分布式追踪ID
}

// 日志示例
{
  "timestamp": "2026-03-03T10:00:00Z",
  "level": "info",
  "service": "csp-ai-agent",
  "component": "sync_manager",
  "event": "resource_synced",
  "user_id": "user123",
  "resource_id": "codereview-command-001",
  "duration_ms": 120,
  "cache": {
    "layer": "L2",
    "hit": false,
    "size_bytes": 2048
  },
  "sync": {
    "status": "synced",
    "retry_count": 0
  },
  "trace_id": "abc123-def456"
}
\`\`\`

### 10.6 性能优化建议

#### 缓存优化
- **L1内存缓存**: 增加到20个热门资源
- **L2磁盘缓存**: 定期清理7天未访问的文件
- **L3 Redis**: 启用LRU驱逐策略,增加内存到2GB
- **L4 CDN**: 配置更长的TTL(2小时),启用stale-while-revalidate

#### 同步优化
- **批量操作**: 每次同步最多并发5个资源
- **智能调度**: 低峰期自动全量验证
- **增量传输**: 启用delta sync减少传输量
- **断点续传**: 大文件支持Range请求

#### 数据库优化
- **索引优化**: resource_id, user_id, team加索引
- **查询缓存**: 热门查询结果缓存5分钟
- **连接池**: 增加到50个连接
- **读写分离**: 只读查询走从库

---

## 十一、实施计划

### 11.1 四阶段实施

| 阶段 | 时间 | 关键任务 |
|------|------|---------|
| Phase 1 | Week 1-2 | CSP基础设施、认证API |
| Phase 2 | Week 3-5 | MCP Server开发、6个Tools |
| Phase 3 | Week 6 | Beta测试、Bug修复 |
| Phase 4 | Week 7-8 | 团队推广、培训 |

### 11.2 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| SSE连接不稳定 | 心跳机制、自动重连 |
| 文件权限问题 | workspace级fallback |
| Manifest过大 | 分页、压缩 |

---

## 十二、未来规划

### 12.1 短期（3个月）

#### 功能增强
- **资源依赖管理**
  - 依赖关系声明(requires字段)
  - 自动解析和安装依赖
  - 循环依赖检测
  
- **资源评分和评论**
  - 5星评分系统
  - 用户评论和反馈
  - 热度排行榜

- **使用统计**
  - 资源使用频率追踪
  - 用户行为分析
  - Dashboard可视化

#### 缓存和性能优化
- **P2P缓存网络**
  - 团队内点对点资源共享
  - 减轻中心服务器压力
  - 类似BitTorrent机制

- **预测性预加载**
  - 基于使用模式预测需求
  - 后台自动预加载热门资源
  - 减少用户等待时间

- **增量同步优化**
  - 文件级diff算法(rsync-like)
  - 块级增量传输
  - 更精准的变化检测

#### 状态追踪增强
- **详细的状态历史**
  - 记录所有状态转换
  - 可视化状态时间线
  - 异常模式识别

- **自动修复机制**
  - 检测到损坏自动修复
  - 冲突自动合并策略
  - 智能重试策略优化

### 12.2 中期（6个月）

#### 高级功能
- **离线模式**
  - 完全离线工作支持
  - 离线变更记录
  - 联网后自动同步

- **OS Keychain集成**
  - 安全凭证存储
  - 生物识别认证
  - 跨设备凭证同步

- **多语言支持**
  - i18n国际化
  - 资源本地化
  - 多语言搜索

#### 缓存和分发优化
- **多地域部署**
  - 全球CDN节点
  - 智能就近访问
  - 跨区域数据同步

- **智能缓存预热**
  - 新资源发布时自动预热
  - 热门资源主动推送
  - 缓存预热API

- **缓存分析和优化**
  - 缓存效率分析报告
  - 自动调整TTL策略
  - 缓存容量规划建议

#### 状态追踪和诊断
- **高级诊断工具**
  - 一键健康检查
  - 性能瓶颈分析
  - 问题根因分析

- **实时监控Dashboard**
  - 实时状态大屏
  - 告警中心
  - 趋势分析

### 12.3 长期（1年）

#### 智能化功能
- **AI推荐系统**
  - 基于使用历史推荐
  - 协同过滤算法
  - 个性化资源发现

- **智能缓存决策**
  - 机器学习预测访问模式
  - 自动优化缓存策略
  - 动态调整资源优先级

- **异常检测AI**
  - 自动识别异常同步模式
  - 预测潜在故障
  - 智能告警降噪

#### 企业级功能
- **跨团队协作**
  - 资源跨团队共享
  - 权限细粒度控制
  - 审批工作流

- **合规和审计**
  - 完整的操作审计日志
  - 合规性检查
  - 安全扫描集成

- **高可用架构**
  - 多活部署
  - 自动故障转移
  - 数据容灾备份

#### 缓存和性能终极优化
- **边缘计算支持**
  - 边缘节点缓存
  - 就近计算处理
  - 5G网络优化

- **区块链存储**
  - 去中心化资源存储
  - 不可篡改的版本历史
  - P2P网络分发

- **零信任架构**
  - 端到端加密
  - 动态信任评估
  - 微隔离网络

---

## 附录：快速开始

### A.1 用户配置

1. 访问 https://csp.example.com/setup
2. 获取配置JSON
3. 粘贴到 ~/.cursor/mcp.json
4. 重启Cursor

### A.2 使用示例

\`\`\`
# 在Cursor Agent窗口：
"搜索可用的命令工具"        # search_resources
"同步所有订阅的资源"        # sync_resources
"上传文件作为命令"          # upload_resource
"查看当前状态"             # get_status
\`\`\`

---

## 参考文档

- **OpenSpec规范**: openspec/changes/add-csp-ai-agent-mcp/
- **参考实现**: AI-Command-Management/src/index-sse.ts
- **业务方案**: CSP-AI-Tools-Delivery-Plan.md

---

## 附录A：缓存和状态追踪最佳实践

### A.1 缓存设计原则

#### 1. 缓存分层策略
```
L1(内存) → 快速但容量小 → 最热数据
L2(磁盘) → 中速大容量 → 近期使用数据
L3(Redis) → 分布式共享 → 所有用户热数据
L4(CDN) → 全球分发 → 静态资源
```

#### 2. 缓存失效策略选择

| 场景 | 推荐策略 | 理由 |
|------|---------|------|
| 资源内容 | ETag + hash验证 | 精确,避免不必要下载 |
| Manifest | If-Modified-Since | 轻量,适合频繁检查 |
| 热门资源 | TTL + LRU | 自动淘汰,保持热度 |
| 配置文件 | 手动失效 | 精确控制更新时机 |

#### 3. 缓存命中率优化技巧

**提升L1内存缓存命中率**:
- 增加缓存大小(10→20个资源)
- 使用LRU算法
- 预加载用户常用资源

**提升L2磁盘缓存命中率**:
- 定期清理(7天未访问)
- 压缩存储(gzip)
- 快速索引(hash table)

**提升L3服务端缓存命中率**:
- 合理设置TTL(15分钟)
- 热数据永不过期
- 事件驱动失效(而非定时)

**提升L4 CDN缓存命中率**:
- 长TTL(1小时+)
- stale-while-revalidate
- 预热新版本资源

#### 4. 缓存一致性保证

```typescript
// 强一致性场景(写操作)
async function updateResource(resourceId: string) {
  // 1. 更新数据库
  await db.update(resourceId);
  
  // 2. 立即失效所有缓存层
  await cache.invalidate('L1', resourceId);
  await cache.invalidate('L2', resourceId);
  await cache.invalidate('L3', resourceId);
  await cdn.purge(resourceId);
  
  // 3. 通知所有订阅者
  await notifySubscribers(resourceId);
}

// 最终一致性场景(读操作)
async function getResource(resourceId: string) {
  // 1. 尝试L1缓存
  let resource = await cache.get('L1', resourceId);
  if (resource) return resource;
  
  // 2. 尝试L2缓存
  resource = await cache.get('L2', resourceId);
  if (resource) {
    // 回填L1
    await cache.set('L1', resourceId, resource);
    return resource;
  }
  
  // 3. 从源获取
  resource = await fetchFromOrigin(resourceId);
  
  // 4. 回填所有缓存层
  await cache.set('L1', resourceId, resource);
  await cache.set('L2', resourceId, resource);
  
  return resource;
}
```

### A.2 状态追踪最佳实践

#### 1. 状态设计原则

**单一职责**: 每个状态只表示一个明确的含义
```typescript
// ✅ 好的设计
enum SyncStatus {
  PENDING,      // 等待同步
  DOWNLOADING,  // 正在下载
  SYNCED        // 已同步
}

// ❌ 不好的设计
enum Status {
  WORKING,      // 太模糊,可能是下载或验证
  DONE          // 不知道具体完成了什么
}
```

**可观测性**: 每个状态转换都应该记录
```typescript
function transitionState(
  resource: Resource,
  newStatus: SyncStatus
) {
  const oldStatus = resource.sync_status;
  
  // 记录转换
  logger.info('State transition', {
    resource_id: resource.id,
    from: oldStatus,
    to: newStatus,
    timestamp: new Date().toISOString()
  });
  
  // 更新状态
  resource.sync_status = newStatus;
  resource.last_state_change = new Date();
  
  // 持久化
  await saveState(resource);
}
```

**幂等性**: 重复执行不会产生副作用
```typescript
async function markAsSynced(resourceId: string) {
  const resource = await getResource(resourceId);
  
  // 幂等检查
  if (resource.sync_status === SyncStatus.SYNCED) {
    logger.debug('Already synced, skipping');
    return;
  }
  
  // 状态转换
  await transitionState(resource, SyncStatus.SYNCED);
}
```

#### 2. 重试策略

**指数退避 + 随机抖动**:
```typescript
function calculateBackoff(retryCount: number): number {
  // 基础延迟: 2^n秒
  const baseDelay = Math.pow(2, retryCount) * 1000;
  
  // 添加±20%随机抖动,避免雷鸣群效应
  const jitter = baseDelay * (0.8 + Math.random() * 0.4);
  
  // 最大延迟不超过60秒
  return Math.min(jitter, 60000);
}

// 示例: 
// retry 0: ~1s ± 20% = 0.8s - 1.2s
// retry 1: ~2s ± 20% = 1.6s - 2.4s
// retry 2: ~4s ± 20% = 3.2s - 4.8s
// retry 3: ~8s ± 20% = 6.4s - 9.6s
// retry 4+: 最大60s
```

**分级重试策略**:
```typescript
interface RetryPolicy {
  maxRetries: number;
  backoffType: 'exponential' | 'linear' | 'fixed';
  initialDelay: number;
}

const retryPolicies = {
  // 网络错误: 激进重试
  network_error: {
    maxRetries: 5,
    backoffType: 'exponential',
    initialDelay: 1000
  },
  
  // 服务端错误: 保守重试
  server_error: {
    maxRetries: 3,
    backoffType: 'exponential',
    initialDelay: 5000
  },
  
  // 验证失败: 快速失败
  validation_error: {
    maxRetries: 1,
    backoffType: 'fixed',
    initialDelay: 0
  }
};
```

#### 3. 错误处理

**错误分类**:
```typescript
enum ErrorCategory {
  // 可重试错误
  TRANSIENT = 'transient',      // 网络超时、连接失败
  RATE_LIMIT = 'rate_limit',    // 限流、服务繁忙
  
  // 不可重试错误
  PERMANENT = 'permanent',      // 资源不存在、权限不足
  VALIDATION = 'validation',    // 数据验证失败
  
  // 需要人工介入
  CONFLICT = 'conflict',        // 本地修改冲突
  CORRUPTED = 'corrupted'       // 文件损坏
}

function shouldRetry(error: Error): boolean {
  const category = classifyError(error);
  return [
    ErrorCategory.TRANSIENT,
    ErrorCategory.RATE_LIMIT
  ].includes(category);
}
```

**用户友好的错误消息**:
```typescript
function formatErrorMessage(error: Error): string {
  const messages = {
    NETWORK_TIMEOUT: '网络连接超时,请检查网络后重试',
    PERMISSION_DENIED: '您没有权限访问此资源,请联系管理员',
    RESOURCE_NOT_FOUND: '资源不存在,可能已被删除',
    HASH_MISMATCH: '文件校验失败,将重新下载',
    DISK_FULL: '本地磁盘空间不足,请清理后重试'
  };
  
  return messages[error.code] || 
    `同步失败: ${error.message}`;
}
```

### A.3 性能优化Checklist

#### 客户端优化
- [ ] 启用L1内存缓存(LRU,10+资源)
- [ ] 启用L2磁盘缓存(7天过期)
- [ ] 使用ETag验证避免重复下载
- [ ] 启用gzip/br压缩传输
- [ ] 并发下载(最多5个)
- [ ] 断点续传支持(Range请求)
- [ ] 智能增量同步(delta)
- [ ] 定期清理过期缓存

#### 服务端优化
- [ ] Redis缓存层(15分钟TTL)
- [ ] 数据库查询优化(索引+缓存)
- [ ] CDN加速(1小时TTL)
- [ ] 压缩响应(gzip level 6)
- [ ] HTTP/2或HTTP/3
- [ ] 连接池优化(50+连接)
- [ ] 读写分离
- [ ] 异步处理(队列)

#### 监控和诊断
- [ ] Prometheus metrics采集
- [ ] Grafana实时监控
- [ ] 缓存命中率追踪(>70%)
- [ ] 同步成功率追踪(>95%)
- [ ] 健康检查API
- [ ] 告警规则配置
- [ ] 结构化日志
- [ ] 分布式追踪(trace_id)

### A.4 故障排查指南

#### 问题1: 缓存命中率低(<50%)

**可能原因**:
1. TTL设置过短
2. 缓存容量过小
3. 缓存失效策略过于激进
4. 访问模式高度分散

**排查步骤**:
```bash
# 1. 检查缓存配置
cat ~/.cursor/.csp-cache/config.json

# 2. 查看缓存统计
curl http://localhost:5090/metrics | grep cache_hit

# 3. 分析访问模式
tail -f ~/.cursor/logs/access.log | grep cache_miss

# 4. 调整配置
# 增加TTL: 300s → 900s
# 增加容量: 10 → 20
```

#### 问题2: 同步频繁失败

**可能原因**:
1. 网络不稳定
2. 服务端限流
3. 本地磁盘空间不足
4. 文件权限问题

**排查步骤**:
```bash
# 1. 检查网络连通性
curl -I https://csp.example.com/health

# 2. 查看错误日志
tail -f ~/.cursor/logs/sync.log | grep ERROR

# 3. 检查磁盘空间
df -h ~/.cursor/.csp-cache

# 4. 检查文件权限
ls -la ~/.cursor/rules/

# 5. 手动重试
curl -X POST http://localhost:5090/sync \
  -d '{"resource_id": "codereview-command-001"}'
```

#### 问题3: 状态不一致

**可能原因**:
1. 并发写入冲突
2. 状态文件损坏
3. 异常中断未恢复
4. 时钟不同步

**排查和修复**:
```bash
# 1. 验证状态文件
cat ~/.cursor/.csp-sync-state.json | jq .

# 2. 检查是否有lock文件残留
ls ~/.cursor/.csp-*.lock

# 3. 强制重新同步
sync_resources(mode="full", force=true)

# 4. 重建状态文件
rm ~/.cursor/.csp-sync-state.json
sync_resources(mode="full")
```

---

---

## 补充设计：多源 AI 资源架构

> 来源：`AI-Resources-Multi-Source-Architecture.md`（已整合，原文件已删除）

### 目录结构

```
AI-Resources/
├── ai-resources-config.json        # 全局配置文件
├── csp/                             # CSP 团队资源（默认源，priority=100）
│   └── ai-resources/
│       ├── commands/
│       ├── skills/
│       ├── mcp/
│       └── rules/
└── client-sdk-ai-hub/              # Client SDK 团队资源（扩展源，priority=50）
    ├── mcp/
    └── .cursor/
        ├── commands/
        ├── rules/
        └── skills/
```

### 配置文件格式（`ai-resources-config.json`）

```json
{
  "version": "1.0",
  "default_source": {
    "name": "csp",
    "path": "csp/ai-resources",
    "enabled": true,
    "priority": 100,
    "resources": { "commands": "commands", "skills": "skills", "mcp": "mcp", "rules": "rules" }
  },
  "extended_sources": [
    {
      "name": "client-sdk-ai-hub",
      "path": "client-sdk-ai-hub",
      "enabled": true,
      "priority": 50,
      "resources": { "commands": ".cursor/commands", "skills": ".cursor/skills", "mcp": "mcp", "rules": ".cursor/rules" }
    }
  ],
  "resource_types": ["commands", "skills", "mcp", "rules"],
  "loading_order": "priority_desc",
  "conflict_resolution": "highest_priority_wins"
}
```

### 资源加载规则

- Mock Server 启动时自动扫描所有启用的 sources，构建全局资源索引
- 同名资源按优先级取最高优先级的版本（`highest_priority_wins`）
- 运行时通过 `POST /admin/reload-resources` 热重载，无需重启

---

## 补充设计：HTTP API 端点参考

> 来源：`API-Reference.md`（已整合，原文件已删除）

### HTTP 端点

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/health` | GET | 否 | 服务健康检查 |
| `/sse` | POST | Bearer Token | 建立 SSE 连接（MCP over SSE） |
| `/message` | POST | 否（通过 sessionId） | 发送消息到指定 session |

### `/health` 响应示例

```json
{
  "status": "healthy",
  "uptime": 3600,
  "memory": { "used": 128, "total": 256, "percentage": 50 },
  "sessions": { "active": 5, "total": 10 },
  "services": { "http": "up", "redis": "up", "cache": "healthy" },
  "timestamp": "2026-03-12T10:00:00Z"
}
```

### 错误响应格式

```json
{
  "error": "Error Type",
  "message": "Human-readable error message",
  "details": {
    "field": "fieldName",
    "expected": "expected value",
    "received": "actual value"
  }
}
```

### HTTP 状态码

| 码 | 含义 |
|----|------|
| 200 | 成功 |
| 400 | 请求参数验证失败 |
| 401 | 未认证（token 无效或缺失） |
| 403 | 权限不足（groups 不匹配） |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |
| 503 | 服务不健康 |

---

## 补充设计：部署指南

> 来源：`Deployment-Guide.md`（已整合，原文件已删除）

### 系统要求

- Node.js >= 20.x，npm >= 10.x
- 内存 512MB+（推荐 2GB）
- Redis >= 6.0（可选，用于 L2 缓存）

### 关键环境变量

```bash
# 必需
NODE_ENV=production
TRANSPORT_MODE=sse          # 生产环境必须用 SSE
HTTP_HOST=0.0.0.0
HTTP_PORT=3000
CSP_API_BASE_URL=https://csp.example.com
CSP_API_TOKEN=<CSP-issued-JWT>
CSP_API_TIMEOUT=30000

# Git（上传资源用）
GIT_USER_NAME="CSP Agent"
GIT_USER_EMAIL=agent@example.com

# 缓存（可选）
ENABLE_CACHE=true
REDIS_URL=redis://localhost:6379
REDIS_TTL=900

# 日志
LOG_LEVEL=info
LOG_DIR=../Logs
LOG_RETENTION_DAYS=7

# 优雅关闭
SHUTDOWN_TIMEOUT=30000
```

### PM2 生产部署

```bash
npm install -g pm2
cd SourceCode
npm run build
pm2 start npm --name "csp-mcp-server" -- start
pm2 startup && pm2 save
```

### 常见问题速查

| 问题 | 排查命令 |
|------|---------|
| 服务启动失败 | `cat .env` / `lsof -i :3000` / `node -v` |
| Redis 连接失败 | `redis-cli ping` |
| Token 无效 | `curl -H "Authorization: Bearer $TOKEN" $CSP_API_BASE_URL/csp/api/user/permissions` |
| 健康检查 503 | `curl http://localhost:3000/health \| python3 -m json.tool` |
| 优雅关闭超时 | 增大 `SHUTDOWN_TIMEOUT`（默认 30000ms） |

---

## 补充设计：日志增强规范

> 来源：`Enhanced-Logging-Guide.md`（已整合，原文件已删除）

### 日志类型与字段

系统基于 pino 输出结构化 JSON 日志，关键 `type` 字段：

| type | 说明 | 关键字段 |
|------|------|---------|
| `api_request` | CSP API 请求 | `method`, `url`, `params` |
| `api_response` | CSP API 响应 | `statusCode`, `duration`, `data` |
| `tool_start` | 工具开始执行 | `tool`, `params`, `userId` |
| `tool_step` | 工具执行步骤 | `tool`, `step`, `data` |
| `tool_success` | 工具执行成功 | `tool`, `duration`, `result` |
| `tool_error` | 工具执行失败 | `tool`, `error`, `stack` |
| `auth` | 认证事件 | `userId`, `groups`, `cached` |
| `sse` | SSE 连接事件 | `sessionId`, `event`, `userId` |

### 日志查询速查

```bash
# 查看工具执行日志
grep '"type":"tool_start"' Logs/app-$(date +%Y-%m-%d).log | npx pino-pretty

# 查看认证失败
grep '"type":"auth"' Logs/app-*.log | grep '"level":50'

# 查看 API 响应耗时
grep '"type":"api_response"' Logs/app-$(date +%Y-%m-%d).log | python3 -c \
  "import json,sys; [print(json.loads(l).get('duration','?'), 'ms') for l in sys.stdin]"

# 查看 SSE 连接事件
grep '"type":"sse"' Logs/app-$(date +%Y-%m-%d).log | npx pino-pretty
```

---

## 补充设计：手动测试指南摘要

> 来源：`Manual-Test-Handbook.md`（已整合，原文件已删除）

### 测试环境启动

```bash
# 启动全部服务（推荐）
cd Test && ./quick-start.sh all

# 仅启动 Mock Server（curl 测试）
./quick-start.sh mock

# 查看服务状态
./quick-start.sh status

# 热重载资源
./quick-start.sh reload
```

### 核心测试场景

| 场景 | 测试要点 |
|------|---------|
| 搜索并订阅工具 | `search_resources` → `manage_subscription(subscribe)` → 自动 sync 到本地 |
| 同步最新资源 | `sync_resources(mode=incremental)` → 验证 `~/.cursor/rules/` 等目录有新文件 |
| 上传单文件资源 | `upload_resource` → 选本地 `.mdc` 文件 → finalize 后返回真实 commit hash + MR URL |
| 取消订阅并清理 | `manage_subscription(unsubscribe)` → 本地文件删除 + `~/.cursor/mcp.json` 清理 |
| 连接稳定性 | 断开 Cursor 重连后 SSE session 能正常恢复 |

### Cursor MCP 连接配置

在 `~/.cursor/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "csp-ai-agent": {
      "url": "http://127.0.0.1:3000/sse",
      "transport": "sse"
    }
  }
}
```

---

**文档结束**

生成时间: 2026-03-03  
基于: OpenSpec Validated Specification  
优化: Verdaccio缓存机制 + GitLab Geo状态追踪  
技术栈: TypeScript/Node.js (v18+)  
版本: v1.2 (增强缓存、状态追踪、技术选型)  
最后更新: 2026-03-18（整合多源架构、HTTP API、部署指南、日志规范、手动测试指南）
