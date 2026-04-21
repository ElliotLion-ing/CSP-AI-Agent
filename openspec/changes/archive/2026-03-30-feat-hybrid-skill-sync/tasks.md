# Implementation Tasks: Hybrid Skill Sync (Revised)

**Change ID:** feat-hybrid-skill-sync  
**Created:** 2026-03-27  
**Revised:** 2026-03-27 (adjusted for client-first implementation)

---

## Implementation Strategy

**Key Insight:** This feature requires **server-side API changes** (new metadata fields + endpoint) which are outside the scope of this MCP Server codebase. 

**Revised Approach:**
1. **Phase 2 First (Client-side):** Implement MCP Server enhancements with backward-compatible fallback
2. **Phase 1 Parallel (Server-side):** Coordinate with CSP server team for API changes
3. **Integration:** Once server API is ready, client automatically leverages new fields

---

## Task Checklist

### Phase 2: MCP Server Client-Side Enhancement (This Codebase)
- [ ] 2.1 Update type definitions in `types/tools.ts`
  - [ ] Add `mode` field to `WriteFileAction` (for file permissions)
  - [ ] Add `encoding` field to `WriteFileAction` (for base64 support)
  - [ ] Add `skipped` to `SyncResourcesResult.summary`
  - [ ] Add `skipped_resources` array to `SyncResourcesResult`
- [ ] 2.2 Create utility module `utils/file-hash.ts`
  - [ ] Implement `calculateFileHash(content: string): string` using SHA256
  - [ ] Implement `compareLocalFileHash(path: string, expectedHash: string): Promise<boolean>`
  - [ ] Export utilities with proper error handling
- [ ] 2.3 Create utility module `utils/file-permissions.ts`
  - [ ] Implement `setExecutablePermissions(path: string, mode: string): Promise<void>`
  - [ ] Add platform detection (skip on Windows)
  - [ ] Handle permission errors gracefully
- [ ] 2.4 Enhance `api/client.ts`
  - [ ] Add `getResourceMetadata(id: string, userToken?: string): Promise<ResourceMetadata>` method
  - [ ] Implement fallback to `downloadResource()` when metadata endpoint not available
  - [ ] Add TypeScript interface for `ResourceMetadata` (with `has_scripts`, `script_files`)
- [ ] 2.5 Enhance `sync-resources.ts`
  - [ ] Import new utilities (`file-hash`, `file-permissions`)
  - [ ] For each Skill/Command subscription:
    - [ ] Call `apiClient.getResourceMetadata(sub.id)` (with fallback)
    - [ ] Check if `has_scripts === true` (fallback: detect `scripts/` in `files` array)
    - [ ] If true: generate `write_file` actions for all `script_files`
      - [ ] Set `mode: "0755"` for executable files
      - [ ] Set `encoding: "utf8"` by default
    - [ ] If false: continue existing Prompt-only registration
  - [ ] Implement incremental check logic:
    - [ ] For each `write_file` action, calculate local file hash
    - [ ] Compare with remote `content_hash` or inline content hash
    - [ ] Skip action if hashes match
    - [ ] Track skipped count
  - [ ] Add `skipped_resources` to return value
  - [ ] Update logging and telemetry
- [ ] 2.6 Enhance `uninstall-resource.ts`
  - [ ] For Command/Skill resources:
    - [ ] Check if local skill directory exists (`~/.cursor/skills/${name}/`)
    - [ ] If exists: add `delete_file` action with `recursive: true`
    - [ ] Log directory removal in `removed_resources`
  - [ ] Keep existing MCP Prompt unregister logic
  - [ ] Support `remove_from_account` parameter for subscription removal

### Phase 1: Server-Side API Enhancement (CSP Server Team - Parallel Track)
- [ ] 1.1 Database schema migration
  - [ ] Add `has_scripts BOOLEAN DEFAULT false` column
  - [ ] Add `script_files JSONB` column
  - [ ] Add `content_hash VARCHAR(64)` column
  - [ ] Run migration on staging environment
- [ ] 1.2 Resource scanner enhancement
  - [ ] Detect `scripts/`, `teams/`, `references/` directories
  - [ ] Collect all non-markdown files with metadata
  - [ ] Calculate file permissions from `fs.stat().mode`
  - [ ] Populate `script_files` array
- [ ] 1.3 Create `GET /api/v1/resources/:id/metadata` endpoint
  - [ ] Return full metadata including `script_files`
  - [ ] Include `content_hash` for incremental sync
  - [ ] Add authentication middleware
  - [ ] Add rate limiting (100 req/min per user)
- [ ] 1.4 Update `GET /csp/api/resources/download/:id` response
  - [ ] Include `has_scripts` field
  - [ ] Include `content_hash` field
  - [ ] Maintain backward compatibility

### Phase 3: Testing
- [ ] 3.1 Create `Test/test-hybrid-skill-sync.js`
- [ ] 3.2 **Test Scenario 1:** Simple skill (no scripts)
  - [ ] Mock API returns `has_scripts: false`
  - [ ] Call `sync_resources`
  - [ ] Verify no local files written
  - [ ] Verify MCP Prompt registered
- [ ] 3.3 **Test Scenario 2:** Complex skill (first sync)
  - [ ] Mock API returns `has_scripts: true` with 5 script files
  - [ ] Ensure local `~/.cursor/skills/zoom-build/` does NOT exist
  - [ ] Call `sync_resources`
  - [ ] Verify all 5 files written to local
  - [ ] Verify `scripts/build-cli` has mode 755 (Unix only)
- [ ] 3.4 **Test Scenario 3:** Incremental sync (no changes)
  - [ ] Local files already exist with matching hashes
  - [ ] Call `sync_resources` with `mode: incremental`
  - [ ] Verify `skipped: 1` in result
  - [ ] Verify no file writes occurred
- [ ] 3.5 **Test Scenario 4:** Incremental sync (partial update)
  - [ ] Local files exist, but remote `build-cli` has new hash
  - [ ] Call `sync_resources`
  - [ ] Verify only `build-cli` re-downloaded
  - [ ] Verify other 4 files untouched
- [ ] 3.6 **Test Scenario 5:** Uninstall complex skill
  - [ ] Ensure local directory exists
  - [ ] Call `uninstall_resource(name: zoom-build, remove_from_account: true)`
  - [ ] Verify `local_actions_required` contains `delete_file` with `recursive: true`
  - [ ] Execute actions and verify directory deleted
- [ ] 3.7 **Test Scenario 6:** Telemetry verification
  - [ ] Call `/skill/zoom-build`
  - [ ] Verify MCP Server logged `prompts/get` event
  - [ ] Verify telemetry sent to server API
- [ ] 3.8 Run full test suite and verify 100% pass rate
- [ ] 3.9 Check `Logs/` for errors
- [ ] 3.10 Create `test-report.md` with detailed results

### Phase 4: Documentation Updates
- [ ] 4.1 Update `Docs/Design/CSP-AI-Agent-API-Mapping.md`
  - [ ] Document new `GET /api/v1/resources/:id/metadata` endpoint
  - [ ] Update `sync_resources` tool description (add incremental logic)
  - [ ] Update `uninstall_resource` tool description (add local cleanup)
- [ ] 4.2 Update `Docs/Design/CSP-AI-Agent-Core-Design.md`
  - [ ] Add "Hybrid Sync Strategy" section in "Resource Synchronization" module
  - [ ] Document incremental update flow with hash comparison
  - [ ] Add architecture diagram showing dual layers (Prompt + Local Files)
- [ ] 4.3 Update `Docs/Design/CSP-AI-Agent-Complete-Design.md`
  - [ ] Update "Resource Management" section with hybrid approach
  - [ ] Document file permission handling

### Phase 5: Archive and Release
- [ ] 5.1 Run `openspec archive feat-hybrid-skill-sync --yes`
- [ ] 5.2 Run `openspec validate --strict`
- [ ] 5.3 Copy feature design doc to `Docs/FeatureDocs/FEAT-2026-03-27-002/`
- [ ] 5.4 Move test report to `Test/Test Reports/FEAT-2026-03-27-002/`
- [ ] 5.5 Delete `NewFeature/FEAT-2026-03-27-002-hybrid-skill-sync/` folder
- [ ] 5.6 Update `README.md` if applicable
- [ ] 5.7 Await user confirmation for npm publish
- [ ] 5.8 Await user confirmation for git commit

---

## Server-Client Coordination Plan

**Backward Compatibility Guarantee:**

The client implementation will gracefully degrade when server API is not ready:

```typescript
// Fallback logic in apiClient.getResourceMetadata()
async getResourceMetadata(id: string, userToken?: string): Promise<ResourceMetadata> {
  try {
    // Try new metadata endpoint first
    return await this.get(`/api/v1/resources/${id}/metadata`, this.authConfig(userToken));
  } catch (error) {
    // Fallback: use existing download endpoint and infer has_scripts
    logger.warn({ resourceId: id }, 'Metadata endpoint not available, falling back to download');
    const downloadResult = await this.downloadResource(id, userToken);
    
    // Heuristic: if files array contains scripts/* or teams/*, infer has_scripts=true
    const hasScripts = downloadResult.files.some(f => 
      f.path.startsWith('scripts/') || 
      f.path.startsWith('teams/') || 
      f.path.startsWith('references/')
    );
    
    return {
      id: downloadResult.resource_id,
      name: downloadResult.name,
      type: downloadResult.type,
      version: downloadResult.version,
      content: downloadResult.files.find(f => f.path === 'SKILL.md')?.content ?? '',
      has_scripts: hasScripts,
      script_files: hasScripts ? downloadResult.files.map(f => ({
        relative_path: f.path,
        content: f.content,
        mode: f.path.includes('scripts/') && !f.path.endsWith('.json') ? '0755' : '0644',
        encoding: 'utf8' as const
      })) : undefined,
      content_hash: downloadResult.hash
    };
  }
}
```

This ensures the MCP Server can be deployed and tested **before** the server API is updated.

---

## Dependencies

- Node.js `crypto` module (SHA256)
- Node.js `fs/promises` (chmod, stat)
- Existing `apiClient`, `promptManager` modules
- CSP API server (parallel development track)

---

## Risk Mitigation

| Risk | Client-Side Mitigation |
|------|----------------------|
| Server API not ready | Fallback to `downloadResource()` with heuristic detection |
| Network failure during download | Existing retry logic in `apiClient` |
| Partial file write failure | Atomic writes (use temp file + rename) |
| Hash collision | SHA256 probability < 10^-60 (acceptable) |
| Windows permission issues | Detect platform, skip chmod on win32 |

---

**Status:** Ready to implement Phase 2 (client-side) independently.
