/**
 * Authentication and Permission Middlewares
 * Token authentication and permission checking for HTTP endpoints
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken, TokenPayload } from './token-validator';
import { checkPermission } from './permissions';
import { logger } from '../utils/logger';

/**
 * Extended request with user info
 */
export interface AuthenticatedRequest extends FastifyRequest {
  user?: TokenPayload;
}

/**
 * Token Authentication Middleware
 * Verifies token via external REST API
 */
export async function tokenAuthMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Extract token from Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn(
        { 
          type: 'auth',
          operation: 'middleware',
          ip: request.ip, 
          url: request.url 
        },
        'Missing or invalid Authorization header'
      );
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token via external API
    const payload = await verifyToken(token);
    if (!payload) {
      logger.warn(
        { 
          type: 'auth',
          operation: 'middleware',
          ip: request.ip, 
          url: request.url 
        },
        'Token validation failed'
      );
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
      return;
    }

    // Attach user info to request
    request.user = payload;

    logger.debug(
      { 
        type: 'auth',
        operation: 'middleware',
        userId: payload.userId,
        email: payload.email,
        groups: payload.groups
      },
      `Token authentication successful for user ${payload.userId}`
    );
  } catch (error) {
    logger.error({ 
      type: 'auth',
      operation: 'middleware',
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 'Token authentication error');
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Authentication failed',
    });
  }
}

/**
 * Token Authentication Middleware with Legacy Bearer Token Support
 * Supports both token validation via API and legacy bearer tokens
 */
export async function tokenAuthOrLegacyMiddleware(
  request: AuthenticatedRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn(
        { 
          type: 'auth',
          operation: 'middleware_legacy',
          ip: request.ip, 
          url: request.url 
        },
        'Missing or invalid Authorization header'
      );
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      });
      return;
    }

    const token = authHeader.substring(7);

    // Try to validate via API first
    const payload = await verifyToken(token);
    if (payload) {
      // API validation successful
      request.user = payload;
      logger.debug(
        { 
          type: 'auth',
          operation: 'middleware_legacy',
          userId: payload.userId,
          email: payload.email,
          groups: payload.groups
        },
        `Token validated via API for user ${payload.userId}`
      );
      return;
    }

    // Fallback to legacy bearer token (for backward compatibility)
    logger.debug(
      { 
        type: 'auth',
        operation: 'middleware_legacy',
        ip: request.ip 
      },
      'API validation failed, using legacy bearer token mode'
    );
    
    // In legacy mode, we don't have user info, so continue without setting request.user
    // The endpoint will handle the legacy token separately
  } catch (error) {
    logger.error({ 
      type: 'auth',
      operation: 'middleware_legacy',
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 'Token authentication error');
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Authentication failed',
    });
  }
}

/**
 * Permission Check Middleware Factory
 * Creates middleware to check permissions for a specific tool
 */
export function requirePermission(toolName: string) {
  return async (request: AuthenticatedRequest, reply: FastifyReply): Promise<void> => {
    try {
      if (!request.user) {
        logger.error(
          { 
            type: 'auth',
            operation: 'permission_check',
            url: request.url 
          },
          'Permission check called without authentication'
        );
        reply.code(401).send({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
        return;
      }

      // Check permission
      const permissionCheck = checkPermission(toolName, request.user.groups);

      if (!permissionCheck.allowed) {
        logger.warn(
          {
            type: 'auth',
            operation: 'permission_check',
            userId: request.user.userId,
            email: request.user.email,
            groups: request.user.groups,
            toolName,
            reason: permissionCheck.reason,
          },
          `Permission denied for user ${request.user.userId} to access tool ${toolName}`
        );
        reply.code(403).send({
          error: 'Forbidden',
          message: permissionCheck.reason || 'Insufficient permissions',
        });
        return;
      }

      logger.debug(
        { 
          type: 'auth',
          operation: 'permission_check',
          userId: request.user.userId, 
          toolName 
        },
        `Permission granted for user ${request.user.userId} to access tool ${toolName}`
      );
    } catch (error) {
      logger.error({ 
        type: 'auth',
        operation: 'permission_check',
        toolName, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 'Permission check error');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Permission check failed',
      });
    }
  };
}

/**
 * Permission Check for Tool Call
 * Checks permission when tools/call is invoked
 */
export function checkToolCallPermission(
  toolName: string,
  user: TokenPayload
): { allowed: boolean; reason?: string } {
  return checkPermission(toolName, user.groups);
}
