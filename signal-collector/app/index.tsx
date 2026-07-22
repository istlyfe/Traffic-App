import React, { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { listSessions } from '@/database/repositories';
import { useSyncStore } from '@/stores/syncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useGpsStatus } from '@/hooks/useGpsStatus';
import { requestForegroundPermission } from '@/services/locationService';
import { refreshIntersectionsFromRemote } from '@/services/syncService';
import { AccuracyBadge } from '@/components/AccuracyBadge';
import { SafetyNotice, SAFETY_TEXT } from '@/components/SafetyNotice';
import { SyncPill } from '@/components/StatePill';
import { formatDate, formatClock } from '@/utils/time';
import { colors, spacing } from '@/utils/theme';
import type { CollectionSession } from '@/types/models';

export default function HomeScreen() {
  const { permission, fix, refresh } = useGpsStatus();
  const unsynced = useSyncStore((s) => s.unsyncedObservations);
  const isOnline = useSyncStore((s) => s.isOnline);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const triggerSync = useSyncStore((s) => s.triggerSync);
  const refreshCounts = useSyncStore((s) => s.refreshCounts);
  const safetyAcknowledged = useSettingsStore((s) => s.safetyAcknowledged);
  const acknowledgeSafety = useSettingsStore((s) => s.acknowledgeSafety);
  const activeSession = useSessionStore((s) => s.activeSession);

  const [recent, setRecent] = useState<CollectionSession[]>([]);
  const [showSafety, setShowSafety] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setRecent(listSessions().slice(0, 5));
      refreshCounts();
    }, [refreshCounts]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    await refreshIntersectionsFromRemote().catch(() => {});
    setRecent(listSessions().slice(0, 5));
    refreshCounts();
    setRefreshing(false);
  }, [refresh, refreshCounts]);

  const startCollection = useCallback(() => {
    if (activeSession) {
      router.push('/collect');
      return;
    }
    if (!safetyAcknowledged) {
      setShowSafety(true);
      return;
    }
    router.push('/intersections');
  }, [activeSession, safetyAcknowledged]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Pressable style={styles.startButton} onPress={startCollection}>
        <Text style={styles.startLabel}>
          {activeSession ? 'Resume active session' : 'Start collection'}
        </Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Status</Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusKey}>GPS permission</Text>
          {permission === 'granted' ? (
            <Text style={styles.statusOk}>granted</Text>
          ) : (
            <Pressable onPress={() => void requestForegroundPermission().then(refresh)}>
              <Text style={styles.statusAction}>
                {permission === 'denied' ? 'denied — tap to retry' : 'tap to request'}
              </Text>
            </Pressable>
          )}
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusKey}>Location accuracy</Text>
          <AccuracyBadge accuracyMeters={fix?.accuracyMeters} />
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusKey}>Network</Text>
          <Text style={isOnline ? styles.statusOk : styles.statusWarn}>
            {isOnline ? 'online' : 'offline — recording locally'}
          </Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusKey}>Unsynced observations</Text>
          <Text style={unsynced > 0 ? styles.statusWarn : styles.statusOk}>{unsynced}</Text>
        </View>
        <Pressable
          style={[styles.syncButton, isSyncing && styles.syncButtonDisabled]}
          disabled={isSyncing}
          onPress={() => void triggerSync()}
        >
          <Text style={styles.syncLabel}>{isSyncing ? 'Syncing…' : 'Sync now'}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Recent sessions</Text>
          <Pressable onPress={() => router.push('/sessions')}>
            <Text style={styles.link}>All sessions</Text>
          </Pressable>
        </View>
        {recent.length === 0 && (
          <Text style={styles.empty}>No sessions yet. Start your first collection.</Text>
        )}
        {recent.map((session) => (
          <Pressable
            key={session.clientGeneratedId}
            style={styles.sessionRow}
            onPress={() => router.push(`/session/${session.clientGeneratedId}`)}
          >
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionName} numberOfLines={1}>
                {session.intersectionName}
              </Text>
              <Text style={styles.sessionMeta}>
                {formatDate(session.startedAt)} {formatClock(session.startedAt)} ·{' '}
                {session.approachDirection} {session.movementType.replace('_', ' ')}
              </Text>
            </View>
            <SyncPill status={session.syncStatus} />
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.settingsLink} onPress={() => router.push('/settings')}>
        <Text style={styles.link}>Settings & account</Text>
      </Pressable>

      <Text style={styles.safetyFooter}>{SAFETY_TEXT}</Text>

      <SafetyNotice
        visible={showSafety}
        onAcknowledge={() => {
          acknowledgeSafety();
          setShowSafety(false);
          router.push('/intersections');
        }}
        onCancel={() => setShowSafety(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  startButton: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  startLabel: { color: '#04121f', fontSize: 20, fontWeight: '800' },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  statusKey: { color: colors.textDim, fontSize: 14 },
  statusOk: { color: colors.success, fontSize: 14, fontWeight: '600' },
  statusWarn: { color: colors.warning, fontSize: 14, fontWeight: '600' },
  statusAction: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  syncButton: {
    marginTop: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: 10,
    alignItems: 'center',
  },
  syncButtonDisabled: { opacity: 0.5 },
  syncLabel: { color: colors.accent, fontWeight: '700' },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.cardBorder,
  },
  sessionInfo: { flex: 1, marginRight: spacing.sm },
  sessionName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sessionMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  empty: { color: colors.textDim, fontSize: 14, paddingVertical: spacing.sm },
  link: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  settingsLink: { alignItems: 'center', paddingVertical: spacing.sm },
  safetyFooter: {
    color: colors.textDim,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 18,
  },
});
