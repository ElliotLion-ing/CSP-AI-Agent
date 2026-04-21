# multi-dir-resources Specification

## Purpose
TBD - created by archiving change FEAT-2026-04-16-001-multi-dir-resources. Update Purpose after archive.
## Requirements
### Requirement: readResourceFiles supports per-source precise lookup
System SHALL support an optional `sourceName` parameter in `readResourceFiles()`.

#### Scenario: sourceName specified
- **WHEN** `readResourceFiles("zoom-build", "skill", false, "csp")` is called
- **THEN** only the `csp` source's configured directories are searched
- **THEN** other sources are not consulted

#### Scenario: sourceName omitted (backward compatibility)
- **WHEN** `readResourceFiles("zoom-build", "skill")` is called without sourceName
- **THEN** all sources are searched in priority order, returning on first match (existing behavior preserved)

