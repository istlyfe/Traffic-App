import {
  analyzeSequence,
  buildSegments,
  dedupeExact,
  detectAnomalies,
  detectCycles,
  median,
  sortByDeviceTimestamp,
  type AnalyzableObservation,
} from '../cycles';
import type { SignalState } from '../../types/models';

let counter = 0;
function obs(state: SignalState, deviceTimestampMs: number): AnalyzableObservation {
  counter += 1;
  return { clientGeneratedId: `obs-${counter}`, state, deviceTimestampMs };
}

beforeEach(() => {
  counter = 0;
});

describe('sortByDeviceTimestamp (timestamp ordering)', () => {
  it('sorts ascending by device timestamp', () => {
    const list = [obs('GREEN', 3000), obs('RED', 1000), obs('YELLOW', 2000)];
    const sorted = sortByDeviceTimestamp(list);
    expect(sorted.map((o) => o.state)).toEqual(['RED', 'YELLOW', 'GREEN']);
  });

  it('is stable for equal timestamps and does not mutate the input', () => {
    const a = obs('RED', 1000);
    const b = obs('GREEN', 1000);
    const input = [a, b];
    const sorted = sortByDeviceTimestamp(input);
    expect(sorted[0]).toBe(a);
    expect(sorted[1]).toBe(b);
    expect(input).toEqual([a, b]); // untouched
  });
});

describe('dedupeExact (duplicate prevention)', () => {
  it('removes observations with the same state at the same millisecond', () => {
    const a = obs('RED', 1000);
    const dup = { ...obs('RED', 1000) };
    const { kept, removed } = dedupeExact([a, dup]);
    expect(kept).toHaveLength(1);
    expect(removed).toHaveLength(1);
  });

  it('removes repeated client ids', () => {
    const a = obs('RED', 1000);
    const { kept, removed } = dedupeExact([a, { ...a, deviceTimestampMs: 2000 }]);
    expect(kept).toHaveLength(1);
    expect(removed).toHaveLength(1);
  });

  it('keeps different states at the same millisecond', () => {
    const { kept } = dedupeExact([obs('RED', 1000), obs('GREEN', 1000)]);
    expect(kept).toHaveLength(2);
  });

  it('reports removals instead of silently discarding them', () => {
    const a = obs('RED', 1000);
    const dup = { ...obs('RED', 1000) };
    const analysis = analyzeSequence([a, dup]);
    expect(analysis.duplicatesRemoved).toHaveLength(1);
  });
});

describe('detectAnomalies (state transition logic)', () => {
  it('accepts the canonical RED -> GREEN -> YELLOW -> RED sequence', () => {
    const seq = [obs('RED', 0), obs('GREEN', 60_000), obs('YELLOW', 105_000), obs('RED', 110_000)];
    expect(detectAnomalies(seq)).toHaveLength(0);
  });

  it('supports GREEN directly after RED (no leading yellow)', () => {
    const seq = [obs('RED', 0), obs('GREEN', 30_000)];
    expect(detectAnomalies(seq)).toHaveLength(0);
  });

  it('flags impossible repeated states without removing them', () => {
    const seq = [obs('RED', 0), obs('RED', 5_000)];
    const anomalies = detectAnomalies(seq);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.kind).toBe('repeated_state');
  });

  it('flags a missing yellow on GREEN -> RED', () => {
    const seq = [obs('GREEN', 0), obs('RED', 45_000)];
    const anomalies = detectAnomalies(seq);
    expect(anomalies.map((a) => a.kind)).toContain('missing_yellow');
  });

  it('flags unusual transitions like YELLOW -> GREEN', () => {
    const seq = [obs('YELLOW', 0), obs('GREEN', 5_000)];
    const anomalies = detectAnomalies(seq);
    expect(anomalies.map((a) => a.kind)).toContain('unusual_transition');
  });

  it('never mutates the raw observations', () => {
    const seq = [obs('RED', 0), obs('RED', 5_000)];
    const snapshot = JSON.parse(JSON.stringify(seq));
    analyzeSequence(seq);
    expect(seq).toEqual(snapshot);
  });
});

describe('buildSegments (state durations)', () => {
  it('computes each duration from consecutive timestamps', () => {
    const seq = [obs('RED', 0), obs('GREEN', 60_000), obs('YELLOW', 105_000)];
    const segments = buildSegments(seq);
    expect(segments[0]!.durationMs).toBe(60_000);
    expect(segments[1]!.durationMs).toBe(45_000);
    expect(segments[2]!.durationMs).toBeNull(); // open segment
  });
});

describe('detectCycles (cycle reconstruction)', () => {
  it('detects complete RED-to-RED cycles containing GREEN', () => {
    const seq = [
      obs('RED', 0),
      obs('GREEN', 60_000),
      obs('YELLOW', 105_000),
      obs('RED', 110_000),
      obs('GREEN', 170_000),
      obs('YELLOW', 215_000),
      obs('RED', 220_000),
    ];
    const cycles = detectCycles(buildSegments(seq));
    expect(cycles).toHaveLength(2);
    expect(cycles[0]!.durationMs).toBe(110_000);
    expect(cycles[0]!.redMs).toBe(60_000);
    expect(cycles[0]!.greenMs).toBe(45_000);
    expect(cycles[0]!.yellowMs).toBe(5_000);
  });

  it('does not count a RED-to-RED span without GREEN as a cycle', () => {
    const seq = [obs('RED', 0), obs('DARK', 30_000), obs('RED', 60_000)];
    expect(detectCycles(buildSegments(seq))).toHaveLength(0);
  });

  it('handles turn-arrow style cycles without yellow', () => {
    const seq = [
      obs('RED', 0),
      obs('GREEN', 20_000),
      obs('RED', 35_000),
      obs('GREEN', 90_000),
      obs('RED', 100_000),
    ];
    const cycles = detectCycles(buildSegments(seq));
    expect(cycles).toHaveLength(2);
    expect(cycles[0]!.yellowMs).toBeNull();
  });
});

describe('analyzeSequence stats (median durations)', () => {
  it('computes median red, yellow, green and cycle durations', () => {
    const seq = [
      obs('RED', 0),
      obs('GREEN', 60_000),
      obs('YELLOW', 105_000),
      obs('RED', 110_000),
      obs('GREEN', 175_000),
      obs('YELLOW', 222_000),
      obs('RED', 226_000),
      obs('GREEN', 286_000),
      obs('YELLOW', 331_000),
      obs('RED', 336_000),
    ];
    const { stats } = analyzeSequence(seq);
    expect(stats.completeCycleCount).toBe(3);
    expect(stats.medianRedMs).toBe(60_000);
    expect(stats.medianGreenMs).toBe(45_000);
    expect(stats.medianYellowMs).toBe(5_000);
    expect(stats.medianCycleMs).toBe(110_000);
  });

  it('handles out-of-order input by sorting first', () => {
    const seq = [
      obs('YELLOW', 105_000),
      obs('RED', 110_000),
      obs('RED', 0),
      obs('GREEN', 60_000),
    ];
    const { stats } = analyzeSequence(seq);
    expect(stats.completeCycleCount).toBe(1);
  });
});

describe('median', () => {
  it('returns null for empty input', () => expect(median([])).toBeNull());
  it('returns the middle value for odd counts', () => expect(median([3, 1, 2])).toBe(2));
  it('averages the two middle values for even counts', () =>
    expect(median([1, 2, 3, 4])).toBe(2.5));
});
