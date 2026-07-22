import { create } from 'zustand';
import { unsyncedObservationCount, pendingQueueCount } from '@/database/repositories';
import { syncNow, startAutoSync } from '@/services/syncService';

interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  unsyncedObservations: number;
  pendingQueueItems: number;
  lastSyncAt: string | null;
  lastError: string | null;
  refreshCounts: () => void;
  triggerSync: () => Promise<void>;
  initAutoSync: () => void;
}

export const useSyncStore = create<SyncState>()((set, get) => ({
  isOnline: true,
  isSyncing: false,
  unsyncedObservations: 0,
  pendingQueueItems: 0,
  lastSyncAt: null,
  lastError: null,

  refreshCounts: () => {
    set({
      unsyncedObservations: unsyncedObservationCount(),
      pendingQueueItems: pendingQueueCount(),
    });
  },

  triggerSync: async () => {
    if (get().isSyncing) return;
    set({ isSyncing: true, lastError: null });
    try {
      const result = await syncNow();
      set({
        lastSyncAt: new Date().toISOString(),
        lastError: result.errors[0] ?? null,
      });
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ isSyncing: false });
      get().refreshCounts();
    }
  },

  initAutoSync: () => {
    startAutoSync((online) => {
      set({ isOnline: online });
      if (online) get().refreshCounts();
    });
  },
}));
