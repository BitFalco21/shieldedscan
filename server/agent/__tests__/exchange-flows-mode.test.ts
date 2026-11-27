import { describe, expect, it } from "vitest";
import { AgentTools } from "../tools";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";
import { withoutFlowPoints } from "../tools/enrich";

/**
 * `chain_activity` 'exchange-flows': the public `/v1/labels/exchanges/flows` and `/movements`,
 * read in-process in one call, so "how much flowed into Binance this month, and the biggest
 * movements" needs nothing more.
 */
describe("chain_activity 'exchange-flows'", () => {
  const tools = () => new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);

  it("reads the window's totals and its largest movements together", async () => {
    const result = await tools().dispatch(
      "chain_activity",
      JSON.stringify({ mode: "exchange-flows", lastDays: 30 }),
    );
    expect(result.endpoints).toHaveLength(2);
    expect(result.endpoints[0]).toMatch(
      /^GET \/v1\/labels\/exchanges\/flows\?from=.*&interval=month$/,
    );
    expect(result.endpoints[1]).toMatch(
      /^GET \/v1\/labels\/exchanges\/movements\?from=.*&limit=5$/,
    );
    expect(result.content).toContain("LABELLED TRANSPARENT ADDRESSES");
    // Ungrouped: the totals, with their parts, and no per-period points.
    expect(result.content).toContain('"betweenExchanges"');
    expect(result.content).not.toContain('"points"');
  });

  it("asks for one exchange before it reads a series", async () => {
    const t = tools();
    const all = await t.dispatch(
      "chain_activity",
      JSON.stringify({ mode: "exchange-flows", lastDays: 30, groupBy: "day" }),
    );
    expect(all.content).toMatch(/needs one exchange/);
    expect(all.endpoints).toEqual([]);
    const one = await t.dispatch(
      "chain_activity",
      JSON.stringify({ mode: "exchange-flows", lastDays: 30, groupBy: "day", exchange: "binance" }),
    );
    expect(one.endpoints[0]).toMatch(
      /interval=day&exchange=binance|exchange=binance.*interval=day/,
    );
    expect(one.content).toContain('"points"');
  });

  it("drops the points' unknowns with the points", () => {
    expect(
      withoutFlowPoints({
        data: { points: [{}], totals: {} },
        unknowns: {
          "data.points.0.exchanges.okx": "unmeasured",
          "data.totals.exchanges.okx": "unmeasured",
        },
      }),
    ).toEqual({
      data: { totals: {} },
      unknowns: { "data.totals.exchanges.okx": "unmeasured" },
    });
  });
});
