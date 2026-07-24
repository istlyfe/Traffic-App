import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { newUuid } from '@/utils/ids';
import { msToIso } from '@/utils/time';
import { shouldRecordSample, type SampleGate } from '@/utils/geo';
import { insertLocationSample, getActiveSession } from '@/database/repositories';
import type { GeoFix } from '@/types/models';

/**
 * Location tracking.
 *
 * Foreground: a high-accuracy watchPositionAsync subscription runs only
 * during an active collection session. Samples are gated (>= 5 m movement
 * or >= 5 s, heavily throttled when stationary) before being written.
 *
 * Background: implemented with expo-location + expo-task-manager, but ONLY
 * started when the user has explicitly enabled it in Settings AND granted
 * background permission. It is always stopped when the session ends. If the
 * OS kills or the user force-quits the app, tracking stops -- we never
 * pretend otherwise.
 */

export const BACKGROUND_LOCATION_TASK = 'signal-collector-background-location';

const sampleGate: SampleGate = { lastLat: null, lastLon: null, lastWrittenMs: null };

function resetGate(): void {
  sampleGate.lastLat = null;
  sampleGate.lastLon = null;
  sampleGate.lastWrittenMs = null;
}

export function locationToFix(loc: Location.LocationObject): GeoFix {
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    headingDegrees:
      loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null,
    speedMps: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed : null,
    accuracyMeters: loc.coords.accuracy ?? null,
    altitudeMeters: loc.coords.altitude ?? null,
    timestampMs: loc.timestamp,
  };
}

function persistSampleIfDue(sessionClientId: string, loc: Location.LocationObject): void {
  // Guarded: this runs inside a native location callback, so an uncaught
  // throw here (e.g. a transient SQLite error) would crash the whole app in
  // a production build rather than surface anywhere.
  try {
    const nowMs = loc.timestamp;
    const { latitude, longitude } = loc.coords;
    if (!shouldRecordSample(sampleGate, latitude, longitude, nowMs)) return;
    insertLocationSample({
      clientGeneratedId: newUuid(),
      sessionClientId,
      observedAt: msToIso(nowMs),
      latitude,
      longitude,
      headingDegrees:
        loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null,
      speedMps: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed : null,
      accuracyMeters: loc.coords.accuracy ?? null,
    });
    sampleGate.lastLat = latitude;
    sampleGate.lastLon = longitude;
    sampleGate.lastWrittenMs = nowMs;
  } catch (err) {
    console.warn('[location] persistSampleIfDue failed', err);
  }
}

/* ------------------------------------------------------------------ */
/* Background task (must be defined at module scope)                   */
/* ------------------------------------------------------------------ */

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[background-location] task error', error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] })?.locations ?? [];
  const session = getActiveSession();
  if (!session) return;
  for (const loc of locations) {
    persistSampleIfDue(session.clientGeneratedId, loc);
  }
});

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

export async function requestForegroundPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function getForegroundPermissionStatus(): Promise<Location.PermissionStatus> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status;
}

/**
 * Background permission is requested ONLY from the Settings toggle, never
 * automatically. On Android 11+, the OS sends the user to system settings.
 */
export async function requestBackgroundPermission(): Promise<boolean> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    const granted = await requestForegroundPermission();
    if (!granted) return false;
  }
  const { status } = await Location.requestBackgroundPermissionsAsync();
  return status === 'granted';
}

/* ------------------------------------------------------------------ */
/* Foreground tracking                                                 */
/* ------------------------------------------------------------------ */

let foregroundSubscription: Location.LocationSubscription | null = null;

export async function startForegroundTracking(
  sessionClientId: string,
  onFix: (fix: GeoFix) => void,
): Promise<boolean> {
  const granted = await requestForegroundPermission();
  if (!granted) return false;
  resetGate();
  foregroundSubscription?.remove();
  // High (not BestForNavigation) at ~2s: BestForNavigation keeps the GPS at
  // max power continuously, which on a long stationary session can push iOS
  // to terminate the app for resource use. High accuracy is plenty for
  // recording where an observation was made.
  foregroundSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 2000,
      distanceInterval: 2,
    },
    (loc) => {
      try {
        onFix(locationToFix(loc));
        persistSampleIfDue(sessionClientId, loc);
      } catch (err) {
        console.warn('[location] foreground callback failed', err);
      }
    },
  );
  return true;
}

export function stopForegroundTracking(): void {
  foregroundSubscription?.remove();
  foregroundSubscription = null;
  resetGate();
}

/* ------------------------------------------------------------------ */
/* Background tracking                                                 */
/* ------------------------------------------------------------------ */

export async function startBackgroundTracking(): Promise<boolean> {
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return false;
  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(
    BACKGROUND_LOCATION_TASK,
  ).catch(() => false);
  if (alreadyRunning) return true;
  try {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 5000,
      distanceInterval: 5,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'SignalCollector is recording',
        notificationBody:
          'GPS samples are being recorded for your active collection session.',
        notificationColor: '#e7413b',
      },
    });
    return true;
  } catch (err) {
    // OS restrictions (battery saver, missing permission) -- degrade gracefully.
    console.warn('[background-location] failed to start', err);
    return false;
  }
}

export async function stopBackgroundTracking(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(
    BACKGROUND_LOCATION_TASK,
  ).catch(() => false);
  if (running) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
  }
}

export async function getCurrentFix(): Promise<GeoFix | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return locationToFix(loc);
  } catch {
    return null;
  }
}

/**
 * Live high-accuracy location watch for screens that need the fix to keep
 * up as the user moves (e.g. the intersection picker, so the nearest signal
 * stays current without leaving and reopening the screen). Independent of a
 * collection session; the caller must remove the returned subscription.
 */
export async function startPreviewTracking(
  onFix: (fix: GeoFix) => void,
): Promise<Location.LocationSubscription | null> {
  const granted = await requestForegroundPermission();
  if (!granted) return null;
  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: 1500,
      distanceInterval: 2,
    },
    (loc) => {
      try {
        onFix(locationToFix(loc));
      } catch (err) {
        console.warn('[location] preview callback failed', err);
      }
    },
  );
}
