/**
 * Multi-Layer Cache Manager
 * L1: In-memory LRU cache
 * L2: Redis persistent cache
 */

import { LRUCache } from 'lru-cache';
import { config } from '../config';
import { logger } from '../utils/logger';
import { redisClient } from './redis-client';

const CACHE_KEY_PREFIX = 'csp:cache';

/** JSON-serializable cache value type (satisfies LRUCache V extends {}) */
type CacheValue = object | string | number | boolean;

export interface CacheStats {
  l1Hits: number;
  l2Hits: number;
  misses: number;
  hitRate: number;
}

export class CacheManager {
  private static instance: CacheManager | null = null;
  private readonly l1: LRUCache<string, CacheValue>;
  private readonly l2: typeof redisClient;
  private readonly defaultTtlSeconds: number;
  private readonly defaultNamespace: string;

  private l1Hits = 0;
  private l2Hits = 0;
  private misses = 0;

  private constructor(options?: { namespace?: string }) {
    const ttlMs = (config.cache.redis?.ttl ?? 900) * 1000;
    this.defaultTtlSeconds = config.cache.redis?.ttl ?? 900;
    this.defaultNamespace = options?.namespace ?? 'default';

    this.l1 = new LRUCache<string, CacheValue>({
      max: 100,
      ttl: ttlMs,
      ttlAutopurge: true,
    });

    this.l2 = redisClient;

    logger.info(
      {
        type: 'cache',
        message: 'CacheManager initialized',
        l1Max: 100,
        ttlSeconds: this.defaultTtlSeconds,
        namespace: this.defaultNamespace,
      },
      'Multi-layer cache initialized'
    );
  }

  static getInstance(options?: { namespace?: string }): CacheManager {
    if (CacheManager.instance === null) {
      CacheManager.instance = new CacheManager(options);
    }
    return CacheManager.instance;
  }

  static async resetInstance(): Promise<void> {
    if (CacheManager.instance) {
      await CacheManager.instance.clear();
      await CacheManager.instance.l2.disconnect();
      CacheManager.instance = null;
    }
  }

  private buildKey(key: string, namespace?: string): string {
    const ns = namespace ?? this.defaultNamespace;
    return `${CACHE_KEY_PREFIX}:${ns}:${key}`;
  }

  private getRedisPattern(namespace?: string): string {
    const ns = namespace ?? this.defaultNamespace;
    return `${CACHE_KEY_PREFIX}:${ns}:*`;
  }

  async connect(): Promise<void> {
    await this.l2.connect();
  }

  /**
   * Get value from cache. Checks L1 first, then L2.
   * On L2 hit, promotes value to L1.
   */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  async get(key: string, namespace?: string): Promise<unknown | null> {
    const fullKey = this.buildKey(key, namespace);

    const l1Value = this.l1.get(fullKey);
    if (l1Value !== undefined) {
      this.l1Hits++;
      logger.debug({ type: 'cache', key: fullKey, layer: 'L1' }, 'Cache L1 hit');
      return l1Value;
    }

    let l2Value: string | null = null;
    try {
      l2Value = await this.l2.get(fullKey);
    } catch (error) {
      logger.debug(
        { type: 'cache', key: fullKey, error: (error as Error).message },
        'L2 get failed, Redis may be unavailable'
      );
    }

    if (l2Value !== null) {
      this.l2Hits++;
      try {
        const parsed = JSON.parse(l2Value) as unknown;
        if (parsed !== null && parsed !== undefined) {
          this.l1.set(fullKey, parsed as CacheValue);
        }
        logger.debug({ type: 'cache', key: fullKey, layer: 'L2' }, 'Cache L2 hit, promoted to L1');
        return parsed;
      } catch (error) {
        logger.warn(
          { type: 'cache', key: fullKey, error: (error as Error).message },
          'Failed to parse L2 cache value'
        );
        try {
          await this.l2.del(fullKey);
        } catch {
          /* Redis may be unavailable */
        }
        this.misses++;
        return null;
      }
    }

    this.misses++;
    logger.debug({ type: 'cache', key: fullKey }, 'Cache miss');
    return null;
  }

  /**
   * Set value in both L1 and L2 caches.
   */
  async set(
    key: string,
    value: unknown,
    ttl?: number,
    namespace?: string
  ): Promise<void> {
    const fullKey = this.buildKey(key, namespace);
    const ttlSeconds = ttl ?? this.defaultTtlSeconds;
    const ttlMs = ttlSeconds * 1000;

    if (value !== null && value !== undefined) {
      this.l1.set(fullKey, value as CacheValue, { ttl: ttlMs });
    }

    const serialized = JSON.stringify(value);
    try {
      await this.l2.set(fullKey, serialized, ttlSeconds);
    } catch (error) {
      logger.debug(
        { type: 'cache', key: fullKey, error: (error as Error).message },
        'L2 set failed, Redis may be unavailable'
      );
    }

    logger.debug(
      { type: 'cache', key: fullKey, ttlSeconds },
      'Cache set'
    );
  }

  /**
   * Delete key from both caches.
   */
  async del(key: string, namespace?: string): Promise<void> {
    const fullKey = this.buildKey(key, namespace);
    this.l1.delete(fullKey);
    try {
      await this.l2.del(fullKey);
    } catch (error) {
      logger.debug(
        { type: 'cache', key: fullKey, error: (error as Error).message },
        'L2 del failed, Redis may be unavailable'
      );
    }
    logger.debug({ type: 'cache', key: fullKey }, 'Cache del');
  }

  /**
   * Clear all cache layers. If namespace provided, clear only that namespace.
   */
  async clear(namespace?: string): Promise<void> {
    if (namespace !== undefined) {
      const pattern = this.getRedisPattern(namespace);
      const prefix = `${CACHE_KEY_PREFIX}:${namespace}:`;
      for (const k of this.l1.keys()) {
        if (k.startsWith(prefix)) {
          this.l1.delete(k);
        }
      }
      try {
        await this.l2.clear(pattern);
      } catch (error) {
        logger.debug(
          { type: 'cache', namespace, error: (error as Error).message },
          'L2 clear failed, Redis may be unavailable'
        );
      }
      logger.info({ type: 'cache', namespace }, 'Cache cleared for namespace');
    } else {
      this.l1.clear();
      try {
        await this.l2.clear(`${CACHE_KEY_PREFIX}:*`);
      } catch (error) {
        logger.debug(
          { type: 'cache', error: (error as Error).message },
          'L2 clear failed, Redis may be unavailable'
        );
      }
      logger.info({ type: 'cache' }, 'Cache cleared');
    }
  }

  getStats(): CacheStats {
    const total = this.l1Hits + this.l2Hits + this.misses;
    const hitRate = total > 0 ? (this.l1Hits + this.l2Hits) / total : 0;
    return {
      l1Hits: this.l1Hits,
      l2Hits: this.l2Hits,
      misses: this.misses,
      hitRate,
    };
  }

  resetStats(): void {
    this.l1Hits = 0;
    this.l2Hits = 0;
    this.misses = 0;
  }
}
