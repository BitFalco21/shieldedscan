"use client";

import { useEffect, useRef, useState } from "react";
import type { BlockSummary } from "@/domain";
import { type LiveTip, parseLivePayload } from "@/data/live-payload";
import { nowSeconds } from "./clock";
import { FAILURES_BEFORE_UNAVAILABLE, UNAVAILABLE_INTERVAL_MS, runPollLoop } from "./poll-cadence";

/**
 * The chain tip and newest blocks from `/api/live`, for pages that only need to know where the
 * chain is (the NU7 countdown and its site bar). The same URL as the live lists, so every
 * reader shares its CDN entry; the same loop, so it skips hidden tabs and backs off in an outage.
 */

export interface TipFeed {
  /** The last tip a poll returned, kept through failures; null until the first succeeds. */
  tip: LiveTip | null;
  /** The newest blocks of that same poll. */
  blocks: BlockSummary[];
  /** Wall-clock seconds of that poll, for estimates measured from "now". */
  readAt: number;
  /** Counts accepted polls, so two answers in the same second are still two answers. */
  seq: number;
  /** True after repeated failures: the values above are the last known ones. */
  reconnecting: boolean;
}

const EMPTY: TipFeed = { tip: null, blocks: [], readAt: 0, seq: 0, reconnecting: false };

export function useTipFeed(intervalMs: number, enabled = true): TipFeed {
  const [feed, setFeed] = useState<TipFeed>(EMPTY);
  const failures = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    failures.current = 0;
    const controller = new AbortController();

    const fail = () => {
      failures.current += 1;
      if (failures.current >= FAILURES_BEFORE_UNAVAILABLE) {
        setFeed((prev) => (prev.reconnecting ? prev : { ...prev, reconnecting: true }));
      }
    };

    const poll = async (): Promise<boolean> => {
      if (document.hidden) return false;
      try {
        const res = await fetch("/api/live?kind=all&direction=all", { signal: controller.signal });
        if (!res.ok) throw new Error(`live poll failed: ${res.status}`);
        const parsed = parseLivePayload(await res.json(), "all", "all");
        if (parsed === null) {
          fail();
          return false;
        }
        failures.current = 0;
        const readAt = nowSeconds();
        setFeed((prev) => ({
          tip: parsed.tip,
          blocks: parsed.blocks,
          readAt,
          seq: prev.seq + 1,
          reconnecting: false,
        }));
      } catch (error) {
        if (controller.signal.aborted || (error as Error)?.name === "AbortError") return false;
        fail();
      }
      // Never a chase: a countdown gains nothing from the newest block a few seconds sooner.
      return false;
    };

    const stop = runPollLoop({
      poll,
      failures: () => failures.current,
      intervalMs,
      chaseMs: intervalMs,
      unavailableIntervalMs: Math.max(intervalMs, UNAVAILABLE_INTERVAL_MS),
    });
    return () => {
      stop();
      controller.abort();
    };
  }, [intervalMs, enabled]);

  return feed;
}
