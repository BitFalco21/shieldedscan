import { describe, expect, it } from "vitest";
import markets from "./fixtures/coingecko-markets.json";
import { parseCoinMarkets, parseMarketRow, parseStablecoinIds, toSnapshot } from "../market-caps";
import { eligibleAssets } from "@/domain";

/**
 * `fixtures/coingecko-markets.json` is nine rows lifted verbatim from a live `/coins/markets`
 * response, chosen for their shapes: Zcash, the two largest assets, a stablecoin, a tokenised
 * fund, two freely traded tokens just above Zcash, and one asset that has since fallen below.
 * Verbatim, so an upstream field rename fails here.
 */
const STABLECOIN_IDS = new Set(["tether", "usd-coin", "usds"]);

describe("parseMarketRow", () => {
  it("keeps the upstream's market cap rather than recomputing price x supply", () => {
    const raw = markets.find((m) => m.id === "bitcoin")!;
    const btc = parseMarketRow(raw, STABLECOIN_IDS)!;

    // The upstream's own figure, byte for byte — not a golden constant, which would only
    // assert what today's fixture happens to hold.
    expect(btc.marketCapUsd).toBe(raw.market_cap);
    // The two are genuinely different numbers; storing our own product would publish a
    // figure the source does not stand behind.
    expect(btc.marketCapUsd).not.toBeCloseTo(btc.priceUsd * btc.circulatingSupply, 0);
  });

  it("uppercases the ticker and flags stablecoins from the category", () => {
    const usdt = parseMarketRow(
      markets.find((m) => m.id === "tether"),
      STABLECOIN_IDS,
    )!;

    expect(usdt.symbol).toBe("USDT");
    expect(usdt.isStablecoin).toBe(true);
  });

  it("drops a row missing any figure rather than zero-filling it", () => {
    const base = {
      id: "x",
      symbol: "x",
      name: "X",
      market_cap: 1,
      current_price: 1,
      circulating_supply: 1,
    };

    expect(parseMarketRow({ ...base, market_cap: null }, STABLECOIN_IDS)).toBeNull();
    expect(parseMarketRow({ ...base, current_price: null }, STABLECOIN_IDS)).toBeNull();
    expect(parseMarketRow({ ...base, circulating_supply: undefined }, STABLECOIN_IDS)).toBeNull();
    // A zero market cap would sort to the bottom of the picker and render as a real figure.
    expect(parseMarketRow({ ...base, market_cap: 0 }, STABLECOIN_IDS)).toBeNull();
    // `typeof x === "number"` accepts NaN; this must not.
    expect(parseMarketRow({ ...base, market_cap: Number.NaN }, STABLECOIN_IDS)).toBeNull();
  });

  it("keeps a null rank without inventing one", () => {
    expect(
      parseMarketRow(
        { id: "x", symbol: "x", name: "X", market_cap: 1, current_price: 1, circulating_supply: 1 },
        STABLECOIN_IDS,
      )?.rank,
    ).toBeNull();
  });
});

describe("parseCoinMarkets", () => {
  it("maps the captured response and throws on a body that is not a list", () => {
    expect(parseCoinMarkets(markets, STABLECOIN_IDS)).toHaveLength(markets.length);
    expect(() => parseCoinMarkets({ error: "rate limited" }, STABLECOIN_IDS)).toThrow(
      /unrecognised/,
    );
  });
});

describe("parseStablecoinIds", () => {
  it("collects ids and throws on a body that is not a list", () => {
    expect(parseStablecoinIds([{ id: "tether" }, { id: "usd-coin" }, { nope: 1 }])).toEqual(
      new Set(["tether", "usd-coin"]),
    );
    expect(() => parseStablecoinIds({ status: {} })).toThrow(/unrecognised/);
  });
});

describe("toSnapshot", () => {
  it("splits Zcash out of the list", () => {
    const snapshot = toSnapshot(parseCoinMarkets(markets, STABLECOIN_IDS), 1_786_535_600)!;

    expect(snapshot.zec.symbol).toBe("ZEC");
    expect(snapshot.assets.some((a) => a.id === "zcash")).toBe(false);
  });

  it("returns null when the response carried no Zcash row", () => {
    // Every figure the page states is a ratio against Zcash, so a snapshot without it is not
    // a partial answer — there is nothing to compare.
    const withoutZec = parseCoinMarkets(markets, STABLECOIN_IDS).filter((a) => a.id !== "zcash");
    expect(toSnapshot(withoutZec, 1_786_535_600)).toBeNull();
  });
});

describe("the captured response, end to end through the domain filter", () => {
  it("offers the freely-traded assets above Zcash and nothing else", () => {
    const snapshot = toSnapshot(parseCoinMarkets(markets, STABLECOIN_IDS), 1_786_535_600)!;

    // Bitcoin and Ethereum are above; Dogecoin is above; RAIN and LEO sit just above and are
    // deliberately kept. Tether is excluded by the category, Figure Heloc by the domain's
    // not-a-valuation list, and Monero is genuinely below Zcash.
    expect(eligibleAssets(snapshot).map((a) => a.id)).toEqual([
      "bitcoin",
      "ethereum",
      "dogecoin",
      "rain",
      "leo-token",
    ]);
  });
});
