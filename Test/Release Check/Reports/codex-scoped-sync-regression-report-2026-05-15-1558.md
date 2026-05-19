# Codex Scoped Sync Regression Report - 2026-05-15 15:58

## Scope

- Target fix: default/baseline resource restore should execute scoped `sync_resources` inside `manage_subscription subscribe/batch_subscribe`, even when the server creates `0` new subscription rows.
- MCP server: `https://zct-dev.zoomdev.us/csp-agent/mcp`
- Resource under test: `zoom-code-review` (`632400b351c85024b0385ab3e7fa838d`)
- Result: PASS

## Steps And Evidence

| Step | Result | Evidence |
| --- | --- | --- |
| CSP-first subscription check | PASS | First action was `manage_subscription(action=list)`, returning 14 baseline subscriptions |
| Baseline prompt resolve | PASS | `resolve_prompt_content(resource_id=zoom-code-review)` returned `success=true`, `prompt_name=skill/zoom-code-review`, `usage_tracked=true` |
| Unsubscribe default resource | PASS | `manage_subscription(unsubscribe)` returned success and reported local override: `1 default/baseline subscription was still returned by the server` |
| Local delete actions executed | PASS | Removed `~/.csp-ai-agent/codex/skills/zoom-code-review` and `~/.csp-ai-agent/.manifests/zoom-code-review.md`; verification returned `skill_removed` and `manifest_removed` |
| Hidden after unsubscribe | PASS | `manage_subscription(list)` returned 13 subscriptions and message `1 locally unsubscribed default subscription is hidden` |
| Restore via batch_subscribe | PASS | `manage_subscription(batch_subscribe)` returned `subscriptions=[]`, `Server created 0 new subscriptions`, and message `scoped auto-sync was still executed` |
| Scoped sync behavior | PASS | Restore response included `Auto-sync: 1 synced, 0 cached, 0 failed`; `sync_details` contained exactly `zoom-code-review` with action `synced` |
| Immediate resolve without manual sync | PASS | Immediately after `batch_subscribe`, without calling `sync_resources`, `resolve_prompt_content(resource_id=zoom-code-review)` returned `success=true`, `prompt_name=skill/zoom-code-review`, `usage_tracked=true` |
| Local files restored | PASS | Restored `security-security-baseline.mdc` and `zoom-code-review.md` manifest from CSP download; verification returned `rule_restored` and `manifest_restored` |
| Final subscription state | PASS | Final `manage_subscription(list)` returned 14 subscriptions including `zoom-code-review` |
| Worktree state before report | PASS | `git status --short` was clean before writing this report |

## Key Regression Assertion

The deployed package fixed the previous issue. Re-subscribing a default/baseline skill now triggers scoped sync inside `manage_subscription`, despite the subscribe API returning zero newly-created rows.

No separate `sync_resources` tool call was made between `batch_subscribe` and the immediate `resolve_prompt_content` validation.

## Token/Scope Risk Check

This test did not trigger full sync. The restore call only processed the requested `resource_ids`:

```json
{
  "sync_details": [
    {
      "id": "632400b351c85024b0385ab3e7fa838d",
      "name": "zoom-code-review",
      "action": "synced"
    }
  ]
}
```

Conclusion: the fix does not cause every CSP feature invocation to run full sync. It only affects explicit subscribe/batch_subscribe flows and keeps sync scoped to requested resources.

## Final Verdict

PASS. The scoped auto-sync restore path works in the deployed MCP package.
