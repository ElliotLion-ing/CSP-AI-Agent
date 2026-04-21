# Spec: Multi-Directory Resource Paths

## ADDED Requirements

### Requirement: Array-format resource directory configuration
System SHALL accept `string | string[]` as the value type for each resource type entry in `ResourceSource.resources`.

#### Scenario: Single string value (backward compatibility)
- **WHEN** a source config specifies `"skills": "ai-resources/skills"`
- **THEN** the system loads resources from that single directory exactly as before

#### Scenario: Array value with multiple directories
- **WHEN** a source config specifies `"skills": ["ai-resources/skills", "ai-resources/extra-skills"]`
- **THEN** the system scans all listed directories and registers all found resources

#### Scenario: Array value with a non-existent directory
- **WHEN** one directory in the array does not exist on disk
- **THEN** the system skips that directory with a debug log and continues scanning remaining directories without error

### Requirement: Unique resource index key per physical path
System SHALL assign a unique key to every indexed resource using the format `type:name@source/subDir`.

#### Scenario: Same resource name in two directories of the same source
- **WHEN** two directories in the same source both contain a resource named `zoom-build`
- **THEN** both are registered in `resourceIndex` with distinct keys (`skills:zoom-build@csp/skills` and `skills:zoom-build@csp/extra-skills`)
- **THEN** both appear in search results

#### Scenario: No silent resource dropping
- **WHEN** multiple directories contain resources with identical names
- **THEN** all of them are visible in `getResourcesByType()` and `searchResourcesByName()` results

### Requirement: ResourceMetadata includes source subdirectory
System SHALL include a `dir` field in `ResourceMetadata` recording the subdirectory path relative to `source.path`.

#### Scenario: dir field populated on index
- **WHEN** a resource is indexed from subdirectory `ai-resources/skills`
- **THEN** its `ResourceMetadata.dir` equals `"ai-resources/skills"`

## ADDED Requirements

### Requirement: readResourceFiles supports per-source precise lookup
System SHALL support an optional `sourceName` parameter in `readResourceFiles()`.

#### Scenario: sourceName specified
- **WHEN** `readResourceFiles("zoom-build", "skill", false, "csp")` is called
- **THEN** only the `csp` source's configured directories are searched
- **THEN** other sources are not consulted

#### Scenario: sourceName omitted (backward compatibility)
- **WHEN** `readResourceFiles("zoom-build", "skill")` is called without sourceName
- **THEN** all sources are searched in priority order, returning on first match (existing behavior preserved)
