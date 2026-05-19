# Codex Release Check Report (Rerun-2)

- Date: 2026-05-19
- Timezone: Asia/Shanghai
- Scope: Part B (Codex) full checklist C1-C10
- Focus: C5 / C9 regression verification
- Checklist: `Test/Release Check/release-check-checklist.md`

## 1) Subscription Snapshot

- Start snapshot (`manage_subscription:list`): 18 visible subscriptions (`2 locally unsubscribed default subscriptions are hidden`)
- End snapshot: 18 visible subscriptions (same as start)

## 2) Case Summary (C1-C10)

| Case | Result | Evidence |
|---|---|---|
| C1 (full incremental sync) | PASS | `sync_resources(mode=incremental, scope=global)` success, `health_score=100`, summary total 18/synced 18 |
| C2 (single resource sync) | PASS | `sync_resources(resource_ids=[zoom-code-review])` success, total 1/synced 1 |
| C3 (complex skill sync) | PASS | `search_resources(zoom-build)` -> found `6dea...`; subscribe + scoped sync succeeded (total 1/synced 1) |
| C4 (search + subscribe flow) | PASS | `search_resources(keyword=hang)` returned resources; targeted subscribe (`zoom-jira`,`zoom-doc`) scoped sync succeeded |
| C5 (unsubscribe complex skill cleanup) | **FAIL** | `unsubscribe(zoom-build)` returned 2 `delete_file` actions, but local dir `~/.csp-ai-agent/codex/skills/zoom-build` still exists |
| C6 (CSP-first routing) | PASS | Before review flow, subscription list checked; `resolve_prompt_content(resource_id=zoom-code-review)` succeeded |
| C7 (usage telemetry increment) | PASS | `query_usage_stats` total_invocations 47 -> 50 after `resolve_prompt_content` calls; `winzr-cpp-expert` count 16 -> 19 |
| C8 (local/server consistency spot check) | PASS | `zoom-code-review` installed locally (`~/.csp-ai-agent/codex/skills/zoom-code-review` exists); `resolve_prompt_content` returns expected skill content |
| C9 (unsubscribe mcp cleanup) | **FAIL** | `unsubscribe(acm)` returned 2 `remove_toml_entry` actions, but `~/.codex/config.toml` still has `[mcp_servers.acm-dev]` and `[mcp_servers.acm]` |
| C10-1 (skill subscribed) | PASS | `winzr-cpp-expert` present in subscription list |
| C10-2 (mandatory lazy-load marker) | PASS | `resolve_prompt_content(winzr-cpp-expert)` contains `[MANDATORY]` + `resolve_prompt_content(..., resource_path=\"reference.md\")` instruction |
| C10-3 (lazy-load reference) | PASS | `resolve_prompt_content(resource_path=\"reference.md\")` succeeded with non-empty content |
| C10-4 (end-to-end chain) | PASS | CSP-first chain completed; `gitlab_get_merge_request` + `gitlab_get_merge_request_diffs` executable; sample diff evidence captured for voice-notes controls path |

## 3) Key Failure Details

### C5 Failure Detail

1. Unsubscribe call:
   - `manage_subscription(action=unsubscribe, resource_ids=[6dea7a2c8cf83e5d227ee39035411730])`
2. Returned local actions:
   - delete `~/.csp-ai-agent/codex/skills/zoom-build` (recursive)
   - delete `~/.csp-ai-agent/codex/.manifests/zoom-build.md`
3. Post-check:
   - `~/.csp-ai-agent/codex/skills/zoom-build` **still exists** (FAIL)
   - `~/.csp-ai-agent/codex/.manifests/zoom-build.md` not found
   - legacy manifest `~/.csp-ai-agent/.manifests/zoom-build.md` exists

### C9 Failure Detail

1. Unsubscribe call:
   - `manage_subscription(action=unsubscribe, resource_ids=[8346836580e75837a7183285c5872843])`
2. Returned local actions:
   - remove toml entry `acm-dev`
   - remove toml entry `acm`
3. Post-check:
   - `~/.codex/config.toml` still contains:
     - `[mcp_servers.acm-dev]`
     - `[mcp_servers.acm]`

## 4) Final Verdict

- Overall: **FAIL** (because C5 and C9 still fail)
- Blocking items before production gate:
  - C5 unsubscribe local cleanup not effectively applied
  - C9 unsubscribe config cleanup not effectively applied
