import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { SignalState } from '@/types/models';

const BUTTON_COLORS: Partial<Record<SignalState, { bg: string; pressed: string }>> = {
  RED: { bg: '#c03530', pressed: '#e7413b' },
  YELLOW: { bg: '#c9a227', pressed: '#f2c744' },
  GREEN: { bg: '#2e8b3d', pressed: '#3fb950' },
  FLASHING_RED: { bg: '#7a2320', pressed: '#c03530' },
  FLASHING_YELLOW: { bg: '#7d6517', pressed: '#c9a227' },
  DARK: { bg: '#21262d', pressed: '#30363d' },
  UNKNOWN: { bg: '#3d3d52', pressed: '#565675' },
};

interface Props {
  state: SignalState;
  active: boolean;
  compact?: boolean;
  /**
   * Called with the raw press timestamp captured synchronously in the
   * handler, before haptics, debounce or any async work.
   */
  onTap: (state: SignalState, rawTimestampMs: number) => void;
}

export function SignalButton({ state, active, compact = false, onTap }: Props) {
  const handlePress = useCallback(() => {
    const rawTimestampMs = Date.now(); // capture FIRST, before anything else
    void Haptics.impactAsync(
      compact ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Heavy,
    );
    onTap(state, rawTimestampMs);
  }, [state, compact, onTap]);

  const palette = BUTTON_COLORS[state] ?? BUTTON_COLORS.UNKNOWN!;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Record ${state.replace(/_/g, ' ').toLowerCase()} signal`}
      onPress={handlePress}
      style={({ pressed }) => [
        compact ? styles.compact : styles.big,
        { backgroundColor: pressed ? palette.pressed : palette.bg },
        active && styles.active,
      ]}
    >
      <Text style={compact ? styles.compactLabel : styles.bigLabel}>
        {state.replace(/_/g, ' ')}
      </Text>
      {active && !compact && (
        <View style={styles.activeDotWrap}>
          <Text style={styles.activeDot}>CURRENT</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  big: {
    flex: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 6,
    minHeight: 96,
  },
  compact: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginBottom: 8,
  },
  active: {
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  bigLabel: {
    color: '#ffffff',
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 2,
  },
  compactLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  activeDotWrap: {
    position: 'absolute',
    top: 8,
    right: 12,
  },
  activeDot: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    opacity: 0.85,
  },
});
