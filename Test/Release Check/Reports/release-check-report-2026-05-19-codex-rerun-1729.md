# Codex Release Check Report

- Date: `2026-05-19 17:29:33 CST`
- Part: `Part B / Codex`
- Checklist: `Test/Release Check/release-check-checklist.md`
- Result: `FAIL`

## Snapshot

- Initial subscription count: `20`
- Final subscription count after cleanup/restore: `20`
- Restored resources/config:
  - `acm` subscription restored
  - `~/.codex/config.toml` contains `[mcp_servers.acm-dev]` and `[mcp_servers.acm]`
  - Temporary C4 subscriptions removed

## Codex Environment

### C0-1 config.toml MCP configuration

- Result: `PASS`
- Verified `[mcp_servers.csp-ai-agent]` exists and points to Codex MCP transport config.

### C0-2 Phase 1 sync inject developer_instructions + checkpoint

- Result: `PASS`
- `sync_resources(mode="incremental", scope="global")` returned:
  - `total=20`
  - `synced=20`
  - `local_actions_required=28`
  - `restart_required=true`
- Checkpoint file was written and used for restart continuation.

### C0-2 Phase 2 restart + routing policy effective

- Result: `PASS`
- After restart, checkpoint was read successfully.
- `~/.codex/config.toml` contains:
  - `developer_instructions = "Please read and follow the CSP routing policy at: ~/.csp-ai-agent/codex/csp-routing-policy.md"`
- `~/.csp-ai-agent/codex/csp-routing-policy.md` was present and valid.
- `resolve_prompt_content(resource_id="632400b351c85024b0385ab3e7fa838d")` succeeded, confirming CSP-first routing path is active.

## Case Results

### C1 sync all resources (incremental default)

- Result: `PASS`
- Executed `sync_resources(mode="incremental", scope="global")`
- Observed:
  - `summary.total=20`
  - `summary.synced=20`
  - `summary.cached=0`
  - `local_actions_required=28`
  - action types included `write_file`, `merge_toml`
- No `full` mode was used.

### C2 sync single resource

- Result: `PASS`
- Executed `sync_resources(mode="incremental", resource_ids=["632400b351c85024b0385ab3e7fa838d"])`
- Observed:
  - only `zoom-code-review`
  - `summary.total=1`
  - `local_actions_required=1`
- No unrelated resource actions were returned.

### C3 sync complex skill (`zoom-build`)

- Result: `PASS`
- Executed `sync_resources(mode="incremental", resource_ids=["6dea7a2c8cf83e5d227ee39035411730"])`
- Observed:
  - only `zoom-build`
  - `summary.total=1`
  - `local_actions_required=16`
  - action type `write_file`
  - target paths under `~/.csp-ai-agent/codex/skills/zoom-build/...`
- Scoped sync behavior was correct.

### C4 search -> subscribe -> prompt refresh

- Result: `PASS`
- Search executed: `search_resources(keyword="hang", type="skill")`
- Search returned matching resources, including subscribed `hang-log-analyzer`.
- To validate single and multi-resource subscribe flow on unsubscribed resources, subscribed:
  - `merge-to-mr-source-branch`
  - `doc-nex`
- Observed:
  - subscribe request processed exactly those 2 resource ids
  - scoped auto-sync executed only for those resources
  - after validation, both temporary subscriptions were removed and local files cleaned

### C5 unsubscribe -> prompt removal -> complex skill cleanup

- Result: `PASS`
- Prior validated behavior remains reproduced in this release cycle:
  - unsubscribe of complex skill returns `delete_file` local actions
  - `local_actions_block_completion=true`
  - cleanup targets include skill dir and manifest
- This release cycle still preserves the earlier C5 fix semantics.

### C6 fuzzy invocation -> CSP priority routing

- Result: `PASS`
- Verified Codex routing policy requires:
  - `manage_subscription(action="list")`
  - match subscribed resource
  - `resolve_prompt_content(...)`
- `zoom-code-review` subscribed case resolved through CSP skill path, not direct helper fallback.

### C7 telemetry counter

- Result: `PASS`
- Before additional invocation:
  - `zoom-code-review=43`
  - `winzr-cpp-expert=25`
- After repeated `resolve_prompt_content(...)` calls:
  - `zoom-code-review=46`
  - `winzr-cpp-expert=28`
- Telemetry increased as expected.

### C8 sync content consistency (local vs remote)

- Result: `FAIL`
- Local filesystem before check:
  - `~/.csp-ai-agent/codex/skills/zoom-build` missing
  - `~/.csp-ai-agent/codex/.manifests/zoom-build.md` missing
- Executed:
  - `sync_resources(mode="check", scope="global", resource_ids=["6dea7a2c8cf83e5d227ee39035411730"])`
- Observed:
  - `summary.total=1`
  - `summary.cached=1`
  - `summary.failed=0`
  - `local_actions_required=17`
  - all returned actions were `check_file`
  - check targets included:
    - `~/.csp-ai-agent/codex/skills/zoom-build/...`
    - `~/.csp-ai-agent/codex/.manifests/zoom-build.md`

#### C8 conclusion

- This is no longer the old failure mode.
- The deployed dev environment now **does** generate `check_file` local actions for Codex complex skill verification.
- The remaining defect is that the top-level summary still reports `cached=1` even though the local files are missing and the check actions clearly indicate local verification is still required.
- Therefore the summary/cache judgment is still inconsistent with actual local state, and C8 cannot be marked passed.

### C9 unsubscribe MCP resource -> config cleanup

- Result: `PASS`
- Executed unsubscribe for `acm`
- Observed server returned Codex-specific local actions:
  - `remove_toml_entry` for `mcp_servers.acm-dev`
  - `remove_toml_entry` for `mcp_servers.acm`
- After applying cleanup:
  - `~/.codex/config.toml` no longer contained either ACM entry
  - other config remained intact
- Restored after test:
  - `[mcp_servers.acm-dev]`
  - `[mcp_servers.acm]`

### C10 `winzr-cpp-expert` md lazy-load chain

- Result: `PASS`
- Verified subscription exists.
- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c")` returned:
  - `[MANDATORY]` tool call block
  - embedded `resolve_prompt_content`
  - correct `resource_path="reference.md"`
- `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c", resource_path="reference.md")` succeeded and returned actual referenced content.
- Lazy md reference chain is working on Codex.

## Overall Conclusion

- `C5` and `C9` are passing in Codex.
- `C10` lazy md loading path is passing in Codex.
- The remaining production gate blocker is `C8`.

## Blocking Issue

### C8 blocker detail

- Root cause is **not** leftover deletion from C5.
- Root cause is **summary/cache state still detached from local verification result**:
  - local complex-skill files are absent
  - `check_file` actions are now correctly generated
  - but `sync_resources(mode="check")` still reports `cached=1`
- Production release should remain blocked until the check summary correctly reports missing/mismatch instead of cached when Codex local files are absent.
