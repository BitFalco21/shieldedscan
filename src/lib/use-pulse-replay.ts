"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PulseBlock, PulseEvent, PulseLedgerRow } from "@/domain";
import { PULSE_WINDOW_SECONDS } from "@/domain";
import { parsePulseWindow } from "@/data/pulse-payload";

/**
 * The last twenty-four hours, fetched one aligned hour at a time as the replay clock reaches
 * them — lazily and two hours ahead, so ×600 (an hour in six seconds) never waits on the
 * network.
 *
 * An hour is cached by its own `from` and never refetched: a settled hour of the chain cannot
 * change. A failed hour is marked rather than silently retried, so the scrubber shows the hole
 * and a quiet stretch stays distinguishable from an hour we could not read.
 */

/** How many hours past the clock are fetched before they are needed. */
const HOURS_AHEAD = 2;

/** The aligned hour an instant belongs to. */
export function pulseHourOf(seconds: number): number {
  return Math.floor(seconds / PULSE_WINDOW_SECONDS) * PULSE_WINDOW_SECONDS;
}

export interface PulseReplayState {
  /** Every block loaded so far, oldest first, deduplicated by hash. */
  blocks: PulseBlock[];
  /** Crossings inside the loaded hours that no block in them recorded. */
  swaps: PulseEvent[];
  /**
   * Every loaded hour's transparent outputs, newest block first. Flattened only for the display
   * filter: the rows at or below the reached block legitimately span an hour boundary.
   *
   * Nothing about a cap may be read off this array: it grows for the whole session, so its
   * length says nothing about the hour on screen. Per-hour facts live on {@link hours}.
   */
  ledger: PulseLedgerRow[];
  /**
   * True once any loaded hour carried a `ledger` key. Session-wide on purpose: whether the API
   * sends an hour's outputs is a fact about the deployment, not about one hour. An API predating
   * the field sends nothing, and reading that as "no outputs" would state that no transparent
   * value moved.
   */
  ledgerCarried: boolean;
  /**
   * What each loaded hour holds, by its own `from`. A cap is a claim about one hour, so the page
   * must be able to ask about the hour it is drawing; an OR over every loaded hour would state a
   * cap over an hour that handed over everything.
   */
  hours: PulseReplayHour[];
  /** Hours whose read failed, so the scrubber can show the hole rather than a quiet stretch. */
  failedHours: number[];
  /** Hours successfully loaded, so the scrubber can show what is ready. */
  loadedHours: number[];
  /** True while any hour is in flight. */
  loading: boolean;
}

export interface PulseReplayOptions {
  enabled: boolean;
  /** The replay clock, unix seconds. */
  simSeconds: number;
  /** Now, unix seconds — the route refuses a window more than an hour ahead of it. */
  nowSeconds: number;
}

/** One loaded hour's own ledger facts — see {@link PulseReplayState.hours}. */
export interface PulseReplayHour {
  /** The aligned hour this describes, unix seconds. */
  from: number;
  /** How many of its outputs it handed over. */
  ledgerRows: number;
  /** False when the API sent no `ledger` key for this hour at all. */
  ledgerCarried: boolean;
  /** Set when this hour's rows are a window onto it rather than all of them. */
  ledgerTruncated: boolean;
}

interface LoadedHour {
  from: number;
  blocks: PulseBlock[];
  swaps: PulseEvent[];
  /** Absent when the API sent no such key — never `[]`, which would be a measurement. */
  ledger?: PulseLedgerRow[];
  ledgerTruncated: boolean;
}

export function usePulseReplay({
  enabled,
  simSeconds,
  nowSeconds,
}: PulseReplayOptions): PulseReplayState {
  /**
   * Which hours have been asked for. Refs, because they are bookkeeping the effect writes and
   * nothing renders: an hour must not be fetched twice across re-renders, and an hour that is
   * in flight is neither loaded nor failed yet.
   */
  const asked = useRef<Set<number>>(new Set());
  const inFlight = useRef<Set<number>>(new Set());
  /** What has actually arrived. State, because it is what the stage draws. */
  const [hours, setHours] = useState<LoadedHour[]>([]);
  const [failedHours, setFailed] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  const hour = pulseHourOf(simSeconds);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    const wanted: number[] = [];
    for (let i = 0; i <= HOURS_AHEAD; i += 1) {
      const from = hour + i * PULSE_WINDOW_SECONDS;
      // The route refuses a window that has not happened, and asking for one would burn a
      // 400 on every frame of a replay that has caught up with the present.
      if (from + PULSE_WINDOW_SECONDS > nowSeconds + PULSE_WINDOW_SECONDS) continue;
      if (asked.current.has(from)) continue;
      wanted.push(from);
    }
    if (wanted.length === 0) return;

    for (const from of wanted) {
      asked.current.add(from);
      inFlight.current.add(from);
    }
    const to = (f: number) => f + PULSE_WINDOW_SECONDS;

    void (async () => {
      setLoading(true);
      for (const [index, from] of wanted.entries()) {
        try {
          const res = await fetch(`/api/pulse/window?from=${from}&to=${to(from)}`, {
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`pulse window failed: ${res.status}`);
          // Refuses an answer to a different question. An hour of some other time is a
          // well-formed hour that animates perfectly under the label the reader chose, which
          // is the one failure here nothing else could reveal.
          const parsed = parsePulseWindow(await res.json(), from, to(from));
          if (parsed === null) throw new Error("pulse window: unrecognised shape");
          const loaded: LoadedHour = {
            from,
            blocks: parsed.blocks,
            swaps: parsed.swaps,
            ...(parsed.ledger === undefined ? {} : { ledger: parsed.ledger }),
            ledgerTruncated: parsed.ledgerTruncated === true,
          };
          setHours((prev) => [...prev, loaded].sort((a, b) => a.from - b.from));
        } catch (error) {
          if (controller.signal.aborted || (error as Error)?.name === "AbortError") {
            // Our teardown, not the hour's fault. Every hour still queued behind this one was
            // marked asked up front and would otherwise be neither refetched nor reported as a
            // hole, so they go back on the queue.
            for (const pending of wanted.slice(index)) {
              asked.current.delete(pending);
              inFlight.current.delete(pending);
            }
            return;
          }
          // marked, never retried silently: the scrubber shows where the replay has a hole,
          // so a quiet stretch is distinguishable from an hour we could not read.
          setFailed((prev) => (prev.includes(from) ? prev : [...prev, from].sort((a, b) => a - b)));
        } finally {
          inFlight.current.delete(from);
        }
      }
      setLoading(inFlight.current.size > 0);
    })();

    return () => controller.abort();
  }, [enabled, hour, nowSeconds]);

  const { blocks, swaps, ledger, ledgerCarried, perHour } = useMemo(() => {
    const seen = new Set<string>();
    const merged: PulseBlock[] = [];
    const crossings: PulseEvent[] = [];
    const rows: PulseLedgerRow[] = [];
    const facts: PulseReplayHour[] = [];
    let carried = false;
    for (const loaded of hours) {
      for (const block of loaded.blocks) {
        if (seen.has(block.pools.hash)) continue;
        seen.add(block.pools.hash);
        merged.push(block);
      }
      crossings.push(...loaded.swaps);
      if (loaded.ledger !== undefined) {
        carried = true;
        // Concatenated, never deduplicated row by row. The hours are aligned and half-open, so a
        // block belongs to exactly one of them and none is fetched twice. A row-level key would
        // have to be `txid + address + value`, which two outputs of one transaction paying one
        // address the same amount share — dropping one would silently shorten the list.
        rows.push(...loaded.ledger);
      }
      // Kept per hour rather than folded into one flag and one total. A cap is a claim about
      // the hour it was applied to; an OR across the session would state it over an hour that
      // handed over everything, with a count belonging to no hour at all.
      facts.push({
        from: loaded.from,
        ledgerRows: loaded.ledger?.length ?? 0,
        ledgerCarried: loaded.ledger !== undefined,
        ledgerTruncated: loaded.ledgerTruncated,
      });
    }
    merged.sort((a, b) => a.pools.height - b.pools.height);
    // Newest first, which is reading order for the box. Stable, so each hour's own order —
    // the store's, by txid and ordinal within a block — survives.
    rows.sort((a, b) => b.height - a.height);
    return {
      blocks: merged,
      swaps: crossings,
      ledger: rows,
      ledgerCarried: carried,
      perHour: facts,
    };
  }, [hours]);

  return {
    blocks,
    swaps,
    ledger,
    ledgerCarried,
    hours: perHour,
    failedHours,
    loadedHours: hours.map((h) => h.from),
    loading,
  };
}
