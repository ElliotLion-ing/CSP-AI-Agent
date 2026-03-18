import { CacheManager } from '../cache/cache-manager.js';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  services: {
    http: 'up' | 'down';
    redis: 'up' | 'down' | 'not_configured';
    cache: 'healthy' | 'degraded' | 'down';
  };
  details?: {
    redisError?: string;
    cacheError?: string;
  };
}

export class HealthChecker {
  private cacheManager: CacheManager | null = null;

  constructor(cacheManager?: CacheManager) {
    this.cacheManager = cacheManager || null;
  }

  /**
   * Check HTTP Server health
   */
  private checkHttpServer(): 'up' | 'down' {
    // HTTP server is up if this code is running
    return 'up';
  }

  /**
   * Check Redis connection health
   */
  private async checkRedis(): Promise<{ status: 'up' | 'down' | 'not_configured'; error?: string }> {
    if (!this.cacheManager) {
      return { status: 'not_configured' };
    }

    try {
      // Try to check Redis connection via cache manager
      const redisCache = (this.cacheManager as any).l2Cache;
      
      if (!redisCache) {
        return { status: 'not_configured' };
      }

      // Try a simple Redis operation (check client status)
      const client = (redisCache as any).client;
      
      if (!client || !client.isReady) {
        return { status: 'down', error: 'Redis client not ready' };
      }

      // Try a ping operation
      await client.ping();
      return { status: 'up' };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check Cache health
   */
  private checkCache(): { status: 'healthy' | 'degraded' | 'down'; error?: string } {
    if (!this.cacheManager) {
      return { status: 'down', error: 'Cache manager not initialized' };
    }

    try {
      // Check if cache manager is functional
      const stats = this.cacheManager.getStats();
      
      // Cache is healthy if stats are available
      if (stats && typeof stats.hitRate === 'number') {
        // Check if hit rate is reasonable (> 0 means cache is working)
        if (stats.hitRate >= 0) {
          return { status: 'healthy' };
        }
        return { status: 'degraded', error: 'Low cache hit rate' };
      }

      return { status: 'degraded', error: 'Cache stats unavailable' };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Perform comprehensive health check
   */
  async check(): Promise<HealthStatus> {
    const httpStatus = this.checkHttpServer();
    const redisResult = await this.checkRedis();
    const cacheResult = this.checkCache();

    const allHealthy = 
      httpStatus === 'up' &&
      (redisResult.status === 'up' || redisResult.status === 'not_configured') &&
      cacheResult.status === 'healthy';

    const health: HealthStatus = {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        http: httpStatus,
        redis: redisResult.status,
        cache: cacheResult.status
      }
    };

    // Add error details if any
    if (redisResult.error || cacheResult.error) {
      health.details = {};
      if (redisResult.error) {
        health.details.redisError = redisResult.error;
      }
      if (cacheResult.error) {
        health.details.cacheError = cacheResult.error;
      }
    }

    return health;
  }
}
