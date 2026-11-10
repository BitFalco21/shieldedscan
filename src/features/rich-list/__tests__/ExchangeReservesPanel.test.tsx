import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { exchangeReserveSummary } from "@/domain";
import { getExchangeReserves } from "@/fixtures/exchange-reserves";
import { ExchangeReservesPanel } from "../ExchangeReservesPanel";

/**
 * The exchanges' labelled balances on /rich-list: one row per exchange with how many addresses it
 * sums, the grouping stated once, and an address not computed yet shown as unmeasured, never 0.
 */
describe("ExchangeReservesPanel", () => {
  const summary = exchangeReserveSummary(getExchangeReserves())!;

  it("lists each exchange with the addresses it sums, and says the grouping is ours", () => {
    render(<ExchangeReservesPanel summary={summary} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual([
      "Binance 5 addresses",
      "Coinbase 21 addresses",
      "Gemini 6 addresses",
      "Kraken 3 addresses",
    ]);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1]!.textContent)).toEqual([
      "5",
      "21",
      "6",
      "3",
    ]);
    expect(screen.getByText(/Labelled addresses only, grouped by exchange by us/)).toBeDefined();
  });

  it("shows an exchange with an address not computed yet as unavailable, never 0", () => {
    // The fixture's first Coinbase address is three days behind.
    render(<ExchangeReservesPanel summary={summary} />);
    const coinbase = screen.getAllByRole("row").find((r) => r.textContent?.startsWith("Coinbase"))!;
    const cells = within(coinbase).getAllByRole("cell");
    expect(cells[2]!.textContent).toBe("unavailable");
    expect(cells[3]!.textContent).toBe("unavailable");
  });

  it("signs every change, a fall in the negative ink", () => {
    const fallen = {
      ...summary,
      rows: summary.rows.map((r) => ({ ...r, zat: 1e12, changeZat: -2e10 })),
    };
    render(<ExchangeReservesPanel summary={fallen} />);
    const cell = within(screen.getAllByRole("row")[1]!).getAllByRole("cell")[3]!;
    // Compact on a phone, whole coins from `sm`.
    expect(cell.textContent).toBe("−200.00 ZEC−200 ZEC");
    expect(cell.className).toContain("text-red");
  });

  it("says it could not be read, and states nothing else", () => {
    render(<ExchangeReservesPanel summary={null} />);
    expect(screen.getByText(/could not be read just now/)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
