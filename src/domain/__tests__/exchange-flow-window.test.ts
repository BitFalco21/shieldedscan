import { describe, expect, it } from "vitest";
import {
  EXCHANGES,
  combineFlows,
  exchangeFlowInterval,
  exchangeFlowWindowStart,
  parseExchangeFlowWindow,
  parseExchangeParam,
  type ExchangeFlowTotal,
  type ExchangeId,
} from "@/domain";

const side = (zat: number, txs: number, parts: ExchangeFlowTotal["in"]["parts"]) => ({
  zat,
  txs,
  parts,
});
const empty: ExchangeFlowTotal = {
  in: side(0, 0, []),
  out: side(0, 0, []),
  internalTxs: 0,
  internalFeeZat: 0,
};
const totals = (over: Partial<Record<ExchangeId, ExchangeFlowTotal | null>>) =>
  Object.fromEntries(EXCHANGES.map((e) => [e, over[e] === undefined ? empty : over[e]])) as Record<
    ExchangeId,
    ExchangeFlowTotal | null
  >;

describe("combineFlows", () => {
  // Binance sends Kraken 400 (fee 10 paid by Binance); Kraken also takes 100 from a pool.
  const t = totals({
    binance: {
      in: side(1_000, 3, [{ kind: "transparent", exchange: null, zat: 1_000 }]),
      out: side(610, 1, [
        { kind: "transparent", exchange: null, zat: 200 },
        { kind: "exchange", exchange: "kraken", zat: 400 },
        { kind: "fee", exchange: null, zat: 10 },
      ]),
      internalTxs: 2,
      internalFeeZat: 7,
    },
    kraken: {
      in: side(500, 2, [
        { kind: "exchange", exchange: "binance", zat: 400 },
        { kind: "shielded", exchange: null, zat: 100 },
      ]),
      out: side(0, 0, []),
      internalTxs: 0,
      internalFeeZat: 0,
    },
  });

  it("leaves a move between two of the combined exchanges out, and states it apart", () => {
    const all = combineFlows(t, EXCHANGES)!;
    expect(all.in.zat).toBe(1_100);
    expect(all.out.zat).toBe(210);
    expect(all.betweenZat).toBe(400);
    expect(all.in.parts.map((p) => p.kind).sort()).toEqual(["shielded", "transparent"]);
    expect(all.internalFeeZat).toBe(7);
    // Each exchange's own change, summed: exact even where the move's two sides differ by a fee.
    expect(all.netZat).toBe(1_000 - 610 - 7 + 500);
  });

  it("keeps a move to an exchange outside the combination as an exchange part", () => {
    const one = combineFlows(t, ["binance"])!;
    expect(one.out.zat).toBe(610);
    expect(one.betweenZat).toBe(0);
    expect(one.out.parts).toContainEqual({ kind: "exchange", exchange: "kraken", zat: 400 });
  });

  it("states nothing when one of the exchanges is not counted", () => {
    expect(combineFlows(totals({ okx: null }), EXCHANGES)).toBeNull();
    expect(combineFlows(totals({ okx: null }), ["binance"])).not.toBeNull();
  });
});

describe("the window helpers", () => {
  it("reads a window and an exchange off a URL, defaulting to 30 days and every exchange", () => {
    expect(parseExchangeFlowWindow("90d")).toBe("90d");
    expect(parseExchangeFlowWindow("bogus")).toBe("30d");
    expect(parseExchangeFlowWindow(undefined)).toBe("30d");
    expect(parseExchangeParam("gate")).toBe("gate");
    expect(parseExchangeParam("ftx")).toBeNull();
  });

  it("starts a window on a whole UTC day, and draws days up to three months", () => {
    const now = Date.UTC(2026, 10, 27, 15) / 1000;
    expect(exchangeFlowWindowStart(30, now)).toBe(Date.UTC(2026, 9, 28) / 1000);
    expect(exchangeFlowWindowStart(null, now)).toBeNull();
    // Drawn by month: the first of the month a year back, so the first bar is a whole month.
    expect(exchangeFlowWindowStart(365, now)).toBe(Date.UTC(2025, 10, 1) / 1000);
    expect(exchangeFlowInterval(90)).toBe("day");
    expect(exchangeFlowInterval(365)).toBe("month");
    expect(exchangeFlowInterval(null)).toBe("month");
  });
});
