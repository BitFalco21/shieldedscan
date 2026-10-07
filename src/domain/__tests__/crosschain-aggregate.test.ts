import { describe, expect, it } from "vitest";
import type { CrossChainTransfer } from "../crosschain";
import { aggregateCrossChain } from "../crosschain";

/**
 * The narrowed aggregate: one slice of the transfer table, totalled and broken down along one
 * axis. Key properties: the window is half-open so a month is counted exactly once, the two
 * directions are never netted, and an empty slice is a real zero rather than a failure.
 */

const zec = (n: number) => n * 100_000_000;
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const transfer = (over: Partial<CrossChainTransfer>): CrossChainTransfer => ({
  id: `t${Math.random().toString(36).slice(2)}`,
  direction: "in",
  protocol: "maya",
  counterpartChain: "BTC",
  counterpartAsset: "BTC",
  counterpartAmount: 0.01,
  counterpartTxHash: null,
  counterpartIsSynthetic: false,
  counterpartAddress: null,
  zcashTxid: null,
  zcashAddress: null,
  zecAmountZat: zec(1),
  usdValueAtSwap: null,
  counterpartUsdAtSwap: null,
  venueDepositAddress: null,
  timestamp: at("2026-07-15T00:00:00Z"),
  status: "completed",
  ...over,
});

describe("aggregateCrossChain", () => {
  it("totals both directions separately and never nets them", () => {
    const a = aggregateCrossChain(
      [
        transfer({ direction: "in", zecAmountZat: zec(10) }),
        transfer({ direction: "out", zecAmountZat: zec(4) }),
      ],
      {},
      "none",
    );
    expect(a.totals.in.zecAmountZat).toBe(zec(10));
    expect(a.totals.out.zecAmountZat).toBe(zec(4));
    expect(a.groups).toEqual([]);
  });

  it("sums the venues' swap-time USD with the coverage that keeps it a floor", () => {
    const a = aggregateCrossChain(
      [
        transfer({ usdValueAtSwap: 200.5 }),
        transfer({ usdValueAtSwap: 99.5 }),
        transfer({ usdValueAtSwap: null }),
      ],
      {},
      "none",
    );
    expect(a.totals.in.usdAtSwap).toBe(300);
    // Three transfers, two priced: the coverage count shows the dollar figure is a lower bound.
    expect(a.totals.in.transfers).toBe(3);
    expect(a.totals.in.usdCoveredTransfers).toBe(2);
  });

  describe("the window is half-open", () => {
    const july = {
      fromTimestamp: at("2026-07-01T00:00:00Z"),
      toTimestamp: at("2026-08-01T00:00:00Z"),
    };
    const rows = [
      transfer({ timestamp: at("2026-06-30T23:59:59Z"), zecAmountZat: zec(1) }),
      transfer({ timestamp: at("2026-07-01T00:00:00Z"), zecAmountZat: zec(2) }),
      transfer({ timestamp: at("2026-07-31T23:59:59Z"), zecAmountZat: zec(4) }),
      transfer({ timestamp: at("2026-08-01T00:00:00Z"), zecAmountZat: zec(8) }),
    ];

    it("includes its first instant and excludes its last, so a month is counted once", () => {
      const a = aggregateCrossChain(rows, july, "none");
      expect(a.totals.in.zecAmountZat).toBe(zec(2 + 4));
      expect(a.totals.in.transfers).toBe(2);
    });

    it("bounds what it actually counted, not what was asked for", () => {
      const a = aggregateCrossChain(rows, july, "none");
      expect(a.firstAt).toBe(at("2026-07-01T00:00:00Z"));
      expect(a.lastAt).toBe(at("2026-07-31T23:59:59Z"));
    });

    it("splits adjacent months without double-counting the boundary", () => {
      const a = aggregateCrossChain(rows, {}, "month");
      expect(a.groups.map((g) => g.key)).toEqual(["2026-06", "2026-07", "2026-08"]);
      expect(a.groups.map((g) => g.in.zecAmountZat)).toEqual([zec(1), zec(6), zec(8)]);
    });
  });

  it("groups by chain, largest first across both directions", () => {
    const a = aggregateCrossChain(
      [
        transfer({ counterpartChain: "BTC", direction: "in", zecAmountZat: zec(5) }),
        transfer({ counterpartChain: "BTC", direction: "out", zecAmountZat: zec(1) }),
        transfer({ counterpartChain: "ETH", direction: "out", zecAmountZat: zec(9) }),
      ],
      {},
      "chain",
    );
    expect(a.groups.map((g) => g.key)).toEqual(["ETH", "BTC"]);
    const btc = a.groups.find((g) => g.key === "BTC")!;
    expect(btc.in.zecAmountZat).toBe(zec(5));
    expect(btc.out.zecAmountZat).toBe(zec(1));
  });

  it("groups by venue", () => {
    const a = aggregateCrossChain(
      [
        transfer({ protocol: "maya", zecAmountZat: zec(3) }),
        transfer({ protocol: "near-intents", zecAmountZat: zec(7) }),
      ],
      {},
      "venue",
    );
    expect(a.groups.map((g) => g.key)).toEqual(["near-intents", "maya"]);
  });

  it("orders a time series chronologically, never by size", () => {
    // Time keys sort chronologically, not by volume.
    const a = aggregateCrossChain(
      [
        transfer({ timestamp: at("2026-05-02T00:00:00Z"), zecAmountZat: zec(100) }),
        transfer({ timestamp: at("2026-06-02T00:00:00Z"), zecAmountZat: zec(1) }),
        transfer({ timestamp: at("2026-07-02T00:00:00Z"), zecAmountZat: zec(50) }),
      ],
      {},
      "month",
    );
    expect(a.groups.map((g) => g.key)).toEqual(["2026-05", "2026-06", "2026-07"]);
  });

  it("groups by day in UTC", () => {
    const a = aggregateCrossChain([transfer({ timestamp: at("2026-07-15T23:30:00Z") })], {}, "day");
    expect(a.groups.map((g) => g.key)).toEqual(["2026-07-15"]);
  });

  it("combines a chain filter with a window", () => {
    const a = aggregateCrossChain(
      [
        transfer({ counterpartChain: "BTC", timestamp: at("2026-07-15T00:00:00Z") }),
        transfer({ counterpartChain: "ETH", timestamp: at("2026-07-15T00:00:00Z") }),
        transfer({ counterpartChain: "BTC", timestamp: at("2026-06-15T00:00:00Z") }),
      ],
      {
        sourceChains: ["BTC"],
        fromTimestamp: at("2026-07-01T00:00:00Z"),
        toTimestamp: at("2026-08-01T00:00:00Z"),
      },
      "none",
    );
    expect(a.totals.in.transfers).toBe(1);
  });

  it("returns a real zero for a slice that matched nothing", () => {
    // A narrowing that matched nothing is a measured zero, distinct from a failed read.
    const a = aggregateCrossChain([transfer({})], { sourceChains: ["DOGE"] }, "chain");
    expect(a.totals.in.transfers).toBe(0);
    expect(a.totals.out.transfers).toBe(0);
    expect(a.groups).toEqual([]);
    expect(a.firstAt).toBe(0);
    expect(a.lastAt).toBe(0);
  });

  it("echoes the narrowing it applied", () => {
    const filters = { sourceChains: ["BTC"], fromTimestamp: 1_780_000_000 };
    expect(aggregateCrossChain([], filters, "chain").applied).toEqual(filters);
  });
});
