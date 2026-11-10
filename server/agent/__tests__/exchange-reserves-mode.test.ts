import { describe, expect, it } from "vitest";
import { AgentTools } from "../tools";
import { FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";
import { withLastReservePoint } from "../tools/enrich";

/**
 * `chain_activity` 'exchange-reserves': the public `/v1/labels/exchanges`, read in-process. The
 * answer a reader asks for ("how much does Binance hold, and how did it change this month") is
 * one call, with the change computed and the grouping stated.
 */
describe("chain_activity 'exchange-reserves'", () => {
  const tools = () => new AgentTools(makeV1(), makeChain(), () => FIXTURE_NOW_MS);

  it("answers one exchange's balance and its change over a window, per address too", async () => {
    const result = await tools().dispatch(
      "chain_activity",
      JSON.stringify({ mode: "exchange-reserves", exchange: "binance", from: "2026-08-01" }),
    );
    expect(result.endpoints).toContain(
      "GET /v1/labels/exchanges?from=2026-08-01&interval=month&exchange=binance&addresses=true",
    );
    expect(result.content).toContain("LABELLED ADDRESSES");
    expect(result.content).toMatch(/"change": \{\s*"from": \{\s*"day": "2026-07-31"/);
    // Ungrouped: the newest point alone beside the change.
    expect(result.content.match(/"periodStart"/g)).toHaveLength(1);
    // Each of Binance's five addresses, and no other exchange's.
    expect(result.content.match(/"address": "t/g)).toHaveLength(5);
    expect(result.content).not.toContain('"coinbase"');
  });

  it("refuses an exchange it does not know rather than answering for all of them", async () => {
    const result = await tools().dispatch(
      "chain_activity",
      JSON.stringify({ mode: "exchange-reserves", exchange: "bitget" }),
    );
    expect(result.content).toMatch(/exchange must be/);
    expect(result.endpoints).toEqual([]);
  });

  it("keeps each unknowns reason on the point it describes when only the newest is kept", () => {
    const out = withLastReservePoint({
      data: { points: [{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }], change: null },
      unknowns: {
        "data.points.1.exchanges.kraken": "unmeasured",
        "data.points.3.exchanges.kraken": "unmeasured",
        "data.points.3.total": "unmeasured",
        "data.change": "nonexistent",
        "addresses.0.balance": "unmeasured",
      },
    }) as { data: { points: unknown[] }; unknowns: Record<string, string> };
    expect(out.data.points).toEqual([{ i: 3 }]);
    expect(out.unknowns).toEqual({
      "data.points.0.exchanges.kraken": "unmeasured",
      "data.points.0.total": "unmeasured",
      "data.change": "nonexistent",
      "addresses.0.balance": "unmeasured",
    });
  });
});
