import { describe, expect, it } from "vitest";
import {
  encodeSwapWatermark,
  formatSwapUsdAtSwap,
  parseSwapWatermark,
  swapCounterpartLabel,
  swapIsComplete,
  type SwapFigures,
} from "../swap";

// A real inbound crossing, from /v1/crosschain/transfers on 2026-08-29.
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
  zcashTxid: "8b4f6fa852997131f653ab9913b51b1ce2abf28a53c24be633d18ad572628781",
};

describe("swapCounterpartLabel", () => {
  // A token is named with its chain; a chain's own coin is not.
  it("names the chain for a token", () => {
    expect(swapCounterpartLabel(USDC)).toBe("507,500 USDC on Ethereum");
  });

  it("does not repeat the chain for its own native coin", () => {
    expect(swapCounterpartLabel(BTC)).toBe("2.50 BTC");
  });

  // A "<CHAIN> asset" placeholder is not a ticker.
  it("refuses an unidentified token rather than inventing a ticker", () => {
    expect(swapCounterpartLabel({ ...USDC, counterpartAsset: "ETH asset" })).toBeNull();
  });

  // assetTickerIsKnown("") is true, so a blank ticker needs its own guard.
  it.each(["", "  "])("refuses a blank ticker %j rather than a double space", (asset) => {
    expect(swapCounterpartLabel({ ...USDC, counterpartAsset: asset })).toBeNull();
  });

  // A fixed two decimals would render a real 0.004 BTC crossing as "0.00 BTC".
  it("gives a small non-native amount real precision instead of a display zero", () => {
    const label = swapCounterpartLabel({ ...BTC, counterpartAmount: 0.004 });
    expect(label).not.toBe("0.00 BTC");
    expect(label).toBe("0.004 BTC");
  });

  // Checked across a range of magnitudes, not one value.
  it.each([0.5, 0.05, 0.005, 0.0005, 0.00005])(
    "never renders a positive amount of %s as an all-zero string",
    (amount) => {
      const label = swapCounterpartLabel({ ...BTC, counterpartAmount: amount });
      expect(label).not.toBeNull();
      const rendered = (label as string).replace(" BTC", "");
      expect(rendered).not.toMatch(/^0\.0*$/);
      expect(rendered).toMatch(/\.\d*[1-9]/);
      expect(Number(rendered)).not.toBe(0);
    },
  );
});

describe("swapIsComplete", () => {
  it("accepts a crossing carrying every figure the card prints", () => {
    expect(swapIsComplete(USDC)).toBe(true);
    expect(swapIsComplete(BTC)).toBe(true);
  });

  // An unpriced crossing cannot be posted: the card has no value to state.
  it("refuses a crossing with no published USD", () => {
    expect(swapIsComplete({ ...USDC, usdAtSwap: null })).toBe(false);
  });

  it.each([
    ["zec amount", { zecAmountZat: 0 }],
    ["counterpart amount", { counterpartAmount: 0 }],
    ["venue", { venue: "" }],
    ["txid", { zcashTxid: "" }],
  ])("refuses a crossing missing the %s", (_label, patch) => {
    expect(swapIsComplete({ ...USDC, ...patch } as SwapFigures)).toBe(false);
  });

  it("refuses an unidentified token, since the card could not label it", () => {
    expect(swapIsComplete({ ...USDC, counterpartAsset: "ETH asset" })).toBe(false);
  });

  // `NaN <= 0` and `Infinity <= 0` are both false, so a bound check alone would let these
  // through as "NaN USDC" or "∞ USDC".
  it.each([
    ["zec amount", "zecAmountZat" as const],
    ["counterpart amount", "counterpartAmount" as const],
  ])("refuses a non-finite %s (NaN, Infinity, -Infinity)", (_label, field) => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(swapIsComplete({ ...USDC, [field]: bad })).toBe(false);
    }
  });

  // The txid is the post's checkable claim, so a malformed one is refused.
  it.each([
    ["too short", "ba191814decc7c7c425f9141b39ca1b6a72deb662ea474cb12a75cd3bd83db7"],
    ["too long", `${USDC.zcashTxid}a`],
    ["uppercase", USDC.zcashTxid.toUpperCase()],
    ["non-hex characters", `${USDC.zcashTxid.slice(0, 63)}z`],
    ["whitespace only", "  "],
  ])("refuses a malformed txid: %s", (_label, zcashTxid) => {
    expect(swapIsComplete({ ...USDC, zcashTxid })).toBe(false);
  });
});

describe("formatSwapUsdAtSwap", () => {
  // One formatter backs the card and the post text, so both round to the whole dollar at
  // every magnitude.
  it.each([
    [99.53, "$100"],
    [500_639.49, "$500,639"],
    [1, "$1"],
  ])("renders %s as %s, the one figure both the card and the tweet use", (value, expected) => {
    expect(formatSwapUsdAtSwap(value)).toBe(expected);
  });
});

/**
 * A malformed watermark must be a hard error, never silently "no watermark". `Number()` is
 * too permissive (`"0x10"`, `"1e5"`), so every non-canonical shape must throw.
 */
describe("parseSwapWatermark", () => {
  it("round-trips exactly what encodeSwapWatermark produces", () => {
    const encoded = encodeSwapWatermark(1_788_000_000, "maya-abc123");
    expect(encoded).toBe("1788000000:maya-abc123");
    expect(parseSwapWatermark(encoded)).toEqual({ timestamp: 1_788_000_000, id: "maya-abc123" });
  });

  it.each([
    ["no separator at all", "1788000000"],
    ["empty string", ""],
    ["whitespace only", "  "],
    ["a bare negative number", "-1"],
    ["a bare hex-looking number", "0x10"],
    ["a bare exponential-notation number", "1e5"],
    ["a bare Infinity", "Infinity"],
    ["a bare NaN", "NaN"],
  ])("throws on a bare malformed value: %s", (_label, raw) => {
    expect(() => parseSwapWatermark(raw)).toThrow();
  });

  it.each([
    ["negative timestamp", "-1:abc"],
    ["hex-looking timestamp", "0x10:abc"],
    ["exponential-notation timestamp", "1e5:abc"],
    ["Infinity as a timestamp", "Infinity:abc"],
    ["NaN as a timestamp", "NaN:abc"],
    ["whitespace timestamp", "  :abc"],
    ["empty id", "1788000000:"],
  ])("throws on a malformed composite value: %s", (_label, raw) => {
    expect(() => parseSwapWatermark(raw)).toThrow();
  });
});
