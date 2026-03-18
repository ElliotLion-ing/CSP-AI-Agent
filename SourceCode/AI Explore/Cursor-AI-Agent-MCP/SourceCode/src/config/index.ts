/**
 * Configuration Management Module
 * Loads and validates configuration from environment variables
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env file if exists
// Try multiple paths to find .env file
const possibleEnvPaths = [
  path.resolve(process.cwd(), '.env'),                    // Current working directory
  path.resolve(__dirname, '../../.env'),                  // Relative to compiled dist/config/
  path.resolve(__dirname, '../../../.env'),               // Project root (if deeper nesting)
];

let envLoaded = false;
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`✓ Loaded .env from: ${envPath}`);
    envLoaded = true;
    break;
  }
}

if (!envLoaded) {
  console.warn('⚠ No .env file found, using environment variables only');
}

export interface Config {
  // Environment
  nodeEnv: 'development' | 'production' | 'test';

  // Server
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  // Transport
  transport: {
    mode: 'stdio' | 'sse';
  };

  // HTTP Server (for SSE transport)
  http?: {
    host: string;
    port: number;
  };

  // Session (for SSE transport)
  session?: {
    timeout: number; // seconds
  };

  // CSP API
  csp: {
    apiBaseUrl: string;
    apiToken: string;
    timeout: number;
  };

  // Git — only commit author info; repo URLs/branches live in ai-resources-config.json
  git: {
    userName: string;
    userEmail: string;
  };

  // Resource Storage — resolved at runtime via cursor-paths utility.
  // No longer stored in config; use getCursorTypeDir() / getCursorResourcePath() directly.
  // Kept as an empty marker so consumers know where to look.
  resource: Record<string, never>;

  // Cache (optional)
  cache: {
    enabled: boolean;
    redis?: {
      url: string;
      ttl: number;
    };
    memory: {
      maxSize: number;
    };
  };

  // Database (optional)
  database?: {
    url: string;
  };

  // Monitoring (optional)
  metrics: {
    enabled: boolean;
    port?: number;
  };

  // Logging
  logging: {
    dir: string;
    retentionDays: number;
  };
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${value}`);
  }
  return parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

export function loadConfig(): Config {
  const nodeEnv = (process.env.NODE_ENV || 'development') as Config['nodeEnv'];
  const logLevel = (process.env.LOG_LEVEL || 'info') as Config['logLevel'];
  const transportMode = (process.env.TRANSPORT_MODE || 'stdio') as 'stdio' | 'sse';

  // Debug: Log CSP_API_TOKEN to verify it was loaded
  console.log(`🔑 CSP_API_TOKEN from env: ${process.env.CSP_API_TOKEN ? process.env.CSP_API_TOKEN.substring(0, 20) + '...' : 'NOT SET'}`);

  return {
    nodeEnv,
    port: getEnvNumber('PORT', 5090),
    logLevel,

    transport: {
      mode: transportMode,
    },

    http: transportMode === 'sse' ? {
      host: getEnv('HTTP_HOST', '0.0.0.0'),
      port: getEnvNumber('HTTP_PORT', 3000),
    } : undefined,

    session: transportMode === 'sse' ? {
      timeout: getEnvNumber('SESSION_TIMEOUT', 3600),
    } : undefined,

    csp: {
      apiBaseUrl: getEnv('CSP_API_BASE_URL', 'https://csp.example.com'),
      apiToken: getEnv('CSP_API_TOKEN', 'test-token-12345'),
      timeout: getEnvNumber('CSP_API_TIMEOUT', 30000),
    },

    git: {
      userName: getEnv('GIT_USER_NAME', 'CSP Agent'),
      userEmail: getEnv('GIT_USER_EMAIL', 'agent@example.com'),
    },

    resource: {},

    cache: {
      enabled: getEnvBoolean('ENABLE_CACHE', true),
      redis: process.env.REDIS_URL
        ? {
            url: process.env.REDIS_URL,
            ttl: getEnvNumber('REDIS_TTL', 900),
          }
        : undefined,
      memory: {
        maxSize: getEnvNumber('CACHE_MAX_SIZE', 100),
      },
    },

    database: process.env.DATABASE_URL
      ? {
          url: process.env.DATABASE_URL,
        }
      : undefined,

    metrics: {
      enabled: getEnvBoolean('ENABLE_METRICS', true),
      port: process.env.METRICS_PORT ? getEnvNumber('METRICS_PORT') : undefined,
    },

    logging: {
      dir: getEnv('LOG_DIR', '../Logs'),
      retentionDays: getEnvNumber('LOG_RETENTION_DAYS', 3),
    },
  };
}

// Validate configuration on load
let config: Config;

try {
  config = loadConfig();
} catch (error) {
  // Use logger for consistent error reporting
  const logger = require('../utils/logger').logger;
  logger.error(
    { 
      type: 'config', 
      operation: 'load_config', 
      error: (error as Error).message,
      stack: (error as Error).stack
    },
    'Configuration loading failed'
  );
  process.exit(1);
}

export { config };
