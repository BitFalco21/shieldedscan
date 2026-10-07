import { describe, expect, it } from "vitest";
import { formatMoneyCompact, formatMoneyExact, formatZatMoneyApprox, isBtcUnit } from "../money";
import { formatUsdCompact, formatUsdExact, formatZatUsdApprox } from "../format";

/**
 * Currency-aware money formatting for the agent.
 *
 * The load-bearing property is the first describe: USD must come out byte-identical to the
 * existing formatters, so adding currencies never reformats the default case.
 */
describe("USD is unchanged", () => {
  const values = [0, 0.004, 1, 1234.5678, 1_287_600_000_000];

  it("formats exactly as formatUsdExact did", () => {
    for (const v of values) expect(formatMoneyExact(v, "usd")).toBe(formatUsdExact(v));
  });

  it("formats compactly as formatUsdCompact did", () => {
    for (const v of values) expect(formatMoneyCompact(v, "usd")).toBe(formatUsdCompact(v));
  });

  it("values a zatoshi amount as formatZatUsdApprox did", () => {
    expect(formatZatMoneyApprox(100_000_000, 786.44, 1, "usd")).toBe(
      formatZatUsdApprox(100_000_000, 786.44),
    );
  });
});

describe("other currencies", () => {
  it("uses the currency's own symbol and its own decimal convention", () => {
    expect(formatMoneyExact(1234.5678, "eur")).toBe("€1,234.57");
    // JPY has no minor unit, and Intl knows it. A hardcoded 2 decimals would print ¥1,234.57,
    // which is not a quantity of yen that exists.
    expect(formatMoneyExact(1234.5678, "jpy")).toBe("¥1,235");
  });

  it("applies the FX rate to the USD price rather than to the formatted string", () => {
    // 1 ZEC at $100 with 1 USD = 0.9 EUR is €90.
    expect(formatZatMoneyApprox(100_000_000, 100, 0.9, "eur")).toBe("≈ €90.00");
  });

  it("keeps the ≈ that tells the model this is a valuation", () => {
    // The qualifier lives inside the string because a paraphrase drops anything beside it.
    expect(formatZatMoneyApprox(100_000_000, 100, 0.9, "eur")).toMatch(/^≈ /);
  });
});

describe("BTC is a unit, not a currency", () => {
  it("is recognised as one", () => {
    expect(isBtcUnit("btc")).toBe(true);
    expect(isBtcUnit("eur")).toBe(false);
  });

  it("carries eight decimals, because that is what a satoshi is", () => {
    // 1 ZEC at $100 with 1 USD = 0.00001 BTC is 0.001 BTC. Two decimals would print "0.00"
    // and read as nothing.
    expect(formatZatMoneyApprox(100_000_000, 100, 0.00001, "btc")).toBe("≈ 0.00100000 BTC");
  });

  it("never renders a real holding as zero", () => {
    expect(formatZatMoneyApprox(1000, 100, 0.00001, "btc")).not.toMatch(/^≈ 0\.00000000 BTC$/);
  });
});
