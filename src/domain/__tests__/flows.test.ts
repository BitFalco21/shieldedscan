import { describe, expect, it } from "vitest";
import type { CrossChainFlow, CrossChainTransfer } from "../crosschain";
import { aggregateFlowWindows, flowTotalZat, foldFlows } from "../crosschain";

const zec = (n: number) => n * 100_000_000;

/**
 * A flow row with the USD terms defaulted, so the fold and total tests keep reading as
 * statements about ZEC. The USD terms have their own describe below.
 */
const flow = (row: Omit<CrossChainFlow, "usdAtSwap" | "usdCoveredTransfers">): CrossChainFlow => ({
  ...row,
  usdAtSwap: 0,
  usdCoveredTransfers: 0,
});

/**
 * Numbers from the live aggregation on 2026-07-28: a long tail two orders of magnitude below
 * the leaders, and two directions of comparable size.
 */
const flows: CrossChainFlow[] = [
  flow({ chain: "ETH", direction: "out", transfers: 21_184, zecAmountZat: zec(771_261) }),
  flow({ chain: "SOL", direction: "out", transfers: 19_322, zecAmountZat: zec(337_329) }),
  flow({ chain: "TRON", direction: "out", transfers: 8_820, zecAmountZat: zec(159_679) }),
  flow({ chain: "CARDANO", direction: "out", transfers: 138, zecAmountZat: zec(141) }),
  flow({ chain: "BTC", direction: "in", transfers: 7_065, zecAmountZat: zec(416_762) }),
  flow({ chain: "ETH", direction: "in", transfers: 12_061, zecAmountZat: zec(399_142) }),
  flow({ chain: "APTOS", direction: "in", transfers: 68, zecAmountZat: zec(20) }),
];

describe("flowTotalZat", () => {
  it("sums one direction only", () => {
    expect(flowTotalZat(flows, "out")).toBe(zec(771_261 + 337_329 + 159_679 + 141));
    expect(flowTotalZat(flows, "in")).toBe(zec(416_762 + 399_142 + 20));
  });

  it("is zero for a direction with no crossings", () => {
    expect(flowTotalZat([], "in")).toBe(0);
  });
});

describe("foldFlows", () => {
  it("ranks by volume and folds the tail rather than dropping it", () => {
    // The folded total must survive so the Sankey's ribbons still sum to the boundary.
    const folded = foldFlows(flows, "out", 2);
    expect(folded.top.map((f) => f.chain)).toEqual(["ETH", "SOL"]);
    expect(folded.otherZat).toBe(zec(159_679 + 141));
    expect(folded.otherChains).toBe(2);
    expect(folded.otherTransfers).toBe(8_820 + 138);

    const kept = folded.top.reduce((s, f) => s + f.zecAmountZat, 0);
    expect(kept + folded.otherZat).toBe(flowTotalZat(flows, "out"));
  });

  it("folds nothing when every chain fits", () => {
    const folded = foldFlows(flows, "in", 10);
    expect(folded.top).toHaveLength(3);
    expect(folded.otherZat).toBe(0);
    expect(folded.otherChains).toBe(0);
  });

  it("keeps the two directions separate", () => {
    expect(foldFlows(flows, "in", 10).top.every((f) => f.direction === "in")).toBe(true);
  });

  it("drops zero-volume rows, which would render as a phantom ribbon", () => {
    const withZero: CrossChainFlow[] = [
      ...flows,
      flow({ chain: "GNOSIS", direction: "out", transfers: 0, zecAmountZat: 0 }),
    ];
    expect(foldFlows(withZero, "out", 10).top.map((f) => f.chain)).not.toContain("GNOSIS");
  });
});

/**
 * The per-chain aggregation and its USD terms: the venues' own swap-time figures, summed.
 * An unpriced transfer contributes its ZEC and no dollars, and `usdCoveredTransfers` says how
 * many were priced.
 */
describe("aggregateFlowWindows, all-time", () => {
  /** All-time (`windowDays: null`) is independent of the clock; `now` is fixed regardless. */
  const allTime = (transfers: readonly CrossChainTransfer[]) =>
    aggregateFlowWindows(transfers, null, 1_800_000_000);

  const transfer = (over: Partial<CrossChainTransfer>): CrossChainTransfer => ({
    id: Math.random().toString(36).slice(2),
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
    timestamp: 1_770_000_000,
    status: "completed",
    ...over,
  });

  it("groups by chain and direction", () => {
    const summary = allTime([
      transfer({ counterpartChain: "BTC", direction: "in", zecAmountZat: zec(2) }),
      transfer({ counterpartChain: "BTC", direction: "in", zecAmountZat: zec(3) }),
      transfer({ counterpartChain: "BTC", direction: "out", zecAmountZat: zec(7) }),
      transfer({ counterpartChain: "ETH", direction: "in", zecAmountZat: zec(11) }),
    ]);
    const btcIn = summary.flows.find((f) => f.chain === "BTC" && f.direction === "in");
    expect(btcIn).toMatchObject({ transfers: 2, zecAmountZat: zec(5) });
    expect(summary.flows).toHaveLength(3);
  });

  it("sums the venues' swap-time USD and counts the transfers that published one", () => {
    const summary = allTime([
      transfer({ usdValueAtSwap: 200.5 }),
      transfer({ usdValueAtSwap: 99.5 }),
      transfer({ usdValueAtSwap: null }),
    ]);
    expect(summary.flows[0]).toMatchObject({
      transfers: 3,
      usdAtSwap: 300,
      usdCoveredTransfers: 2,
    });
  });

  it("reports zero dollars over zero covered transfers when no venue published a price", () => {
    // A covered count of 0 marks the dollars as unmeasured rather than "$0 crossed".
    const summary = allTime([transfer({ usdValueAtSwap: null })]);
    expect(summary.flows[0]).toMatchObject({ usdAtSwap: 0, usdCoveredTransfers: 0 });
  });

  it("bounds the window it counted", () => {
    const summary = allTime([
      transfer({ timestamp: 1_700_000_000 }),
      transfer({ timestamp: 1_780_000_000 }),
    ]);
    expect(summary.firstAt).toBe(1_700_000_000);
    expect(summary.lastAt).toBe(1_780_000_000);
  });

  it("has no window at all when there is nothing to count", () => {
    expect(allTime([])).toEqual({
      flows: [],
      firstAt: 0,
      lastAt: 0,
      windowDays: null,
      // No previous window at all, distinct from an empty previous window.
      previous: { kind: "none" },
    });
  });
});
