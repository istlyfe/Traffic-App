import { applyCorrection } from '../editing';
import type { SignalState } from '../../types/models';

interface TestObs {
  state: SignalState;
  originalState: SignalState | null;
  deviceTimestampMs: number;
}

describe('applyCorrection (observation editing)', () => {
  const original: TestObs = {
    state: 'RED',
    originalState: null,
    deviceTimestampMs: 1_000,
  };

  it('changes the state and snapshots the original on first edit', () => {
    const corrected = applyCorrection(original, 'GREEN');
    expect(corrected.state).toBe('GREEN');
    expect(corrected.originalState).toBe('RED');
  });

  it('keeps the true original across repeated edits', () => {
    const once = applyCorrection(original, 'GREEN');
    const twice = applyCorrection(once, 'YELLOW');
    expect(twice.state).toBe('YELLOW');
    expect(twice.originalState).toBe('RED'); // not GREEN
  });

  it('does not mutate the input observation', () => {
    applyCorrection(original, 'GREEN');
    expect(original.state).toBe('RED');
    expect(original.originalState).toBeNull();
  });

  it('never touches the raw timestamp', () => {
    const corrected = applyCorrection(original, 'DARK');
    expect(corrected.deviceTimestampMs).toBe(1_000);
  });
});
