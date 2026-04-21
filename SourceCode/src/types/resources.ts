/**
 * AI Resources Type Definitions
 * Defines types for multi-source AI resource management
 */

/**
 * Resource type enumeration
 */
export type ResourceType = 'commands' | 'skills' | 'mcp' | 'rules';

/**
 * Resource source configuration
 */
export interface ResourceSource {
  /** Source name (identifier) */
  name: string;
  
  /** Relative path to AI-Resources root */
  path: string;
  
  /** Whether this source is enabled */
  enabled: boolean;
  
  /** Priority (higher number = higher priority) */
  priority: number;
  
  /** Mapping of resource types to subdirectories */
  resources: Partial<Record<ResourceType, string>>;
  
  /** Optional description */
  description?: string;
}

/**
 * AI Resources configuration
 */
export interface AIResourcesConfig {
  /** Configuration version */
  version: string;
  
  /** Optional description */
  description?: string;
  
  /** Default resource source (always loaded) */
  default_source: ResourceSource;
  
  /** Extended resource sources */
  extended_sources: ResourceSource[];
  
  /** Supported resource types */
  resource_types: ResourceType[];
  
  /** Loading order strategy */
  loading_order: 'priority_desc' | 'priority_asc' | 'name_asc';
  
  /** Conflict resolution strategy */
  conflict_resolution: 'highest_priority_wins' | 'merge' | 'error';
  
  /** Cache configuration */
  cache?: {
    enabled: boolean;
    ttl: number; // seconds
  };
}

/**
 * Resource metadata
 */
export interface ResourceMetadata {
  /** Resource ID */
  id: string;
  
  /** Resource name */
  name: string;
  
  /** Resource type */
  type: ResourceType;
  
  /** Source name */
  source: string;
  
  /** Source priority */
  priority: number;
  
  /** Full file path */
  path: string;
  
  /** Version (if available) */
  version?: string;
  
  /** Description (if available) */
  description?: string;
  
  /** Tags (if available) */
  tags?: string[];
}

/**
 * Resource conflict information
 */
export interface ResourceConflict {
  /** Resource name */
  name: string;
  
  /** Resource type */
  type: ResourceType;
  
  /** Conflicting resources */
  conflicts: Array<{
    source: string;
    priority: number;
    path: string;
  }>;
  
  /** Selected resource (after conflict resolution) */
  selected: {
    source: string;
    priority: number;
    path: string;
  };
}

/**
 * Resource loader statistics
 */
export interface LoaderStats {
  /** Total sources loaded */
  sourcesLoaded: number;
  
  /** Total resources indexed */
  resourcesIndexed: number;
  
  /** Resources by type */
  byType: Record<ResourceType, number>;
  
  /** Conflicts detected */
  conflictsDetected: number;
  
  /** Load duration (ms) */
  loadDuration: number;
}
