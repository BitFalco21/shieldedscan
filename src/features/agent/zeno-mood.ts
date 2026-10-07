import { COMPUTING, type AgentStep } from "./trail-steps";

/**
 * What Zeno acts out, derived from what the agent loop is really doing — never a timer
 * pretending to be progress. Every gag is driven by an event the console already observed:
 *
 *  - `thinking` — no token and no lookup in flight: Zeno floats and sways.
 *  - `reading` — a lookup in flight, or one that ended under {@link EASE_MS} ago: a quick bob,
 *    the antenna pings, the eyes scan. Lookups are often a few milliseconds long, and a face
 *    that flips for one frame reads as a glitch.
 *  - `writing` — tokens are arriving: eyes down, an arm scribbling.
 *  - `answered` — the turn completed with an answer: a hop and pixel confetti, once.
 *  - `stuck` — no answer, a cut-off one, or the server's "I could not put that answer into
 *    words" closing: a shrug and a fizzle. Never confetti over a non-answer.
 *  - `ready` — nothing asked yet, or the visitor stopped the turn: their choice, not a failure,
 *    so no shrug.
 *
 * The stack of blocks beside Zeno is the honest half: one block per lookup that really ran,
 * capped at {@link MAX_BLOCKS} (the turn's tool budget is four). A calculation is not a read, so
 * it adds no block.
 */
export type ZenoExpression = "ready" | "thinking" | "reading" | "writing" | "answered" | "stuck";

/** 0 normally; 1 once a turn has run {@link SLOW_1_MS}; 2 past {@link SLOW_2_MS}. */
export type ZenoSlow = 0 | 1 | 2;

export interface ZenoMood {
  expression: ZenoExpression;
  slow: ZenoSlow;
  blocks: number;
}

/** How a turn stands, as the console knows it. */
export type ZenoOutcome = "live" | "answered" | "stuck" | "stopped";

export interface ZenoTurn {
  steps: readonly AgentStep[];
  outcome: ZenoOutcome;
}

/** A lookup that ended this recently still reads as reading. */
export const EASE_MS = 600;
/** A sweat drop: the turn is slow. Measured turns run 5–45 s, median ~15 s. */
export const SLOW_1_MS = 20_000;
/** A second drop and a hand to the face. */
export const SLOW_2_MS = 40_000;
/** One block per lookup, at most the turn's own tool budget. */
export const MAX_BLOCKS = 4;

const READY: ZenoMood = { expression: "ready", slow: 0, blocks: 0 };

const isRead = (s: AgentStep) => s.kind === "lookup" && s.label !== COMPUTING;

/**
 * The mood for one turn at one instant. Pure, so the mapping is pinned by tests rather than by
 * a recording of the animation; `now` is passed in because reading the clock is the caller's
 * job (a ticking hook while the turn runs, nothing once it has settled).
 */
export function zenoMood(turn: ZenoTurn | null, now: number): ZenoMood {
  if (turn === null) return READY;
  const blocks = Math.min(MAX_BLOCKS, turn.steps.filter(isRead).length);

  if (turn.outcome === "stopped") return { ...READY, blocks };
  if (turn.outcome === "answered") return { expression: "answered", slow: 0, blocks };
  if (turn.outcome === "stuck") return { expression: "stuck", slow: 0, blocks };

  const started = turn.steps[0]?.startedAt ?? now;
  const elapsed = now - started;
  const slow: ZenoSlow = elapsed >= SLOW_2_MS ? 2 : elapsed >= SLOW_1_MS ? 1 : 0;
  return { expression: liveExpression(turn.steps, now), slow, blocks };
}

function liveExpression(steps: readonly AgentStep[], now: number): ZenoExpression {
  const running = steps[steps.length - 1];
  if (running !== undefined && running.endedAt === null) {
    if (running.kind === "lookup") return running.label === COMPUTING ? "thinking" : "reading";
    if (running.kind === "answering") return "writing";
  }
  // The easing: the most recent read, if it finished a moment ago.
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (!isRead(s)) continue;
    if (s.endedAt !== null && now - s.endedAt < EASE_MS) return "reading";
    break;
  }
  return "thinking";
}
