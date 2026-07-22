export interface TapEvaluation {
  accepted: boolean;
  /**
   * The raw device timestamp captured at the moment of the tap, BEFORE any
   * debounce decision was made. Preserved even for rejected taps so the UI
   * can log or display them; never adjusted.
   */
  rawTimestampMs: number;
  reason: 'ok' | 'debounced';
}

export const DEFAULT_DEBOUNCE_MS = 400;

/**
 * Debounce gate for the big signal buttons. The caller must capture
 * `rawTimestampMs` synchronously in the press handler and pass it in --
 * the evaluation never re-reads the clock, so the recorded timestamp is
 * the true press time, not the time validation finished.
 */
export function evaluateTap(
  rawTimestampMs: number,
  lastAcceptedMs: number | null,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): TapEvaluation {
  if (lastAcceptedMs != null && rawTimestampMs - lastAcceptedMs < debounceMs) {
    return { accepted: false, rawTimestampMs, reason: 'debounced' };
  }
  return { accepted: true, rawTimestampMs, reason: 'ok' };
}
