import { describe, expect, it } from "vitest";
import { runAgentTurn, type AgentEvent } from "../loop";
import { AgentTools } from "../tools";
import { demoStreamer } from "../testing/demo-streamer";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

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
    "chart the ZEC price",
    "fees vs last month",
    "compare transactions over time",
    "plot sprout and sapling on a log scale",
    "chart difficulty",
  ])("draws a chart for %j and describes it from the tool's own summary", async (question) => {
    const events = await turn(question);
    expect(events.filter((e) => e.event === "chart")).toHaveLength(1);
    expect(text(events)).toMatch(/ went from .* to /);
  });

  it("answers anything else in words", async () => {
    const events = await turn("what is the shielded supply?");
    expect(events.some((e) => e.event === "chart")).toBe(false);
    expect(text(events)).toMatch(/local demo/);
  });
});
