import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MarketAsset, MarketSnapshot } from "@/domain";
import { CompareAllPage } from "../CompareAllPage";
import { compareHref } from "../compareHref";

/**
 * The whole table: Zcash against every asset above it.
 *
 * The single view's failure modes all apply, plus one this view has on its own — a column of
 * ascending dollar figures reads as a price-target list far more readily than one comparison
 * does. So the tests below check both that the arithmetic reconciles row by row AND that the
 * page never dresses it as a prediction.
 */

const asset = (
  id: string,
  symbol: string,
  name: string,
  marketCapUsd: number,
  priceUsd: number,
  isStablecoin = false,
): MarketAsset => ({
  id,
  symbol,
  name,
  marketCapUsd,
  priceUsd,
  circulatingSupply: marketCapUsd / priceUsd,
  rank: null,
  isStablecoin,
});

const ZEC = asset("zcash", "ZEC", "Zcash", 8_249_897_604, 489.43);
const BTC = asset("bitcoin", "BTC", "Bitcoin", 1_287_601_924_219, 64_539);
const ETH = asset("ethereum", "ETH", "Ethereum", 230_794_179_539, 1_911.72);
const XMR = asset("monero", "XMR", "Monero", 7_494_212_005, 399.06);
const USDT = asset("tether", "USDT", "Tether", 183_019_246_679, 0.9997, true);
const FUND = asset("figure-heloc", "FIGR_HELOC", "Figure Heloc", 21_983_454_157, 1.038);

const snapshot: MarketSnapshot = {
  asOf: 1_786_535_600,
  zec: ZEC,
  assets: [ETH, USDT, XMR, BTC, FUND],
};

/** Every data row, in render order. The header row carries `<th>` and has no `<td>`. */
const bodyRows = () =>
  screen.getAllByRole("row").filter((row) => within(row).queryAllByRole("cell").length > 0);

describe("CompareAllPage", () => {
  it("lists every eligible asset, largest first", () => {
    render(<CompareAllPage snapshot={snapshot} />);
    const names = bodyRows().map((row) => within(row).getAllByRole("cell")[0]?.textContent);
    expect(names.map((n) => n?.replace(/\s+/g, " ").trim())).toEqual(["BitcoinBTC", "EthereumETH"]);
  });

  it("offers no stablecoin, no tokenised fund and nothing smaller than Zcash", () => {
    render(<CompareAllPage snapshot={snapshot} />);
    const table = screen.getByRole("table").textContent ?? "";
    for (const absent of ["Tether", "Figure Heloc", "Monero"]) {
      expect(table, absent).not.toContain(absent);
    }
  });

  it("states an implied price that is the row's own multiple times today's ZEC price", () => {
    // The page's central honesty check, row by row: a reader who takes the multiple printed
    // beside the figure and applies it to the ZEC price in the lede must land on the figure.
    // Anchoring the price on supply instead would leave every row contradicting itself.
    render(<CompareAllPage snapshot={snapshot} />);
    for (const row of bodyRows()) {
      const cells = within(row)
        .getAllByRole("cell")
        .map((c) => c.textContent ?? "");
      const multiple = Number(cells[2]?.replace(/[x,]/g, ""));
      const implied = Number(cells[3]?.replace(/[$,]/g, ""));
      expect(implied / (ZEC.priceUsd * multiple)).toBeCloseTo(1, 3);
    }
  });

  it("links every row to that asset's own comparison", () => {
    render(<CompareAllPage snapshot={snapshot} />);
    for (const [name, id] of [
      [/Bitcoin/, "bitcoin"],
      [/Ethereum/, "ethereum"],
    ] as const) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(compareHref(id));
    }
  });

  it("names the assumption and refuses the forecast framing", () => {
    render(<CompareAllPage snapshot={snapshot} />);
    // The supply assumption is what makes the arithmetic true, and it is stated once above
    // the rows rather than left for the reader to supply.
    expect(document.body.textContent).toContain("circulating supply held fixed");
    expect(document.body.textContent).toContain("arithmetic, not a forecast");
    // A column headed with any of these would turn the same true figures into a claim about
    // the future, which is the one thing this page must never make.
    for (const forbidden of [
      /\btarget\b/i,
      /\bpotential\b/i,
      /\bprediction\b/i,
      /\bwill reach\b/i,
    ]) {
      expect(document.body.textContent ?? "", String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("says the figures are unavailable rather than rendering an empty table", () => {
    render(<CompareAllPage snapshot={null} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.body.textContent).toContain("Market capitalisations");
  });

  it("states the measurement when nothing is larger than Zcash", () => {
    // Not an outage: the snapshot was read and holds no larger asset. A reader is owed the
    // difference between "we could not read this" and "there is nothing to show".
    render(<CompareAllPage snapshot={{ ...snapshot, assets: [XMR, USDT] }} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.body.textContent).toContain("NOTHING TO COMPARE");
    expect(document.body.textContent).not.toContain("Market capitalisations could not");
  });
});
