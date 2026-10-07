import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SwapCard } from "../SwapCard";
import { swapCounterpartLabel, type SwapFigures } from "@/domain/swap";

// The same real inbound crossing `src/domain/__tests__/swap.test.ts` uses: one set of numbers
// for the domain tests, the card tests and the fixture preview.
const USDC: SwapFigures = {
  transferId: "near-intents-9xZhoxm6UVBejoUwXUtbPBZsxrMVWtBDmHrmwTjBB1zw",
  timestamp: 1_785_869_315,
  zecAmountZat: 98_753_141_281,
  usdAtSwap: 500_638.92503815755,
  counterpartAsset: "USDC",
  counterpartChain: "ETH",
  counterpartChainName: "Ethereum",
  counterpartAmount: 507_500,
  counterpartIsNative: false,
  venue: "NEAR Intents",
  zcashTxid: "ba191814decc7c7c425f9141b39ca1b6a72deb662ea474cb12a75cd3bd83db7c",
};

// A native-asset crossing: the chain is never repeated when the asset is its own chain's
// coin, a branch the USDC fixture cannot exercise.
const BTC: SwapFigures = {
  ...USDC,
  transferId: "near-intents-2akNnboSq4iA8bn4526YEas2VfMzPpMsKekouyyuRhBs",
  zecAmountZat: 26_286_799_829,
  usdAtSwap: 193_129.11834366302,
  counterpartAsset: "BTC",
  counterpartChain: "BTC",
  counterpartChainName: "Bitcoin",
  counterpartAmount: 2.5,
  counterpartIsNative: true,
  venue: "Maya Protocol",
  zcashTxid: "8b4f6fa852997131f653ab9913b51b1ce2abf28a53c24be633d18ad572628781",
};

describe("SwapCard", () => {
  it("renders the counterpart label — amount, ticker and chain named", () => {
    render(<SwapCard figures={USDC} />);
    // The exact composed phrase, carried as the counterpart cell's accessible name, so a
    // card whose three visual rows (amount / ticker / chain) drift apart from the domain's
    // own `swapCounterpartLabel` fails here rather than only looking wrong.
    expect(screen.getByLabelText(swapCounterpartLabel(USDC)!)).toBeTruthy();
    expect(screen.getByText("507,500")).toBeTruthy();
    expect(screen.getByText("USDC")).toBeTruthy();
    // `.microlabel` uppercases visually via CSS; the DOM text stays normal case, matching
    // `DailyCard`'s own convention for its pool names — hence the case-insensitive match.
    expect(screen.getByText(/on ethereum/i)).toBeTruthy();
  });

  it("does not repeat the chain for a native counterpart", () => {
    render(<SwapCard figures={BTC} />);
    expect(screen.getByLabelText(swapCounterpartLabel(BTC)!)).toBeTruthy();
    expect(screen.getByText("2.50")).toBeTruthy();
    expect(screen.getByText("BTC")).toBeTruthy();
    expect(screen.queryByText(/on bitcoin/i)).toBeNull();
    expect(screen.queryByText(/bitcoin/i)).toBeNull();
  });

  it("renders the ZEC amount", () => {
    render(<SwapCard figures={USDC} />);
    expect(screen.getByText("987.53")).toBeTruthy();
    expect(screen.getByText(/on zcash/i)).toBeTruthy();
  });

  it("renders the USD value at swap", () => {
    render(<SwapCard figures={USDC} />);
    expect(screen.getByText("$500,639")).toBeTruthy();
    expect(screen.getByText(/VALUE AT SWAP/i)).toBeTruthy();
  });

  // The card and the post text share `formatSwapUsdAtSwap`, which always rounds to a whole
  // dollar, so they cannot disagree about the same figure even below $100.
  it("rounds to a whole dollar below $100, matching the tweet's own formatter", () => {
    render(<SwapCard figures={{ ...USDC, usdAtSwap: 99.53 }} />);
    expect(screen.getByText("$100")).toBeTruthy();
    expect(screen.queryByText("$99.53")).toBeNull();
  });

  it("renders the venue", () => {
    render(<SwapCard figures={USDC} />);
    expect(screen.getByText("NEAR Intents")).toBeTruthy();
  });

  it("renders the elided txid", () => {
    render(<SwapCard figures={USDC} />);
    expect(screen.getByText("ba191814de…83db7c")).toBeTruthy();
  });

  // `.microlabel` applies `text-transform: uppercase`, so a hash under that class would be
  // displayed uppercased.
  it("never uppercases the txid", () => {
    render(<SwapCard figures={USDC} />);
    const txid = screen.getByText("ba191814de…83db7c");
    expect(txid.className).not.toMatch(/\bmicrolabel\b/);
  });

  it("carries the domain, which is the only link a post has", () => {
    render(<SwapCard figures={USDC} />);
    expect(screen.getByText("shieldedscan.xyz")).toBeTruthy();
  });

  // The single completeness gate: the card must call `swapIsComplete`, never restate part of
  // what it checks.
  it("throws rather than rendering an incomplete crossing", () => {
    const incomplete: SwapFigures = { ...USDC, usdAtSwap: null };
    expect(() => render(<SwapCard figures={incomplete} />)).toThrow();
  });

  it("throws rather than rendering a crossing with no identified counterpart ticker", () => {
    const unidentified: SwapFigures = { ...USDC, counterpartAsset: "ETH asset" };
    expect(() => render(<SwapCard figures={unidentified} />)).toThrow();
  });

  it("renders no NaN, undefined, Infinity or ∞ anywhere, for either shape", () => {
    for (const figures of [USDC, BTC]) {
      const { container, unmount } = render(<SwapCard figures={figures} />);
      expect(container.innerHTML).not.toMatch(/NaN|undefined|Infinity|∞/);
      unmount();
    }
  });

  // An unidentified asset never borrows its host chain's mark at the asset's own position;
  // the chain's mark appears only in the small "ON Ethereum" row. PEPE has no brand mark and
  // ETH does, so this exercises exactly that case.
  it("keeps the ink lettermark for an unidentified asset, never the chain's own mark", () => {
    const unidentifiedOnKnownChain: SwapFigures = {
      ...USDC,
      counterpartAsset: "PEPE",
      counterpartChain: "ETH",
      counterpartChainName: "Ethereum",
      counterpartIsNative: false,
    };
    render(<SwapCard figures={unidentifiedOnKnownChain} />);

    const assetGroup = screen.getByRole("group", { name: /^\d.*PEPE on Ethereum$/ });
    // Both the asset's own 150px mark AND the small 24px "ON Ethereum" mark sit inside
    // this same group, so the assertion has to be about the ASSET position specifically
    // — its own dedicated size — not about whether a `.brand-eth` element exists
    // anywhere inside the group at all.
    const assetMark = assetGroup.querySelector('svg[width="150"]');
    expect(assetMark).not.toBeNull();
    expect(assetMark?.getAttribute("class")).not.toMatch(/brand-eth/);
    expect(within(assetMark as HTMLElement).getByText("P")).toBeTruthy();

    // The chain's own mark still appears, correctly, in the small "ON Ethereum" row —
    // this proves the assertion above is about WHICH mark renders where, not that the
    // Ethereum mark never renders on the card at all.
    const chainMark = assetGroup.querySelector('svg[width="24"]');
    expect(chainMark?.getAttribute("class")).toBe("brand-eth");
    expect(document.querySelectorAll(".brand-eth")).toHaveLength(1);
  });

  /**
   * The heading and both cells follow the direction: flipping only the words would leave the
   * arrow pointing from destination to source, the crossing stated backwards.
   */
  it("reverses the heading and the two sides for an outbound crossing", () => {
    const { container, unmount } = render(<SwapCard figures={USDC} />);
    const inboundOrder = [...container.querySelectorAll(".card-swap-side")].map(
      (el) => el.getAttribute("aria-label") ?? "",
    );
    expect(container.textContent).toContain("INTO ZCASH");
    unmount();

    const out = render(<SwapCard figures={{ ...USDC, direction: "out" }} />);
    expect(out.container.textContent).toContain("OUT OF ZCASH");
    expect(out.container.textContent).not.toContain("INTO ZCASH");
    const outboundOrder = [...out.container.querySelectorAll(".card-swap-side")].map(
      (el) => el.getAttribute("aria-label") ?? "",
    );
    // Same two cells, opposite order: ZEC leads when value is leaving Zcash.
    expect(outboundOrder).toEqual([...inboundOrder].reverse());
    expect(outboundOrder[0]).toMatch(/ZEC on Zcash/);
  });

  // Every ledger row written before the direction column existed came from a query that
  // filtered `direction = 'in'`, so absent genuinely means inbound.
  it("treats a stored row with no direction as inbound", () => {
    const { container } = render(<SwapCard figures={USDC} />);
    expect(container.textContent).toContain("INTO ZCASH");
  });
});
