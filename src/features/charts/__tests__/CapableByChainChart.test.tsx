import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getDestinationWindows } from "@/fixtures/chart-series";
import { CapableByChainChart } from "../CapableByChainChart";
import { chartData } from "../chart-data";
import { CHAINS_SHOWN, chartTable } from "../chart-table";

/**
 * The by-chain chart's claims: each chain's share over its classified swaps with the counts, a
 * chain with no published address stated as such (never 0%), and the tail folded with its count.
 */
const table = (range: "all" | "30d") =>
  chartTable(
    "shielded-capable-by-chain",
    chartData({ destinationWindows: getDestinationWindows() }),
    range,
  )!;

describe("CapableByChainChart", () => {
  it("states each chain's share with its counts, unpublished swaps beside them", () => {
    render(<CapableByChainChart table={table("all")} />);
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(CHAINS_SHOWN + 1);
    // Bitcoin: 45 capable (40 unified + 4 Sapling + 1 fixture unified) of 102 classified, 6 unpublished.
    expect(rows[0]!.textContent).toContain("Bitcoin");
    expect(rows[0]!.textContent).toContain("44.1%");
    expect(rows[0]!.textContent).toContain("45 of 102");
    expect(rows[0]!.textContent).toContain("+6 unpublished");
  });

  it("has no share for a chain whose venues published no address", () => {
    render(<CapableByChainChart table={table("all")} />);
    const arb = screen.getByText(/Arbitrum|ARB/).closest("li")!;
    expect(arb.textContent).toContain("no address published");
    expect(arb.textContent).not.toMatch(/0(\.0)?%/);
  });

  it("folds the tail into one row naming how many chains it holds", () => {
    render(<CapableByChainChart table={table("all")} />);
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.at(-1)!.textContent).toMatch(/Other chains \(\d+\)/);
  });

  it("reads each range's own window", () => {
    // XRP's swaps are 400 days old: in ALL, never in 30D.
    expect(table("all").rowKeys).toContain("OTHER");
    expect(table("30d").rowKeys).not.toContain("XRP");
  });
});
