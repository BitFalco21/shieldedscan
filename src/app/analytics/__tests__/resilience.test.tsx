import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * A slow upstream must not fail the build: this route is static, so a timeout while
 * prerendering it would abort the whole export, including pages that never touch the query.
 */
const getMonthlySeries = vi.fn();
const getActivitySeries = vi.fn();
const getFees24h = vi.fn(async () => null);
const getShieldingFlow = vi.fn(async () => []);
const getFeeDistribution = vi.fn(async () => null);
// Chain facts are stubbed with the minimum the cards read, so failures come from the series.
const getChainInfo = vi.fn(async () => ({
  height: 3_430_000,
  bestBlockHash: "00".repeat(32),
  lastBlockTimestamp: 1_785_000_000,
  circulatingSupplyZat: 1_600_000_000_000_000,
  priceUsd: null,
  priceChange24hPct: null,
  txCount24h: null,
  fullyShieldedPct24h: null,
}));
vi.mock("@/data", () => ({
  getPrerenderedDataSource: () => ({
    getMonthlySeries,
    getActivitySeries,
    getChainInfo,
    getFees24h,
    getShieldingFlow,
    getFeeDistribution,
    getDailySeries: async () => [],
    getShieldingFlowDaily: async () => [],
    getFeeKindsDaily: async () => [],
  }),
}));

const timeout = () => {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
};

/** One real month, for the tests whose subject is something other than the series itself. */
const MONTH = {
  timestamp: 1_760_000_000,
  topHeight: 3_400_000,
  transparentTxs: 10,
  mixedTxs: 5,
  shieldedTxs: 5,
  sproutZat: 0,
  saplingZat: 0,
  orchardZat: 0,
  ironwoodZat: 0,
};

describe("/analytics survives a slow upstream without inventing data", () => {
  it("renders an honest unavailable panel instead of throwing", async () => {
    getMonthlySeries.mockRejectedValueOnce(timeout());
    const { default: Page } = await import("../page");
    // Returning at all keeps the build alive; what it renders matters too.
    const element = await Page();
    render(element);
    expect(screen.getByText(/TEMPORARILY UNAVAILABLE/i)).toBeDefined();
    expect(screen.getByText(/could not be read just now/i)).toBeDefined();
    // The failure it must never take: an empty chart asserting Zcash has no history.
    expect(screen.queryByRole("img")).toBeNull();
    expect(document.body.textContent).toMatch(/Nothing here is estimated/i);
  });

  it("still throws on a shape error, so version skew keeps failing the build", async () => {
    // A shape error is version skew, not an outage: a required field the API does not serve
    // yet must fail the build rather than render as "unavailable".
    getMonthlySeries.mockRejectedValueOnce(new Error("unrecognised months shape"));
    getActivitySeries.mockResolvedValueOnce([]);
    const { default: Page } = await import("../page");
    await expect(Page()).rejects.toThrow(/unrecognised/);
  });

  it("degrades only the fees card when the fee query times out", async () => {
    // The fee sum is a separate aggregate that can be slow on its own: one card reads
    // "unavailable" and the page still renders the series it did read.
    getMonthlySeries.mockResolvedValueOnce([MONTH]);
    getActivitySeries.mockResolvedValueOnce([]);
    getFees24h.mockRejectedValueOnce(timeout());
    const { default: Page } = await import("../page");
    render(await Page());
    expect(screen.getByText("FEES 24H")).toBeDefined();
    // The chart is still there, so the page did not degrade wholesale.
    expect(screen.queryByText(/TEMPORARILY UNAVAILABLE/i)).toBeNull();
  });

  it("never renders a zero for unmeasured fees", async () => {
    // Zero fees and unmeasured fees are different claims; `null` must read "unavailable". The
    // series is non-empty because an empty series is the page-level unavailable state.
    getMonthlySeries.mockResolvedValueOnce([MONTH]);
    getActivitySeries.mockResolvedValueOnce([]);
    getFees24h.mockResolvedValueOnce(null);
    const { default: Page } = await import("../page");
    render(await Page());
    expect(screen.getByText("FEES 24H")).toBeDefined();
    expect(document.body.textContent).not.toMatch(/FEES 24H\s*0(\.0+)?\s*ZEC/);
  });

  it("treats an EMPTY series as unavailable, not as a chain with no history", async () => {
    /*
     * An empty series is unreadable, not zero: every headline is a reduction over it, so
     * rendering it would publish "TRANSACTIONS 0" beside a chart that draws nothing
     * (`StackedAreaChart` needs two points). `[]` occurs when the monthly rollup is empty or
     * unrefreshed.
     */
    getMonthlySeries.mockResolvedValueOnce([]);
    getActivitySeries.mockResolvedValueOnce([]);
    getFees24h.mockResolvedValueOnce(null);
    const { default: Page } = await import("../page");
    render(await Page());
    expect(screen.getByText(/TEMPORARILY UNAVAILABLE/i)).toBeDefined();
    // The two specific fabrications, named rather than inferred from the panel's presence.
    expect(screen.queryByText("TRANSACTIONS")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b0\b/);
  });
});
