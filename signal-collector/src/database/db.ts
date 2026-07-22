import * as SQLite from 'expo-sqlite';

/**
 * Local offline-first store. Every record carries a client-generated UUID,
 * a sync status, retry bookkeeping and a created timestamp, so nothing is
 * ever lost while the device is offline and retries can be idempotent.
 */

let dbInstance: SQLite.SQLiteDatabase | null = null;

const SCHEMA_VERSION = 1;

export function getDb(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync('signal-collector.db');
    migrate(dbInstance);
  }
  return dbInstance;
}

/** Test hook: swap in an in-memory database. */
export function __setDbForTesting(db: SQLite.SQLiteDatabase | null): void {
  dbInstance = db;
}

function migrate(db: SQLite.SQLiteDatabase): void {
  db.execSync('PRAGMA journal_mode = WAL;');
  db.execSync('PRAGMA foreign_keys = ON;');

  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version;');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  db.execSync(`
    CREATE TABLE IF NOT EXISTS local_intersections (
      local_id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_generated_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      city TEXT,
      state TEXT,
      timezone TEXT,
      source TEXT NOT NULL DEFAULT 'user',
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_sync_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_sessions (
      local_id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_generated_id TEXT NOT NULL UNIQUE,
      intersection_client_id TEXT,
      intersection_name TEXT NOT NULL,
      approach_direction TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      movement_description TEXT,
      started_at TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL,
      ended_at TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_sync_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_observations (
      local_id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_generated_id TEXT NOT NULL UNIQUE,
      session_client_id TEXT NOT NULL,
      state TEXT NOT NULL,
      original_state TEXT,
      observed_at TEXT NOT NULL,
      device_timestamp_ms INTEGER NOT NULL,
      latitude REAL,
      longitude REAL,
      heading_degrees REAL,
      speed_mps REAL,
      accuracy_meters REAL,
      altitude_meters REAL,
      source TEXT NOT NULL DEFAULT 'manual',
      note TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_sync_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_location_samples (
      local_id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_generated_id TEXT NOT NULL UNIQUE,
      session_client_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      heading_degrees REAL,
      speed_mps REAL,
      accuracy_meters REAL,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_sync_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      op TEXT NOT NULL DEFAULT 'upsert',
      client_generated_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (entity_type, op, client_generated_id)
    );

    CREATE INDEX IF NOT EXISTS idx_obs_session ON local_observations (session_client_id);
    CREATE INDEX IF NOT EXISTS idx_obs_timestamp ON local_observations (device_timestamp_ms);
    CREATE INDEX IF NOT EXISTS idx_obs_sync ON local_observations (sync_status);
    CREATE INDEX IF NOT EXISTS idx_samples_session ON local_location_samples (session_client_id);
    CREATE INDEX IF NOT EXISTS idx_queue_next_attempt ON sync_queue (next_attempt_at_ms);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON local_sessions (started_at_ms);
  `);

  db.execSync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}
