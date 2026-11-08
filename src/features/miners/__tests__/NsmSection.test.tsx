import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NU7_HEIGHT, type NsmDay, type NsmOverview } from "@/domain";
import { NsmSection } from "../NsmSection";

/**
 * The section's claims: a figure we could not read says "unavailable" and carries no USD, a
 * window that opens before NU7 says where its sums start, and the chart starts at activation.
 */

const day = (d: string, over: Partial<NsmDay> = {}): NsmDay => ({
  day: d,
  blocks: 3_456,
  feeZat: 500_000_000,
  nsmZat: 300_000_000,
  closeUsd: 500,
  partial: false,
  ...over,
});

const NSM: NsmOverview = {
  activationHeight: NU7_HEIGHT,
  activationDay: "2026-11-06",
  balance: { height: NU7_HEIGHT + 7_000, zat: 900_000_000, carriedInZat: null },
  days: [
    day("2026-11-06"),
    day("2026-11-07"),
    day("2026-11-08", { partial: true, closeUsd: null }),
  ],
};

/** A tile's text, label to sub-line. */
const tile = (label: string) =>
  screen.getByText(label).closest(".stat-card")?.textContent ?? "missing tile";

describe("NsmSection", () => {
  it("states the balance and the window's split, each with USD", () => {
    render(<NsmSection nsm={NSM} fromDay="2026-10-10" toDay="2026-11-08" livePriceUsd={600} />);
    expect(tile("NSM BALANCE")).toContain("9.00 ZEC");
    expect(tile("NSM BALANCE")).toContain("$5,400");
    expect(tile("NSM BALANCE")).toContain(
      `at block ${(NU7_HEIGHT + 7_000).toLocaleString("en-US")}`,
    );
    // 3 ZEC at $500 on each closed day, and today's 3 ZEC at the live $600.
    expect(tile("FEES TO THE NSM")).toContain("9.00 ZEC");
    expect(tile("FEES TO THE NSM")).toContain("$4,800");
    expect(tile("FEES TO THE NSM")).toContain("60% of 15.00 ZEC in fees · since 6 Nov");
    expect(tile("FEES KEPT BY MINERS")).toContain("6.00 ZEC");
    expect(screen.getByRole("link", { name: /ZIP 235/ }).getAttribute("href")).toBe(
      "https://zips.z.cash/zip-0235",
    );
  });

  it("says what the balance holds beyond fees, with the figure when it is known", () => {
    const carried = { ...NSM, balance: { ...NSM.balance!, carriedInZat: 36_858_445_520 } };
    render(<NsmSection nsm={carried} fromDay="2026-10-10" toDay="2026-11-08" livePriceUsd={600} />);
    expect(tile("NSM BALANCE")).toContain("368.58 ZEC unclaimed rewards carried in at NU7");
  });

  it("says the balance includes more than fees when that part is not known", () => {
    render(<NsmSection nsm={NSM} fromDay="2026-10-10" toDay="2026-11-08" livePriceUsd={600} />);
    expect(tile("NSM BALANCE")).toContain("· includes more than fees");
  });

  it("does not say 'since' when the window opens after activation", () => {
    render(<NsmSection nsm={NSM} fromDay="2026-11-07" toDay="2026-11-08" livePriceUsd={600} />);
    expect(tile("FEES TO THE NSM")).toContain("60% of 10.00 ZEC in fees");
    expect(tile("FEES TO THE NSM")).not.toContain("since");
  });

  it("says unavailable, with no USD, for a figure it could not read", () => {
    const nsm: NsmOverview = {
      ...NSM,
      balance: null,
      days: [day("2026-11-06"), day("2026-11-07", { feeZat: null, nsmZat: null })],
    };
    render(<NsmSection nsm={nsm} fromDay="2026-10-10" toDay="2026-11-08" livePriceUsd={600} />);
    for (const label of ["NSM BALANCE", "FEES TO THE NSM", "FEES KEPT BY MINERS"]) {
      const text = tile(label);
      expect(text).toContain("unavailable");
      expect(text).not.toContain("$");
      expect(text).not.toMatch(/\d ZEC/);
    }
    expect(tile("NSM BALANCE")).toContain("the node did not answer");
  });

  it("draws the chart from activation, with the empty days before it named", () => {
    render(<NsmSection nsm={NSM} fromDay="2026-10-10" toDay="2026-11-08" livePriceUsd={null} />);
    expect(screen.getByText("no NSM before NU7")).toBeTruthy();
    expect(screen.getByText("NU7")).toBeTruthy();
    expect(tile("NSM BALANCE")).toContain("USD unavailable");
  });
});
