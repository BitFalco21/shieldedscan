import { ZATS_PER_ZEC } from "@/domain/transaction";
/**
 * Money formatting in a currency other than the dollar.
 *
 * Every figure is `usdValue × rate`, where `rate` is units of the currency per one USD (the
 * convention `fx_rate_daily` stores, fiat and BTC alike). The multiplication happens on the
 * number, never on a formatted string, and happens here so the agent is handed a quotable
 * string rather than doing arithmetic.
 *
 * USD is the identity case and must stay byte-identical to `formatUsd*`; a test pins it.
 */

/**
 * BTC is a unit, not an ISO currency. `Intl` would render it with the two-decimal default for
 * an unknown code, turning a real holding into "0.01" or "0.00"; a satoshi is 1e-8, so eight
 * decimals is the honest grain.
 */
export const isBtcUnit = (currency: string): boolean => currency.toLowerCase() === "btc";

const intlCode = (currency: string): string => currency.toUpperCase();

/** An exact figure: `$1,234.57`, `€1,234.57`, `¥1,235`, `0.01010000 BTC`. */
export function formatMoneyExact(value: number, currency: string): string {
  if (isBtcUnit(currency)) {
    return `${value.toLocaleString("en-US", {
      minimumFractionDigits: 8,
      maximumFractionDigits: 8,
    })} BTC`;
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: intlCode(currency),
    // Not forced to 2 decimals: JPY, KRW and CLP have no minor unit, and Intl knows it.
    ...(currency.toLowerCase() === "usd"
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : {}),
  });
}

/**
 * A compact figure for large values: `$1.29T`, `€45.2B` — and the plain form below 1,000.
 *
 * The tier rule and sub-1,000 fallback mirror `formatUsdCompact`; a test asserts USD output is
 * byte-identical.
 */
export function formatMoneyCompact(value: number, currency: string): string {
  const abs = Math.abs(value);
  if (abs < 1_000) return formatMoneyPlain(value, currency);
  const [divisor, suffix] =
    abs >= 1_000_000_000_000
      ? [1_000_000_000_000, "T"]
      : abs >= 1_000_000_000
        ? [1_000_000_000, "B"]
        : abs >= 1_000_000
          ? [1_000_000, "M"]
          : [1_000, "K"];
  const scaled = value / divisor;
  if (isBtcUnit(currency)) {
    return `${scaled.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}${suffix} BTC`;
  }
  return (
    scaled.toLocaleString("en-US", {
      style: "currency",
      currency: intlCode(currency),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + suffix
  );
}

/**
 * The plain form: whole units at or above 100, two decimals below — `formatUsd`'s rule.
 *
 * BTC opts out: one ZEC is ~0.0101 BTC, so two decimals would print 0.01 or 0.00 for real
 * holdings.
 */
function formatMoneyPlain(value: number, currency: string): string {
  if (isBtcUnit(currency)) return formatMoneyExact(value, currency);
  const fractionDigits = Math.abs(value) >= 100 ? 0 : 2;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: intlCode(currency),
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/**
 * A zatoshi amount valued at a USD price and converted — carrying the `≈` that says it is a
 * valuation rather than a figure anyone paid.
 *
 * The qualifier is inside the string so a verbatim quote carries its own caveat.
 */
export function formatZatMoneyApprox(
  zat: number,
  priceUsd: number,
  rate: number,
  currency: string,
): string {
  return `≈ ${formatMoneyCompact((zat / ZATS_PER_ZEC) * priceUsd * rate, currency)}`;
}
