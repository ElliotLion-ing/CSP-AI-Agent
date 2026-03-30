# CSP AI Agent MCP Server

Centralized AI tools distribution and management system powered by Model Context Protocol (MCP).

## Overview

CSP AI Agent is an MCP server that enables seamless synchronization of AI resources (commands, skills, rules, and MCP servers) between a centralized repository and Cursor IDE. It provides automatic resource discovery, subscription management, and intelligent caching.

## Key Features

- **AI Resource Management**: Subscribe, sync, search, and upload AI resources
- **Hybrid Sync Strategy (v2.0)**: Complex skills download scripts locally while maintaining remote telemetry
- **Multi-source Git Support**: Aggregate resources from multiple Git repositories with priority-based conflict resolution
- **Incremental Update**: String content equality comparison to skip unchanged files (reduces bandwidth)
- **Intelligent Caching**: Skip redundant downloads and file writes using content-based comparison
- **MCP Prompt Mode**: Commands and Skills are registered as MCP Prompts (no local file writes for simple resources)
- **Solid Prompt Fallback**: Newly subscribed Commands and Skills can be resolved immediately through `resolve_prompt_content`
- **Auto-configuration**: MCP servers are automatically registered in `~/.cursor/mcp.json`
- **Telemetry & Analytics**: Track resource usage and sync health

## Quick Start

### Installation

```bash
npm install -g @elliotding/ai-agent-mcp
```

### Configuration

Create a `~/.cursor/mcp.json` (or let Cursor create it) and add:

```json
{
  "mcpServers": {
    "csp-ai-agent": {
      "url": "https://your-server.example.com/sse",
      "transport": {
        "type": "sse"
      },
      "env": {
        "CSP_USER_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Starting the Server

**Development:**
```bash
cd SourceCode
npm install
npm run dev
```

**Production (SSE mode):**
```bash
CSP_API_BASE_URL=https://api.example.com \
CSP_USER_TOKEN=your-token \
AI_RESOURCES_PATH=/path/to/AI-Resources \
csp-ai-agent-mcp --transport sse --port 3000
```

**Production (stdio mode):**
```bash
csp-ai-agent-mcp --transport stdio
```

## Usage

### Available Tools

#### 1. `sync_resources`

Synchronize subscribed AI resources with hybrid sync strategy (v2.0).

**Hybrid Sync Strategy:**
- **Simple resources** (single markdown file): Registered as MCP Prompt only
- **Complex skills** (with scripts): MCP Prompt + local script files in **isolated path** `~/.csp-ai-agent/skills/<name>/`
- **Path isolation**: Complex skills NOT stored in `~/.cursor/skills/` to prevent AI auto-discovery and ensure telemetry tracking
- **Incremental mode**: Skips unchanged files using string content equality comparison (client-side)

```typescript
// In Cursor AI Agent context
const mcpJson = JSON.parse(fs.readFileSync('~/.cursor/mcp.json', 'utf8'));
const configured = Object.keys(mcpJson.mcpServers || {});

const result = await callMcpTool('sync_resources', {
  mode: 'incremental',  // or 'full', 'check'
  configured_mcp_servers: configured,  // Optimization: skip already configured MCPs
});

// Execute local actions (for complex skills, rules, and MCPs)
if (result.local_actions_required) {
  for (const action of result.local_actions_required) {
    if (action.action === 'write_file') {
      const localPath = expandPath(action.path);
      
      // Skip if content unchanged
      if (fs.existsSync(localPath)) {
        const local = fs.readFileSync(localPath, 'utf8');
        if (local === action.content) continue;
      }
      
      // Write file
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, action.content, action.encoding || 'utf8');
      
      // Set permissions (Unix only)
      if (action.mode && process.platform !== 'win32') {
        fs.chmodSync(localPath, parseInt(action.mode, 8));
      }
    }
  }
}
```

**Modes:**
- `incremental` (default): Update only changed resources, skip unchanged files
- `full`: Download all resources (file recovery mode)
- `check`: Status check only (no downloads)

**Result Fields:**
- `summary.skipped`: Number of resources skipped (already up-to-date)
- `skipped_resources`: Details of skipped resources with reasons
- `local_actions_required`: File operations for AI to execute locally

**Optimization:** Pass `configured_mcp_servers` to skip downloading MCP resources that are already in `~/.cursor/mcp.json`. This can save **70-90% of API calls and network traffic** in typical scenarios.

#### 2. `manage_subscription`

Manage resource subscriptions.

```typescript
// Subscribe to a resource
await callMcpTool('manage_subscription', {
  action: 'subscribe',
  resource_ids: ['resource-id-1', 'resource-id-2'],
  auto_sync: true,  // Trigger sync after subscribing
});

// List subscriptions
await callMcpTool('manage_subscription', {
  action: 'list',
});

// Unsubscribe
await callMcpTool('manage_subscription', {
  action: 'unsubscribe',
  resource_ids: ['resource-id-1'],
});
```

#### 3. `search_resources`

Search available AI resources.

```typescript
await callMcpTool('search_resources', {
  keyword: 'code review',
  type: 'skill',  // Optional: 'command', 'skill', 'rule', 'mcp'
});
```

#### 4. `upload_resource`

Upload a new AI resource to the repository.

```typescript
await callMcpTool('upload_resource', {
  resource_id: 'my-custom-skill',
  type: 'skill',
  message: 'Add custom code review skill',
  files: [
    { path: 'SKILL.md', content: '# My Skill...' },
    { path: 'examples.md', content: '# Examples...' },
  ],
});
```

#### 5. `uninstall_resource`

Remove a resource from local installation (v2.0: includes local script cleanup).

```typescript
// Uninstall a skill with local scripts
const result = await callMcpTool('uninstall_resource', {
  resource_id_or_name: 'zoom-build',
  remove_from_account: true,  // Also cancel subscription
});

// Execute local cleanup (AI must perform on user's machine)
if (result.local_actions_required) {
  for (const action of result.local_actions_required) {
    if (action.action === 'delete_file') {
      const localPath = expandPath(action.path);
      if (fs.existsSync(localPath)) {
        fs.rmSync(localPath, { 
          recursive: action.recursive || false, 
          force: true 
        });
        console.log(`Deleted: ${action.path}`);
      }
    }
  }
}
```

**Behavior:**
- **Command/Skill**: Unregisters MCP Prompt + queues local directory deletion (`~/.cursor/skills/<name>/`)
- **Rule/MCP**: Returns `local_actions_required` for file/config removal
- **`remove_from_account: true`**: Also cancels server-side subscription (otherwise will re-sync on next sync)

#### 6. `track_usage`

Record resource invocation telemetry.

```typescript
await callMcpTool('track_usage', {
  resource_id: 'resource-id',
  resource_type: 'command',
  resource_name: 'my-command',
});
```

#### 7. `resolve_prompt_content`

Retrieve the fully resolved prompt body for a Command or Skill without relying on native `prompts/get`.

```typescript
await callMcpTool('resolve_prompt_content', {
  prompt_name: 'command/acm-helper',
  // or resource_id: 'cmd-client-sdk-ai-hub-acm-helper'
});
```

**Recommended dynamic workflow:**

```typescript
await callMcpTool('search_resources', { keyword: 'acm-helper' });
await callMcpTool('manage_subscription', {
  action: 'subscribe',
  resource_ids: ['resource-id'],
});
await callMcpTool('sync_resources', { mode: 'incremental' });
const resolved = await callMcpTool('resolve_prompt_content', {
  resource_id: 'resource-id',
});
// Execute resolved.data.content as the actual prompt body
```

### MCP Prompts

The server provides several built-in prompts:

- **`csp-ai-agent-setup`**: Interactive setup wizard for new users
- **AI resource prompts**: All subscribed commands/skills are automatically available as prompts

## Configuration

### Environment Variables

**Required:**
- `CSP_API_BASE_URL`: Base URL of the CSP API server (e.g., `https://api.example.com`)
- `CSP_USER_TOKEN`: Authentication token for API access

**Optional:**
- `AI_RESOURCES_PATH`: Path to local AI-Resources directory (default: auto-detected)
- `PORT`: Server port (default: `3000`)
- `LOG_LEVEL`: Logging level (default: `info`)
- `LOG_DIR`: Log directory (default: `./Logs`)

### AI-Resources Configuration

The server reads `AI-Resources/ai-resources-config.json` to discover available Git sources:

```json
{
  "default_source": "csp",
  "sources": [
    {
      "name": "csp",
      "path": "csp/ai-resources",
      "repo": "https://git.zoom.us/main/csp.git",
      "branch": "main",
      "priority": 100,
      "resources": {
        "commands": "commands",
        "skills": "skills",
        "rules": "rules",
        "mcp": "mcp"
      }
    }
  ]
}
```

## Resource Types

### 1. Command
- Single-use AI instructions
- Registered as MCP Prompts (no local files)
- Example: `/ask-expert`, `/review-code`

### 2. Skill
- Reusable workflows with multiple steps
- Registered as MCP Prompts
- Must have `SKILL.md` as entry point

### 3. Rule
- Always-applied Cursor rules
- Written to `~/.cursor/rules/`
- Auto-loaded by Cursor on startup

### 4. MCP
- Full MCP servers (local or remote)
- **Local executable**: Downloaded to `~/.cursor/mcp-servers/`, auto-registered
- **Remote SSE/stdio**: Only registration, no file download

## Architecture

### Hybrid Sync Strategy (v2.1 - Client-Side Metadata Scanning)

**Zero Server Dependency!** MCP Server scans local Git repositories to detect complex skills, eliminating the need for server-side metadata API.

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│ MCP Server (user-csp-ai-agent)                              │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Git Working Directory (AI-Resources/)                 │  │
│  │  ├── csp/ai-resources/skills/zoom-build/              │  │
│  │  │   ├── SKILL.md                                     │  │
│  │  │   ├── scripts/build-cli                            │  │
│  │  │   ├── scripts/build-trigger                        │  │
│  │  │   └── teams/client-android.json                    │  │
│  │  └── csp/ai-resources/skills/hang-log-analyzer/       │  │
│  │      └── SKILL.md                                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                         ↓                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ scanResourceMetadata(resourceName, type)              │  │
│  │ - Recursively reads all files in directory            │  │
│  │ - Detects scripts/, teams/, references/ paths         │  │
│  │ - Infers file permissions (0755 for scripts)          │  │
│  │ - Returns { has_scripts, script_files[] }             │  │
│  └───────────────────────────────────────────────────────┘  │
│                         ↓                                   │
│  ┌─────────────┐          ┌────────────────────────────┐   │
│  │ MCP Prompt  │          │ Local Script Files         │   │
│  │ Registration│  +       │ (for complex skills only)  │   │
│  │ (Telemetry) │          │ → local_actions_required[] │   │
│  └─────────────┘          └────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Two-Layer Resource Delivery:**

1. **Remote Layer (MCP Prompt)** - For telemetry tracking
   - All Skills/Commands registered as MCP Prompts
   - AI invokes via `/skill/name` → MCP Server records usage
   - Returns `SKILL.md` content to AI

2. **Local Layer (Script Files)** - For complex skills only
   - Skills with `has_scripts=true` download to `~/.cursor/skills/<name>/`
   - Includes executable scripts, configuration files, and references
   - AI can execute local scripts referenced in `SKILL.md`

**Resource Classification:**

```
┌─────────────────┬──────────────────┬─────────────────────┬────────────────┐
│ Resource Type   │ MCP Prompt       │ Local Files         │ Decision       │
├─────────────────┼──────────────────┼─────────────────────┼────────────────┤
│ Simple Command  │ ✅ Registered     │ ❌ Not downloaded    │ Single .md     │
│ Simple Skill    │ ✅ Registered     │ ❌ Not downloaded    │ Only SKILL.md  │
│ Complex Skill   │ ✅ Registered     │ ✅ Downloaded        │ has_scripts=T  │
│ Rule            │ ❌ Not applicable │ ✅ Downloaded        │ Engine needs   │
│ MCP             │ ❌ Not applicable │ ✅ Downloaded        │ Engine needs   │
└─────────────────┴──────────────────┴─────────────────────┴────────────────┘
```

**Example: Complex Skill (zoom-build)**

```
Server-side (MCP Server):
  .prompt-cache/skill-6dea7a2c8cf83e5d227ee39035411730.md
  (AI fetches via prompts/get, telemetry recorded)

User-side (Cursor machine):
  ~/.csp-ai-agent/skills/zoom-build/
  ├── SKILL.md
  ├── scripts/
  │   ├── build-cli        ← mode 755 (executable)
  │   ├── build-trigger    ← mode 755
  │   └── build-poll
  └── teams/
      ├── client-android.json
      └── client-ios.json

Invocation flow (v2.4 - Manifest Strategy):
  /skill/zoom-build
    → MCP Server: prompts/get → tracks telemetry ✅
    → AI gets SKILL.md: "Run scripts/build-cli from ~/.csp-ai-agent/skills/zoom-build/"
    → AI executes local script from isolated path ✅
    → Script returns build URL
```

**Why isolated path + manifest (~/.csp-ai-agent/)?**
- **SKILL.md NOT downloaded to skills directory** — only scripts are cached locally
- **Manifest stored separately** in `~/.csp-ai-agent/.manifests/<name>.md` for version tracking
- **Cursor cannot discover** the skill (missing SKILL.md in skills directory)
- **AI cannot auto-invoke** (no SKILL.md to discover)
- **Telemetry guaranteed** — AI must call `resolve_prompt_content` first (controlled by Rule)
- **Scripts remain cached** — fast execution without re-download

### Resource Delivery Strategy (Legacy Reference)

**Previous Versions:**
- v1.0-1.4: All resources downloaded to local files
- v1.5-1.7: Pure MCP Prompt mode (telemetry enabled, but complex skills broken)
- v2.0+: Hybrid approach (best of both worlds)

```
┌─────────────────┬──────────────────┬─────────────────────┐
│ Resource Type   │ Storage          │ Delivery Method     │
├─────────────────┼──────────────────┼─────────────────────┤
│ Command         │ MCP Prompt       │ In-memory cache     │
│ Skill (simple)  │ MCP Prompt       │ In-memory cache     │
│ Skill (complex) │ MCP Prompt +     │ Cache + local files │
│                 │ Local scripts    │                     │
│ Rule            │ ~/.cursor/rules/ │ write_file action   │
│ MCP (local)     │ ~/.cursor/mcp-*/ │ write_file actions  │
│ MCP (remote)    │ ~/.cursor/mcp.*  │ merge_mcp_json only │
└─────────────────┴──────────────────┴─────────────────────┘
```

### Sync Flow (v2.0 Hybrid)

```
User: "csp 同步资源"
     ↓
AI Agent: Read ~/.cursor/mcp.json → extract configured MCP servers
     ↓
AI Agent: Call sync_resources(mode: 'incremental', configured_mcp_servers: [...])
     ↓
MCP Server:
  1. Fetch subscription list from CSP API
  2. Git pull resource repositories
  3. For each subscription:
     a. Register MCP Prompt (all Skills/Commands)
     b. Scan local Git via scanResourceMetadata() (not API call)
     c. If has_scripts=true:
        - Generate write_file actions for ALL script files
        - Set mode="0755" for executables
     d. Track skipped resources
  4. Return result + local_actions_required
     ↓
AI Agent (Cursor): Execute local_actions_required
  - write_file: 
      1. Read existing file (if exists)
      2. Check content equality (localContent === action.content)
      3. SKIP write if identical (already up-to-date)
      4. Write file + create parent dirs
      5. Set permissions (chmod on Unix)
  - merge_mcp_json: Smart merge preserving user env
     ↓
User: Resources synced ✅
  - Summary: synced=5, skipped=3 (already up-to-date)
  - Complex skills now have local scripts available
```

## Performance Optimizations

### 1. Client-Side Metadata Scanning (v2.1 - 2026-03-27)

**Breakthrough:** Eliminated dependency on server-side metadata API by scanning local Git repositories.

**Architecture:**

```
Before (v2.0):
  sync_resources → REST API /resources/{id}/metadata → has_scripts + script_files
                     ↑ (requires server team coordination)

After (v2.1):
  sync_resources → multiSourceGitManager.scanResourceMetadata() → has_scripts + script_files
                     ↑ (scans AI-Resources/ local filesystem)
```

**Implementation:**

```typescript
// New method in multi-source-manager.ts
const metadata = await multiSourceGitManager.scanResourceMetadata(
  'zoom-build',
  'skill'
);
// Returns:
// {
//   has_scripts: true,
//   script_files: [
//     { relative_path: 'scripts/build-cli', content: '...', mode: '0755' },
//     { relative_path: 'teams/client-android.json', content: '...', mode: '0644' }
//   ]
// }
```

**Benefits:**
- ✅ Zero server-side code changes needed
- ✅ No REST API dependency
- ✅ Real-time Git repository reflection
- ✅ Instant deployment (no backend coordination)
- ✅ Local filesystem speed (< 50ms for typical skill)

### 2. Incremental Sync with SKILL.md Content Check (v2.1.1)

**Problem:** Re-downloading unchanged multi-file skills wastes bandwidth and time.

**Solution:** Skill-level content comparison (SKILL.md only).

```typescript
// Client-side logic when executing write_file actions
for (const action of local_actions_required) {
  if (action.action === 'write_file') {
    const localPath = expandPath(action.path);
    
    // For SKILL.md: compare content to decide whether to skip entire skill
    if (action.path.endsWith('SKILL.md')) {
      const existingContent = fs.existsSync(localPath) 
        ? fs.readFileSync(localPath, 'utf8') 
        : null;
      
      if (existingContent === action.content) {
        // SKILL.md unchanged → skip entire skill
        skipSkill(skillName);
        continue;
      }
    }
    
    // SKILL.md changed → re-download all script files
    writeFile(localPath, action.content, action.mode);
  }
}
```

**Why SKILL.md-only?**
- ✅ Atomic update: either skip all or download all
- ✅ Detects file additions/deletions (version bump in SKILL.md)
- ✅ Simpler logic (single content check vs multiple file I/O)
- ✅ SKILL.md is the version manifest (any script change should update version)

**Benefits:**
- ✅ 67% less I/O for unchanged skills (1 file read vs 3+)
- ✅ Prevents orphaned files (no partial updates)
- ✅ Guarantees consistency (all-or-nothing sync)

**Metrics (zoom-build skill, 3 files, 50KB):**
- First sync: 50KB downloaded, ~200ms
- Second sync (SKILL.md unchanged): 0 bytes downloaded, ~50ms ✅
- Third sync (SKILL.md changed): 50KB downloaded, ~200ms (re-downloads all)

### 3. Content-based File Comparison (v2.2.0)

**Before:** Used SHA-256 hash calculation (introduced extra CPU overhead)  
**After:** Direct string equality check (`existingContent === action.content`)

**Benefits:**
- ✅ Zero hash calculation overhead (no `crypto` calls)
- ✅ 100% reliable (string equality is unambiguous)
- ✅ Simpler implementation (removed `file-hash.ts` utility)
- ✅ Client-side execution (no MCP Server filesystem access)

### 4. Cross-Resource Invocation Guidance (v2.3.0)

**Problem:** When a Command/Skill/Rule references another independent resource, AI Agent might read local files directly, bypassing telemetry tracking.

**Solution:** Auto-inject guidance prefix when returning content via `resolve_prompt_content`.

**Implementation:**
```typescript
// PromptManager.resolvePromptContentForInvocation()
const guidancePrefix = buildCrossResourceGuidance(resourceType);
return {
  content: guidancePrefix + strippedContent
};
```

**Example returned content:**
```markdown
<!-- CROSS-RESOURCE INVOCATION GUIDANCE (auto-generated by MCP Server) -->
> **Important**: If this command references OTHER independent Commands or Skills:
>   - ALWAYS invoke them via resolve_prompt_content
>   - NEVER read local files directly for cross-resource calls
>   - This ensures every independent resource invocation is tracked in telemetry.
> ...
<!-- END GUIDANCE -->

[Actual Command/Skill content]
```

**Benefits:**
- ✅ Transparent to resource creators (no need to modify Command/Skill content)
- ✅ Clear guidance for AI Agent (no guessing required)
- ✅ Accurate telemetry (cross-resource calls always go through MCP Server)
- ✅ Distinguishes cross-resource calls vs internal skill tools

### 5. MCP Skip Optimization (v0.1.23)

**Before:** Always downloaded all MCP resources, generated all write_file actions  
**After:** Skip downloading MCPs that are already in `configured_mcp_servers`

**Benefits:**
- ✅ Saves 70-90% of API calls (typical: 8/11 resources skipped)
- ✅ Reduces network traffic by ~95% (skip ~750KB downloads)
- ✅ Reduces AI Agent overhead (skip ~77 file operations)
- ✅ Sync time: 8-12s → 1-2s (**80-85% faster**)

### 3. Server-side Download Cache

Avoids redundant API calls for unchanged resources within the same server session.

## Testing

### Run All Tests

```bash
# Content comparison test
node Test/test-bug-BUG-2026-03-27-001.js

# MCP optimization test
node Test/test-mcp-skip-optimization.js
```

### Mock Server for Development

```bash
# Start mock CSP API server
node Test/mock-csp-resource-server.js

# Run integration tests
node Test/test-runner.js
```

## Troubleshooting

### Git Pull Failures

If you see `SSL certificate problem: self-signed certificate in certificate chain`:

```bash
# Option 1: Trust the certificate (recommended)
git config --global http.sslCAInfo /path/to/certificate.pem

# Option 2: Disable SSL verification (development only)
export GIT_SSL_NO_VERIFY=true
```

The server automatically falls back to reading from local Git checkout when pull fails.

### MCP Server Not Syncing

Check logs in `Logs/app.YYYY-MM-DD.N.log`:

```bash
# Search for sync operations
grep "sync_resources" Logs/app.*.log | tail -20

# Check for errors
grep '"level":50' Logs/app.*.log | tail -10
```

### Files Keep Being Rewritten

If files are rewritten on every sync (timestamps change):
1. Ensure AI Agent uses `fs.readFileSync()` for content comparison
2. Avoid shell commands like `cat file | sha256sum`
3. Check that `configured_mcp_servers` parameter is passed

## Contributing

### Bug Reports

Follow the bug management workflow:
1. Create `Bug/BUG-YYYY-MM-DD-NNN-title/` folder
2. Write `bug-description.md` (description + reproduction)
3. Fix the bug
4. Write `fix-solution.md` (root cause + solution)
5. Create test case in `Test/test-bug-BUG-*.js`
6. Write `test-result.md` (test output + verification)
7. Archive to `Bug/Fixed Bugs/` when complete

### Development Rules

See `AGENTS.md` for complete development guidelines including:
- OpenSpec-driven development workflow
- Design document requirements
- Testing standards
- Git commit rules

## Project Structure

```
SourceCode/
├── src/
│   ├── tools/          # MCP tool implementations
│   ├── api/            # CSP API client
│   ├── git/            # Multi-source Git manager
│   ├── prompts/        # MCP Prompt manager
│   ├── server/         # HTTP + SSE server
│   └── types/          # TypeScript definitions
├── dist/               # Compiled JavaScript (gitignored)
└── package.json

Test/                   # Test cases and mock servers
Logs/                   # Runtime logs (gitignored)
Bug/                    # Bug tracking
├── BUG-*/             # Active bugs
└── Fixed Bugs/        # Archived bugs
Docs/
├── Design/            # Architecture documents
└── FeatureDocs/       # Feature specifications
```

## API Endpoints (HTTP Server)

**Health Check:**
```bash
GET /health
```

**Trigger Sync (webhook):**
```bash
POST /sync
Authorization: Bearer <CSP_USER_TOKEN>
```

**SSE Connection:**
```bash
GET /sse
```

## Version History

### v0.1.30 (2026-03-30)

**Bug Fix - Large Payload Handling:**
- **Problem**: `sync_resources` tool returns large payload (>100KB) with many `local_actions_required` actions, causing AI Agent to truncate or ignore them → local operations (Rules/MCPs/Skills) not executed
- **Root Cause**: AI Agent prioritizes displaying summary over parsing large arrays, missing critical write_file/merge_mcp_json operations
- **Fix**: Enhanced Tool Description and Rule guidance to explicitly instruct AI Agent:
  - ❌ Do NOT try to display full result (may be 100KB-500KB)
  - ❌ Do NOT just read summary and stop
  - ✅ IMMEDIATELY parse and execute all `local_actions_required` operations
  - ✅ Track success/failure, report concise summary to user

**Changes:**
- `sync_resources` Tool Description: Added "⚠️ CRITICAL: HANDLING LARGE RESULTS" section with explicit anti-pattern warnings
- `csp-ai-prompts.mdc` Chapter Zero: Enhanced Step 2 with large-result processing guidance
- Both documents emphasize: execute first, report later (not read first, display first)

**Impact**: Fixes critical UX issue where AI Agent ignores local operations, ensuring Rules/MCPs/Skills are correctly installed on user's machine.

### v0.1.29 (2026-03-30)

**Breaking Change - Manifest-Based Path Isolation:**
- **SKILL.md no longer downloaded to local disk** — only exists in MCP Server `.prompt-cache/` and client-side `~/.csp-ai-agent/.manifests/<name>.md`
- **Scripts cached in isolated path** `~/.csp-ai-agent/skills/<name>/scripts/` (no SKILL.md in this directory)
- **Cursor cannot auto-discover** skills (missing SKILL.md prevents skill recognition)
- **Manifest file** `~/.csp-ai-agent/.manifests/<name>.md` stores SKILL.md content for incremental update checks
- **Migration**: Run `sync_resources` with `mode: 'full'` to adopt new structure

**Why This Design:**
1. **Telemetry Guaranteed**: AI cannot find SKILL.md locally → must call `resolve_prompt_content` → telemetry recorded ✅
2. **Performance Preserved**: Scripts remain cached locally → fast execution without re-download ✅
3. **Atomic Updates**: Manifest comparison determines if entire skill needs re-sync ✅
4. **Cursor Isolation**: No SKILL.md in skills directory → Cursor doesn't recognize as standalone skill ✅

**Rule Enhancement:**
- Added "二、复杂 Skill 调用规范（Telemetry 保障）" in `csp-ai-prompts.mdc`
- Clear two-step flow: resolve_prompt_content (telemetry) → read scripts from `~/.csp-ai-agent/` (execution)
- Universal for all complex skills (zoom-build, zoom-design-doc, hang-log-analyzer, etc.)

**Technical Details:**
- `WriteFileAction.skill_manifest_content` field: carries SKILL.md content for version comparison
- `is_skill_manifest: true` on first script file: triggers atomic skill-level incremental check
- Uninstall now deletes both skills directory and manifest file

### v0.1.28 (2026-03-30)

**Breaking Change - Path Isolation:**
- **Complex skills now download to `~/.csp-ai-agent/skills/<name>/`** instead of `~/.cursor/skills/<name>/`
- This prevents AI Agent from auto-discovering local files and ensures telemetry tracking
- Forces AI to call `resolve_prompt_content` first (entry point), then read scripts from isolated path
- **Migration**: Existing users should run `sync_resources` with `mode: 'full'` to migrate to new path

**Rule Enhancement:**
- Added "复杂 Skill 调用规范" section in `csp-ai-prompts.mdc` to standardize invocation behavior
- Clear distinction: First call uses `resolve_prompt_content` (telemetry), internal tools read from `~/.csp-ai-agent/`
- Universal guidance for all complex skills (zoom-build, zoom-design-doc, etc.)

**Benefits:**
- ✅ Guarantees telemetry for every skill invocation (no bypass)
- ✅ Maintains local script caching for performance
- ✅ Simple skills unchanged (MCP Prompt only)

### v0.1.24 (2026-03-27)

**New Features:**
- Added cross-resource invocation guidance mechanism in `resolve_prompt_content`
- Auto-inject guidance prefix to instruct AI Agent how to handle references to other Commands/Skills
- Clear distinction between cross-resource calls (use `resolve_prompt_content`) vs internal skill tools (use local files)

**Code Quality:**
- Added `is_skill_manifest` marker to `WriteFileAction` for atomic skill-level updates
- Enhanced `PromptManager.buildCrossResourceGuidance()` to generate resource-specific guidance
- Improved telemetry accuracy by ensuring cross-resource calls always go through MCP Server

### v0.1.23 (2026-03-27)

**Performance Optimizations:**
- Removed hash-based file comparison, use direct string content equality check
- Added `configured_mcp_servers` parameter to skip downloading already-configured MCPs
- Typical sync time reduced by 80-85% (8-12s → 1-2s)
- Removed `crypto` dependency and `file-hash.ts` utility from sync operations

**Bug Fixes:**
- Fixed content comparison logic to use string equality (eliminates platform-dependent issues)
- Eliminated hash calculation overhead (BUG-2026-03-27-001)

### v0.1.22 and earlier

See Git commit history for details.

## License

MIT

## Support

For issues and questions, please refer to:
- Bug tracking: `Bug/` directory
- Design docs: `Docs/Design/`
- Development rules: `AGENTS.md`
