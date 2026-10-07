import { describe, expect, it } from "vitest";
import {
  snapshotIsComplete,
  snapshotShieldedZat,
  snapshotSharePct,
  type SocialSnapshot,
} from "../social";

const SNAPSHOT: SocialSnapshot = {
  readAtUnix: 1_788_000_000,
  readAtHeight: 3_464_661,
  parisDay: "2026-08-29",
  priceUsd: 804.63,
  priceChange24hPct: 4.2,
  pools: [
    { pool: "ironwood", balanceZat: 100_000_000 },
    { pool: "orchard", balanceZat: 200_000_000 },
    { pool: "sapling", balanceZat: 300_000_000 },
    { pool: "sprout", balanceZat: 400_000_000 },
  ],
  circulatingSupplyZat: 10_000_000_000,
  flow24h: { timestamp: 1_787_913_600, shieldedZat: 500_000_000, unshieldedZat: 400_000_000 },
  recentCloses: [
    { day: "2026-08-27", usd: 780.1 },
    { day: "2026-08-28", usd: 795.4 },
  ],
};

describe("snapshotShieldedZat", () => {
  it("sums every pool", () => {
    expect(snapshotShieldedZat(SNAPSHOT)).toBe(1_000_000_000);
  });
});

describe("snapshotSharePct", () => {
  it("is a share of circulating supply", () => {
    expect(snapshotSharePct(SNAPSHOT)).toBeCloseTo(10, 6);
  });

  it("is null rather than zero when there is nothing to divide by", () => {
    expect(snapshotSharePct({ ...SNAPSHOT, circulatingSupplyZat: 0 })).toBeNull();
  });
});

describe("snapshotIsComplete", () => {
  it("accepts a snapshot with every figure", () => {
    expect(snapshotIsComplete(SNAPSHOT)).toBe(true);
  });

  // Each of these is a figure the card prints. A missing one must stop the post,
  // never render as a blank, a zero or a redaction bar.
  it.each([
    ["price", { priceUsd: null }],
    ["24h change", { priceChange24hPct: null }],
    ["circulating supply", { circulatingSupplyZat: null }],
    ["flow", { flow24h: null }],
  ])("refuses a snapshot missing the %s", (_label, patch) => {
    expect(snapshotIsComplete({ ...SNAPSHOT, ...patch } as SocialSnapshot)).toBe(false);
  });

  it("refuses a snapshot missing any of the four pools", () => {
    expect(snapshotIsComplete({ ...SNAPSHOT, pools: SNAPSHOT.pools.slice(1) })).toBe(false);
  });

  it("refuses a sparkline too short to draw", () => {
    expect(snapshotIsComplete({ ...SNAPSHOT, recentCloses: [SNAPSHOT.recentCloses[0]!] })).toBe(
      false,
    );
  });

  // All four pools reading zero is a broken read (or testnet, which never posts), and
  // unguarded it would make the card's per-pool share a 0/0 NaN.
  it("refuses a snapshot whose shielded total is zero", () => {
    const allZero: SocialSnapshot = {
      ...SNAPSHOT,
      pools: SNAPSHOT.pools.map((p) => ({ ...p, balanceZat: 0 })),
    };
    expect(snapshotIsComplete(allZero)).toBe(false);
  });
});
