import { useCallback, useEffect, useState } from 'react';
import type * as Location from 'expo-location';
import {
  getCurrentFix,
  getForegroundPermissionStatus,
} from '@/services/locationService';
import type { GeoFix } from '@/types/models';

interface GpsStatus {
  permission: Location.PermissionStatus | 'unknown';
  fix: GeoFix | null;
  refresh: () => Promise<void>;
}

/** One-shot GPS permission + accuracy snapshot for the Home screen. */
export function useGpsStatus(): GpsStatus {
  const [permission, setPermission] = useState<GpsStatus['permission']>('unknown');
  const [fix, setFix] = useState<GeoFix | null>(null);

  const refresh = useCallback(async () => {
    const status = await getForegroundPermissionStatus();
    setPermission(status);
    if (status === 'granted') {
      setFix(await getCurrentFix());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { permission, fix, refresh };
}
