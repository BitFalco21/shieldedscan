import { describe, expect, it } from "vitest";
import { LATENCY } from "../evals/cases/latency";
import { isDispatchFailure } from "../evals/scripted-model";
import { AgentTools } from "../tools";
import { FIXTURE_NOW_MS, makeChain, makeV1, STATS_24H } from "../testing/fixture-world";

/**
 * Every latency case's ideal first round, dispatched for real against the fixture world. A route
 * whose arguments stop validating, or a figure that leaves the payload the route reads, fails here
 * rather than in a paid run — "one round answers this" is a claim about the data as much as about
 * the model.
 */

const tools = () => new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);

describe("the latency suite", () => {
  it("is about thirty questions, each with a route and a round bound", () => {
    expect(LATENCY.length).toBeGreaterThanOrEqual(30);
    for (const c of LATENCY) {
      expect(c.route?.length ?? 0, c.id).toBeGreaterThan(0);
      expect(c.maxToolRounds, c.id).toBeGreaterThanOrEqual(1);
      expect(c.maxToolRounds, c.id).toBeLessThanOrEqual(2);
      // The route is the ideal answer, so it must satisfy the case's own routing assertions.
      const names = c.route!.map((r) => r.name);
      for (const banned of c.mustNotCall ?? []) expect(names, c.id).not.toContain(banned);
      if (c.mustCallAny)
        expect(
          c.mustCallAny.some((t) => names.includes(t)),
          c.id,
        ).toBe(true);
    }
  });

  for (const c of LATENCY) {
    it(`${c.id}: its route dispatches${c.routeCarries ? ` and carries ${c.routeCarries.join(", ")}` : ""}`, async () => {
      const t = tools();
      const contents: string[] = [];
      for (const call of c.route!) {
        const result = await t.dispatch(call.name, JSON.stringify(call.args), c.question);
        expect(isDispatchFailure(result.content), result.content.slice(0, 200)).toBe(false);
        expect(result.content, "a refused chart or file is not a route").not.toMatch(/^<refusal/);
        contents.push(result.content);
      }
      for (const key of c.routeCarries ?? []) {
        expect(contents.join("\n"), key).toContain(`"${key}"`);
      }
    });
  }
});

describe("the last 24 hours, as the agent reads them", () => {
  it("carries the rolling count with its grouped form", async () => {
    const { content } = await tools().dispatch(
      "chain_status",
      JSON.stringify({ include: ["chain"] }),
    );
    expect(content).toContain(`"txCount24h": ${STATS_24H.txCount24h}`);
    expect(content).toContain(`"txCount24hGrouped": "8,412"`);
  });

  it("gives the share with the count it is a share of, never the reconstructed numerator", async () => {
    const { content } = await tools().dispatch(
      "chain_status",
      JSON.stringify({ include: ["status"] }),
    );
    expect(content).toContain(`"pct": ${STATS_24H.fullyShieldedPct24h}`);
    expect(content).toContain(`"denominator": ${STATS_24H.txCount24h}`);
    expect(content).not.toContain("numerator");
  });
});
