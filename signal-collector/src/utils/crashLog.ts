import { getDb } from '@/database/db';

/**
 * Captures otherwise-invisible fatal JS errors in production builds.
 *
 * In a standalone build there is no Metro console, so an uncaught error in
 * an async callback (e.g. a location update) closes the app with no trace.
 * We hook the RN global error handler and persist the last error, then
 * surface it in Settings on the next launch so it can actually be diagnosed.
 *
 * The write is a SYNCHRONOUS SQLite insert (not async AsyncStorage): a hard
 * crash can kill the app before an async write flushes, but runSync commits
 * before the default handler runs, so the record survives.
 */

export interface CrashRecord {
  message: string;
  stack: string | null;
  isFatal: boolean;
  at: string;
}

function ensureTable(): void {
  getDb().execSync(
    `CREATE TABLE IF NOT EXISTS crash_log (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       message TEXT NOT NULL,
       stack TEXT,
       is_fatal INTEGER NOT NULL DEFAULT 0,
       at TEXT NOT NULL
     );`,
  );
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
  try {
    ensureTable();
  } catch {
    // ignore — best effort
  }
  const previous = g.ErrorUtils.getGlobalHandler?.();
  g.ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const e = error as { message?: string; stack?: string } | undefined;
    try {
      getDb().runSync(
        `INSERT INTO crash_log (message, stack, is_fatal, at) VALUES (?, ?, ?, ?)`,
        [
          e?.message ?? String(error),
          e?.stack ?? null,
          isFatal ? 1 : 0,
          new Date().toISOString(),
        ],
      );
    } catch {
      // ignore — never let logging cause a secondary crash
    }
    previous?.(error, isFatal);
  });
}

/** Manually record a caught (non-fatal) error, e.g. from a try/catch. */
export function recordCaught(context: string, error: unknown): void {
  const e = error as { message?: string; stack?: string } | undefined;
  try {
    ensureTable();
    getDb().runSync(
      `INSERT INTO crash_log (message, stack, is_fatal, at) VALUES (?, ?, 0, ?)`,
      [`[${context}] ${e?.message ?? String(error)}`, e?.stack ?? null, new Date().toISOString()],
    );
  } catch {
    // ignore
  }
}

export function readLastCrash(): CrashRecord | null {
  try {
    ensureTable();
    const row = getDb().getFirstSync<{
      message: string;
      stack: string | null;
      is_fatal: number;
      at: string;
    }>(`SELECT message, stack, is_fatal, at FROM crash_log ORDER BY id DESC LIMIT 1`);
    if (!row) return null;
    return {
      message: row.message,
      stack: row.stack,
      isFatal: row.is_fatal === 1,
      at: row.at,
    };
  } catch {
    return null;
  }
}

export function clearLastCrash(): void {
  try {
    getDb().runSync(`DELETE FROM crash_log`);
  } catch {
    // ignore
  }
}
