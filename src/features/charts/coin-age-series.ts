import { COIN_AGE_BANDS, type CoinAgeBandKey, type CoinAgePoint } from "@/domain/coin-age";
import type { AreaSeries } from "@/components/StackedAreaChart";

/**
 * The coin-age chart's bands, oldest at the bottom: the coins that have not moved in years are
 * the base the younger, moving ones sit on. One hue stepped in lightness, deep for the oldest and
 * hot for the youngest, so age reads as a sequence rather than as categories.
 */
export const AGE_STACK: readonly CoinAgeBandKey[] = [...COIN_AGE_BANDS].reverse().map((b) => b.key);

export const AGE_BAND_CLASS: Readonly<Record<CoinAgeBandKey, string>> = Object.fromEntries(
  COIN_AGE_BANDS.map((b, i) => [b.key, `age-band-${i + 1}`]),
) as Record<CoinAgeBandKey, string>;

const LABEL = Object.fromEntries(COIN_AGE_BANDS.map((b) => [b.key, b.label])) as Record<
  CoinAgeBandKey,
  string
>;

/** A month-end's start-of-month timestamp, for the month axis. */
export const monthStartOf = (asOf: string) => Date.parse(`${asOf.slice(0, 7)}-01T00:00:00Z`) / 1000;

export function ageBands(points: readonly CoinAgePoint[]): AreaSeries[] {
  return AGE_STACK.map((key) => ({
    key,
    label: LABEL[key],
    colorClass: AGE_BAND_CLASS[key],
    values: points.map((p) => p.bands.find((b) => b.key === key)?.valueZat ?? null),
  }));
}
