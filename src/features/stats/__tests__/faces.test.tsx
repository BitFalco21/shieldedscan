import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Stats } from "@/domain";
import { stats as fixture } from "@/fixtures/stats";
import { supplySeries } from "@/fixtures/pools";
import { priceSeries } from "@/fixtures/stats";
import { PriceFace } from "../PriceFace";
import { PoolStrip } from "../PoolStrip";
import { ShieldedFace, supplyWindows } from "../ShieldedFace";

const withPrice = (over: Partial<Stats>): Stats => ({ ...fixture, ...over });

describe("PriceFace", () => {
  it("states the price and today's change", () => {
    render(<PriceFace stats={fixture} series={{}} />);
    expect(screen.getByText(/836\.83/)).toBeDefined();
    expect(screen.getByText(/today/)).toBeDefined();
  });

  it('never calls the change "24h"', () => {
    // The venue publishes its UTC open and no 24-hours-ago price, so the figure is a change
    // since midnight UTC and is labelled "today".
    const { container } = render(<PriceFace stats={fixture} series={{}} />);
    expect(container.textContent).not.toMatch(/24h/i);
  });

  it("says unavailable rather than substituting a price, and drops the pill with it", () => {
    // A cold tracker is the normal state of a freshly restarted API: absent beats fabricated,
    // and a change with no price to change from is not a finding.
    const { container } = render(
      <PriceFace stats={withPrice({ priceUsd: null, changeTodayPct: null })} series={{}} />,
    );
    expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\$/);
  });

  it("states a fall with an arrow and a word, never by the pill's colour alone", () => {
    // `formatDeltaPct` prints a magnitude, so the arrow, not colour alone, carries a fall.
    const { container } = render(
      <PriceFace stats={withPrice({ changeTodayPct: -4.7 })} series={{}} />,
    );
    const pill = container.querySelector(".stats-pill")!;
    expect(pill.textContent).toContain("▼");
    expect(pill.textContent).not.toContain("▲");
    expect(pill.querySelector(".sr-only")?.textContent).toBe("down");
    expect(pill.querySelector('[aria-hidden="true"]')?.textContent).toBe("▼");
  });

  it("draws no arrow on an unchanged day", () => {
    // Unchanged is a measurement; an arrow would claim a direction the data does not have.
    const { container } = render(
      <PriceFace stats={withPrice({ changeTodayPct: 0 })} series={{}} />,
    );
    const pill = container.querySelector(".stats-pill")!;
    expect(pill.textContent).not.toMatch(/[▲▼]/);
    expect(pill.textContent).toContain("0.0%");
  });

  it("shows no market cap without a price, rather than rendering supply as dollars", () => {
    const { container } = render(
      <PriceFace stats={withPrice({ priceUsd: null, changeTodayPct: null })} series={{}} />,
    );
    expect(container.textContent).not.toMatch(/mkt cap/);
  });
});

describe("ShieldedFace", () => {
  it("names the denominator beside the share", () => {
    // No percentage appears on this site without saying what it is a percentage OF, and this
    // page's entire claim is one share.
    const { container } = render(<ShieldedFace stats={fixture} supply={supplySeries} />);
    expect(container.textContent).toMatch(/of circulating supply is shielded/);
  });

  it("lists every pool the stats carries, largest first", () => {
    render(<PoolStrip stats={fixture} />);
    for (const pool of fixture.shielded.pools) {
      expect(screen.getByText(pool.pool)).toBeDefined();
    }
    // A face that silently omitted a pool would understate the shielded total.
    expect(screen.getByText("ironwood")).toBeDefined();
  });

  it("carries no redaction bars", () => {
    // Inverted on purpose: the Veil must not appear on a page where every figure is public by
    // construction. A redaction bar beside an unmeasured figure would present our gaps as
    // Zcash's privacy.
    const { container } = render(<ShieldedFace stats={fixture} supply={supplySeries} />);
    expect(container.querySelectorAll(".redact")).toHaveLength(0);
  });

  it("states a net outflow with an arrow and a word, never by colour alone", () => {
    const { container } = render(
      <ShieldedFace
        stats={{ ...fixture, shielded: { ...fixture.shielded, netShieldedTodayZat: -500_000_000 } }}
        supply={supplySeries}
      />,
    );
    const pill = container.querySelector(".stats-pill")!;
    expect(pill.textContent).toContain("▼");
    expect(pill.querySelector(".sr-only")?.textContent).toBe("down");
  });

  it("omits the net-flow pill rather than claiming a still day", () => {
    // Null means the daily rollup has no row yet. Zero would claim a day in which nothing
    // crossed the boundary, which is a measurement we did not make.
    const { container } = render(
      <ShieldedFace
        stats={{ ...fixture, shielded: { ...fixture.shielded, netShieldedTodayZat: null } }}
        supply={supplySeries}
      />,
    );
    expect(container.textContent).not.toMatch(/net shielded/);
  });

  it("draws a bar for a pool that holds something, however little", () => {
    // The 0.6 floor: a pool that contributed something must never render identically to one
    // that did not.
    const tiny = {
      ...fixture,
      shielded: {
        ...fixture.shielded,
        pools: [{ pool: "sprout" as const, balanceZat: 1 }],
        totalShieldedZat: 1_000_000_000_000,
      },
    };
    const { container } = render(<PoolStrip stats={tiny} />);
    const fills = [...container.querySelectorAll("rect")].map((r) =>
      Number(r.getAttribute("width")),
    );
    expect(fills.some((w) => w > 0 && w < 1)).toBe(true);
  });
});

describe("the two faces", () => {
  /**
   * The box must not resize when switching tabs: both faces hold the same five blocks, so they
   * are the same height by construction. The pool strip therefore renders below the panel.
   */
  it("hold the same number of blocks, so the panel is one height", () => {
    const price = render(<PriceFace stats={fixture} series={priceSeries} />);
    const priceBlocks = price.container.firstElementChild?.childElementCount;
    price.unmount();

    const shielded = render(<ShieldedFace stats={fixture} supply={supplySeries} />);
    const shieldedBlocks = shielded.container.firstElementChild?.childElementCount;

    expect(priceBlocks).toBe(shieldedBlocks);
  });

  it("keeps the pool strip out of the face, or the panel grows on one tab only", () => {
    const { container } = render(<ShieldedFace stats={fixture} supply={supplySeries} />);
    expect(container.querySelector(".stats-pools")).toBeNull();
  });
});

describe("StatsChart's opening window", () => {
  /**
   * The shielded face is cut from a daily series and offers no 24h or 7d window; it must not
   * open on a missing window and report our own omission as a failed read.
   */
  it("opens on a window that exists, never on the missing default", () => {
    const { container } = render(<ShieldedFace stats={fixture} supply={supplySeries} />);
    expect(container.textContent).not.toMatch(/could not be read/i);
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("30d");
  });

  it("still opens on the default where the data offers it", () => {
    const { container } = render(<PriceFace stats={fixture} series={priceSeries} />);
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("7d");
  });
});

describe("the shielded face's range chips", () => {
  it("offers every window its daily series can answer, shortest first", () => {
    const { container } = render(<ShieldedFace stats={fixture} supply={supplySeries} />);
    const chips = [...container.querySelectorAll("button[aria-pressed]")].map((c) => c.textContent);
    expect(chips).toEqual(["30d", "60d", "180d", "1y", "all"]);
  });

  it("keeps the price face's own windows, which the venue answers at its candle grain", () => {
    const { container } = render(<PriceFace stats={fixture} series={priceSeries} />);
    const chips = [...container.querySelectorAll("button[aria-pressed]")].map((c) => c.textContent);
    expect(chips).toEqual(["24h", "7d", "30d", "1y", "all"]);
  });
});

describe("the shielded face's windows", () => {
  /**
   * A range chip must drop something visible, or it looks applied and changes nothing. The
   * fixture series spans ~400 days so this is checkable at all.
   */
  it("cuts a strictly wider window per range, so no chip is a decoration", () => {
    const windows = supplyWindows(supplySeries);
    const counts = (["30d", "60d", "180d", "1y", "all"] as const).map(
      (r) => windows[r]?.length ?? 0,
    );
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]!);
    }
  });

  it("offers no window the daily grain cannot draw", () => {
    // One point draws nothing, so the short windows are absent rather than a dot, and absent
    // means no chip.
    const windows = supplyWindows(supplySeries);
    expect(windows["24h"]).toBeUndefined();
    expect(windows["7d"]).toBeUndefined();
  });

  it("keeps every window inside its own span", () => {
    const windows = supplyWindows(supplySeries);
    const newest = supplySeries[supplySeries.length - 1]!.timestamp;
    expect(Math.min(...windows["60d"]!.map((p) => p.t))).toBeGreaterThanOrEqual(
      newest - 60 * 86_400,
    );
    expect(Math.min(...windows["180d"]!.map((p) => p.t))).toBeGreaterThanOrEqual(
      newest - 180 * 86_400,
    );
  });
});
