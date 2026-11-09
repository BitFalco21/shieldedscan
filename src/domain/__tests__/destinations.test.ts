import { describe, expect, it } from "vitest";
import {
  destinationsByChain,
  destinationSwaps,
  foldDestinations,
  isShieldedCapableKind,
  shieldedCapableSharePct,
  type DestinationBucket,
} from "../destinations";

const b = (
  chain: string,
  kind: DestinationBucket["kind"],
  transfers: number,
): DestinationBucket => ({
  chain,
  kind,
  transfers,
  zat: transfers * 100_000_000,
});

describe("destinations by chain", () => {
  it("counts Sapling and unified as capable, transparent as not, and no address as neither", () => {
    expect(isShieldedCapableKind("unified")).toBe(true);
    expect(isShieldedCapableKind("sapling")).toBe(true);
    expect(isShieldedCapableKind("transparent")).toBe(false);
    expect(isShieldedCapableKind(null)).toBeNull();
    const [btc] = destinationsByChain([
      b("BTC", "unified", 6),
      b("BTC", "sapling", 2),
      b("BTC", "transparent", 12),
      b("BTC", null, 5),
    ]);
    expect(btc).toMatchObject({ chain: "BTC", capable: 8, transparent: 12, unknown: 5 });
    // The unpublished five are in neither term: 8 of 20, never 8 of 25.
    expect(shieldedCapableSharePct(btc!)).toBe(40);
    expect(destinationSwaps(btc!)).toBe(25);
  });

  it("has no share for a chain whose venues published no address, rather than 0%", () => {
    const [sol] = destinationsByChain([b("SOL", null, 3)]);
    expect(shieldedCapableSharePct(sol!)).toBeNull();
  });

  it("orders by swaps, ticker breaking ties", () => {
    const rows = destinationsByChain([
      b("ETH", "transparent", 4),
      b("BTC", "transparent", 9),
      b("SOL", "unified", 4),
    ]);
    expect(rows.map((r) => r.chain)).toEqual(["BTC", "ETH", "SOL"]);
  });

  it("folds the tail into one row that keeps every swap and says how many chains it holds", () => {
    const rows = destinationsByChain([
      b("A", "unified", 10),
      b("B", "unified", 9),
      b("C", "transparent", 3),
      b("D", null, 2),
      b("E", "sapling", 1),
    ]);
    const folded = foldDestinations(rows, 2, "OTHER");
    expect(folded.map((r) => r.chain)).toEqual(["A", "B", "OTHER"]);
    expect(folded[2]).toMatchObject({ chains: 3, capable: 1, transparent: 3, unknown: 2 });
    const all = (rs: typeof rows) => rs.reduce((s, r) => s + destinationSwaps(r), 0);
    expect(all(folded)).toBe(all(rows));
    // One chain past the cut is shown on its own, not as a fold of one.
    expect(foldDestinations(rows.slice(0, 3), 2, "OTHER").map((r) => r.chain)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});
