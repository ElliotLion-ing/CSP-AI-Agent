# Change: AI Resource Usage Telemetry

## Why

After AI resources (Command/Skill/MCP/Rule) are delivered to users' local environments, the server can only track delivery count—not actual usage. We need to collect real usage data (invocation count per resource per user) to measure value and inform recommendations.

## What Changes

- Add `TelemetryManager` module to record local invocation events to `~/.cursor/ai-resource-telemetry.json`
- Add periodic flush (every 10s) that reports to `POST /csp/api/resources/telemetry`
- Integrate invocation recording into all 5 existing MCP tools
- Sync subscribed Rule list (Rules cannot be tracked for invocations—Cursor loads them directly into context with no hook event)
- Add `reportTelemetry()` to API client

## Impact

- Affected specs: telemetry (new)
- Affected code:
  - `SourceCode/src/telemetry/` (new)
  - `SourceCode/src/api/client.ts`
  - `SourceCode/src/utils/cursor-paths.ts`
  - `SourceCode/src/index.ts`
  - `SourceCode/src/tools/*.ts` (all 5 tools)
- Affected docs: `Docs/Design/CSP-AI-Agent-API-Mapping.md`
