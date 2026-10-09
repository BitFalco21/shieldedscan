import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChartLibrary } from "../ChartLibrary";
import type { ChartCardProps } from "../ChartCard";

const card = (
  slug: ChartCardProps["slug"],
  title: string,
  category: ChartCardProps["category"],
  blurb: string,
): ChartCardProps => ({
  slug,
  title,
  category,
  blurb,
  preview: {
    thumb: { kind: "lines", series: [{ values: [1, 2, 3], className: "text-green" }] },
    headline: null,
  },
});

const CHARTS = [
  card("median-fee", "Median fee by privacy kind", "Fees", "What a transaction costs."),
  card("fee-totals", "Total fees paid", "Fees", "What the whole network pays."),
  card("difficulty", "Mining difficulty", "Mining", "Daily average difficulty."),
  card("price", "ZEC price", "Market", "Daily USD close."),
];

const titles = () => screen.queryAllByRole("link").map((a) => a.textContent ?? "");

describe("ChartLibrary", () => {
  it("lists every chart, with a chip only for categories that have one", () => {
    render(<ChartLibrary charts={CHARTS} />);
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getByText("4 charts")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Privacy" })).toBeNull();
    expect(screen.getByRole("button", { name: "Fees" })).toBeTruthy();
  });

  it("narrows as you type, every word having to match", () => {
    render(<ChartLibrary charts={CHARTS} />);
    const search = screen.getByRole("searchbox", { name: "Search charts" });
    fireEvent.change(search, { target: { value: "fee" } });
    expect(titles()).toHaveLength(2);
    fireEvent.change(search, { target: { value: "fee network" } });
    expect(titles()).toEqual([expect.stringContaining("Total fees paid")]);
    expect(screen.getByText("1 of 4 charts")).toBeTruthy();
  });

  it("filters by category, and All restores the list", () => {
    render(<ChartLibrary charts={CHARTS} />);
    fireEvent.click(screen.getByRole("button", { name: "Mining" }));
    expect(titles()).toEqual([expect.stringContaining("Mining difficulty")]);
    expect(screen.getByRole("button", { name: "Mining" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(titles()).toHaveLength(4);
  });

  it("says so when nothing matches, rather than showing an empty grid", () => {
    render(<ChartLibrary charts={CHARTS} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText(/No chart matches/)).toBeTruthy();
  });
});
