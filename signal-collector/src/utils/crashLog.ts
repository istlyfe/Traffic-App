import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Captures otherwise-invisible fatal JS errors in production builds.
 *
 * In a standalone build there is no Metro console, so an uncaught error in
 * an async callback (e.g. a location update) closes the app with no trace.
 * We hook the RN global error handler, persist the last error, and surface
 * it in Settings on the next launch so it can actually be diagnosed.
 */

const KEY = 'last_crash_v1';

export interface CrashRecord {
  message: string;
  stack: string | null;
  isFatal: boolean;
  at: string;
}

export function installGlobalErrorHandler(): void {
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (h: (error: unknown, isFatal?: boolean) => void) => void;
    };
    __signalCrashHandlerInstalled?: boolean;
  };
  if (!g.ErrorUtils?.setGlobalHandler || g.__signalCrashHandlerInstalled) return;
  g.__signalCrashHandlerInstalled = true;
  const previous = g.ErrorUtils.getGlobalHandler?.();
  g.ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const e = error as { message?: string; stack?: string } | undefined;
    void AsyncStorage.setItem(
      KEY,
      JSON.stringify({
        message: e?.message ?? String(error),
        stack: e?.stack ?? null,
        isFatal: Boolean(isFatal),
        at: new Date().toISOString(),
      }),
    ).catch(() => {});
    previous?.(error, isFatal);
  });
}

export async function readLastCrash(): Promise<CrashRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CrashRecord) : null;
  } catch {
    return null;
  }
}

export async function clearLastCrash(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
