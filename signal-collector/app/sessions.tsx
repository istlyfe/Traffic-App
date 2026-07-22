import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  deleteSession,
  listSessions,
  listObservationsForSession,
} from '@/database/repositories';
import { useSessionStore } from '@/stores/sessionStore';
import { useSyncStore } from '@/stores/syncStore';
import { analyzeSequence } from '@/utils/cycles';
import { SyncPill } from '@/components/StatePill';
import { formatDate, formatClock } from '@/utils/time';
import { colors, spacing } from '@/utils/theme';
import type { CollectionSession } from '@/types/models';

interface SessionRowData extends CollectionSession {
  cycleCount: number;
  observationCount: number;
  unsyncedCount: number;
}

export default function SessionsScreen() {
  const [sessions, setSessions] = useState<SessionRowData[]>([]);
  const [intersectionFilter, setIntersectionFilter] = useState('');
  const [dateFilter, setDateFilter] = useState(''); // YYYY-MM-DD prefix match
  const activeSession = useSessionStore((s) => s.activeSession);
  const refreshCounts = useSyncStore((s) => s.refreshCounts);

  const reload = useCallback(() => {
    const rows = listSessions().map((session) => {
      const observations = listObservationsForSession(session.clientGeneratedId);
      const analysis = analyzeSequence(observations);
      return {
        ...session,
        cycleCount: analysis.stats.completeCycleCount,
        observationCount: observations.length,
        unsyncedCount: observations.filter((o) => o.syncStatus !== 'synced').length,
      };
    });
    setSessions(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const onDelete = useCallback(
    (item: SessionRowData) => {
      if (activeSession?.clientGeneratedId === item.clientGeneratedId) {
        Alert.alert('Session is active', 'End the session before deleting it.');
        return;
      }
      Alert.alert(
        'Delete session?',
        `${item.intersectionName} — ${item.observationCount} observations will be removed` +
          (item.syncStatus === 'synced' ? ' locally and from the server.' : '.'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              deleteSession(item.clientGeneratedId);
              refreshCounts();
              reload();
            },
          },
        ],
      );
    },
    [activeSession, refreshCounts, reload],
  );

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (
        intersectionFilter &&
        !s.intersectionName.toLowerCase().includes(intersectionFilter.toLowerCase())
      ) {
        return false;
      }
      if (dateFilter && !s.startedAt.startsWith(dateFilter)) return false;
      return true;
    });
  }, [sessions, intersectionFilter, dateFilter]);

  return (
    <View style={styles.screen}>
      <View style={styles.filters}>
        <TextInput
          style={styles.filterInput}
          placeholder="Filter by intersection…"
          placeholderTextColor={colors.textDim}
          value={intersectionFilter}
          onChangeText={setIntersectionFilter}
        />
        <TextInput
          style={styles.filterInput}
          placeholder="Date (YYYY-MM-DD)"
          placeholderTextColor={colors.textDim}
          value={dateFilter}
          onChangeText={setDateFilter}
          autoCapitalize="none"
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(s) => s.clientGeneratedId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No sessions match.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push(`/session/${item.clientGeneratedId}`)}
          >
            <View style={styles.rowMain}>
              <Text style={styles.rowName} numberOfLines={1}>
                {item.intersectionName}
              </Text>
              <Text style={styles.rowMeta}>
                {formatDate(item.startedAt)} {formatClock(item.startedAt)} ·{' '}
                {item.approachDirection} {item.movementType.replace('_', ' ')}
              </Text>
              <Text style={styles.rowMeta}>
                {item.cycleCount} complete cycles · {item.observationCount} observations
                {item.unsyncedCount > 0 ? ` · ${item.unsyncedCount} unsynced` : ''}
              </Text>
            </View>
            <View style={styles.rowSide}>
              <SyncPill
                status={item.unsyncedCount > 0 ? 'pending' : item.syncStatus}
              />
              <Pressable
                hitSlop={8}
                style={styles.deleteButton}
                onPress={() => onDelete(item)}
              >
                <Text style={styles.deleteLabel}>Delete</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  filters: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  filterInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 13,
  },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowMain: { flex: 1, marginRight: spacing.sm },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  rowSide: { alignItems: 'flex-end', gap: 8 },
  deleteButton: { paddingVertical: 4, paddingHorizontal: 6 },
  deleteLabel: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  empty: { color: colors.textDim, textAlign: 'center', paddingVertical: spacing.xl },
});
