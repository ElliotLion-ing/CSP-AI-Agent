/**
 * Log Cleanup Module
 * Automatically deletes log files older than retention period
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { config } from '../config';

// Matches both the canonical name (app-YYYY-MM-DD.log) produced after the
// midnight rename, and the active pino-roll name (app.YYYY-MM-DD.1.log).
const LOG_FILE_PATTERN = /^app[.-]\d{4}-\d{2}-\d{2}[\d.]*\.log$/;

/**
 * Delete log files older than retention days
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function cleanupOldLogs(): Promise<void> {
  const logsDir = path.resolve(process.cwd(), config.logging.dir);

  if (!fs.existsSync(logsDir)) {
    logger.debug('Logs directory does not exist, skipping cleanup');
    return;
  }

  const retentionMs = config.logging.retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  try {
    const files = fs.readdirSync(logsDir);
    let deletedCount = 0;

    for (const file of files) {
      const match = file.match(LOG_FILE_PATTERN);
      if (!match) {
        continue; // Skip non-log files
      }

      const filePath = path.join(logsDir, file);
      const stats = fs.statSync(filePath);
      const fileAge = now - stats.mtimeMs;

      if (fileAge > retentionMs) {
        fs.unlinkSync(filePath);
        deletedCount++;
        logger.info(
          { file, agedays: Math.floor(fileAge / (24 * 60 * 60 * 1000)) },
          `Deleted old log file: ${file}`
        );
      }
    }

    if (deletedCount > 0) {
      logger.info(
        { deletedCount },
        `Log cleanup completed: ${deletedCount} old log files deleted`
      );
    } else {
      logger.debug('Log cleanup completed: no old log files to delete');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to cleanup old log files');
  }
}

/**
 * Start log cleanup scheduler
 * Runs cleanup once per day at 2 AM
 */
export function startLogCleanupSchedule(): NodeJS.Timeout {
  // Run cleanup immediately on startup
  void cleanupOldLogs();

  // Schedule cleanup every 7 days
  const interval = 7 * 24 * 60 * 60 * 1000; // 7 days
  const timer = setInterval(() => {
    void cleanupOldLogs();
  }, interval);

  logger.info({ retentionDays: config.logging.retentionDays }, 'Log cleanup scheduler started');

  return timer;
}

/**
 * Stop log cleanup scheduler
 */
export function stopLogCleanupSchedule(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  logger.info('Log cleanup scheduler stopped');
}
