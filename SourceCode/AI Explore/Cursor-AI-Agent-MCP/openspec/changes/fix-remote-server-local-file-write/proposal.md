# Change: Fix Remote Server Writing to Local Filesystem

## Why

When the MCP server is deployed remotely (e.g. `https://zct-dev.zoomdev.us/csp-agent/sse`),
`sync_resources` calls `fs.writeFile()` to write Rule and MCP files.  Those writes land on the
**remote server's filesystem** (`~/.cursor/rules/`, `~/.cursor/mcp-servers/`, `~/.cursor/mcp.json`),
not on the **user's local machine**.  Users never see the synced resources in their local Cursor
installation.

The same problem exists in `uninstall_resource`: it calls `fs.unlink()` / `fs.rm()` on the remote
server, which has no effect on the user's local files.

## What Changes

### Core principle

The MCP server must not write any file to its own filesystem on behalf of the user.
Instead it returns the file contents and merge instructions as structured data,
and the **AI Agent (running locally in Cursor) performs the actual writes**.

### Rule resources

Instead of writing to `~/.cursor/rules/<name>`, `sync_resources` returns:
```json
{
  "local_actions_required": [
    {
      "action": "write_file",
      "path": "~/.cursor/rules/<name>",
      "content": "<file content>"
    }
  ]
}
```
The AI reads this, creates/overwrites the local file, and confirms to the user.

### Local-executable MCP resources (Format A — has `"command"` field)

Instead of writing to `~/.cursor/mcp-servers/<name>/` and updating `mcp.json`,
`sync_resources` returns:
```json
{
  "local_actions_required": [
    {
      "action": "write_file",
      "path": "~/.cursor/mcp-servers/<name>/<file>",
      "content": "<file content>"
    },
    {
      "action": "merge_mcp_json",
      "mcp_json_path": "~/.cursor/mcp.json",
      "server_name": "<name>",
      "entry": { "command": "...", "args": [...], "env": {...} }
    }
  ]
}
```

### Remote-URL MCP resources (Format B — no `"command"` field)

These have no files to write locally.  `sync_resources` returns a single merge action:
```json
{
  "local_actions_required": [
    {
      "action": "merge_mcp_json",
      "mcp_json_path": "~/.cursor/mcp.json",
      "server_name": "<name>",
      "entry": { "url": "...", "transport": "sse" }
    }
  ]
}
```

### Uninstall

`uninstall_resource` returns delete instructions instead of performing `fs.unlink()`:
```json
{
  "local_actions_required": [
    {
      "action": "delete_file",
      "path": "~/.cursor/rules/<name>"
    },
    {
      "action": "remove_mcp_json_entry",
      "mcp_json_path": "~/.cursor/mcp.json",
      "server_name": "<name>"
    }
  ]
}
```

## Impact

- Affected specs: `sync-resources`
- Affected code:
  - `SourceCode/src/tools/sync-resources.ts`
  - `SourceCode/src/tools/uninstall-resource.ts`
  - `SourceCode/src/types/tools.ts` (new `LocalAction` types)
