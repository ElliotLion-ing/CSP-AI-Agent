/**
 * SSE Transport Implementation
 * MCP protocol over Server-Sent Events
 */

import { logger, logToolStep } from '../utils/logger';
import { sessionManager } from '../session/manager';
import { toolRegistry } from '../tools/registry';
import { checkToolCallPermission } from '../auth/middleware';

export interface SSEMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export class SSETransport {
  constructor() {
    logger.info('SSE transport initialized');
  }

  /**
   * Handle incoming message from client
   */
  async handleMessage(sessionId: string, message: SSEMessage): Promise<void> {
    const messageStartTime = Date.now();
    
    logger.info({ 
      type: 'sse_message_received',
      sessionId, 
      method: message.method,
      messageId: message.id,
      hasParams: !!message.params,
      timestamp: new Date().toISOString()
    }, `SSE message received: ${message.method}`);

    try {
      // Validate session
      logToolStep('sse', 'Validating session', { sessionId });
      
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        logger.error({
          type: 'sse_error',
          sessionId,
          method: message.method,
          error: 'session_not_found',
          timestamp: new Date().toISOString()
        }, 'Session not found or expired');
        throw new Error('Session not found or expired');
      }

      logger.debug({
        type: 'sse_session_validated',
        sessionId,
        userId: session.userId,
        email: session.email,
        groups: session.groups,
        timestamp: new Date().toISOString()
      }, 'Session validated');

      // Update session activity
      sessionManager.updateActivity(sessionId);
      logToolStep('sse', 'Session activity updated', { sessionId });

      // Handle MCP message
      if (message.method === 'tools/list') {
        logToolStep('sse', 'Handling tools/list request', { sessionId });
        
        const tools = toolRegistry.getMCPToolDefinitions();
        
        logger.info({
          type: 'sse_tools_list',
          sessionId,
          toolCount: tools.length,
          toolNames: tools.map(t => t.name),
          timestamp: new Date().toISOString()
        }, `Returning ${tools.length} tool definitions`);
        
        const response: SSEMessage = {
          jsonrpc: '2.0',
          id: message.id,
          result: { tools },
        };
        this.sendMessage(sessionId, response);
      } else if (message.method === 'tools/call') {
        const params = message.params as { name: string; arguments?: Record<string, unknown> };
        const toolName = params.name;
        const args = params.arguments || {};

        logger.info({ 
          type: 'sse_tool_call',
          sessionId, 
          toolName,
          userId: session.userId,
          email: session.email,
          argsPreview: JSON.stringify(args).substring(0, 200),
          timestamp: new Date().toISOString()
        }, `Executing tool: ${toolName}`);
        
        logToolStep(toolName, 'Tool call initiated via SSE', { 
          sessionId, 
          userId: session.userId,
          email: session.email
        });

        try {
          // Check permissions if user is authenticated
          if (session.userId && session.groups && session.groups.length > 0) {
            logToolStep(toolName, 'Checking tool permissions', { 
              userId: session.userId,
              email: session.email,
              groups: session.groups
            });
            
            const permissionStartTime = Date.now();
            const permissionCheck = checkToolCallPermission(toolName, {
              userId: session.userId,
              email: session.email,
              groups: session.groups,
            });
            const permissionDuration = Date.now() - permissionStartTime;

            if (!permissionCheck.allowed) {
              logger.warn(
                { 
                  type: 'sse_permission_denied',
                  sessionId, 
                  userId: session.userId, 
                  email: session.email, 
                  groups: session.groups, 
                  toolName, 
                  reason: permissionCheck.reason,
                  duration: permissionDuration,
                  timestamp: new Date().toISOString()
                },
                `Tool call permission denied for ${toolName}`
              );
              
              const errorResponse: SSEMessage = {
                jsonrpc: '2.0',
                id: message.id,
                error: {
                  code: -32600, // Invalid Request
                  message: permissionCheck.reason || 'Permission denied',
                },
              };
              this.sendMessage(sessionId, errorResponse);
              return;
            }
            
            logger.debug({
              type: 'sse_permission_granted',
              sessionId,
              userId: session.userId,
              toolName,
              duration: permissionDuration,
              timestamp: new Date().toISOString()
            }, `Permission granted for ${toolName}`);
          }

          logToolStep(toolName, 'Executing tool handler', { args });
          const toolStartTime = Date.now();
          
          const result = await toolRegistry.callTool(toolName, args);
          
          const toolDuration = Date.now() - toolStartTime;
          
          // Log complete result
          logger.info({ 
            type: 'sse_tool_success',
            sessionId, 
            toolName, 
            userId: session.userId,
            resultType: typeof result,
            resultPreview: JSON.stringify(result).substring(0, 500),
            duration: toolDuration,
            timestamp: new Date().toISOString()
          }, `Tool ${toolName} executed successfully`);
          
          logToolStep(toolName, 'Tool execution completed', { 
            duration: toolDuration,
            resultSize: JSON.stringify(result).length
          });
          
          const response: SSEMessage = {
            jsonrpc: '2.0',
            id: message.id,
            result,
          };
          this.sendMessage(sessionId, response);
        } catch (error) {
          const toolDuration = Date.now() - messageStartTime;
          
          logger.error({
            type: 'sse_tool_error',
            sessionId,
            toolName,
            userId: session.userId,
            error: error instanceof Error ? {
              message: error.message,
              stack: error.stack,
              name: error.name
            } : String(error),
            duration: toolDuration,
            timestamp: new Date().toISOString()
          }, `Tool ${toolName} execution failed`);
          
          const errorResponse: SSEMessage = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: error instanceof Error ? error.message : 'Tool execution failed',
              data: error,
            },
          };
          this.sendMessage(sessionId, errorResponse);
        }
      } else if (message.method === 'initialize') {
        logger.info({
          type: 'sse_initialize',
          sessionId,
          timestamp: new Date().toISOString()
        }, 'Client initialization request');
        
        const response: SSEMessage = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'csp-ai-agent-mcp',
              version: '0.2.0',
            },
          },
        };
        this.sendMessage(sessionId, response);
      } else if (message.method === 'ping') {
        // Keepalive ping
        logger.debug({
          type: 'sse_ping',
          sessionId,
          timestamp: new Date().toISOString()
        }, 'Keepalive ping received');
        
        const response: SSEMessage = {
          jsonrpc: '2.0',
          id: message.id,
          result: { type: 'pong' },
        };
        this.sendMessage(sessionId, response);
      } else {
        // Unknown method
        logger.warn({
          type: 'sse_unknown_method',
          sessionId,
          method: message.method,
          timestamp: new Date().toISOString()
        }, `Unknown method: ${message.method}`);
        
        const errorResponse: SSEMessage = {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `Method not found: ${message.method}`,
          },
        };
        this.sendMessage(sessionId, errorResponse);
      }
    } catch (error) {
      logger.error({ error, sessionId }, 'Error handling message');
      const errorResponse: SSEMessage = {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      };
      this.sendMessage(sessionId, errorResponse);
    }
  }

  /**
   * Send message to client via SSE
   */
  private sendMessage(sessionId: string, message: SSEMessage): void {
    const sent = sessionManager.sendMessage(sessionId, message);
    if (!sent) {
      logger.warn({ sessionId, messageId: message.id }, 'Failed to send message to client');
    }
  }
}

// Singleton instance
export const sseTransport = new SSETransport();
