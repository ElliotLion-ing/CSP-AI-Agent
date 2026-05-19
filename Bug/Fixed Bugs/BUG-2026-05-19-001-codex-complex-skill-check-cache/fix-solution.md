# Fix Solution

## Root Cause

`sync_resources` check mode treated command/skill resources as cached when their MCP Prompt was registered. For skills, it attempted local script checks via `multiSourceGitManager.scanResourceMetadata()`.

That path is insufficient for `zoom-build` because the complex skill content is API-backed in the same way as incremental sync. Git metadata can be empty even though API download contains scripts, so no `check_file` actions were generated.

## Fix

Updated `SourceCode/src/tools/sync-resources.ts`:

- Added a shared `loadPromptResourceFiles()` helper that reads API download files first and falls back to Git files.
- Added shared helpers for prompt primary file selection and local script detection.
- Added `queueComplexSkillCheckActions()` to emit `check_file` actions for each script and for the active client manifest path.
- Changed check mode for registered skills to use the API/Git source-file path instead of Git-only metadata.
- Reused the shared helper in incremental sync to avoid divergent complex-skill detection rules.

## Files Changed

- `SourceCode/src/tools/sync-resources.ts`
- `Test/test-bug-BUG-2026-05-19-001.js`
- `Bug/BUG-2026-05-19-001-codex-complex-skill-check-cache/*`
