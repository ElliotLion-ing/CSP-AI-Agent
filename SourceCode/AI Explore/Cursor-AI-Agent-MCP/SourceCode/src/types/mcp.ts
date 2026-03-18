/**
 * MCP Protocol Types
 */

// MCP Tool Schema
export interface MCPToolSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    default?: unknown;
  }>;
  required?: string[];
}

// MCP Tool Definition
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: MCPToolSchema;
}

// MCP Initialize Request
export interface MCPInitializeRequest {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, never>;
  };
  clientInfo: {
    name: string;
    version: string;
  };
}

// MCP Initialize Response
export interface MCPInitializeResponse {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, never>;
  };
  serverInfo: {
    name: string;
    version: string;
  };
}

// MCP Tool Call Request
export interface MCPToolCallRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

// MCP Tool Call Response
export interface MCPToolCallResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}
