"use client";

import { useEffect, useRef, useState } from "react";
import {
  CHASE_INTERVAL_MS,
  FAILURES_BEFORE_UNAVAILABLE,
  POLL_INTERVAL_MS,
  UNAVAILABLE_INTERVAL_MS,
  runPollLoop,
} from "@/lib/poll-cadence";
import type { PulseFrame, PulsePending } from "@/domain";
import { rememberTip, reorgDetected } from "@/lib/live-feed";
import { parsePulseLive } from "@/data/pulse-payload";

export type PulseLiveStatus = "live" | "unavailable" | "reorganised";

export interface PulseLiveState {
  frame: PulseFrame;
  /**
   * The mempool layer, or null when our node could not be asked.
   *
   * Null and an empty layer are opposite claims — one is our outage, the other a measurement
   * that the mempool was empty — and the header says different things for each.
   */
  pending: PulsePending | null;
  status: PulseLiveStatus;
  /**
   * How many polls have been accepted. The stage plays nothing for the first: it reconciles
   * against a prerendered, CDN-cached page, so "absent from that HTML" is not "arrived while
   * you were watching".
   */
  polls: number;
}

export interface PulseLiveOptions {
  /** The server's frame 0, which is what the page shows until a poll is accepted. */
  initial: PulseFrame;
  enabled?: boolean;
  intervalMs?: number;
  chaseMs?: number;
  /** Test seam for the backed-off cadence; see `UNAVAILABLE_INTERVAL_MS`. */
  unavailableIntervalMs?: number;
}

/**
 * Polls `/api/pulse/live` and hands the stage the newest frame it is willing to believe.
 *
 * The same shape as `useLiveFeed`, through the same `runPollLoop` — three failures before it
 * says so, a hidden tab skips, the first accepted poll is a baseline — but a separate
 * hook, because the payload is a frame rather than lists. `rememberTip` and `reorgDetected` come
 * from `lib/live-feed.ts`, so this page's notion of a reorg is the site's.
 *
 * An enhancement, never a dependency: with scripting off, the server's frame 0 is the page.
 */
export function usePulseLive({
  initial,
  enabled = true,
  intervalMs = POLL_INTERVAL_MS,
  chaseMs = CHASE_INTERVAL_MS,
  unavailableIntervalMs = UNAVAILABLE_INTERVAL_MS,
}: PulseLiveOptions): PulseLiveState {
  const [state, setState] = useState<PulseLiveState>({
    frame: initial,
    pending: null,
    status: "live",
    polls: 0,
  });

  const seenTips = useRef<Map<number, string>>(new Map());
  const failures = useRef(0);
  const halted = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    seenTips.current = new Map();
    failures.current = 0;
    halted.current = false;
    const controller = new AbortController();

    const fail = () => {
      failures.current += 1;
      if (failures.current >= FAILURES_BEFORE_UNAVAILABLE) {
        setState((prev) => (prev.status === "live" ? { ...prev, status: "unavailable" } : prev));
      }
    };

    /** True when the payload says a block exists that its own blocks list has not shipped. */
    const poll = async (): Promise<boolean> => {
      // Once the chain has contradicted what we drew there is nothing honest to accumulate.
      if (halted.current) return false;
      if (typeof document !== "undefined" && document.hidden) return false;
      try {
        const res = await fetch("/api/pulse/live", { signal: controller.signal });
        if (!res.ok) throw new Error(`pulse poll failed: ${res.status}`);
        const parsed = parsePulseLive(await res.json());
        if (parsed === null) {
          // An answer to a different question, or a shape this build does not know. Counted as
          // a failure: left unsaid, the page would sit still while claiming to be live.
          fail();
          return false;
        }

        // The newest indexed row, which is the one we hold both a height and a hash for. The
        // node's own `tip` may legitimately sit above it, and has no hash here to compare.
        const tip = { height: parsed.frame.stocks.height, hash: parsed.frame.stocks.hash };
        if (reorgDetected(seenTips.current, tip)) {
          halted.current = true;
          setState((prev) => ({ ...prev, status: "reorganised" }));
          return false;
        }
        seenTips.current = rememberTip(seenTips.current, tip);
        failures.current = 0;
        setState((prev) => ({
          frame: parsed.frame,
          pending: parsed.pending,
          status: "live",
          polls: prev.polls + 1,
        }));

        const newest = parsed.frame.blocks.at(-1)?.pools.height ?? null;
        return newest !== null && parsed.frame.tip > newest;
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
      chaseMs,
      unavailableIntervalMs,
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [enabled, intervalMs, chaseMs, unavailableIntervalMs]);

  return state;
}
