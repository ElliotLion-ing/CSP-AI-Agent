/**
 * Filesystem Manager
 * Atomic filesystem operations for resource management
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { createFileSystemError, createValidationError } from '../types/errors';

class FilesystemManager {
  /**
   * Write resource file atomically
   */
  async writeResource(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;

    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // Write to temporary file
      await fs.writeFile(tempPath, content, 'utf-8');

      // Validate content (basic check)
      await this.validateResourceContent(tempPath, content);

      // Atomic rename
      await fs.rename(tempPath, filePath);

      logger.debug({ filePath }, 'Resource file written successfully');
    } catch (error) {
      // Cleanup temporary file
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      throw createFileSystemError('write', filePath, error as Error & { code?: string });
    }
  }

  /**
   * Read resource file with validation
   */
  async readResource(filePath: string): Promise<string> {
    try {
      // Check if file exists
      await fs.access(filePath, fsSync.constants.R_OK);

      // Read file
      const content = await fs.readFile(filePath, 'utf-8');

      // Validate format
      await this.validateResourceContent(filePath, content);

      return content;
    } catch (error) {
      throw createFileSystemError('read', filePath, error as Error & { code?: string });
    }
  }

  /**
   * Delete resource file with backup
   */
  async deleteResource(filePath: string): Promise<void> {
    const backupPath = `${filePath}.backup`;

    try {
      // Create backup
      if (fsSync.existsSync(filePath)) {
        await fs.copyFile(filePath, backupPath);
      }

      // Delete file
      await fs.unlink(filePath);

      // Remove backup on success
      try {
        await fs.unlink(backupPath);
      } catch {
        // Ignore backup cleanup errors
      }

      logger.debug({ filePath }, 'Resource file deleted successfully');
    } catch (error) {
      // Restore from backup on failure
      try {
        if (fsSync.existsSync(backupPath)) {
          await fs.copyFile(backupPath, filePath);
          await fs.unlink(backupPath);
        }
      } catch {
        // Ignore restore errors
      }

      throw createFileSystemError('delete', filePath, error as Error & { code?: string });
    }
  }

  /**
   * Validate resource content
   */
  private async validateResourceContent(filePath: string, content: string): Promise<void> {
    const ext = path.extname(filePath);

    // Check if empty
    if (!content || content.trim().length === 0) {
      throw createValidationError(filePath, ext, 'File content is empty');
    }

    // Validate based on file type
    if (ext === '.json') {
      try {
        JSON.parse(content);
      } catch (error) {
        throw createValidationError(filePath, 'json', 'Invalid JSON format');
      }
    } else if (ext === '.md') {
      // Basic markdown validation (check for minimum content)
      if (content.length < 10) {
        throw createValidationError(filePath, 'markdown', 'Markdown content too short');
      }
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath, fsSync.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List files in directory
   */
  async listFiles(dirPath: string, pattern?: RegExp): Promise<string[]> {
    try {
      const files = await fs.readdir(dirPath, { recursive: true });
      
      if (pattern) {
        return files.filter((file) => pattern.test(file));
      }
      
      return files;
    } catch (error) {
      throw createFileSystemError('list', dirPath, error as Error & { code?: string });
    }
  }

  /**
   * Recursively scan a directory and return all text files as FileEntry[]
   * Supported extensions: .md, .mdc, .txt, .yaml, .yml, .json
   */
  async scanDirectory(dirPath: string): Promise<Array<{ path: string; content: string }>> {
    const TEXT_EXTENSIONS = new Set(['.md', '.mdc', '.txt', '.yaml', '.yml', '.json']);
    const results: Array<{ path: string; content: string }> = [];

    const walk = async (currentPath: string, relBase: string): Promise<void> => {
      let entries: fsSync.Dirent[];
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true });
      } catch (error) {
        throw createFileSystemError('list', currentPath, error as Error & { code?: string });
      }

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relPath = path.join(relBase, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath, relPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (TEXT_EXTENSIONS.has(ext)) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              if (content.trim().length > 0) {
                results.push({ path: relPath, content });
              }
            } catch {
              // Skip unreadable files silently
              logger.warn({ filePath: fullPath }, 'Skipped unreadable file during directory scan');
            }
          }
        }
      }
    };

    await walk(dirPath, '');

    if (results.length === 0) {
      throw createValidationError(
        dirPath,
        'directory',
        `No text files found in directory: ${dirPath}`
      );
    }

    logger.debug({ dirPath, fileCount: results.length }, 'Directory scan completed');
    return results;
  }

  /**
   * Remove empty directories recursively
   */
  async removeEmptyDirs(dirPath: string): Promise<void> {
    try {
      const files = await fs.readdir(dirPath);

      if (files.length === 0) {
        await fs.rmdir(dirPath);
        logger.debug({ dirPath }, 'Empty directory removed');

        // Check parent directory
        const parentDir = path.dirname(dirPath);
        if (parentDir !== dirPath) {
          await this.removeEmptyDirs(parentDir);
        }
      }
    } catch (error) {
      // Ignore errors (directory might not be empty or already deleted)
    }
  }
}

export const filesystemManager = new FilesystemManager();
