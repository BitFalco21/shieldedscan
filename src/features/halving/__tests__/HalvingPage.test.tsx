import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HalvingSchedule } from "@/domain";
import { FUNDING_EXPIRY_BEFORE_NU61, subsidyTail } from "@/domain";
import { getHalvingSchedule } from "@/fixtures/halving";
import { HalvingPage } from "../HalvingPage";

/**
 * The halving page.
 *
 * The tests worth having here are the ones about what the page CLAIMS, not about its layout:
 * a countdown page is easy to make look right and easy to make say something false. Three
 * things must hold — the miner's fall is not a halving, Blossom is not a halving, and every
 * date is presented as an estimate while every height is not.
 */

const schedule = getHalvingSchedule();
const NOW = 1_786_540_000;

const renderAt = (over: Partial<HalvingSchedule> = {}, dailyUsd: Record<string, number> = {}) =>
  render(<HalvingPage schedule={{ ...schedule, ...over }} dailyUsd={dailyUsd} now={NOW} />);

describe("the hero", () => {
  it("names the block it counts to and the block it was read at", () => {
    // A bare clock says nothing checkable. Both heights are exact and both are printed.
    const { container } = renderAt();
    const hero = container.querySelector("section[aria-label]")!;

    expect(hero.textContent).toContain("4,406,400");
    expect(hero.textContent).toContain("3,445,362");
    expect(hero.textContent).toContain("961,038");
  });

  it("renders a usable countdown before any client JavaScript runs", () => {
    // The server paint specifically: Testing Library's `render` runs effects and would show the
    // ticking value. `HalvingCountdown` starts at null, so this is the markup that ships.
    const html = renderToStaticMarkup(<HalvingPage schedule={schedule} dailyUsd={{}} now={NOW} />);

    expect(html).toMatch(/\d+ years?, \d+ days?/);
  });

  it("gives the estimated date in both forms", () => {
    // The ISO date is unambiguous and sorts; the spelled-out one is what a reader pictures.
    // Both, because on a page about a moment years out the ISO form alone is a string to
    // parse rather than a date.
    const { container } = renderAt();
    const hero = container.querySelector("section[aria-label]")!;

    expect(hero.textContent).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(hero.textContent).toMatch(/\d{1,2} [A-Z][a-z]+ \d{4}/);
  });

  it("says the estimate came from the MEASURED block time, with the figure", () => {
    const { container } = renderAt();
    const hero = container.querySelector("section[aria-label]")!;

    expect(hero.textContent).toContain("75.35");
    expect(hero.textContent).toMatch(/measured over the last 30 days/);
  });

  it("names the event the clock counts to, so the panel stands alone", () => {
    // A countdown to an unnamed event says nothing. This panel is the one most likely to be
    // screenshotted on its own, so the subsidy change rides in it rather than only in the
    // table further down. Derived from the same event the clock uses.
    const { container } = renderAt();
    const hero = container.querySelector("section[aria-label]")!;

    expect(hero.textContent).toContain("AT THAT BLOCK");
    expect(hero.textContent).toContain("1.5625");
    expect(hero.textContent).toContain("0.78125");
  });

  it("separates the estimate tag from the date with a real character", () => {
    // Flex discards a whitespace-only text node between items, so only a non-breaking space
    // survives; without it the row copies and announces as "2028-11-30estimate".
    const { container } = renderAt();
    const row = container.querySelector("section[aria-label]")!.textContent ?? "";

    expect(row).toMatch(/ estimate/);
    expect(row).not.toMatch(/\d\destimate/);
  });

  it("keeps the backdrop out of the accessibility tree and free of ids", () => {
    // It is decoration and must announce nothing. The id check is the repeated-SVG rule:
    // ids in a component that can appear more than once break on document order.
    const { container } = renderAt();
    const svg = container.querySelector("section[aria-label] svg")!;

    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("section[aria-label] svg [id]")).toHaveLength(0);
  });

  it("says so when the block time could not be measured, rather than implying it was", () => {
    // 0 means "not measured". The estimate still exists — from the consensus target — and
    // the page must not present a target-derived date as an observation.
    const { container } = renderAt({ observedIntervalSeconds: 0 });
    const hero = container.querySelector("section[aria-label]")!;

    expect(hero.textContent).toMatch(/consensus target/);
    expect(hero.textContent).not.toMatch(/measured over the last 30 days/);
  });
});

describe("what changes", () => {
  it("states the miner's fall as SMALLER than the total's", () => {
    // The page's central claim, and the one a reader arrives disbelieving.
    renderAt();

    expect(screen.getByText("−50.0%")).toBeDefined();
    expect(screen.getByText("−37.5%")).toBeDefined();
    expect(screen.getByText(/miner revenue halves.*is wrong/s)).toBeDefined();
  });

  it("marks the streams and the lockbox as ending rather than as falling to zero", () => {
    // "−100%" would be arithmetically true and would read as a cut. They stop existing.
    renderAt();
    expect(screen.getAllByText("ends")).toHaveLength(2);
  });

  it("gives daily issuance in whole coins, as an estimate", () => {
    // Eight decimals on a per-block subsidy times an observed block rate would assert a
    // precision neither input has.
    renderAt();

    expect(screen.getByText(/≈ 1,792 ZEC/)).toBeDefined();
    expect(screen.getByText(/≈ 896 ZEC/)).toBeDefined();
  });
});

describe("the history", () => {
  it("includes Blossom and labels it as not a halving", () => {
    // Omitting it starts the table at 6.25 with nothing to say where 12.5 went; including it
    // unlabelled states a halving that did not happen.
    renderAt();
    const row = screen.getByText("653,600").closest("tr")!;

    expect(within(row).getByText("not a halving")).toBeDefined();
    expect(within(row).getByText(/12\.50 → 6\.25/)).toBeDefined();
  });

  it("prices each past halving from the daily closes, and leaves the future one blank", () => {
    renderAt({}, { "2020-11-18": 63.15, "2024-11-23": 48.87 });

    // Stated flat. The page draws no line between a halving and a price — and the figures
    // themselves decline to tell a tidy story, ZEC being lower at the second than the first.
    expect(screen.getByText("$63.15")).toBeDefined();
    expect(screen.getByText("$48.87")).toBeDefined();
    // Scoped to the history table: "4,406,400" also appears in the panel heading and prose,
    // and "SUBSIDY (ZEC)" heads a column in the tail table too.
    const table = screen.getByRole("columnheader", { name: "PRICE" }).closest("table")!;
    const future = within(table).getByText("4,406,400").closest("tr")!;
    expect(within(future).getByText("estimated")).toBeDefined();
  });

  it("renders without a price column's data rather than inventing one", () => {
    renderAt({}, {});
    expect(screen.queryByText(/\$\d/)).toBeNull();
  });

  it("keeps the TO MINER column to bare figures, so the rows stay aligned", () => {
    // No badge in this right-aligned column: it would push that row's figure out of line, and
    // the WHY panel and WHAT CHANGES table already say it.
    renderAt();
    const table = screen.getByRole("columnheader", { name: "PRICE" }).closest("table")!;
    const future = within(table).getByText("4,406,400").closest("tr")!;
    const cells = Array.from(future.querySelectorAll("td"));

    expect(table.textContent).not.toMatch(/all of it/);
    // The cell holds the two figures and nothing else.
    expect(cells[3]!.textContent?.trim()).toBe("1.25 → 0.78125");
  });
});

describe("the schedule tail", () => {
  it("gives the final height exactly and the year as an approximation", () => {
    renderAt();

    expect(screen.getByText(/49,766,400/)).toBeDefined();
    // The height is consensus; the year is a century of extrapolated block times.
    expect(screen.getByText(/roughly 21\d\d and nothing more precise/)).toBeDefined();
  });

  it("counts steps rather than halvings, and names the one-zatoshi last step", () => {
    // The floor discards a zatoshi long before the end, and the terminal step takes 1 zatoshi
    // to 0, a truncation rather than a halving. Derived from the domain on both sides so neither
    // the count nor the height can be a stale literal.
    const tail = subsidyTail(4_406_400, 78_125_000);
    const { container } = renderAt();

    expect(container.textContent).toMatch(new RegExp(`steps down ${tail.steps.length} more times`));
    expect(container.textContent).toMatch(/rounded down to the zatoshi/);
    expect(container.textContent).toMatch(/last taking 1 zatoshi to nothing/);
    expect(container.textContent).toContain(
      `From block ${tail.zeroHeight.toLocaleString("en-US")} the subsidy is zero`,
    );
  });

  it("does not claim the schedule issues every ZEC that will ever exist", () => {
    // Ultimate issuance under today's rules falls ~0.1848 ZEC short of the 21,000,000
    // MAX_MONEY constant, so equating the two would be wrong; the page makes no such claim,
    // since the true total is not derivable from anything it holds.
    const { container } = renderAt();

    expect(container.textContent).not.toMatch(/every ZEC that will ever exist/);
    expect(container.textContent).not.toMatch(/21,000,000|21 million/);
  });
});

describe("claims that must not outlive the event they describe", () => {
  /** The next halving moved on: streams and lockbox are already zero either side of it. */
  const afterTheHalving = (): Partial<HalvingSchedule> => {
    const zeroed = {
      totalZat: 39_062_500,
      minerZat: 39_062_500,
      fundingStreamsZat: 0,
      lockboxZat: 0,
    };
    const events = schedule.events.slice(0, -1).concat([
      {
        kind: "halving" as const,
        height: 6_086_400,
        at: null,
        before: { totalZat: 78_125_000, minerZat: 78_125_000, fundingStreamsZat: 0, lockboxZat: 0 },
        after: zeroed,
      },
    ]);
    return { height: 4_500_000, events };
  };

  it("names the block it is actually describing in the heading", () => {
    // The heading derives from the data, so it cannot state a stale height over correct rows.
    renderAt(afterTheHalving());

    expect(screen.getByRole("heading", { name: /WHAT CHANGES AT BLOCK 6,086,400/i })).toBeDefined();
    expect(screen.queryByRole("heading", { name: /4,406,400/ })).toBeNull();
  });

  it("drops the miner's-cut panel once nothing expires at the next halving", () => {
    // Every sentence in that panel is about one event. At 6,086,400 the miner's cut does
    // halve, so the panel must go quiet rather than keep its old sentences under new numbers.
    const { container } = renderAt(afterTheHalving());

    expect(screen.queryByRole("heading", { name: /MINER'S CUT DOES NOT HALVE/i })).toBeNull();
    expect(container.textContent).not.toContain("80%");
  });

  it("attributes the streams to the ZIP that defines them today, and says the rules can change", () => {
    // ZIP 1015 was the original dev fund and ended at 3,146,400; ZIP 214 revision 2 (NU6.1)
    // defines what runs now. The height is imported rather than typed as a literal.
    const { container } = renderAt();

    expect(container.textContent).toMatch(/ZIP 214 funding stream/);
    expect(container.textContent).not.toMatch(/ZIP[-\s]?1015/);
    expect(container.textContent).toContain(FUNDING_EXPIRY_BEFORE_NU61.toLocaleString("en-US"));
    expect(container.textContent).toMatch(/could move them again/);
  });
});
