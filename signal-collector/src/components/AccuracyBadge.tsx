import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { isAccuracyPoor } from '@/utils/geo';
import { useSettingsStore } from '@/stores/settingsStore';
import { colors } from '@/utils/theme';

interface Props {
  accuracyMeters: number | null | undefined;
}

/**
 * Shows GPS accuracy and warns when it exceeds the configured threshold.
 * Poor accuracy never blocks collection -- observations are always kept.
 */
export function AccuracyBadge({ accuracyMeters }: Props) {
  const threshold = useSettingsStore((s) => s.accuracyWarningMeters);
  const poor = isAccuracyPoor(accuracyMeters ?? null, threshold);
  const label =
    accuracyMeters != null && Number.isFinite(accuracyMeters)
      ? `±${accuracyMeters.toFixed(0)} m`
      : 'no fix';

  return (
    <View style={[styles.badge, poor ? styles.poor : styles.good]}>
      <Text style={styles.text}>
        GPS {label}
        {poor ? ' — low accuracy, observations still recorded' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  good: { backgroundColor: 'rgba(63, 185, 80, 0.15)' },
  poor: { backgroundColor: 'rgba(210, 153, 34, 0.2)' },
  text: { color: colors.text, fontSize: 12, fontWeight: '600' },
});
