## Implementation Tasks

### 1. Types
- [ ] 1.1 Add `LocalAction` union type to `SourceCode/src/types/tools.ts`
- [ ] 1.2 Add `local_actions_required` optional field to `SyncResourcesResult` and uninstall result types

### 2. sync_resources refactor
- [ ] 2.1 Replace Rule `fs.writeFile` path with a `write_file` LocalAction in the result
- [ ] 2.2 Replace Remote-URL MCP `fs.writeFile`/mcp.json merge path with a `merge_mcp_json` LocalAction
- [ ] 2.3 Replace Local-executable MCP file write + `registerMcpServer` with `write_file` + `merge_mcp_json` LocalActions
- [ ] 2.4 Remove all `fs.mkdir` / `fs.writeFile` / `fs.rename` calls that touch the user's Cursor directory (keep only `.prompt-cache` writes which are intentionally server-side)
- [ ] 2.5 Keep incremental-mode check logic: detect if resource is already present by checking if we already emitted a LocalAction for it (or via version caching)

### 3. uninstall_resource refactor
- [ ] 3.1 Replace `fs.unlink` / `fs.rm` rule deletion with a `delete_file` LocalAction
- [ ] 3.2 Replace mcp.json entry removal with a `remove_mcp_json_entry` LocalAction
- [ ] 3.3 Return `local_actions_required` array to the AI

### 4. Tool description updates
- [ ] 4.1 Update `sync_resources` tool description to state that the AI must execute returned `local_actions_required` steps
- [ ] 4.2 Update `uninstall_resource` tool description similarly

### 5. Compile & verify
- [ ] 5.1 `npm run build` — zero errors
