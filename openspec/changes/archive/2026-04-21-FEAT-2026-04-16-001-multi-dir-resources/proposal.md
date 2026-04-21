# Proposal: Multi-Directory Resource Paths Support

**Change ID:** FEAT-2026-04-16-001-multi-dir-resources  
**Date:** 2026-04-16  
**Status:** proposed

## Why

`ai-resources-config.json` currently only allows a single directory string per resource type (`commands`, `skills`, `mcp`, `rules`). Teams need to organize resources across multiple subdirectories within the same source repository (e.g., legacy paths alongside new paths, or per-team subdirectories), but the only workaround today is adding a whole new `extended_sources` entry — which is verbose and creates artificial source boundaries.

## What Changes

Extend the `resources` field in each source config to accept either a `string` (existing behavior) or a `string[]` (new multi-directory support):

- **`types/resources.ts`**: Change `ResourceSource.resources` value type to `string | string[]`; add `dir` field to `ResourceMetadata`.
- **`resources/loader.ts`**: `scanSource()` iterates all dirs in the array; each physical path gets a unique `resourceIndex` key (`type:name@source/subDir`), ensuring full visibility with no silent dropping.
- **`git/multi-source-manager.ts`**: Mirror interface change; `readResourceFiles()` gains optional `sourceName` param for precise per-source lookup across multiple subdirs.
- **`ai-resources-config.json`**: No change to existing single-string format (backward compatible).

## Impact

- **Backward compatible**: existing single-string configs work unchanged.
- **No API/MCP Tool changes**: purely internal config + implementation.
- **`resourceIndex` key format change** (`type:name` → `type:name@source/subDir`): callers of `getResourceById()` must use the new key format.
- **Search results**: all entries from all dirs are returned — no silent deduplication.
