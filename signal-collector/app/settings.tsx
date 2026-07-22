import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import {
  requestBackgroundPermission,
  stopBackgroundTracking,
} from '@/services/locationService';
import { SAFETY_TEXT } from '@/components/SafetyNotice';
import { colors, spacing } from '@/utils/theme';

export default function SettingsScreen() {
  const settings = useSettingsStore();
  const auth = useAuthStore();
  const sync = useSyncStore();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const toggleBackground = async (enabled: boolean) => {
    if (!enabled) {
      settings.setBackgroundLocationEnabled(false);
      await stopBackgroundTracking();
      return;
    }
    Alert.alert(
      'Background location',
      'When enabled, SignalCollector keeps recording GPS samples during an ACTIVE collection session while the app is in the background. Tracking always stops when you end the session, and cannot continue if you force-close the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Enable',
          onPress: async () => {
            const granted = await requestBackgroundPermission();
            if (granted) {
              settings.setBackgroundLocationEnabled(true);
            } else {
              Alert.alert(
                'Permission needed',
                'Background location permission was not granted. On Android 11+ you must choose "Allow all the time" in system settings.',
              );
            }
          },
        },
      ],
    );
  };

  const sendLink = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) return;
    setSending(true);
    const ok = await auth.sendMagicLink(trimmed);
    setSending(false);
    if (ok) {
      Alert.alert('Check your email', `A magic sign-in link was sent to ${trimmed}.`);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account</Text>
        {!auth.configured && (
          <Text style={styles.warn}>
            Supabase is not configured (missing .env). Collection works fully offline;
            sync is disabled.
          </Text>
        )}
        {auth.email ? (
          <>
            <Text style={styles.value}>Signed in as {auth.email}</Text>
            <Pressable style={styles.buttonOutline} onPress={() => void auth.signOut()}>
              <Text style={styles.buttonOutlineLabel}>Sign out</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.dim}>
              Sign in with an email magic link to sync your data. Collection works
              without an account; data stays on this device until you sign in.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Pressable
              style={[styles.button, sending && styles.disabled]}
              disabled={sending || !auth.configured}
              onPress={() => void sendLink()}
            >
              <Text style={styles.buttonLabel}>
                {sending ? 'Sending…' : 'Send magic link'}
              </Text>
            </Pressable>
            {auth.error && <Text style={styles.warn}>{auth.error}</Text>}
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Collection</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Tap debounce: {settings.debounceMs} ms</Text>
          <View style={styles.stepper}>
            <Pressable
              style={styles.stepButton}
              onPress={() => settings.setDebounceMs(settings.debounceMs - 100)}
            >
              <Text style={styles.stepLabel}>−</Text>
            </Pressable>
            <Pressable
              style={styles.stepButton}
              onPress={() => settings.setDebounceMs(settings.debounceMs + 100)}
            >
              <Text style={styles.stepLabel}>+</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.dim}>
          Taps closer together than this are ignored (the raw tap time is still
          captured before the debounce check).
        </Text>
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <Text style={styles.label}>
            Accuracy warning: {settings.accuracyWarningMeters} m
          </Text>
          <View style={styles.stepper}>
            <Pressable
              style={styles.stepButton}
              onPress={() =>
                settings.setAccuracyWarningMeters(settings.accuracyWarningMeters - 5)
              }
            >
              <Text style={styles.stepLabel}>−</Text>
            </Pressable>
            <Pressable
              style={styles.stepButton}
              onPress={() =>
                settings.setAccuracyWarningMeters(settings.accuracyWarningMeters + 5)
              }
            >
              <Text style={styles.stepLabel}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Background location</Text>
        <View style={styles.row}>
          <Text style={[styles.label, styles.flex]}>
            Continue GPS sampling while the app is in the background during an active
            session
          </Text>
          <Switch
            value={settings.backgroundLocationEnabled}
            onValueChange={(v) => void toggleBackground(v)}
          />
        </View>
        <Text style={styles.dim}>
          Off by default. Only applies while a collection session is running; always
          stops when the session ends. If you force-close the app, the operating
          system stops tracking — no data is collected after that.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sync</Text>
        <Text style={styles.dim}>
          {sync.pendingQueueItems} queued uploads · last sync{' '}
          {sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleTimeString() : 'never'}
        </Text>
        {sync.lastError && <Text style={styles.warn}>Last error: {sync.lastError}</Text>}
        <Pressable
          style={[styles.button, sync.isSyncing && styles.disabled]}
          disabled={sync.isSyncing}
          onPress={() => void sync.triggerSync()}
        >
          <Text style={styles.buttonLabel}>{sync.isSyncing ? 'Syncing…' : 'Sync now'}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Safety</Text>
        <Text style={styles.dim}>{SAFETY_TEXT}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  flex: { flex: 1, marginRight: spacing.md },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  value: { color: colors.text, fontSize: 14, marginBottom: spacing.sm },
  dim: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: 4 },
  warn: { color: colors.warning, fontSize: 13, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonLabel: { color: '#04121f', fontWeight: '800' },
  buttonOutline: {
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonOutlineLabel: { color: colors.text, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  stepper: { flexDirection: 'row', gap: spacing.sm },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: { color: colors.text, fontSize: 20, fontWeight: '700' },
});
