"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dispatch } from "react";
import type { ZenoExpression } from "@/features/agent/zeno-mood";
import { SIM_BLOCK_MS } from "./sim-model";
import type { SimAction } from "./sim-model";
import { TOUR, TOUR_STEPS, tourStateAt } from "./tour-script";
import type { TourTarget } from "./tour-script";
import { prefersReducedMotion } from "@/lib/use-reduced-motion";

export interface GuidedRun {
  /** Zeno is guiding: the tour is on screen and waiting for the reader. */
  running: boolean;
  /** The tour reached its last line and is waiting for the reader's choice. */
  ended: boolean;
  /** The beat on screen, from 0, out of `steps` before the closing line. */
  step: number;
  steps: number;
  /** A pressed transaction is waiting for its block. */
  landing: boolean;
  /** The beat's own target, whether or not it is pointed at right now. */
  target: TourTarget | null;
  /** The control or row being pointed at right now, or null. */
  highlight: TourTarget | null;
  /** Zeno's current line and face. */
  say: string;
  expression: ZenoExpression;
  start: () => void;
  stop: () => void;
  next: () => void;
  back: () => void;
}

interface RunState {
  running: boolean;
  ended: boolean;
  beat: number;
  landing: boolean;
}

const IDLE: RunState = { running: false, ended: false, beat: 0, landing: false };

/**
 * The guided tour (`tour-script.ts` holds the beats). It waits for the reader at every beat — a
 * newcomer must never be rushed past a line — and moves on when they press the control Zeno points
 * at, or press next to have it done for them. `back` returns to the previous beat exactly as it
 * was. While a block is landing, `next` lands it at once.
 *
 * Moving forward dispatches the same actions the buttons do, so the tour can never show something
 * the reader could not do; moving back restores the beat's state, computed from the script, so
 * nothing has to be undone. The last beat ends the tour and waits for the reader's choice.
 */
export function useGuidedRun(dispatch: Dispatch<SimAction>, priceUsd: number | null): GuidedRun {
  const [run, setRun] = useState<RunState>(IDLE);

  /** Show beat `k`: forward makes its press, as a reader would; back restores its state. */
  const enter = useCallback(
    (k: number, forward: boolean) => {
      const beat = TOUR[k];
      if (beat === undefined) return;
      if (!forward) dispatch({ type: "restore", state: tourStateAt(k, priceUsd) });
      else if (beat.press) dispatch(beat.press(priceUsd));
      const end = k === TOUR.length - 1;
      setRun({ running: !end, ended: end, beat: k, landing: forward && beat.lands === true });
    },
    [dispatch, priceUsd],
  );

  const start = useCallback(() => {
    dispatch({ type: "restore", state: tourStateAt(0, priceUsd) });
    setRun({ ...IDLE, running: true });
  }, [dispatch, priceUsd]);

  const stop = useCallback(() => setRun((r) => ({ ...r, running: false, ended: false })), []);

  const next = useCallback(() => {
    if (!run.running) return;
    if (run.landing) {
      // The reader does not want to wait for the block: land it now.
      dispatch({ type: "confirm" });
      setRun((r) => ({ ...r, landing: false }));
      return;
    }
    enter(run.beat + 1, true);
  }, [run.running, run.landing, run.beat, dispatch, enter]);

  const back = useCallback(() => {
    if (run.running && run.beat > 0) enter(run.beat - 1, false);
  }, [run.running, run.beat, enter]);

  // A pressed transaction shows its line once its block lands. The simulator lands it on its own
  // clock, at SIM_BLOCK_MS; this waits a moment longer so the new row is on screen first.
  useEffect(() => {
    if (!run.running || !run.landing) return;
    const id = window.setTimeout(
      () => setRun((r) => ({ ...r, landing: false })),
      (prefersReducedMotion() ? 0 : SIM_BLOCK_MS) + 250,
    );
    return () => window.clearTimeout(id);
  }, [run.running, run.landing, run.beat]);

  const shown = TOUR[run.beat];
  const target = run.running || run.ended ? (shown?.target ?? null) : null;
  const highlight = run.landing ? null : target;

  // Bring what is pointed at into view: on a phone the exchange, the wallet and the chain are a
  // screen apart.
  useEffect(() => {
    if (highlight === null) return;
    document
      .getElementById(`learn-${highlight}`)
      ?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [highlight, run.beat]);

  // While a block lands, the line that announced the press stays up and Zeno waits for it.
  const line = run.running && run.landing ? TOUR[run.beat - 1] : shown;

  return {
    running: run.running,
    ended: run.ended,
    step: run.beat,
    steps: TOUR_STEPS,
    landing: run.landing,
    target,
    highlight,
    say: line?.say ?? "",
    expression: run.running && run.landing ? "thinking" : (line?.expression ?? "ready"),
    start,
    stop,
    next,
    back,
  };
}
