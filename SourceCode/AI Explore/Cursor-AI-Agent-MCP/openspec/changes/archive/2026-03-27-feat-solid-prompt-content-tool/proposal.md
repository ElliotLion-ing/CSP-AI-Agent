# Change: Add Solid Prompt Content Tool for Dynamic Resources

## Why

The current MCP Prompt design works only when the client completes the standard
`prompts/list -> prompts/get` flow. That is sufficient for prompts that were
already registered before the user invoked them from Cursor's slash menu.

However, in the dynamic subscription flow:

1. the AI searches resources
2. subscribes to a Command or Skill
3. runs `sync_resources`
4. needs to immediately execute the newly subscribed prompt content

In this same conversation turn, the Cursor / agent call path does not
reliably issue a follow-up `prompts/get` request. The result is that the AI
often sees only prompt metadata and description, not the actual prompt body
cached in `.prompt-cache/`.

This makes dynamically subscribed prompts unstable in the exact workflow where
they are most valuable.

## What Changes

### Core principle

Do not rely on Cursor to always fetch prompt bodies through MCP Prompt
protocol primitives during a dynamic workflow. Keep native MCP Prompts for
slash usage, but add a stable MCP Tool path that returns the resolved prompt
content directly.

### New MCP Tool

Add a new tool:

- `resolve_prompt_content`

This tool accepts either:

- `prompt_name`
- or `resource_id`

and returns the prompt's fully resolved body, description, resource identity,
content source, and a flag indicating whether usage telemetry was recorded.

### Shared resolution core

Refactor prompt-content resolution into a shared internal method so that:

- `prompts/get` uses the shared resolution path
- `resolve_prompt_content` uses the same shared resolution path

This avoids drift between native prompt usage and tool fallback behavior.

### Telemetry extension

Telemetry currently assumes Command/Skill usage is recorded when the server
handles `prompts/get`.

With this change, telemetry must also support the tool-based path:

- when `resolve_prompt_content` successfully resolves a Command or Skill
- the server records a usage event directly

This prevents the system from depending on the model to execute a
`track_usage` instruction before reading the returned content.

## Impact

- Affected specs:
  - `mcp-server`
  - `telemetry`
- Affected code:
  - `SourceCode/src/prompts/manager.ts`
  - `SourceCode/src/tools/index.ts`
  - `SourceCode/src/tools/registry.ts`
  - `SourceCode/src/tools/resolve-prompt-content.ts` (new)
  - tests for prompt resolution and telemetry
