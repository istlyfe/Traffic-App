import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Polyline, Marker } from 'react-native-maps';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import {
  correctObservationState,
  deleteObservation,
  getSessionByClientId,
  listObservationsForSession,
  listSamplesForSession,
} from '@/database/repositories';
import { analyzeSequence } from '@/utils/cycles';
import { SIGNAL_STATES } from '@/types/models';
import type {
  CollectionSession,
  LocationSample,
  SignalObservation,
  SignalState,
} from '@/types/models';
import { StatePill, SyncPill } from '@/components/StatePill';
import { formatClock, formatSeconds, formatDurationMs } from '@/utils/time';
import { colors, spacing } from '@/utils/theme';

export default function SessionReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<CollectionSession | null>(null);
  const [observations, setObservations] = useState<SignalObservation[]>([]);
  const [samples, setSamples] = useState<LocationSample[]>([]);
  const [editing, setEditing] = useState<SignalObservation | null>(null);

  const reload = useCallback(() => {
    if (!id) return;
    setSession(getSessionByClientId(id));
    setObservations(listObservationsForSession(id));
    setSamples(listSamplesForSession(id));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const analysis = useMemo(() => analyzeSequence(observations), [observations]);

  const anomalyByObservation = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const anomaly of analysis.anomalies) {
      const list = map.get(anomaly.observationId) ?? [];
      list.push(anomaly.detail);
      map.set(anomaly.observationId, list);
    }
    return map;
  }, [analysis]);

  const durationByObservation = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const seg of analysis.segments) {
      map.set(seg.observationId, seg.durationMs);
    }
    return map;
  }, [analysis]);

  const onDelete = useCallback(
    (obs: SignalObservation) => {
      Alert.alert('Delete observation?', `${obs.state} at ${formatClock(obs.observedAt)}`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteObservation(obs.clientGeneratedId);
            reload();
          },
        },
      ]);
    },
    [reload],
  );

  const path = samples.map((s) => ({ latitude: s.latitude, longitude: s.longitude }));

  if (!session) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text style={styles.dim}>Session not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{session.intersectionName}</Text>
      <Text style={styles.subtitle}>
        {session.approachDirection} · {session.movementType.replace('_', ' ')} ·{' '}
        {session.status}
      </Text>
      <View style={styles.syncRow}>
        <SyncPill status={session.syncStatus} />
        <Text style={styles.dim}>
          {observations.filter((o) => o.syncStatus === 'synced').length}/
          {observations.length} observations synced
        </Text>
      </View>

      {path.length > 1 && (
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: path[0]!.latitude,
            longitude: path[0]!.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
        >
          <Polyline coordinates={path} strokeColor={colors.accent} strokeWidth={4} />
          <Marker coordinate={path[0]!} title="Start" pinColor="#3fb950" />
          <Marker coordinate={path[path.length - 1]!} title="End" pinColor="#e7413b" />
        </MapView>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Cycle statistics</Text>
        <View style={styles.statsRow}>
          <Stat label="Complete cycles" value={String(analysis.stats.completeCycleCount)} />
          <Stat label="Median cycle" value={formatSeconds(analysis.stats.medianCycleMs)} />
        </View>
        <View style={styles.statsRow}>
          <Stat label="Median red" value={formatSeconds(analysis.stats.medianRedMs)} />
          <Stat label="Median yellow" value={formatSeconds(analysis.stats.medianYellowMs)} />
          <Stat label="Median green" value={formatSeconds(analysis.stats.medianGreenMs)} />
        </View>
        {analysis.cycles.map((cycle, i) => (
          <Text key={cycle.startMs} style={styles.cycleLine}>
            Cycle {i + 1}: {formatDurationMs(cycle.durationMs)} (R{' '}
            {formatSeconds(cycle.redMs)} / Y {formatSeconds(cycle.yellowMs)} / G{' '}
            {formatSeconds(cycle.greenMs)})
          </Text>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Observations ({observations.length})</Text>
        {observations.length === 0 && <Text style={styles.dim}>No observations recorded.</Text>}
        {observations.map((obs) => {
          const anomalies = anomalyByObservation.get(obs.clientGeneratedId);
          return (
            <View key={obs.clientGeneratedId} style={styles.obsRow}>
              <View style={styles.obsMain}>
                <View style={styles.obsHeader}>
                  <StatePill state={obs.state} />
                  <Text style={styles.obsTime}>{formatClock(obs.observedAt)}</Text>
                  <Text style={styles.obsDuration}>
                    {formatSeconds(durationByObservation.get(obs.clientGeneratedId) ?? null)}
                  </Text>
                  <SyncPill status={obs.syncStatus} />
                </View>
                {obs.originalState && (
                  <Text style={styles.corrected}>corrected from {obs.originalState}</Text>
                )}
                {anomalies?.map((detail) => (
                  <Text key={detail} style={styles.anomaly}>⚠ {detail}</Text>
                ))}
              </View>
              <Pressable style={styles.obsAction} onPress={() => setEditing(obs)}>
                <Text style={styles.obsActionLabel}>Edit</Text>
              </Pressable>
              <Pressable style={styles.obsAction} onPress={() => onDelete(obs)}>
                <Text style={[styles.obsActionLabel, styles.deleteLabel]}>Delete</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {session.notes && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Notes</Text>
          <Text style={styles.notes}>{session.notes}</Text>
        </View>
      )}

      <Modal visible={editing != null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>
              Correct state ({editing ? formatClock(editing.observedAt) : ''})
            </Text>
            <View style={styles.stateGrid}>
              {SIGNAL_STATES.map((state: SignalState) => (
                <Pressable
                  key={state}
                  style={[styles.stateChoice, editing?.state === state && styles.stateChoiceActive]}
                  onPress={() => {
                    if (editing && state !== editing.state) {
                      correctObservationState(editing.clientGeneratedId, state);
                      reload();
                    }
                    setEditing(null);
                  }}
                >
                  <StatePill state={state} />
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.cancelButton} onPress={() => setEditing(null)}>
              <Text style={styles.dim}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: { alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  subtitle: { color: colors.textDim, fontSize: 14, marginTop: 2, marginBottom: spacing.sm },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  map: { height: 200, borderRadius: 12, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  statsRow: { flexDirection: 'row', marginBottom: spacing.sm },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  statLabel: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  cycleLine: { color: colors.textDim, fontSize: 12, paddingVertical: 2 },
  obsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.cardBorder,
  },
  obsMain: { flex: 1 },
  obsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  obsTime: { color: colors.text, fontSize: 13, fontWeight: '600' },
  obsDuration: { color: colors.textDim, fontSize: 12 },
  corrected: { color: colors.warning, fontSize: 11, marginTop: 2 },
  anomaly: { color: colors.warning, fontSize: 11, marginTop: 2 },
  obsAction: { paddingHorizontal: spacing.sm, paddingVertical: 6 },
  obsActionLabel: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  deleteLabel: { color: colors.danger },
  notes: { color: colors.text, fontSize: 14, lineHeight: 20 },
  dim: { color: colors.textDim, fontSize: 13 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: spacing.lg,
    width: '100%',
  },
  stateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stateChoice: { padding: 6, borderRadius: 8 },
  stateChoiceActive: { backgroundColor: colors.bg },
  cancelButton: { alignItems: 'center', marginTop: spacing.md },
});
