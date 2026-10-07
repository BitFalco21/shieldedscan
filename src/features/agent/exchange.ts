import type { AgentSource } from "./agent-client";
import { THINKING_FIRST, type AgentStep } from "./trail-steps";
import type { ZenoTurn } from "./zeno-mood";

/**
 * One question and everything the console knows about its answer. Held in React state and
 * nowhere else — no localStorage, no cookie, no server-side transcript — which is the claim
 * `/privacy` makes on this feature's behalf.
 */
export interface Exchange {
  /**
   * Stable for the exchange's life, so React keeps a turn's component state with that turn: a
   * turn replaced in place by `ask again` or `edit` is a new exchange, not the old one reused.
   */
  id: number;
  question: string;
  /**
   * The prose of the round in flight, not yet known to be answer: a round is known to be a tool
   * call only once it ends, which is why the server cannot suppress preamble without giving up
   * streaming (see `runAgentTurn`). Committed into `answer` — or discarded, if the round turned
   * out to be a tool call — when the round closes.
   */
  live: string;
  /**
   * The round's prose once the server has flagged it as WORKING (`working` events). Feeds the
   * trail's live line and nothing else — never `live`, never `answer`, never history. Cleared
   * with `live` at every round boundary.
   */
  working: string;
  /**
   * Append-only: every write is `answer + …`, so the answer body cannot shrink by construction.
   * (`reset` must not wipe it, or a tool-using answer would grow, snap shut and refill.)
   */
  answer: string;
  sources: AgentSource[];
  /**
   * What the agent did to reach this answer, in order — see `AgentTrail`. Kept per exchange so
   * scrolling back to an earlier turn still shows how that turn was answered; a turn makes at
   * most `MAX_TOOL_CALLS_PER_TURN` lookups, so this is never more than a handful of rows.
   */
  steps: AgentStep[];
  status: "streaming" | "complete" | "truncated" | "failed";
  note: string | null;
  /** The visitor pressed stop. Their choice, so no shrug and no `ask again`. */
  stopped: boolean;
  /**
   * The text is the server's own closing ("I could not put that answer into words…"), flagged
   * on its `done` event. A completed stream that is not an answer: it gets the `couldn't
   * answer` label, Zeno shrugs instead of celebrating, and `ask again` is offered.
   */
  unanswered: boolean;
  /**
   * Whether asking the same question again is the useful next step: the turn failed, was cut
   * off by the stream ending, or ended in the unanswered closing. Not after a length or
   * tool-budget limit — the same question would meet the same limit — and not after a stop.
   */
  retryable: boolean;
}

/** A fresh exchange for a question just sent. */
export function newExchange(id: number, question: string, at: number): Exchange {
  return {
    id,
    question,
    live: "",
    working: "",
    answer: "",
    sources: [],
    // Seeded, not empty: an empty trail renders nothing, and the seconds between pressing send
    // and the first byte are exactly when a reader most needs to see something happen.
    steps: [{ kind: "thinking", label: THINKING_FIRST, startedAt: at, endedAt: null }],
    status: "streaming",
    note: null,
    stopped: false,
    unanswered: false,
    retryable: false,
  };
}

/**
 * Close the step in flight, if there is one. Idempotent, because two events can arrive between
 * one step and the next and only the first of them opens the next step.
 */
export function closeLastStep(steps: readonly AgentStep[], at: number): AgentStep[] {
  const last = steps[steps.length - 1];
  if (last === undefined || last.endedAt !== null) return [...steps];
  return [...steps.slice(0, -1), { ...last, endedAt: at }];
}

/**
 * Start a step, closing whatever preceded it at the same instant so the trail has no gaps.
 *
 * A step identical to the one already in flight is a no-op rather than a second row. Two things
 * produce one: `send` opens "thinking" before the request is even made — so the trail is on
 * screen the moment the reader presses send, rather than after the first byte comes back — and
 * the loop then opens the turn with the `status thinking` that says the same thing. Splitting one
 * wait across two rows would report a step that did not happen twice.
 */
export function openStep(steps: readonly AgentStep[], step: AgentStep): AgentStep[] {
  const last = steps[steps.length - 1];
  if (last !== undefined && last.endedAt === null && last.label === step.label) return [...steps];
  return [...closeLastStep(steps, step.startedAt), step];
}

/**
 * What Zeno should act out for this exchange. `live` is the request being in flight, never the
 * status: a stream that ends without a `done` leaves the status at "streaming" until `send`'s
 * `finally` settles it, and Zeno must not keep working through that gap.
 *
 * Celebration is reserved for an exchange that ended with a real answer — a completed stream,
 * not the server's unanswered closing, with text to show. Everything else that ended without
 * the visitor's say-so is a shrug.
 */
export function zenoTurnOf(exchange: Exchange | undefined, live: boolean): ZenoTurn | null {
  if (exchange === undefined) return null;
  if (live) return { steps: exchange.steps, outcome: "live" };
  if (exchange.stopped) return { steps: exchange.steps, outcome: "stopped" };
  const answered =
    exchange.status === "complete" && !exchange.unanswered && exchange.answer.trim() !== "";
  return { steps: exchange.steps, outcome: answered ? "answered" : "stuck" };
}
