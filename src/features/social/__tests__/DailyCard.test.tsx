import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DailyCard } from "../DailyCard";
import type { SocialSnapshot } from "@/domain/social";

const SNAPSHOT: SocialSnapshot = {
  readAtUnix: 1_788_000_000,
  readAtHeight: 3_464_661,
  parisDay: "2026-08-29",
  priceUsd: 804.63,
  priceChange24hPct: 4.2,
  pools: [
    { pool: "ironwood", balanceZat: 100_000_000_000 },
    { pool: "orchard", balanceZat: 200_000_000_000 },
    { pool: "sapling", balanceZat: 300_000_000_000 },
    { pool: "sprout", balanceZat: 400_000_000_000 },
  ],
  circulatingSupplyZat: 10_000_000_000_000,
  flow24h: { timestamp: 1, shieldedZat: 981_700_000_000, unshieldedZat: 981_400_000_000 },
  recentCloses: Array.from({ length: 30 }, (_, i) => ({
    day: `2026-08-${String(i + 1).padStart(2, "0")}`,
    usd: 700 + i * 3,
  })),
};

describe("DailyCard", () => {
  it("states the price and the change", () => {
    render(<DailyCard snapshot={SNAPSHOT} />);
    expect(screen.getByText(/\$804\.63/)).toBeTruthy();
    expect(screen.getByText(/4\.2%/)).toBeTruthy();
  });

  // The sparkline caption follows the DATA rather than restating the query's own limit:
  // `snapshotIsComplete` requires only two closes, so a shorter range is legitimate and a
  // hardcoded "30 DAYS" over it would be a false caption.
  it("labels the sparkline range from the number of closes actually rendered, not a literal", () => {
    const shortHistory: SocialSnapshot = {
      ...SNAPSHOT,
      recentCloses: SNAPSHOT.recentCloses.slice(0, 5),
    };
    render(<DailyCard snapshot={shortHistory} />);
    expect(screen.getByText(/5 DAYS ·/)).toBeTruthy();
    expect(screen.queryByText(/30 DAYS/)).toBeNull();
  });

  it("names the denominator beside the share", () => {
    render(<DailyCard snapshot={SNAPSHOT} />);
    expect(screen.getByText(/circulating supply/i)).toBeTruthy();
  });

  it("stamps the height it was read at", () => {
    render(<DailyCard snapshot={SNAPSHOT} />);
    expect(screen.getByText(/3,464,661/)).toBeTruthy();
  });

  it("carries the domain, which is the only link a post has", () => {
    render(<DailyCard snapshot={SNAPSHOT} />);
    expect(screen.getByText(/shieldedscan\.xyz/)).toBeTruthy();
  });

  it("names all four pools", () => {
    render(<DailyCard snapshot={SNAPSHOT} />);
    for (const name of ["ironwood", "orchard", "sapling", "sprout"]) {
      expect(screen.getByText(new RegExp(name, "i"))).toBeTruthy();
    }
  });

  // A card is the one surface where a bad figure outlives its correction. `∞` is swept as
  // well as "Infinity": `toLocaleString` renders an infinite value as the glyph.
  it("renders no NaN, undefined, Infinity or ∞ anywhere", () => {
    const { container } = render(<DailyCard snapshot={SNAPSHOT} />);
    expect(container.innerHTML).not.toMatch(/NaN|undefined|Infinity|∞/);
  });

  // `snapshotIsComplete` gates a snapshot upstream, but this component is the last thing
  // between a bad row and a published image, so it refuses on its own: an empty sparkline
  // series would render an infinite range, and a missing pool would understate the total.
  it("throws rather than rendering a sparkline it cannot draw", () => {
    const incomplete: SocialSnapshot = { ...SNAPSHOT, recentCloses: [] };
    expect(() => render(<DailyCard snapshot={incomplete} />)).toThrow();
  });

  it("throws rather than rendering with a pool missing", () => {
    const incomplete: SocialSnapshot = { ...SNAPSHOT, pools: SNAPSHOT.pools.slice(1) };
    expect(() => render(<DailyCard snapshot={incomplete} />)).toThrow();
  });

  // Four present pools all reading zero would reach the per-pool share as 0/0 = NaN.
  it("throws rather than rendering a zero shielded total", () => {
    const allZero: SocialSnapshot = {
      ...SNAPSHOT,
      pools: SNAPSHOT.pools.map((p) => ({ ...p, balanceZat: 0 })),
    };
    expect(() => render(<DailyCard snapshot={allZero} />)).toThrow();
  });
});
