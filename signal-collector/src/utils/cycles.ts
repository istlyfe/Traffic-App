import type { SignalState } from '@/types/models';

/**
 * Transition and cycle analysis.
 *
 * Design rule: raw observations are NEVER mutated or silently dropped.
 * Analysis works on a copy; anything suspicious is *flagged*, and the only
 * removal performed is of exact duplicates (same state at the same
 * millisecond, e.g. from a double-write bug), which is reported in the
 * result so nothing disappears silently.
 */

export interface AnalyzableObservation {
  clientGeneratedId: string;
  state: SignalState;
  deviceTimestampMs: number;
}

export interface StateSegment {
  state: SignalState;
  startMs: number;
  /** null for the final, still-open segment */
  endMs: number | null;
  durationMs: number | null;
  observationId: string;
}

export type AnomalyKind =
  | 'repeated_state'
  | 'missing_yellow'
  | 'unusual_transition'
  | 'non_monotonic_timestamp';

export interface Anomaly {
  kind: AnomalyKind;
  observationId: string;
  detail: string;
}

export interface Cycle {
  startMs: number;
  endMs: number;
  durationMs: number;
  redMs: number;
  greenMs: number;
  yellowMs: number | null;
  segments: StateSegment[];
}

export interface SequenceAnalysis {
  ordered: AnalyzableObservation[];
  duplicatesRemoved: AnalyzableObservation[];
  segments: StateSegment[];
  anomalies: Anomaly[];
  cycles: Cycle[];
  stats: {
    completeCycleCount: number;
    medianRedMs: number | null;
    medianYellowMs: number | null;
    medianGreenMs: number | null;
    medianCycleMs: number | null;
  };
}

/** Stable ascending sort by device timestamp (ties keep input order). */
export function sortByDeviceTimestamp<T extends AnalyzableObservation>(
  observations: readonly T[],
): T[] {
  return observations
    .map((obs, index) => ({ obs, index }))
    .sort(
      (a, b) =>
        a.obs.deviceTimestampMs - b.obs.deviceTimestampMs || a.index - b.index,
    )
    .map((entry) => entry.obs);
}

/**
 * Remove exact duplicates: identical id, or identical (state, timestamp).
 * Returns both the kept list and what was removed, so callers can report it.
 */
export function dedupeExact<T extends AnalyzableObservation>(
  sorted: readonly T[],
): { kept: T[]; removed: T[] } {
  const kept: T[] = [];
  const removed: T[] = [];
  const seenIds = new Set<string>();
  const seenStateAtMs = new Set<string>();
  for (const obs of sorted) {
    const key = `${obs.state}@${obs.deviceTimestampMs}`;
    if (seenIds.has(obs.clientGeneratedId) || seenStateAtMs.has(key)) {
      removed.push(obs);
    } else {
      seenIds.add(obs.clientGeneratedId);
      seenStateAtMs.add(key);
      kept.push(obs);
    }
  }
  return { kept, removed };
}

/**
 * Transitions that are physically plausible for common US signal heads.
 * GREEN may follow RED directly (no leading yellow in most of the US), and
 * protected turn arrows can produce RED -> GREEN -> YELLOW -> RED as well.
 * Anything not listed is flagged as unusual -- flagged, never removed,
 * because unusual sequences are exactly the data researchers care about.
 */
const EXPECTED_TRANSITIONS: Record<SignalState, SignalState[]> = {
  RED: ['GREEN', 'FLASHING_RED', 'DARK', 'UNKNOWN'],
  GREEN: ['YELLOW', 'DARK', 'UNKNOWN'],
  YELLOW: ['RED', 'FLASHING_RED', 'DARK', 'UNKNOWN'],
  FLASHING_RED: ['RED', 'GREEN', 'DARK', 'UNKNOWN'],
  FLASHING_YELLOW: ['YELLOW', 'GREEN', 'RED', 'DARK', 'UNKNOWN'],
  DARK: ['RED', 'YELLOW', 'GREEN', 'FLASHING_RED', 'FLASHING_YELLOW', 'UNKNOWN'],
  UNKNOWN: ['RED', 'YELLOW', 'GREEN', 'FLASHING_RED', 'FLASHING_YELLOW', 'DARK'],
};

export function detectAnomalies(
  ordered: readonly AnalyzableObservation[],
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const curr = ordered[i]!;
    if (curr.deviceTimestampMs < prev.deviceTimestampMs) {
      anomalies.push({
        kind: 'non_monotonic_timestamp',
        observationId: curr.clientGeneratedId,
        detail: `timestamp ${curr.deviceTimestampMs} precedes previous ${prev.deviceTimestampMs}`,
      });
    }
    if (curr.state === prev.state) {
      anomalies.push({
        kind: 'repeated_state',
        observationId: curr.clientGeneratedId,
        detail: `${curr.state} recorded twice in a row -- likely an accidental re-tap or a missed transition between them`,
      });
      continue;
    }
    if (prev.state === 'GREEN' && curr.state === 'RED') {
      anomalies.push({
        kind: 'missing_yellow',
        observationId: curr.clientGeneratedId,
        detail: 'GREEN -> RED without a YELLOW observation',
      });
      continue;
    }
    if (!EXPECTED_TRANSITIONS[prev.state].includes(curr.state)) {
      anomalies.push({
        kind: 'unusual_transition',
        observationId: curr.clientGeneratedId,
        detail: `${prev.state} -> ${curr.state} is not a typical signal sequence`,
      });
    }
  }
  return anomalies;
}

export function buildSegments(
  ordered: readonly AnalyzableObservation[],
): StateSegment[] {
  return ordered.map((obs, i) => {
    const next = ordered[i + 1];
    return {
      state: obs.state,
      startMs: obs.deviceTimestampMs,
      endMs: next ? next.deviceTimestampMs : null,
      durationMs: next ? next.deviceTimestampMs - obs.deviceTimestampMs : null,
      observationId: obs.clientGeneratedId,
    };
  });
}

/**
 * A complete cycle runs from one RED onset to the next RED onset and must
 * contain at least one GREEN segment. YELLOW is optional (turn arrows and
 * some sequences omit it from the operator's viewpoint).
 */
export function detectCycles(segments: readonly StateSegment[]): Cycle[] {
  const redOnsets: number[] = [];
  segments.forEach((seg, i) => {
    if (seg.state === 'RED' && (i === 0 || segments[i - 1]!.state !== 'RED')) {
      redOnsets.push(i);
    }
  });

  const cycles: Cycle[] = [];
  for (let r = 0; r < redOnsets.length - 1; r++) {
    const startIdx = redOnsets[r]!;
    const endIdx = redOnsets[r + 1]!;
    const slice = segments.slice(startIdx, endIdx);
    if (!slice.some((seg) => seg.state === 'GREEN')) continue;

    const sum = (state: SignalState) =>
      slice
        .filter((seg) => seg.state === state && seg.durationMs != null)
        .reduce((acc, seg) => acc + (seg.durationMs ?? 0), 0);

    const startMs = segments[startIdx]!.startMs;
    const endMs = segments[endIdx]!.startMs;
    const yellowTotal = sum('YELLOW');
    cycles.push({
      startMs,
      endMs,
      durationMs: endMs - startMs,
      redMs: sum('RED'),
      greenMs: sum('GREEN'),
      yellowMs: slice.some((seg) => seg.state === 'YELLOW') ? yellowTotal : null,
      segments: slice,
    });
  }
  return cycles;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function analyzeSequence(
  observations: readonly AnalyzableObservation[],
): SequenceAnalysis {
  const ordered = sortByDeviceTimestamp(observations);
  const { kept, removed } = dedupeExact(ordered);
  const segments = buildSegments(kept);
  const anomalies = detectAnomalies(kept);
  const cycles = detectCycles(segments);

  const yellows = cycles
    .map((c) => c.yellowMs)
    .filter((v): v is number => v != null);

  return {
    ordered: kept,
    duplicatesRemoved: removed,
    segments,
    anomalies,
    cycles,
    stats: {
      completeCycleCount: cycles.length,
      medianRedMs: median(cycles.map((c) => c.redMs)),
      medianYellowMs: median(yellows),
      medianGreenMs: median(cycles.map((c) => c.greenMs)),
      medianCycleMs: median(cycles.map((c) => c.durationMs)),
    },
  };
}
