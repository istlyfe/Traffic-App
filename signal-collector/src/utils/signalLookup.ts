import { haversineMeters } from '@/utils/geo';
import type { ApproachDirection, Intersection } from '@/types/models';

/**
 * Signal lookup used to auto-suggest the session's intersection and
 * approach direction from the current GPS fix, replacing manual labels.
 *
 * This is a data-collection convenience only: it names the session the
 * operator (a passenger or safely parked person) is about to record.
 * It provides no guidance to the driver.
 */

export const DEFAULT_LOOKUP_RADIUS_M = 75;
/** Signals within +/- this many degrees of the heading count as "ahead". */
export const DEFAULT_CONE_HALF_ANGLE_DEG = 60;

/** Map a compass heading to the approach direction of travel. */
export function headingToApproachDirection(headingDegrees: number): ApproachDirection {
  const h = ((headingDegrees % 360) + 360) % 360;
  if (h >= 315 || h < 45) return 'northbound';
  if (h < 135) return 'eastbound';
  if (h < 225) return 'southbound';
  return 'westbound';
}

/** Initial great-circle bearing from (lat1,lng1) to (lat2,lng2), 0-360. */
export function bearingDegrees(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(lng2 - lng1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute angle between two bearings, 0-180. */
export function angleDifference(a: number, b: number): number {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}

export interface SignalAheadMatch {
  intersection: Intersection;
  distanceMeters: number;
  bearingDegrees: number;
  /** Derived from the vehicle heading; null when heading was unavailable. */
  approachDirection: ApproachDirection | null;
}

/**
 * Find the nearest signal within `radiusMeters` that lies AHEAD of the
 * vehicle: its bearing from the current position must be within
 * `coneHalfAngleDeg` of the heading. With no usable heading (parked,
 * stationary GPS), falls back to plain nearest-within-radius and leaves
 * approachDirection null so the UI can still ask.
 */
export function findSignalAhead(
  intersections: readonly Intersection[],
  latitude: number,
  longitude: number,
  headingDegrees: number | null,
  options: { radiusMeters?: number; coneHalfAngleDeg?: number } = {},
): SignalAheadMatch | null {
  const radius = options.radiusMeters ?? DEFAULT_LOOKUP_RADIUS_M;
  const cone = options.coneHalfAngleDeg ?? DEFAULT_CONE_HALF_ANGLE_DEG;
  const hasHeading =
    headingDegrees != null && Number.isFinite(headingDegrees) && headingDegrees >= 0;

  let best: SignalAheadMatch | null = null;
  for (const intersection of intersections) {
    const dist = haversineMeters(
      latitude,
      longitude,
      intersection.latitude,
      intersection.longitude,
    );
    if (dist > radius) continue;
    const bearing = bearingDegrees(
      latitude,
      longitude,
      intersection.latitude,
      intersection.longitude,
    );
    // Very close signals surround the fix; the bearing is meaningless noise
    // there, so accept them regardless of the cone.
    if (hasHeading && dist > 10 && angleDifference(bearing, headingDegrees) > cone) {
      continue;
    }
    if (!best || dist < best.distanceMeters) {
      best = {
        intersection,
        distanceMeters: dist,
        bearingDegrees: bearing,
        approachDirection: hasHeading ? headingToApproachDirection(headingDegrees) : null,
      };
    }
  }
  return best;
}
