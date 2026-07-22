const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in meters between two WGS-84 points. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '--';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export const DEFAULT_ACCURACY_WARNING_METERS = 20;

/**
 * True when a horizontal accuracy reading is poor enough to warn about.
 * A null/unknown accuracy is treated as poor: we cannot vouch for the fix.
 * Observations are always preserved regardless of accuracy.
 */
export function isAccuracyPoor(
  accuracyMeters: number | null | undefined,
  thresholdMeters: number = DEFAULT_ACCURACY_WARNING_METERS,
): boolean {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) return true;
  return accuracyMeters > thresholdMeters;
}

export interface SampleGate {
  lastLat: number | null;
  lastLon: number | null;
  lastWrittenMs: number | null;
}

export const MIN_SAMPLE_DISTANCE_M = 5;
export const MIN_SAMPLE_INTERVAL_MS = 5000;
/** When stationary, throttle harder so we do not spam duplicate samples. */
export const STATIONARY_INTERVAL_MS = 30000;

/**
 * Decide whether a new GPS fix should be persisted as a location sample.
 * Rules: write when the device moved >= 5 m, otherwise at most every 5 s,
 * and when essentially stationary (< 1 m) at most every 30 s.
 */
export function shouldRecordSample(
  gate: SampleGate,
  latitude: number,
  longitude: number,
  nowMs: number,
): boolean {
  if (gate.lastLat == null || gate.lastLon == null || gate.lastWrittenMs == null) {
    return true;
  }
  const dist = haversineMeters(gate.lastLat, gate.lastLon, latitude, longitude);
  if (dist >= MIN_SAMPLE_DISTANCE_M) return true;
  const elapsed = nowMs - gate.lastWrittenMs;
  if (dist < 1) return elapsed >= STATIONARY_INTERVAL_MS;
  return elapsed >= MIN_SAMPLE_INTERVAL_MS;
}
