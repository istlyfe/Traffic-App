import React, { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionClock } from '@/hooks/useSessionClock';
import { SignalButton } from '@/components/SignalButton';
import { AccuracyBadge } from '@/components/AccuracyBadge';
import { StatePill } from '@/components/StatePill';
import { PRIMARY_STATES, SECONDARY_STATES } from '@/types/models';
import type { SignalState } from '@/types/models';
import { formatDurationMs } from '@/utils/time';
import { colors, spacing } from '@/utils/theme';

export default function CollectScreen() {
  const session = useSessionStore((s) => s.activeSession);
  const currentState = useSessionStore((s) => s.currentState);
  const observations = useSessionStore((s) => s.observations);
  const cycleCount = useSessionStore((s) => s.cycleCount);
  const fix = useSessionStore((s) => s.currentFix);
  const recordTap = useSessionStore((s) => s.recordTap);
  const undoLast = useSessionStore((s) => s.undoLast);
  const addNote = useSessionStore((s) => s.addNote);
  const endSession = useSessionStore((s) => s.endSession);

  const elapsed = useSessionClock(session?.startedAtMs ?? null, Boolean(session));

  const [showMore, setShowMore] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');

  const onTap = useCallback(
    (state: SignalState, rawTimestampMs: number) => {
      const result = recordTap(state, rawTimestampMs);
      if (!result.accepted && result.reason === 'debounced') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    },
    [recordTap],
  );

  const onUndo = useCallback(() => {
    const removed = undoLast();
    if (removed) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [undoLast]);

  const onEnd = useCallback(() => {
    if (!session) return;
    const id = session.clientGeneratedId;
    Alert.alert('End session?', 'Location tracking stops and the session is finalized.', [
      { text: 'Keep collecting', style: 'cancel' },
      {
        text: 'End session',
        style: 'destructive',
        onPress: () => {
          void endSession(null).then(() => router.replace(`/session/${id}`));
        },
      },
    ]);
  }, [session, endSession]);

  if (!session) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text style={styles.metaText}>No active session.</Text>
        <Pressable onPress={() => router.replace('/')}>
          <Text style={styles.link}>Back to home</Text>
        </Pressable>
      </View>
    );
  }

  const speedText =
    fix?.speedMps != null ? `${(fix.speedMps * 3.6).toFixed(0)} km/h` : '--';
  const headingText =
    fix?.headingDegrees != null ? `${fix.headingDegrees.toFixed(0)}°` : '--';

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.intersection} numberOfLines={1}>
          {session.intersectionName}
        </Text>
        <Text style={styles.movement}>
          {session.approachDirection} · {session.movementType.replace('_', ' ')}
          {session.movementDescription ? ` · ${session.movementDescription}` : ''}
        </Text>
        <View style={styles.metaRow}>
          <AccuracyBadge accuracyMeters={fix?.accuracyMeters} />
          <Text style={styles.metaText}>speed {speedText}</Text>
          <Text style={styles.metaText}>hdg {headingText}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>⏱ {formatDurationMs(elapsed)}</Text>
          <Text style={styles.metaText}>cycles {cycleCount}</Text>
          <Text style={styles.metaText}>events {observations.length}</Text>
          {currentState ? <StatePill state={currentState} /> : (
            <Text style={styles.metaText}>no state yet</Text>
          )}
        </View>
      </View>

      <View style={styles.buttons}>
        {PRIMARY_STATES.map((state) => (
          <SignalButton
            key={state}
            state={state}
            active={currentState === state}
            onTap={onTap}
          />
        ))}
      </View>

      <Pressable style={styles.moreToggle} onPress={() => setShowMore((v) => !v)}>
        <Text style={styles.moreLabel}>
          {showMore ? 'Hide uncommon states ▲' : 'Uncommon states ▼'}
        </Text>
      </Pressable>
      {showMore && (
        <View style={styles.moreRow}>
          {SECONDARY_STATES.map((state) => (
            <SignalButton
              key={state}
              state={state}
              compact
              active={currentState === state}
              onTap={onTap}
            />
          ))}
        </View>
      )}

      <View style={styles.footer}>
        <Pressable
          style={[styles.footerButton, observations.length === 0 && styles.disabled]}
          disabled={observations.length === 0}
          onPress={onUndo}
        >
          <Text style={styles.footerLabel}>Undo last</Text>
        </Pressable>
        <Pressable style={styles.footerButton} onPress={() => setShowNote(true)}>
          <Text style={styles.footerLabel}>Add note</Text>
        </Pressable>
        <Pressable style={[styles.footerButton, styles.endButton]} onPress={onEnd}>
          <Text style={[styles.footerLabel, styles.endLabel]}>End session</Text>
        </Pressable>
      </View>

      <Modal visible={showNote} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Session note</Text>
            <TextInput
              style={styles.noteInput}
              placeholder="e.g. pedestrian recall every cycle, heavy rain"
              placeholderTextColor={colors.textDim}
              value={note}
              onChangeText={setNote}
              multiline
              autoFocus
            />
            <Pressable
              style={styles.saveButton}
              onPress={() => {
                if (note.trim()) addNote(note.trim());
                setNote('');
                setShowNote(false);
              }}
            >
              <Text style={styles.saveLabel}>Save note</Text>
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setShowNote(false)}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: { marginBottom: spacing.sm },
  intersection: { color: colors.text, fontSize: 20, fontWeight: '800' },
  movement: { color: colors.textDim, fontSize: 14, marginTop: 2, marginBottom: spacing.sm },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
    flexWrap: 'wrap',
  },
  metaText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  buttons: { flex: 1 },
  moreToggle: { alignItems: 'center', paddingVertical: spacing.sm },
  moreLabel: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  moreRow: { flexDirection: 'row', flexWrap: 'wrap' },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  footerButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  endButton: { borderColor: colors.danger },
  footerLabel: { color: colors.text, fontWeight: '700', fontSize: 14 },
  endLabel: { color: colors.danger },
  disabled: { opacity: 0.4 },
  link: { color: colors.accent, marginTop: spacing.md, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: spacing.md },
  noteInput: {
    backgroundColor: colors.bg,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    padding: spacing.md,
    minHeight: 90,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  saveButton: {
    backgroundColor: colors.success,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  saveLabel: { color: '#04260d', fontWeight: '800' },
  cancelButton: { alignItems: 'center', paddingVertical: 10 },
  cancelLabel: { color: colors.textDim },
});
