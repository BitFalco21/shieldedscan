import { describe, expect, it } from "vitest";
import { minerFeeShareZat } from "../consensus";
import { NU7_HEIGHT } from "../halving";
import { NSM_FEE_SHARE_PCT, nsmWindow, type NsmDay, type NsmOverview } from "../nsm";

const day = (d: string, over: Partial<NsmDay> = {}): NsmDay => ({
  day: d,
  blocks: 3_456,
  feeZat: 1_000_000,
  nsmZat: 600_000,
  issuedZat: 180_000_000_000,
  closeUsd: 500,
  partial: false,
  ...over,
});

const overview = (days: NsmDay[], activationDay: string | null = "2026-11-06"): NsmOverview => ({
  activationHeight: NU7_HEIGHT,
  activationDay,
  balance: { height: NU7_HEIGHT + 10_000, zat: 1_800_000, carriedInZat: null },
  days,
});

const THREE = [
  day("2026-11-06", { blocks: 3_000 }),
  day("2026-11-07"),
  day("2026-11-08", { blocks: 2_000, closeUsd: null, partial: true }),
];

describe("NSM_FEE_SHARE_PCT", () => {
  it("is ZIP 235's 60%, from the one fee-split formula", () => {
    expect(NSM_FEE_SHARE_PCT).toBe(60);
    expect(100 - minerFeeShareZat("mainnet", NU7_HEIGHT, 100)).toBe(NSM_FEE_SHARE_PCT);
  });
});

describe("nsmWindow", () => {
  it("sums a window that opens before NU7 from activation, and says so", () => {
    const w = nsmWindow(overview(THREE), "2026-10-10", "2026-11-08")!;
    expect(w.sinceActivation).toBe(true);
    expect(w.fromDay).toBe("2026-11-06");
    expect(w.blocks).toBe(8_456);
    expect(w.feeZat).toBe(3_000_000);
    expect(w.nsmZat).toBe(1_800_000);
    expect(w.minerZat).toBe(1_200_000);
  });

  it("sums only the window's days when it opens after activation", () => {
    const w = nsmWindow(overview(THREE), "2026-11-07", "2026-11-08")!;
    expect(w.sinceActivation).toBe(false);
    expect(w.nsmZat).toBe(1_200_000);
  });

  it("values closed days at their close and leaves today for the live price", () => {
    const w = nsmWindow(overview(THREE), "2026-10-10", "2026-11-08")!;
    expect(w.nsmUsd).toEqual({ closedUsd: 0.006 * 500 * 2, unpricedZat: 0, todayZat: 600_000 });
    expect(w.minerUsd.todayZat).toBe(400_000);
  });

  it("keeps a closed day with no close out of the USD sum, never at 0", () => {
    const days = [day("2026-11-06", { closeUsd: null }), day("2026-11-07")];
    const w = nsmWindow(overview(days), "2026-11-01", "2026-11-07")!;
    expect(w.nsmUsd).toEqual({ closedUsd: 3, unpricedZat: 600_000, todayZat: 0 });
  });

  it("is unknown, never a partial sum, when one day's fees are unknown", () => {
    const days = [day("2026-11-06"), day("2026-11-07", { feeZat: null, nsmZat: null })];
    const w = nsmWindow(overview(days), "2026-11-01", "2026-11-07")!;
    expect(w.feeZat).toBeNull();
    expect(w.nsmZat).toBeNull();
    expect(w.minerZat).toBeNull();
    // The day outside the unknown one still counts its blocks.
    expect(w.blocks).toBe(6_912);
  });

  it("is unknown when the series does not reach back to the first day summed", () => {
    // A trailing series that starts after the window does.
    const w = nsmWindow(overview([day("2026-11-07")]), "2026-11-01", "2026-11-07")!;
    expect(w.nsmZat).toBeNull();
  });

  it("is null for a window before activation, or before the index reaches it", () => {
    expect(nsmWindow(overview(THREE), "2026-10-01", "2026-11-05")).toBeNull();
    expect(nsmWindow(overview([], null), "2026-10-01", "2026-11-08")).toBeNull();
  });
});
