# Codex Release Check Report - 2026-05-15 Windows

## Run Metadata

- Checklist: `Test/Release Check/release-check-checklist.md` v1.4.0
- Run date: 2026-05-15
- Environment: Codex desktop on Windows
- MCP endpoint: `https://zct-dev.zoomdev.us/csp-agent/mcp`
- Report type: Current-session validation only
- Final status: FAIL

This run executed the checklist items that could be validated directly in the current Codex session without manually restarting Codex or performing destructive subscription cleanup. The main failure found in this run is that `sync_resources` returned required local actions for Codex, but those actions were not materialized under the expected Codex local cache paths during this session.

## Preflight

| Check | Result | Evidence |
| --- | --- | --- |
| CSP subscription priority check | PASS | First tool action was `manage_subscription(action=list)` |
| Baseline subscription snapshot captured | PASS | `manage_subscription(action=list)` returned 14 subscriptions |
| Codex MCP config exists | PASS | `~/.codex/config.toml` contains `[mcp_servers.csp-ai-agent]` |
| Codex MCP endpoint uses `/mcp` | PASS | Config URL is `https://zct-dev.zoomdev.us/csp-agent/mcp` |
| Authorization header exists | PASS | `http_headers.Authorization` is present in `~/.codex/config.toml` |

## Executed Cases

| Case | Result | Evidence |
| --- | --- | --- |
| C0-1: Codex MCP config validation | PASS | Codex config contains active `csp-ai-agent` MCP server with `/mcp` endpoint |
| C0-2 Phase 1: Policy injection returned by server | PASS | `sync_resources(mode=incremental, scope=global)` returned `merge_toml` for `developer_instructions` and `restart_required=true` |
| C0-2 Phase 1: Policy file materialized locally | FAIL | `~/.csp-ai-agent/codex/csp-routing-policy.md` was missing after sync |
| C0-2 Phase 1: `developer_instructions` written to Codex config | FAIL | `~/.codex/config.toml` did not contain `developer_instructions` or `csp-routing-policy` |
| C1: Full incremental sync API path | PASS | `sync_resources(mode=incremental, scope=global)` returned `success=true`, `health_score=100`, `total=14`, `synced=14`, `failed=0` |
| C2: Scoped single-resource sync API path | PASS | `sync_resources(mode=incremental, resource_ids=["632400b351c85024b0385ab3e7fa838d"])` returned `total=1`, `synced=1` |
| C2: Scoped single-resource local action materialization | FAIL | `~/.csp-ai-agent/codex/skills/zoom-code-review` was still missing after scoped sync |
| C7: Telemetry profile echo | PASS | `query_usage_stats(resource_type=skill, agent_profile=codex)` returned `agent_profile="codex"` |
| C10 Step 10-2: Main skill prompt contains mandatory lazy-load block | PASS | `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c")` returned a `[MANDATORY]` block with `tool="resolve_prompt_content"` and `resource_path="reference.md"` |
| C10 Step 10-3: `reference.md` lazy load works | PASS | `resolve_prompt_content(resource_id="009157d8ed498e93c0dbdbdbd47ae40c", resource_path="reference.md")` returned non-empty C++ review guidance |

## Not Run In This Session

| Case | Result | Reason |
| --- | --- | --- |
| C0-2 Phase 2 | NOT RUN | Requires manual Codex restart boundary |
| C0-3 | NOT RUN | Depends on successful local materialization of Codex skill files |
| C3/C5/C9 full local cleanup and restore loop | NOT RUN | Requires executing external local write/delete actions and then restoring baseline |
| C4/C6 end-to-end subscribe/unsubscribe route checks | NOT RUN | Skipped because current session already exposed a blocking local-action materialization issue |
| C8 local-vs-remote file consistency | NOT RUN | Blocked by missing Codex local skill files |
| C10 Step 10-4 MR review end-to-end | NOT RUN | Lazy-load chain passed, but full review flow was not continued after earlier blocking failure |

## Key Evidence

### Subscription Snapshot

The initial `manage_subscription(action=list)` returned these 14 subscriptions:

`csp-ai-prompts`, `zoom-testcase`, `zoom-code-review`, `zoom-build`, `acm`, `security-security-baseline`, `zoom-design-doc`, `winzr-cpp-expert`, `zoom-doc`, `ZMDB-diagnose-db-hang`, `zoom-client-worktree`, `hang-log-analyzer`, `generate-testcase`, `zoom-jira`.

### Full Sync Result

- `mode`: `incremental`
- `health_score`: `100`
- `summary.total`: `14`
- `summary.synced`: `14`
- `summary.failed`: `0`
- Returned local actions included:
  - `write_file` to `~/.csp-ai-agent/codex/skills/zoom-code-review/.cursor/rules/security-security-baseline.mdc`
  - `merge_toml` to `~/.codex/config.toml` for key `developer_instructions`
  - `restart_required: true`

### Failure Evidence

- `~/.csp-ai-agent/codex/csp-routing-policy.md` was missing.
- `~/.csp-ai-agent/codex/skills/zoom-code-review` was missing.
- `~/.codex/config.toml` showed no `developer_instructions` entry after sync.

This means the server-side sync summary alone is not sufficient to mark the Codex-side checklist as passed; the required local actions must also be applied and verified on disk.

## Verdict

This Windows run is a failure for release-check purposes.

The blocking issue is not the MCP server response itself. The blocking issue is that the Codex-side required local actions from `sync_resources` were not observed as applied on disk in this session, so the policy injection and Codex skill materialization checks did not pass. The next rerun should start by explicitly applying the returned local actions, verifying `developer_instructions` and `~/.csp-ai-agent/codex/...` paths, then restarting Codex and continuing from Case C0-2 Phase 2.
