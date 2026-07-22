import NetInfo from '@react-native-community/netinfo';
import { getSupabase } from '@/services/supabase';
import {
  runSyncOnce,
  type QueuePort,
  type RemotePort,
  type SyncResult,
} from '@/services/syncEngine';
import {
  markEntityFailed,
  markEntitySynced,
  markQueueItemFailed,
  markQueueItemsSynced,
  peekQueueBatch,
  pendingQueueCount,
  upsertRemoteIntersections,
} from '@/database/repositories';
import type { QueueEntityType } from '@/types/models';

/**
 * Wires the pure sync engine to SQLite and Supabase, and owns the
 * "automatic sync when connectivity returns" behaviour.
 */

const TABLE_BY_ENTITY: Record<QueueEntityType, string> = {
  intersection: 'intersections',
  session: 'collection_sessions',
  observation: 'signal_observations',
  location_sample: 'location_samples',
};

const CONFLICT_KEY_BY_ENTITY: Record<QueueEntityType, string> = {
  intersection: 'id',
  session: 'id',
  observation: 'client_generated_id',
  location_sample: 'client_generated_id',
};

const sqliteQueuePort: QueuePort = {
  peekBatch: peekQueueBatch,
  markSynced: markQueueItemsSynced,
  markFailed: markQueueItemFailed,
  onEntitySynced: markEntitySynced,
  onEntityFailed: markEntityFailed,
};

function buildRemotePort(): RemotePort | null {
  const supabase = getSupabase();
  if (!supabase) return null;
  return {
    async upsertBatch(entityType, rows) {
      let payload = rows;
      // Sessions need the authenticated user's id attached at upload time.
      if (entityType === 'session') {
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id;
        if (!userId) return { ok: false, error: 'not signed in' };
        payload = rows.map((r) => ({ ...r, user_id: userId }));
      }
      if (entityType === 'intersection') {
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id;
        if (!userId) return { ok: false, error: 'not signed in' };
        payload = rows.map((r) => ({ ...r, created_by: userId }));
      }
      const { error } = await supabase
        .from(TABLE_BY_ENTITY[entityType])
        .upsert(payload, {
          onConflict: CONFLICT_KEY_BY_ENTITY[entityType],
          ignoreDuplicates: false,
        });
      return error ? { ok: false, error: error.message } : { ok: true };
    },
    async deleteByClientIds(entityType, clientGeneratedIds) {
      const { error } = await supabase
        .from(TABLE_BY_ENTITY[entityType])
        .delete()
        .in(CONFLICT_KEY_BY_ENTITY[entityType], clientGeneratedIds);
      return error ? { ok: false, error: error.message } : { ok: true };
    },
  };
}

let syncInFlight = false;

export async function syncNow(): Promise<SyncResult> {
  const empty: SyncResult = { attempted: 0, succeeded: 0, failed: 0, errors: [] };
  if (syncInFlight) return empty;
  const remote = buildRemotePort();
  if (!remote) return { ...empty, errors: ['Supabase not configured'] };
  const supabase = getSupabase()!;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { ...empty, errors: ['Sign in to sync'] };

  syncInFlight = true;
  try {
    let total: SyncResult = { ...empty };
    // Drain the queue in batches; stop when a batch makes no progress.
    for (let i = 0; i < 20; i++) {
      const result = await runSyncOnce(sqliteQueuePort, remote);
      total = {
        attempted: total.attempted + result.attempted,
        succeeded: total.succeeded + result.succeeded,
        failed: total.failed + result.failed,
        errors: [...total.errors, ...result.errors],
      };
      if (result.attempted === 0 || result.succeeded === 0) break;
      if (pendingQueueCount() === 0) break;
    }
    return total;
  } finally {
    syncInFlight = false;
  }
}

export type IntersectionRefreshResult =
  | { ok: true; count: number }
  | { ok: false; reason: string };

/** Pull public/shared intersections into the local cache. */
export async function refreshIntersectionsFromRemote(): Promise<IntersectionRefreshResult> {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, reason: 'Supabase not configured — add keys to .env and restart' };
  }
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return { ok: false, reason: 'Not signed in — sign in from Settings to download intersections' };
  }
  const { data, error } = await supabase
    .from('intersections')
    .select(
      'id, name, latitude, longitude, city, state, timezone, source, device_type, maintaining_agency, source_id, created_at',
    )
    .limit(2000);
  if (error) return { ok: false, reason: error.message };
  upsertRemoteIntersections(data ?? []);
  return { ok: true, count: data?.length ?? 0 };
}

let netInfoUnsubscribe: (() => void) | null = null;

/**
 * Start listening for connectivity changes; when the device comes back
 * online, kick off a sync automatically.
 */
export function startAutoSync(onSyncStateChange?: (online: boolean) => void): void {
  if (netInfoUnsubscribe) return;
  netInfoUnsubscribe = NetInfo.addEventListener((state) => {
    const online = Boolean(state.isConnected && state.isInternetReachable !== false);
    onSyncStateChange?.(online);
    if (online) {
      void syncNow();
    }
  });
}

export function stopAutoSync(): void {
  netInfoUnsubscribe?.();
  netInfoUnsubscribe = null;
}
