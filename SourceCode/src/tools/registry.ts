/**
 * Tool Registry
 * Central registry for MCP tools
 */

import { logger } from '../utils/logger';
import type { ToolDefinition } from '../types/tools';
import type { MCPToolDefinition } from '../types/mcp';

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a tool
   */
  registerTool(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`);
    }

    this.tools.set(tool.name, tool);
    logger.info({ toolName: tool.name }, `Tool registered: ${tool.name}`);
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tools
   */
  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get MCP tool definitions (for tools/list response)
   */
  getMCPToolDefinitions(): MCPToolDefinition[] {
    return this.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tool count
   */
  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * Call a tool by name with arguments
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }

    logger.debug({ toolName: name, args }, 'Calling tool');
    
    try {
      const result = await tool.handler(args);
      
      // Debug: Log the result structure
      logger.debug({ 
        toolName: name, 
        resultType: typeof result,
        resultKeys: result && typeof result === 'object' ? Object.keys(result) : undefined,
        hasSuccess: result && typeof result === 'object' && 'success' in result,
        hasData: result && typeof result === 'object' && 'data' in result,
        hasError: result && typeof result === 'object' && 'error' in result
      }, 'Tool execution result structure');
      
      return result;
    } catch (error) {
      logger.error({ toolName: name, error, errorType: typeof error, errorMessage: error instanceof Error ? error.message : String(error) }, 'Tool execution threw error');
      throw error;
    }
  }
}

// Global singleton
export const toolRegistry = new ToolRegistry();
