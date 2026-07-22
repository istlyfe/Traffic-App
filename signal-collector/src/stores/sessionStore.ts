import { create } from 'zustand';
import { newUuid } from '@/utils/ids';
import { msToIso } from '@/utils/time';
import { evaluateTap } from '@/utils/debounce';
import { analyzeSequence } from '@/utils/cycles';
import {
  buildObservationInput,
  deleteLastObservation,
  endSession as endSessionRepo,
  appendSessionNote,
  getActiveSession,
  insertObservation,
  insertSession,
  listObservationsForSession,
} from '@/database/repositories';
import { observationInputSchema, sessionInputSchema } from '@/validation/schemas';
import {
  startForegroundTracking,
  stopForegroundTracking,
  startBackgroundTracking,
  stopBackgroundTracking,
} from '@/services/locationService';
import { syncNow } from '@/services/syncService';
import { useSettingsStore } from '@/stores/settingsStore';
import type {
  ApproachDirection,
  CollectionSession,
  GeoFix,
  Intersection,
  MovementType,
  SignalObservation,
  SignalState,
} from '@/types/models';

interface DraftSelection {
  intersection: Intersection | null;
  approachDirection: ApproachDirection | null;
  movementType: MovementType | null;
  movementDescription: string | null;
}

interface SessionState {
  draft: DraftSelection;
  activeSession: CollectionSession | null;
  observations: SignalObservation[];
  currentState: SignalState | null;
  lastAcceptedTapMs: number | null;
  currentFix: GeoFix | null;
  cycleCount: number;

  setDraftIntersection: (intersection: Intersection) => void;
  setDraftMovement: (
    direction: ApproachDirection,
    movement: MovementType,
    description: string | null,
  ) => void;
  restoreActiveSession: () => void;
  startSession: () => Promise<CollectionSession | null>;
  recordTap: (
    state: SignalState,
    rawTimestampMs: number,
  ) => { accepted: boolean; reason: 'ok' | 'debounced' };
  undoLast: () => SignalObservation | null;
  addNote: (note: string) => void;
  endSession: (notes: string | null) => Promise<void>;
  setFix: (fix: GeoFix) => void;
}

function recomputeDerived(sessionClientId: string) {
  const observations = listObservationsForSession(sessionClientId);
  const analysis = analyzeSequence(observations);
  const last = observations[observations.length - 1];
  return {
    observations,
    cycleCount: analysis.stats.completeCycleCount,
    currentState: last ? last.state : null,
  };
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  draft: {
    intersection: null,
    approachDirection: null,
    movementType: null,
    movementDescription: null,
  },
  activeSession: null,
  observations: [],
  currentState: null,
  lastAcceptedTapMs: null,
  currentFix: null,
  cycleCount: 0,

  setDraftIntersection: (intersection) =>
    set((s) => ({ draft: { ...s.draft, intersection } })),

  setDraftMovement: (approachDirection, movementType, movementDescription) =>
    set((s) => ({
      draft: { ...s.draft, approachDirection, movementType, movementDescription },
    })),

  restoreActiveSession: () => {
    const session = getActiveSession();
    if (!session) return;
    set({
      activeSession: session,
      ...recomputeDerived(session.clientGeneratedId),
    });
    void startForegroundTracking(session.clientGeneratedId, (fix) =>
      get().setFix(fix),
    );
  },

  startSession: async () => {
    const { draft } = get();
    if (!draft.intersection || !draft.approachDirection || !draft.movementType) {
      return null;
    }
    const startedAtMs = Date.now();
    const input = sessionInputSchema.parse({
      clientGeneratedId: newUuid(),
      intersectionClientId: draft.intersection.clientGeneratedId,
      intersectionName: draft.intersection.name,
      approachDirection: draft.approachDirection,
      movementType: draft.movementType,
      movementDescription: draft.movementDescription,
      startedAt: msToIso(startedAtMs),
      startedAtMs,
    });
    const session = insertSession(input);
    set({
      activeSession: session,
      observations: [],
      currentState: null,
      lastAcceptedTapMs: null,
      cycleCount: 0,
    });

    await startForegroundTracking(session.clientGeneratedId, (fix) =>
      get().setFix(fix),
    );
    if (useSettingsStore.getState().backgroundLocationEnabled) {
      await startBackgroundTracking();
    }
    return session;
  },

  /**
   * Record a signal-button tap. `rawTimestampMs` MUST be captured by the
   * caller synchronously in the press handler -- it is preserved as the
   * observation timestamp and is evaluated (not regenerated) by the
   * debounce gate.
   */
  recordTap: (state, rawTimestampMs) => {
    const { activeSession, lastAcceptedTapMs, currentFix } = get();
    if (!activeSession) return { accepted: false, reason: 'debounced' as const };

    const debounceMs = useSettingsStore.getState().debounceMs;
    const evaluation = evaluateTap(rawTimestampMs, lastAcceptedTapMs, debounceMs);
    if (!evaluation.accepted) {
      return { accepted: false, reason: evaluation.reason };
    }

    const input = observationInputSchema.parse(
      buildObservationInput({
        sessionClientId: activeSession.clientGeneratedId,
        state,
        rawTimestampMs: evaluation.rawTimestampMs,
        fix: currentFix
          ? {
              latitude: currentFix.latitude,
              longitude: currentFix.longitude,
              headingDegrees: currentFix.headingDegrees,
              speedMps: currentFix.speedMps,
              accuracyMeters: currentFix.accuracyMeters,
              altitudeMeters: currentFix.altitudeMeters,
            }
          : null,
      }),
    );
    // 1. Persist locally first -- the UI never waits on the network.
    insertObservation(input);
    // 2. Update UI state synchronously from SQLite.
    set({
      lastAcceptedTapMs: evaluation.rawTimestampMs,
      ...recomputeDerived(activeSession.clientGeneratedId),
    });
    // 3. Fire-and-forget background sync; failures stay in the queue.
    void syncNow().catch(() => {});
    return { accepted: true, reason: 'ok' as const };
  },

  undoLast: () => {
    const { activeSession } = get();
    if (!activeSession) return null;
    const removed = deleteLastObservation(activeSession.clientGeneratedId);
    set(recomputeDerived(activeSession.clientGeneratedId));
    return removed;
  },

  addNote: (note) => {
    const { activeSession } = get();
    if (!activeSession) return;
    appendSessionNote(activeSession.clientGeneratedId, note);
  },

  endSession: async (notes) => {
    const { activeSession } = get();
    if (!activeSession) return;
    stopForegroundTracking();
    await stopBackgroundTracking();
    endSessionRepo(activeSession.clientGeneratedId, notes);
    set({
      activeSession: null,
      observations: [],
      currentState: null,
      lastAcceptedTapMs: null,
      cycleCount: 0,
      draft: {
        intersection: null,
        approachDirection: null,
        movementType: null,
        movementDescription: null,
      },
    });
    void syncNow().catch(() => {});
  },

  setFix: (fix) => set({ currentFix: fix }),
}));
