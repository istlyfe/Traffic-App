import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_DEBOUNCE_MS } from '@/utils/debounce';
import { DEFAULT_ACCURACY_WARNING_METERS } from '@/utils/geo';

interface SettingsState {
  /** Minimum ms between accepted signal-button taps. */
  debounceMs: number;
  /** Horizontal accuracy (m) above which a warning is shown. */
  accuracyWarningMeters: number;
  /** User opted in to background location from Settings. */
  backgroundLocationEnabled: boolean;
  /** User acknowledged the passenger-only safety notice. */
  safetyAcknowledged: boolean;
  setDebounceMs: (ms: number) => void;
  setAccuracyWarningMeters: (m: number) => void;
  setBackgroundLocationEnabled: (enabled: boolean) => void;
  acknowledgeSafety: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      debounceMs: DEFAULT_DEBOUNCE_MS,
      accuracyWarningMeters: DEFAULT_ACCURACY_WARNING_METERS,
      backgroundLocationEnabled: false,
      safetyAcknowledged: false,
      setDebounceMs: (ms) => set({ debounceMs: Math.max(0, Math.min(ms, 3000)) }),
      setAccuracyWarningMeters: (m) =>
        set({ accuracyWarningMeters: Math.max(5, Math.min(m, 100)) }),
      setBackgroundLocationEnabled: (enabled) =>
        set({ backgroundLocationEnabled: enabled }),
      acknowledgeSafety: () => set({ safetyAcknowledged: true }),
    }),
    {
      name: 'signal-collector-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
