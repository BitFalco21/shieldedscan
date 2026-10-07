import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChainInfo, ShieldedPool } from "@/domain";
import { HomePage } from "../HomePage";

/**
 * The homepage stat cards against an API whose pollers have nothing to report: a missing
 * number is stated rather than invented (no fixture value standing in as live), and stating it
 * does not borrow the veil.
 */

const pools: ShieldedPool[] = [
  { pool: "orchard", balanceZat: 400_000_000_000 },
  { pool: "sapling", balanceZat: 100_000_000_000 },
];

const measured: ChainInfo = {
  height: 3_426_950,
  bestBlockHash: "f".repeat(64),
  lastBlockTimestamp: 1_783_875_480,
  circulatingSupplyZat: 1_600_000_000_000_000,
  txCount24h: 8_241,
  fullyShieldedPct24h: 61,
  priceUsd: 38.42,
  priceChange24hPct: 4.7,
};

const unmeasured: ChainInfo = {
  ...measured,
  txCount24h: null,
  fullyShieldedPct24h: null,
  priceUsd: null,
  priceChange24hPct: null,
};

function renderHome(chain: ChainInfo) {
  return render(
    <HomePage chain={chain} pools={pools} latestBlocks={[]} latestTxs={[]} latestTransfers={[]} />,
  );
}

describe("HomePage stat cards", () => {
  it("renders measured figures as themselves", () => {
    renderHome(measured);
    expect(screen.getByText("$38.42")).toBeDefined();
    expect(screen.getByText("8,241")).toBeDefined();
    expect(screen.getByText(/fully shielded/)).toBeDefined();
  });

  it("never prints a number the API did not supply", () => {
    renderHome(unmeasured);

    // The fixture values must not leak through as live figures.
    expect(screen.queryByText("$38.42")).toBeNull();
    expect(screen.queryByText("8,241")).toBeNull();
    expect(screen.queryByText(/61%/)).toBeNull();
    expect(screen.queryByText(/4\.7%/)).toBeNull();

    // And no "$0.00" stand-in either — a zero price is a claim, not a blank.
    expect(screen.queryByText(/^\$/)).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("says the figures are unavailable, in words", () => {
    renderHome(unmeasured);
    expect(screen.getAllByText("unavailable").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/price feed unavailable/)).toBeDefined();
    expect(screen.getByText(/24h window not yet measured/)).toBeDefined();
  });

  it("does not dress an unmeasured figure as a shielded one", () => {
    renderHome(unmeasured);
    // The veil means "encrypted on-chain, hidden by design". A cold price feed of ours is
    // not that, and reusing the redaction bar here would teach visitors it was.
    expect(screen.queryByRole("img", { name: /value shielded/ })).toBeNull();
    expect(screen.queryByText(/hidden by design/)).toBeNull();
  });

  it("keeps the figures the node answers directly, which never go unmeasured", () => {
    // Shielded supply comes from the pools and the height from the node; neither goes through
    // a poller, so a price-feed outage must not blank them. The height is part of the hero
    // sentence, so it is matched as a substring.
    renderHome(unmeasured);
    expect(screen.getByText(/block 3,426,950/)).toBeDefined();
    expect(screen.getByText("SHIELDED SUPPLY")).toBeDefined();
  });

  it("cannot compute a market cap without a price, and says so", () => {
    // Market cap is supply x price. Supply alone is not a smaller market cap — it is an
    // unknown one, so the card must go unavailable rather than render supply-as-dollars.
    renderHome(unmeasured);
    expect(screen.getByText("ZEC MARKET CAP")).toBeDefined();
    expect(screen.getByText(/needs a price to compute/)).toBeDefined();
  });

  it("computes market cap from circulating supply and price when both are known", () => {
    renderHome(measured);
    expect(screen.getByText("ZEC MARKET CAP")).toBeDefined();
    // 16,000,000 ZEC x $38.42 = $614.72M. Pinned exactly: a market cap that silently
    // rendered the supply, or dropped a magnitude, would still match a loose regex.
    expect(screen.getByText("$614.72M")).toBeDefined();
    expect(screen.getByText(/16\.00M ZEC circulating|16,000,000 ZEC circulating/)).toBeDefined();
  });

  it("names the network in the hero, so the mainnet claim is derived rather than assumed", () => {
    renderHome(measured);
    expect(screen.getByText(/zcash mainnet · block/)).toBeDefined();
  });
});

/**
 * The photographic backdrop: decorative (a screen reader never hears it) and responsive (three
 * widths in both formats, since a single URL would blur a 2× laptop or cost a phone the
 * largest cut).
 */
describe("HomePage city backdrop", () => {
  it("is invisible to assistive technology and offers every cut in both formats", () => {
    const { container } = renderHome(measured);
    const img = container.querySelector<HTMLImageElement>("img[src^='/hero-city/']");
    expect(img).not.toBeNull();
    expect(img!.alt).toBe("");
    expect(img!.closest("[aria-hidden='true']")).not.toBeNull();
    expect(img!.getAttribute("fetchpriority") ?? img!.getAttribute("fetchPriority")).toBe("high");

    const webp = container.querySelector("source[type='image/webp']")?.getAttribute("srcset") ?? "";
    for (const w of [1280, 1920, 2560]) {
      expect(webp).toContain(`/hero-city/city-${w}.webp ${w}w`);
      expect(img!.srcset).toContain(`/hero-city/city-${w}.jpg ${w}w`);
    }
  });

  it("keeps the grade layer, which is what makes text over the image readable", () => {
    const { container } = renderHome(measured);
    expect(container.querySelector(".hero-city-grade")).not.toBeNull();
  });

  it("carries the plate class that hue-rotates the photograph with the theme", () => {
    // The plate is monochrome green, so a hue rotation is an exact recolour: one class, no
    // second asset.
    const { container } = renderHome(measured);
    const img = container.querySelector<HTMLImageElement>("img[src^='/hero-city/']")!;
    expect(img.classList.contains("hero-city-plate")).toBe(true);
  });
});

/**
 * The testnet homepage: the hero names testnet, the USD cards are absent (TAZ has no price, so
 * absence, not "unavailable"), and the cross-chain panel, whose routes 404 there, is absent.
 */
describe("HomePage on the testnet deployment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function renderTestnetHome(chain: ChainInfo) {
    vi.stubEnv("NEXT_PUBLIC_NETWORK", "testnet");
    vi.resetModules();
    const { HomePage: TestnetHomePage } = await import("../HomePage");
    return render(
      <TestnetHomePage
        chain={chain}
        pools={pools}
        latestBlocks={[]}
        latestTxs={[]}
        latestTransfers={[]}
      />,
    );
  }

  it("names the network in the hero", async () => {
    await renderTestnetHome(measured);
    expect(screen.getByText(/zcash testnet · block/)).toBeDefined();
    expect(screen.queryByText(/zcash mainnet/)).toBeNull();
  });

  it("shows no USD figure and no USD card — not even as unavailable", async () => {
    // `measured` carries a price on purpose: even a data source that CLAIMS a price
    // (a misconfigured one) must not get a dollar onto the testnet homepage.
    await renderTestnetHome(measured);
    expect(screen.queryByText("ZEC MARKET CAP")).toBeNull();
    expect(screen.queryByText("ZEC PRICE")).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("has no cross-chain panel, matching the 404'd routes", async () => {
    await renderTestnetHome(measured);
    expect(screen.queryByText(/cross-chain/i)).toBeNull();
  });

  it("denominates amounts in TAZ, never ZEC", async () => {
    await renderTestnetHome(measured);
    expect(screen.getByText(/TAZ/)).toBeDefined();
    expect(screen.queryByText(/\bZEC\b/)).toBeNull();
  });
});
