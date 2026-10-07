"use client";

import { useEffect, useRef, useState } from "react";
import type { Stats } from "@/domain";
import {
  FAILURES_BEFORE_UNAVAILABLE,
  UNAVAILABLE_INTERVAL_MS,
  pollDelayMs,
} from "@/lib/poll-cadence";

/** A whole poll cycle behind the venue's own ten seconds, so a reader is never far off it. */
const POLL_MS = 10_000;

export interface LiveStatsOptions {
  intervalMs?: number;
  /** Test seam for the backed-off cadence; see `UNAVAILABLE_INTERVAL_MS`. */
  unavailableIntervalMs?: number;
}

/**
 * The `/stats` live layer: `/api/stats` on a timer, adopting each fresh payload.
 *
 * Same cadence rules as `use-live-feed.ts`, through the same `pollDelayMs`: a hidden tab is
 * not polled, and after `FAILURES_BEFORE_UNAVAILABLE` the page says so and drops to one probe
 * a minute.
 */
export function useLiveStats(
  initial: Stats,
  { intervalMs = POLL_MS, unavailableIntervalMs = UNAVAILABLE_INTERVAL_MS }: LiveStatsOptions = {},
) {
  const [current, setCurrent] = useState(initial);
  const [unavailable, setUnavailable] = useState(false);
  const failures = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/stats", { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body: unknown = await res.json();
        // The same structural check the adapter makes: a payload without a height and a
        // shielded block is not a stats payload, and half of one must not render.
        if (
          typeof body !== "object" ||
          body === null ||
          typeof (body as Stats).height !== "number" ||
          typeof (body as Stats).shielded !== "object"
        ) {
          throw new Error("unrecognised shape");
        }
        if (cancelled) return;
        failures.current = 0;
        setUnavailable(false);
        setCurrent(body as Stats);
      } catch {
        if (cancelled || controller.signal.aborted) return;
        failures.current += 1;
        if (failures.current >= FAILURES_BEFORE_UNAVAILABLE) setUnavailable(true);
      }
    }

    const schedule = () => {
      const { delay } = pollDelayMs({
        failures: failures.current,
        blockDue: false,
        chasesLeft: 0,
        intervalMs,
        chaseMs: intervalMs,
        unavailableIntervalMs,
      });
      timer = setTimeout(async () => {
        await poll();
        if (!cancelled) schedule();
      }, delay);
    };
    schedule();

    // Coming back to a backgrounded tab should show the figure now, not at the next tick.
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, unavailableIntervalMs]);

  return { current, unavailable };
}
