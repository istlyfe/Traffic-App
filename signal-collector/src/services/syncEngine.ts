import type { QueueEntityType, QueueOp, SyncQueueItem } from '@/types/models';

/**
 * Transport-agnostic sync engine. The concrete SQLite queue and Supabase
 * uploader are injected as ports, which keeps this logic fully unit-testable
 * and makes retry/backoff behaviour deterministic.
 *
 * Guarantees:
 *  - Batch upload grouped by entity type, in dependency order
 *    (intersections -> sessions -> observations -> location samples).
 *  - Idempotent: every row carries a client-generated UUID and the server
 *    upserts on that key, so retries can never duplicate observations.
 *  - Partial batch failure: a failing group only fails its own items;
 *    other groups still proceed. Failed items get exponential backoff.
 *  - Nothing is removed from the queue until the server confirms it.
 */

export interface QueuePort {
  peekBatch(limit: number, nowMs: number): SyncQueueItem[];
  markSynced(ids: number[]): void;
  markFailed(id: number, error: string, nextAttemptAtMs: number): void;
  onEntitySynced(entityType: QueueEntityType, clientGeneratedId: string): void;
  onEntityFailed(
    entityType: QueueEntityType,
    clientGeneratedId: string,
    error: string,
  ): void;
}

export interface RemotePort {
  upsertBatch(
    entityType: QueueEntityType,
    rows: Array<Record<string, unknown>>,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  deleteByClientIds(
    entityType: QueueEntityType,
    clientGeneratedIds: string[],
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface SyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

export const SYNC_BATCH_LIMIT = 100;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;

/** attempts=0 -> 2s, 1 -> 4s, 2 -> 8s ... capped at 5 minutes. */
export function computeBackoffMs(
  attempts: number,
  baseMs: number = BACKOFF_BASE_MS,
  maxMs: number = BACKOFF_MAX_MS,
): number {
  const exp = Math.min(attempts, 30); // avoid overflow
  return Math.min(baseMs * 2 ** exp, maxMs);
}

const ENTITY_ORDER: QueueEntityType[] = [
  'intersection',
  'session',
  'observation',
  'location_sample',
];

interface Group {
  entityType: QueueEntityType;
  op: QueueOp;
  items: SyncQueueItem[];
}

function groupItems(items: SyncQueueItem[]): Group[] {
  const groups = new Map<string, Group>();
  for (const item of items) {
    const key = `${item.entityType}:${item.op}`;
    let group = groups.get(key);
    if (!group) {
      group = { entityType: item.entityType, op: item.op, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  // Upserts before deletes within the dependency order.
  return [...groups.values()].sort((a, b) => {
    const orderDiff =
      ENTITY_ORDER.indexOf(a.entityType) - ENTITY_ORDER.indexOf(b.entityType);
    if (orderDiff !== 0) return orderDiff;
    return a.op === b.op ? 0 : a.op === 'upsert' ? -1 : 1;
  });
}

export async function runSyncOnce(
  queue: QueuePort,
  remote: RemotePort,
  nowMs: number = Date.now(),
): Promise<SyncResult> {
  const batch = queue.peekBatch(SYNC_BATCH_LIMIT, nowMs);
  const result: SyncResult = {
    attempted: batch.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };
  if (batch.length === 0) return result;

  for (const group of groupItems(batch)) {
    let outcome: { ok: true } | { ok: false; error: string };
    try {
      outcome =
        group.op === 'upsert'
          ? await remote.upsertBatch(
              group.entityType,
              group.items.map((i) => i.payload),
            )
          : await remote.deleteByClientIds(
              group.entityType,
              group.items.map((i) => i.clientGeneratedId),
            );
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (outcome.ok) {
      queue.markSynced(group.items.map((i) => i.id));
      for (const item of group.items) {
        if (item.op === 'upsert') {
          queue.onEntitySynced(item.entityType, item.clientGeneratedId);
        }
      }
      result.succeeded += group.items.length;
    } else {
      result.errors.push(`${group.entityType}/${group.op}: ${outcome.error}`);
      for (const item of group.items) {
        queue.markFailed(
          item.id,
          outcome.error,
          nowMs + computeBackoffMs(item.attempts),
        );
        queue.onEntityFailed(item.entityType, item.clientGeneratedId, outcome.error);
      }
      result.failed += group.items.length;
    }
  }
  return result;
}
