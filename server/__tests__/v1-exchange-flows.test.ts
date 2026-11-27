import { describe, expect, it } from "vitest";
import { LABEL_FLOW_LAG_BLOCKS, type LabelFlowAggregates } from "../label-flows";
import {
  V1_EXCHANGE_FLOWS_PATH,
  V1_EXCHANGE_MOVEMENTS_PATH,
  buildExchangeFlows,
  v1ExchangeFlowsRoutes,
} from "../v1/exchange-flows";
import { parseSeriesWindow } from "../v1/analytics-series";

const DAY = 86_400;
/** 2026-11-01 as a day number, and its next days. */
const D = Date.UTC(2026, 10, 1) / 1000 / DAY;
const day = (k: number) => new Date((D + k) * DAY * 1000).toISOString().slice(0, 10);

/** Days D..D+4 have ended at heights 100, 200, …; the caps decide which count. */
function agg(over: Partial<LabelFlowAggregates> = {}): LabelFlowAggregates {
  return {
    caps: new Map<string, number | null>([
      ["binance", 350],
      ["kraken", 360],
      ["coinbase", 400],
      ["gemini", 400],
      ["okx", 400],
      ["kucoin", 400],
      ["bitget", 400],
      ["gate", 400],
      ["bridge", 400],
      ["other", 400],
    ]),
    dayLastHeight: new Map([0, 1, 2, 3, 4].map((k) => [D + k, (k + 1) * 100])),
    days: [
      { day: D, exchange: "binance", direction: "in", txs: 3, zat: 1_000 },
      { day: D, exchange: "binance", direction: "out", txs: 1, zat: 600 },
      { day: D, exchange: "binance", direction: "internal", txs: 2, zat: 7 },
      { day: D, exchange: "kraken", direction: "in", txs: 1, zat: 400 },
      { day: D + 1, exchange: "binance", direction: "in", txs: 1, zat: 50 },
      // Past the counted days: never in an answer.
      { day: D + 3, exchange: "binance", direction: "in", txs: 9, zat: 9_999 },
    ],
    parts: [
      {
        day: D,
        exchange: "binance",
        direction: "in",
        kind: "transparent",
        counterpart: null,
        zat: 700,
      },
      {
        day: D,
        exchange: "binance",
        direction: "in",
        kind: "shielded",
        counterpart: null,
        zat: 300,
      },
      {
        day: D,
        exchange: "binance",
        direction: "out",
        kind: "transparent",
        counterpart: null,
        zat: 190,
      },
      {
        day: D,
        exchange: "binance",
        direction: "out",
        kind: "exchange",
        counterpart: "kraken",
        zat: 400,
      },
      { day: D, exchange: "binance", direction: "out", kind: "fee", counterpart: null, zat: 10 },
      {
        day: D,
        exchange: "kraken",
        direction: "in",
        kind: "exchange",
        counterpart: "binance",
        zat: 400,
      },
      {
        day: D + 1,
        exchange: "binance",
        direction: "in",
        kind: "mixed",
        counterpart: null,
        zat: 50,
      },
    ],
    unresolved: new Map(),
    ...over,
  };
}

const win = (q: Record<string, string>) => parseSeriesWindow(q);

describe("buildExchangeFlows", () => {
  it("counts whole days only, each once every block in it is below every counted cap", () => {
    // The lowest cap is 350: days ending at 100, 200 and 300 count, the one ending at 400 does not.
    const r = buildExchangeFlows(agg(), win({ from: day(0), to: day(10), interval: "day" }), {
      exchange: null,
    });
    expect(r.data.counted).toEqual({ from: day(0), to: day(2) });
    expect(r.data.points.map((p) => p.periodStart)).toEqual([day(0), day(1), day(2)]);
    expect(r.data.totals.exchanges.binance!.in.value.zat).toBe(1_050);
    expect(r.coverage.notes.join(" ")).toContain(`Counted through ${day(2)}`);
  });

  it("marks the period the count stops inside, and states nothing past it", () => {
    const r = buildExchangeFlows(agg(), win({ from: day(0), interval: "month" }), {
      exchange: null,
    });
    expect(r.data.points).toHaveLength(1);
    expect(r.data.points[0]).toMatchObject({ periodStart: day(0), through: day(2) });
  });

  it("leaves a move between two exchanges out of allExchanges, and states it apart", () => {
    const r = buildExchangeFlows(agg(), win({ from: day(0), to: day(1), interval: "day" }), {
      exchange: null,
    });
    const all = r.data.totals.allExchanges!;
    // In: Binance 1,000 + Kraken 400, less Kraken's 400 from Binance.
    expect(all.in.value.zat).toBe(1_000);
    // Out: Binance's 600 less the 400 it sent Kraken; the fee left the exchanges and stays.
    expect(all.out.value.zat).toBe(200);
    expect(all.betweenExchanges.zat).toBe(400);
    expect(all.out.parts.map((p) => p.kind)).toEqual(["transparent", "fee"]);
    // Each exchange still shows its own side of it.
    expect(r.data.totals.exchanges.binance!.out.parts).toContainEqual({
      kind: "exchange",
      exchange: "kraken",
      value: { zat: 400, zec: "0.00000400" },
    });
  });

  it("reports internal moves apart, so in − out − their fee is the change in reserves", () => {
    const r = buildExchangeFlows(agg(), win({ from: day(0), to: day(1), interval: "day" }), {
      exchange: "binance",
    });
    const b = r.data.totals.exchanges.binance!;
    expect(b.internal).toEqual({ txs: 2, fee: { zat: 7, zec: "0.00000007" } });
    expect(b.in.value.zat - b.out.value.zat - b.internal.fee.zat).toBe(393);
    expect(r.data.totals).not.toHaveProperty("allExchanges");
  });

  it("says an exchange it cannot count is unmeasured, never zero, and drops allExchanges", () => {
    const caps = agg().caps;
    caps.set("okx", null);
    const r = buildExchangeFlows(
      agg({ caps }),
      win({ from: day(0), to: day(10), interval: "day" }),
      {
        exchange: null,
      },
    );
    expect(r.data.totals.exchanges.okx).toBeNull();
    expect(r.unknowns["data.totals.exchanges.okx"]).toBe("unmeasured");
    expect(r.data.totals.allExchanges).toBeNull();
    expect(r.unknowns["data.totals.allExchanges"]).toBe("unmeasured");
    expect(r.coverage.notes.join(" ")).toContain("Not counted yet: OKX");
  });

  it("does not cut every exchange back to one still walking a new address", () => {
    const caps = agg().caps;
    caps.set("gate", 350 - LABEL_FLOW_LAG_BLOCKS - 1);
    const r = buildExchangeFlows(
      agg({ caps }),
      win({ from: day(0), to: day(10), interval: "day" }),
      {
        exchange: null,
      },
    );
    expect(r.data.totals.exchanges.gate).toBeNull();
    expect(r.data.counted).toEqual({ from: day(0), to: day(2) });
  });

  it("names unresolved transactions in the window", () => {
    const r = buildExchangeFlows(
      agg({ unresolved: new Map([[D, 2]]) }),
      win({ from: day(0), to: day(10), interval: "day" }),
      { exchange: null },
    );
    expect(r.coverage.status).toBe("partial");
    expect(r.coverage.notes.join(" ")).toContain("2 transaction(s)");
  });
});

describe("the routes", () => {
  const largest = async () => ({
    caps: agg().caps,
    rows: [
      {
        txid: "a".repeat(64),
        exchange: "binance",
        direction: "out" as const,
        zat: 600,
        height: 120,
        timestamp: D * DAY + 10,
        parts: [{ kind: "exchange", exchange: "kraken", zat: 400 }],
      },
    ],
  });
  const app = (load: () => Promise<LabelFlowAggregates | null>) =>
    v1ExchangeFlowsRoutes({ pool: {} as never, load, largest, now: () => (D + 6) * DAY * 1000 });

  it("answers the flows and echoes the query", async () => {
    const res = await app(async () => agg()).request(
      `${V1_EXCHANGE_FLOWS_PATH}?from=${day(0)}&to=${day(10)}&interval=day&exchange=binance`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query).toEqual({ from: day(0), to: day(10), interval: "day", exchange: "binance" });
    expect(Object.keys(body.data.totals.exchanges)).toEqual(["binance"]);
  });

  it("refuses an unknown parameter and an unknown exchange", async () => {
    const a = app(async () => agg());
    expect((await a.request(`${V1_EXCHANGE_FLOWS_PATH}?bogus=1`)).status).toBe(400);
    expect((await a.request(`${V1_EXCHANGE_FLOWS_PATH}?exchange=ftx`)).status).toBe(400);
  });

  it("answers 503 while the flows cannot be read, and asks again next time", async () => {
    let calls = 0;
    const a = app(async () => {
      calls += 1;
      return calls === 1 ? null : agg();
    });
    const first = await a.request(V1_EXCHANGE_FLOWS_PATH);
    expect(first.status).toBe(503);
    expect(first.headers.get("Retry-After")).toBe("60");
    expect((await a.request(V1_EXCHANGE_FLOWS_PATH)).status).toBe(200);
  });

  it("lists the largest movements with their parts, bounded", async () => {
    const a = app(async () => agg());
    const res = await a.request(`${V1_EXCHANGE_MOVEMENTS_PATH}?direction=out&limit=5`);
    const body = await res.json();
    expect(body.items[0]).toMatchObject({
      exchange: "binance",
      direction: "out",
      value: { zat: 600 },
      day: day(0),
      parts: [{ kind: "exchange", exchange: "kraken", value: { zat: 400 } }],
    });
    expect((await a.request(`${V1_EXCHANGE_MOVEMENTS_PATH}?limit=26`)).status).toBe(400);
    expect((await a.request(`${V1_EXCHANGE_MOVEMENTS_PATH}?direction=internal`)).status).toBe(400);
  });
});
