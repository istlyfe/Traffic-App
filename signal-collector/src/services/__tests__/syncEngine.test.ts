import {
  computeBackoffMs,
  runSyncOnce,
  type QueuePort,
  type RemotePort,
} from '../syncEngine';
import type { QueueEntityType, SyncQueueItem } from '../../types/models';

/**
 * In-memory queue that mirrors the SQLite sync_queue semantics:
 * items persist until explicitly marked synced, failures bump attempts
 * and set a next-attempt time.
 */
class FakeQueue implements QueuePort {
  items: SyncQueueItem[] = [];
  syncedEntities: string[] = [];
  failedEntities: string[] = [];
  private nextId = 1;

  add(entityType: QueueEntityType, clientGeneratedId: string, payload: Record<string, unknown>) {
    this.items.push({
      id: this.nextId++,
      entityType,
      op: 'upsert',
      clientGeneratedId,
      payload,
      attempts: 0,
      lastError: null,
      nextAttemptAtMs: 0,
      createdAt: new Date().toISOString(),
    });
  }

  peekBatch(limit: number, nowMs: number): SyncQueueItem[] {
    return this.items.filter((i) => i.nextAttemptAtMs <= nowMs).slice(0, limit);
  }

  markSynced(ids: number[]): void {
    this.items = this.items.filter((i) => !ids.includes(i.id));
  }

  markFailed(id: number, error: string, nextAttemptAtMs: number): void {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.attempts += 1;
      item.lastError = error;
      item.nextAttemptAtMs = nextAttemptAtMs;
    }
  }

  onEntitySynced(_type: QueueEntityType, clientGeneratedId: string): void {
    this.syncedEntities.push(clientGeneratedId);
  }

  onEntityFailed(_type: QueueEntityType, clientGeneratedId: string): void {
    this.failedEntities.push(clientGeneratedId);
  }
}

function remoteThat(
  behavior: (entityType: QueueEntityType, rows: Array<Record<string, unknown>>) =>
    | { ok: true }
    | { ok: false; error: string },
): RemotePort & { calls: Array<{ entityType: QueueEntityType; rows: Array<Record<string, unknown>> }> } {
  const calls: Array<{ entityType: QueueEntityType; rows: Array<Record<string, unknown>> }> = [];
  return {
    calls,
    async upsertBatch(entityType, rows) {
      calls.push({ entityType, rows });
      return behavior(entityType, rows);
    },
    async deleteByClientIds(entityType, ids) {
      calls.push({ entityType, rows: ids.map((id) => ({ id })) });
      return behavior(entityType, []);
    },
  };
}

describe('runSyncOnce (offline queue + batch upload)', () => {
  it('uploads queued items in dependency order and clears the queue', async () => {
    const queue = new FakeQueue();
    queue.add('observation', 'obs-1', { client_generated_id: 'obs-1' });
    queue.add('session', 'sess-1', { id: 'sess-1' });
    queue.add('intersection', 'ix-1', { id: 'ix-1' });
    const remote = remoteThat(() => ({ ok: true }));

    const result = await runSyncOnce(queue, remote, 1_000);

    expect(result.succeeded).toBe(3);
    expect(queue.items).toHaveLength(0);
    // intersections before sessions before observations
    expect(remote.calls.map((c) => c.entityType)).toEqual([
      'intersection',
      'session',
      'observation',
    ]);
  });

  it('retains items in the queue while offline (upload fails)', async () => {
    const queue = new FakeQueue();
    queue.add('observation', 'obs-1', {});
    queue.add('observation', 'obs-2', {});
    const remote = remoteThat(() => ({ ok: false, error: 'network unreachable' }));

    const result = await runSyncOnce(queue, remote, 1_000);

    expect(result.failed).toBe(2);
    expect(queue.items).toHaveLength(2); // nothing lost
    expect(queue.items.every((i) => i.lastError === 'network unreachable')).toBe(true);
  });

  it('applies exponential backoff on repeated failures', async () => {
    const queue = new FakeQueue();
    queue.add('observation', 'obs-1', {});
    const remote = remoteThat(() => ({ ok: false, error: 'boom' }));

    await runSyncOnce(queue, remote, 0);
    const firstDelay = queue.items[0]!.nextAttemptAtMs;
    expect(firstDelay).toBe(computeBackoffMs(0)); // 2s after attempt 1

    // Before the backoff expires the item is not retried.
    const early = await runSyncOnce(queue, remote, firstDelay - 1);
    expect(early.attempted).toBe(0);

    // After it expires, it is retried and backs off further.
    await runSyncOnce(queue, remote, firstDelay);
    expect(queue.items[0]!.attempts).toBe(2);
    expect(queue.items[0]!.nextAttemptAtMs).toBe(firstDelay + computeBackoffMs(1));
  });

  it('eventually succeeds after transient failures (sync retry)', async () => {
    const queue = new FakeQueue();
    queue.add('observation', 'obs-1', { client_generated_id: 'obs-1' });
    let failuresLeft = 2;
    const remote = remoteThat(() =>
      failuresLeft-- > 0 ? { ok: false, error: 'flaky' } : { ok: true },
    );

    let now = 0;
    for (let i = 0; i < 5 && queue.items.length > 0; i++) {
      now = Math.max(now, ...queue.items.map((it) => it.nextAttemptAtMs));
      await runSyncOnce(queue, remote, now);
    }
    expect(queue.items).toHaveLength(0);
    expect(queue.syncedEntities).toContain('obs-1');
  });

  it('handles partial batch failure: one group fails, others still sync', async () => {
    const queue = new FakeQueue();
    queue.add('session', 'sess-1', { id: 'sess-1' });
    queue.add('observation', 'obs-1', {});
    const remote = remoteThat((entityType) =>
      entityType === 'observation'
        ? { ok: false, error: 'constraint violation' }
        : { ok: true },
    );

    const result = await runSyncOnce(queue, remote, 1_000);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(queue.items.map((i) => i.clientGeneratedId)).toEqual(['obs-1']);
    expect(queue.syncedEntities).toEqual(['sess-1']);
    expect(queue.failedEntities).toEqual(['obs-1']);
  });

  it('groups rows of the same entity into one batched call', async () => {
    const queue = new FakeQueue();
    queue.add('observation', 'obs-1', { client_generated_id: 'obs-1' });
    queue.add('observation', 'obs-2', { client_generated_id: 'obs-2' });
    queue.add('observation', 'obs-3', { client_generated_id: 'obs-3' });
    const remote = remoteThat(() => ({ ok: true }));

    await runSyncOnce(queue, remote, 1_000);

    expect(remote.calls).toHaveLength(1);
    expect(remote.calls[0]!.rows).toHaveLength(3);
  });

  it('treats thrown transport errors as failures without losing items', async () => {
    const queue = new FakeQueue();
    queue.add('observation', 'obs-1', {});
    const remote: RemotePort = {
      upsertBatch: async () => {
        throw new Error('socket hang up');
      },
      deleteByClientIds: async () => ({ ok: true }),
    };

    const result = await runSyncOnce(queue, remote, 1_000);
    expect(result.failed).toBe(1);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]!.lastError).toBe('socket hang up');
  });
});

describe('computeBackoffMs', () => {
  it('doubles per attempt from a 2s base', () => {
    expect(computeBackoffMs(0)).toBe(2_000);
    expect(computeBackoffMs(1)).toBe(4_000);
    expect(computeBackoffMs(2)).toBe(8_000);
    expect(computeBackoffMs(3)).toBe(16_000);
  });

  it('caps at 5 minutes and never overflows', () => {
    expect(computeBackoffMs(10)).toBe(5 * 60 * 1000);
    expect(computeBackoffMs(1_000)).toBe(5 * 60 * 1000);
  });
});
