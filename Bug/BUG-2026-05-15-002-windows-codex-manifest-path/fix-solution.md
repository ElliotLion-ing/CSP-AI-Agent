# Fix Solution

## Changes

- Added `ClientAdapter.getManifestDir()` so Cursor and Codex resolve complex-skill manifests through the active client profile.
- Added Codex manifest path `~/.csp-ai-agent/codex/.manifests`.
- Added optional `manifest_path` to `WriteFileAction`.
- Updated `sync_resources` to emit `manifest_path` on complex-skill first-file actions.
- Updated setup prompt instructions to compare and write `action.manifest_path` when present, and to create parent directories for both `path` and `manifest_path`.
- Added regression assertions to ensure:
  - Codex uses `~/.csp-ai-agent/codex/.manifests`.
  - Cursor keeps `~/.csp-ai-agent/.manifests`.
  - Complex skill actions include explicit `manifest_path`.
  - Setup prompt mentions directory creation for `manifest_path`.

## Compatibility

Cursor behavior remains on the legacy isolated path:

`~/.csp-ai-agent/skills/<skill>/`
`~/.csp-ai-agent/.manifests/<skill>.md`

Codex behavior now consistently uses its profile-specific subtree:

`~/.csp-ai-agent/codex/skills/<skill>/`
`~/.csp-ai-agent/codex/.manifests/<skill>.md`

This avoids old Cursor manifests suppressing Codex file writes on Windows while preserving macOS and Cursor behavior.
