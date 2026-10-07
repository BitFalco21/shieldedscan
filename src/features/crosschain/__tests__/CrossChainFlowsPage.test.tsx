import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  ChartRange,
  CrossChainDirection,
  CrossChainFlow,
  CrossChainFlowSummary,
} from "@/domain";
import { flowRowsWithPrevious, flowTrend } from "@/domain";
import { CrossChainFlowsPage } from "../CrossChainFlowsPage";
import { balanceSentence, windowPhrase } from "../window-copy";

/**
 * The flows tab under a time window: every sentence must stay true for a slice, not only for all
 * of history. A true figure under an unstated denominator is the failure, and "no crossings
 * recorded yet" over a quiet month is the same error in prose.
 */

/**
 * A flow row with the swap-time USD terms defaulted to their unmeasured state. These tests are
 * about what the page renders, so the dollars are not the subject — but they are required fields, and a zero
 * covered-count is what says "no venue published a price here" rather than "$0 crossed".
 */
const flow = (
  chain: string,
  direction: CrossChainDirection,
  transfers: number,
  zecAmountZat: number,
): CrossChainFlow => ({
  chain,
  direction,
  transfers,
  zecAmountZat,
  usdAtSwap: 0,
  usdCoveredTransfers: 0,
});

const summary = (
  flows: CrossChainFlowSummary["flows"],
  windowDays: number | null = null,
  previous: CrossChainFlowSummary["previous"] = { kind: "none" },
): CrossChainFlowSummary => ({
  flows,
  firstAt: 1_780_000_000,
  lastAt: 1_785_000_000,
  windowDays,
  previous,
});

const BOTH: CrossChainFlowSummary["flows"] = [
  flow("BTC", "in", 4, 100_000_000),
  flow("ETH", "out", 9, 400_000_000),
];

describe("windowPhrase", () => {
  it("names every window and says nothing for all-time", () => {
    expect(windowPhrase("all")).toBeNull();
    expect(windowPhrase("30d")).toBe("the last 30 days");
    expect(windowPhrase("60d")).toBe("the last 60 days");
    expect(windowPhrase("1y")).toBe("the last year");
  });
});

describe("balanceSentence", () => {
  it("keeps the all-time wording when nothing is windowed", () => {
    expect(balanceSentence(0, 0, "all")).toBe("No crossings recorded at these venues yet.");
    expect(balanceSentence(400, 100, "all")).toBe("4× more ZEC left Zcash than arrived.");
  });

  /*
   * The branch that matters most: "yet" is a claim about all of history. Left unqualified
   * under a 30-day window it reports a quiet month as an empty history — a true sentence
   * about the data on the page and a false one about Zcash.
   */
  it("never says 'yet' about a window", () => {
    expect(balanceSentence(0, 0, "30d")).toBe(
      "No crossings recorded at these venues in the last 30 days.",
    );
    expect(balanceSentence(0, 0, "30d")).not.toMatch(/yet/);
  });

  it("carries the window into every branch, since this line is the page's headline", () => {
    for (const range of ["30d", "60d", "90d", "180d", "1y"] as ChartRange[]) {
      const phrase = windowPhrase(range)!;
      expect(balanceSentence(400, 100, range)).toContain(phrase);
      expect(balanceSentence(100, 400, range)).toContain(phrase);
      expect(balanceSentence(100, 100, range)).toContain(phrase);
      expect(balanceSentence(400, 0, range)).toContain(phrase);
      expect(balanceSentence(0, 400, range)).toContain(phrase);
    }
  });
});

describe("CrossChainFlowsPage", () => {
  it("offers every window as a link, with the active one marked", () => {
    render(<CrossChainFlowsPage summary={summary(BOTH, 30)} range="30d" />);
    const nav = screen.getByRole("navigation", { name: "Filter by time window" });
    // Links, not buttons: this control re-asks the question rather than windowing a series
    // already on the page, so it must be shareable — and must work with no JavaScript.
    expect(nav.querySelectorAll("a")).toHaveLength(6);
    expect(nav.querySelector('a[aria-current="page"]')?.textContent).toBe("30D");
    expect(nav.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe(
      "/cross-chain/flows?range=30d",
    );
  });

  it("sends ALL to the bare path, so the default view has one URL", () => {
    render(<CrossChainFlowsPage summary={summary(BOTH)} range="all" />);
    const nav = screen.getByRole("navigation", { name: "Filter by time window" });
    expect(nav.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe(
      "/cross-chain/flows",
    );
  });

  /*
   * `CrossChainSankey` renders nothing for a direction with no rows, which a window makes
   * ordinary. An empty bordered panel under a heading would read as a chart that failed to draw.
   */
  it("states an empty direction instead of rendering an empty panel", () => {
    render(
      <CrossChainFlowsPage
        summary={summary([flow("ETH", "out", 9, 400_000_000)], 30)}
        range="30d"
      />,
    );
    expect(
      screen.getByText("No ZEC arrived through these venues in the last 30 days."),
    ).toBeTruthy();
  });

  it("does not describe a windowed page as all-time", () => {
    const { container } = render(<CrossChainFlowsPage summary={summary(BOTH, 30)} range="30d" />);
    expect(container.textContent).toContain("over the last 30 days");
    expect(container.textContent).not.toContain("all-time");
  });
});

/**
 * The per-chain trend column. Its risk is a confident percentage over a denominator we do not
 * have — a new chain (change from zero) or a previous window that predates our records. Both are
 * refusals, tested on the rendered cell because that is what a reader believes.
 */
describe("the trend column", () => {
  const CUR: CrossChainFlowSummary["flows"] = [
    flow("ETH", "out", 9, 400_000_000),
    flow("SOL", "out", 4, 100_000_000),
    flow("BTC", "in", 3, 200_000_000),
  ];
  const PREV: CrossChainFlowSummary["flows"] = [
    flow("ETH", "out", 0, 200_000_000),
    // No SOL: it is new this window.
    flow("TRON", "out", 0, 50_000_000),
    flow("BTC", "in", 0, 200_000_000),
  ];
  const windowed = summary(CUR, 30, { kind: "flows", flows: PREV });

  it("heads the column with the window it compares against", () => {
    render(<CrossChainFlowsPage summary={windowed} range="30d" />);
    // By the header's accessible name: a right-aligned label keeps its last letter in its own
    // untracked span (DataTable's FlushEnd), so the text is split across two nodes.
    expect(screen.getAllByRole("columnheader", { name: "VS PREV 30D" }).length).toBeGreaterThan(0);
  });

  it("renders a doubling as a rise and an unchanged chain as unchanged", () => {
    const { container } = render(<CrossChainFlowsPage summary={windowed} range="30d" />);
    expect(container.textContent).toContain("▲ 100%");
    expect(container.textContent).toContain("unchanged");
  });

  /* A change from zero has no denominator: +100% would invent one and ∞ would print one. */
  it("says 'new' rather than a percentage when the chain has no previous volume", () => {
    const { container } = render(<CrossChainFlowsPage summary={windowed} range="30d" />);
    expect(container.textContent).toContain("new");
  });

  /*
   * The blind spot the union closes: a chain that stopped bridging entirely is the largest
   * movement a trend can describe, and sourcing rows from the current window alone would drop
   * it from the table with nothing said.
   */
  it("keeps a chain that went quiet, at −100%", () => {
    const rows = flowRowsWithPrevious(CUR, PREV, "out");
    const tron = rows.find((r) => r.flow.chain === "TRON");
    expect(tron?.flow.zecAmountZat).toBe(0);
    expect(flowTrend(0, tron!.previousZat)).toEqual({ kind: "pct", pct: -100 });
    const { container } = render(<CrossChainFlowsPage summary={windowed} range="30d" />);
    expect(container.textContent).toContain("▼ 100%");
  });

  it("shows no column at all under ALL, where there is no previous period", () => {
    render(<CrossChainFlowsPage summary={summary(CUR)} range="all" />);
    expect(screen.queryByText(/VS PREV/)).toBeNull();
  });

  /*
   * If the dataset spans 497 days, 1Y's previous year is only 36% covered, and every chain would
   * report roughly +180% growth as an artefact of when ingestion started. The refusal is
   * explained rather than silent.
   */
  it("refuses the comparison — and explains it — when the previous window predates our records", () => {
    const { container } = render(
      <CrossChainFlowsPage
        summary={summary(CUR, 365, { kind: "incomplete", recordsBeginAt: 1_743_378_339 })}
        range="1y"
      />,
    );
    expect(screen.queryByText(/VS PREV/)).toBeNull();
    expect(container.textContent).toContain("measured against the preceding year");
    expect(container.textContent).toContain("only partly covered");
    // One noun, and each sentence adds its own determiner — never prose built by stripping words
    // off other prose.
    expect(container.textContent).not.toMatch(/previous last|preceding the last/);
    // The absence must read as a decision, not a gap: say where the comparison does exist.
    expect(container.textContent).toContain("Shorter ranges carry the comparison");
  });

  it("never prints an infinite or NaN percentage", () => {
    const { container } = render(<CrossChainFlowsPage summary={windowed} range="30d" />);
    expect(container.textContent).not.toMatch(/Infinity|NaN/);
  });
});
