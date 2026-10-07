"use client";

import { useEffect, useState } from "react";

/**
 * The wall clock in milliseconds, ticking every `intervalMs` only while `running`.
 *
 * Starts at zero rather than `Date.now()`, because reading the clock during render is an impure
 * call React's lint rejects; the first tick is scheduled at once, inside a timer callback.
 * Callers must therefore read a zero as "not ticked yet". When `running` turns false the clock
 * stops and keeps its last value.
 */
export function useTickingNow(running: boolean, intervalMs: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [running, intervalMs]);
  return now;
}
