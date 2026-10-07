import { describe, expect, it } from "vitest";
import type { PulseBlock, PulseEvent } from "@/domain";
import { PULSE_INDEXED_LATE_SECONDS } from "@/domain";
import {
  PULSE_COLLAPSE_EVENTS,
  anyIndexedLate,
  blocksDue,
  collapseBlockEvents,
  poolsAtSim,
  pulsePlacementSeconds,
  shouldCollapse,
  swapsDue,
} from "../pulse-scheduler";

const ZEC = 100_000_000;

function event(
  id: string,
  from: PulseEvent["legs"][number]["from"],
  to: PulseEvent["legs"][number]["to"],
  amountZat: number | null,
): PulseEvent {
  return {
    id,
    kind: "tx",
    shape: "path",
    at: 1_000,
    height: 10,
    blockHash: "h",
    legs: [{ from, to, amountZat }],
    subsidyZat: null,
  };
}

function block(
  height: number,
  timestamp: number,
  receivedAt: number | null,
  events: PulseEvent[] = [],
  extra: Partial<PulseBlock> = {},
): PulseBlock {
  return {
    pools: {
      height,
      hash: `hash-${height}`,
      prevHash: `hash-${height - 1}`,
      timestamp,
      receivedAt,
      pools: {
        transparent: height * ZEC,
        lockbox: 1 * ZEC,
        sprout: 1 * ZEC,
        sapling: 1 * ZEC,
        orchard: 1 * ZEC,
        ironwood: 1 * ZEC,
      },
    },
    events,
    eventCount: events.length,
    intervalSeconds: 75,
    ...extra,
  };
}

describe("pulsePlacementSeconds — one clock, and it says which", () => {
  it("places a block when OUR node stored it", () => {
    expect(pulsePlacementSeconds(block(1, 1_000, 1_003))).toBe(1_003);
  });

  it("falls back to header time when no arrival was recorded", () => {
    // A null arrival is our gap, not an instant one: there is nothing else to place it by.
    expect(pulsePlacementSeconds(block(1, 1_000, null))).toBe(1_000);
  });

  it("places an INDEXED-LATE block at header time, not at our backfill", () => {
    // A late-indexed block: our stamp then measures when we caught up, and a replay placed at it
    // would bunch an hour of chain history into the minute we stored it.
    const late = block(1, 1_000, 1_000 + PULSE_INDEXED_LATE_SECONDS + 5, [], {
      indexedLate: true,
    });
    expect(pulsePlacementSeconds(late)).toBe(1_000);
    expect(anyIndexedLate([late])).toBe(true);
    expect(anyIndexedLate([block(2, 1, 2)])).toBe(false);
  });
});

describe("blocksDue — what a replay clock has reached", () => {
  const blocks = [block(1, 100, 100), block(2, 200, 200), block(3, 300, 300)];

  it("fires oldest first, and only what the clock has passed", () => {
    expect(blocksDue(blocks, 250, new Set()).map((b) => b.pools.height)).toEqual([1, 2]);
  });

  it("never re-fires a block already drawn", () => {
    expect(
      blocksDue(blocks, 350, new Set(["hash-1", "hash-2"])).map((b) => b.pools.height),
    ).toEqual([3]);
  });

  it("is bounded per call, so a scrub across an hour cannot flood the stage", () => {
    const many = Array.from({ length: 40 }, (_, i) => block(i, i, i));
    expect(blocksDue(many, 1_000, new Set())).toHaveLength(6);
  });
});

describe("poolsAtSim — a balance and its height come from one row", () => {
  const blocks = [block(1, 100, 100), block(2, 200, 200), block(3, 300, 300)];

  it("reads the newest block at or before the clock", () => {
    expect(poolsAtSim(blocks, 250)!.height).toBe(2);
    expect(poolsAtSim(blocks, 300)!.height).toBe(3);
  });

  it("returns null before the first block rather than inventing a past", () => {
    expect(poolsAtSim(blocks, 50)).toBeNull();
  });
});

describe("collapsing a busy block", () => {
  it("collapses at ×600, and at 300 events whatever the speed", () => {
    expect(shouldCollapse(600, 4)).toBe(true);
    expect(shouldCollapse(1, PULSE_COLLAPSE_EVENTS)).toBe(true);
    expect(shouldCollapse(60, 299)).toBe(false);
  });

  it("collapses EVERY block at ×600, however small — so no per-movement veil is drawn there", () => {
    // This keeps the per-movement veil orbits away from the speed at which count marks merge: a
    // block with one shielded movement collapses at ×600 exactly as a block with a thousand
    // does, so `#spawnVeil` is unreachable from a replay at that speed.
    for (const eventCount of [0, 1, 2, 299]) {
      expect(shouldCollapse(600, eventCount), `${eventCount} events`).toBe(true);
    }
  });

  it("sums per edge and counts what the sum stands for", () => {
    const b = block(9, 900, 900, [
      event("a", "transparent", "orchard", 2 * ZEC),
      event("b", "transparent", "orchard", 3 * ZEC),
      event("c", "orchard", "transparent", 1 * ZEC),
    ]);
    const collapsed = collapseBlockEvents(b).edges;
    expect(collapsed).toHaveLength(2);
    const shielding = collapsed.find((e) => e.key === "transparent>orchard")!;
    expect(shielding.totalZat).toBe(5 * ZEC);
    expect(shielding.count).toBe(2);
    expect(shielding.height).toBe(10);
  });

  it("counts a leg with no published amount without letting it change the sum", () => {
    const b = block(9, 900, 900, [
      event("a", "transparent", "sprout", 4 * ZEC),
      event("b", "transparent", "sprout", null),
    ]);
    const [edge] = collapseBlockEvents(b).edges;
    expect(edge!.totalZat).toBe(4 * ZEC);
    expect(edge!.count).toBe(2);
  });

  it("COUNTS a hub instead of dropping it — its legs do not pair, so no edge can sum them", () => {
    // Dropped, a busy block would draw only the movements that happen to have an amount along
    // an edge, and a reader would see a busy block as a small one.
    const hub: PulseEvent = { ...event("hub", "transparent", "hub", 1 * ZEC), shape: "hub" };
    const collapsed = collapseBlockEvents(block(9, 900, 900, [hub]));
    expect(collapsed.edges).toEqual([]);
    expect(collapsed.hubs).toBe(1);
  });

  it("COUNTS a fully shielded movement per pool — it has no amount to sum, by design", () => {
    const veil = (id: string, pool: "orchard" | "sapling"): PulseEvent => ({
      ...event(id, pool, pool, null),
      shape: "veil",
    });
    const collapsed = collapseBlockEvents(
      block(9, 900, 900, [veil("a", "orchard"), veil("b", "orchard"), veil("c", "sapling")]),
    );
    expect(collapsed.edges).toEqual([]);
    expect(collapsed.veils).toEqual([
      { pool: "orchard", count: 2 },
      { pool: "sapling", count: 1 },
    ]);
    expect(collapsed.height).toBe(9);
  });
});

describe("swapsDue — a crossing runs on the VENUE's clock, not a block's", () => {
  const swap = (id: string, at: number): PulseEvent => ({
    id,
    kind: "swap",
    shape: "path",
    at,
    // A venue saying a crossing completed is not the chain saying which block carried it.
    height: null,
    blockHash: null,
    legs: [{ from: "chain:BTC", to: "transparent", amountZat: ZEC }],
    subsidyZat: null,
    counterpartChain: "BTC",
  });

  it("fires oldest first, and only what the clock has passed", () => {
    const swaps = [swap("a", 100), swap("b", 300), swap("c", 200)];
    expect(swapsDue(swaps, 250, new Set()).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("never re-fires one already drawn, and is bounded per call", () => {
    const swaps = Array.from({ length: 40 }, (_, i) => swap(`s${i}`, i));
    expect(swapsDue(swaps, 1_000, new Set(["s0"])).some((s) => s.id === "s0")).toBe(false);
    expect(swapsDue(swaps, 1_000, new Set())).toHaveLength(6);
  });
});
