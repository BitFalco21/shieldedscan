import type { Pool } from "pg";
import { readJsonCapped } from "./body-limit";
import { utcDayFromSeconds } from "@/domain/time";

/**
 * Daily ZEC/USD closes, back to launch.
 *
 * Two sources, and the source is stored with every row, because there is no canonical daily ZEC
 * price: Yahoo Finance's close and CoinCodex's daily series typically differ by a couple of percent
 * on the same day, since they aggregate different venues by different methods.
 *
 * CoinGecko is not used for history: its free tier refuses ranges older than 365 days. It remains
 * the live price source in `PriceTracker`. Do not fill gaps from its `interval=daily` series
 * either: those points are 00:00 UTC snapshots, i.e. the previous day's close, so writing them
 * under their own date shifts the data by one day. Any new source must be alignment-tested against
 * real traded closes before a row is written.
 *
 * Yahoo covers 2017-11-09 onward with true daily closes and is preferred wherever it has a day;
 * CoinCodex fills 2016-10-29..2017-11-08, the launch year no free source covers with real closes.
 */

const YAHOO_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart/ZEC-USD?period1=1477612800&period2=%END%&interval=1d";
const LAUNCH_DAY = "2016-10-29";
/** The first day Yahoo's ZEC-USD series carries a close. */
const YAHOO_FIRST_DAY = "2017-11-09";

export interface DailyPrice {
  day: string;
  usd: number;
  source: "yahoo" | "coincodex";
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": "shieldedscan/1.0 (+https://shieldedscan.xyz)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return readJsonCapped(response);
}

/** Yahoo's daily closes. Null closes (untraded days) are skipped, never interpolated. */
export async function fetchYahooDaily(nowSeconds: number): Promise<DailyPrice[]> {
  const body = (await fetchJson(YAHOO_URL.replace("%END%", String(nowSeconds)))) as {
    chart?: {
      result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[];
    };
  };
  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const out: DailyPrice[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = closes[i];
    const at = timestamps[i];
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    if (typeof at !== "number") continue;
    out.push({ day: utcDayFromSeconds(at), usd: close, source: "yahoo" });
  }
  return out;
}

/**
 * CoinCodex, requested one calendar year at a time: a request for the whole history returns
 * downsampled points that look like a complete series but cover only a fraction of the days. A year
 * at a time with 500 samples yields every day.
 */
export async function fetchCoinCodexDaily(fromYear: number, toYear: number): Promise<DailyPrice[]> {
  const byDay = new Map<string, number>();
  for (let year = fromYear; year <= toYear; year += 1) {
    const start = year === 2016 ? LAUNCH_DAY : `${year}-01-01`;
    const end = `${year}-12-31`;
    const raw = (await fetchJson(
      `https://coincodex.com/api/coincodex/get_coin_history/ZEC/${start}/${end}/500`,
    )) as Record<string, [number, number, number, number][]> | [number, number, number, number][];
    const rows = Array.isArray(raw) ? raw : (Object.values(raw)[0] ?? []);
    // Last sample of a day is the closest thing this source offers to a close.
    for (const row of [...rows].sort((a, b) => a[0] - b[0])) {
      byDay.set(utcDayFromSeconds(row[0]), row[1]);
    }
  }
  return [...byDay].map(([day, usd]) => ({ day, usd, source: "coincodex" as const }));
}

export async function upsertPrices(pool: Pool, prices: DailyPrice[]): Promise<number> {
  if (prices.length === 0) return 0;
  const now = Math.floor(Date.now() / 1000);
  let written = 0;
  // Chunked so one statement never carries thousands of rows of parameters.
  for (let i = 0; i < prices.length; i += 500) {
    const chunk = prices.slice(i, i + 500);
    const values = chunk
      .map((_, n) => `($${n * 4 + 1}::date, $${n * 4 + 2}, $${n * 4 + 3}, $${n * 4 + 4})`)
      .join(", ");
    const params = chunk.flatMap((p) => [p.day, p.usd, p.source, now]);
    const res = await pool.query(
      `INSERT INTO zec_price_daily (day, usd, source, fetched_at)
       VALUES ${values}
       ON CONFLICT (day) DO UPDATE SET usd = EXCLUDED.usd, source = EXCLUDED.source,
                                       fetched_at = EXCLUDED.fetched_at`,
      params,
    );
    written += res.rowCount ?? 0;
  }
  return written;
}

/**
 * Fill the table from both sources, preferring Yahoo wherever it has the day. Idempotent, safe on
 * every boot: it upserts, so a re-run refreshes and a source that improves overwrites by day.
 */
export async function backfillPriceHistory(
  pool: Pool,
  log: (m: string) => void,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<void> {
  const yahoo = await fetchYahooDaily(nowSeconds);
  const gapYears = await fetchCoinCodexDaily(2016, 2017);
  const yahooDays = new Set(yahoo.map((p) => p.day));
  // CoinCodex only where Yahoo is silent — the launch year, plus any day Yahoo skipped.
  const filler = gapYears.filter((p) => !yahooDays.has(p.day) && p.day < YAHOO_FIRST_DAY);
  const written = await upsertPrices(pool, [...filler, ...yahoo]);
  log(
    `price history: ${written} daily closes stored ` +
      `(${yahoo.length} yahoo from ${yahoo[0]?.day ?? "?"}, ${filler.length} coincodex pre-${YAHOO_FIRST_DAY})`,
  );
}

/** Refresh the most recent days — yesterday's close can revise after midnight. */
export async function refreshRecentPrices(pool: Pool, log: (m: string) => void): Promise<void> {
  const yahoo = await fetchYahooDaily(Math.floor(Date.now() / 1000));
  const recent = yahoo.slice(-7);
  const written = await upsertPrices(pool, recent);
  log(`price history: refreshed ${written} recent day(s), latest ${recent.at(-1)?.day ?? "none"}`);
}
