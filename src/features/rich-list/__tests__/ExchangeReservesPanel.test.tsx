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
      "Binance 11 addresses",
      "Coinbase 34 addresses",
      "Gemini 6 addresses",
      "Kraken 3 addresses",
      "OKX 1 addresses",
      "KuCoin 2 addresses",
      "Bitget 1 addresses",
      "Gate 1 addresses",
    ]);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1]!.textContent)).toEqual([
      "11",
      "34",
      "6",
      "3",
      "1",
      "2",
      "1",
      "1",
    ]);
    expect(screen.getByText(/Labelled addresses only, grouped by exchange by us/)).toBeDefined();
  });

  it("shows an exchange with an address not computed yet as unavailable, never 0", () => {
    // The fixture's first Coinbase address is three days behind.
    render(<ExchangeReservesPanel summary={summary} />);
    const coinbase = screen.getAllByRole("row").find((r) => r.textContent?.startsWith("Coinbase"))!;
    const cells = within(coinbase).getAllByRole("cell");
    // The balance, and on a phone the change under it; the change's own column from `sm`.
    expect(cells[2]!.textContent).toBe("unavailableunavailable");
    expect(cells[3]!.textContent).toBe("unavailable");
  });

  it("signs every change, a fall in the negative ink", () => {
    const fallen = {
      ...summary,
      rows: summary.rows.map((r) => ({ ...r, zat: 1e12, changeZat: -2e10 })),
    };
    render(<ExchangeReservesPanel summary={fallen} />);
    const cells = within(screen.getAllByRole("row")[1]!).getAllByRole("cell");
    // From `sm` the change has its own column, in whole coins.
    expect(cells[3]!.textContent).toBe("−200.00 ZEC−200 ZEC");
    expect(cells[3]!.className).toContain("text-red");
    // On a phone it sits under the balance: two decimals and no ticker, so the row fits.
    const underBalance = cells[2]!.querySelector("span.block")!;
    expect(underBalance.textContent).toBe("−200.00");
    expect(underBalance.className).toContain("text-red");
  });

  it("says it could not be read, and states nothing else", () => {
    render(<ExchangeReservesPanel summary={null} />);
    expect(screen.getByText(/could not be read just now/)).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
