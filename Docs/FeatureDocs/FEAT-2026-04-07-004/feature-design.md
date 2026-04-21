# Feature 设计文档: 用户使用统计查询

**Feature ID:** FEAT-2026-04-07-004
**创建时间:** 2026-04-07
**负责人:** AI Agent (Cursor)
**版本:** 1.0

---

## 一、背景与动机

### 1.1 当前状态

**Telemetry 存储机制:**
- 存储位置: `{MCP Server CWD}/ai-resource-telemetry.json`
- 实际路径: `/Users/ElliotDing/SourceCode/AI Explore/Cursor-AI-Agent-MCP/ai-resource-telemetry.json`
- 数据结构: 多用户模式 (按 user_token 分组)
- 管理模块: `SourceCode/src/telemetry/manager.ts`

**现有功能:**
- ✅ 记录资源调用 (Command/Skill)
- ✅ 自动上报到远端 API (定期 flush)
- ✅ 多用户数据隔离
- ✅ 关联 Jira Issue (可选)

**存在的问题:**
- ❌ 用户无法查询自己的使用统计
- ❌ 数据只能通过远端 API 查看 (依赖服务端)
- ❌ 无法实时查看本地缓存的使用数据

### 1.2 用户需求

**核心诉求:**
- 用户希望能查询自己目前的资源使用次数
- **数据来源:** 远端 API `GET /csp/api/mcp-telemetry/my-usage`
- 数据格式: 按资源聚合,显示调用次数、首次/最后调用时间

**使用场景:**
1. 开发者想知道自己最常用哪些 Skill/Command
2. 团队管理员想统计资源使用情况
3. 查看历史使用趋势 (支持时间范围查询)
4. 查看与特定 Jira Issue 关联的资源调用

---

## 二、需求描述

### 2.1 功能需求

#### FR-1: 查询个人使用统计

**描述:** 用户可以查询自己的资源使用统计 (从远端 API 获取历史数据)

**API 端点:** `GET /csp/api/mcp-telemetry/my-usage`

**输入:**
- `user_token` (自动注入,通过 Authorization header 传递)
- `resource_type` (可选,过滤 command/skill)
- `start_date` (可选,查询起始日期,ISO 8601 格式)
- `end_date` (可选,查询结束日期,ISO 8601 格式)

**输出:**
- 用户信息: user_id, user_name, user_email
- 总调用次数: total_invocations
- 资源列表: resource_usage (按调用次数降序排列)
- 每个资源: resource_id, resource_name, resource_type, invocation_count

**示例响应:**
```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "user_id": 101,
    "user_name": "Dev User",
    "user_email": "dev@example.com",
    "total_invocations": 45,
    "resource_usage": [
      {
        "resource_id": "zNet-cmd-001",
        "resource_name": "debug-network",
        "resource_type": "command",
        "invocation_count": 30
      },
      {
        "resource_id": "Client-Public-skill-003",
        "resource_name": "code-review",
        "resource_type": "skill",
        "invocation_count": 15
      }
    ]
  }
}
```

#### FR-2: 清理未使用代码

**描述:** 删除 `getTelemetryFilePath()` 函数 (未被使用)

**原因:**
- `TelemetryManager` 使用 `{CWD}/ai-resource-telemetry.json`
- `getTelemetryFilePath()` 返回 `~/.cursor/ai-resource-telemetry.json` (不同位置)
- 代码中无任何调用,属于冗余代码

---

## 三、技术方案

### 3.1 新增 MCP Tool: `query_usage_stats`

#### 工具定义

```typescript
// File: SourceCode/src/tools/query-usage-stats.ts

export interface QueryUsageStatsParams {
  resource_type?: 'command' | 'skill' | 'all';
  start_date?: string;  // ISO 8601 格式
  end_date?: string;    // ISO 8601 格式
  user_token?: string;  // 自动注入
}

export interface UsageStatsResource {
  resource_id: string;
  resource_name: string;
  resource_type: string;
  invocation_count: number;
}

export interface UsageStatsResult {
  user_id: number;
  user_name: string;
  user_email: string;
  total_invocations: number;
  resource_usage: UsageStatsResource[];
}
```

#### 实现逻辑

```typescript
export async function queryUsageStats(params: unknown): Promise<ToolResult<UsageStatsResult>> {
  const p = params as QueryUsageStatsParams;
  const userToken = p.user_token ?? '';
  
  if (!userToken) {
    return {
      success: false,
      error: { code: 'MISSING_TOKEN', message: 'User token is required' }
    };
  }
  
  try {
    // Step 1: 调用远端 API 查询使用统计
    // API: GET /csp/api/mcp-telemetry/my-usage
    const response = await apiClient.getMyUsageStats({
      resource_type: p.resource_type,
      start_date: p.start_date,
      end_date: p.end_date,
    }, userToken);
    
    // Step 2: 返回结果 (无需额外处理,直接透传 API 响应)
    return {
      success: true,
      data: response.data,
    };
    
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      params: p,
    }, 'query_usage_stats: failed to fetch usage stats');
    
    return {
      success: false,
      error: {
        code: 'QUERY_FAILED',
        message: error instanceof Error ? error.message : String(error),
      }
    };
  }
}
```

### 3.2 扩展 API Client

需要在 `apiClient` 中新增方法调用远端 API:

```typescript
// File: SourceCode/src/api/client.ts

/**
 * GET /csp/api/mcp-telemetry/my-usage
 * 
 * 查询当前用户的资源使用明细。
 */
async getMyUsageStats(
  params: {
    resource_type?: string;
    start_date?: string;
    end_date?: string;
  },
  userToken?: string
): Promise<{
  code: number;
  result: string;
  data: UsageStatsResult;
}> {
  const queryParams = new URLSearchParams();
  if (params.resource_type) queryParams.set('resource_type', params.resource_type);
  if (params.start_date) queryParams.set('start_date', params.start_date);
  if (params.end_date) queryParams.set('end_date', params.end_date);
  
  const url = `/csp/api/mcp-telemetry/my-usage?${queryParams.toString()}`;
  return await this.get<{
    code: number;
    result: string;
    data: UsageStatsResult;
  }>(url, this.authConfig(userToken));
}
```

### 3.3 删除未使用代码

```typescript
// File: SourceCode/src/utils/cursor-paths.ts

// ❌ 删除以下函数 (行 193-206):
/**
 * Returns the path to the local AI resource telemetry file.
 * ...
 */
export function getTelemetryFilePath(): string {
  return path.join(getCursorRootDir(), 'ai-resource-telemetry.json');
}
```

**检查引用:** 确保没有其他文件调用此函数

---

## 四、API 设计

### 4.1 远端 API 接口

**API 端点:** `GET /csp/api/mcp-telemetry/my-usage`

**请求 Headers:**

| Header | 说明 |
|--------|------|
| Authorization | Bearer {user_token} |
| Accept | application/json |
| Content-Type | application/json |

**Query Parameters:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| resource_type | String | 否 | 过滤资源类型: command / skill |
| start_date | String | 否 | 查询起始日期 (ISO 8601) |
| end_date | String | 否 | 查询结束日期 (ISO 8601) |

**请求示例:**
```
GET /csp/api/mcp-telemetry/my-usage?resource_type=skill&start_date=2026-03-01T00:00:00Z
Authorization: Bearer eyJ0eXAiOiJKV1Qi...
```

**响应示例 (200 OK):**
```json
{
  "code": 2000,
  "result": "success",
  "data": {
    "user_id": 101,
    "user_name": "Dev User",
    "user_email": "dev@example.com",
    "total_invocations": 45,
    "resource_usage": [
      {
        "resource_id": "zNet-cmd-001",
        "resource_name": "debug-network",
        "resource_type": "command",
        "invocation_count": 30
      },
      {
        "resource_id": "Client-Public-skill-003",
        "resource_name": "code-review",
        "resource_type": "skill",
        "invocation_count": 15
      }
    ]
  }
}
```

**错误响应:**
- `401 Unauthorized`: token 无效或过期
- `403 Forbidden`: 权限不足
- `500 Internal Server Error`: 服务端错误

---

### 4.2 MCP Tool 接口

**Tool Name:** `query_usage_stats`

**输入参数:**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| resource_type | String | 否 | all | 过滤资源类型: command / skill / all |
| start_date | String | 否 | - | 查询起始日期 (ISO 8601) |
| end_date | String | 否 | - | 查询结束日期 (ISO 8601) |
| user_token | String | 否 | (自动注入) | 用户认证 token |

**输出结果:**

```typescript
{
  success: true,
  data: {
    user_id: number,
    user_name: string,
    user_email: string,
    total_invocations: number,
    resource_usage: [
      {
        resource_id: string,
        resource_name: string,
        resource_type: string,
        invocation_count: number
      }
    ]
  }
}
```

---

## 五、实施计划

### Phase 1: 清理未使用代码
- **任务:** 删除 `getTelemetryFilePath()` 函数
- **文件:** `SourceCode/src/utils/cursor-paths.ts` (行 193-206)
- **验证:** 检查是否有其他引用,确保无编译错误

### Phase 2: 扩展 API Client
- **任务:** 在 `apiClient` 中实现 `getMyUsageStats()` 方法
- **文件:** `SourceCode/src/api/client.ts`
- **接口:** `GET /csp/api/mcp-telemetry/my-usage`
- **验证:** 单元测试 + 集成测试 (mock server)

### Phase 3: 实现 `query_usage_stats` Tool
- **任务:** 创建新工具文件并注册
- **文件:** `SourceCode/src/tools/query-usage-stats.ts`
- **核心逻辑:** 调用 API,返回统计结果
- **验证:** 工具集成测试 + MCP Server 端对端测试

### Phase 4: 文档与测试
- **任务:** 更新 API Mapping 文档 + 创建测试用例
- **文件:** `Docs/Design/CSP-AI-Agent-API-Mapping.md`
- **测试:** 端对端测试 (真实 token + 真实 API)
- **产出:** `Test/Test Reports/FEAT-2026-04-07-004/test-report.md`

---

## 六、设计决策

### 6.1 数据来源

**选择:** 调用远端 API `GET /csp/api/mcp-telemetry/my-usage`

**原因:**
- ✅ 查询历史数据 (完整的用户使用记录)
- ✅ 服务端统一管理 (多设备/多 MCP 实例数据汇总)
- ✅ 用户只能访问自己的数据 (token 认证)
- ✅ 支持时间范围查询 (start_date / end_date)
- ✅ 无需本地文件权限 (跨平台兼容性)

**与本地文件的对比:**

| 方案 | 数据完整性 | 跨设备 | 历史数据 | 权限 |
|------|-----------|--------|---------|------|
| **远端 API (选择)** | ✅ 完整 | ✅ 支持 | ✅ 长期保存 | ✅ token 隔离 |
| 本地文件 | ❌ 仅当前设备 | ❌ 不支持 | ❌ 易丢失 | ⚠️ 文件锁冲突 |

### 6.2 多用户隔离

**设计:** 基于 `Authorization` Header 中的 `user_token` 隔离数据

**实现:**
- API 通过 token 识别用户身份
- 用户 A 无法查看用户 B 的统计 (服务端强制校验)
- MCP Server 透传 token,不存储用户数据

### 6.3 性能优化

**API 调用:**
- 服务端缓存用户统计数据 (减少数据库查询)
- 支持可选过滤参数 (减少数据传输)
- 响应时间预期 < 500ms (含网络延迟)

**前端展示:**
- 默认按 `invocation_count` 倒序
- 返回完整列表 (由 AI Agent 决定展示前 N 条)

---

## 七、影响范围

### 7.1 新增文件

| 文件 | 说明 |
|------|------|
| `SourceCode/src/tools/query-usage-stats.ts` | 新 Tool 实现 |
| `Test/test-query-usage-stats.js` | 测试脚本 |

### 7.2 修改文件

| 文件 | 变更内容 |
|------|---------|
| `SourceCode/src/api/client.ts` | 新增 `getMyUsageStats()` 方法 |
| `SourceCode/src/utils/cursor-paths.ts` | 删除 `getTelemetryFilePath()` 函数 |
| `SourceCode/src/tools/index.ts` | 注册 `query_usage_stats` tool |
| `Docs/Design/CSP-AI-Agent-API-Mapping.md` | 新增 Tool 文档 |

### 7.3 不影响的模块

- ✅ `TelemetryManager` (无需修改,不涉及本地文件读取)
- ✅ `track_usage` Tool (继续上报数据到服务端)
- ✅ 现有 telemetry 记录逻辑 (不变)
- ✅ 定期 flush 上报 (不变)
- ✅ 其他 MCP Tools (完全独立)

---

## 八、安全考虑

### 8.1 数据隔离

**问题:** 如何防止用户 A 查询用户 B 的数据?

**解决方案:**
- ✅ API 端强制校验 `Authorization` Header 中的 token
- ✅ MCP Server 不存储用户数据,仅透传 token 到 API
- ✅ API 通过 token 自动识别用户身份,返回对应数据

**实施检查:**
- 禁止 MCP Tool 接受外部传入的 `user_token` (必须自动注入)
- API 返回错误 401/403 时,MCP Tool 返回 `UNAUTHORIZED` 错误

### 8.2 隐私合规

**数据字段审查:**
- `user_id`: L1 (内部 ID,允许)
- `user_name`: L2 (用户名,允许)
- `user_email`: L3 (邮箱,允许但需脱敏处理)
- `resource_id`: L1 (内部 ID,允许)
- `resource_name`: L1 (内部名称,允许)
- `invocation_count`: L1 (统计数据,允许)
- `resource_type`: L1 (资源类型,允许)
- `user_token`: **不返回** (L3 敏感信息)

**结论:** ✅ 所有返回字段均为 L1/L2/L3 级别,user_email 已由 API 返回前处理

### 8.3 日志安全

**要求:** 不在日志中记录完整 token

**实施:**
- API Client 已使用 `maskToken()` 脱敏
- 日志示例: `"token": "eyJ0eX...***masked***"`

---

## 九、性能评估

### 9.1 响应时间

| 操作 | 预估时间 | 说明 |
|------|---------|------|
| API 网络请求 | < 200ms | HTTP GET 请求到 CSP 服务器 |
| 服务端查询 | < 200ms | 数据库查询 + 聚合计算 |
| JSON 解析 | < 5ms | 标准 JSON.parse |
| **总计** | **< 500ms** | 含网络延迟的总响应时间 |

### 9.2 并发支持

**设计:** 无状态 API 调用

**并发性能:**
- ✅ 支持多用户并发查询 (服务端并发处理)
- ✅ 不阻塞本地 telemetry 记录
- ✅ 无本地文件锁冲突

### 9.3 数据量限制

**预估数据量:**
- 单用户资源: 10-50 个
- 查询结果大小: < 10KB
- 网络传输时间: < 50ms

**扩展性:**
- ✅ API 支持分页 (未来可扩展)
- ✅ 支持按资源类型过滤 (减少数据量)

---
- ✅ 不影响定期 flush

---

## 十、用户体验

### 10.1 调用方式

**方式 1: AI Agent 自然语言**
```
用户: "查看我的资源使用统计"
AI: 调用 query_usage_stats() → 展示结果
```

**方式 2: Cursor Command (可选,未来扩展)**
```
/csp-usage-stats
```

### 10.2 结果展示

**格式:** 表格 + 汇总

```
📊 资源使用统计

总资源数: 5
总调用次数: 128
最后上报: 2026-04-07 08:45:30

| 排名 | 资源名称 | 类型 | 调用次数 | 首次调用 | 最后调用 | Jira |
|------|---------|------|---------|---------|---------|------|
| 1 | zoom-build | Skill | 45 | 2026-03-15 | 2026-04-07 | ZOOM-12345 |
| 2 | zoom-code-review | Skill | 32 | 2026-03-20 | 2026-04-06 | - |
| 3 | zoom-jira | Skill | 28 | 2026-03-18 | 2026-04-05 | ZOOM-67890 |
| 4 | ts-log | Skill | 15 | 2026-03-22 | 2026-04-03 | - |
| 5 | zoom-testcase | Skill | 8 | 2026-03-25 | 2026-04-02 | - |
```

---

## 十一、测试计划

### 11.1 单元测试

| 测试 | 场景 | 预期结果 |
|------|------|---------|
| Test 1 | 查询所有资源 | 返回完整列表 |
| Test 2 | 过滤 Skill 类型 | 只返回 skill 资源 |
| Test 3 | 查询特定资源 ID | 只返回匹配资源 |
| Test 4 | 查询关联 Jira | 只返回有 jira_id 的调用 |
| Test 5 | 空数据场景 | 返回空列表 (不报错) |
| Test 6 | 无效 token | 返回错误 |
| Test 7 | 排序验证 | 按调用次数倒序 |

### 11.2 集成测试

**场景 1: 完整工作流**
```
1. 用户调用 /skill/zoom-build (记录到 telemetry)
2. 用户查询统计 → 显示 zoom-build: 1 次
3. 用户再次调用 → 查询显示 2 次
4. 定期 flush 上报 → pending_events 清空
5. 再次查询 → 显示空列表 (已上报)
```

**场景 2: 多用户隔离**
```
1. 用户 A 调用资源 → 记录到 users[tokenA]
2. 用户 B 调用资源 → 记录到 users[tokenB]
3. 用户 A 查询 → 只看到自己的数据
4. 用户 B 查询 → 只看到自己的数据
```

---

## 十二、文档变更

### 12.1 API Mapping 更新

**新增章节:** `8. 查询用户使用统计`

**内容:**
- Tool 名称: `query_usage_stats`
- 输入参数说明
- 输出格式定义
- 使用示例

### 12.2 README 更新

**新增功能点:**
```
## 功能特性

...

### 9. 使用统计查询
- 查询个人资源调用统计
- 按资源类型、ID、Jira Issue 过滤
- 实时显示本地缓存数据
- 支持多用户数据隔离
```

---

## 十三、版本规划

**版本号:** 0.3.0 (MINOR 版本 - 新功能)

**发布说明:**
```
## v0.3.0 (2026-04-07)

### New Features
- 新增 query_usage_stats Tool: 查询个人资源使用统计
- 支持按资源类型、ID、Jira Issue 过滤
- 实时查看本地缓存的 telemetry 数据

### Improvements
- 清理未使用的 getTelemetryFilePath() 函数
- TelemetryManager 新增 readUserData() 公开方法

### Breaking Changes
- 无
```

---

## 十四、风险评估

### 14.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 文件读取失败 | 低 | 低 | try-catch 包装,返回空数据 |
| 数据格式不兼容 | 低 | 中 | 向后兼容检查,支持 v1 格式 |
| 并发读写冲突 | 低 | 低 | 只读操作,不影响写入 |

### 14.2 用户体验风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 查询结果为空 | 中 | 低 | 友好提示: "暂无使用记录" |
| 数据已上报清空 | 高 | 低 | 说明: "显示待上报数据,已上报数据需联系管理员" |

---

## 十五、后续优化 (可选)

### 15.1 历史数据查询

**当前限制:** 只能查询 `pending_events` (未上报数据)

**未来扩展:** 
- 从远端 API 查询历史数据
- 合并本地和远端数据
- 支持时间范围过滤

### 15.2 导出功能

**需求:** 导出统计数据为 CSV/JSON

**实现:**
```typescript
export_usage_stats({
  format: 'csv' | 'json',
  output_path: '~/Downloads/usage-stats.csv'
})
```

### 15.3 可视化

**需求:** 使用图表展示统计数据

**实现:** 生成 Markdown 表格 + Mermaid 图表

---

## 十六、待确认问题

### 问题 1: Tool 命名

**候选名称:**
- `query_usage_stats` (当前)
- `get_usage_stats`
- `show_my_usage`

**推荐:** `query_usage_stats` (更专业,符合 query 语义)

---

## 十六、确认清单

✅ **已确认的设计决策:**
1. **数据来源:** 远端 API `GET /csp/api/mcp-telemetry/my-usage` (历史数据)
2. **用户隔离:** token 强制校验,用户只能查询自己的数据
3. **Tool 命名:** `query_usage_stats`
4. **完全独立:** 不修改 `TelemetryManager`,不影响现有工具

✅ **符合用户要求:**
1. 用户只能查询自己的 token 对应的数据 ✓
2. 改动完全在新工具中实现,不影响其他工具 ✓
3. 数据来源为远端 API (参考文档第 4 条) ✓

---

**创建时间:** 2026-04-07
**最后更新:** 2026-04-07
**状态:** ✅ 设计文档已完成

---

**请确认:**
1. 设计方案是否符合你的需求?
2. 是否需要调整任何细节?
3. 确认后我将开始实施!
