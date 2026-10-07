import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChainInfo, ChainMonthPoint, Fees24h } from "@/domain";
import { AnalyticsPage } from "../AnalyticsPage";

/**
 * The FEES 24H card. Under test is the claim, not the arithmetic (the sum happens in SQL). A
 * block's fee total is legitimately NULL when one of its inputs cannot be resolved, so the
 * card has three distinct things to say: a complete total, a floor with its denominator, and
 * "we could not measure this".
 */

const chain: ChainInfo = {
  height: 3_430_000,
  bestBlockHash: "00".repeat(32),
  lastBlockTimestamp: 1_785_000_000,
  circulatingSupplyZat: 1_600_000_000_000_000,
  priceUsd: null,
  priceChange24hPct: null,
  txCount24h: null,
  fullyShieldedPct24h: null,
};

const series: ChainMonthPoint[] = [
  {
    timestamp: 1_760_000_000,
    topHeight: 3_400_000,
    transparentTxs: 10,
    mixedTxs: 5,
    shieldedTxs: 5,
    sproutZat: 0,
    saplingZat: 0,
    orchardZat: 0,
    ironwoodZat: 0,
  },
];

const renderWith = (fees24h: Fees24h | null) =>
  render(
    <AnalyticsPage
      series={series}
      chain={chain}
      activity={null}
      fees24h={fees24h}
      flow={[]}
      feeDistribution={null}
      days={null}
      flowDays={null}
      feesDaily={null}
    />,
  );

/**
 * The FEES 24H card alone.
 *
 * Scoped deliberately: this fixture leaves the price and activity series null, so the
 * neighbouring cards legitimately say "unavailable" too, and an unscoped query matches three
 * elements. Asserting against the whole page would either fail on ambiguity or — worse —
 * pass because a DIFFERENT card said the right thing.
 */
function feesCard(): HTMLElement {
  const label = screen.getByText("FEES 24H");
  const card = label.closest("div")?.parentElement;
  if (!card) throw new Error("FEES 24H card structure changed");
  return card as HTMLElement;
}

describe("FEES 24H", () => {
  it("states a complete total without qualifying it", () => {
    renderWith({ zat: 4_600_000, blocksCovered: 1_150, blocksTotal: 1_150 });
    expect(screen.getByText("0.046 ZEC")).toBeDefined();
    expect(screen.getByText(/across 1K blocks/)).toBeDefined();
    // No hedge when there is nothing to hedge about.
    expect(document.body.textContent).not.toMatch(/at least/);
  });

  it("labels a partial total as a floor AND carries its denominator", () => {
    // A partial sum travels with the denominator that produced it, or it makes an unstated claim.
    renderWith({ zat: 4_600_000, blocksCovered: 900, blocksTotal: 1_150 });
    expect(screen.getByText(/at least/)).toBeDefined();
    expect(screen.getByText(/900 of 1K/)).toBeDefined();
  });

  it("says unavailable rather than zero when nothing could be measured", () => {
    // The distinction the whole card exists to preserve: a day with no fees and a day we
    // could not measure are different claims, and only one of them has ever been true.
    renderWith(null);
    const card = feesCard();
    expect(card.textContent).toMatch(/unavailable/i);
    expect(card.textContent).not.toMatch(/ZEC/);
  });

  it("never spends the Veil on an outage of ours", () => {
    // Redaction bars mean "encrypted on-chain, hidden by design", never a figure we failed to
    // read; that is why `Unmeasured` is a separate component.
    renderWith(null);
    expect(within(feesCard()).queryAllByLabelText(/value shielded/i)).toHaveLength(0);
  });
});
