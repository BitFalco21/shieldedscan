import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getMinerSeries } from "@/fixtures/miners";
import { PoolsToMajorityChart } from "../PoolsToMajorityChart";

/**
 * The chart's claims, through its table: a count where reviewed pools reach 51%, and no count —
 * the word, never a zero — in the fixture's mostly-unattributed oldest month.
 */
describe("PoolsToMajorityChart", () => {
  it("states no count for a month whose reviewed pools fall short, and a count otherwise", () => {
    const series = getMinerSeries("month");
    render(<PoolsToMajorityChart series={series} withTable />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(series.periods.length);
    const oldest = rows[0]!.textContent ?? "";
    expect(oldest).toContain("none");
    expect(oldest).not.toMatch(/\b0\b(?!\.)/);
    // The reviewed share it fell short with, under 51%.
    const reviewed = Number(/([\d.]+)%\s*$/.exec(oldest)?.[1]);
    expect(reviewed).toBeLessThan(51);
    expect(rows[1]!.textContent).toMatch(/^\D+\d{4}\d/);
    expect(rows[1]!.textContent).not.toContain("none");
  });

  it("names its measure for a screen reader", () => {
    render(<PoolsToMajorityChart series={getMinerSeries("month")} />);
    expect(
      screen.getByRole("img", { name: /reviewed mining pools, largest first, mined 51%/ }),
    ).toBeTruthy();
  });
});
