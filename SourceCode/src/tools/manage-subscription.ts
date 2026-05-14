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
import { promptManager } from '../prompts/index.js';
import { getCspAgentDirForClient } from '../utils/cursor-paths.js';
import { adapterRegistry, type AgentProfile } from '../client-adapters/index.js';
import { config } from '../config/index.js';

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
        promptManager.clearSuppressedSubscriptions(typedParams.user_token ?? '', typedParams.resource_ids);

        logger.info({ count: subResult.subscriptions.length }, 'Resources subscribed successfully');

        // Auto-sync newly subscribed resources immediately (default: true)
        const shouldAutoSync = typedParams.auto_sync !== false;
        let syncSummary: string | undefined;
        let syncDetails: Array<{ id: string; name: string; action: string }> | undefined;
        let pendingSetup: unknown[] | undefined;
        let subscribeLocalActions: import('../types/tools.js').LocalAction[] | undefined;

        if (shouldAutoSync && subResult.subscriptions.length > 0) {
          logger.info({ resourceIds: typedParams.resource_ids }, 'Auto-syncing newly subscribed resources...');
          // Scope auto-sync to only the newly subscribed resource(s).
          // Passing resource_ids prevents processing all other subscribed resources,
          // which would generate unnecessary local_actions and waste context window.
          const syncResult = await syncResources({
            mode: 'incremental',
            scope: typedParams.scope || 'global',
            user_token: typedParams.user_token,
            resource_ids: typedParams.resource_ids,
            agent_profile: typedParams.agent_profile,
          });
          if (syncResult.success && syncResult.data) {
            const sd = syncResult.data;
            syncSummary = `Auto-sync: ${sd.summary.synced} synced, ${sd.summary.cached} cached, ${sd.summary.failed} failed`;
            syncDetails = sd.details.map(d => ({ id: d.id, name: d.name, action: d.action }));
            if (sd.pending_setup && sd.pending_setup.length > 0) {
              pendingSetup = sd.pending_setup;
            }
            if (sd.local_actions_required && sd.local_actions_required.length > 0) {
              subscribeLocalActions = sd.local_actions_required;
            }
            logger.info({ summary: sd.summary }, 'Auto-sync after subscribe completed');
          } else {
            logger.warn({ error: syncResult.error }, 'Auto-sync after subscribe failed, subscription still recorded');
            syncSummary = 'Auto-sync failed — run sync_resources manually if needed';
          }
        }

        // Build per-resource sync hint so the AI knows to use resource_ids
        // for a scoped incremental sync instead of syncing all resources.
        const subscribedIds = subResult.subscriptions.map(s => s.id);
        const syncHint = subscribedIds.length > 0
          ? `To sync ONLY the newly subscribed resource(s), call: sync_resources(mode="incremental", resource_ids=${JSON.stringify(subscribedIds)}). This avoids returning local_actions for ALL subscribed resources and drastically reduces context overhead.`
          : undefined;

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
            syncHint,
            subscribeLocalActions && subscribeLocalActions.length > 0
              ? `IMPORTANT: ${subscribeLocalActions.length} local action(s) are still pending. Execute local_actions_required or fetch csp-ai-agent-setup before treating the resource as installed.`
              : null,
            'If you need to execute a newly subscribed Command or Skill in this same conversation, call resolve_prompt_content next to retrieve the real prompt body.',
          ].filter(Boolean).join(' '),
          ...(syncDetails ? { sync_details: syncDetails } : {}),
          ...(pendingSetup ? { pending_setup: pendingSetup } : {}),
          ...(subscribeLocalActions ? { local_actions_required: subscribeLocalActions } : {}),
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

        // Resolve the client adapter: prefer caller-supplied agent_profile, fall
        // back to server-wide config (set via CSP_AGENT_PROFILE env var).
        // This mirrors the same resolution logic in sync-resources.ts so that
        // Codex unsubscribes emit remove_toml_entry instead of remove_mcp_json_entry.
        const resolvedUnsubProfile: AgentProfile =
          (typedParams.agent_profile as AgentProfile | undefined) ?? config.agentProfile ?? 'cursor';
        const unsubClientAdapter = adapterRegistry.get(resolvedUnsubProfile);

        logger.debug({ resourceIds: typedParams.resource_ids }, 'Unsubscribing from resources...');

        // Build resource_id → type and resource_id → name maps from the current
        // subscription list so uninstall actions can be scoped precisely to
        // rule vs mcp resources, and the correct server_name (e.g. "acm") is
        // used in remove_mcp_json_entry instead of the raw UUID.
        const idToType: Map<string, string> = new Map();
        const idToName: Map<string, string> = new Map();
        try {
          const currentSubs = await apiClient.getSubscriptions({}, typedParams.user_token);
          for (const s of currentSubs.subscriptions) {
            idToType.set(s.id, s.type);
            if (s.name) {
              idToName.set(s.id, s.name);
            }
          }
        } catch (e) {
          logger.warn({ error: (e as Error).message }, 'Could not fetch subscriptions for type resolution — uninstall will emit both rule+mcp actions as fallback');
        }

        // Cancel server-side subscription.  Baseline/default subscriptions may
        // be exposed by list/search but have no removable user row on the
        // server; in that case the API returns removed_count=0.  Do not abort
        // local cleanup here: apply a local suppression after verification so
        // prompts/list/search/sync are consistent for this user.
        const unsubscribeResponse = await apiClient.unsubscribe(typedParams.resource_ids, typedParams.user_token);
        const serverRemovedAll = unsubscribeResponse.removed_count === typedParams.resource_ids.length;
        if (!serverRemovedAll) {
          logger.warn(
            {
              requested: unsubscribeResponse.requested_count,
              removed: unsubscribeResponse.removed_count,
              resourceIds: typedParams.resource_ids,
            },
            'Unsubscribe API reported partial removal; continuing local cleanup and will verify list state',
          );
        }
        logger.info(
          { requested: unsubscribeResponse.requested_count, removed: unsubscribeResponse.removed_count },
          'Server-side subscriptions removed',
        );

        // Uninstall local files and MCP config for each resource.
        // For Command/Skill: unregister MCP Prompt instead of deleting local files.
        const uninstallResults: Array<{ id: string; removed: boolean; detail: string }> = [];
        // Collect local_actions_required from skill cleanup to return to the AI.
        const unsubscribeLocalActions: import('../types/tools.js').LocalAction[] = [];
        for (const resourceId of typedParams.resource_ids) {
          // Determine if this is a Command or Skill by checking the prompt registry.
          // API resource IDs are UUIDs (e.g. "0ccd800f..."), NOT prefixed with "cmd-"/"skill-".
          // Check whether any registered prompt for this user matches the resource_id.
          const matchedPromptName = promptManager.promptNames(typedParams.user_token ?? '').find(
            (name) => {
              // Prompt names are "<type>/<resource_name>"; check by looking up the registered meta.
              const registered = promptManager.getByPromptName(name, typedParams.user_token ?? '');
              return registered?.meta?.resource_id === resourceId;
            },
          );
          if (matchedPromptName) {
            const parts = matchedPromptName.split('/');
            const resourceType = (parts[0] ?? 'command') as 'command' | 'skill';
            const resourceName = parts.slice(1).join('/') || matchedPromptName;
            promptManager.unregisterPrompt(resourceId, resourceType, resourceName, typedParams.user_token ?? '');
            logger.info({ resourceId, resourceType, matchedPromptName }, 'MCP Prompt unregistered on unsubscribe');

            // For skills, also delete the local script directory and manifest file.
            // NOTE: We cannot reuse uninstallResource here because the prompt has already been
            // unregistered above (promptManager.unregisterPrompt), so uninstallResource would
            // find no matching prompts and skip the skill cleanup branch entirely.
            // Instead, we directly build the delete_file local_actions for the AI to execute.
            if (resourceType === 'skill') {
              // Use adapter-resolved path so Codex cleans ~/.csp-ai-agent/codex/skills/<name>/
              // instead of the Cursor-only ~/.csp-ai-agent/skills/<name>/.
              const skillDir = unsubClientAdapter.getSkillDir(resourceName);
              const manifestFile = `${getCspAgentDirForClient('.manifests')}/${resourceName}.md`;

              unsubscribeLocalActions.push(
                { action: 'delete_file', path: skillDir, recursive: true } as import('../types/tools.js').LocalAction,
                { action: 'delete_file', path: manifestFile, recursive: false } as import('../types/tools.js').LocalAction,
              );
              logger.info(
                { resourceName, skillDir, manifestFile },
                'Local skill directory and manifest queued for deletion on unsubscribe',
              );
            }

            uninstallResults.push({ id: resourceId, removed: true, detail: `Unregistered MCP Prompt for "${resourceName}"` });
            continue;
          }
          // Prefer the human-readable name from the subscription list (e.g. "acm")
          // over deriving a pattern from the raw UUID.  Falling back to UUID-based
          // heuristics only when the subscription name is unavailable.
          const subscribedName = idToName.get(resourceId);
          let patternsToTry: string[];
          if (subscribedName) {
            // Use the actual resource name as the primary pattern; keep the UUID
            // as a secondary fallback in case the uninstall tool needs it.
            patternsToTry = Array.from(new Set([subscribedName, resourceId]));
          } else {
            // Legacy fallback: derive a name from prefixed IDs like
            // "mcp-client-sdk-ai-hub-jenkins" → "jenkins"
            // "rule-csp-elliotTest"            → "elliotTest"
            const namePart = resourceId.split('-').slice(-1)[0] ||
                             resourceId.split('-').slice(-2).join('-') ||
                             resourceId;
            patternsToTry = Array.from(new Set([
              resourceId,
              resourceId.replace(/^(skill|cmd|rule|mcp)-[^-]+-/, ''),
              namePart,
            ]));
          }

          const resolvedType = idToType.get(resourceId) as 'rule' | 'mcp' | undefined;
          let uninstalled = false;
          for (const pattern of patternsToTry) {
            const uninstallResult = await uninstallResource({
              resource_id_or_name: pattern,
              resource_id: resourceId,
              remove_from_account: false, // already unsubscribed above
              user_token: typedParams.user_token,
              ...(resolvedType ? { resource_type: resolvedType } : {}),
              // Always forward the resolved agent_profile so uninstall_resource emits
              // the correct config action:
              //   Cursor → remove_mcp_json_entry targeting ~/.cursor/mcp.json
              //   Codex  → remove_toml_entry targeting ~/.codex/config.toml
              agent_profile: resolvedUnsubProfile,
            });
            if (uninstallResult.success && uninstallResult.data && uninstallResult.data.removed_resources.length > 0) {
              // Collect local_actions_required (e.g. remove_mcp_json_entry for mcp-type resources,
              // delete_file for rule files) so they are forwarded to the AI agent for execution.
              if (uninstallResult.data.local_actions_required && uninstallResult.data.local_actions_required.length > 0) {
                unsubscribeLocalActions.push(
                  ...(uninstallResult.data.local_actions_required as import('../types/tools.js').LocalAction[]),
                );
                logger.info(
                  { resourceId, pattern, actionCount: uninstallResult.data.local_actions_required.length },
                  'Collected local_actions_required from uninstallResource for unsubscribe',
                );
              }
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

        // Verify server-side unsubscription with retry (up to 3 attempts, 300 ms apart).
        // The API may have a short propagation delay before list reflects the removal.
        const removedIds = new Set(typedParams.resource_ids);
        let verifiedRemoval = false;
        let stillPresentIds: string[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
          try {
            const verifySubs = await apiClient.getSubscriptions({}, typedParams.user_token);
            const stillPresent = verifySubs.subscriptions.filter((s) => removedIds.has(s.id));
            stillPresentIds = stillPresent.map((s) => s.id);
            if (stillPresent.length === 0) {
              verifiedRemoval = true;
              break;
            }
            logger.info(
              { attempt, stillPresent: stillPresent.map((s) => s.id) },
              'manage_subscription unsubscribe: server list still contains removed IDs, retrying verification',
            );
          } catch (verifyErr) {
            logger.warn(
              { attempt, error: (verifyErr as Error).message },
              'manage_subscription unsubscribe: verification list call failed, skipping retry',
            );
            break;
          }
        }

        const localSuppressionApplied = stillPresentIds.length > 0;
        if (localSuppressionApplied) {
          promptManager.suppressSubscriptions(typedParams.user_token ?? '', stillPresentIds);
          verifiedRemoval = true;
          logger.info(
            { stillPresentIds },
            'manage_subscription unsubscribe: applied local suppression for server-visible default subscriptions',
          );
        }

        if (!verifiedRemoval) {
          logger.warn(
            { resourceIds: typedParams.resource_ids },
            'manage_subscription unsubscribe: server list still shows resources after 3 verification attempts and no local suppression was applied',
          );
        }

        result = {
          action: 'unsubscribe',
          success: true,
          message: [
            `Successfully unsubscribed from ${typedParams.resource_ids.length} resource${typedParams.resource_ids.length > 1 ? 's' : ''}.`,
            removedCount > 0 ? `Removed local files for ${removedCount} resource${removedCount > 1 ? 's' : ''}.` : null,
            notFoundCount > 0 ? `${notFoundCount} resource${notFoundCount > 1 ? 's were' : ' was'} not installed locally.` : null,
            unsubscribeLocalActions.length > 0
              ? `IMPORTANT: You MUST execute ALL ${unsubscribeLocalActions.length} action(s) in local_actions_required immediately to delete local skill files and manifests. Do not skip any delete_file action.`
              : null,
            localSuppressionApplied
              ? `NOTE: ${stillPresentIds.length} default/baseline subscription${stillPresentIds.length > 1 ? 's were' : ' was'} still returned by the server, so a local unsubscribe override was applied for this MCP session.`
              : null,
            !verifiedRemoval
              ? `WARNING: The server subscription list may still show these resources due to propagation delay. If manage_subscription(list) still returns them, wait 1-2 seconds and retry.`
              : null,
          ].filter(Boolean).join(' '),
          sync_details: uninstallResults.map(r => ({ id: r.id, name: r.id, action: r.removed ? 'uninstalled' : 'not_found_locally' })),
          ...(unsubscribeLocalActions.length > 0 ? { local_actions_required: unsubscribeLocalActions } : {}),
        };

        logger.info({ count: typedParams.resource_ids.length, removedCount, verifiedRemoval }, 'Resources unsubscribed and local files cleaned up');
        break;
      }

      case 'list': {
        logger.debug({ scope: typedParams.scope || 'all' }, 'Listing subscriptions...');

        // Get subscriptions list
        const subs = await apiClient.getSubscriptions({}, typedParams.user_token);
        const visibleSubscriptions = promptManager.filterSuppressedSubscriptions(
          typedParams.user_token ?? '',
          subs.subscriptions,
        );
        const hiddenCount = subs.subscriptions.length - visibleSubscriptions.length;

        result = {
          action: 'list',
          success: true,
          subscriptions: visibleSubscriptions.map(sub => ({
            id: sub.id,
            name: sub.name,
            type: sub.type,
            subscribed_at: sub.subscribed_at,
          })),
          message: [
            `Found ${visibleSubscriptions.length} subscription${visibleSubscriptions.length !== 1 ? 's' : ''}`,
            hiddenCount > 0 ? `(${hiddenCount} locally unsubscribed default subscription${hiddenCount > 1 ? 's are' : ' is'} hidden)` : null,
          ].filter(Boolean).join(' '),
        };

        logger.info({ total: visibleSubscriptions.length, hiddenCount }, 'Subscriptions listed successfully');
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
        promptManager.clearSuppressedSubscriptions(typedParams.user_token ?? '', typedParams.resource_ids);

        logger.info({ count: batchSubResult.subscriptions.length }, 'Batch subscription completed');

        // Auto-sync newly subscribed resources immediately (default: true)
        const shouldBatchAutoSync = typedParams.auto_sync !== false;
        let batchSyncSummary: string | undefined;
        let batchSyncDetails: Array<{ id: string; name: string; action: string }> | undefined;
        let batchPendingSetup: unknown[] | undefined;
        let batchLocalActions: import('../types/tools.js').LocalAction[] | undefined;

        if (shouldBatchAutoSync && batchSubResult.subscriptions.length > 0) {
          logger.info({ count: batchSubResult.subscriptions.length }, 'Auto-syncing batch subscribed resources...');
          const batchSyncResult = await syncResources({
            mode: 'incremental',
            scope: typedParams.scope || 'global',
            user_token: typedParams.user_token,
            resource_ids: typedParams.resource_ids,
            agent_profile: typedParams.agent_profile,
          });
          if (batchSyncResult.success && batchSyncResult.data) {
            const sd = batchSyncResult.data;
            batchSyncSummary = `Auto-sync: ${sd.summary.synced} synced, ${sd.summary.cached} cached, ${sd.summary.failed} failed`;
            batchSyncDetails = sd.details.map(d => ({ id: d.id, name: d.name, action: d.action }));
            if (sd.pending_setup && sd.pending_setup.length > 0) {
              batchPendingSetup = sd.pending_setup;
            }
            if (sd.local_actions_required && sd.local_actions_required.length > 0) {
              batchLocalActions = sd.local_actions_required;
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
            batchLocalActions && batchLocalActions.length > 0
              ? `IMPORTANT: ${batchLocalActions.length} local action(s) are still pending. Execute local_actions_required or fetch csp-ai-agent-setup before treating these resources as installed.`
              : null,
          ].filter(Boolean).join(' '),
          ...(batchSyncDetails ? { sync_details: batchSyncDetails } : {}),
          ...(batchPendingSetup ? { pending_setup: batchPendingSetup } : {}),
          ...(batchLocalActions ? { local_actions_required: batchLocalActions } : {}),
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
    'says they do NOT want the resource installed right now. ' +
    'For newly subscribed Command or Skill resources that must be used immediately in the same conversation, ' +
    'follow with `resolve_prompt_content` after sync instead of assuming Cursor will fetch the prompt body automatically.',
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
          'DO NOT set this field — it is automatically injected by the MCP server from ' +
          'the authenticated SSE connection. The server always provides the correct token.',
      },
    },
    required: ['action'],
  },
  handler: manageSubscription,
};
