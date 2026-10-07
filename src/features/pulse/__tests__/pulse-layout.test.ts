import { describe, expect, it } from "vitest";
import type { PulseBlockPools, PulseRibbonWindow } from "@/domain";
import {
  PULSE_FOLDED_KEY,
  edgeKindOf,
  legGeometry,
  pointOnEdge,
  pulseLayout,
} from "../pulse-layout";

const ZEC = 100_000_000;

const poolsAt = (overrides: Partial<PulseBlockPools["pools"]> = {}): PulseBlockPools => ({
  height: 3_472_090,
  hash: "a".repeat(64),
  prevHash: "b".repeat(64),
  timestamp: 1_756_000_000,
  receivedAt: 1_756_000_003,
  pools: {
    transparent: 11_990_724 * ZEC,
    lockbox: 61_067 * ZEC,
    sprout: 22_591 * ZEC,
    sapling: 521_147 * ZEC,
    orchard: 455_798 * ZEC,
    ironwood: 3_863_447 * ZEC,
    ...overrides,
  },
});

const ribbons = (
  edges: PulseRibbonWindow["edges"] = [
    { from: "transparent", to: "orchard", totalZat: 18_400_000 * ZEC, events: 10 },
    { from: "orchard", to: "transparent", totalZat: 15_900_000 * ZEC, events: 9 },
    { from: "sprout", to: "sapling", totalZat: 1 * ZEC, events: 1, vpubDerived: true },
    { from: "chain:ETH", to: "transparent", totalZat: 355_000 * ZEC, events: 4, floor: true },
  ],
): PulseRibbonWindow => ({
  window: { fromSeconds: 0, toSeconds: 1_756_000_001 },
  edges,
  unpaired: { hubZat: 0, hubTxs: 0, multiMigrationZat: 0, multiMigrationTxs: 0 },
});

const build = (
  stocks = poolsAt(),
  window: PulseRibbonWindow | null = ribbons(),
): ReturnType<typeof pulseLayout> =>
  pulseLayout({ stocks, ribbons: window, windowLabel: "all time" });

describe("pulseLayout — the picture is a measurement", () => {
  it("produces no NaN in any path, width or box side", () => {
    const layout = build();
    for (const edge of layout.edges) {
      expect(edge.d, edge.key).not.toMatch(/NaN|Infinity|undefined/);
      expect(Number.isFinite(edge.width)).toBe(true);
    }
    for (const box of layout.boxes) {
      expect(Number.isFinite(box.x) && Number.isFinite(box.y), box.key).toBe(true);
      expect(Number.isFinite(box.w) && Number.isFinite(box.h), box.key).toBe(true);
      expect(box.w).toBeGreaterThan(0);
    }
  });

  it("scales a box by AREA, so four times the balance is twice the side", () => {
    const layout = build();
    const transparent = layout.boxes.find((b) => b.key === "transparent")!;
    const ironwood = layout.boxes.find((b) => b.key === "ironwood")!;
    const ratio = (ironwood.w * ironwood.h) / (transparent.w * transparent.h);
    const balances = (3_863_447 * ZEC) / (11_990_724 * ZEC);
    expect(ratio).toBeCloseTo(balances, 4);
  });

  it("stacks the pools strongest first and puts their labels above the boxes", () => {
    const layout = build();
    const pools = layout.boxes.filter((b) => b.kind === "pool");
    expect(pools.map((p) => p.key)).toEqual(["ironwood", "orchard", "sapling", "sprout"]);
    // Sorted top to bottom by cryptographic strength, not by size: orchard holds less than
    // sapling here and still sits above it.
    expect(pools[0]!.y).toBeLessThan(pools[3]!.y);
  });

  it("draws an ABSENT balance as an outlined box, never at floor size", () => {
    const layout = build(poolsAt({ sprout: null }));
    const sprout = layout.boxes.find((b) => b.key === "sprout")!;
    expect(sprout.absent).toBe(true);
    expect(sprout.floored).toBe(false);
    expect(sprout.balanceZat).toBeNull();
  });

  it("flags a box drawn at minimum, so its title can state the true balance", () => {
    const layout = build(poolsAt({ sprout: 1 }));
    const sprout = layout.boxes.find((b) => b.key === "sprout")!;
    expect(sprout.floored).toBe(true);
    expect(sprout.w).toBe(14);
  });

  it("never lets a ribbon touch the box it points at", () => {
    // The reason the picture is not a Sankey: a node reads as conserving what passes through it,
    // and these boxes do not — a stock and a flow are two rulers. The gap stops the diagram
    // claiming a budget that balances.
    const distance = (
      p: { x: number; y: number },
      b: { x: number; y: number; w: number; h: number },
    ): number =>
      Math.hypot(
        Math.max(b.x - p.x, 0, p.x - (b.x + b.w)),
        Math.max(b.y - p.y, 0, p.y - (b.y + b.h)),
      );
    for (const window of [ribbons(), null]) {
      const layout = build(poolsAt(), window);
      for (const edge of layout.edges) {
        for (const end of [edge.p0, edge.p1]) {
          for (const box of layout.boxes) {
            expect(distance(end, box), `${edge.key} touches ${box.key}`).toBeGreaterThan(4);
          }
        }
      }
    }
  });

  it("prints two rulers, and the box ruler names the height it was read at", () => {
    const layout = build();
    expect(layout.boxRuler).toMatch(/per 10 px²/);
    expect(layout.boxRuler).toContain("at block 3,472,090");
    expect(layout.ribbonRuler).toMatch(/per 3 px · all time · completed only/);
  });

  it("floors every ribbon and says the totals are unavailable when there are none", () => {
    const layout = build(poolsAt(), null);
    expect(layout.ribbonsAvailable).toBe(false);
    expect(layout.edges.length).toBeGreaterThan(0);
    for (const edge of layout.edges) {
      expect(edge.floored).toBe(true);
      expect(edge.width).toBe(1.25);
      // Null, never 0: the totals were not read, which is a different claim from "nothing
      // crossed" and must not be printed as one.
      expect(edge.totalZat).toBeNull();
    }
    expect(layout.ribbonRuler).toContain("unavailable");
  });

  it("carries the venue floor and the vpub caveat onto the ribbons that earn them", () => {
    const layout = build();
    const venue = layout.edges.find((e) => e.key.startsWith("chain:ETH"))!;
    expect(venue.venueFloor).toBe(true);
    const sprout = layout.edges.find((e) => e.from === "sprout")!;
    expect(sprout.vpubDerived).toBe(true);
  });

  it("folds the chain tail into a node that is not a chain", () => {
    const many = ["ETH", "SOL", "BTC", "TRON", "NEAR", "XRP", "DOGE"].map((t, i) => ({
      from: `chain:${t}` as const,
      to: "transparent" as const,
      totalZat: (100 - i) * ZEC,
      events: 1,
      floor: true as const,
    }));
    const layout = build(poolsAt(), ribbons(many));
    const folded = layout.chains.find((c) => c.folded)!;
    expect(folded.key).toBe(PULSE_FOLDED_KEY);
    expect(folded.node).toBeNull();
    expect(folded.foldedCount).toBe(2);
    expect(folded.label).toBe("+2");
    // Never a slot colour: colouring the tail would invite the comparison the fold refuses.
    expect(folded.colorClass).not.toMatch(/^flow-/);
  });

  it("names an edge's kind from its ends alone", () => {
    expect(edgeKindOf("mined", "transparent")).toBe("subsidy");
    expect(edgeKindOf("transparent", "orchard")).toBe("shielding");
    expect(edgeKindOf("orchard", "transparent")).toBe("unshielding");
    expect(edgeKindOf("sapling", "orchard")).toBe("migration");
    expect(edgeKindOf("chain:BTC", "transparent")).toBe("swap-in");
    expect(edgeKindOf("transparent", "chain:BTC")).toBe("swap-out");
    expect(edgeKindOf("chain:BTC", "hub")).toBe("swap-in");
    expect(edgeKindOf("transparent", "hub")).toBe("hub");
  });

  it("gives a leg with no ribbon somewhere to travel", () => {
    const layout = build();
    // No `mined → ironwood` ribbon in this window, and a ZIP-213 coinbase still has to go
    // somewhere: a pulse and a ribbon measure different things.
    const geometry = legGeometry(layout, "mined", "ironwood");
    expect(geometry).not.toBeNull();
    expect(geometry!.d).not.toMatch(/NaN/);
    const start = pointOnEdge(geometry!, 0);
    const end = pointOnEdge(geometry!, 1);
    expect(start).toEqual(geometry!.p0);
    expect(end).toEqual(geometry!.p1);
  });

  it("places a point on the curve monotonically along it", () => {
    const layout = build();
    const edge = layout.edges[0]!;
    const at = [0, 0.25, 0.5, 0.75, 1].map((t) => pointOnEdge(edge, t));
    for (const p of at) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    expect(at[0]).toEqual(edge.p0);
    expect(at[4]).toEqual(edge.p1);
  });

  it("refuses to print a height beside balances that were not measured there", () => {
    // A replay whose hour has not loaded. Printing the tip's height beside a past instant is
    // the same lie as printing the tip's balances, so the ruler says what it does not know.
    const layout = pulseLayout({
      stocks: poolsAt(),
      ribbons: ribbons(),
      windowLabel: "all time",
      measured: false,
    });
    expect(layout.boxRuler).toBe("balances at this instant have not been read");
    expect(layout.boxRuler).not.toContain("3,472,090");
  });

  it("still draws every box when no balance can be read at all", () => {
    const layout = build(
      poolsAt({
        transparent: null,
        lockbox: null,
        sprout: null,
        sapling: null,
        orchard: null,
        ironwood: null,
      }),
    );
    expect(layout.boxes.every((b) => Number.isFinite(b.w) && b.w > 0)).toBe(true);
    expect(layout.boxes.filter((b) => b.kind === "pool").every((b) => b.absent)).toBe(true);
  });
});

/**
 * The ribbon cap, and its rule: a slice is never silent.
 *
 * The reachable count is roughly fifty — twelve boundary edges, twelve pool-to-pool migrations,
 * up to twenty-four crossings across the drawn chains and the folded tail, and the two mined
 * edges — so the cap sits above that. `/pulse` has no evidence table beneath the diagram, unlike
 * `/cross-chain/flows`, so the only honest alternative to drawing a ribbon is counting it.
 */
describe("pulseLayout — a dropped ribbon is counted, never silent", () => {
  /**
   * Ordered pairs over every node the picture can place, minus the ones it has no geometry
   * for. Built rather than typed out so the fixture cannot quietly stop reaching the cap when
   * a node is added, and chain-to-chain is excluded because `geometryFor` refuses it — a
   * ribbon between two counterpart chains never touched Zcash.
   */
  const drawableEdges = (count: number): PulseRibbonWindow["edges"] => {
    const boxes = ["transparent", "lockbox", "mined", "ironwood", "orchard", "sapling", "sprout"];
    // Exactly CHAINS_DRAWN of them, so none folds into the tail and merges with another's edge.
    const chains = ["chain:ETH", "chain:BTC", "chain:SOL", "chain:NEAR", "chain:XRP"];
    const nodes = [...boxes, ...chains, "hub"];
    const pairs: { from: string; to: string }[] = [];
    for (const from of nodes) {
      for (const to of nodes) {
        if (from === to) continue;
        if (from.startsWith("chain:") && to.startsWith("chain:")) continue;
        pairs.push({ from, to });
      }
    }
    expect(pairs.length, "not enough distinct pairs to reach the cap").toBeGreaterThanOrEqual(
      count,
    );
    return pairs.slice(0, count).map(({ from, to }, i) => ({
      from: from as PulseRibbonWindow["edges"][number]["from"],
      to: to as PulseRibbonWindow["edges"][number]["to"],
      // Descending, so the slice a cap would take is deterministic rather than tie-ordered.
      totalZat: (count - i) * ZEC,
      events: 1,
    }));
  };

  it("draws all sixty of sixty, because the cap sits above what a frame can reach", () => {
    const layout = build(poolsAt(), ribbons(drawableEdges(60)));
    expect(layout.edges).toHaveLength(60);
    // Nothing to report, so the ruler says nothing about a slice.
    expect(layout.ribbonRuler).not.toMatch(/drawn/);
  });

  it("prints how many of how many it drew when the cap does bite", () => {
    const total = 90;
    const layout = build(poolsAt(), ribbons(drawableEdges(total)));
    expect(layout.edges.length).toBeLessThan(total);
    // The count is the fact and the ribbons are a window onto it.
    expect(layout.ribbonRuler).toContain(`${layout.edges.length} of ${total} drawn`);
  });
});
