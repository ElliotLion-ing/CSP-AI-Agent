/**
 * Redis Client Module
 * Connection management with retry strategy and basic cache operations
 */

import Redis, { type Redis as RedisInstance } from 'ioredis';
import { logger, logError } from '../utils/logger';
import { config } from '../config';

const RETRY_BASE_MS = 100;
const RETRY_MAX_MS = 5000;
const RETRY_MAX_ATTEMPTS = 10;

/**
 * Exponential backoff: base * 2^times, capped at max
 */
function exponentialBackoff(times: number): number {
  if (times > RETRY_MAX_ATTEMPTS) {
    return 0; // Stop retrying
  }
  const delay = Math.min(RETRY_BASE_MS * Math.pow(2, times), RETRY_MAX_MS);
  return delay;
}

export class RedisClient {
  private static instance: RedisClient | null = null;
  private client: RedisInstance | null = null;
  private isConnecting = false;

  private constructor() {}

  static getInstance(): RedisClient {
    if (RedisClient.instance === null) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  /**
   * Connect to Redis with config and retry strategy
   */
  async connect(): Promise<void> {
    const redisConfig = config.cache?.redis;
    if (!redisConfig?.url) {
      logger.warn(
        { type: 'redis', event: 'connect_skipped' },
        'Redis URL not configured (REDIS_URL), skipping connection'
      );
      return;
    }

    if (this.client && this.isConnected()) {
      logger.debug({ type: 'redis', event: 'connect' }, 'Redis already connected');
      return;
    }

    if (this.isConnecting) {
      logger.debug({ type: 'redis', event: 'connect' }, 'Redis connection in progress');
      return;
    }

    this.isConnecting = true;

    try {
      this.client = new Redis(redisConfig.url, {
        retryStrategy: (times: number) => {
          const delay = exponentialBackoff(times);
          if (delay === 0) {
            logger.error(
              { type: 'redis', event: 'retry_exhausted', times },
              'Redis retry exhausted, giving up'
            );
            return undefined;
          }
          logger.warn(
            { type: 'redis', event: 'retry', times, delayMs: delay },
            `Redis reconnecting in ${delay}ms (attempt ${times})`
          );
          return delay;
        },
        maxRetriesPerRequest: null,
        connectTimeout: 10000,
        lazyConnect: true,
      });

      this.client.on('connect', () => {
        logger.info(
          { type: 'redis', event: 'connect' },
          'Redis connection established'
        );
      });

      this.client.on('ready', () => {
        this.isConnecting = false;
        logger.info(
          { type: 'redis', event: 'ready' },
          'Redis client ready'
        );
      });

      this.client.on('error', (err: Error) => {
        logger.error(
          { type: 'redis', event: 'error', error: err.message },
          `Redis error: ${err.message}`
        );
      });

      this.client.on('close', () => {
        logger.info(
          { type: 'redis', event: 'close' },
          'Redis connection closed'
        );
      });

      await this.client.connect();
    } catch (error) {
      this.isConnecting = false;
      if (this.client) {
        this.client.disconnect();
        this.client = null;
      }
      logError(error as Error, { type: 'redis', event: 'connect_failed' });
      throw error;
    }
  }

  /**
   * Gracefully disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (!this.client) {
      logger.debug({ type: 'redis', event: 'disconnect' }, 'Redis not connected');
      return;
    }

    try {
      await this.client.quit();
      this.client = null;
      logger.info(
        { type: 'redis', event: 'disconnect' },
        'Redis disconnected gracefully'
      );
    } catch (error) {
      logError(error as Error, { type: 'redis', event: 'disconnect_failed' });
      this.client = null;
      throw error;
    }
  }

  /**
   * Check if Redis client is connected
   */
  isConnected(): boolean {
    return this.client?.status === 'ready';
  }

  /**
   * Get value by key
   */
  async get(key: string): Promise<string | null> {
    if (!this.client) {
      logger.warn({ type: 'redis', operation: 'get', key }, 'Redis not connected');
      return null;
    }

    try {
      const value = await this.client.get(key);
      return value;
    } catch (error) {
      logError(error as Error, { type: 'redis', operation: 'get', key });
      throw error;
    }
  }

  /**
   * Set value with optional TTL (seconds)
   */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.client) {
      logger.warn({ type: 'redis', operation: 'set', key }, 'Redis not connected');
      throw new Error('Redis not connected');
    }

    try {
      const ttlSeconds = ttl ?? config.cache?.redis?.ttl ?? 900;
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (error) {
      logError(error as Error, { type: 'redis', operation: 'set', key });
      throw error;
    }
  }

  /**
   * Delete key
   */
  async del(key: string): Promise<void> {
    if (!this.client) {
      logger.warn({ type: 'redis', operation: 'del', key }, 'Redis not connected');
      throw new Error('Redis not connected');
    }

    try {
      await this.client.del(key);
    } catch (error) {
      logError(error as Error, { type: 'redis', operation: 'del', key });
      throw error;
    }
  }

  /**
   * Clear all keys matching a pattern. Use with caution.
   */
  async clear(pattern = '*'): Promise<void> {
    if (!this.client) {
      logger.warn({ type: 'redis', operation: 'clear', pattern }, 'Redis not connected');
      throw new Error('Redis not connected');
    }

    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (error) {
      logError(error as Error, { type: 'redis', operation: 'clear', pattern });
      throw error;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.client) {
      logger.warn({ type: 'redis', operation: 'exists', key }, 'Redis not connected');
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logError(error as Error, { type: 'redis', operation: 'exists', key });
      throw error;
    }
  }
}

export const redisClient = RedisClient.getInstance();
