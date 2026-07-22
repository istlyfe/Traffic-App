import {
  haversineMeters,
  isAccuracyPoor,
  shouldRecordSample,
  type SampleGate,
} from '../geo';

describe('isAccuracyPoor (GPS accuracy warnings)', () => {
  it('warns above the default 20 m threshold', () => {
    expect(isAccuracyPoor(25)).toBe(true);
    expect(isAccuracyPoor(20.01)).toBe(true);
  });

  it('does not warn at or below the threshold', () => {
    expect(isAccuracyPoor(20)).toBe(false);
    expect(isAccuracyPoor(5)).toBe(false);
  });

  it('treats missing accuracy as poor', () => {
    expect(isAccuracyPoor(null)).toBe(true);
    expect(isAccuracyPoor(undefined)).toBe(true);
    expect(isAccuracyPoor(Number.NaN)).toBe(true);
  });

  it('honors a custom threshold', () => {
    expect(isAccuracyPoor(15, 10)).toBe(true);
    expect(isAccuracyPoor(15, 30)).toBe(false);
  });
});

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(30.2672, -97.7431, 30.2672, -97.7431)).toBe(0);
  });

  it('approximates known distances', () => {
    // ~111 km per degree of latitude
    const d = haversineMeters(30, -97, 31, -97);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('shouldRecordSample (stationary throttling)', () => {
  const base = { lat: 30.2672, lon: -97.7431 };

  function gate(overrides: Partial<SampleGate> = {}): SampleGate {
    return { lastLat: base.lat, lastLon: base.lon, lastWrittenMs: 0, ...overrides };
  }

  it('always records the first sample', () => {
    expect(
      shouldRecordSample({ lastLat: null, lastLon: null, lastWrittenMs: null }, base.lat, base.lon, 0),
    ).toBe(true);
  });

  it('records when moved at least 5 meters regardless of time', () => {
    // ~55 m north
    expect(shouldRecordSample(gate(), base.lat + 0.0005, base.lon, 100)).toBe(true);
  });

  it('does not spam duplicate stationary samples', () => {
    expect(shouldRecordSample(gate(), base.lat, base.lon, 5_000)).toBe(false);
    expect(shouldRecordSample(gate(), base.lat, base.lon, 29_000)).toBe(false);
    expect(shouldRecordSample(gate(), base.lat, base.lon, 30_000)).toBe(true);
  });

  it('records every 5 seconds while drifting slowly (1-5 m)', () => {
    const drifted = base.lat + 0.00002; // ~2 m
    expect(shouldRecordSample(gate(), drifted, base.lon, 4_000)).toBe(false);
    expect(shouldRecordSample(gate(), drifted, base.lon, 5_000)).toBe(true);
  });
});
