/**
 * Resource Loader Module
 * Manages multi-source AI resource loading and indexing
 * 
 * Implements AI Resources Multi-Source Architecture as defined in:
 * @see Docs/AI-Resources-Multi-Source-Architecture.md
 * @see AGENTS.md (AI Resources 开发约束)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';
import type {
  AIResourcesConfig,
  ResourceMetadata,
  ResourceType,
  ResourceConflict,
  LoaderStats,
} from '../types/resources';

/**
 * Resource Loader
 * 
 * Key responsibilities:
 * 1. Load and validate ai-resources-config.json
 * 2. Scan resources from multiple sources
 * 3. Build resource index with priority
 * 4. Resolve resource name conflicts
 * 5. Provide unified resource query interface
 */
export class ResourceLoader {
  private config: AIResourcesConfig | null = null;
  private configFilePath: string | null = null;
  private resourceIndex: Map<string, ResourceMetadata> = new Map();
  private conflicts: ResourceConflict[] = [];
  private stats: LoaderStats | null = null;
  private loaded: boolean = false;

  // Cache configuration
  private cacheEnabled: boolean = false;
  private cacheTTL: number = 300000; // 5 minutes default
  private lastLoadTime: number = 0;

  /**
   * Load AI Resources configuration file
   */
  async loadConfig(configPath?: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Resolve the AI-Resources base directory using the same probing strategy
      // as multi-source-manager so both modules agree on the path regardless of
      // whether the server runs locally (cwd = SourceCode/) or in Docker (cwd = /app).
      let defaultPath = path.resolve(process.cwd(), 'AI-Resources/ai-resources-config.json');
      if (!configPath) {
        const candidates = [
          path.resolve(process.env['AI_RESOURCES_PATH'] ?? '', 'ai-resources-config.json'),
          path.resolve(process.cwd(), 'AI-Resources/ai-resources-config.json'),
          path.resolve(process.cwd(), '../AI-Resources/ai-resources-config.json'),
          path.resolve(__dirname, '../../AI-Resources/ai-resources-config.json'),
        ].filter(Boolean);
        for (const c of candidates) {
          try { await fs.access(c); defaultPath = c; break; } catch { /* try next */ }
        }
      }
      const finalPath = configPath || defaultPath;

      logger.debug({ configPath: finalPath }, 'Loading AI Resources configuration...');

      // Check if config file exists
      try {
        await fs.access(finalPath);
      } catch {
        logger.warn({ configPath: finalPath }, 'AI Resources config file not found, using default configuration');
        this.config = this.getDefaultConfig();
        return;
      }

      // Read and parse config file
      const configContent = await fs.readFile(finalPath, 'utf-8');
      const parsedConfig = JSON.parse(configContent) as AIResourcesConfig;

      // Validate configuration
      this.validateConfig(parsedConfig);

      this.config = parsedConfig;
      this.configFilePath = finalPath;
      this.cacheEnabled = parsedConfig.cache?.enabled ?? true;
      this.cacheTTL = (parsedConfig.cache?.ttl ?? 300) * 1000; // Convert to ms

      const duration = Date.now() - startTime;
      logger.info(
        {
          configPath: finalPath,
          defaultSource: parsedConfig.default_source.name,
          extendedSourcesCount: parsedConfig.extended_sources.length,
          duration,
        },
        'AI Resources configuration loaded successfully'
      );
    } catch (error) {
      logger.error(
        {
          type: 'resource',
          operation: 'load_config',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Failed to load AI Resources configuration'
      );
      throw error;
    }
  }

  /**
   * Validate configuration structure and constraints
   */
  private validateConfig(config: AIResourcesConfig): void {
    // Check version
    if (config.version !== '1.0') {
      throw new Error(`Unsupported config version: ${config.version}, expected 1.0`);
    }

    // Check default source
    if (!config.default_source) {
      throw new Error('Missing required field: default_source');
    }

    if (config.default_source.name !== 'csp') {
      logger.warn(
        { name: config.default_source.name },
        'Default source name is not "csp", this may cause compatibility issues'
      );
    }

    if (config.default_source.priority !== 100) {
      logger.warn(
        { priority: config.default_source.priority },
        'Default source priority is not 100, this may affect conflict resolution'
      );
    }

    if (!config.default_source.enabled) {
      throw new Error('Default source must be enabled');
    }

    // Check resource types
    const expectedTypes: ResourceType[] = ['commands', 'skills', 'mcp', 'rules'];
    if (
      !config.resource_types ||
      config.resource_types.length !== 4 ||
      !expectedTypes.every((type) => config.resource_types.includes(type))
    ) {
      throw new Error(
        `Invalid resource_types, expected: ${expectedTypes.join(', ')}, got: ${config.resource_types?.join(', ') || 'none'}`
      );
    }

    // Check loading order
    if (config.loading_order !== 'priority_desc') {
      logger.warn(
        { loading_order: config.loading_order },
        'Loading order is not "priority_desc", this may affect resource precedence'
      );
    }

    // Check conflict resolution
    if (config.conflict_resolution !== 'highest_priority_wins') {
      logger.warn(
        { conflict_resolution: config.conflict_resolution },
        'Conflict resolution is not "highest_priority_wins", this may affect behavior'
      );
    }

    // Check extended sources priority
    const defaultPriority = config.default_source.priority;
    for (const source of config.extended_sources || []) {
      if (source.priority >= defaultPriority) {
        throw new Error(
          `Extended source "${source.name}" has priority ${source.priority} which is >= default source priority ${defaultPriority}. Default source must have highest priority.`
        );
      }
    }

    logger.debug('AI Resources configuration validation passed');
  }

  /**
   * Get default configuration (fallback)
   */
  private getDefaultConfig(): AIResourcesConfig {
    return {
      version: '1.0',
      description: 'Default AI Resources configuration',
      default_source: {
        name: 'csp',
        path: 'csp/ai-resources',
        enabled: true,
        priority: 100,
        resources: {
          commands: 'commands',
          skills: 'skills',
          mcp: 'mcp',
          rules: 'rules',
        },
      },
      extended_sources: [],
      resource_types: ['commands', 'skills', 'mcp', 'rules'],
      loading_order: 'priority_desc',
      conflict_resolution: 'highest_priority_wins',
      cache: {
        enabled: true,
        ttl: 300,
      },
    };
  }

  /**
   * Scan and index resources from all sources
   */
  async scanResources(): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }

    // Check cache validity
    if (this.cacheEnabled && this.loaded) {
      const cacheAge = Date.now() - this.lastLoadTime;
      if (cacheAge < this.cacheTTL) {
        logger.debug({ cacheAge }, 'Using cached resource index');
        return;
      }
      logger.debug('Resource cache expired, reloading...');
    }

    const startTime = Date.now();
    this.resourceIndex.clear();
    this.conflicts = [];

    const stats = {
      sourcesLoaded: 0,
      resourcesIndexed: 0,
      byType: {
        commands: 0,
        skills: 0,
        mcp: 0,
        rules: 0,
      } as Record<ResourceType, number>,
      conflictsDetected: 0,
      loadDuration: 0,
    };

    try {
      // Collect all sources sorted by priority (descending)
      const sources = [this.config.default_source, ...this.config.extended_sources.filter((s) => s.enabled)];
      sources.sort((a, b) => b.priority - a.priority); // High priority first

      logger.info({ sourceCount: sources.length }, 'Scanning resources from all sources...');

      // Scan each source
      for (const source of sources) {
        await this.scanSource(source, stats);
        stats.sourcesLoaded++;
      }

      stats.conflictsDetected = this.conflicts.length;
      stats.loadDuration = Date.now() - startTime;
      this.stats = stats;
      this.loaded = true;
      this.lastLoadTime = Date.now();

      logger.info(
        {
          sourcesLoaded: stats.sourcesLoaded,
          resourcesIndexed: stats.resourcesIndexed,
          conflictsDetected: stats.conflictsDetected,
          duration: stats.loadDuration,
        },
        'Resource scanning completed'
      );
    } catch (error) {
      logger.error(
        {
          type: 'resource',
          operation: 'scan_resources',
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to scan resources'
      );
      throw error;
    }
  }

  /**
   * Scan resources from a single source
   */
  private async scanSource(
    source: AIResourcesConfig['default_source'],
    stats: LoaderStats
  ): Promise<void> {
    logger.debug({ source: source.name, path: source.path }, 'Scanning source...');

    // Derive the AI-Resources base from the config file path stored on the instance,
    // so the source subdirectory resolves correctly in Docker (cwd = /app) and local
    // dev (cwd = SourceCode/) without needing a separate env var.
    const aiResourcesBase = this.configFilePath
      ? path.dirname(this.configFilePath)
      : path.resolve(process.cwd(), 'AI-Resources');
    const baseDir = path.resolve(aiResourcesBase, source.path);

    // Check if source directory exists
    try {
      await fs.access(baseDir);
    } catch {
      logger.warn({ source: source.name, path: baseDir }, 'Source directory not found, skipping');
      return;
    }

    // Scan each resource type
    for (const type of this.config!.resource_types) {
      const subDir = source.resources[type];
      if (!subDir) {
        logger.debug({ source: source.name, type }, 'Resource type not defined for this source, skipping');
        continue;
      }

      const resourceDir = path.join(baseDir, subDir);

      try {
        await fs.access(resourceDir);
      } catch {
        logger.debug({ source: source.name, type, path: resourceDir }, 'Resource directory not found, skipping');
        continue;
      }

      await this.scanResourceType(source, type, resourceDir, stats);
    }
  }

  /**
   * Scan resources of a specific type from a directory
   */
  private async scanResourceType(
    source: AIResourcesConfig['default_source'],
    type: ResourceType,
    dir: string,
    stats: LoaderStats
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdc'))) {
          // Handle file resources (commands, rules)
          const resourceName = path.basename(entry.name, path.extname(entry.name));
          await this.indexResource(source, type, resourceName, fullPath, stats);
        } else if (entry.isDirectory()) {
          // Handle directory resources:
          //   skill → must contain SKILL.md
          //   mcp   → must contain mcp-config.json
          //   others → directory layout is not expected; skip
          if (type === 'skills') {
            const skillFile = path.join(fullPath, 'SKILL.md');
            try {
              await fs.access(skillFile);
              await this.indexResource(source, type, entry.name, skillFile, stats);
            } catch {
              logger.debug({ dir: fullPath }, 'Directory does not contain SKILL.md, skipping');
            }
          } else if (type === 'mcp') {
            const mcpConfigFile = path.join(fullPath, 'mcp-config.json');
            try {
              await fs.access(mcpConfigFile);
              await this.indexResource(source, type, entry.name, mcpConfigFile, stats);
            } catch {
              logger.debug({ dir: fullPath }, 'Directory does not contain mcp-config.json, skipping');
            }
          }
        }
      }
    } catch (error) {
      logger.warn(
        {
          source: source.name,
          type,
          dir,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to scan resource directory'
      );
    }
  }

  /**
   * Index a single resource with conflict detection
   */
  private async indexResource(
    source: AIResourcesConfig['default_source'],
    type: ResourceType,
    name: string,
    filePath: string,
    stats: LoaderStats
  ): Promise<void> {
    const resourceKey = `${type}:${name}`;
    const existing = this.resourceIndex.get(resourceKey);

    if (existing) {
      // Conflict detected
      logger.warn(
        {
          resourceName: name,
          type,
          existingSource: existing.source,
          existingPriority: existing.priority,
          newSource: source.name,
          newPriority: source.priority,
        },
        'Resource name conflict detected'
      );

      // Record conflict
      const conflict: ResourceConflict = {
        name,
        type,
        conflicts: [
          {
            source: existing.source,
            priority: existing.priority,
            path: existing.path,
          },
          {
            source: source.name,
            priority: source.priority,
            path: filePath,
          },
        ],
        selected:
          source.priority > existing.priority
            ? { source: source.name, priority: source.priority, path: filePath }
            : { source: existing.source, priority: existing.priority, path: existing.path },
      };

      this.conflicts.push(conflict);

      // Keep higher priority resource (already sorted by priority)
      if (source.priority <= existing.priority) {
        logger.debug(
          {
            resourceName: name,
            selectedSource: existing.source,
          },
          'Keeping existing resource (higher priority)'
        );
        return;
      }

      logger.debug(
        {
          resourceName: name,
          selectedSource: source.name,
        },
        'Replacing with new resource (higher priority)'
      );
    }

    // Index resource
    const metadata: ResourceMetadata = {
      id: resourceKey,
      name,
      type,
      source: source.name,
      priority: source.priority,
      path: filePath,
    };

    this.resourceIndex.set(resourceKey, metadata);
    stats.resourcesIndexed++;
    stats.byType[type]++;

    logger.debug({ resourceKey, source: source.name }, 'Resource indexed');
  }

  /**
   * Get all resources by type
   */
  getResourcesByType(type: ResourceType): ResourceMetadata[] {
    this.ensureLoaded();
    const results: ResourceMetadata[] = [];
    for (const [, metadata] of this.resourceIndex) {
      if (metadata.type === type) {
        results.push(metadata);
      }
    }
    return results;
  }

  /**
   * Get resource by ID (type:name)
   */
  getResourceById(id: string): ResourceMetadata | null {
    this.ensureLoaded();
    return this.resourceIndex.get(id) || null;
  }

  /**
   * Search resources by name
   */
  searchResourcesByName(name: string, type?: ResourceType): ResourceMetadata[] {
    this.ensureLoaded();
    const results: ResourceMetadata[] = [];
    const lowerName = name.toLowerCase();

    for (const metadata of this.resourceIndex.values()) {
      if (type && metadata.type !== type) {
        continue;
      }
      if (metadata.name.toLowerCase().includes(lowerName)) {
        results.push(metadata);
      }
    }

    return results;
  }

  /**
   * Get all detected conflicts
   */
  getConflicts(): ResourceConflict[] {
    this.ensureLoaded();
    return [...this.conflicts];
  }

  /**
   * Get loader statistics
   */
  getStats(): LoaderStats | null {
    return this.stats;
  }

  /**
   * Refresh resource index (clear cache and rescan)
   */
  async refresh(): Promise<void> {
    logger.info('Refreshing resource index...');
    this.loaded = false;
    this.lastLoadTime = 0;
    await this.scanResources();
  }

  /**
   * Ensure resources are loaded
   */
  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('Resources not loaded. Call scanResources() first.');
    }
  }
}

// Singleton instance
export const resourceLoader = new ResourceLoader();
