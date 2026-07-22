import { getDb } from '@/database/db';
import { newUuid } from '@/utils/ids';
import { nowIso, msToIso } from '@/utils/time';
import type {
  CollectionSession,
  Intersection,
  LocationSample,
  QueueEntityType,
  QueueOp,
  SignalObservation,
  SignalState,
  SyncQueueItem,
} from '@/types/models';
import type {
  IntersectionInput,
  LocationSampleInput,
  ObservationInput,
  SessionInput,
} from '@/validation/schemas';

/* ------------------------------------------------------------------ */
/* Row mappers                                                         */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function mapSession(r: Row): CollectionSession {
  return {
    localId: r.local_id as number,
    clientGeneratedId: r.client_generated_id as string,
    intersectionClientId: (r.intersection_client_id as string) ?? null,
    intersectionName: r.intersection_name as string,
    approachDirection: r.approach_direction as CollectionSession['approachDirection'],
    movementType: r.movement_type as CollectionSession['movementType'],
    movementDescription: (r.movement_description as string) ?? null,
    startedAt: r.started_at as string,
    startedAtMs: r.started_at_ms as number,
    endedAt: (r.ended_at as string) ?? null,
    notes: (r.notes as string) ?? null,
    status: r.status as CollectionSession['status'],
    syncStatus: r.sync_status as CollectionSession['syncStatus'],
    createdAt: r.created_at as string,
  };
}

function mapObservation(r: Row): SignalObservation {
  return {
    localId: r.local_id as number,
    clientGeneratedId: r.client_generated_id as string,
    sessionClientId: r.session_client_id as string,
    state: r.state as SignalState,
    originalState: (r.original_state as SignalState) ?? null,
    observedAt: r.observed_at as string,
    deviceTimestampMs: r.device_timestamp_ms as number,
    latitude: (r.latitude as number) ?? null,
    longitude: (r.longitude as number) ?? null,
    headingDegrees: (r.heading_degrees as number) ?? null,
    speedMps: (r.speed_mps as number) ?? null,
    accuracyMeters: (r.accuracy_meters as number) ?? null,
    altitudeMeters: (r.altitude_meters as number) ?? null,
    source: r.source as SignalObservation['source'],
    note: (r.note as string) ?? null,
    syncStatus: r.sync_status as SignalObservation['syncStatus'],
    retryCount: r.retry_count as number,
    lastSyncError: (r.last_sync_error as string) ?? null,
    createdAt: r.created_at as string,
  };
}

function mapIntersection(r: Row): Intersection {
  return {
    clientGeneratedId: r.client_generated_id as string,
    name: r.name as string,
    latitude: r.latitude as number,
    longitude: r.longitude as number,
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    timezone: (r.timezone as string) ?? null,
    source: r.source as Intersection['source'],
    syncStatus: r.sync_status as Intersection['syncStatus'],
    createdAt: r.created_at as string,
  };
}

function mapSample(r: Row): LocationSample {
  return {
    localId: r.local_id as number,
    clientGeneratedId: r.client_generated_id as string,
    sessionClientId: r.session_client_id as string,
    observedAt: r.observed_at as string,
    latitude: r.latitude as number,
    longitude: r.longitude as number,
    headingDegrees: (r.heading_degrees as number) ?? null,
    speedMps: (r.speed_mps as number) ?? null,
    accuracyMeters: (r.accuracy_meters as number) ?? null,
    syncStatus: r.sync_status as LocationSample['syncStatus'],
  };
}

/* ------------------------------------------------------------------ */
/* Sync queue                                                          */
/* ------------------------------------------------------------------ */

export function enqueue(
  entityType: QueueEntityType,
  op: QueueOp,
  clientGeneratedId: string,
  payload: Record<string, unknown>,
): void {
  const db = getDb();
  db.runSync(
    `INSERT INTO sync_queue (entity_type, op, client_generated_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (entity_type, op, client_generated_id)
     DO UPDATE SET payload = excluded.payload, next_attempt_at_ms = 0`,
    [entityType, op, clientGeneratedId, JSON.stringify(payload), nowIso()],
  );
}

export function peekQueueBatch(limit: number, nowMs: number): SyncQueueItem[] {
  const db = getDb();
  const rows = db.getAllSync<Row>(
    `SELECT * FROM sync_queue WHERE next_attempt_at_ms <= ? ORDER BY id ASC LIMIT ?`,
    [nowMs, limit],
  );
  return rows.map((r) => ({
    id: r.id as number,
    entityType: r.entity_type as QueueEntityType,
    op: r.op as QueueOp,
    clientGeneratedId: r.client_generated_id as string,
    payload: JSON.parse(r.payload as string) as Record<string, unknown>,
    attempts: r.attempts as number,
    lastError: (r.last_error as string) ?? null,
    nextAttemptAtMs: r.next_attempt_at_ms as number,
    createdAt: r.created_at as string,
  }));
}

export function markQueueItemsSynced(ids: number[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  db.runSync(`DELETE FROM sync_queue WHERE id IN (${placeholders})`, ids);
}

export function markQueueItemFailed(
  id: number,
  error: string,
  nextAttemptAtMs: number,
): void {
  const db = getDb();
  db.runSync(
    `UPDATE sync_queue
     SET attempts = attempts + 1, last_error = ?, next_attempt_at_ms = ?
     WHERE id = ?`,
    [error.slice(0, 500), nextAttemptAtMs, id],
  );
}

export function pendingQueueCount(): number {
  const db = getDb();
  const row = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_queue');
  return row?.n ?? 0;
}

function setEntitySyncStatus(
  table: string,
  clientGeneratedId: string,
  status: string,
  error?: string,
): void {
  const db = getDb();
  db.runSync(
    `UPDATE ${table} SET sync_status = ?, last_sync_error = ? WHERE client_generated_id = ?`,
    [status, error ?? null, clientGeneratedId],
  );
}

const TABLE_BY_ENTITY: Record<QueueEntityType, string> = {
  intersection: 'local_intersections',
  session: 'local_sessions',
  observation: 'local_observations',
  location_sample: 'local_location_samples',
};

export function markEntitySynced(
  entityType: QueueEntityType,
  clientGeneratedId: string,
): void {
  setEntitySyncStatus(TABLE_BY_ENTITY[entityType], clientGeneratedId, 'synced');
}

export function markEntityFailed(
  entityType: QueueEntityType,
  clientGeneratedId: string,
  error: string,
): void {
  const db = getDb();
  db.runSync(
    `UPDATE ${TABLE_BY_ENTITY[entityType]}
     SET sync_status = 'failed', retry_count = retry_count + 1, last_sync_error = ?
     WHERE client_generated_id = ?`,
    [error.slice(0, 500), clientGeneratedId],
  );
}

/* ------------------------------------------------------------------ */
/* Intersections                                                       */
/* ------------------------------------------------------------------ */

export function insertIntersection(input: IntersectionInput): Intersection {
  const db = getDb();
  const createdAt = nowIso();
  db.runSync(
    `INSERT INTO local_intersections
       (client_generated_id, name, latitude, longitude, city, state, timezone, source, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      input.clientGeneratedId,
      input.name,
      input.latitude,
      input.longitude,
      input.city,
      input.state,
      input.timezone,
      input.source,
      createdAt,
    ],
  );
  enqueue('intersection', 'upsert', input.clientGeneratedId, {
    id: input.clientGeneratedId,
    name: input.name,
    latitude: input.latitude,
    longitude: input.longitude,
    city: input.city,
    state: input.state,
    timezone: input.timezone,
    source: input.source,
  });
  return {
    ...input,
    syncStatus: 'pending',
    createdAt,
  };
}

export function listIntersections(search?: string): Intersection[] {
  const db = getDb();
  const rows = search
    ? db.getAllSync<Row>(
        `SELECT * FROM local_intersections WHERE name LIKE ? ORDER BY name ASC`,
        [`%${search}%`],
      )
    : db.getAllSync<Row>(`SELECT * FROM local_intersections ORDER BY name ASC`);
  return rows.map(mapIntersection);
}

/** Merge intersections fetched from Supabase into the local cache. */
export function upsertRemoteIntersections(
  rows: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    city: string | null;
    state: string | null;
    timezone: string | null;
    source: string;
    created_at: string;
  }>,
): void {
  const db = getDb();
  db.withTransactionSync(() => {
    for (const r of rows) {
      db.runSync(
        `INSERT INTO local_intersections
           (client_generated_id, name, latitude, longitude, city, state, timezone, source, sync_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?)
         ON CONFLICT (client_generated_id) DO UPDATE SET
           name = excluded.name,
           latitude = excluded.latitude,
           longitude = excluded.longitude,
           city = excluded.city,
           state = excluded.state,
           timezone = excluded.timezone,
           sync_status = 'synced'`,
        [r.id, r.name, r.latitude, r.longitude, r.city, r.state, r.timezone, r.source, r.created_at],
      );
    }
  });
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export function insertSession(input: SessionInput): CollectionSession {
  const db = getDb();
  const createdAt = nowIso();
  db.runSync(
    `INSERT INTO local_sessions
       (client_generated_id, intersection_client_id, intersection_name, approach_direction,
        movement_type, movement_description, started_at, started_at_ms, status, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'pending', ?)`,
    [
      input.clientGeneratedId,
      input.intersectionClientId,
      input.intersectionName,
      input.approachDirection,
      input.movementType,
      input.movementDescription,
      input.startedAt,
      input.startedAtMs,
      createdAt,
    ],
  );
  enqueueSessionUpsert(input.clientGeneratedId);
  return getSessionByClientId(input.clientGeneratedId)!;
}

function enqueueSessionUpsert(clientGeneratedId: string): void {
  const session = getSessionByClientId(clientGeneratedId);
  if (!session) return;
  enqueue('session', 'upsert', clientGeneratedId, {
    id: session.clientGeneratedId,
    intersection_id: session.intersectionClientId,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    notes: session.notes,
    status: session.status,
    approach_direction: session.approachDirection,
    movement_type: session.movementType,
    movement_description: session.movementDescription,
  });
}

export function getSessionByClientId(
  clientGeneratedId: string,
): CollectionSession | null {
  const db = getDb();
  const row = db.getFirstSync<Row>(
    `SELECT * FROM local_sessions WHERE client_generated_id = ?`,
    [clientGeneratedId],
  );
  return row ? mapSession(row) : null;
}

export function getActiveSession(): CollectionSession | null {
  const db = getDb();
  const row = db.getFirstSync<Row>(
    `SELECT * FROM local_sessions WHERE status = 'active' ORDER BY started_at_ms DESC LIMIT 1`,
  );
  return row ? mapSession(row) : null;
}

export function listSessions(): CollectionSession[] {
  const db = getDb();
  const rows = db.getAllSync<Row>(
    `SELECT * FROM local_sessions ORDER BY started_at_ms DESC`,
  );
  return rows.map(mapSession);
}

export function endSession(clientGeneratedId: string, notes: string | null): void {
  const db = getDb();
  db.runSync(
    `UPDATE local_sessions
     SET status = 'completed', ended_at = ?, notes = COALESCE(?, notes), sync_status = 'pending'
     WHERE client_generated_id = ?`,
    [nowIso(), notes, clientGeneratedId],
  );
  enqueueSessionUpsert(clientGeneratedId);
}

export function appendSessionNote(clientGeneratedId: string, note: string): void {
  const db = getDb();
  const session = getSessionByClientId(clientGeneratedId);
  if (!session) return;
  const combined = session.notes ? `${session.notes}\n${note}` : note;
  db.runSync(
    `UPDATE local_sessions SET notes = ?, sync_status = 'pending' WHERE client_generated_id = ?`,
    [combined, clientGeneratedId],
  );
  enqueueSessionUpsert(clientGeneratedId);
}

/* ------------------------------------------------------------------ */
/* Observations                                                        */
/* ------------------------------------------------------------------ */

export function insertObservation(input: ObservationInput): SignalObservation {
  const db = getDb();
  const createdAt = nowIso();
  db.runSync(
    `INSERT INTO local_observations
       (client_generated_id, session_client_id, state, observed_at, device_timestamp_ms,
        latitude, longitude, heading_degrees, speed_mps, accuracy_meters, altitude_meters,
        source, note, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      input.clientGeneratedId,
      input.sessionClientId,
      input.state,
      input.observedAt,
      input.deviceTimestampMs,
      input.latitude,
      input.longitude,
      input.headingDegrees,
      input.speedMps,
      input.accuracyMeters,
      input.altitudeMeters,
      input.source,
      input.note,
      createdAt,
    ],
  );
  enqueueObservationUpsert(input.clientGeneratedId);
  return getObservationByClientId(input.clientGeneratedId)!;
}

function enqueueObservationUpsert(clientGeneratedId: string): void {
  const obs = getObservationByClientId(clientGeneratedId);
  if (!obs) return;
  enqueue('observation', 'upsert', clientGeneratedId, {
    client_generated_id: obs.clientGeneratedId,
    session_id: obs.sessionClientId,
    state: obs.state,
    observed_at: obs.observedAt,
    device_timestamp_ms: obs.deviceTimestampMs,
    latitude: obs.latitude,
    longitude: obs.longitude,
    heading_degrees: obs.headingDegrees,
    speed_mps: obs.speedMps,
    accuracy_meters: obs.accuracyMeters,
    altitude_meters: obs.altitudeMeters,
    source: obs.source,
    note: obs.note,
  });
}

export function getObservationByClientId(
  clientGeneratedId: string,
): SignalObservation | null {
  const db = getDb();
  const row = db.getFirstSync<Row>(
    `SELECT * FROM local_observations WHERE client_generated_id = ?`,
    [clientGeneratedId],
  );
  return row ? mapObservation(row) : null;
}

export function listObservationsForSession(
  sessionClientId: string,
): SignalObservation[] {
  const db = getDb();
  const rows = db.getAllSync<Row>(
    `SELECT * FROM local_observations WHERE session_client_id = ?
     ORDER BY device_timestamp_ms ASC, local_id ASC`,
    [sessionClientId],
  );
  return rows.map(mapObservation);
}

/**
 * Correct an observation's state. The raw original state is preserved in
 * `original_state` (only set the first time so repeated edits keep the
 * true original), and the record is re-queued for sync.
 */
export function correctObservationState(
  clientGeneratedId: string,
  newState: SignalState,
): void {
  const db = getDb();
  db.runSync(
    `UPDATE local_observations
     SET original_state = COALESCE(original_state, state), state = ?, sync_status = 'pending'
     WHERE client_generated_id = ?`,
    [newState, clientGeneratedId],
  );
  enqueueObservationUpsert(clientGeneratedId);
}

export function deleteObservation(clientGeneratedId: string): void {
  const db = getDb();
  const obs = getObservationByClientId(clientGeneratedId);
  if (!obs) return;
  db.withTransactionSync(() => {
    db.runSync(`DELETE FROM local_observations WHERE client_generated_id = ?`, [
      clientGeneratedId,
    ]);
    // Cancel any pending upload for this record.
    db.runSync(
      `DELETE FROM sync_queue WHERE entity_type = 'observation' AND op = 'upsert' AND client_generated_id = ?`,
      [clientGeneratedId],
    );
  });
  // If the record already reached the server, queue a remote delete.
  if (obs.syncStatus === 'synced') {
    enqueue('observation', 'delete', clientGeneratedId, {
      client_generated_id: clientGeneratedId,
    });
  }
}

export function deleteLastObservation(sessionClientId: string): SignalObservation | null {
  const db = getDb();
  const row = db.getFirstSync<Row>(
    `SELECT * FROM local_observations WHERE session_client_id = ?
     ORDER BY device_timestamp_ms DESC, local_id DESC LIMIT 1`,
    [sessionClientId],
  );
  if (!row) return null;
  const obs = mapObservation(row);
  deleteObservation(obs.clientGeneratedId);
  return obs;
}

export function unsyncedObservationCount(): number {
  const db = getDb();
  const row = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM local_observations WHERE sync_status != 'synced'`,
  );
  return row?.n ?? 0;
}

/* ------------------------------------------------------------------ */
/* Location samples                                                    */
/* ------------------------------------------------------------------ */

export function insertLocationSample(input: LocationSampleInput): void {
  const db = getDb();
  db.runSync(
    `INSERT INTO local_location_samples
       (client_generated_id, session_client_id, observed_at, latitude, longitude,
        heading_degrees, speed_mps, accuracy_meters, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      input.clientGeneratedId,
      input.sessionClientId,
      input.observedAt,
      input.latitude,
      input.longitude,
      input.headingDegrees,
      input.speedMps,
      input.accuracyMeters,
      nowIso(),
    ],
  );
  enqueue('location_sample', 'upsert', input.clientGeneratedId, {
    client_generated_id: input.clientGeneratedId,
    session_id: input.sessionClientId,
    observed_at: input.observedAt,
    latitude: input.latitude,
    longitude: input.longitude,
    heading_degrees: input.headingDegrees,
    speed_mps: input.speedMps,
    accuracy_meters: input.accuracyMeters,
  });
}

export function listSamplesForSession(sessionClientId: string): LocationSample[] {
  const db = getDb();
  const rows = db.getAllSync<Row>(
    `SELECT * FROM local_location_samples WHERE session_client_id = ? ORDER BY observed_at ASC`,
    [sessionClientId],
  );
  return rows.map(mapSample);
}

/* ------------------------------------------------------------------ */
/* Helpers for creating observations from taps                         */
/* ------------------------------------------------------------------ */

export function buildObservationInput(params: {
  sessionClientId: string;
  state: SignalState;
  rawTimestampMs: number;
  fix: {
    latitude: number;
    longitude: number;
    headingDegrees: number | null;
    speedMps: number | null;
    accuracyMeters: number | null;
    altitudeMeters: number | null;
  } | null;
}): ObservationInput {
  return {
    clientGeneratedId: newUuid(),
    sessionClientId: params.sessionClientId,
    state: params.state,
    observedAt: msToIso(params.rawTimestampMs),
    deviceTimestampMs: params.rawTimestampMs,
    latitude: params.fix?.latitude ?? null,
    longitude: params.fix?.longitude ?? null,
    headingDegrees: params.fix?.headingDegrees ?? null,
    speedMps: params.fix?.speedMps ?? null,
    accuracyMeters: params.fix?.accuracyMeters ?? null,
    altitudeMeters: params.fix?.altitudeMeters ?? null,
    source: 'manual',
    note: null,
  };
}
