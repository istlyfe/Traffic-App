import {
  angleDifference,
  bearingDegrees,
  findSignalAhead,
  headingToApproachDirection,
} from '../signalLookup';
import type { Intersection } from '../../types/models';

function signal(id: string, latitude: number, longitude: number): Intersection {
  return {
    clientGeneratedId: id,
    name: id,
    latitude,
    longitude,
    city: null,
    state: null,
    timezone: null,
    source: 'import',
    deviceType: null,
    maintainingAgency: null,
    sourceId: `test:${id}`,
    syncStatus: 'synced',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

// ~1 degree latitude ~= 111.3 km; 50 m ~= 0.00045 degrees.
const BASE = { lat: 26.1224, lng: -80.1373 }; // Fort Lauderdale
const DEG_50M_LAT = 0.00045;
const DEG_50M_LNG = 0.0005; // adjusted for cos(26°)

describe('headingToApproachDirection', () => {
  it('maps compass quadrants to approach directions', () => {
    expect(headingToApproachDirection(0)).toBe('northbound');
    expect(headingToApproachDirection(90)).toBe('eastbound');
    expect(headingToApproachDirection(180)).toBe('southbound');
    expect(headingToApproachDirection(270)).toBe('westbound');
  });

  it('handles quadrant boundaries and wraparound', () => {
    expect(headingToApproachDirection(44.9)).toBe('northbound');
    expect(headingToApproachDirection(45)).toBe('eastbound');
    expect(headingToApproachDirection(315)).toBe('northbound');
    expect(headingToApproachDirection(359.9)).toBe('northbound');
    expect(headingToApproachDirection(-90)).toBe('westbound'); // normalized
    expect(headingToApproachDirection(450)).toBe('eastbound');
  });
});

describe('bearingDegrees / angleDifference', () => {
  it('computes cardinal bearings', () => {
    expect(bearingDegrees(BASE.lat, BASE.lng, BASE.lat + 0.01, BASE.lng)).toBeCloseTo(0, 0);
    expect(bearingDegrees(BASE.lat, BASE.lng, BASE.lat, BASE.lng + 0.01)).toBeCloseTo(90, 0);
    expect(bearingDegrees(BASE.lat, BASE.lng, BASE.lat - 0.01, BASE.lng)).toBeCloseTo(180, 0);
  });

  it('angleDifference wraps correctly', () => {
    expect(angleDifference(350, 10)).toBe(20);
    expect(angleDifference(10, 350)).toBe(20);
    expect(angleDifference(0, 180)).toBe(180);
  });
});

describe('findSignalAhead', () => {
  it('returns the signal ahead of the vehicle with derived direction', () => {
    const ahead = signal('ahead', BASE.lat + DEG_50M_LAT, BASE.lng); // ~50 m north
    const match = findSignalAhead([ahead], BASE.lat, BASE.lng, 0);
    expect(match?.intersection.name).toBe('ahead');
    expect(match?.approachDirection).toBe('northbound');
    expect(match?.distanceMeters).toBeGreaterThan(40);
    expect(match?.distanceMeters).toBeLessThan(60);
  });

  it('ignores signals behind the vehicle', () => {
    const behind = signal('behind', BASE.lat - DEG_50M_LAT, BASE.lng); // ~50 m south
    expect(findSignalAhead([behind], BASE.lat, BASE.lng, 0)).toBeNull();
  });

  it('respects the 75 m radius', () => {
    const far = signal('far', BASE.lat + 0.001, BASE.lng); // ~111 m north
    expect(findSignalAhead([far], BASE.lat, BASE.lng, 0)).toBeNull();
    expect(
      findSignalAhead([far], BASE.lat, BASE.lng, 0, { radiusMeters: 150 }),
    ).not.toBeNull();
  });

  it('picks the nearest of several candidates ahead', () => {
    const near = signal('near', BASE.lat + DEG_50M_LAT / 2, BASE.lng);
    const farther = signal('farther', BASE.lat + DEG_50M_LAT, BASE.lng);
    const match = findSignalAhead([farther, near], BASE.lat, BASE.lng, 0);
    expect(match?.intersection.name).toBe('near');
  });

  it('falls back to nearest-within-radius when heading is unavailable', () => {
    const south = signal('south', BASE.lat - DEG_50M_LAT, BASE.lng);
    const match = findSignalAhead([south], BASE.lat, BASE.lng, null);
    expect(match?.intersection.name).toBe('south');
    expect(match?.approachDirection).toBeNull();
  });

  it('accepts very close signals regardless of bearing cone', () => {
    // 5 m east while heading north: bearing ~90° off, but distance < 10 m.
    const onTop = signal('onTop', BASE.lat, BASE.lng + DEG_50M_LNG / 10);
    const match = findSignalAhead([onTop], BASE.lat, BASE.lng, 0);
    expect(match?.intersection.name).toBe('onTop');
  });

  it('derives eastbound for an eastbound heading', () => {
    const east = signal('east', BASE.lat, BASE.lng + DEG_50M_LNG);
    const match = findSignalAhead([east], BASE.lat, BASE.lng, 88);
    expect(match?.approachDirection).toBe('eastbound');
  });
});
