import type { Pool } from "pg";
import { readJsonCapped } from "./body-limit";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";

/**
 * Daily USD→currency rates, back to Zcash's launch, so a ZEC amount can be valued in another
 * currency without a second price history per currency:
 *
 *     ZEC in currency X on day D  =  ZEC/USD close(D)  ×  rate(D, X)
 *
 * `rate` is therefore always units of X per one USD, whatever the source. BTC is stored as the
 * reciprocal of Yahoo's USD-per-BTC for that reason: two conventions in one column would make the
 * multiplication wrong for half the rows.
 *
 * Not CoinGecko's `vs_currencies`: its demo tier refuses ranges older than 365 days, so it cannot
 * answer the historical half, and using it for the live half alone would give one fact two
 * methods.
 */

const FRANKFURTER = "https://api.frankfurter.dev/v1";

export interface FxRate {
  /** The calendar day this rate is used FOR. */
  day: string;
  /** ISO 4217, lowercase. `btc` for the one non-fiat. */
  currency: string;
  /** Units of `currency` per one USD. */
  rate: number;
  /** The day the rate was PUBLISHED on — differs from `day` on a carried day. */
  rateDay: string;
  source: "ecb" | "yahoo";
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": "shieldedscan/1.0 (+https://shieldedscan.xyz)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return readJsonCapped(response);
}

/**
 * ECB day → { currency: rate }, for the days the ECB actually published.
 *
 * Weekends and TARGET holidays are absent; `expandWithCarry` fills them and marks them as carried.
 *
 * Always fetched as a range: Frankfurter answers a request for a single non-business day with the
 * previous business day's row at HTTP 200 (only the `date` field differs), so a per-day ingest
 * would store Friday's rate under Saturday with a wrong `rate_day`.
 */
export function parseEcbRange(body: unknown): Map<string, Record<string, number>> {
  const rates = (body as { rates?: Record<string, Record<string, unknown>> })?.rates ?? {};
  const out = new Map<string, Record<string, number>>();
  for (const [day, row] of Object.entries(rates)) {
    const clean: Record<string, number> = {};
    for (const [currency, value] of Object.entries(row)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      clean[currency.toLowerCase()] = value;
    }
    if (Object.keys(clean).length > 0) out.set(day, clean);
  }
  return out;
}

export async function fetchEcbRange(
  from: string,
  to: string,
): Promise<Map<string, Record<string, number>>> {
  return parseEcbRange(await fetchJson(`${FRANKFURTER}/${from}..${to}?base=USD`));
}

/**
 * The currencies the ECB published on every day in the range: the offered set.
 *
 * Derived rather than hardcoded, because a currency can stop being published mid-history (for
 * example on euro adoption, or a suspension) and another can start late (`isk` only from 2018), so
 * the vendor's current list is not the set with a rate for every day.
 *
 * An empty range yields an empty set, never "everything": a failed fetch must not read as a full
 * list.
 */
export function deriveOfferedCurrencies(byDay: Map<string, Record<string, number>>): string[] {
  const days = [...byDay.values()];
  if (days.length === 0) return [];
  const [first, ...rest] = days;
  return Object.keys(first!)
    .filter((currency) => rest.every((row) => currency in row))
    .sort();
}

const nextDay = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * One row per calendar day, carrying the last published rate across the days the ECB skips.
 *
 * The ECB publishes business days only (roughly 30% of calendar days have no rate). Every day still
 * gets a row, and `rateDay` names the day the rate was published, so a carried rate is visibly
 * carried. Zcash's launch day, 2016-10-29, is itself a Saturday.
 *
 * Nothing is emitted before the first published rate: carrying backward would date a rate to
 * before it existed.
 */
export function expandWithCarry(
  byDay: Map<string, Record<string, number>>,
  currencies: readonly string[],
  fromDay: string,
  toDay: string,
): FxRate[] {
  const out: FxRate[] = [];
  const held = new Map<string, { rate: number; rateDay: string }>();
  for (let day = fromDay; day <= toDay; day = nextDay(day)) {
    const published = byDay.get(day);
    for (const currency of currencies) {
      const fresh = published?.[currency];
      if (fresh !== undefined) held.set(currency, { rate: fresh, rateDay: day });
      const carried = held.get(currency);
      if (carried === undefined) continue; // before this currency's first publication
      out.push({ day, currency, rate: carried.rate, rateDay: carried.rateDay, source: "ecb" });
    }
  }
  return out;
}

const YAHOO_BTC =
  "https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?period1=1477612800&period2=%END%&interval=1d";

/**
 * BTC, as units of BTC per one USD: the reciprocal of Yahoo's USD-per-BTC close.
 *
 * In the same table as the fiats because it is the same arithmetic against the same USD close.
 * `rateDay` always equals `day`: BTC trades every day. Yahoo's BTC-USD covers the whole span with
 * no gaps, so this leg needs no second vendor.
 */
export function parseYahooBtc(body: unknown): FxRate[] {
  const result = (
    body as {
      chart?: {
        result?: {
          timestamp?: number[];
          indicators?: { quote?: { close?: (number | null)[] }[] };
        }[];
      };
    }
  )?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const out: FxRate[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = closes[i];
    const at = timestamps[i];
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    if (typeof at !== "number") continue;
    const day = utcDayFromSeconds(at);
    out.push({ day, currency: "btc", rate: 1 / close, rateDay: day, source: "yahoo" });
  }
  return out;
}

export async function fetchYahooBtcDaily(nowSeconds: number): Promise<FxRate[]> {
  return parseYahooBtc(await fetchJson(YAHOO_BTC.replace("%END%", String(nowSeconds))));
}

/**
 * Chunked so one statement never carries a decade of rows; mirrors `upsertPrices`. Idempotent:
 * a re-run refreshes, and a republished rate overwrites by (day, currency).
 */
export async function upsertFxRates(pool: Pool, rates: readonly FxRate[]): Promise<number> {
  if (rates.length === 0) return 0;
  const now = Math.floor(Date.now() / 1000);
  let written = 0;
  for (let i = 0; i < rates.length; i += 500) {
    const chunk = rates.slice(i, i + 500);
    const values = chunk
      .map(
        (_, n) =>
          `($${n * 6 + 1}::date, $${n * 6 + 2}, $${n * 6 + 3}, $${n * 6 + 4}::date, $${n * 6 + 5}, $${n * 6 + 6})`,
      )
      .join(", ");
    const params = chunk.flatMap((r) => [r.day, r.currency, r.rate, r.rateDay, r.source, now]);
    const res = await pool.query(
      `INSERT INTO fx_rate_daily (day, currency, rate, rate_day, source, fetched_at)
       VALUES ${values}
       ON CONFLICT (day, currency) DO UPDATE SET rate = EXCLUDED.rate,
                                                 rate_day = EXCLUDED.rate_day,
                                                 source = EXCLUDED.source,
                                                 fetched_at = EXCLUDED.fetched_at`,
      params,
    );
    written += res.rowCount ?? 0;
  }
  return written;
}

/** The launch day of the ZEC price series this table exists to convert. */
const LAUNCH_DAY = "2016-10-29";

/**
 * Offered fiats, carried across ECB gaps, plus BTC dated to its own days.
 *
 * The expansion begins at the first published ECB day and the result is trimmed to `fromDay`
 * afterwards, not the other way round: a carry needs a rate in hand, so starting at `fromDay`
 * would leave a launch-weekend start with no row.
 */
export function assembleFxRates(
  ecbByDay: Map<string, Record<string, number>>,
  btc: readonly FxRate[],
  fromDay: string,
  toDay: string,
): FxRate[] {
  const offered = deriveOfferedCurrencies(ecbByDay);
  const firstPublished = [...ecbByDay.keys()].sort()[0] ?? fromDay;
  const fiat = expandWithCarry(ecbByDay, offered, firstPublished, toDay).filter(
    (r) => r.day >= fromDay,
  );
  return [...fiat, ...btc.filter((r) => r.day >= fromDay && r.day <= toDay)];
}

/**
 * Fill the table from both sources. Idempotent, so it is safe on every boot.
 *
 * The ECB range starts one day before the launch day, so the launch (a Saturday) has a Friday rate
 * to carry.
 */
export async function backfillFxRates(
  pool: Pool,
  log: (m: string) => void,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<void> {
  const today = utcDayFromSeconds(nowSeconds);
  const [ecb, btc] = await Promise.all([
    fetchEcbRange("2016-10-28", today),
    fetchYahooBtcDaily(nowSeconds),
  ]);
  const offered = deriveOfferedCurrencies(ecb);
  const rows = assembleFxRates(ecb, btc, LAUNCH_DAY, today);
  const written = await upsertFxRates(pool, rows);
  log(
    `fx rates: ${written} rows stored across ${offered.length} fiats + btc ` +
      `(${offered.join(",")}) from ${LAUNCH_DAY}`,
  );
}

/** Refresh the trailing fortnight: a carried weekend resolves once Monday publishes. */
export async function refreshRecentFxRates(pool: Pool, log: (m: string) => void): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const today = utcDayFromSeconds(nowSeconds);
  const from = utcDayFromSeconds(nowSeconds - 14 * DAY_SECONDS);
  const [ecb, btc] = await Promise.all([
    fetchEcbRange(from, today),
    fetchYahooBtcDaily(nowSeconds),
  ]);
  const rows = assembleFxRates(
    ecb,
    btc.filter((r) => r.day >= from),
    from,
    today,
  );
  const written = await upsertFxRates(pool, rows);
  log(`fx rates: refreshed ${written} recent row(s), latest ${today}`);
}
