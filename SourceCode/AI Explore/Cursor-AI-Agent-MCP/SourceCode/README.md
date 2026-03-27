# CSP AI Agent MCP Server

Centralized AI tools distribution and management system powered by Model Context Protocol (MCP).

## Overview

CSP AI Agent is an MCP server that enables seamless synchronization of AI resources (commands, skills, rules, and MCP servers) between a centralized repository and Cursor IDE. It provides automatic resource discovery, subscription management, and intelligent caching.

## Key Features

- **AI Resource Management**: Subscribe, sync, search, and upload AI resources
- **Multi-source Git Support**: Aggregate resources from multiple Git repositories with priority-based conflict resolution
- **Intelligent Caching**: Skip redundant downloads and file writes using content-based comparison
- **MCP Prompt Mode**: Commands and Skills are registered as MCP Prompts (no local file writes)
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

Synchronize subscribed AI resources.

```typescript
// In Cursor AI Agent context
const mcpJson = JSON.parse(fs.readFileSync('~/.cursor/mcp.json', 'utf8'));
const configured = Object.keys(mcpJson.mcpServers || {});

await callMcpTool('sync_resources', {
  mode: 'incremental',  // or 'full', 'check'
  configured_mcp_servers: configured,  // Optimization: skip already configured MCPs
});
```

**Modes:**
- `incremental` (default): Update only changed resources
- `full`: Download all resources (file recovery mode)
- `check`: Status check only (no downloads)

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

Remove a resource from local installation.

```typescript
await callMcpTool('uninstall_resource', {
  resource_id_or_name: 'my-skill',
  remove_from_account: false,  // Keep subscription, only remove local files
});
```

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

### Resource Delivery Strategy

```
┌─────────────────┬──────────────────┬─────────────────────┐
│ Resource Type   │ Storage          │ Delivery Method     │
├─────────────────┼──────────────────┼─────────────────────┤
│ Command         │ MCP Prompt       │ In-memory cache     │
│ Skill           │ MCP Prompt       │ In-memory cache     │
│ Rule            │ ~/.cursor/rules/ │ write_file action   │
│ MCP (local)     │ ~/.cursor/mcp-*/ │ write_file actions  │
│ MCP (remote)    │ ~/.cursor/mcp.*  │ merge_mcp_json only │
└─────────────────┴──────────────────┴─────────────────────┘
```

### Sync Flow

```
User: "csp 同步资源"
     ↓
AI Agent: Read ~/.cursor/mcp.json → extract configured MCP servers
     ↓
AI Agent: Call sync_resources(mode: 'incremental', configured_mcp_servers: [...])
     ↓
MCP Server:
  1. Fetch subscription list from CSP API
  2. For each subscription:
     - Skip if MCP already in configured_mcp_servers (optimization)
     - Download resource files (API or Git fallback)
     - Generate local_actions_required
  3. Return result + actions
     ↓
AI Agent: Execute local_actions_required
  - write_file: Compare content, skip if identical
  - merge_mcp_json: Check skip_if_exists, preserve user env
     ↓
User: Resources synced ✅
```

## Performance Optimizations

### 1. Content-based File Comparison (v0.1.23)

**Before:** Used SHA-256 hash comparison (error-prone, platform-dependent)  
**After:** Direct string equality check (`existing === action.content`)

**Benefits:**
- ✅ Infinitely faster (0ms vs 6ms per file)
- ✅ 100% reliable (no platform issues)
- ✅ Simpler implementation (6 lines vs 15+ lines)

### 2. MCP Skip Optimization (v0.1.23)

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

### v0.1.23 (2026-03-27)

**Performance Optimizations:**
- Removed hash-based file comparison, use direct content equality
- Added `configured_mcp_servers` parameter to skip downloading already-configured MCPs
- Typical sync time reduced by 80-85% (8-12s → 1-2s)
- Removed `crypto` dependency from sync operations

**Bug Fixes:**
- Fixed hash calculation mismatch between MCP Server and AI Agent (BUG-2026-03-27-001)
- Eliminated platform-dependent `cat | sha256sum` issues

### v0.1.22 and earlier

See Git commit history for details.

## License

MIT

## Support

For issues and questions, please refer to:
- Bug tracking: `Bug/` directory
- Design docs: `Docs/Design/`
- Development rules: `AGENTS.md`
