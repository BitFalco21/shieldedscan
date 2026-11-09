import { describe, expect, it } from "vitest";
import { AgentTools } from "../tools";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

/**
 * Zeno and block age on arrival: `chain_activity` 'block-arrival' reads the public endpoint over
 * the window asked for, with the note that says what an age is (never clock skew) before the data.
 */
const dispatch = async (args: Record<string, unknown>) =>
  (
    await new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS).dispatch(
      "chain_activity",
      JSON.stringify({ mode: "block-arrival", ...args }),
    )
  ).content;

describe("chain_activity 'block-arrival'", () => {
  it("reads the window asked for, every pool per day in a week", async () => {
    const content = await dispatch({ lastDays: 7 });
    expect(content).toMatch(
      /^<note source="GET \/v1\/analytics\/mining-pools\/arrival\?window=7d">/,
    );
    expect(content).toMatch(/NOT CLOCK SKEW/);
    expect(content).toContain('"group": "f2pool"');
    expect(content).toContain('"p50Seconds": 35');
    // The basis paragraph and display names are the note's job.
    expect(content).not.toContain('"basis"');
    expect(content).not.toContain('"name": "F2Pool"');
  });

  it("keeps only the every-block row per day past a week, the pools in the window", async () => {
    const content = await dispatch({});
    expect(content).toMatch(/window=30d/);
    const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
    const body = JSON.parse(json) as {
      data: { days: { groups: { group: string }[] }[]; window: { groups: unknown[] } };
    };
    expect(body.data.days.every((d) => d.groups.every((g) => g.group === "all"))).toBe(true);
    expect(body.data.window.groups.length).toBeGreaterThan(5);
  });

  it("refuses a window the endpoint does not serve", async () => {
    expect(await dispatch({ lastDays: 365 })).toMatch(/7, 30 or 90/);
    expect(await dispatch({ allTime: true })).toMatch(/not from\/to or allTime/);
  });
});
