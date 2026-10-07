import { describe, expect, it } from "vitest";
import { COMPUTING, THINKING_AGAIN, THINKING_FIRST, WORKING, type AgentStep } from "../trail-steps";
import { EASE_MS, MAX_BLOCKS, SLOW_1_MS, SLOW_2_MS, zenoMood, type ZenoTurn } from "../zeno-mood";

/**
 * Zeno's face is a claim about what the agent is doing, so every mapping here is pinned to the
 * event that justifies it. The failure these tests exist to prevent is the cheerful one: a
 * celebration over a non-answer, or "reading" while nothing is being read.
 */

const T0 = 1_000_000;

const thinking = (at: number, endedAt: number | null = null): AgentStep => ({
  kind: "thinking",
  label: at === T0 ? THINKING_FIRST : THINKING_AGAIN,
  startedAt: at,
  endedAt,
});
const lookup = (at: number, endedAt: number | null = null): AgentStep => ({
  kind: "lookup",
  label: "looking up the block",
  tool: "lookup_block",
  detail: "3428150",
  startedAt: at,
  endedAt,
});
const computing = (at: number, endedAt: number | null = null): AgentStep => ({
  kind: "lookup",
  label: COMPUTING,
  tool: "calculate",
  startedAt: at,
  endedAt,
});
const writing = (at: number): AgentStep => ({
  kind: "answering",
  label: WORKING,
  startedAt: at,
  endedAt: null,
});
const narration = (at: number): AgentStep => ({
  kind: "narration",
  label: "Fetching that block.",
  startedAt: at,
  endedAt: at,
});

const live = (steps: AgentStep[]): ZenoTurn => ({ steps, outcome: "live" });

describe("zenoMood", () => {
  it("is ready with nothing asked", () => {
    expect(zenoMood(null, T0)).toEqual({ expression: "ready", slow: 0, blocks: 0 });
  });

  it("thinks while nothing is in flight", () => {
    expect(zenoMood(live([thinking(T0)]), T0 + 500).expression).toBe("thinking");
  });

  it("reads while a lookup runs, and only then", () => {
    const steps = [thinking(T0, T0 + 900), narration(T0 + 900), lookup(T0 + 900)];
    expect(zenoMood(live(steps), T0 + 950).expression).toBe("reading");
  });

  it("keeps reading for a moment after a lookup, then goes back to thinking", () => {
    // Lookups are often a few milliseconds long. A face that flips for one frame is a glitch.
    const done = T0 + 1_000;
    const steps = [lookup(T0, done), thinking(done)];
    expect(zenoMood(live(steps), done + EASE_MS - 1).expression).toBe("reading");
    expect(zenoMood(live(steps), done + EASE_MS).expression).toBe("thinking");
  });

  it("thinks rather than reads during a calculation, which reads nothing", () => {
    expect(zenoMood(live([thinking(T0, T0 + 10), computing(T0 + 10)]), T0 + 20).expression).toBe(
      "thinking",
    );
    // …and a finished calculation does not ease into reading either.
    const steps = [computing(T0, T0 + 5), thinking(T0 + 5)];
    expect(zenoMood(live(steps), T0 + 50).expression).toBe("thinking");
  });

  it("writes while tokens arrive", () => {
    const steps = [thinking(T0, T0 + 3_000), writing(T0 + 3_000)];
    expect(zenoMood(live(steps), T0 + 3_100).expression).toBe("writing");
  });

  it("stacks one block per real lookup, never for a calculation, and caps at the budget", () => {
    const reads = Array.from({ length: 6 }, (_, i) => lookup(T0 + i * 10, T0 + i * 10 + 5));
    expect(
      zenoMood(live([...reads.slice(0, 2), computing(T0 + 90, T0 + 95)]), T0 + 99).blocks,
    ).toBe(2);
    expect(zenoMood(live(reads), T0 + 99).blocks).toBe(MAX_BLOCKS);
  });

  it("sweats on a slow turn, measured from the turn's own start", () => {
    const steps = [thinking(T0)];
    expect(zenoMood(live(steps), T0 + SLOW_1_MS - 1).slow).toBe(0);
    expect(zenoMood(live(steps), T0 + SLOW_1_MS).slow).toBe(1);
    expect(zenoMood(live(steps), T0 + SLOW_2_MS).slow).toBe(2);
  });

  it("celebrates an answer and keeps the blocks it read", () => {
    const steps = [lookup(T0, T0 + 5), writing(T0 + 10)];
    expect(zenoMood({ steps, outcome: "answered" }, T0 + 99_000)).toEqual({
      expression: "answered",
      slow: 0,
      blocks: 1,
    });
  });

  it("shrugs at a non-answer, with the blocks still lit — the data was read", () => {
    const steps = [lookup(T0, T0 + 5), lookup(T0 + 6, T0 + 9)];
    expect(zenoMood({ steps, outcome: "stuck" }, T0 + 99_000)).toEqual({
      expression: "stuck",
      slow: 0,
      blocks: 2,
    });
  });

  it("does not shrug at a stop the visitor chose", () => {
    const steps = [lookup(T0, T0 + 5)];
    expect(zenoMood({ steps, outcome: "stopped" }, T0 + 99_000).expression).toBe("ready");
  });
});
