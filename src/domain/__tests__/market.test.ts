import { describe, expect, it } from "vitest";
import {
  DEFAULT_VS_ASSET_ID,
  compareToZec,
  compareToZecAll,
  eligibleAssets,
  parseVsParam,
  resolveComparison,
  type MarketAsset,
  type MarketSnapshot,
} from "../market";

/**
 * Figures read from the live upstream, kept exact so the arithmetic test below checks real
 * numbers with a real discrepancy in them.
 */
const asset = (over: Partial<MarketAsset> & Pick<MarketAsset, "id">): MarketAsset => ({
  symbol: over.id.slice(0, 3).toUpperCase(),
  name: over.id,
  marketCapUsd: 1_000,
  priceUsd: 1,
  circulatingSupply: 1_000,
  rank: null,
  isStablecoin: false,
  ...over,
});

const ZEC = asset({
  id: "zcash",
  symbol: "ZEC",
  marketCapUsd: 8_249_897_604,
  priceUsd: 489.43,
  circulatingSupply: 16_871_956.4155448,
  rank: 15,
});

const BTC = asset({
  id: "bitcoin",
  symbol: "BTC",
  marketCapUsd: 1_287_602_000_000,
  priceUsd: 64_500,
  rank: 1,
});

const snapshot = (assets: MarketAsset[], zec = ZEC): MarketSnapshot => ({
  asOf: 1_786_535_600,
  zec,
  assets,
});

describe("compareToZec", () => {
  it("anchors on the market-cap ratio, so the two printed caps reconcile with the multiple", () => {
    const result = compareToZec(ZEC, BTC)!;

    // The property, not a golden number: a reader who divides the two caps shown on the page
    // must land on the multiple shown beside them.
    expect(result.multiple).toBeCloseTo(BTC.marketCapUsd / ZEC.marketCapUsd, 10);
    // ...and price x multiple must be the implied price, exactly.
    expect(result.impliedPriceUsd).toBeCloseTo(ZEC.priceUsd * result.multiple, 10);
  });

  it("does NOT derive the implied price by dividing the cap by supply", () => {
    // The two arithmetics disagree because the upstream's market cap is not exactly its
    // price times its supply, so a "simplification" to a single division fails here.
    const result = compareToZec(ZEC, BTC)!;
    const bySupply = BTC.marketCapUsd / ZEC.circulatingSupply;

    expect(result.impliedPriceUsd).not.toBeCloseTo(bySupply, 0);
    // Small enough to be invisible in review, large enough to show at the precision printed.
    expect(Math.abs(result.impliedPriceUsd - bySupply) / bySupply).toBeLessThan(0.005);
  });

  it("returns null rather than an infinity when Zcash has no usable market cap", () => {
    expect(compareToZec(asset({ id: "zcash", marketCapUsd: 0 }), BTC)).toBeNull();
  });
});

describe("eligibleAssets", () => {
  it("keeps only assets larger than Zcash, largest first", () => {
    const smaller = asset({ id: "monero", marketCapUsd: 7_494_000_000 });
    const eth = asset({ id: "ethereum", marketCapUsd: 230_794_000_000 });

    expect(eligibleAssets(snapshot([smaller, eth, BTC])).map((a) => a.id)).toEqual([
      "bitcoin",
      "ethereum",
    ]);
  });

  it("excludes stablecoins by the upstream's own flag, so a new one needs no code change", () => {
    const newStable = asset({
      id: "some-stablecoin-that-does-not-exist-yet",
      marketCapUsd: 90_000_000_000,
      isStablecoin: true,
    });

    expect(eligibleAssets(snapshot([newStable, BTC])).map((a) => a.id)).toEqual(["bitcoin"]);
  });

  it("excludes an asset whose market cap is not a valuation", () => {
    const heloc = asset({ id: "figure-heloc", marketCapUsd: 21_983_454_157 });

    expect(eligibleAssets(snapshot([heloc, BTC])).map((a) => a.id)).toEqual(["bitcoin"]);
  });

  it("keeps freely-traded tokens that merely sit close above Zcash", () => {
    // LEO and RAIN were both considered for exclusion and deliberately kept: excluding a real
    // asset is the same class of error as including a fake one.
    const leo = asset({ id: "leo-token", marketCapUsd: 8_380_845_094 });
    const rain = asset({ id: "rain", marketCapUsd: 9_239_573_905 });

    expect(eligibleAssets(snapshot([leo, rain])).map((a) => a.id)).toEqual(["rain", "leo-token"]);
  });
});

describe("parseVsParam", () => {
  it("accepts the upstream's id shape, case- and whitespace-insensitively", () => {
    expect(parseVsParam("bitcoin")).toBe("bitcoin");
    expect(parseVsParam(" Ethereum ")).toBe("ethereum");
    expect(parseVsParam("near-intents")).toBe("near-intents");
  });

  it("rejects anything that is not shaped like an id", () => {
    for (const raw of ["", "  ", "-leading", "a".repeat(65), "<script>", "a b", "../../etc"]) {
      expect(parseVsParam(raw)).toBeNull();
    }
    expect(parseVsParam(undefined)).toBeNull();
  });
});

describe("resolveComparison", () => {
  it("falls back to Bitcoin when the URL names nothing", () => {
    const result = resolveComparison(snapshot([BTC, asset({ id: "ethereum" })]), null);

    expect(result.kind).toBe("comparison");
    expect(result.kind === "comparison" && result.comparison.counterpart.id).toBe(
      DEFAULT_VS_ASSET_ID,
    );
  });

  it("falls back to the largest eligible asset when Bitcoin is absent", () => {
    const eth = asset({ id: "ethereum", marketCapUsd: 230_794_000_000 });
    const bnb = asset({ id: "binancecoin", marketCapUsd: 81_714_000_000 });

    const result = resolveComparison(snapshot([bnb, eth]), null);
    expect(result.kind === "comparison" && result.comparison.counterpart.id).toBe("ethereum");
  });

  it("never substitutes a different asset for one that was explicitly named", () => {
    // A stale bookmark must not silently become a Bitcoin comparison: the reader would
    // believe they are looking at what they asked for.
    const xmr = asset({ id: "monero", marketCapUsd: 7_494_000_000 });
    const result = resolveComparison(snapshot([BTC, xmr]), "monero");

    expect(result).toEqual({ kind: "smaller", asset: xmr });
  });

  it("distinguishes an excluded LARGER asset from a smaller one", () => {
    const usdt = asset({ id: "tether", marketCapUsd: 183_019_000_000, isStablecoin: true });
    const result = resolveComparison(snapshot([BTC, usdt]), "tether");

    // Calling Tether "smaller than Zcash" would be flatly false.
    expect(result).toEqual({ kind: "not-comparable", asset: usdt });
  });

  it("reports an id it holds nothing for as unknown", () => {
    expect(resolveComparison(snapshot([BTC]), "not-a-real-asset")).toEqual({
      kind: "unknown",
      requestedId: "not-a-real-asset",
    });
  });

  it("reports none rather than a figure when nothing is eligible", () => {
    expect(resolveComparison(snapshot([asset({ id: "monero", marketCapUsd: 1 })]), null)).toEqual({
      kind: "none",
    });
  });
});

describe("compareToZecAll", () => {
  it("compares against every eligible asset, largest first", () => {
    const eth = asset({ id: "ethereum", marketCapUsd: 230_794_179_539 });
    const bnb = asset({ id: "binancecoin", marketCapUsd: 81_714_339_912 });
    const all = compareToZecAll(snapshot([bnb, BTC, eth]));
    expect(all.map((c) => c.counterpart.id)).toEqual(["bitcoin", "ethereum", "binancecoin"]);
  });

  it("agrees with compareToZec row for row", () => {
    // A row and the comparison page it links to must state the same multiple and price.
    const [row] = compareToZecAll(snapshot([BTC]));
    expect(row).toEqual(compareToZec(ZEC, BTC));
  });

  it("offers nothing that eligibleAssets excludes", () => {
    const usdt = asset({ id: "tether", marketCapUsd: 183_019_246_679, isStablecoin: true });
    const fund = asset({ id: "figure-heloc", marketCapUsd: 21_983_454_157 });
    const smaller = asset({ id: "monero", marketCapUsd: 3_000_000_000 });
    const all = compareToZecAll(snapshot([usdt, fund, smaller, BTC]));
    expect(all.map((c) => c.counterpart.id)).toEqual(["bitcoin"]);
  });

  it("is empty rather than infinite when Zcash has no market cap", () => {
    // `compareToZec` returns null here; the row is dropped rather than shown as Infinity.
    const zec = asset({ id: "zcash", symbol: "ZEC", marketCapUsd: 0, priceUsd: 489.43 });
    expect(compareToZecAll(snapshot([BTC], zec))).toEqual([]);
  });

  it("is empty when no asset is larger than Zcash", () => {
    expect(
      compareToZecAll(snapshot([asset({ id: "monero", marketCapUsd: 3_000_000_000 })])),
    ).toEqual([]);
  });
});
