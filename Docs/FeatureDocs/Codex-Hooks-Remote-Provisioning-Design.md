# Codex Hooks Remote Provisioning 设计方案

**Version:** 1.0.0  
**Date:** 2026-05-09  
**Status:** Draft

---

## 1. 背景与问题

团队希望把一组标准化的 Codex hooks 分发到用户本机，用于：

1. 在特定 MCP tool 或 server 被调用时自动记录统计
2. 在特定事件点自动执行团队治理逻辑
3. 降低用户手工配置 `~/.codex/hooks.json` 的门槛

当前问题在于，hooks 不属于普通 MCP 资源运行面，而属于 Codex 本地配置面。也就是说：

1. 仅通过远端 MCP 描述 hook 内容，不会自动生效
2. 仅把 hook 文件放进 plugin 或资源包，不足以保证运行时执行
3. 如果要实现“远程下发，本地启用”，必须有一条本地落盘链路

因此，本方案的核心目标是：**通过 MCP 返回 hook 定义和 local actions，由 agent 在用户本机完成配置写入与启用。**

---

## 2. 目标与非目标

### 2.1 目标

本方案需要达成以下目标：

1. 支持通过 MCP 下发团队定义的 hooks 配置
2. 支持由 agent 自动写入或合并 `~/.codex/hooks.json`
3. 支持同步启用 `~/.codex/config.toml` 中的 `codex_hooks = true`
4. 尽量不覆盖用户已有配置，而是做安全 merge
5. 安装完成后可验证、可回滚、可重复执行

### 2.2 非目标

本方案当前不解决以下问题：

1. 不保证当前正在运行的 Codex 会话热加载新配置
2. 不试图通过普通网页直接修改用户本机 Codex 配置
3. 不依赖 plugin-local hooks 作为正式安装路径
4. 不负责定义具体统计系统的后端实现

---

## 3. 关键结论

### 3.1 hooks 安装必须处理两个文件

要让 hooks 稳定可用，安装流程必须同时处理：

1. `~/.codex/hooks.json`
2. `~/.codex/config.toml`

原因是 `hooks.json` 负责声明事件与命令，而 `config.toml` 中的 feature flag 决定 hooks 能力是否被启用。仅写 `hooks.json` 不足以保证功能打开。

### 3.2 推荐显式设置 `codex_hooks = true`

本方案明确要求在安装时同步确保以下配置存在：

```toml
[features]
codex_hooks = true
```

设计上不要假设用户环境已经默认开启，也不要要求用户手工再去点开关。**agent 应直接完成该配置写入或 merge。**

### 3.3 生效策略按“新会话或重启”处理

本方案不假设 hooks 配置会在当前会话中热加载。安装完成后应提示用户：

1. 至少新开一个 Codex session
2. 如果仍未生效，重启 Codex

---

## 4. 总体设计

### 4.1 设计原则

本方案遵循四个原则：

1. **MCP 提供内容，不直接负责本机安装**
2. **agent 执行 local actions，完成最终落盘**
3. **对用户本地配置做 merge，不做粗暴覆盖**
4. **安装完成后必须给出明确验证结果**

### 4.2 高层架构

```text
Admin / Team Config
        ↓
Custom MCP Server
        ↓
Return hook spec + local_actions_required
        ↓
Codex Agent executes local actions
        ↓
Write/Merge ~/.codex/hooks.json
Write/Merge ~/.codex/config.toml
        ↓
User opens new Codex session
        ↓
Hooks become active
```

### 4.3 角色分工

| 组件 | 职责 |
|---|---|
| 团队 MCP | 提供 hook 定义、安装策略、版本信息 |
| Agent | 执行 local actions，修改本地文件 |
| Codex 本地运行时 | 读取 hooks 配置并在后续会话执行 |
| 统计服务 | 接收 hook 触发后的埋点请求 |

---

## 5. 安装流程设计

### 5.1 标准安装流程

推荐安装链路如下：

1. 用户触发“安装 hooks”能力
2. MCP 返回目标 hooks 配置内容
3. MCP 同时返回 `local_actions_required`
4. agent 先备份已有配置
5. agent merge `~/.codex/hooks.json`
6. agent merge `~/.codex/config.toml`
7. agent 输出安装结果与后续提示

### 5.2 local actions 内容

建议的本地动作顺序：

1. 检查 `~/.codex/` 是否存在，不存在则创建
2. 备份 `hooks.json` 到 `hooks.json.bak.<timestamp>`
3. 备份 `config.toml` 到 `config.toml.bak.<timestamp>`
4. 校验现有 `hooks.json` 是否为合法 JSON
5. 以事件维度 merge hooks 配置
6. 校验并写入 `[features].codex_hooks = true`
7. 返回执行结果

### 5.3 幂等性要求

安装动作必须可重复执行：

1. 同一 hook 已存在时不重复追加
2. `codex_hooks = true` 已存在时不重复写入
3. 多次执行不应产生等价重复配置

---

## 6. 配置文件设计

### 6.1 hooks.json 结构要求

`hooks.json` 的写入策略建议按事件维度组织。每个事件下可以挂多个命令项，命令项需要保留稳定标识，便于后续升级和去重。

示意结构如下：

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "id": "team-mcp-usage-tracker",
        "matcher": {
          "tool_type": "mcp",
          "server_names": [
            "target-server-a",
            "target-server-b"
          ]
        },
        "command": [
          "/usr/local/bin/team-hook-reporter",
          "--event",
          "post-tool-use"
        ]
      }
    ]
  }
}
```

这里的字段名可能随 Codex hooks 实际 schema 演进而变化，但方案层面要求不变：

1. 要有稳定 `id`
2. 要有过滤条件
3. 要有实际执行命令

### 6.2 config.toml 结构要求

`config.toml` 必须确保存在以下配置：

```toml
[features]
codex_hooks = true
```

如果已经有 `[features]` 段，只追加或更新 `codex_hooks`，不覆盖其他字段。

### 6.3 merge 策略

#### hooks.json

1. 按 event 名称 merge
2. 按 hook `id` 去重
3. 若 `id` 相同但内容不同，按版本规则更新
4. 不删除用户自定义且不属于团队命名空间的 hook

#### config.toml

1. 若没有 `[features]`，则创建
2. 若 `codex_hooks` 缺失，则追加
3. 若值为 `false`，更新为 `true`
4. 保留其他 feature 配置不变

---

## 7. 统计型 Hook 设计

### 7.1 使用场景

本方案重点支持以下场景：

1. 当特定 MCP server 被调用时，自动记录一次调用统计
2. 当特定 MCP tool 被调用时，自动上报事件
3. 统计逻辑不依赖 agent 再额外思考是否要调用另一个工具

### 7.2 推荐方式

推荐链路是：

```text
Tool event triggered
      ↓
Hook command executed locally
      ↓
Local reporter script sends HTTP request
      ↓
Stats backend records usage
```

不推荐链路：

```text
Hook triggered
      ↓
Hook asks Codex to call another MCP tool
```

原因：

1. hook 属于运行时命令层，不是 agent 再规划一轮
2. hook 再调用另一个 MCP tool 会引入额外耦合
3. 直接执行本地脚本上报更稳定，也更容易审计

### 7.3 统计 payload 建议

建议 payload 至少包含：

| 字段 | 说明 |
|---|---|
| `event` | hook 事件名 |
| `tool_name` | 被调用的 tool 名 |
| `server_name` | MCP server 名 |
| `timestamp` | 触发时间 |
| `session_id` | 会话标识（若可获取） |
| `user_id` | 用户标识（如可安全获取） |
| `status` | success / error |

如果涉及敏感字段，必须在本地脚本侧完成脱敏，避免直接上报高敏数据。

---

## 8. 验证与回滚

### 8.1 安装后验证

安装完成后至少做两层验证：

1. **文件级验证**
   - `~/.codex/hooks.json` 存在且 JSON 合法
   - `~/.codex/config.toml` 包含 `codex_hooks = true`

2. **运行级验证**
   - 新开一个 Codex session
   - 触发一个简单 hook
   - 确认本地日志或统计服务收到事件

### 8.2 回滚策略

若安装失败或用户要求恢复：

1. 用备份文件恢复 `hooks.json`
2. 用备份文件恢复 `config.toml`
3. 删除本次新增的备份临时文件（可选）
4. 提示用户重启 Codex 或新开 session

---

## 9. 风险与限制

### 9.1 版本兼容性风险

hooks 仍处于演进阶段，不同 Codex 版本可能存在：

1. 事件类型不同
2. schema 字段不同
3. 某些事件只支持观察，不支持拦截

因此安装器需要带版本判断，或至少在文档中声明支持范围。

### 9.2 热加载不确定性

当前不应依赖“配置文件改完立即对当前会话生效”。这意味着安装流程必须把“新开 session / 重启 Codex”作为正式步骤。

### 9.3 本地文件权限风险

如果 agent 没有权限写 `~/.codex/`，安装会失败。因此 local actions 执行前应先检测目标目录可写性，并给出失败原因。

---

## 10. 实施建议

### 10.1 第一阶段

先支持最小闭环：

1. 安装 `hooks.json`
2. 启用 `codex_hooks = true`
3. 提供一个最简单的统计 hook
4. 用本地日志验证而不是直接接生产统计

### 10.2 第二阶段

再补：

1. hook 版本管理
2. hook 升级与卸载
3. MCP server / tool 白名单配置
4. 统计上报失败重试机制

### 10.3 最终建议

从工程实现角度，推荐采用以下正式策略：

1. **MCP 负责下发 hook 内容与安装动作**
2. **agent 负责修改 `~/.codex/hooks.json` 与 `~/.codex/config.toml`**
3. **安装后要求用户至少新开一个 Codex session**
4. **若需要稳定性更高，直接提示用户重启 Codex**

这能在不要求用户手工点开关的前提下，把 hooks 启用流程收敛成一条可自动执行、可验证、可回滚的分发路径。
