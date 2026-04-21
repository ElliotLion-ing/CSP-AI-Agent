# core-framework Specification

## Purpose
TBD - created by archiving change stage-1-core-framework. Update Purpose after archive.
## Requirements
### Requirement: Project Initialization
The system SHALL provide a properly initialized Node.js/TypeScript project with all necessary dependencies and configuration files in the **SourceCode/** directory.

#### Scenario: Fresh project setup
- **WHEN** developer runs `npm install` for the first time in SourceCode/
- **THEN** all dependencies are installed successfully
- **AND** no security vulnerabilities are reported
- **AND** TypeScript compiles without errors

#### Scenario: Development mode startup
- **WHEN** developer runs `npm run dev` from SourceCode/
- **THEN** the application starts in development mode with hot reload
- **AND** TypeScript files are compiled on-the-fly
- **AND** changes to source files trigger automatic reload

### Requirement: Structured Logging
The system SHALL provide structured logging using pino with automatic file rotation and cleanup, with logs stored in the project root **Logs/** directory.

#### Scenario: Log file creation
- **WHEN** the application starts
- **THEN** a log file is created in `../Logs/` directory (relative to SourceCode/)
- **AND** the log file name follows the pattern `app-YYYY-MM-DD.log`
- **AND** logs are written in JSON format

#### Scenario: Log rotation
- **WHEN** a new day begins
- **THEN** a new log file is created for the new day
- **AND** the previous day's log file is retained
- **AND** logs older than 3 days are automatically deleted

#### Scenario: Structured log entry
- **WHEN** a log entry is created
- **THEN** it contains timestamp, level, service name, and message
- **AND** it MAY contain additional context fields (userId, resourceId, etc.)
- **AND** it is formatted as valid JSON

### Requirement: Configuration Management
The system SHALL load and validate configuration from environment variables with proper type safety from SourceCode/.env file.

#### Scenario: Configuration loading
- **WHEN** the application starts
- **THEN** configuration is loaded from `SourceCode/.env` file
- **AND** all required variables are validated
- **AND** typed configuration object is exported
- **AND** missing required variables cause startup failure with clear error message

#### Scenario: Configuration validation
- **WHEN** an invalid configuration value is provided
- **THEN** the application fails to start
- **AND** a descriptive error message is displayed
- **AND** the error indicates which configuration value is invalid

### Requirement: Development Tooling
The system SHALL provide development scripts for building, testing, and linting the codebase in SourceCode/.

#### Scenario: TypeScript compilation
- **WHEN** developer runs `npm run build` from SourceCode/
- **THEN** TypeScript source files are compiled to JavaScript
- **AND** compiled files are placed in `dist/` directory
- **AND** type declaration files (.d.ts) are generated
- **AND** no compilation errors occur

#### Scenario: Code linting
- **WHEN** developer runs `npm run lint` from SourceCode/
- **THEN** all source files are checked against ESLint rules
- **AND** linting errors and warnings are reported
- **AND** exit code reflects whether linting passed or failed

#### Scenario: Type checking
- **WHEN** developer runs `npm run type-check` from SourceCode/
- **THEN** TypeScript performs type checking without compilation
- **AND** type errors are reported
- **AND** exit code reflects whether type checking passed

### Requirement: Graceful Shutdown
The system SHALL handle shutdown signals gracefully, cleaning up resources before exit.

#### Scenario: SIGINT signal
- **WHEN** the application receives SIGINT signal (Ctrl+C)
- **THEN** it logs the shutdown intention
- **AND** it closes all open resources (file handles, connections)
- **AND** it exits with code 0

#### Scenario: SIGTERM signal
- **WHEN** the application receives SIGTERM signal
- **THEN** it logs the shutdown intention
- **AND** it closes all open resources
- **AND** it exits with code 0

### Requirement: Error Handling
The system SHALL handle errors gracefully with proper logging and user-friendly error messages.

#### Scenario: Unhandled exception
- **WHEN** an unhandled exception occurs
- **THEN** the error is logged with full stack trace
- **AND** the application attempts graceful shutdown
- **AND** a user-friendly error message is displayed

#### Scenario: Unhandled promise rejection
- **WHEN** an unhandled promise rejection occurs
- **THEN** the rejection is logged with reason and stack trace
- **AND** the application attempts graceful shutdown
- **AND** exit code is non-zero

