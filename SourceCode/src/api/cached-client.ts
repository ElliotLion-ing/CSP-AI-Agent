/**
 * Cached API Client
 * Wraps API Client with caching layer
 */

import { CacheManager } from '../cache';
import { apiClient } from './client';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AxiosRequestConfig } from 'axios';

class CachedAPIClient {
  private cache: CacheManager | null = null;
  private readonly cacheNamespace = 'api';

  constructor() {
    if (config.cache.enabled) {
      this.cache = CacheManager.getInstance({ namespace: this.cacheNamespace });
      logger.info('Cached API client initialized with caching enabled');
    } else {
      logger.info('Cached API client initialized without caching');
    }
  }

  /**
   * Initialize cache connection
   */
  async connect(): Promise<void> {
    if (this.cache) {
      await this.cache.connect();
    }
  }

  /**
   * Generate cache key from URL and config
   */
  private generateCacheKey(method: string, url: string, data?: unknown): string {
    const parts = [method.toUpperCase(), url];
    if (data) {
      parts.push(JSON.stringify(data));
    }
    return parts.join(':');
  }

  /**
   * GET request with caching
   */
  async get<T>(url: string, options?: { config?: AxiosRequestConfig; skipCache?: boolean }): Promise<T> {
    const cacheKey = this.generateCacheKey('GET', url);

    // Try cache first (if enabled and not skipped)
    if (this.cache && !options?.skipCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached !== null) {
        logger.debug({ url, cacheKey }, 'API cache hit');
        return cached as T;
      }
      logger.debug({ url, cacheKey }, 'API cache miss');
    }

    // Fetch from API
    const result = await apiClient.get<T>(url, options?.config);

    // Store in cache (if enabled)
    if (this.cache && !options?.skipCache) {
      await this.cache.set(cacheKey, result);
      logger.debug({ url, cacheKey }, 'API response cached');
    }

    return result;
  }

  /**
   * POST request (no caching for mutations)
   */
  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const result = await apiClient.post<T>(url, data, config);

    // Invalidate related cache entries
    if (this.cache) {
      // Clear GET cache for the same URL
      const getCacheKey = this.generateCacheKey('GET', url);
      await this.cache.del(getCacheKey);
      logger.debug({ url }, 'Cache invalidated after POST');
    }

    return result;
  }

  /**
   * PUT request (no caching for mutations)
   */
  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const result = await apiClient.put<T>(url, data, config);

    // Invalidate related cache entries
    if (this.cache) {
      const getCacheKey = this.generateCacheKey('GET', url);
      await this.cache.del(getCacheKey);
      logger.debug({ url }, 'Cache invalidated after PUT');
    }

    return result;
  }

  /**
   * DELETE request (no caching for mutations)
   */
  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const result = await apiClient.delete<T>(url, config);

    // Invalidate related cache entries
    if (this.cache) {
      const getCacheKey = this.generateCacheKey('GET', url);
      await this.cache.del(getCacheKey);
      logger.debug({ url }, 'Cache invalidated after DELETE');
    }

    return result;
  }

  /**
   * Clear all API cache
   */
  async clearCache(): Promise<void> {
    if (this.cache) {
      await this.cache.clear();
      logger.info('API cache cleared');
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    if (this.cache) {
      return this.cache.getStats();
    }
    return null;
  }
}

// Singleton instance
export const cachedAPIClient = new CachedAPIClient();
