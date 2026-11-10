/**
 * How long transparent ZEC has sat unspent: every unspent transparent output on a day, banded by
 * how long before that day it was created.
 *
 * The source is a matrix of every transparent output ever made, keyed by the UTC day of the
 * block that created it and the UTC day of the block that spent it (none while unspent). Any
 * day's distribution is read from it as the outputs created on or before the day and not spent
 * by its end, so the value under every band adds up to the node's transparent pool at that day's
 * closing block, to the zatoshi.
 *
 * A block's day is the latest UTC day of any header timestamp at or below its height. Miner
 * timestamps can run backwards across midnight (block 900,190 is stamped a day before 900,189);
 * taking the running latest keeps every day a contiguous run of heights, so "created on or
 * before day D" and "at or below D's closing height" are the same set of outputs.
 *
 * Bands are calendar spans back from the day measured: a coin is in "1-3 months" when it was
 * created after the same date three months earlier and on or before the same date one month
 * earlier. Calendar arithmetic rather than fixed day counts, so "1 year" is the same date a year
 * before, leap years included.
 */

export const COIN_AGE_BANDS = [
  { key: "lt1w", label: "< 1 week", short: "<1w", within: { days: 7 } },
  { key: "1w1m", label: "1 week – 1 month", short: "1w–1m", within: { months: 1 } },
  { key: "1m3m", label: "1–3 months", short: "1–3m", within: { months: 3 } },
  { key: "3m6m", label: "3–6 months", short: "3–6m", within: { months: 6 } },
  { key: "6m1y", label: "6 months – 1 year", short: "6m–1y", within: { months: 12 } },
  { key: "1y2y", label: "1–2 years", short: "1–2y", within: { months: 24 } },
  { key: "2y3y", label: "2–3 years", short: "2–3y", within: { months: 36 } },
  { key: "3y5y", label: "3–5 years", short: "3–5y", within: { months: 60 } },
  { key: "5y", label: "5 years or more", short: "5y+", within: null },
] as const satisfies readonly {
  key: string;
  label: string;
  short: string;
  /** The band holds coins created after `asOf` minus this; null for the oldest, open band. */
  within: { days: number } | { months: number } | null;
}[];

export type CoinAgeBandKey = (typeof COIN_AGE_BANDS)[number]["key"];

/** A UTC day as `YYYY-MM-DD`. */
type Day = string;

function parseDay(day: Day): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`not a UTC day: ${day}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

const formatDay = (ms: number): Day => new Date(ms).toISOString().slice(0, 10);

/**
 * `day` moved back by whole days or calendar months. A month step lands on the same date, or the
 * month's last day when the date does not exist there (31 March less one month is 28 or 29
 * February), the convention SQL's `date - interval` follows.
 */
export function dayBefore(day: Day, by: { days: number } | { months: number }): Day {
  const { y, m, d } = parseDay(day);
  if ("days" in by) return formatDay(Date.UTC(y, m - 1, d) - by.days * 86_400_000);
  const months = y * 12 + (m - 1) - by.months;
  const ty = Math.floor(months / 12);
  const tm = months - ty * 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return formatDay(Date.UTC(ty, tm, Math.min(d, last)));
}

const dayAfter = (day: Day): Day => dayBefore(day, { days: -1 });

/**
 * The first day of each band, oldest band last: band `i` holds coins created on or after
 * `starts[i]` (and before `starts[i - 1]`); the open oldest band starts at null.
 */
export function coinAgeBandStarts(asOf: Day): (Day | null)[] {
  return COIN_AGE_BANDS.map((b) =>
    b.within === null ? null : dayAfter(dayBefore(asOf, b.within)),
  );
}

/** Which band a coin created on `creationDay` falls in on `asOf`. */
export function coinAgeBandIndex(creationDay: Day, asOf: Day, starts = coinAgeBandStarts(asOf)) {
  if (creationDay > asOf) throw new Error(`created ${creationDay}, after ${asOf}`);
  return starts.findIndex((s) => s === null || creationDay >= s);
}

/** Unspent value created on one day, still unspent at the day measured. */
export interface CoinAgeCell {
  creationDay: Day;
  valueZat: number;
  outputs: number;
}

export interface CoinAgeBandTotal {
  key: CoinAgeBandKey;
  valueZat: number;
  outputs: number;
}

/** Every band, oldest last, each the sum of the cells it holds; an empty band is a zero. */
export function coinAgeBands(cells: readonly CoinAgeCell[], asOf: Day): CoinAgeBandTotal[] {
  const starts = coinAgeBandStarts(asOf);
  const out = COIN_AGE_BANDS.map((b) => ({ key: b.key, valueZat: 0, outputs: 0 }));
  for (const c of cells) {
    const band = out[coinAgeBandIndex(c.creationDay, asOf, starts)]!;
    band.valueZat += c.valueZat;
    band.outputs += c.outputs;
  }
  return out;
}

/** One day's distribution, with the block it was read at. */
export interface CoinAgePoint {
  /** The UTC day measured: its distribution is at the end of it. */
  asOf: Day;
  /** The day's closing block, at which the bands add up to the transparent pool. */
  height: number;
  bands: CoinAgeBandTotal[];
}

/** Every band's value summed: the transparent pool at the point's height. */
export const coinAgeTotalZat = (p: Pick<CoinAgePoint, "bands">) =>
  p.bands.reduce((s, b) => s + b.valueZat, 0);

/** Every month's last day the table has closed, and the newest block it covers. */
export interface CoinAgeSeries {
  /** Oldest first. */
  monthEnds: CoinAgePoint[];
  /** The newest applied block, mid-day: its `asOf` is that block's day so far. */
  latest: CoinAgePoint | null;
}
