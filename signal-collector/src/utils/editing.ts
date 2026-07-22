import type { SignalState } from '@/types/models';

export interface EditableObservation {
  state: SignalState;
  originalState: SignalState | null;
}

/**
 * Correction rule shared by the repository layer and tests:
 * the FIRST correction snapshots the raw original state; later corrections
 * keep that original, so the truly-tapped state is never lost.
 */
export function applyCorrection<T extends EditableObservation>(
  observation: T,
  newState: SignalState,
): T {
  return {
    ...observation,
    originalState: observation.originalState ?? observation.state,
    state: newState,
  };
}
