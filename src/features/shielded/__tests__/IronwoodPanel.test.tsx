import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { IronwoodInflow } from "@/domain";
import { freshShieldingPct, ironwoodResidualZat, migratedZat } from "@/domain";
import { IronwoodPanel } from "../IronwoodPanel";

/**
 * Under test is the claim, not the arithmetic. A meaningful share of Ironwood came from
 * transparent, so the panel must not frame itself as "the turnstile"; and its sources describe
 * the pool's current balance and add up to it, rather than gross deposits.
 */

/** Real proportions, in zatoshi, with terms that reconcile exactly as production's do. */
const REAL: IronwoodInflow = {
  activationHeight: 3_428_143,
  balanceZat: 82_549_219_872_690,
  netFromOrchardZat: 72_178_959_767_478,
  netFromSaplingZat: 5_084_935_615_582,
  netFromSproutZat: 0,
  netFromTransparentZat: 5_281_505_468_322,
  fromTransparentTxCount: 1_924,
  txCount: 5_180,
  minedZat: 4_003_691_308,
  feesPaidZat: 184_670_000,
  balance: [
    { timestamp: 1_785_247_620, ironwoodZat: 1_000_000_000 },
    { timestamp: 1_785_251_220, ironwoodZat: 82_549_219_872_690 },
  ],
};

describe("IronwoodPanel", () => {
  it("names fresh shielding as its own source, not as part of the migration", () => {
    render(<IronwoodPanel inflow={REAL} />);
    expect(screen.getByText(/Shielded from transparent/)).toBeDefined();
    expect(screen.getByText(/1,924 transactions/)).toBeDefined();
    // The distinction in words, so a reader cannot mistake one for the other.
    expect(document.body.textContent).toMatch(/New shielding, not a migration/);
  });

  it("does not call itself a turnstile", () => {
    // The heading a reader sees must not assert the thing that is only ~87% true. The word
    // may appear in the explanatory prose, but not as the panel's claim about itself.
    render(<IronwoodPanel inflow={REAL} />);
    expect(screen.getByText("WHAT IS FILLING IRONWOOD")).toBeDefined();
  });

  it("breaks down the balance, not gross deposits", () => {
    // The headline is the same quantity as the stat card above it, not gross receipts.
    render(<IronwoodPanel inflow={REAL} />);
    expect(screen.getByText(/IN THE POOL NOW/)).toBeDefined();
    expect(document.body.textContent).toMatch(/same figure as the Ironwood card above/i);
    expect(screen.queryByText(/RECEIVED SINCE ACTIVATION/)).toBeNull();
  });

  it("never says fees are burned — they go to a miner", () => {
    // Zcash destroys no supply: fees go to miners, and saying "burned" on a supply page would
    // be a false claim about the asset.
    render(<IronwoodPanel inflow={REAL} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/burn(ed|s|t)?\b(?!.*nothing)/i);
    expect(text).toMatch(/miner/i);
  });

  it("shows no unaccounted remainder when the terms reconcile", () => {
    render(<IronwoodPanel inflow={REAL} />);
    expect(document.body.textContent).not.toMatch(/unaccounted for/);
  });

  it("says so loudly when the terms stop adding up", () => {
    // The identity holding is a property of the data, not a guarantee. If a future source
    // appears and is not named, this must surface as a line on the page rather than being
    // absorbed into whichever term happens to be computed last.
    render(<IronwoodPanel inflow={{ ...REAL, netFromOrchardZat: 1 }} />);
    expect(document.body.textContent).toMatch(/unaccounted for/);
  });

  it("states the height it measures from, and never implies earlier history", () => {
    // The same rule the reorg page follows: a window that began days ago must say so, or a
    // chart with no stated start reads as all of history.
    render(<IronwoodPanel inflow={REAL} />);
    expect(screen.getByText("3,428,143")).toBeDefined();
    expect(document.body.textContent).toMatch(/did not exist before that/);
  });

  it("renders nothing at all before activation", () => {
    // Not an empty breakdown: that would assert the pool exists and has received nothing,
    // which is a claim rather than an absence of one.
    const { container } = render(<IronwoodPanel inflow={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("omits Sprout entirely while it is zero, rather than drawing an empty row", () => {
    render(<IronwoodPanel inflow={REAL} />);
    expect(screen.queryByText(/From Sprout/)).toBeNull();
  });

  it("shows Sprout the moment it is non-zero", () => {
    // The field exists separately precisely so this works without a code change. A zero
    // folded into a neighbour would have made this case unrepresentable.
    render(<IronwoodPanel inflow={{ ...REAL, netFromSproutZat: 100_000_000 }} />);
    expect(screen.getByText(/From Sprout/)).toBeDefined();
  });

  /*
   * A negative net is a real direction (Ironwood sent more back to Sprout than it received),
   * and `migratedZat` and the residual include it either way, so hiding it would leave the
   * visible rows not summing to the balance.
   */
  it("shows Sprout when it is NEGATIVE, so the visible rows still account for the balance", () => {
    const withOutflow: IronwoodInflow = {
      ...REAL,
      netFromSproutZat: -100_000_000,
      // Keep the identity exact, so a residual warning cannot be what makes this pass.
      balanceZat: REAL.balanceZat - 100_000_000,
    };
    expect(ironwoodResidualZat(withOutflow)).toBe(0);
    render(<IronwoodPanel inflow={withOutflow} />);
    expect(screen.getByText(/From Sprout/)).toBeDefined();
    expect(document.body.textContent).not.toMatch(/unaccounted for/);
  });

  it("gives a negative source a bar, so it cannot read as having contributed nothing", () => {
    // The magnitude is drawn, in the palette's `red`, so text and geometry agree on an outflow.
    const { container } = render(
      <IronwoodPanel inflow={{ ...REAL, netFromSproutZat: -100_000_000 }} />,
    );
    const red = container.querySelector("rect.text-red");
    expect(red, "a negative source must draw its magnitude").toBeTruthy();
    expect(Number(red?.getAttribute("width"))).toBeGreaterThan(0);
  });

  it("prints no percentage at all when there is no pool to be a share of", () => {
    // Not "0.0%" beside a real ZEC amount — the same refusal `freshShieldingPct` already
    // makes, for the same reason: 0% of nothing is not a measurement.
    render(<IronwoodPanel inflow={{ ...REAL, balanceZat: 0 }} />);
    expect(document.body.textContent).not.toMatch(/0\.0%/);
  });

  /*
   * A real but tiny source (the mined-coinbase term) must not print as "0.0%": that would
   * contradict the bar's 0.6 floor beside it.
   */
  it("never prints a real source as 0.0% of the pool", () => {
    // REAL's mined term is 40 ZEC of an 825,492 ZEC pool — 0.0049%, which `toFixed(1)` rounds
    // to "0.0". Asserted on the whole panel, so no row anywhere may claim a zero share.
    render(<IronwoodPanel inflow={REAL} />);
    expect(document.body.textContent).not.toMatch(/0\.0%/);
    expect(screen.getByText("<0.1%")).toBeDefined();
  });

  it("keeps a tiny outflow readable as an outflow, not as a tiny inflow", () => {
    // Sign survives the threshold. Without this, a Sprout term draining the pool would read
    // identically to one filling it, and the red bar would be the only thing disagreeing.
    render(<IronwoodPanel inflow={{ ...REAL, netFromSproutZat: -40_000_000 }} />);
    expect(screen.getByText(">-0.1%")).toBeDefined();
  });

  it("names mined coinbase as its own source, neither migration nor shielding", () => {
    // A ZIP-213 shielded coinbase mines newly issued ZEC straight into the pool; without it the
    // reconciliation does not close.
    render(<IronwoodPanel inflow={REAL} />);
    expect(screen.getByText(/Mined into the pool/)).toBeDefined();
    expect(document.body.textContent).toMatch(/Newly issued ZEC/);
  });
});

describe("the domain helpers behind it", () => {
  it("computes the fresh-shielding share against the balance", () => {
    expect(freshShieldingPct(REAL)).toBeCloseTo(6.4, 1);
  });

  it("counts every shielded source as migrated, including a future Sprout one", () => {
    // Deliberately not `balance − transparent`: that would silently absorb any NEW source
    // into "migration" the day one appears.
    expect(migratedZat(REAL)).toBe(REAL.netFromOrchardZat + REAL.netFromSaplingZat);
    const withSprout = { ...REAL, netFromSproutZat: 500 };
    expect(migratedZat(withSprout)).toBe(migratedZat(REAL) + 500);
  });

  it("reconciles the real figures to the zatoshi", () => {
    // The whole justification for netting rather than showing gross: the parts sum to the
    // whole exactly. These are the real chain figures at height 3,434,043.
    expect(ironwoodResidualZat(REAL)).toBe(0);
  });

  it("returns null rather than 0% when the pool is empty", () => {
    // "0% of nothing" is not a measurement.
    const empty: IronwoodInflow = { ...REAL, balanceZat: 0, netFromTransparentZat: 0 };
    expect(freshShieldingPct(empty)).toBeNull();
  });
});
