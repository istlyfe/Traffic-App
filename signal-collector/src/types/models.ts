/**
 * Core domain types shared across the local database, sync layer and UI.
 *
 * All timestamps are captured twice on purpose:
 *  - `observedAt`         ISO-8601 string, human/interop friendly, used remotely.
 *  - `deviceTimestampMs`  raw epoch milliseconds from the device clock. This is
 *    the authoritative ordering key for transition analysis and is never
 *    mutated after capture.
 */

export const SIGNAL_STATES = [
  'RED',
  'YELLOW',
  'GREEN',
  'FLASHING_RED',
  'FLASHING_YELLOW',
  'DARK',
  'UNKNOWN',
] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];

export const PRIMARY_STATES: SignalState[] = ['RED', 'YELLOW', 'GREEN'];
export const SECONDARY_STATES: SignalState[] = [
  'FLASHING_RED',
  'FLASHING_YELLOW',
  'DARK',
  'UNKNOWN',
];

export const APPROACH_DIRECTIONS = [
  'northbound',
  'southbound',
  'eastbound',
  'westbound',
] as const;
export type ApproachDirection = (typeof APPROACH_DIRECTIONS)[number];

export const MOVEMENT_TYPES = [
  'through',
  'left_turn',
  'right_turn',
  'pedestrian',
  'unknown',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';
export type SessionStatus = 'active' | 'completed' | 'discarded';

export interface GeoFix {
  latitude: number;
  longitude: number;
  headingDegrees: number | null;
  speedMps: number | null;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  timestampMs: number;
}

export interface Intersection {
  clientGeneratedId: string;
  name: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  timezone: string | null;
  source: 'seed' | 'user' | 'import';
  syncStatus: SyncStatus;
  createdAt: string;
}

export interface MovementSelection {
  approachDirection: ApproachDirection;
  movementType: MovementType;
  description: string | null;
}

export interface CollectionSession {
  localId: number;
  clientGeneratedId: string;
  intersectionClientId: string | null;
  intersectionName: string;
  approachDirection: ApproachDirection;
  movementType: MovementType;
  movementDescription: string | null;
  startedAt: string;
  startedAtMs: number;
  endedAt: string | null;
  notes: string | null;
  status: SessionStatus;
  syncStatus: SyncStatus;
  createdAt: string;
}

export interface SignalObservation {
  localId: number;
  clientGeneratedId: string;
  sessionClientId: string;
  state: SignalState;
  /** State as originally tapped; set when the user later corrects the state. */
  originalState: SignalState | null;
  observedAt: string;
  deviceTimestampMs: number;
  latitude: number | null;
  longitude: number | null;
  headingDegrees: number | null;
  speedMps: number | null;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  source: 'manual' | 'import';
  note: string | null;
  syncStatus: SyncStatus;
  retryCount: number;
  lastSyncError: string | null;
  createdAt: string;
}

export interface LocationSample {
  localId: number;
  clientGeneratedId: string;
  sessionClientId: string;
  observedAt: string;
  latitude: number;
  longitude: number;
  headingDegrees: number | null;
  speedMps: number | null;
  accuracyMeters: number | null;
  syncStatus: SyncStatus;
}

export type QueueEntityType =
  | 'intersection'
  | 'session'
  | 'observation'
  | 'location_sample';

export type QueueOp = 'upsert' | 'delete';

export interface SyncQueueItem {
  id: number;
  entityType: QueueEntityType;
  op: QueueOp;
  clientGeneratedId: string;
  payload: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
  nextAttemptAtMs: number;
  createdAt: string;
}
