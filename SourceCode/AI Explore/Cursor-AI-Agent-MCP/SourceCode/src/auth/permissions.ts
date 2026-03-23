/**
 * Permission Control System
 * Group-based access control for MCP tools
 * Groups are obtained from CSP API /user/permissions (e.g., "zNet", "Client-Public")
 */

import { logger, logAuthAttempt } from '../utils/logger';

/**
 * Known groups from CSP
 * Users may belong to one or more groups
 */
export const KnownGroups = {
  ZNET: 'zNet',                      // zNet team - full access
  CLIENT_PUBLIC: 'Client-Public',    // Client-Public team - standard access
  ADMIN: 'admin',                    // Admin group - full access (if exists)
} as const;

/**
 * Permission level for operations
 */
export enum PermissionLevel {
  READ = 'read',
  WRITE = 'write',
  ADMIN = 'admin',
}

/**
 * Tool permission configuration
 */
export interface ToolPermission {
  tool: string;
  allowedGroups: string[];  // Changed from requiredRole to allowedGroups
  requiredPermission: PermissionLevel;
}

/**
 * Default permission rules for each tool
 * All authenticated users (with valid groups) can use these tools
 */
const defaultPermissions: ToolPermission[] = [
  // sync_resources - available to all authenticated users
  {
    tool: 'sync_resources',
    allowedGroups: ['*'],  // * means all authenticated users
    requiredPermission: PermissionLevel.WRITE,
  },
  // manage_subscription - available to all authenticated users
  {
    tool: 'manage_subscription',
    allowedGroups: ['*'],
    requiredPermission: PermissionLevel.WRITE,
  },
  // search_resources - read-only, all authenticated users
  {
    tool: 'search_resources',
    allowedGroups: ['*'],
    requiredPermission: PermissionLevel.READ,
  },
  // upload_resource - requires write permission
  {
    tool: 'upload_resource',
    allowedGroups: ['*'],
    requiredPermission: PermissionLevel.WRITE,
  },
  // uninstall_resource - requires write permission
  {
    tool: 'uninstall_resource',
    allowedGroups: ['*'],
    requiredPermission: PermissionLevel.WRITE,
  },
  // track_usage - internal telemetry tool, always allowed for all authenticated users
  {
    tool: 'track_usage',
    allowedGroups: ['*'],
    requiredPermission: PermissionLevel.WRITE,
  },
];

/**
 * Custom permission rules (can be overridden via config)
 */
let permissionRules: Map<string, ToolPermission> = new Map();

/**
 * Initialize permission system
 */
export function initializePermissions(customRules?: ToolPermission[]): void {
  // Load default permissions
  for (const perm of defaultPermissions) {
    permissionRules.set(perm.tool, perm);
  }

  // Override with custom rules if provided
  if (customRules && customRules.length > 0) {
    logger.info(
      { count: customRules.length },
      'Loading custom permission rules'
    );
    for (const perm of customRules) {
      permissionRules.set(perm.tool, perm);
    }
  }

  logger.info(
    { toolCount: permissionRules.size },
    'Permission system initialized'
  );
}

/**
 * Check if a user has permission to access a tool
 * @param toolName - The name of the tool to check
 * @param userGroups - The groups the user belongs to (from CSP API)
 */
export function checkPermission(
  toolName: string,
  userGroups: string[]
): { allowed: boolean; reason?: string } {
  const checkStartTime = Date.now();
  
  logger.debug({
    type: 'permission_check',
    toolName,
    userGroups,
    timestamp: new Date().toISOString()
  }, `Checking permission for tool: ${toolName}`);
  
  // Check if tool has permission rules
  const permission = permissionRules.get(toolName);
  if (!permission) {
    // If no permission rule defined, deny by default
    logger.warn({ 
      type: 'permission_check',
      toolName,
      userGroups,
      result: 'denied',
      reason: 'no_rule',
      timestamp: new Date().toISOString()
    }, 'No permission rule found for tool, denying access');
    
    logAuthAttempt('permission_check', false, {
      toolName,
      userGroups,
      reason: 'no_rule',
      duration: Date.now() - checkStartTime
    });
    
    return {
      allowed: false,
      reason: `Tool '${toolName}' has no permission rule defined`,
    };
  }

  // If no groups provided, deny access
  if (!userGroups || userGroups.length === 0) {
    logger.warn(
      { 
        type: 'permission_check',
        toolName,
        result: 'denied',
        reason: 'no_groups',
        timestamp: new Date().toISOString()
      },
      'Permission denied: user has no groups'
    );
    
    logAuthAttempt('permission_check', false, {
      toolName,
      reason: 'no_groups',
      duration: Date.now() - checkStartTime
    });
    
    return {
      allowed: false,
      reason: `User must belong to at least one group to access tools`,
    };
  }

  // Admin group bypasses all checks
  if (userGroups.includes(KnownGroups.ADMIN) || userGroups.includes('admin')) {
    logger.info(
      { 
        type: 'permission_check',
        toolName,
        userGroups,
        result: 'granted',
        reason: 'admin_bypass',
        duration: Date.now() - checkStartTime,
        timestamp: new Date().toISOString()
      },
      'Admin group access granted'
    );
    
    logAuthAttempt('permission_check', true, {
      toolName,
      userGroups,
      reason: 'admin',
      duration: Date.now() - checkStartTime
    });
    
    return { allowed: true };
  }

  // Check if tool allows all authenticated users
  if (permission.allowedGroups.includes('*')) {
    logger.info(
      { 
        type: 'permission_check',
        toolName,
        userGroups,
        allowedGroups: permission.allowedGroups,
        result: 'granted',
        reason: 'wildcard',
        duration: Date.now() - checkStartTime,
        timestamp: new Date().toISOString()
      },
      'Permission granted (tool allows all authenticated users)'
    );
    
    logAuthAttempt('permission_check', true, {
      toolName,
      userGroups,
      reason: 'wildcard',
      duration: Date.now() - checkStartTime
    });
    
    return { allowed: true };
  }

  // Check if user belongs to any of the allowed groups
  const hasAllowedGroup = userGroups.some((group) =>
    permission.allowedGroups.includes(group)
  );

  if (!hasAllowedGroup) {
    logger.warn(
      { 
        type: 'permission_check',
        toolName,
        userGroups,
        allowedGroups: permission.allowedGroups,
        result: 'denied',
        reason: 'group_mismatch',
        duration: Date.now() - checkStartTime,
        timestamp: new Date().toISOString()
      },
      'Permission denied: user not in allowed groups'
    );
    
    logAuthAttempt('permission_check', false, {
      toolName,
      userGroups,
      allowedGroups: permission.allowedGroups,
      reason: 'group_mismatch',
      duration: Date.now() - checkStartTime
    });
    
    return {
      allowed: false,
      reason: `Tool '${toolName}' requires membership in one of: ${permission.allowedGroups.join(', ')}`,
    };
  }

  logger.info(
    { 
      type: 'permission_check',
      toolName,
      userGroups,
      allowedGroups: permission.allowedGroups,
      result: 'granted',
      reason: 'group_match',
      duration: Date.now() - checkStartTime,
      timestamp: new Date().toISOString()
    },
    'Permission granted (user in allowed groups)'
  );
  
  logAuthAttempt('permission_check', true, {
    toolName,
    userGroups,
    matchedGroups: userGroups.filter(g => permission.allowedGroups.includes(g)),
    duration: Date.now() - checkStartTime
  });
  
  return { allowed: true };
}

/**
 * Get permission info for a tool
 */
export function getToolPermission(toolName: string): ToolPermission | undefined {
  return permissionRules.get(toolName);
}

/**
 * Get all permission rules
 */
export function getAllPermissions(): ToolPermission[] {
  return Array.from(permissionRules.values());
}

/**
 * Update permission rule for a tool
 */
export function updatePermission(permission: ToolPermission): void {
  permissionRules.set(permission.tool, permission);
  logger.info(
    { tool: permission.tool, permission },
    'Permission rule updated'
  );
}

/**
 * Remove permission rule for a tool
 */
export function removePermission(toolName: string): void {
  permissionRules.delete(toolName);
  logger.info({ toolName }, 'Permission rule removed');
}

// Initialize with default permissions
initializePermissions();
