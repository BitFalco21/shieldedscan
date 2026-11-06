/**
 * Where a turn's time went: each model call and each tool dispatch, measured on a monotonic clock.
 *
 * The record carries durations, counts and token totals only. It holds no question, no answer, no
 * argument and no identifier, so a consumer cannot learn what was asked from it. Production wires no
 * consumer: `/privacy` says the API logs no request, and a per-turn line, however bare, would be one.
 * The eval runner is the consumer, and a local run may print it with `formatTurnTiming`.
 */

export interface ModelCallTiming {
  /** From the call's start to the first event the loop saw (text, a reasoning heartbeat, or the end). */
  ttfeMs: number | null;
  /**
   * From the request to the first SSE data line, as the client measured it. Set only by the real
   * client, so a scripted model leaves it null. For a tool-call round it is the closest thing to a
   * first token: tool-call fragments are assembled silently and yield no event before the end.
   */
  firstDataMs: number | null;
  ms: number;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Prompt tokens the provider served from its prefix cache, when it reports them; else null. */
  cachedTokens: number | null;
  /** How many tool calls the call asked for; 0 is an answering (or failed) round. */
  toolCalls: number;
}

export interface ToolTiming {
  name: string;
  ms: number;
  /** The 0-based model call whose tool calls this dispatch answered. */
  call: number;
}

export type TurnOutcome = "complete" | "length" | "tool-limit" | "unanswered" | "error" | "aborted";

export interface TurnTiming {
  totalMs: number;
  /** Model calls made, retries of a round included. */
  modelCalls: number;
  /** Model calls that asked for at least one tool: the round trips a well-routed answer minimises. */
  toolRounds: number;
  calls: ModelCallTiming[];
  tools: ToolTiming[];
  outcome: TurnOutcome;
}

/** A started model call, closed by `end`. */
export interface CallHandle {
  firstEvent(): void;
  end(
    final: {
      toolCalls: readonly unknown[];
      usage: {
        promptTokens: number;
        completionTokens: number;
        cachedTokens?: number;
      } | null;
      firstDataMs?: number;
    } | null,
  ): void;
}

/** Collects one turn's timings. `clock` is monotonic milliseconds; tests inject their own. */
export class TurnTimer {
  readonly #clock: () => number;
  readonly #started: number;
  readonly #calls: (ModelCallTiming & { open: boolean; startedAt: number })[] = [];
  readonly #tools: ToolTiming[] = [];

  constructor(clock: () => number = () => performance.now()) {
    this.#clock = clock;
    this.#started = clock();
  }

  startCall(): CallHandle {
    const startedAt = this.#clock();
    const call = {
      ttfeMs: null as number | null,
      firstDataMs: null as number | null,
      ms: 0,
      promptTokens: null as number | null,
      completionTokens: null as number | null,
      cachedTokens: null as number | null,
      toolCalls: 0,
      open: true,
      startedAt,
    };
    this.#calls.push(call);
    return {
      firstEvent: () => {
        if (call.ttfeMs === null) call.ttfeMs = this.#clock() - startedAt;
      },
      end: (final) => {
        if (!call.open) return;
        call.open = false;
        call.ms = this.#clock() - startedAt;
        if (final === null) return;
        call.toolCalls = final.toolCalls.length;
        call.firstDataMs = final.firstDataMs ?? null;
        if (final.usage !== null) {
          call.promptTokens = final.usage.promptTokens;
          call.completionTokens = final.usage.completionTokens;
          call.cachedTokens = final.usage.cachedTokens ?? null;
        }
      },
    };
  }

  /** Times one dispatch; resolves or rejects exactly as `run` does. */
  async tool<T>(name: string, run: () => Promise<T>): Promise<T> {
    const started = this.#clock();
    const call = this.#calls.length - 1;
    try {
      return await run();
    } finally {
      this.#tools.push({ name, ms: this.#clock() - started, call });
    }
  }

  finish(outcome: TurnOutcome): TurnTiming {
    const now = this.#clock();
    const calls = this.#calls.map(({ open, startedAt, ...call }) =>
      open ? { ...call, ms: now - startedAt } : call,
    );
    return {
      totalMs: now - this.#started,
      modelCalls: calls.length,
      toolRounds: calls.filter((c) => c.toolCalls > 0).length,
      calls,
      // Concurrent dispatches finish out of order; the record lists them by the round they served.
      tools: [...this.#tools].sort((a, b) => a.call - b.call),
      outcome,
    };
  }
}

const round = (ms: number | null): number | null => (ms === null ? null : Math.round(ms));

/**
 * One line, for a local run or a measurement script: `agent turn {json}` with whole milliseconds.
 * Tool names are ours; nothing a visitor wrote can reach it.
 */
export function formatTurnTiming(t: TurnTiming): string {
  return `agent turn ${JSON.stringify({
    ms: round(t.totalMs),
    outcome: t.outcome,
    modelCalls: t.modelCalls,
    toolRounds: t.toolRounds,
    calls: t.calls.map((c) => ({
      ttfe: round(c.ttfeMs),
      firstData: round(c.firstDataMs),
      ms: round(c.ms),
      in: c.promptTokens,
      cached: c.cachedTokens,
      out: c.completionTokens,
      tools: c.toolCalls,
    })),
    tools: t.tools.map((x) => ({ name: x.name, ms: round(x.ms), call: x.call })),
  })}`;
}
