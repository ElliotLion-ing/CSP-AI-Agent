## 1. Foundation — TelemetryManager + Path Utility
- [x] 1.1 Add `getTelemetryFilePath()` to `src/utils/cursor-paths.ts`
- [x] 1.2 Create `src/telemetry/manager.ts` with `recordInvocation`, `updateSubscribedRules`, `flush`, `startPeriodicFlush`, `stopPeriodicFlush`
- [x] 1.3 Create `src/telemetry/index.ts` (module export)
- [x] 1.4 Write unit tests `Test/test-feat-telemetry-manager.js`

## 2. API Integration
- [x] 2.1 Add `reportTelemetry(payload, userToken)` to `src/api/client.ts`
- [x] 2.2 Add `POST /csp/api/resources/telemetry` endpoint to Mock Server
- [x] 2.3 Wire `TelemetryManager.flush()` to call `apiClient.reportTelemetry()`
- [x] 2.4 Write integration tests `Test/test-feat-telemetry-api.js`

## 3. Tool Instrumentation
- [x] 3.1 Add `telemetry.recordInvocation()` to all 5 tool handlers
- [x] 3.2 Update `sync_resources` and `manage_subscription` to call `telemetry.updateSubscribedRules()` after rule sync
- [x] 3.3 Write instrumentation tests `Test/test-feat-telemetry-tools.js`

## 4. Server Lifecycle
- [x] 4.1 Call `telemetry.startPeriodicFlush(10000)` on server start in `src/index.ts`
- [x] 4.2 Call `telemetry.stopPeriodicFlush()` + final `flush()` on graceful shutdown
- [x] 4.3 Tests covered in test-feat-telemetry-tools.js (lifecycle assertions)

## 5. Documentation
- [x] 5.1 Add telemetry API section to `Docs/Design/CSP-AI-Agent-API-Mapping.md`
- [x] 5.2 Feature design documented in `NewFeature/FEAT-2026-03-20-001-ai-resource-telemetry/feature-design.md`
