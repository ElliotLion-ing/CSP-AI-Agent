/**
 * TelemetryManager: records local AI resource invocation events and periodically
 * flushes them to the remote telemetry API.
 *
 * Local storage: {MCP Server CWD}/ai-resource-telemetry.json
 *
 * Multi-user design:
 * - The file is keyed by user token so that data for different users is stored
 *   and reported independently.  Each top-level key in the `users` map is a
 *   user token; all events, rules and MCPs belong to that token's owner.
 * - On flush, each user's data is sent with that user's own token, so the
 *   server can attribute the telemetry to the correct account.
 *
 * Other design notes:
 * - File is stored in the MCP Server's runtime working directory (not ~/.cursor/).
 * - Atomic write-then-rename pattern prevents file corruption on concurrent
 *   writes or unexpected process termination.
 * - Periodic flush is fire-and-forget; failures retry up to MAX_RETRIES times
 *   with exponential back-off, then silently drop — main tool flow is never blocked.
 * - Rules cannot track individual invocations (Cursor injects them silently).
 *   We report the subscribed list as a snapshot on every flush instead.
 * - MCPs are tracked as a configured-list snapshot only.
 * - jira_id is an optional per-invocation annotation stored separately per key.
 */

import * as fs from 'fs';
import * as path from 'path';

export type ResourceCategory = 'command' | 'skill' | 'mcp';

export interface InvocationEvent {
  resource_id: string;
  resource_type: ResourceCategory;
  resource_name: string;
  invocation_count: number;
  first_invoked_at: string;
  last_invoked_at: string;
  /** Optional Jira Issue ID for usage correlation (e.g. "PROJ-12345"). */
  jira_id?: string;
}

export interface SubscribedRule {
  resource_id: string;
  resource_name: string;
  subscribed_at: string;
}

export interface ConfiguredMcp {
  resource_id: string;
  resource_name: string;
  configured_at: string;
}

/** Per-user telemetry data stored under `users[token]`. */
export interface UserTelemetry {
  last_reported_at: string | null;
  pending_events: InvocationEvent[];
  subscribed_rules: SubscribedRule[];
  configured_mcps: ConfiguredMcp[];
}

/** Top-level file structure (v2: multi-user). */
export interface TelemetryFile {
  client_version: string;
  /** Map of user token → per-user telemetry data. */
  users: Record<string, UserTelemetry>;
}

export interface TelemetryReportPayload {
  client_version: string;
  reported_at: string;
  events: InvocationEvent[];
  subscribed_rules: SubscribedRule[];
  configured_mcps: ConfiguredMcp[];
}

// Injected at flush time by the server; avoids circular import with api/client
export type ReportFn = (payload: TelemetryReportPayload, userToken: string) => Promise<void>;

/** Default file name placed in the MCP Server's CWD. */
const DEFAULT_FILE_NAME = 'ai-resource-telemetry.json';

const DEFAULT_VERSION = '0.1.5';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

/** Build the aggregation key for an invocation event. */
function aggregationKey(resourceId: string, jiraId?: string): string {
  return jiraId ? `${resourceId}|${jiraId}` : resourceId;
}

/** Return an empty per-user telemetry record. */
function emptyUserTelemetry(): UserTelemetry {
  return {
    last_reported_at: null,
    pending_events: [],
    subscribed_rules: [],
    configured_mcps: [],
  };
}

export class TelemetryManager {
  private filePath: string;
  private clientVersion: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reportFn: ReportFn | null = null;
  /** Tracks all tokens seen from active SSE connections for multi-user flush. */
  private activeTokens: Set<string> = new Set();
  /** Simple mutex: true while a file write is in progress. */
  private writing = false;
  private writeQueue: Array<() => void> = [];

  /**
   * @param filePath       Absolute path to the telemetry JSON file.
   *                       Defaults to `{CWD}/ai-resource-telemetry.json`.
   * @param clientVersion  Reported client version string.
   */
  constructor(filePath?: string, clientVersion?: string) {
    this.filePath = filePath ?? path.join(process.cwd(), DEFAULT_FILE_NAME);
    this.clientVersion = clientVersion ?? DEFAULT_VERSION;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Configure the function used to send telemetry to the server.
   * Called during server initialisation to inject the API client without
   * creating a circular dependency.
   *
   * All user tokens must arrive via setUserToken() from authenticated SSE
   * connections — no environment variable fallback.
   */
  configure(reportFn: ReportFn): void {
    this.reportFn = reportFn;
  }

  /**
   * Register a token from a newly authenticated SSE connection.
   *
   * - Adds the token to the active-token set (used for multi-user flush).
   * - Initialises the per-user slot in the file if it does not yet exist.
   */
  setUserToken(token: string): void {
    this.activeTokens.add(token);
    // Ensure the user slot exists without overwriting existing data.
    this.withFileLock(async () => {
      const data = this.readFile();
      if (!data.users[token]) {
        data.users[token] = emptyUserTelemetry();
        this.writeFile(data);
      }
    }).catch(() => { /* best-effort */ });
  }

  /**
   * Record one invocation of a Command or Skill resource for a specific user.
   *
   * Events are aggregated by (resource_id, jira_id) key — successive calls for
   * the same key increment the counter rather than appending duplicate entries.
   *
   * @param resourceId    Canonical resource ID.
   * @param resourceType  'command' | 'skill'
   * @param resourceName  Human-readable name.
   * @param userToken     Token of the user who invoked the resource.
   * @param jiraId        Optional Jira Issue ID for correlation.
   */
  async recordInvocation(
    resourceId: string,
    resourceType: ResourceCategory,
    resourceName: string,
    userToken: string,
    jiraId?: string,
  ): Promise<void> {
    await this.withFileLock(async () => {
      const data = this.readFile();
      const user = this.ensureUserSlot(data, userToken);
      const now = new Date().toISOString();
      const key = aggregationKey(resourceId, jiraId);

      const existing = user.pending_events.find(
        (e) => aggregationKey(e.resource_id, e.jira_id) === key,
      );

      if (existing) {
        existing.invocation_count += 1;
        existing.last_invoked_at = now;
      } else {
        const event: InvocationEvent = {
          resource_id: resourceId,
          resource_type: resourceType,
          resource_name: resourceName,
          invocation_count: 1,
          first_invoked_at: now,
          last_invoked_at: now,
        };
        // Only attach jira_id when defined (field must be absent, not null).
        if (jiraId) event.jira_id = jiraId;
        user.pending_events.push(event);
      }
      this.writeFile(data);
    });
  }

  /**
   * Replace the full list of subscribed Rules for a specific user.
   * Called after sync_resources or manage_subscription completes.
   */
  async updateSubscribedRules(rules: SubscribedRule[], userToken: string): Promise<void> {
    await this.withFileLock(async () => {
      const data = this.readFile();
      this.ensureUserSlot(data, userToken).subscribed_rules = rules;
      this.writeFile(data);
    });
  }

  /**
   * Replace the full list of configured MCPs for a specific user.
   * Called after sync_resources or manage_subscription completes for MCP resources.
   */
  async updateConfiguredMcps(mcps: ConfiguredMcp[], userToken: string): Promise<void> {
    await this.withFileLock(async () => {
      const data = this.readFile();
      this.ensureUserSlot(data, userToken).configured_mcps = mcps;
      this.writeFile(data);
    });
  }

  /**
   * Flush pending telemetry for ALL active users.
   *
   * Each user's data is sent with that user's own token so the server can
   * attribute it to the correct account.  The periodic timer calls this so
   * that all connected users are reported in the same tick.
   */
  async flush(): Promise<void> {
    if (!this.reportFn) return;

    // Only flush tokens from authenticated SSE connections.
    // No environment variable fallback — tokens must arrive via setUserToken().
    const tokens = new Set(this.activeTokens);

    if (tokens.size === 0) return;

    const data = await new Promise<TelemetryFile>((resolve) => {
      this.withFileLock(async () => {
        resolve(this.readFile());
      }).catch(() => resolve(this.readFile()));
    });

    await Promise.all(
      Array.from(tokens).map((token) => this.flushUser(token, data)),
    );
  }

  /** Start the periodic flush timer (flushes all active users each tick). */
  startPeriodicFlush(intervalMs = 10_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch(() => { /* already handled inside flush */ });
    }, intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  /** Stop the periodic flush timer (call before final flush on shutdown). */
  stopPeriodicFlush(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Trigger an immediate flush when a client reconnects to the MCP server.
   * Fire-and-forget — errors are already handled inside flush().
   */
  flushOnReconnect(): void {
    this.flush().catch(() => { /* handled inside flush */ });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Flush one user's pending data using that user's own token. */
  private async flushUser(token: string, data: TelemetryFile): Promise<void> {
    if (!this.reportFn) return;
    const user = data.users[token];
    if (!user) return;

    const payload: TelemetryReportPayload = {
      client_version: this.clientVersion,
      reported_at: new Date().toISOString(),
      events: user.pending_events,
      subscribed_rules: user.subscribed_rules,
      configured_mcps: user.configured_mcps,
    };

    await this.reportWithRetry(payload, token);
  }

  /** Get or create the per-user slot, mutating `data.users` in place. */
  private ensureUserSlot(data: TelemetryFile, token: string): UserTelemetry {
    if (!data.users[token]) {
      data.users[token] = emptyUserTelemetry();
    }
    return data.users[token]!;
  }

  private readFile(): TelemetryFile {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<TelemetryFile> & {
        // v1 compat: flat structure without `users`
        pending_events?: InvocationEvent[];
        subscribed_rules?: SubscribedRule[];
        configured_mcps?: ConfiguredMcp[];
      };

      // Migrate v1 flat file to v2 multi-user structure.
      // We cannot recover the original token, so v1 data is discarded.
      if (!parsed.users) {
        return { client_version: this.clientVersion, users: {} };
      }

      return {
        client_version: parsed.client_version ?? this.clientVersion,
        users: parsed.users,
      };
    } catch {
      return { client_version: this.clientVersion, users: {} };
    }
  }

  private writeFile(data: TelemetryFile): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  /** Serialises file access to prevent concurrent write conflicts. */
  private async withFileLock(fn: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const run = async () => {
        this.writing = true;
        try {
          await fn();
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          this.writing = false;
          const next = this.writeQueue.shift();
          if (next) next();
        }
      };

      if (this.writing) {
        this.writeQueue.push(run);
      } else {
        run();
      }
    });
  }

  private async reportWithRetry(payload: TelemetryReportPayload, token: string): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.reportFn!(payload, token);
        // Success — subtract only the events that were included in this payload.
        // New events may have been appended to the file between the time we read
        // the snapshot and now, so we must NOT blindly wipe pending_events=[].
        // Instead, re-read the file under lock and decrement each reported
        // event's invocation_count; remove it only when the count reaches zero.
        await this.withFileLock(async () => {
          const data = this.readFile();
          const user = data.users[token];
          if (!user) return;

          for (const reported of payload.events) {
            const key = aggregationKey(reported.resource_id, reported.jira_id);
            const idx = user.pending_events.findIndex(
              (e) => aggregationKey(e.resource_id, e.jira_id) === key,
            );
            if (idx === -1) continue;
            const live = user.pending_events[idx]!;
            live.invocation_count -= reported.invocation_count;
            if (live.invocation_count <= 0) {
              user.pending_events.splice(idx, 1);
            }
          }

          user.last_reported_at = payload.reported_at;
          this.writeFile(data);
        });
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        }
      }
    }
    if (process.env.NODE_ENV !== 'test') {
      process.stderr.write(`[telemetry] flush failed after ${MAX_RETRIES} retries: ${lastErr}\n`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Singleton instance shared across the server process. */
export const telemetry = new TelemetryManager();
