import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/utils/theme';

export const SAFETY_TEXT =
  'Only a passenger or safely parked person should operate the collection controls. Do not interact with this application while driving.';

interface Props {
  visible: boolean;
  onAcknowledge: () => void;
  onCancel: () => void;
}

/** Blocking safety acknowledgment shown before the first collection session. */
export function SafetyNotice({ visible, onAcknowledge, onCancel }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Safety notice</Text>
          <Text style={styles.body}>{SAFETY_TEXT}</Text>
          <Pressable style={styles.ackButton} onPress={onAcknowledge}>
            <Text style={styles.ackLabel}>I am a passenger or safely parked</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.lg,
    width: '100%',
  },
  title: {
    color: colors.danger,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: spacing.md,
  },
  body: { color: colors.text, fontSize: 16, lineHeight: 24, marginBottom: spacing.lg },
  ackButton: {
    backgroundColor: colors.success,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  ackLabel: { color: '#04260d', fontSize: 16, fontWeight: '800' },
  cancelButton: { padding: spacing.md, alignItems: 'center' },
  cancelLabel: { color: colors.textDim, fontSize: 15 },
});
