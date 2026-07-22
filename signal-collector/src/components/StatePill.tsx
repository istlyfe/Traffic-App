import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SignalState, SyncStatus } from '@/types/models';

const STATE_COLORS: Record<SignalState, string> = {
  RED: '#e7413b',
  YELLOW: '#f2c744',
  GREEN: '#3fb950',
  FLASHING_RED: '#a83832',
  FLASHING_YELLOW: '#b39531',
  DARK: '#484f58',
  UNKNOWN: '#6e7681',
};

export function StatePill({ state }: { state: SignalState }) {
  return (
    <View style={[styles.pill, { backgroundColor: STATE_COLORS[state] }]}>
      <Text style={styles.label}>{state.replace(/_/g, ' ')}</Text>
    </View>
  );
}

const SYNC_COLORS: Record<SyncStatus, { bg: string; label: string }> = {
  pending: { bg: '#57606a', label: 'queued' },
  syncing: { bg: '#1f6feb', label: 'syncing' },
  synced: { bg: '#238636', label: 'synced' },
  failed: { bg: '#da3633', label: 'retrying' },
};

export function SyncPill({ status }: { status: SyncStatus }) {
  const cfg = SYNC_COLORS[status];
  return (
    <View style={[styles.pill, styles.syncPill, { backgroundColor: cfg.bg }]}>
      <Text style={styles.syncLabel}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  syncPill: { paddingHorizontal: 8 },
  label: { color: '#ffffff', fontWeight: '800', fontSize: 12 },
  syncLabel: { color: '#ffffff', fontWeight: '600', fontSize: 10 },
});
