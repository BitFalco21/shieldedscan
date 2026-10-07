import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MarketAsset, MarketSnapshot } from "@/domain";
import { resolveComparison } from "@/domain";
import { ComparePage } from "../ComparePage";
import { compareHref } from "../compareHref";

/**
 * The comparison page.
 *
 * Every test here is about one failure mode: a page whose whole subject is a ratio between
 * two figures it did not measure. The risks are stating a comparison the reader did not ask
 * for, stating one whose two halves come from different methods, and stating one at all when
 * the figures are missing.
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
const XMR = asset("monero", "XMR", "Monero", 7_494_212_005, 399.06);
const USDT = asset("tether", "USDT", "Tether", 183_019_246_679, 0.9997, true);

const snapshot: MarketSnapshot = {
  asOf: 1_786_535_600,
  zec: ZEC,
  assets: [BTC, XMR, USDT],
};

const renderAt = (vs: string | null, snap: MarketSnapshot | null = snapshot) =>
  render(
    <ComparePage
      snapshot={snap}
      selection={snap === null ? { kind: "none" } : resolveComparison(snap, vs)}
    />,
  );

describe("the comparison", () => {
  it("states the implied price and the multiple, both derived from the cap ratio", () => {
    renderAt(null);

    // 1,287,601,924,219 / 8,249,897,604 = 156.074..., x $489.43.
    expect(screen.getByText("$76,387.74")).toBeDefined();
    expect(screen.getAllByText("156.07x").length).toBeGreaterThan(0);
  });

  it("shows both market caps, so the multiple can be checked against them", () => {
    // The whole reason the arithmetic anchors on the ratio rather than on Zcash's supply: a
    // reader dividing the two figures on screen must arrive at the figure between them.
    const { container } = renderAt(null);
    const values = [...container.querySelectorAll("dd")].map((dd) => dd.textContent);

    expect(values).toContain("$1.29T");
    expect(values).toContain("$8.25B");
  });

  it("attributes the figures and names when they were read", () => {
    renderAt(null);

    // The one page here whose numbers cannot be checked against the Zcash chain.
    expect(screen.getAllByText(/CoinGecko/).length).toBeGreaterThan(0);
    expect(screen.getByText(/2026-08-12/)).toBeDefined();
  });

  it("names BOTH assets in the headline, so a screenshot of it alone still says what it is", () => {
    // How a figure like this actually travels. "$76,387.74" under "ONE ZEC WOULD BE WORTH"
    // is meaningless without naming which market cap produced it.
    const { container } = renderAt(null);
    const headline = container.querySelector("section[aria-label]")!;

    expect(headline.textContent).toContain("ZEC");
    expect(headline.textContent).toContain("BTC");
    expect(headline.textContent).toContain("with the market cap of");
    // Never "the price of": at Bitcoin's PRICE one ZEC would be $64,539, a false claim.
    expect(headline.textContent).not.toMatch(/the price of/);
  });

  it("reads the formula first, full names over the cards, coin A left and coin B right", () => {
    // The formula line is the first thing in the hero, and each asset is its own card in a
    // fixed order, so nothing has to be hunted for.
    const { container } = renderAt(null);
    const hero = container.querySelector("section[aria-label]")!;
    const text = hero.textContent!;

    expect(text.indexOf("Zcash")).toBeLessThan(text.indexOf("with the market cap of"));
    expect(text.indexOf("with the market cap of")).toBeLessThan(text.indexOf("Bitcoin"));
    expect(text.indexOf("Bitcoin")).toBeLessThan(text.indexOf("$76,387.74"));

    const cards = [...hero.querySelectorAll("[data-coin-role]")];
    expect(cards.map((c) => c.getAttribute("data-coin-role"))).toEqual(["fixed", "choose"]);
    expect(cards[0]!.textContent).toContain("Zcash");
    expect(cards[1]!.textContent).toContain("Bitcoin");
  });

  it("draws Zcash's cap as a share of the other's, with both terms printed beside it", () => {
    // A bar is a claim. It is allowed here only because the percentage carries its
    // denominator and both caps sit under it — and it is a SHARE, never a path or a forecast.
    renderAt(null);

    // 8,249,897,604 / 1,287,601,924,219 = 0.6407%.
    expect(screen.getByText("0.64%")).toBeDefined();
    expect(screen.getByText(/Zcash's market cap against Bitcoin's/)).toBeDefined();
    expect(screen.queryByText(/to go|progress|needs to/i)).toBeNull();
  });

  it("carries no share controls — the URL is the share", () => {
    // No copy button and no X intent link: the card carries the comparison.
    renderAt(null);
    expect(screen.queryByRole("link", { name: /share on X/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });
});

describe("assets it will not compare against", () => {
  it("never substitutes a different asset for one the URL named", () => {
    // A stale bookmark must not quietly become a Bitcoin comparison: the reader would have
    // no way to notice they are reading an answer to a question they did not ask.
    renderAt("monero");

    expect(screen.queryByText("$76,387.74")).toBeNull();
    expect(screen.getByText("NOT A LARGER ASSET")).toBeDefined();
    expect(screen.getByText(/Monero's market capitalisation is \$7\.49B/)).toBeDefined();
  });

  it("does not call a larger excluded asset smaller", () => {
    renderAt("tether");

    expect(screen.getByText("NOT COMPARED")).toBeDefined();
    expect(screen.getByText(/Tether is larger than Zcash/)).toBeDefined();
  });

  it("reports an id it holds nothing for without echoing it into the page", () => {
    renderAt("some-made-up-asset");

    expect(screen.getByText("NOT FOUND")).toBeDefined();
    expect(screen.queryByText(/some-made-up-asset/)).toBeNull();
  });

  it("keeps the picker on every miss, so the page is never a dead end", () => {
    // And keeps Zcash's card: a miss is the same page with the right card empty, not a
    // different page.
    for (const vs of ["monero", "tether", "some-made-up-asset"]) {
      const { unmount } = renderAt(vs);
      expect(screen.getByLabelText(/an asset to compare with/)).toBeDefined();
      expect(screen.getByRole("link", { name: /BTC/ })).toBeDefined();
      unmount();
    }
  });
});

describe("the picker", () => {
  it("offers only assets larger than Zcash that are freely traded", () => {
    renderAt(null);

    // Keyed on the TICKER, which is what the menu shows: a market page names a token the
    // way an exchange does, and CoinGecko's `name` is the project rather than the token.
    expect(screen.getByRole("link", { name: /BTC/ })).toBeDefined();
    // Below Zcash, and a stablecoin, respectively.
    expect(screen.queryByRole("link", { name: /XMR/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /USDT/ })).toBeNull();
  });

  it("gives the default asset a parameterless URL, so it has one cache key", () => {
    expect(compareHref("bitcoin")).toBe("/compare");
    expect(compareHref("ethereum")).toBe("/compare?vs=ethereum");
  });
});

describe("when the snapshot is missing", () => {
  it("says so instead of rendering a comparison", () => {
    renderAt(null, null);

    expect(screen.getByText("TEMPORARILY UNAVAILABLE")).toBeDefined();
    expect(screen.queryByText(/WOULD BE WORTH/)).toBeNull();
    // Never the Veil: redaction bars mean "encrypted on-chain, hidden by design", and an
    // outage of ours must not be dressed as a privacy property of Zcash.
    expect(screen.queryByRole("img", { name: /shielded/i })).toBeNull();
  });
});
