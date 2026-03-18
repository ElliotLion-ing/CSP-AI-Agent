/**
 * REST API Client
 * HTTP client for CSP Resource Server
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { config } from '../config';
import { logger, logApiRequest, logApiError } from '../utils/logger';
import { createAPIError } from '../types/errors';

class APIClient {
  private client: AxiosInstance;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second

  constructor() {
    this.client = axios.create({
      baseURL: config.csp.apiBaseUrl,
      timeout: config.csp.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `csp-ai-agent-mcp/0.2.0`,
      },
    });

    // Request interceptor for authentication and logging
    this.client.interceptors.request.use(
      (requestConfig) => {
        if (config.csp.apiToken) {
          requestConfig.headers.Authorization = `Bearer ${config.csp.apiToken}`;
        }
        
        // Enhanced request logging
        logger.debug(
          {
            type: 'api_request_start',
            method: requestConfig.method?.toUpperCase(),
            url: requestConfig.url,
            params: requestConfig.params,
            data: requestConfig.data ? JSON.stringify(requestConfig.data).substring(0, 500) : undefined,
            headers: this.sanitizeHeaders(requestConfig.headers as Record<string, string>),
          },
          `API Request: ${requestConfig.method?.toUpperCase()} ${requestConfig.url}`
        );
        
        // Record start time for duration calculation
        (requestConfig as any).startTime = Date.now();
        
        return requestConfig;
      },
      (error) => {
        logger.error({ 
          type: 'api_request_interceptor_error',
          error: error.message 
        }, 'API request interceptor error');
        return Promise.reject(error);
      }
    );

    // Response interceptor for detailed logging
    this.client.interceptors.response.use(
      (response) => {
        const startTime = (response.config as any).startTime || Date.now();
        const duration = Date.now() - startTime;
        const method = response.config.method?.toUpperCase() || 'UNKNOWN';
        const url = response.config.url || 'unknown';
        
        // Enhanced response logging
        logApiRequest(
          method,
          url,
          response.status,
          duration,
          response.config.data,
          response.data,
          response.headers as Record<string, string>
        );
        
        return response;
      },
      (error: AxiosError) => {
        const startTime = (error.config as any)?.startTime || Date.now();
        const duration = Date.now() - startTime;
        const statusCode = error.response?.status;
        const method = error.config?.method?.toUpperCase() || 'UNKNOWN';
        const url = error.config?.url || 'unknown';

        // Enhanced error logging
        logApiError(
          method,
          url,
          error,
          error.config?.data,
          statusCode
        );
        
        // Log response details if available
        if (error.response) {
          logger.error(
            {
              type: 'api_response_error',
              method,
              url,
              status: statusCode,
              statusText: error.response.statusText,
              responseData: error.response.data ? JSON.stringify(error.response.data).substring(0, 1000) : undefined,
              duration,
            },
            `API Error Response: ${method} ${url} - ${statusCode}`
          );
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Sanitize headers to hide sensitive information
   */
  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized = { ...headers };
    if (sanitized['Authorization'] || sanitized['authorization']) {
      const key = sanitized['Authorization'] ? 'Authorization' : 'authorization';
      const value = sanitized[key];
      if (value && value.startsWith('Bearer ')) {
        const token = value.substring(7);
        sanitized[key] = `Bearer ${token.substring(0, 10)}...${token.substring(token.length - 10)}`;
      }
    }
    return sanitized;
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry<T>(
    requestFn: () => Promise<T>,
    method: string,
    url: string,
    retryCount = 0
  ): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      const isNetworkError =
        error instanceof AxiosError &&
        (!error.response || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT');

      if (isNetworkError && retryCount < this.maxRetries) {
        const delay = this.retryDelay * Math.pow(2, retryCount);
        logger.warn(
          {
            method,
            url,
            retryCount: retryCount + 1,
            maxRetries: this.maxRetries,
            delay,
          },
          `API request failed, retrying in ${delay}ms...`
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.executeWithRetry(requestFn, method, url, retryCount + 1);
      }

      // Transform axios error to APIError
      if (error instanceof AxiosError) {
        throw createAPIError(
          method,
          url,
          error,
          error.response?.status,
          retryCount
        );
      }

      throw error;
    }
  }

  /**
   * GET request
   */
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.executeWithRetry(
      async () => {
        const response = await this.client.get<T>(url, config);
        return response.data;
      },
      'GET',
      url
    );
  }

  /**
   * POST request
   */
  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.executeWithRetry(
      async () => {
        const response = await this.client.post<T>(url, data, config);
        return response.data;
      },
      'POST',
      url
    );
  }

  /**
   * PUT request
   */
  async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.executeWithRetry(
      async () => {
        const response = await this.client.put<T>(url, data, config);
        return response.data;
      },
      'PUT',
      url
    );
  }

  /**
   * DELETE request
   */
  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.executeWithRetry(
      async () => {
        const response = await this.client.delete<T>(url, config);
        return response.data;
      },
      'DELETE',
      url
    );
  }

  //===========================================
  // CSP Resource Server API Endpoints
  //===========================================

  /**
   * Get subscription list
   */
  async getSubscriptions(params?: {
    scope?: 'general' | 'team' | 'user' | 'all';
    types?: string[];
    detail?: boolean;  // Added: include detailed metadata
  }): Promise<{
    total: number;
    subscriptions: Array<{
      id: string;
      name: string;
      type: string;
      team: string;
      subscribed_at: string;
      auto_sync: boolean;
      resource: {
        version: string;
        hash: string;
        download_url: string;
      };
    }>;
  }> {
    const response = await this.get<{
      code: number;
      result: string;
      data: {
        total: number;
        subscriptions: Array<{
          id: string;
          name: string;
          type: string;
          team: string;
          subscribed_at: string;
          auto_sync: boolean;
          resource: {
            version: string;
            hash: string;
            download_url: string;
          };
        }>;
      };
    }>('/csp/api/resources/subscriptions', { params });
    
    // Extract data from CSP API response format
    if (!response.data) {
      throw new Error('Invalid API response: missing data field');
    }
    
    return response.data;
  }

  /**
   * Subscribe to resource
   */
  async subscribe(
    resourceIds: string[], 
    autoSync = true,
    scope?: 'general' | 'team' | 'user'  // Added: subscription scope
  ): Promise<{
    success: boolean;
    subscriptions: Array<{ 
      id: string; 
      name: string;
      type: string;
      subscribed_at: string;
    }>;
  }> {
    const response = await this.post<{
      code: number;
      result: string;
      data: {
        success?: boolean;
        subscriptions: Array<{ 
          id: string; 
          name: string;
          type: string;
          subscribed_at: string;
        }>;
      };
    }>('/csp/api/resources/subscriptions/add', {
      resource_ids: resourceIds,
      auto_sync: autoSync,
      scope,
    });
    
    if (!response.data) {
      throw new Error('Invalid API response: missing data field');
    }
    
    return {
      success: true,
      subscriptions: response.data.subscriptions
    };
  }

  /**
   * Unsubscribe from resource
   */
  async unsubscribe(resourceIds: string | string[]): Promise<void> {
    // Support batch unsubscribe
    const ids = Array.isArray(resourceIds) ? resourceIds : [resourceIds];
    const response = await this.delete<{
      code: number;
      result: string;
      data: { removed_count: number };
    }>('/csp/api/resources/subscriptions/remove', {
      data: { resource_ids: ids }
    });
    
    // Just validate response, no need to return anything
    if (!response.data) {
      throw new Error('Invalid API response: missing data field');
    }
  }

  /**
   * Search resources
   */
  async searchResources(params: {
    keyword: string;
    team?: string;
    type?: string;
    detail?: boolean;      // Added: include detailed metadata
    page?: number;         // Added: pagination
    page_size?: number;    // Added: page size
  }): Promise<{
    total: number;
    page?: number;
    page_size?: number;
    results: Array<{
      id: string;
      name: string;
      type: string;
      team: string;
      version: string;
      description: string;
      score: number;
      is_subscribed: boolean;
      metadata?: {
        module: string;
        tags: string[];
        author: string;
        created_at: string;
        updated_at: string;
        downloads: number;
      };
    }>;
  }> {
    const response = await this.get<{
      code: number;
      result: string;
      data: {
        total: number;
        page?: number;
        page_size?: number;
        results: Array<{
          id: string;
          name: string;
          type: string;
          team: string;
          version: string;
          description: string;
          score?: number;
          is_subscribed?: boolean;
          download_url?: string;
          metadata?: {
            module: string;
            tags: string[];
            author: string;
            created_at: string;
            updated_at: string;
            downloads: number;
          };
        }>;
      };
    }>('/csp/api/resources/search', { params });
    
    // Extract data from CSP API response format
    if (!response.data) {
      throw new Error('Invalid API response: missing data field');
    }
    
    return {
      total: response.data.total,
      page: response.data.page,
      page_size: response.data.page_size,
      results: response.data.results.map(r => ({
        ...r,
        score: r.score || 0,
        is_subscribed: r.is_subscribed || false
      }))
    };
  }

  /**
   * Download resource — returns all files for the resource.
   *
   * GET /csp/api/resources/download/{id}
   * Response: { data: { resource_id, name, type, version, hash, files: [{path, content}] } }
   *
   * files[].path is the relative path within the resource directory.
   * Single-file resources (command, rule) have exactly one element.
   * Multi-file resources (skill, mcp) have all their files included.
   */
  async downloadResource(resourceId: string): Promise<{
    resource_id: string;
    name: string;
    type: string;
    version: string;
    hash: string;
    files: Array<{ path: string; content: string }>;
  }> {
    const response = await this.get<{
      code: number;
      result: string;
      data: {
        resource_id: string;
        name: string;
        type: string;
        version: string;
        hash: string;
        files: Array<{ path: string; content: string }>;
      };
    }>(`/csp/api/resources/download/${resourceId}`);
    return response.data;
  }

  /**
   * Get resource detail
   */
  async getResourceDetail(resourceId: string): Promise<{
    id: string;
    name: string;
    type: string;
    team: string;
    version: string;
    description: string;
    metadata: {
      module: string;
      tags: string[];
      author: string;
      created_at: string;
      updated_at: string;
      downloads: number;
      file_size: number;
      hash: string;
    };
    download_url: string;
  }> {
    return this.get(`/csp/api/resources/${resourceId}`);
  }

  /**
   * Stage resource files for upload (Step 1 of two-step upload flow).
   *
   * POST /csp/api/resources/upload
   * Body: { type, name, files: [{ path, content }] }
   * Response: { upload_id, status, expires_at, preview_url }
   *
   * The server validates path traversal, total size (< 10 MB), and name conflicts.
   * All file types are supported — mcp packages may include .py, .js, package.json, etc.
   */
  async uploadResourceFiles(params: {
    type: string;
    name: string;
    files: Array<{ path: string; content: string }>;
    target_source?: string;
    force?: boolean;
  }): Promise<{
    upload_id: string;
    status: string;
    expires_at: string;
    preview_url?: string;
  }> {
    const resp = await this.post<{ code: number; result: string; data: { upload_id: string; status: string; expires_at: string; preview_url?: string } }>(
      '/csp/api/resources/upload', params
    );
    return resp.data;
  }

  /**
   * Finalize staged upload — triggers Git commit (Step 2 of two-step upload flow).
   *
   * POST /csp/api/resources/finalize
   * Body: { upload_id, commit_message }
   * Response: { resource_id, version, url, commit_hash, download_url }
   */
  async finalizeResourceUpload(uploadId: string, commitMessage: string): Promise<{
    resource_id: string;
    version?: string;
    url?: string;
    commit_hash?: string;
    download_url?: string;
  }> {
    const resp = await this.post<{ code: number; result: string; data: { resource_id: string; version?: string; url?: string; commit_hash?: string; download_url?: string } }>(
      '/csp/api/resources/finalize', {
        upload_id: uploadId,
        commit_message: commitMessage,
      }
    );
    return resp.data;
  }

  /**
   * @deprecated Use uploadResourceFiles() + finalizeResourceUpload() instead.
   */
  async uploadResource(params: {
    name: string;
    type: string;
    team: string;
    description?: string;
    tags?: string[];
  }): Promise<{
    upload_id: string;
    upload_url: string;
    expires_at: string;
  }> {
    return this.post('/csp/api/resources/upload', params);
  }

  /**
   * @deprecated Use finalizeResourceUpload() instead.
   */
  async finalizeUpload(uploadId: string, hash: string): Promise<{
    resource_id: string;
    status: string;
  }> {
    return this.post('/csp/api/resources/finalize', {
      upload_id: uploadId,
      hash,
    });
  }
}

// Export singleton instance
export const apiClient = new APIClient();
