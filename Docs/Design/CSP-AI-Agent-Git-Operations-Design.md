# CSP AI Agent — Git Operations Design

**版本：** 1.0.0  
**日期：** 2026-04-10  
**作者：** Elliot Ding

---

## 概览

系统中存在两套完全独立的 Git 操作路径，由不同角色执行，互不干涉：

| 路径 | 执行者 | 方向 | 触发工具 |
|------|--------|------|---------|
| **读路径** | MCP Server 自身（`simple-git`） | pull → 本地 checkout | `sync_resources` |
| **写路径** | 后端 CSP API Server | 本地暂存 → commit + push | `upload_resource` |

---

## 一、读路径：MCP Server 自身的 Git 操作

**代码位置：** `SourceCode/src/git/multi-source-manager.ts`  
**入口：** `sync_resources` 工具调用 → Step 2  
**库：** `simple-git`（Node.js 进程内直接执行 git 命令）  
**操作对象：** MCP Server 所在机器本地磁盘上的 AI-Resources git 仓库

### 1.1 `syncAllSources()` — 同步所有仓库

**触发条件：** `sync_resources` 被调用且 `mode !== 'check'`

遍历 `ai-resources-config.json` 中所有 `enabled: true` 的 source，对每个调用 `syncSource()`。

**`syncSource()` 内部决策树：**

```
仓库目录是否存在？
  ├── 否 + git_url 未配置 → action: skipped（Docker 挂载/人工放置，无法操作）
  ├── 否 + git_url 已配置 → cloneRepository()
  ├── 是 + git_url 未配置 → action: skipped（无法 pull，等人工操作）
  └── 是 + git_url 已配置 → pullRepository()
```

---

### 1.2 `cloneRepository()` — 首次克隆

**触发条件：** 仓库目录不存在 且 `git_url` 已配置

执行的 git 命令：

```bash
git clone <git_url> <targetPath> --branch <branch> --single-branch
```

**参数说明：**
- `--branch <branch>`：克隆指定分支（默认 `main`，来自 `SourceConfig.git_branch`）
- `--single-branch`：只下载目标分支的历史，加快克隆速度，**且不创建 shallow 仓库**（shallow 仓库在后续 fetch 时会出现 "no merge base" 错误，故意避开）

克隆前会确保父目录存在（`mkdir -p`）。

---

### 1.3 `pullRepository()` — 拉取最新变更

**触发条件：** 仓库目录存在 且 `git_url` 已配置

这是最复杂的操作，分 8 个步骤执行，**刻意使用 fetch + diff + merge 三步走，而非直接 `git pull`**，原因是需要在合并前知道是否真的有文件变更。

#### Step 1：读取本地 HEAD

```bash
git rev-parse HEAD
```
记录合并前的 commit hash，用于合并后的对比日志。

#### Step 2：列出 remote

```bash
git remote -v
```
通过 `getRemotes(true)` 获取 remote 信息，写入日志供诊断用。

#### Step 3：检测是否为 shallow 仓库

```bash
git rev-parse --is-shallow-repository
```
返回 `"true"` 则为 shallow 仓库，决定后续 fetch 使用哪个参数。

> **为什么要检测？** shallow 仓库（`--depth=1` 克隆产生）的历史被截断，直接 `fetch origin branch` 后做 diff 会报 "no merge base" 错误。需要先 unshallow 才能正常 diff。

#### Step 4：fetch

根据 Step 3 的结果二选一：

```bash
# 非 shallow 仓库（正常情况）
git fetch origin <branch>

# shallow 仓库（异常情况，需要先补全历史）
git fetch --unshallow origin <branch>
```

只 fetch 不 merge，目的是把远端最新内容拉到本地 `origin/<branch>` 引用，但不改动工作区。

#### Step 5：读取远端 HEAD

```bash
git rev-parse origin/<branch>
```
获取 fetch 后的远端 commit hash，写入日志与本地 HEAD 对比。

#### Step 6：diff — 检测实际文件变更

```bash
git diff --stat HEAD...origin/<branch>
```
（`simple-git` 的 `diffSummary([HEAD...origin/branch])` 调用）

统计变更文件数、insertions、deletions。**若 `files.length === 0`，直接返回 `hasChanges: false`，跳过 merge**，避免不必要的磁盘写入。

#### Step 7：fast-forward merge（仅有变更时）

```bash
git merge origin/<branch> --ff-only
```

`--ff-only` 确保只做快进合并，不产生 merge commit。若远端有 non-linear 历史（理论上不应发生），merge 会失败并抛错，不会产生脏提交。

#### Step 8：读取新 HEAD（日志用）

```bash
git rev-parse HEAD
```
记录合并后的 commit hash，与 Step 1 的旧 hash 一起写入日志，方便追踪每次 sync 的变更。

---

### 1.4 `checkAllSources()` — 只查状态不操作

**触发条件：** `sync_resources` 被调用且 `mode === 'check'`

执行的 git 命令：

```bash
git remote -v   # 检查是否有 remote 配置
```

通过 `getRemotes(true)` 获取各仓库的 remote URL，**不做任何 fetch / pull / clone**，只返回仓库是否存在、是否有 remote 的状态信息。

---

### 1.5 `readResourceFiles()` — 从本地 checkout 读文件

**触发条件：** `downloadResource(id)` API 返回空文件列表时的 fallback

**执行的 git 命令：无**

这是纯文件系统操作（`fs.readdir` / `fs.readFile`），直接读取本地 git checkout 的工作区文件。**之所以需要先 `syncAllSources()` 保证最新，正是因为这一步读的是工作区，不是从 API 拿内容。**

搜索顺序：
1. 按 `priority` 降序遍历所有 source
2. 先尝试目录布局（`skills/<name>/`）
3. 再尝试平铺文件（`skills/<name>.md` / `skills/<name>.mdc`）

---

### 1.6 `scanResourceMetadata()` — 扫描脚本目录结构

**触发条件：** 检测 complex skill 是否含有本地脚本文件（`scripts/`、`teams/`、`references/` 子目录）

**执行的 git 命令：无**

内部调用 `readResourceFiles(name, type, includeAllFiles=true)`，递归读取目录下所有文件，判断是否存在非 Markdown 的脚本文件，生成 `has_scripts` 和 `script_files` 元数据。

---

### 1.7 当前实际状态

`ai-resources-config.json` 中 **`git_url` 尚未配置**，导致所有仓库的 `syncSource()` 都走 `action: skipped` 分支。

```
sync_resources 调用 syncAllSources()
  └── syncSource("csp")
        └── git_url 未配置 → skipped（不执行任何 git 命令）
```

**实际内容的"最新"靠人工 pull 保证**，`downloadResource(id)` 读到的是人工 pull 后的状态。一旦 `git_url` 配置完成，每次 `sync_resources` 都会自动触发 fetch + merge。

---

## 二、写路径：后端 CSP API Server 的 Git 操作

**代码位置：** `SourceCode/src/api/client.ts` → `finalizeResourceUpload()`  
**触发工具：** `upload_resource`  
**执行者：** 后端 CSP API Server（MCP Server 只发 HTTP 请求）

### 2.1 上传流程（两步走）

#### Step 1：暂存文件

```
POST /csp/api/resources/upload
Body: { resource_id, files[], message, type, team, ... }
```

文件内容上传到后端暂存区，获得 `upload_id`。此时文件**尚未写入 git**。

#### Step 2：触发 Git commit（finalize）

```
POST /csp/api/resources/finalize
Body: { upload_id, commit_message }
Response: { resource_id, version, url, commit_hash, download_url }
```

后端 CSP API Server 收到请求后：
1. 将暂存文件写入对应 git 仓库的工作区
2. `git add` 相关文件
3. `git commit -m "<commit_message>"`（生成 `commit_hash`）
4. `git push`（更新远端，使后续 sync 的 `git fetch` 能拿到）
5. 生成永久 `resource_id`、版本号，返回给 MCP Server

**MCP Server 侧不执行任何 git 命令**，只通过 HTTP 触发，并从响应中拿到 `commit_hash` 用于日志记录。

---

## 三、两条路径的关系

```
用户上传资源（写路径）
  MCP Server → POST /finalize → CSP API Server
                                    ├── git commit
                                    └── git push → 远端仓库更新

                                                      ↓ （之后某次 sync）

用户订阅 + 同步（读路径）
  sync_resources → syncAllSources()
    → git fetch origin main    ← 拉到刚才 push 的内容
    → git merge --ff-only
    → downloadResource(id)     ← 从已更新的本地 checkout 读取文件
    → 返回 local_actions 给 AI Agent 写入本地
```

写路径的 `git push` 是读路径的 `git fetch` 的上游数据源，两者通过远端仓库解耦。

---

## 四、关键设计决策汇总

| 决策 | 原因 |
|------|------|
| clone 用 `--single-branch` 不用 `--depth` | 避免 shallow 仓库在后续 fetch 时产生 "no merge base" 错误 |
| pull 用 fetch + diff + merge，不用 `git pull` | 需要在合并前统计文件变更数；diff 为零时跳过 merge 减少 I/O |
| merge 用 `--ff-only` | 不产生 merge commit，保持线性历史；非线性时报错而非静默合并 |
| fetch 前检测 shallow 状态 | 已有 shallow 仓库需先 `--unshallow` 补全历史才能正常 diff |
| 上传用两步走（upload + finalize） | 先验证文件合法性再 commit，避免无效内容进入 git 历史 |
| MCP Server 只发 HTTP 不做写侧 git | 写权限集中在后端，MCP Server 无需配置 git 写凭证 |
