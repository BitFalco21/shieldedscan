import { formatCount, formatUsd, formatUsdExact } from "@/lib/format";
// The solution rate has one formatter, `/mining`'s.
export { formatSolRate } from "@/features/mining/format";

/** A tariff, always to the tenth of a cent — "$0.268 / kWh". */
export function formatTariff(usdPerKwh: number): string {
  return `$${usdPerKwh.toFixed(3)} / kWh`;
}

/** A break-even tariff, to the tenth of a cent. */
export function formatBreakEven(usdPerKwh: number): string {
  return `$${usdPerKwh.toFixed(3)}`;
}

export function formatKwh(kwh: number): string {
  return `${formatCount(Math.round(kwh))} kWh`;
}

/** A cost per ZEC follows the site's `formatUsd` rule: cents below $100, whole dollars above. */
export { formatUsdExact, formatUsd as formatCost };
