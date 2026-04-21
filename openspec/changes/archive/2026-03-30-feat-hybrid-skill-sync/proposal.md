# Proposal: Hybrid Skill Synchronization with Local Script Support

**Change ID:** feat-hybrid-skill-sync  
**Author:** AI Agent  
**Date:** 2026-03-27  
**Status:** Draft

---

## Why

### Problem Statement

The current pure-remote MCP Prompt mechanism cannot support complex skills that depend on local scripts and configuration files. Skills like `zoom-build` require:
1. **Executable scripts** (`build-cli`, `build-trigger`) that AI must invoke via Shell
2. **Configuration files** (`teams/*.json`) that scripts read at runtime
3. **Reference documents** that provide additional context

When AI calls `/skill/zoom-build`, it receives only `SKILL.md` content via `resolve_prompt_content`. The skill instructs AI to run `~/.cursor/skills/zoom-build/scripts/build-cli`, but this directory doesn't exist locally, causing execution failure.

### Business Impact

**Currently Blocked:**
- `zoom-build` skill - Automated build triggering
- `zoom-jira` skill - Complex Jira workflows with local templates
- Any future skill requiring file I/O, subprocess execution, or configuration management

**Telemetry Requirement:**
- Cannot abandon remote Prompt invocation (needed for usage tracking)
- Pure local execution loses telemetry data collection capability

---

## What

### Proposed Solution: Hybrid Approach

**Two-Layer Architecture:**

1. **Remote Layer (MCP Prompt)** - Retained for all skills
   - Registers all skills/commands as MCP Prompts
   - AI invokes via `/skill/name` → MCP Server tracks telemetry
   - Returns `SKILL.md` content to AI

2. **Local Layer (File Download)** - Added for complex skills only
   - `sync_resources` detects skills with `has_scripts=true`
   - Downloads all script files to `~/.cursor/skills/<name>/`
   - Sets executable permissions (mode 755) for scripts
   - Enables AI to invoke local scripts referenced in `SKILL.md`

**Incremental Sync:**
- Avoids re-downloading unchanged files using SHA256 hash comparison
- Only downloads new/modified files
- Reduces bandwidth and sync time

**Uninstall Enhancement:**
- `uninstall_resource` removes local script directories
- Supports optional subscription removal via `remove_from_account` flag

### Key Changes

| Component | Change | Type |
|-----------|--------|------|
| Server API | Add `/api/v1/resources/:id/metadata` endpoint | New |
| Resource Metadata | Add `has_scripts`, `script_files`, `content_hash` fields | Schema Change |
| MCP Tool: `sync_resources` | Add incremental file download logic | Enhancement |
| MCP Tool: `uninstall_resource` | Add recursive directory deletion | Enhancement |
| AI Experience | Complex skills now fully functional | Fix |

---

## What Changes

### API Changes

**New Server-Side Endpoint:**
- `GET /api/v1/resources/:id/metadata` - Returns full resource metadata with script files

**Enhanced Response Fields:**
- `has_scripts` (boolean) - Added to resource metadata
- `script_files` (array) - List of script files with content, mode, and encoding
- `content_hash` (string) - SHA256 hash for incremental sync

### MCP Tool Changes

**sync_resources (Enhanced):**
- Added incremental file hash comparison (skips unchanged files)
- Added `summary.skipped` counter (resources with no local changes)
- Added `skipped_resources` array with skip reasons
- Enhanced `local_actions_required` with `mode` and `encoding` fields for script files

**uninstall_resource (Enhanced):**
- Added local script directory deletion for Command/Skill resources
- Returns `local_actions_required` with `delete_file` action (recursive)

### New Utility Modules

- `utils/file-hash.ts` - SHA256 content hashing for incremental sync
- `utils/file-permissions.ts` - Cross-platform file permission management

### Data Model Changes

**WriteFileAction (Enhanced):**
```typescript
interface WriteFileAction {
  action: 'write_file';
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';  // New field
  mode?: string;                  // New field (e.g. "0755")
}
```

**SyncResourcesResult (Enhanced):**
```typescript
interface SyncResourcesResult {
  summary: {
    skipped: number;  // New field
    // ... existing fields
  };
  skipped_resources?: Array<{  // New field
    name: string;
    reason: string;
  }>;
  // ... existing fields
}
```

---

## Impact

### User Experience

**Before (Broken):**
```
User: /skill/zoom-build trigger dev build
AI: Reads SKILL.md → Tries to run ~/.cursor/skills/zoom-build/scripts/build-cli
Shell: Command not found ❌
```

**After (Fixed):**
```
User: 小助手，订阅 zoom-build
AI: sync_resources → Downloads 5 files to local
User: /skill/zoom-build trigger dev build
AI: Reads SKILL.md → Runs ~/.cursor/skills/zoom-build/scripts/build-cli
Shell: Build triggered successfully ✅
Telemetry: Recorded prompt invocation on server ✅
```

### System Impact

**Positive:**
- ✅ Unlocks complex skill development
- ✅ Maintains telemetry pipeline
- ✅ Reduces redundant downloads (incremental sync)
- ✅ Enables proper uninstall cleanup

**Considerations:**
- Disk usage: ~1-5MB per complex skill (acceptable)
- Network: First sync downloads full bundle (mitigated by incremental updates)
- Security: Scripts run with user permissions (future: add sandboxing)

### Breaking Changes

**None.** This is purely additive:
- Simple skills (no scripts) behave identically to before
- Existing subscriptions continue working
- New capability enabled for complex skills

---

## Alternatives Considered

### Alternative 1: Pure Remote Execution (Status Quo)
- **Pros:** No local files, simple architecture
- **Cons:** Cannot support script-dependent skills ❌
- **Verdict:** Rejected - blocks critical use cases

### Alternative 2: Pure Local Download (Original Design)
- **Pros:** Full script access, no server dependency
- **Cons:** Loses telemetry data collection ❌
- **Verdict:** Rejected - telemetry is business-critical

### Alternative 3: Hybrid with Server-Side Script Execution
- **Pros:** No local files, telemetry intact
- **Cons:** Requires server-side runtime environment (Node.js, Python), security complexity, latency
- **Verdict:** Rejected - too complex and introduces new attack surface

### Alternative 4: **Hybrid with Local Scripts + Remote Prompt (Chosen)**
- **Pros:** Supports all skill types, retains telemetry, minimal complexity
- **Cons:** Requires local disk space (~5MB per complex skill)
- **Verdict:** ✅ Accepted - balanced solution

---

## Success Criteria

1. **Functional:**
   - [ ] `zoom-build` skill successfully triggers builds via local scripts
   - [ ] Simple skills (e.g., `hang-log-analyzer`) work without local files
   - [ ] Incremental sync skips unchanged files (verified by hash comparison)
   - [ ] `uninstall_resource` removes all local files for complex skills

2. **Performance:**
   - [ ] First sync for 5-file skill completes in < 10 seconds
   - [ ] Incremental sync (no changes) completes in < 2 seconds
   - [ ] Hash calculation overhead < 5% of total sync time

3. **Telemetry:**
   - [ ] Every skill invocation logged to server (includes user, skill name, timestamp)
   - [ ] No degradation in telemetry capture rate (remains 100%)

4. **Security:**
   - [ ] Executable scripts downloaded with mode 0755
   - [ ] File paths validated (no path traversal via `../`)
   - [ ] Content hash verified before execution (future enhancement)

---

## Dependencies

- Server-side resource scanner (needs enhancement to detect `scripts/` directories)
- MCP Server `api-client` module (needs `getResourceMetadata()` method)
- MCP Server `filesystem-manager` (needs hash calculation utility)

---

## Open Questions

1. **Binary files support:** Should we support binary executables (e.g., compiled Go binaries)?
   - **Proposal:** Phase 2 - Use base64 encoding in `script_files.content`
   
2. **Local file modification detection:** What if user manually edits `~/.cursor/skills/zoom-build/SKILL.md`?
   - **Proposal:** Hash mismatch will trigger re-download (overwrites local changes)
   - **Future:** Add `--preserve-local` flag to skip hash check

3. **Script version conflicts:** What if two skills depend on different versions of the same script?
   - **Proposal:** Each skill gets isolated directory (no conflicts)

---

**Next Steps:**
1. User approval of this proposal
2. Create OpenSpec spec deltas in `specs/resource-sync/spec.md`
3. Create `tasks.md` with implementation checklist
4. Run `openspec validate feat-hybrid-skill-sync --strict`
