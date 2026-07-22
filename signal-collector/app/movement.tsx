import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSessionStore } from '@/stores/sessionStore';
import { APPROACH_DIRECTIONS, MOVEMENT_TYPES } from '@/types/models';
import type { ApproachDirection, MovementType } from '@/types/models';
import { colors, spacing } from '@/utils/theme';

const DIRECTION_LABELS: Record<ApproachDirection, string> = {
  northbound: 'Northbound',
  southbound: 'Southbound',
  eastbound: 'Eastbound',
  westbound: 'Westbound',
};

const MOVEMENT_LABELS: Record<MovementType, string> = {
  through: 'Through',
  left_turn: 'Left turn',
  right_turn: 'Right turn',
  pedestrian: 'Pedestrian',
  unknown: 'Unknown',
};

export default function MovementScreen() {
  const intersection = useSessionStore((s) => s.draft.intersection);
  const setDraftMovement = useSessionStore((s) => s.setDraftMovement);
  const startSession = useSessionStore((s) => s.startSession);

  const [direction, setDirection] = useState<ApproachDirection | null>(null);
  const [movement, setMovement] = useState<MovementType | null>(null);
  const [description, setDescription] = useState('');
  const [starting, setStarting] = useState(false);

  const canStart = Boolean(intersection && direction && movement && !starting);

  const start = async () => {
    if (!direction || !movement) return;
    setStarting(true);
    setDraftMovement(direction, movement, description.trim() || null);
    const session = await startSession();
    setStarting(false);
    if (session) {
      router.replace('/collect');
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.intersection}>{intersection?.name ?? 'No intersection selected'}</Text>

      <Text style={styles.sectionTitle}>Approach direction</Text>
      <View style={styles.chipWrap}>
        {APPROACH_DIRECTIONS.map((d) => (
          <Pressable
            key={d}
            style={[styles.chip, direction === d && styles.chipActive]}
            onPress={() => setDirection(d)}
          >
            <Text style={[styles.chipLabel, direction === d && styles.chipLabelActive]}>
              {DIRECTION_LABELS[d]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Movement</Text>
      <View style={styles.chipWrap}>
        {MOVEMENT_TYPES.map((m) => (
          <Pressable
            key={m}
            style={[styles.chip, movement === m && styles.chipActive]}
            onPress={() => setMovement(m)}
          >
            <Text style={[styles.chipLabel, movement === m && styles.chipLabelActive]}>
              {MOVEMENT_LABELS[m]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Custom description (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. protected left arrow, second signal head from left"
        placeholderTextColor={colors.textDim}
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <Pressable
        style={[styles.startButton, !canStart && styles.startDisabled]}
        disabled={!canStart}
        onPress={() => void start()}
      >
        <Text style={styles.startLabel}>{starting ? 'Starting…' : 'Start session'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  intersection: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  chipLabelActive: { color: '#04121f' },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    padding: spacing.md,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  startButton: {
    backgroundColor: colors.success,
    borderRadius: 14,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  startDisabled: { opacity: 0.4 },
  startLabel: { color: '#04260d', fontSize: 18, fontWeight: '800' },
});
