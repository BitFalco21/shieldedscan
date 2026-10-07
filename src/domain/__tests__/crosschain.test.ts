import { describe, expect, it } from "vitest";
import type { CrossChainFlow } from "../crosschain";
import {
  aggregateFlowWindows,
  flowRowsWithPrevious,
  flowTrend,
  protocolLabel,
  statusGlyph,
  statusLabel,
} from "../crosschain";

describe("cross-chain labels", () => {
  it("protocol display names", () => {
    expect(protocolLabel("thorchain")).toBe("THORChain");
    expect(protocolLabel("maya")).toBe("Maya Protocol");
    expect(protocolLabel("near-intents")).toBe("NEAR Intents");
  });
  it("status label + glyph", () => {
    expect(statusLabel("completed")).toBe("COMPLETED");
    expect(statusLabel("pending")).toBe("PENDING");
    expect(statusLabel("refunded")).toBe("REFUNDED");
    expect(statusGlyph("completed")).toBe("✓");
    expect(statusGlyph("pending")).toBe("◌");
    expect(statusGlyph("refunded")).toBe("↩");
  });
});

/**
 * The two-window aggregate, shared by the API's in-memory store and the fixtures. The key
 * rule: a previous window reaching back past our first record has no honest denominator.
 */
describe("aggregateFlowWindows", () => {
  const DAY = 86_400;
  const NOW = 1_800_000_000;
  const t = (chain: string, daysAgo: number, zat: number, direction: "in" | "out" = "out") => ({
    counterpartChain: chain,
    direction,
    zecAmountZat: zat,
    timestamp: NOW - daysAgo * DAY,
    // No published price: the ZEC still counts and the dollars stay a lower bound.
    usdValueAtSwap: null,
  });

  // 400 days of records, so a 30-day comparison is covered and a 1-year one is not.
  const rows = [
    t("ANCHOR", 400, 1),
    t("ETH", 10, 400),
    t("SOL", 20, 100),
    t("ETH", 40, 200),
    t("TRON", 45, 50),
  ];

  it("splits current from previous at the window boundary", () => {
    const s = aggregateFlowWindows(rows, 30, NOW);
    expect(s.flows.map((f) => f.chain).sort()).toEqual(["ETH", "SOL"]);
    expect(s.flows.find((f) => f.chain === "ETH")?.zecAmountZat).toBe(400);
    expect(s.previous.kind).toBe("flows");
    if (s.previous.kind !== "flows") throw new Error("unreachable");
    expect(s.previous.flows.map((f) => f.chain).sort()).toEqual(["ETH", "TRON"]);
    expect(s.previous.flows.find((f) => f.chain === "ETH")?.zecAmountZat).toBe(200);
  });

  it("reports firstAt/lastAt over the CURRENT window only", () => {
    const s = aggregateFlowWindows(rows, 30, NOW);
    expect(s.firstAt).toBe(NOW - 20 * DAY);
    expect(s.lastAt).toBe(NOW - 10 * DAY);
  });

  it("has no previous window under all-time", () => {
    const s = aggregateFlowWindows(rows, null, NOW);
    expect(s.previous).toEqual({ kind: "none" });
    expect(s.flows.map((f) => f.chain).sort()).toEqual(["ANCHOR", "ETH", "SOL", "TRON"]);
  });

  // A partly observed previous window would show spurious growth from when ingestion began.
  it("refuses a comparison whose previous window predates the records", () => {
    const s = aggregateFlowWindows(rows, 365, NOW);
    expect(s.previous).toEqual({ kind: "incomplete", recordsBeginAt: NOW - 400 * DAY });
  });

  it("allows it the moment the records reach far enough back", () => {
    // Exactly two windows of history is enough; one day less is not.
    expect(aggregateFlowWindows([t("A", 60, 1)], 30, NOW).previous.kind).toBe("flows");
    expect(aggregateFlowWindows([t("A", 59, 1)], 30, NOW).previous.kind).toBe("incomplete");
  });

  it("distinguishes an empty previous window from an absent one", () => {
    // Records reach back far enough, but nothing crossed in the previous window.
    const s = aggregateFlowWindows([t("A", 90, 1), t("B", 5, 10)], 30, NOW);
    expect(s.previous).toEqual({ kind: "flows", flows: [] });
  });

  it("has no records to compare against at all when it holds none", () => {
    expect(aggregateFlowWindows([], 30, NOW).previous).toEqual({
      kind: "incomplete",
      recordsBeginAt: 0,
    });
  });
});

describe("flowTrend", () => {
  it("is the percentage change when the previous window had volume", () => {
    expect(flowTrend(200, 100)).toEqual({ kind: "pct", pct: 100 });
    expect(flowTrend(50, 100)).toEqual({ kind: "pct", pct: -50 });
    expect(flowTrend(0, 100)).toEqual({ kind: "pct", pct: -100 });
    expect(flowTrend(100, 100)).toEqual({ kind: "pct", pct: 0 });
  });

  // A change from zero has no denominator, so it is never a percentage.
  it("names a chain new rather than dividing by zero", () => {
    expect(flowTrend(500, 0)).toEqual({ kind: "new" });
    expect(flowTrend(0, 0)).toEqual({ kind: "absent" });
  });
});

describe("flowRowsWithPrevious", () => {
  const flow = (
    chain: string,
    direction: "in" | "out",
    transfers: number,
    zecAmountZat: number,
  ): CrossChainFlow => ({
    chain,
    direction,
    transfers,
    zecAmountZat,
    usdAtSwap: 0,
    usdCoveredTransfers: 0,
  });
  const current = [flow("ETH", "out", 2, 400), flow("BTC", "in", 1, 900)];
  const previous = [flow("ETH", "out", 0, 200), flow("TRON", "out", 0, 50)];

  it("keeps one direction and pairs each chain with its previous volume", () => {
    const rows = flowRowsWithPrevious(current, previous, "out");
    expect(rows.find((r) => r.flow.chain === "ETH")?.previousZat).toBe(200);
    expect(rows.some((r) => r.flow.chain === "BTC")).toBe(false);
  });

  it("adds a zero row for a chain that stopped, so it is not silently dropped", () => {
    const rows = flowRowsWithPrevious(current, previous, "out");
    const tron = rows.find((r) => r.flow.chain === "TRON");
    expect(tron).toBeDefined();
    expect(tron?.flow.zecAmountZat).toBe(0);
    expect(tron?.flow.transfers).toBe(0);
    // Sorted by current volume, so a stopped chain lands at the bottom rather than the top.
    expect(rows.at(-1)?.flow.chain).toBe("TRON");
  });

  it("adds nothing when there is no previous window", () => {
    expect(flowRowsWithPrevious(current, [], "out").map((r) => r.flow.chain)).toEqual(["ETH"]);
  });
});
