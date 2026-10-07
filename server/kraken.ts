import type { PricePoint, PriceSeries, StatsRange } from "@/domain";
import { readJsonCapped } from "./body-limit";
import { DAY_SECONDS } from "@/domain/time";

/**
 * Kraken's public market data, the source behind the `/stats` page.
 *
 * - Keyless, with no monthly call cap. That is why it is used here rather than CoinGecko, whose
 *   free tier caps monthly calls far below what a live-updating page needs. Kraken's public
 *   endpoints allow roughly one call a second, so a 10-second ticker poll plus a 5-minute candle
 *   refresh is comfortable.
 * - It is a real traded price from one venue, not an aggregate across venues. That is a different
 *   quantity from CoinGecko's (typically a couple of percent apart), which is why
 *   `zec_price_daily` carries a `source` column.
 * - Used for `/stats` only. CoinGecko remains the price everywhere else and the market-cap source
 *   for `/compare`; the two never appear in one figure.
 *
 * The response shapes below were established by calling the endpoints, not from their docs.
 */

const TICKER_URL = "https://api.kraken.com/0/public/Ticker?pair=ZECUSD";
const OHLC_URL = "https://api.kraken.com/0/public/OHLC?pair=ZECUSD&interval=";

/** Fresh enough to call live. Past this the quote is withheld rather than served stale. */
const QUOTE_MAX_AGE_MS = 5 * 60_000;
const TICKER_INTERVAL_MS = 10_000;
const CANDLE_INTERVAL_MS = 5 * 60_000;
const CANDLE_MAX_AGE_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The venue answers under its own canonical pair name, not the one requested: ask for `ZECUSD` and
 * the result key is `XZECZUSD`. Hardcoding either breaks on a rename, so the sole entry is taken
 * and anything else refused (a result carrying two pairs is not what was asked for).
 */
function soleResult(body: unknown): unknown {
  const envelope = body as { error?: unknown; result?: Record<string, unknown> };
  if (Array.isArray(envelope?.error) && envelope.error.length > 0) return null;
  const result = envelope?.result;
  if (typeof result !== "object" || result === null) return null;
  // The OHLC response carries a bookkeeping `last` cursor beside the pair; it is not a pair.
  const keys = Object.keys(result).filter((k) => k !== "last");
  const only = keys.length === 1 ? keys[0] : undefined;
  return only === undefined ? null : (result[only] ?? null);
}

function numeric(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) ? n : null;
}

export interface KrakenQuote {
  usd: number;
  /**
   * Percentage change since the venue's UTC open.
   *
   * The ticker publishes `c` (last trade) and `o` (today's open) and no 24-hours-ago price, so this
   * is a change over today, not "24h". Null when the venue published no usable open: a 0.0% move is
   * a finding, and a missing figure must not be dressed as one.
   */
  changeTodayPct: number | null;
  fetchedAt: number;
}

/** `c` is the last trade `[price, volume]`; `o` is today's opening price as a bare string. */
export function parseKrakenTicker(body: unknown, now: number): KrakenQuote | null {
  const pair = soleResult(body) as { c?: unknown; o?: unknown } | null;
  if (pair === null || typeof pair !== "object") return null;
  const last = Array.isArray(pair.c) ? numeric(pair.c[0]) : null;
  const open = numeric(pair.o);
  if (last === null || last <= 0) return null;
  return {
    usd: last,
    // No open, or an open of zero, means no honest percentage — not a zero change.
    changeTodayPct: open !== null && open > 0 ? ((last - open) / open) * 100 : null,
    fetchedAt: now,
  };
}

/** An OHLC row is `[time, open, high, low, close, vwap, volume, count]`. */
export function parseKrakenCandles(body: unknown): PricePoint[] | null {
  // For OHLC the pair's value IS the candle array, where the ticker's is an object.
  const candles = soleResult(body);
  if (!Array.isArray(candles)) return null;
  const points: PricePoint[] = [];
  for (const row of candles) {
    if (!Array.isArray(row)) continue;
    const t = numeric(row[0]);
    const close = numeric(row[4]);
    if (t === null || close === null || close <= 0) continue;
    points.push({ t, usd: close });
  }
  return points.length > 0 ? points : null;
}

/**
 * Candle interval (minutes) and the span to keep, per range the price face offers.
 *
 * The venue returns at most 721 candles, so the interval is the reach: 5-minute candles cover
 * about 60 hours, 15-minute 7.5 days, hourly 30 days, daily about 2 years. Each range asks for the
 * coarsest interval that still covers it, then trims to its own window.
 *
 * Partial: `StatsRange` is every window either face may offer, and some belong to the shielded
 * face only. An unplanned range yields null, the route omits it, and the page renders no chip
 * for it.
 */
const RANGE_PLAN: Partial<
  Record<Exclude<StatsRange, "all">, { interval: number; seconds: number }>
> = {
  "24h": { interval: 5, seconds: DAY_SECONDS },
  "7d": { interval: 15, seconds: 7 * DAY_SECONDS },
  "30d": { interval: 60, seconds: 30 * DAY_SECONDS },
  "1y": { interval: 1440, seconds: 365 * DAY_SECONDS },
};

/** Every interval the plan needs, fetched once and shared by the ranges that use it. */
const INTERVALS = [...new Set(Object.values(RANGE_PLAN).map((p) => p.interval))];

/** The daily interval, which is also what the all-time series splices onto its history. */
export const DAILY_INTERVAL = 1440;

export class KrakenTracker {
  #quote: KrakenQuote | null = null;
  readonly #candles = new Map<number, { points: PricePoint[]; fetchedAt: number }>();
  #timers: NodeJS.Timeout[] = [];

  constructor(private readonly log: (m: string) => void) {}

  /** The latest quote, or null when none is recent enough to be honest. */
  current(now = Date.now()): KrakenQuote | null {
    if (this.#quote === null || now - this.#quote.fetchedAt > QUOTE_MAX_AGE_MS) return null;
    return this.#quote;
  }

  /**
   * Points for one range, newest last, or null when the candles behind it are missing or
   * stale. Null renders as unavailable; an empty array would claim ZEC did not trade.
   */
  series(range: StatsRange, now = Date.now()): PriceSeries | null {
    if (range === "all") return null; // assembled by the caller, which owns the older history
    const plan = RANGE_PLAN[range];
    if (plan === undefined) return null; // a window this face does not offer
    const held = this.#candles.get(plan.interval);
    if (held === undefined || now - held.fetchedAt > CANDLE_MAX_AGE_MS) return null;
    const floor = now / 1000 - plan.seconds;
    const points = held.points.filter((p) => p.t >= floor);
    return points.length > 1 ? { range, points } : null;
  }

  /** Daily closes as far back as the venue reaches, for splicing onto stored history. */
  dailyCloses(now = Date.now()): PricePoint[] | null {
    const held = this.#candles.get(DAILY_INTERVAL);
    if (held === undefined || now - held.fetchedAt > CANDLE_MAX_AGE_MS) return null;
    return held.points;
  }

  async #fetchJson(url: string): Promise<unknown> {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return readJsonCapped(res);
  }

  async #pollTicker(): Promise<void> {
    try {
      const quote = parseKrakenTicker(await this.#fetchJson(TICKER_URL), Date.now());
      if (quote === null) throw new Error("unrecognised ticker shape");
      this.#quote = quote;
    } catch (error) {
      // Keep the previous quote; current() ages it out if the outage persists.
      this.log(`[kraken] ticker failed: ${message(error)}`);
    }
  }

  async #pollCandles(): Promise<void> {
    for (const interval of INTERVALS) {
      try {
        const points = parseKrakenCandles(await this.#fetchJson(`${OHLC_URL}${interval}`));
        if (points === null) throw new Error("unrecognised candle shape");
        this.#candles.set(interval, { points, fetchedAt: Date.now() });
      } catch (error) {
        this.log(`[kraken] candles ${interval}m failed: ${message(error)}`);
      }
    }
  }

  start(): () => void {
    void this.#pollTicker();
    void this.#pollCandles();
    this.#timers = [
      setInterval(() => void this.#pollTicker(), TICKER_INTERVAL_MS),
      setInterval(() => void this.#pollCandles(), CANDLE_INTERVAL_MS),
    ];
    // Never let a market timer keep the process alive after shutdown.
    this.#timers.forEach((t) => t.unref());
    return () => this.#timers.forEach(clearInterval);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The all-time series: stored daily closes for the years the venue cannot reach, then the venue's
 * own closes from the day it starts.
 *
 * Spliced rather than concatenated at a fixed date, because the two sources differ by a couple of
 * percent on any day. Taking the venue's closes for every day it covers means every range ends at
 * the same price as the headline figure.
 */
export function spliceAllTime(stored: PricePoint[], venue: PricePoint[]): PricePoint[] {
  if (venue.length === 0) return [...stored].sort((a, b) => a.t - b.t);
  const seam = Math.min(...venue.map((p) => p.t));
  const history = stored.filter((p) => p.t < seam);
  return [...history, ...venue].sort((a, b) => a.t - b.t);
}
