## Implementation Tasks

### 1. Prompt resolution core
- [ ] 1.1 Extract shared prompt-resolution logic from `PromptManager` for cache hit, cache miss regeneration, and raw fallback paths
- [ ] 1.2 Support resolving by both `prompt_name` and `resource_id`
- [ ] 1.3 Ensure `prompts/get` reuses the shared resolution path without changing existing slash behavior

### 2. New MCP Tool
- [ ] 2.1 Add `resolve_prompt_content` tool definition and input schema
- [ ] 2.2 Implement `SourceCode/src/tools/resolve-prompt-content.ts`
- [ ] 2.3 Register the new tool in the tool registry and expose it in `tools/list`
- [ ] 2.4 Return structured JSON including `prompt_name`, `resource_id`, `description`, `content`, `content_source`, and `usage_tracked`

### 3. Telemetry integration
- [ ] 3.1 Extend telemetry recording so `resolve_prompt_content` records Command/Skill usage directly on successful resolution
- [ ] 3.2 Avoid obvious double-counting between `prompts/get` and tool-based resolution paths
- [ ] 3.3 Add logs that distinguish prompt-protocol usage from tool-based usage

### 4. Tests and verification
- [ ] 4.1 Add tests for resolving content by `prompt_name`
- [ ] 4.2 Add tests for resolving content by `resource_id`
- [ ] 4.3 Add tests for cache miss fallback regeneration
- [ ] 4.4 Add tests for not-found behavior
- [ ] 4.5 Add tests for telemetry recording on tool-based resolution
- [ ] 4.6 Run `npm run build`
- [ ] 4.7 Run targeted tests for prompt manager and the new tool
