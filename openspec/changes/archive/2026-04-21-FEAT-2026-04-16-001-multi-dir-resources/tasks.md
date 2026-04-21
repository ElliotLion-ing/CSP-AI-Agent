# Tasks: Multi-Directory Resource Paths Support

## Phase 1 — Type Definitions
- [ ] Update `ResourceSource.resources` value type to `string | string[]` in `types/resources.ts`
- [ ] Add `dir: string` field to `ResourceMetadata` interface
- [ ] Add `normalizePaths()` utility inline in `loader.ts` and `multi-source-manager.ts`

## Phase 2 — Resource Loader
- [ ] Update `scanSource()` in `resources/loader.ts` to iterate `normalizePaths(subDirs)`
- [ ] Pass `subDir` into `scanResourceType()` for unique key generation
- [ ] Change `resourceIndex` key format to `type:name@source/subDir`
- [ ] Update `indexResource()` to include `dir` in `ResourceMetadata`
- [ ] Verify `getResourcesByType()` and `searchResourcesByName()` return full results (no dedup needed)
- [ ] Update `getResourceById()` docs/callers for new key format

## Phase 3 — Multi-Source Git Manager
- [ ] Update internal `SourceConfig.resources` interface to `string | string[]`
- [ ] Add `normalizePaths()` locally in `multi-source-manager.ts`
- [ ] Update `readResourceFiles()` signature: add optional `sourceName?: string` param
- [ ] Implement per-source multi-dir traversal when `sourceName` is provided
- [ ] Keep existing first-match-across-sources behavior when `sourceName` is omitted

## Phase 4 — Config Example & Validation
- [ ] Verify `ai-resources-config.json` single-string format still loads correctly (backward compat)
- [ ] Add array-format comment/example to `ai-resources-config.json`

## Phase 5 — Testing
- [ ] Create `Test/test-feat-multi-dir-resources.js`
- [ ] Cover: single string, single-element array, two-dir array both exist, second dir missing, same-name resource in two dirs, `readResourceFiles` with/without sourceName
- [ ] Run tests and verify Pass Rate 100%
