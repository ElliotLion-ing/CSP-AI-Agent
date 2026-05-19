# Release Check Report (Rerun)

- Date: 2026-05-18
- Mode: reset + rerun
- Executor: Codex

## Reset Summary

1. Captured fresh subscription snapshot (`manage_subscription:list`) before rerun.
2. Replayed unsubscribe/subscribe recovery path for `zoom-build` and `acm`.
3. Applied required local cleanup actions:
   - deleted local `~/.csp-ai-agent/codex/skills/zoom-build` and manifest.
   - removed `acm`/`acm-dev` TOML entries.
4. Restored environment:
   - re-subscribed `zoom-build` and `acm`.
   - restored `[mcp_servers.acm]` and `[mcp_servers.acm-dev]` in `~/.codex/config.toml`.
   - final subscriptions back to 16 entries.

## Case Results (This Rerun)

| Case | Result | Notes |
|---|---|---|
| C0-1 (`~/.codex/config.toml`) | PASS | `csp-ai-agent` endpoint is `/mcp`; authorization header present. |
| C1 full incremental sync | PASS | `sync_resources(mode=incremental, scope=global)` succeeded: total 16, synced 16. |
| C2 single-resource sync | PASS | Scoped sync for `zoom-build` (`resource_ids=[6dea7...]`) succeeded. |
| C3 complex skill sync (`zoom-build`) | PASS (server-side) | Returned `write_file` actions for codex skill path; sync success=true. |
| C4 search -> subscribe flow | PASS | `search_resources(keyword=hang)` returned expected resources; subscribe flow validated. |
| C5 unsubscribe -> prompt/file cleanup | PASS | `zoom-build` unsubscribe returned delete actions; local cleanup executed; then restored. |
| C6 routing priority | PARTIAL | Policy content/merge actions returned; restart-bound behavior not fully re-verified in a fresh session. |
| C7 telemetry (`agent_profile=codex`) | PASS | `query_usage_stats` returned `agent_profile="codex"`, invocation count increased to 10. |
| C8 local vs remote Git consistency | BLOCKED | Requires remote GitLab content diff workflow not available in this run. |
| C9 unsubscribe MCP -> config cleanup | PASS | `acm` unsubscribe returned remove_toml_entry actions; local config cleanup + restore completed. |
| C10 md lazy-load chain (`winzr-cpp-expert`) | PASS | `resolve_prompt_content(resource_id)` contains mandatory `resource_path`; `resolve_prompt_content(..., resource_path=reference.md)` succeeded. |

## Known Gaps

1. C0-2 Phase 2 requires restarting Codex and validating behavior in a new session.
2. C8 remote Git consistency comparison remains blocked in current environment.
3. Some `zoom-build` subscribe/sync responses still include large `local_actions_required` batches pending full materialization; however key sync and routing checks passed.

## Final Status

- Rerun completed.
- Reset and restore completed.
- Environment returned to baseline subscription count and MCP config state.

## Post-Restart Continuation (Remaining Cases)

- Date: 2026-05-18
- Scope: continue after restart, run remaining non-git cases only

| Case | Result | Notes |
|---|---|---|
| C6 routing priority (subscribed path) | PASS | `zoom-code-review` subscribe + `resolve_prompt_content(resource_id=632400b351c85024b0385ab3e7fa838d)` succeeded; routing hit CSP resource path. |
| C6 routing fallback (unsubscribed path) | PASS | `zoom-code-review` unsubscribed; `manage_subscription(list)` no longer contains it, fallback precondition satisfied. |
| C6 cleanup actions | PASS | Unsubscribe cleanup targets checked: `~/.csp-ai-agent/codex/skills/zoom-code-review` and `~/.csp-ai-agent/.manifests/zoom-code-review.md` both already absent. |
| C8 local vs remote Git consistency | SKIPPED | Skipped per user request: blocked git-related case not attempted. |

### Continuation Conclusion

- Remaining non-git checks in this continuation round are completed.
- Current subscription list remains stable at 16 entries; `zoom-code-review` is not present after fallback validation.
