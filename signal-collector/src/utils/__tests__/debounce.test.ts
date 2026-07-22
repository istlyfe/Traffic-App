import { evaluateTap } from '../debounce';

describe('evaluateTap (double-tap prevention)', () => {
  it('accepts the first tap', () => {
    const result = evaluateTap(1_000, null, 400);
    expect(result.accepted).toBe(true);
    expect(result.rawTimestampMs).toBe(1_000);
  });

  it('rejects a tap inside the debounce window', () => {
    const result = evaluateTap(1_200, 1_000, 400);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('debounced');
  });

  it('accepts a tap exactly at the debounce boundary', () => {
    expect(evaluateTap(1_400, 1_000, 400).accepted).toBe(true);
  });

  it('preserves the raw timestamp even for rejected taps', () => {
    const result = evaluateTap(1_050, 1_000, 400);
    expect(result.accepted).toBe(false);
    expect(result.rawTimestampMs).toBe(1_050); // never regenerated or adjusted
  });

  it('respects a configurable debounce period', () => {
    expect(evaluateTap(1_500, 1_000, 1_000).accepted).toBe(false);
    expect(evaluateTap(2_000, 1_000, 1_000).accepted).toBe(true);
    expect(evaluateTap(1_001, 1_000, 0).accepted).toBe(true);
  });
});
