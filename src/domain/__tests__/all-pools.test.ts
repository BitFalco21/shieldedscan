import { describe, expect, it } from "vitest";
import {
  allPoolsSupply,
  nsmBalanceZat,
  shareOfIssuedPct,
  supplyBarSegments,
  SUPPLY_PART_IDS,
} from "../all-pools";
import { NU7 } from "../network-upgrade";
import { MAX_SUPPLY_ZAT, type SupplyBreakdown, type ValuePoolName } from "../pool";

const NU7_MAINNET = NU7.activationHeight.mainnet!;
const ZEC = 100_000_000;

/** Round figures close to the real chain's proportions. */
function breakdown(over: Partial<SupplyBreakdown> = {}): SupplyBreakdown {
  return {
    height: NU7_MAINNET - 1,
    nsmZat: 0,
    pools: [
      { pool: "transparent", balanceZat: 12_000_000 * ZEC },
      { pool: "ironwood", balanceZat: 4_000_000 * ZEC },
      { pool: "orchard", balanceZat: 400_000 * ZEC },
      { pool: "sapling", balanceZat: 500_000 * ZEC },
      { pool: "sprout", balanceZat: 20_000 * ZEC },
      { pool: "lockbox", balanceZat: 80_000 * ZEC },
    ],
    ...over,
  };
}

const without = (pool: ValuePoolName) => breakdown().pools.filter((p) => p.pool !== pool);

describe("nsmBalanceZat", () => {
  it("is the node's figure whenever it reports one", () => {
    expect(nsmBalanceZat(breakdown({ nsmZat: 42, height: NU7_MAINNET + 10 }), "mainnet")).toBe(42);
  });

  it("is exactly zero before NU7 when the node omits it: nothing can enter it yet", () => {
    expect(nsmBalanceZat(breakdown({ nsmZat: null, height: NU7_MAINNET - 1 }), "mainnet")).toBe(0);
  });

  it("is unknown from NU7 when the node omits it, never zero", () => {
    expect(nsmBalanceZat(breakdown({ nsmZat: null, height: NU7_MAINNET }), "mainnet")).toBeNull();
  });
});

describe("allPoolsSupply", () => {
  it("lists every part in display order and partitions the cap exactly", () => {
    const all = allPoolsSupply(breakdown({ nsmZat: 3 * ZEC, height: NU7_MAINNET }), "mainnet");
    expect(all.parts.map((p) => p.id)).toEqual([...SUPPLY_PART_IDS]);
    const sum = all.parts.reduce((s, p) => s + (p.zat as number), 0);
    expect(sum).toBe(MAX_SUPPLY_ZAT);
    expect(all.issuedZat).toBe(17_000_003 * ZEC);
    expect(all.unminedZat).toBe(MAX_SUPPLY_ZAT - 17_000_003 * ZEC);
  });

  it("counts the NSM as issued but not circulating", () => {
    const all = allPoolsSupply(breakdown({ nsmZat: 5 * ZEC, height: NU7_MAINNET }), "mainnet");
    // From NU7 Sprout and the lockbox are unspendable, and the NSM sits in no pool.
    expect(all.circulatingZat).toBe((12_000_000 + 4_000_000 + 400_000 + 500_000) * ZEC);
  });

  it("shares the headline's denominator: shielded over circulating", () => {
    const all = allPoolsSupply(breakdown(), "mainnet");
    const shielded = (4_000_000 + 400_000 + 500_000 + 20_000) * ZEC;
    const circulating = (12_000_000 + 4_000_000 + 400_000 + 500_000 + 20_000) * ZEC;
    expect(all.shieldedZat).toBe(shielded);
    expect(all.shieldedSharePct).toBeCloseTo((shielded / circulating) * 100, 10);
  });

  it("makes issued and unmined unknown, not smaller, when the NSM is unknown after NU7", () => {
    const all = allPoolsSupply(breakdown({ nsmZat: null, height: NU7_MAINNET + 1 }), "mainnet");
    expect(all.parts.find((p) => p.id === "nsm")?.zat).toBeNull();
    expect(all.issuedZat).toBeNull();
    expect(all.unminedZat).toBeNull();
    // Neither needs the NSM.
    expect(all.circulatingZat).not.toBeNull();
    expect(all.shieldedZat).not.toBeNull();
  });

  it("marks a pool the node did not report as unknown, never zero", () => {
    const all = allPoolsSupply(breakdown({ pools: without("sapling") }), "mainnet");
    expect(all.parts.find((p) => p.id === "sapling")?.zat).toBeNull();
    expect(all.issuedZat).toBeNull();
    expect(all.shieldedZat).toBeNull();
    expect(all.shieldedSharePct).toBeNull();
  });

  it("loses circulating and the share, but not the shielded total, without transparent", () => {
    const all = allPoolsSupply(breakdown({ pools: without("transparent") }), "mainnet");
    expect(all.circulatingZat).toBeNull();
    expect(all.shieldedSharePct).toBeNull();
    expect(all.shieldedZat).not.toBeNull();
  });

  it("does not need a pool that is unspendable to know circulating", () => {
    const all = allPoolsSupply(breakdown({ pools: without("lockbox") }), "mainnet");
    expect(all.circulatingZat).not.toBeNull();
    expect(all.issuedZat).toBeNull();
  });

  it("shows a pool this build does not know, and counts it as issued", () => {
    const pools = [...breakdown().pools, { pool: "future" as ValuePoolName, balanceZat: 7 * ZEC }];
    const all = allPoolsSupply(breakdown({ pools }), "mainnet");
    const unknown = all.parts.find((p) => p.id === null);
    expect(unknown).toMatchObject({ name: "future", zat: 7 * ZEC });
    expect(all.issuedZat).toBe(17_000_007 * ZEC);
    // Still before "still to mine", which closes the bar.
    expect(all.parts.at(-1)?.id).toBe("unmined");
  });

  it("leaves nothing to mine from an issued total above the cap: it is a misreading", () => {
    const pools = [
      { pool: "transparent" as const, balanceZat: MAX_SUPPLY_ZAT },
      ...without("transparent"),
    ];
    const all = allPoolsSupply(breakdown({ pools }), "mainnet");
    expect(all.unminedZat).toBeNull();
  });
});

describe("allPoolsSupply with a pool reported twice", () => {
  it("reads neither row, and no total that would have to pick one", () => {
    const pools = [...breakdown().pools, { pool: "sapling" as const, balanceZat: 1 }];
    const all = allPoolsSupply(breakdown({ pools }), "mainnet");
    expect(all.parts.find((p) => p.id === "sapling")?.zat).toBeNull();
    expect(all.parts.find((p) => p.id === "orchard")?.zat).toBe(400_000 * ZEC);
    expect(all.issuedZat).toBeNull();
    expect(all.circulatingZat).toBeNull();
    expect(all.shieldedZat).toBeNull();
    expect(supplyBarSegments(all)).toBeNull();
  });
});

describe("shareOfIssuedPct", () => {
  it("is null when either side is unknown or the whole is empty", () => {
    expect(shareOfIssuedPct(null, 10)).toBeNull();
    expect(shareOfIssuedPct(1, null)).toBeNull();
    expect(shareOfIssuedPct(1, 0)).toBeNull();
    expect(shareOfIssuedPct(0, 10)).toBe(0);
    expect(shareOfIssuedPct(5, 10)).toBe(50);
  });
});

describe("supplyBarSegments", () => {
  it("draws the whole cap when every part is known", () => {
    const segments = supplyBarSegments(allPoolsSupply(breakdown(), "mainnet"));
    expect(segments).not.toBeNull();
    expect(segments!.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 10);
  });

  it("draws nothing rather than a bar with a gap", () => {
    const all = allPoolsSupply(breakdown({ pools: without("orchard") }), "mainnet");
    expect(supplyBarSegments(all)).toBeNull();
  });
});
