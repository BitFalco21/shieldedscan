import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FeeDistribution } from "@/domain";
import { shieldedVsTransparentPct } from "@/domain";
import { FeeCostPanel } from "../FeeCostPanel";

/**
 * Under test is the claim "privacy does not cost more on Zcash": every median travels with its
 * spread and sample size, an absent kind is absent rather than zero, and the comparison
 * sentence appears only when both sides exist.
 */

/** Real proportions measured from the chain. */
const REAL: FeeDistribution = {
  windowDays: 90,
  recent: [
    {
      kind: "transparent",
      medianZat: 20_000,
      avgZat: 31_000,
      p25Zat: 10_000,
      p75Zat: 42_400,
      txs: 297_454,
    },
    {
      kind: "mixed",
      medianZat: 15_000,
      avgZat: 19_000,
      p25Zat: 15_000,
      p75Zat: 25_000,
      txs: 102_321,
    },
    {
      kind: "shielded",
      medianZat: 10_000,
      avgZat: 14_000,
      p25Zat: 10_000,
      p75Zat: 20_000,
      txs: 30_374,
    },
  ],
  monthly: [
    { timestamp: 1_751_328_000, transparentZat: 25_000, mixedZat: 15_000, shieldedZat: 10_000 },
    { timestamp: 1_754_006_400, transparentZat: 20_000, mixedZat: null, shieldedZat: 10_000 },
  ],
};

describe("FeeCostPanel", () => {
  it("states the comparison with both of its sides present", () => {
    render(<FeeCostPanel feesDaily={null} distribution={REAL} priceUsd={null} />);
    expect(screen.getByText("50%")).toBeDefined();
    expect(document.body.textContent).toMatch(/not the expensive option/);
    // The mechanism, not just the number — otherwise it reads as a curiosity.
    expect(document.body.textContent).toMatch(/ZIP-317/);
  });

  it("carries the spread and the sample size with every median", () => {
    // A statistic without its denominator is a claim.
    render(<FeeCostPanel feesDaily={null} distribution={REAL} priceUsd={null} />);
    expect(document.body.textContent).toMatch(/297,454 transactions/);
    expect(document.body.textContent).toMatch(/30,374 transactions/);
    expect(document.body.textContent).toMatch(/half of these fees fall between/);
    expect(document.body.textContent).toMatch(/average/);
  });

  it("drops the comparison sentence when a side is missing, never fabricates one", () => {
    const noShielded: FeeDistribution = {
      ...REAL,
      recent: REAL.recent.filter((s) => s.kind !== "shielded"),
    };
    render(<FeeCostPanel feesDaily={null} distribution={noShielded} priceUsd={null} />);
    expect(document.body.textContent).not.toMatch(/not the expensive option/);
    expect(screen.getByText(/no transactions of this kind in the window/)).toBeDefined();
  });

  it("says unavailable when unreadable — never an empty chart", () => {
    render(<FeeCostPanel feesDaily={null} distribution={null} priceUsd={null} />);
    expect(screen.getByText(/unavailable/i)).toBeDefined();
    expect(document.body.textContent).toMatch(/Nothing is estimated in its place/);
    expect(document.querySelector("svg[role='img']")).toBeNull();
  });

  it("explains the gap rule beside the chart that uses it", () => {
    render(<FeeCostPanel feesDaily={null} distribution={REAL} priceUsd={null} />);
    expect(document.body.textContent).toMatch(/drawn as a gap, never as zero/);
  });
});

describe("shieldedVsTransparentPct", () => {
  it("computes the headline ratio from the real figures", () => {
    expect(shieldedVsTransparentPct(REAL)).toBe(50);
  });

  it("returns null rather than a ratio over an absent side", () => {
    const missing = { ...REAL, recent: REAL.recent.filter((s) => s.kind !== "transparent") };
    expect(shieldedVsTransparentPct(missing)).toBeNull();
  });

  it("returns null rather than dividing by a zero median", () => {
    const zero = {
      ...REAL,
      recent: REAL.recent.map((s) => (s.kind === "transparent" ? { ...s, medianZat: 0 } : s)),
    };
    expect(shieldedVsTransparentPct(zero)).toBeNull();
  });
});
