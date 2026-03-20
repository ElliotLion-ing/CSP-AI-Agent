/**
 * manage_subscription Tool
 * Manage resource subscriptions
 */

import { logger, logToolCall } from '../utils/logger';
import { apiClient } from '../api/client';
import { MCPServerError, createValidationError } from '../types/errors';
import type { ManageSubscriptionParams, ManageSubscriptionResult, ToolResult } from '../types/tools';
import { syncResources } from './sync-resources';
import { uninstallResource } from './uninstall-resource';

export async function manageSubscription(params: unknown): Promise<ToolResult<ManageSubscriptionResult>> {
  const startTime = Date.now();

  // Type assertion for params
  const typedParams = params as ManageSubscriptionParams;

  logger.info({ tool: 'manage_subscription', params }, 'manage_subscription called');

  try {
    let result: ManageSubscriptionResult;

    switch (typedParams.action) {
      case 'subscribe': {
        // Validate resource_ids
        if (!typedParams.resource_ids || typedParams.resource_ids.length === 0) {
          throw createValidationError(
            'resource_ids',
            'array',
            'resource_ids is required for subscribe action'
          );
        }

        logger.debug({ resourceIds: typedParams.resource_ids, autoSync: typedParams.auto_sync }, 'Subscribing to resources...');

        // Subscribe to resources
        const subResult = await apiClient.subscribe(
          typedParams.resource_ids,
          typedParams.auto_sync,
          undefined,
          typedParams.user_token
        );

        logger.info({ count: subResult.subscriptions.length }, 'Resources subscribed successfully');

        // Auto-sync newly subscribed resources immediately (default: true)
        const shouldAutoSync = typedParams.auto_sync !== false;
        let syncSummary: string | undefined;
        let syncDetails: Array<{ id: string; name: string; action: string }> | undefined;
        let pendingSetup: unknown[] | undefined;

        if (shouldAutoSync && subResult.subscriptions.length > 0) {
          logger.info({ resourceIds: typedParams.resource_ids }, 'Auto-syncing newly subscribed resources...');
          const syncResult = await syncResources({
            mode: 'incremental',
            scope: typedParams.scope || 'global',
            user_token: typedParams.user_token,
          });
          if (syncResult.success && syncResult.data) {
            const sd = syncResult.data;
            syncSummary = `Auto-sync: ${sd.summary.synced} synced, ${sd.summary.cached} cached, ${sd.summary.failed} failed`;
            syncDetails = sd.details.map(d => ({ id: d.id, name: d.name, action: d.action }));
            if (sd.pending_setup && sd.pending_setup.length > 0) {
              pendingSetup = sd.pending_setup;
            }
            logger.info({ summary: sd.summary }, 'Auto-sync after subscribe completed');
          } else {
            logger.warn({ error: syncResult.error }, 'Auto-sync after subscribe failed, subscription still recorded');
            syncSummary = 'Auto-sync failed — run sync_resources manually if needed';
          }
        }

        result = {
          action: 'subscribe',
          success: true,
          subscriptions: subResult.subscriptions.map(sub => ({
            id: sub.id,
            name: sub.name,
            type: sub.type,
            subscribed_at: sub.subscribed_at,
          })),
          message: [
            `Successfully subscribed to ${subResult.subscriptions.length} resource${subResult.subscriptions.length > 1 ? 's' : ''}.`,
            syncSummary,
          ].filter(Boolean).join(' '),
          ...(syncDetails ? { sync_details: syncDetails } : {}),
          ...(pendingSetup ? { pending_setup: pendingSetup } : {}),
        };
        break;
      }

      case 'unsubscribe': {
        // Validate resource_ids
        if (!typedParams.resource_ids || typedParams.resource_ids.length === 0) {
          throw createValidationError(
            'resource_ids',
            'array',
            'resource_ids is required for unsubscribe action'
          );
        }

        logger.debug({ resourceIds: typedParams.resource_ids }, 'Unsubscribing from resources...');

        // Cancel server-side subscription
        await apiClient.unsubscribe(typedParams.resource_ids, typedParams.user_token);
        logger.info({ count: typedParams.resource_ids.length }, 'Server-side subscriptions removed');

        // Uninstall local files and MCP config for each resource
        const uninstallResults: Array<{ id: string; removed: boolean; detail: string }> = [];
        for (const resourceId of typedParams.resource_ids) {
          // Use the last segment of the resource ID as the search pattern
          // e.g. "mcp-client-sdk-ai-hub-jenkins" → "jenkins"
          //      "rule-csp-elliotTest"            → "elliotTest"
          const namePart = resourceId.split('-').slice(-1)[0] ||
                           resourceId.split('-').slice(-2).join('-') ||
                           resourceId;

          // Try full name match first (e.g. "elliotTest"), fallback to last segment
          const patternsToTry = Array.from(new Set([
            resourceId,                                   // full id
            resourceId.replace(/^(skill|cmd|rule|mcp)-[^-]+-/, ''), // strip prefix+source
            namePart,
          ]));

          let uninstalled = false;
          for (const pattern of patternsToTry) {
            const uninstallResult = await uninstallResource({
              resource_id_or_name: pattern,
              remove_from_account: false, // already unsubscribed above
            });
            if (uninstallResult.success && uninstallResult.data && uninstallResult.data.removed_resources.length > 0) {
              uninstallResults.push({ id: resourceId, removed: true, detail: `Removed local files for "${pattern}"` });
              uninstalled = true;
              break;
            }
          }
          if (!uninstalled) {
            uninstallResults.push({ id: resourceId, removed: false, detail: 'No local files found (may not have been installed)' });
          }
        }

        const removedCount = uninstallResults.filter(r => r.removed).length;
        const notFoundCount = uninstallResults.filter(r => !r.removed).length;

        result = {
          action: 'unsubscribe',
          success: true,
          message: [
            `Successfully unsubscribed from ${typedParams.resource_ids.length} resource${typedParams.resource_ids.length > 1 ? 's' : ''}.`,
            removedCount > 0 ? `Removed local files for ${removedCount} resource${removedCount > 1 ? 's' : ''}.` : null,
            notFoundCount > 0 ? `${notFoundCount} resource${notFoundCount > 1 ? 's were' : ' was'} not installed locally.` : null,
          ].filter(Boolean).join(' '),
          sync_details: uninstallResults.map(r => ({ id: r.id, name: r.id, action: r.removed ? 'uninstalled' : 'not_found_locally' })),
        };

        logger.info({ count: typedParams.resource_ids.length, removedCount }, 'Resources unsubscribed and local files cleaned up');
        break;
      }

      case 'list': {
        logger.debug({ scope: typedParams.scope || 'all' }, 'Listing subscriptions...');

        // Get subscriptions list
        const subs = await apiClient.getSubscriptions({}, typedParams.user_token);

        result = {
          action: 'list',
          success: true,
          subscriptions: subs.subscriptions.map(sub => ({
            id: sub.id,
            name: sub.name,
            type: sub.type,
            subscribed_at: sub.subscribed_at,
          })),
          message: `Found ${subs.total} subscription${subs.total !== 1 ? 's' : ''}`,
        };

        logger.info({ total: subs.total }, 'Subscriptions listed successfully');
        break;
      }

      case 'batch_subscribe': {
        // Validate resource_ids
        if (!typedParams.resource_ids || typedParams.resource_ids.length === 0) {
          throw createValidationError(
            'resource_ids',
            'array',
            'resource_ids is required for batch_subscribe action'
          );
        }

        logger.debug({ count: typedParams.resource_ids.length, autoSync: typedParams.auto_sync }, 'Batch subscribing to resources...');

        const batchSubResult = await apiClient.subscribe(
          typedParams.resource_ids,
          typedParams.auto_sync,
          undefined,
          typedParams.user_token
        );

        logger.info({ count: batchSubResult.subscriptions.length }, 'Batch subscription completed');

        // Auto-sync newly subscribed resources immediately (default: true)
        const shouldBatchAutoSync = typedParams.auto_sync !== false;
        let batchSyncSummary: string | undefined;
        let batchSyncDetails: Array<{ id: string; name: string; action: string }> | undefined;
        let batchPendingSetup: unknown[] | undefined;

        if (shouldBatchAutoSync && batchSubResult.subscriptions.length > 0) {
          logger.info({ count: batchSubResult.subscriptions.length }, 'Auto-syncing batch subscribed resources...');
          const batchSyncResult = await syncResources({
            mode: 'incremental',
            scope: typedParams.scope || 'global',
            user_token: typedParams.user_token,
          });
          if (batchSyncResult.success && batchSyncResult.data) {
            const sd = batchSyncResult.data;
            batchSyncSummary = `Auto-sync: ${sd.summary.synced} synced, ${sd.summary.cached} cached, ${sd.summary.failed} failed`;
            batchSyncDetails = sd.details.map(d => ({ id: d.id, name: d.name, action: d.action }));
            if (sd.pending_setup && sd.pending_setup.length > 0) {
              batchPendingSetup = sd.pending_setup;
            }
          } else {
            batchSyncSummary = 'Auto-sync failed — run sync_resources manually if needed';
          }
        }

        result = {
          action: 'batch_subscribe',
          success: true,
          subscriptions: batchSubResult.subscriptions.map(sub => ({
            id: sub.id,
            name: sub.name,
            type: sub.type,
            subscribed_at: sub.subscribed_at,
          })),
          message: [
            `Successfully batch subscribed to ${batchSubResult.subscriptions.length} resource${batchSubResult.subscriptions.length > 1 ? 's' : ''}.`,
            batchSyncSummary,
          ].filter(Boolean).join(' '),
          ...(batchSyncDetails ? { sync_details: batchSyncDetails } : {}),
          ...(batchPendingSetup ? { pending_setup: batchPendingSetup } : {}),
        };
        break;
      }

      case 'batch_unsubscribe': {
        // Validate resource_ids
        if (!typedParams.resource_ids || typedParams.resource_ids.length === 0) {
          throw createValidationError(
            'resource_ids',
            'array',
            'resource_ids is required for batch_unsubscribe action'
          );
        }

        logger.debug({ count: typedParams.resource_ids.length }, 'Batch unsubscribing from resources...');

        // Delegate entirely to the unsubscribe case for unified cleanup logic
        return manageSubscription({ ...typedParams, action: 'unsubscribe' });
      }

      default: {
        throw createValidationError(
          'action',
          'string',
          `Unknown action. Must be one of: subscribe, unsubscribe, list, batch_subscribe, batch_unsubscribe`
        );
      }
    }

    const duration = Date.now() - startTime;
    logToolCall('manage_subscription', 'user-id', params as Record<string, unknown>, duration);

    logger.info(
      {
        action: typedParams.action,
        duration,
      },
      'manage_subscription completed successfully'
    );

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    logger.error({ error, action: typedParams.action }, 'manage_subscription failed');
    return {
      success: false,
      error: {
        code: error instanceof MCPServerError ? error.code : 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

// Tool definition for registry
export const manageSubscriptionTool = {
  name: 'manage_subscription',
  description:
    'Manage resource subscriptions (subscribe, unsubscribe, list). ' +
    'When action is "subscribe" or "batch_subscribe", the tool automatically syncs ' +
    'the newly subscribed resources to the local machine immediately after subscribing ' +
    '(auto_sync defaults to true). Pass auto_sync: false only when the user explicitly ' +
    'says they do NOT want the resource installed right now.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform',
        enum: ['subscribe', 'unsubscribe', 'list', 'batch_subscribe', 'batch_unsubscribe'],
      },
      resource_ids: {
        type: 'array',
        description: 'Resource IDs (required for subscribe/unsubscribe actions)',
      },
      auto_sync: {
        type: 'boolean',
        description:
          'Whether to immediately sync (install) the subscribed resources to the local machine after subscribing. ' +
          'Defaults to true — omit this field in normal usage. ' +
          'Set to false only when the user explicitly says they want to subscribe but NOT install yet.',
        default: true,
      },
      scope: {
        type: 'string',
        description: 'Installation scope',
        enum: ['global', 'workspace'],
        default: 'global',
      },
      notify: {
        type: 'boolean',
        description: 'Enable update notifications',
        default: true,
      },
      user_token: {
        type: 'string',
        description:
          'CSP API token for the current user. Read this from the CSP_API_TOKEN environment ' +
          'variable configured in the user\'s mcp.json. When provided, this token is used ' +
          'for all CSP API calls in this request instead of the server-level fallback token.',
      },
    },
    required: ['action'],
  },
  handler: manageSubscription,
};
