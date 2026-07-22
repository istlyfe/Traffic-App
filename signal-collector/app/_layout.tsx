import React, { useEffect } from 'react';
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
import { colors } from '@/utils/theme';

getDb(); // ensure schema exists before any screen renders

export default function RootLayout() {
  const initAuth = useAuthStore((s) => s.init);
  const handleDeepLink = useAuthStore((s) => s.handleDeepLink);
  const initAutoSync = useSyncStore((s) => s.initAutoSync);
  const refreshCounts = useSyncStore((s) => s.refreshCounts);
  const restoreActiveSession = useSessionStore((s) => s.restoreActiveSession);
  const url = Linking.useURL();

  useEffect(() => {
    void initAuth();
    initAutoSync();
    refreshCounts();
    // Resume a session that was active when the app was last closed.
    restoreActiveSession();
    void refreshIntersectionsFromRemote();
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
