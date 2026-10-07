import { describe, expect, it } from "vitest";
import type { CrossChainTransfer } from "@/domain";
import {
  CROSSCHAIN_PROTOCOLS,
  addSides,
  bothSides,
  buildProtocolSummary,
  protocolWindowStart,
} from "@/domain";

const DAY = 86_400;
/** 2026-10-02 12:00 UTC. */
const NOW = Date.UTC(2026, 9, 2, 12) / 1_000;

let n = 0;
function swap(over: Partial<CrossChainTransfer>): CrossChainTransfer {
  n += 1;
  return {
    id: `t-${n}`,
    direction: "in",
    protocol: "near-intents",
    counterpartChain: "ETH",
    counterpartAsset: "ETH",
    counterpartAmount: 1,
    counterpartIsSynthetic: false,
    counterpartTxHash: null,
    counterpartAddress: null,
    zcashTxid: null,
    zcashAddress: null,
    zecAmountZat: 100_000_000,
    usdValueAtSwap: 400,
    counterpartUsdAtSwap: null,
    venueDepositAddress: null,
    status: "completed",
    timestamp: NOW - 60,
    ...over,
  };
}

describe("protocolWindowStart", () => {
  it("is N calendar days, today included, starting at a UTC midnight", () => {
    expect(protocolWindowStart(30, NOW)).toBe(Date.UTC(2026, 8, 3) / 1_000);
    expect(protocolWindowStart(1, NOW)).toBe(Date.UTC(2026, 9, 2) / 1_000);
    expect(protocolWindowStart(null, NOW)).toBeNull();
  });
});

describe("buildProtocolSummary", () => {
  const transfers = [
    swap({ protocol: "near-intents", zecAmountZat: 5e8, counterpartChain: "SOL" }),
    swap({ protocol: "near-intents", direction: "out", zecAmountZat: 2e8 }),
    // Outside a 30-day window, and NEAR Intents' largest swap all-time.
    swap({ protocol: "near-intents", zecAmountZat: 9e8, timestamp: NOW - 90 * DAY }),
    // Maya: active long ago only — idle in the window.
    swap({ protocol: "maya", zecAmountZat: 3e8, timestamp: NOW - 40 * DAY }),
    // A settlement leg: a protocol settling its own accounts, never a crossing.
    swap({
      protocol: "maya",
      counterpartAsset: "CACAO",
      counterpartChain: "MAYA",
      zecAmountZat: 7e8,
    }),
    // Priced by nobody, so the protocol's dollars must be a floor.
    swap({ protocol: "thorchain", usdValueAtSwap: null, zecAmountZat: 1e6 }),
  ];

  it("keeps every protocol, including one idle in the window", () => {
    const s = buildProtocolSummary(transfers, 30, NOW);
    expect(s.protocols.map((v) => v.protocol).sort()).toEqual([...CROSSCHAIN_PROTOCOLS].sort());
    const maya = s.protocols.find((v) => v.protocol === "maya")!;
    expect(maya.in.transfers + maya.out.transfers).toBe(0);
    expect(maya.largest).toBeNull();
  });

  it("dates a protocol by its ALL-TIME records, whatever the window", () => {
    const maya = buildProtocolSummary(transfers, 30, NOW).protocols.find(
      (v) => v.protocol === "maya",
    )!;
    expect(maya.firstSeenAt).toBe(NOW - 40 * DAY);
    expect(maya.lastSeenAt).toBe(NOW - 40 * DAY);
  });

  it("windows the figures and the largest swap", () => {
    const near = buildProtocolSummary(transfers, 30, NOW).protocols[0]!;
    expect(near.protocol).toBe("near-intents");
    expect(near.in.zecAmountZat + near.out.zecAmountZat).toBe(7e8);
    expect(near.largest).toMatchObject({ zecAmountZat: 5e8, counterpartChain: "SOL" });
    const allTime = buildProtocolSummary(transfers, null, NOW).protocols[0]!;
    expect(allTime.largest).toMatchObject({ zecAmountZat: 9e8 });
  });

  it("excludes settlement legs by asset", () => {
    const maya = buildProtocolSummary(transfers, null, NOW).protocols.find(
      (v) => v.protocol === "maya",
    )!;
    expect(maya.in.zecAmountZat).toBe(3e8);
  });

  it("leaves an unpriced swap out of the dollars and counts it as uncovered", () => {
    const thor = buildProtocolSummary(transfers, null, NOW).protocols.find(
      (v) => v.protocol === "thorchain",
    )!;
    expect(thor.in).toMatchObject({ transfers: 1, usdAtSwap: 0, usdCoveredTransfers: 0 });
  });

  it("orders protocols largest first by ZEC", () => {
    const order = buildProtocolSummary(transfers, null, NOW).protocols.map((v) => v.protocol);
    expect(order).toEqual(["near-intents", "maya", "thorchain"]);
  });
});

describe("addSides", () => {
  const a = { transfers: 2, zecAmountZat: 300, usdAtSwap: 4.5, usdCoveredTransfers: 1 };
  const b = { transfers: 1, zecAmountZat: 100, usdAtSwap: 0.5, usdCoveredTransfers: 1 };

  it("sums every field", () => {
    expect(addSides(a, b)).toEqual({
      transfers: 3,
      zecAmountZat: 400,
      usdAtSwap: 5,
      usdCoveredTransfers: 2,
    });
  });

  it("is what bothSides folds a volume's two directions with", () => {
    expect(bothSides({ in: a, out: b })).toEqual(addSides(a, b));
  });
});
