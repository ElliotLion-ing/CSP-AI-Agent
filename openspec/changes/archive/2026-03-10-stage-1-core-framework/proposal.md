# Change: Stage 1 - Core Framework Setup

## Why

The CSP-AI-Agent MCP Server project requires a solid foundation before implementing business logic. This change establishes the core framework including:

- Project initialization (package.json, tsconfig.json)
- Basic project structure (SourceCode/src directories)
- Logging infrastructure (pino + automatic cleanup)
- Configuration management
- Development tooling (TypeScript, ESLint, testing)

Without this foundation, subsequent stages cannot proceed effectively.

## What Changes

### 1. Project Initialization
- Create `SourceCode/package.json` with dependencies (@modelcontextprotocol/sdk, axios, simple-git, pino, dotenv)
- Create `SourceCode/tsconfig.json` for TypeScript compilation (target: ES2022, Node.js 18+)
- Create `SourceCode/.gitignore` for Node.js projects
- Create `SourceCode/.env.example` for environment variable documentation

### 2. Directory Structure
Create the following structure in **SourceCode/**:
```
SourceCode/src/
├── index.ts                    # CLI entry point
├── server.ts                   # MCP Server main logic (placeholder)
├── config/
│   ├── index.ts                # Configuration management
│   └── constants.ts            # Constants definition
├── utils/
│   ├── logger.ts               # Logging utility (pino)
│   └── log-cleaner.ts          # Log cleanup scheduler
├── tools/                      # MCP Tools (placeholders)
├── types/                      # Global type definitions
└── worker/                     # Multi-threading (placeholders)
```

### 3. Logging Module
- Implement structured logging using pino
- Implement log file rotation (daily files)
- Implement automatic cleanup (delete logs older than 3 days)
- Log directory: `../Logs/` (relative to SourceCode)
- Log filename pattern: `app-YYYY-MM-DD.log`

### 4. Configuration Module
- Load environment variables from `.env`
- Validate configuration using TypeScript types
- Export typed configuration object

### 5. Development Scripts
Add to SourceCode/package.json:
- `npm run dev` - Development mode with hot reload (tsx)
- `npm run build` - TypeScript compilation
- `npm run start` - Run compiled code
- `npm run lint` - Code linting
- `npm run type-check` - Type checking

## Impact

### Affected Specs
- **NEW**: core-framework (this change creates the base capability)

### Affected Code
- **NEW**: All files in SourceCode/ directory
- No existing code is modified

### Dependencies
- Requires Node.js >= 18.0.0
- Requires npm >= 9.0.0

### Breaking Changes
None (this is the initial implementation)

### Migration Path
N/A (no migration needed for new project)

## Success Criteria

1. ✅ `npm install` completes without errors
2. ✅ `npm run build` compiles TypeScript successfully
3. ✅ `npm run dev` starts server in development mode
4. ✅ Logger writes to `Logs/app-YYYY-MM-DD.log`
5. ✅ Log cleaner automatically removes files older than 3 days
6. ✅ Configuration loads from `.env` correctly
7. ✅ All linting rules pass
8. ✅ Type checking passes with no errors

## Testing Plan

### Unit Tests
- Configuration loader tests
- Logger initialization tests
- Log cleaner tests

### Integration Tests
- Full application startup test
- Log rotation test (simulate multiple days)
- Configuration loading with various .env scenarios

### Manual Verification
- Run `npm run dev` and verify server starts
- Check logs directory for log files
- Verify log cleanup after 3 days (or manual trigger)
