import React, { useEffect } from 'react';
import { ScrollView, Text, Pressable, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
// Registers the background location task at module scope (required by
// expo-task-manager) and initializes the SQLite schema on first import.
import '@/services/locationService';
import { getDb } from '@/database/db';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useSessionStore } from '@/stores/sessionStore';
import { refreshIntersectionsFromRemote } from '@/services/syncService';
import { installGlobalErrorHandler } from '@/utils/crashLog';
import { colors } from '@/utils/theme';

// Capture uncaught JS errors (incl. those in async callbacks) so they can be
// reviewed in Settings after a production crash.
installGlobalErrorHandler();

// Ensure schema exists before any screen renders. Guarded so a migration
// failure surfaces in the ErrorBoundary instead of crashing at import time.
try {
  getDb();
} catch (err) {
  console.error('[db] init failed', err);
}

/**
 * Expo Router renders this when any screen throws during render. In a
 * production build an uncaught error would otherwise crash straight to the
 * home screen with no message; this shows the error so it can be reported.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <ScrollView style={boundaryStyles.screen} contentContainerStyle={boundaryStyles.content}>
      <Text style={boundaryStyles.title}>Something went wrong</Text>
      <Text style={boundaryStyles.message}>{error.message}</Text>
      {error.stack ? <Text style={boundaryStyles.stack}>{error.stack}</Text> : null}
      <Pressable style={boundaryStyles.button} onPress={() => void retry()}>
        <Text style={boundaryStyles.buttonLabel}>Try again</Text>
      </Pressable>
    </ScrollView>
  );
}

const boundaryStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, paddingTop: 80 },
  title: { color: colors.danger, fontSize: 22, fontWeight: '800', marginBottom: 12 },
  message: { color: colors.text, fontSize: 15, marginBottom: 16, lineHeight: 22 },
  stack: { color: colors.textDim, fontSize: 11, fontFamily: 'Courier', marginBottom: 24 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonLabel: { color: '#04121f', fontWeight: '800', fontSize: 16 },
});

export default function RootLayout() {
  const initAuth = useAuthStore((s) => s.init);
  const handleDeepLink = useAuthStore((s) => s.handleDeepLink);
  const initAutoSync = useSyncStore((s) => s.initAutoSync);
  const refreshCounts = useSyncStore((s) => s.refreshCounts);
  const restoreActiveSession = useSessionStore((s) => s.restoreActiveSession);
  const url = Linking.useURL();

  useEffect(() => {
    // Each guarded independently so one failing service never blanks the app.
    try {
      void initAuth();
    } catch (err) {
      console.error('[startup] initAuth', err);
    }
    try {
      initAutoSync();
    } catch (err) {
      console.error('[startup] initAutoSync', err);
    }
    try {
      refreshCounts();
    } catch (err) {
      console.error('[startup] refreshCounts', err);
    }
    try {
      // Resume a session that was active when the app was last closed.
      restoreActiveSession();
    } catch (err) {
      console.error('[startup] restoreActiveSession', err);
    }
    void refreshIntersectionsFromRemote().catch((err) =>
      console.error('[startup] refreshIntersections', err),
    );
  }, [initAuth, initAutoSync, refreshCounts, restoreActiveSession]);

  useEffect(() => {
    if (url?.includes('auth-callback')) {
      void handleDeepLink(url);
    }
  }, [url, handleDeepLink]);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'SignalCollector' }} />
        <Stack.Screen name="intersections" options={{ title: 'Select intersection' }} />
        <Stack.Screen name="movement" options={{ title: 'Approach & movement' }} />
        <Stack.Screen
          name="collect"
          options={{ title: 'Collecting', headerBackVisible: false, gestureEnabled: false }}
        />
        <Stack.Screen name="sessions" options={{ title: 'Sessions' }} />
        <Stack.Screen name="session/[id]" options={{ title: 'Session review' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </>
  );
}
