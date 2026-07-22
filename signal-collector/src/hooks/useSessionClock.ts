import { useEffect, useState } from 'react';

/** Ticks once per second while `running`, returning elapsed ms since startMs. */
export function useSessionClock(startMs: number | null, running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || startMs == null) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - startMs);
    const id = setInterval(() => setElapsed(Date.now() - startMs), 1000);
    return () => clearInterval(id);
  }, [startMs, running]);
  return elapsed;
}
