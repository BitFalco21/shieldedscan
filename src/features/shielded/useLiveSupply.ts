"use client";

import { useEffect, useRef, useState } from "react";
import type { SupplyBreakdown } from "@/domain";
import { parseSupplyLive } from "@/data/supply-payload";
import {
  FAILURES_BEFORE_UNAVAILABLE,
  POLL_INTERVAL_MS,
  UNAVAILABLE_INTERVAL_MS,
  runPollLoop,
} from "@/lib/poll-cadence";

/**
 * `waiting` until the first poll is accepted: the server render is a prerendered page that may
 * be a block or two old, so it is not "live" until the browser has asked for itself.
 */
export type LiveSupplyStatus = "waiting" | "live" | "unavailable";

export interface LiveSupplyState {
  supply: SupplyBreakdown;
  status: LiveSupplyStatus;
}

export interface LiveSupplyOptions {
  intervalMs?: number;
  /** Test seam for the backed-off cadence; see `UNAVAILABLE_INTERVAL_MS`. */
  unavailableIntervalMs?: number;
}

/**
 * The all-pools view's live layer: `/api/supply` on the site's one cadence (`runPollLoop`).
 *
 * The payload is one read at one height, so it replaces the whole view at once and the parts
 * always add up. A payload older than the block on screen (a CDN edge holding an earlier copy)
 * is ignored rather than allowed to roll the page back.
 *
 * An enhancement, never a dependency: with scripting off, the server's read is the page.
 */
export function useLiveSupply(
  initial: SupplyBreakdown,
  {
    intervalMs = POLL_INTERVAL_MS,
    unavailableIntervalMs = UNAVAILABLE_INTERVAL_MS,
  }: LiveSupplyOptions = {},
): LiveSupplyState {
  const [state, setState] = useState<LiveSupplyState>({ supply: initial, status: "waiting" });
  const failures = useRef(0);

  useEffect(() => {
    failures.current = 0;
    const controller = new AbortController();

    const fail = () => {
      failures.current += 1;
      if (failures.current >= FAILURES_BEFORE_UNAVAILABLE) {
        setState((prev) => ({ ...prev, status: "unavailable" }));
      }
    };

    // Never reports a block as due: the payload carries no tip ahead of its own figures.
    const poll = async (): Promise<boolean> => {
      if (document.hidden) return false;
      try {
        const res = await fetch("/api/supply", { signal: controller.signal });
        if (!res.ok) throw new Error(`supply poll failed: ${res.status}`);
        const supply = parseSupplyLive(await res.json());
        if (supply === null) {
          // Left unsaid, the page would sit still while claiming to be live.
          fail();
          return false;
        }
        failures.current = 0;
        setState((prev) => ({
          supply: supply.height >= prev.supply.height ? supply : prev.supply,
          status: "live",
        }));
      } catch (error) {
        // Our own teardown is not an outage and must not count toward one.
        if (controller.signal.aborted || (error as Error)?.name === "AbortError") return false;
        fail();
      }
      return false;
    };

    const stop = runPollLoop({
      poll,
      failures: () => failures.current,
      intervalMs,
      chaseMs: intervalMs,
      unavailableIntervalMs,
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [intervalMs, unavailableIntervalMs]);

  // A server render newer than anything polled (after a refresh) wins, by the same rule.
  return initial.height > state.supply.height ? { ...state, supply: initial } : state;
}
