/**
 * Session Manager
 * Manages SSE sessions and connections
 */

import { randomUUID } from 'crypto';
import type { ServerResponse } from 'http';
import { logger } from '../utils/logger';
import { config } from '../config';

export interface Session {
  id: string;
  userId: string;
  email: string;
  groups: string[];  // Changed from 'roles' to 'groups'
  token: string;
  ip: string;
  createdAt: Date;
  lastActivity: Date;
  connection?: ServerResponse;
}

export interface CreateSessionOptions {
  userId?: string;
  email?: string;
  groups?: string[];  // Changed from 'roles' to 'groups'
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private totalSessions: number = 0;
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Create new session
   * @param token - Auth token (JWT from CSP)
   * @param ip - Client IP address
   * @param options - User info from /user/permissions API (userId, email, groups)
   */
  createSession(
    token: string,
    ip: string,
    options?: CreateSessionOptions
  ): Session {
    const sessionId = randomUUID();

    const userId = options?.userId ?? this.extractUserIdFromToken(token);
    const email = options?.email ?? '';
    const groups = options?.groups ?? [];

    const session: Session = {
      id: sessionId,
      userId,
      email,
      groups,
      token,
      ip,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.sessions.set(sessionId, session);
    this.totalSessions++;

    logger.info({ sessionId, userId, email, groups, ip }, 'Session created');

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Register SSE connection with session
   */
  registerConnection(sessionId: string, connection: ServerResponse): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.connection = connection;
      logger.debug({ sessionId }, 'Connection registered with session');
    }
  }

  /**
   * Send message to session via SSE
   * Enhanced error handling to prevent EPIPE errors
   * Note: This is synchronous for SSE transport compatibility
   */
  sendMessage(sessionId: string, message: unknown): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.connection || session.connection.destroyed) {
      logger.debug({ sessionId }, 'Cannot send message: session not found or connection closed');
      return false;
    }

    try {
      const data = JSON.stringify(message);
      
      // Use write callback to detect errors (fire-and-forget)
      let writeSuccess = true;
      session.connection.write(`data: ${data}\n\n`, (err: Error | null | undefined) => {
        if (err) {
          // Handle specific error types
          if (err.message.includes('EPIPE') || err.message.includes('ECONNRESET')) {
            logger.debug({ 
              sessionId, 
              error: err.message 
            }, 'Message write failed (client disconnected)');
          } else {
            logger.warn({ 
              sessionId, 
              error: err.message 
            }, 'Message write failed');
          }
          writeSuccess = false;
        } else {
          logger.debug({ sessionId, messageSize: data.length }, 'Message sent to session');
        }
      });
      
      return writeSuccess;
    } catch (error) {
      // Catch synchronous errors
      if (error instanceof Error) {
        if (error.message.includes('EPIPE') || error.message.includes('ECONNRESET')) {
          logger.debug({ 
            sessionId, 
            error: error.message 
          }, 'Message send failed (client disconnected)');
        } else {
          logger.error({ 
            error: error.message, 
            sessionId 
          }, 'Failed to send message to session');
        }
      }
      return false;
    }
  }

  /**
   * Update session activity timestamp
   */
  updateActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * Close session with improved error handling
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Close connection if exists
      if (session.connection && !session.connection.destroyed) {
        try {
          // Try to send close message
          session.connection.write(`data: ${JSON.stringify({ type: 'close' })}\n\n`, (err) => {
            if (err) {
              logger.debug({ 
                sessionId, 
                error: err.message 
              }, 'Close message write failed (expected if client already disconnected)');
            }
          });
          
          // End connection
          session.connection.end();
        } catch (error) {
          if (error instanceof Error) {
            // Only log non-EPIPE errors as warnings
            if (error.message.includes('EPIPE') || error.message.includes('ECONNRESET')) {
              logger.debug({ 
                sessionId, 
                error: error.message 
              }, 'Connection already closed');
            } else {
              logger.warn({ 
                sessionId, 
                error: error.message 
              }, 'Error closing connection');
            }
          }
        }
      }

      // Remove session
      this.sessions.delete(sessionId);
      logger.info({ sessionId }, 'Session closed');
    }
  }

  /**
   * Close all sessions
   */
  closeAllSessions(): void {
    logger.info({ count: this.sessions.size }, 'Closing all sessions');
    
    for (const [sessionId] of this.sessions) {
      this.closeSession(sessionId);
    }
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get total session count (since server start)
   */
  getTotalSessionCount(): number {
    return this.totalSessions;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Start cleanup interval for expired sessions
   */
  private startCleanup(): void {
    const timeout = config.session?.timeout || 3600; // Default 1 hour
    const cleanupInterval = 60000; // Check every 1 minute

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions(timeout);
    }, cleanupInterval);

    logger.info({ timeout, cleanupInterval }, 'Session cleanup started');
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
      logger.info('Session cleanup stopped');
    }
  }

  /**
   * Cleanup expired sessions
   */
  private cleanupExpiredSessions(timeoutSeconds: number): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      const inactiveTime = (now - session.lastActivity.getTime()) / 1000;
      if (inactiveTime > timeoutSeconds) {
        expiredSessions.push(sessionId);
      }
    }

    if (expiredSessions.length > 0) {
      logger.info({ count: expiredSessions.length }, 'Cleaning up expired sessions');
      for (const sessionId of expiredSessions) {
        this.closeSession(sessionId);
      }
    }
  }

  /**
   * Extract user ID from token (simplified)
   * TODO: Implement proper JWT validation in Stage 5
   */
  private extractUserIdFromToken(token: string): string {
    // For now, use a simple hash or the token itself
    // In Stage 5, this should decode and validate JWT
    return token.substring(0, 16);
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
