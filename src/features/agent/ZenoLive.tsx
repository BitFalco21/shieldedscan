"use client";

import { useTickingNow } from "@/lib/use-ticking-now";
import { Zeno, type ZenoProps } from "./Zeno";
import { zenoMood, type ZenoTurn } from "./zeno-mood";

/** Fine enough for the 600 ms ease to land within a few frames of its edge. */
const TICK_MS = 200;

export interface ZenoLiveProps extends Omit<ZenoProps, "expression" | "slow" | "blocks"> {
  turn: ZenoTurn | null;
}

/**
 * Zeno, driven by a turn. The mood is derived (`zenoMood`), and the only thing this adds is a
 * clock that ticks while the turn runs — the "reading" ease after a lookup and the slow-turn
 * sweat are both functions of time, not of events.
 *
 * The clock lives here rather than in the console, so a tick re-renders one small SVG and not
 * the transcript with every past answer in it. Each instance on the page keeps its own; they
 * agree to within a tick because they read the same steps.
 */
export function ZenoLive({ turn, ...figure }: ZenoLiveProps) {
  const now = useTickingNow(turn?.outcome === "live", TICK_MS);
  const mood = zenoMood(turn, now);
  return <Zeno expression={mood.expression} slow={mood.slow} blocks={mood.blocks} {...figure} />;
}
