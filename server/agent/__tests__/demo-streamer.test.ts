import { describe, expect, it } from "vitest";
import { runAgentTurn, type AgentEvent } from "../loop";
import { AgentTools } from "../tools";
import { demoStreamer } from "../testing/demo-streamer";
import { ADDRESS_INFO, FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

/** The local demo's scripted model, so `npm run dev:agent-demo` keeps showing a chart. */
async function turn(question: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of runAgentTurn(
    {
      streamer: demoStreamer,
      tools: new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS),
      now: () => FIXTURE_NOW_MS,
    },
    [{ role: "user", content: question }],
    new AbortController().signal,
  )) {
    events.push(e);
  }
  return events;
}

const text = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.event === "delta" ? [e.data.text] : [])).join("");

describe("the local chart demo", () => {
  it.each([
    "how did Orchard drain since July?",
    "chart the ZEC price this year",
    "fees vs last month",
    "chart the median fee",
    "compare transactions over time",
    "plot sprout and sapling on a log scale",
    "chart difficulty",
    "Bitcoin swaps over the year",
    "miner concentration history",
    "chart the notes in each pool",
    "graph migrations into Ironwood",
    "supply history",
  ])("draws a chart for %j and describes it from the tool's own summary", async (question) => {
    const events = await turn(question);
    expect(events.filter((e) => e.event === "chart")).toHaveLength(1);
    expect(text(events)).toMatch(/ went from .* to /);
  });

  it.each([
    "chart the hashrate this year",
    "chart this address over time",
    "Bitcoin → Zcash last week",
  ])("refuses %j in words", async (question) => {
    const events = await turn(question);
    expect(events.some((e) => e.event === "chart")).toBe(false);
    expect(text(events)).toMatch(/No chart for that: /);
  });

  it.each([
    "Orchard balances for 2026 as CSV",
    "export the latest blocks",
    "download the price for the last month",
    "supply by pool as json",
    "the miners this month as a spreadsheet",
    `export ${ADDRESS_INFO.address} as csv`,
  ])("offers a file for %j and says what it holds", async (question) => {
    const events = await turn(question);
    expect(events.filter((e) => e.event === "export")).toHaveLength(1);
    expect(text(events)).toMatch(/The file is below: /);
  });

  it.each(["Bitcoin swaps as csv", `export zs1${"q".repeat(75)} as csv`])(
    "refuses a file for %j in words",
    async (question) => {
      const events = await turn(question);
      expect(events.some((e) => e.event === "export")).toBe(false);
      expect(text(events)).toMatch(/No file for that: /);
    },
  );

  it("answers anything else in words", async () => {
    const events = await turn("what is the shielded supply?");
    expect(events.some((e) => e.event === "chart")).toBe(false);
    expect(text(events)).toMatch(/local demo/);
  });
});
