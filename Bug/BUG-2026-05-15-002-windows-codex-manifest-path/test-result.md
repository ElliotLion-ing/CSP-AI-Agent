# Test Result

## Summary

- **Date**: 2026-05-15
- **Result**: PASS for targeted regression and TypeScript type check
- **Bug**: BUG-2026-05-15-002 Windows Codex Manifest Path

## Commands

### Targeted Bug Regression

```powershell
node Test\test-bug-BUG-2026-05-15-002.js
```

Result:

```text
Test Results: 34 passed, 0 failed
```

### TypeScript Check

```powershell
npx tsc --noEmit
```

Result:

```text
Exit code: 0
```

### Build Check

```powershell
npm run build
```

Result:

```text
Exit code: 1
'rm' is not recognized as an internal or external command,
operable program or batch file.
```

The build command is blocked by the existing Windows-incompatible `clean` script (`rm -rf dist`) before TypeScript compilation starts. This is a separate Windows build-script issue and not caused by the manifest-path fix. Direct TypeScript validation passed through `npx tsc --noEmit`.

## Log Check

No new `Logs/` file was available for this targeted regression run. The validation is based on script exit codes and command output.

## Coverage

- Verified Codex complex-skill local actions include explicit `manifest_path`.
- Verified Codex manifests resolve to `~/.csp-ai-agent/codex/.manifests`.
- Verified Cursor keeps the legacy `~/.csp-ai-agent/.manifests` path.
- Verified setup prompt requires parent directory creation for both `path` and `manifest_path`.
- Verified TypeScript accepts the adapter interface and action type changes.
