import type { Pool } from "pg";

/**
 * The currency a figure is valued in, and the rate that gets it there.
 *
 * `fx_rate_daily` stores units of a currency per one USD, so every valuation is `usdValue × rate`,
 * with USD the identity case at rate 1. The multiplication happens here, and the agent is handed a
 * formatted string.
 *
 * A currency we cannot rate is refused, never quietly answered in dollars: a dollar figure under a
 * euro question is well-formed, so nothing downstream could catch it.
 */

export const USD = "usd";

export interface FxPort {
  /** Currencies this deployment can value in, lowercase, always including `usd`. */
  offered(): readonly string[];
  /** Units of `currency` per one USD at the most recent stored day, or null. */
  latest(currency: string): number | null;
  /** Units per USD on one day, or null when that day or currency has no rate. */
  on(day: string, currency: string): Promise<number | null>;
}

export type Resolved = { ok: true; currency: string; rate: number } | { ok: false; reason: string };

/**
 * A requested currency to a currency and a rate, or a refusal naming what went wrong.
 *
 * Absent means USD. An unknown currency and a known-but-unrated one are both refusals: "offered
 * but the rate has not loaded" is an outage, and answering it in dollars would be a fabricated
 * figure.
 */
export function resolveCurrency(requested: string | undefined, fx: FxPort): Resolved {
  const currency = (requested ?? USD).trim().toLowerCase();
  if (currency === "" || currency === USD) return { ok: true, currency: USD, rate: 1 };

  const offered = fx.offered();
  const others = offered.filter((c) => c !== USD);
  if (!offered.includes(currency)) {
    return {
      ok: false,
      reason:
        `this explorer holds no exchange rate for "${currency}", so it cannot value anything ` +
        `in it. It can answer in US dollars, or in any of: ${others.join(", ")}.`,
    };
  }
  const rate = fx.latest(currency);
  if (rate === null || !Number.isFinite(rate) || rate <= 0) {
    return {
      ok: false,
      reason:
        `this explorer carries "${currency}" but has no current rate for it right now, so a ` +
        `figure in ${currency} is unavailable rather than zero. US dollars are unaffected.`,
    };
  }
  return { ok: true, currency, rate };
}

/** In-memory, for tests and for a deployment with no database behind it. */
export class MemoryFxRates implements FxPort {
  constructor(
    private readonly currencies: readonly string[],
    private readonly latestRates: Readonly<Record<string, number>>,
    private readonly byDay: Readonly<Record<string, Record<string, number>>>,
  ) {}

  offered(): readonly string[] {
    return this.currencies;
  }

  latest(currency: string): number | null {
    if (currency === USD) return 1;
    return this.latestRates[currency] ?? null;
  }

  on(day: string, currency: string): Promise<number | null> {
    if (currency === USD) return Promise.resolve(1);
    return Promise.resolve(this.byDay[day]?.[currency] ?? null);
  }
}

/**
 * Backed by `fx_rate_daily`.
 *
 * The offered set and the latest rates are held in memory and refreshed on a timer (a few dozen
 * numbers that change daily, read on the hot path of every valued answer). A historical rate is
 * queried, since those questions are rare.
 *
 * Cold until `refresh()` succeeds once, and `offered()` is empty until then, so a currency request
 * during start-up is refused rather than answered at a rate of one.
 */
export class PostgresFxRates implements FxPort {
  #currencies: readonly string[] = [USD];
  #latest: Record<string, number> = {};

  constructor(
    private readonly pool: Pool,
    private readonly log: (m: string) => void = () => {},
  ) {}

  offered(): readonly string[] {
    return this.#currencies;
  }

  latest(currency: string): number | null {
    if (currency === USD) return 1;
    return this.#latest[currency] ?? null;
  }

  async on(day: string, currency: string): Promise<number | null> {
    if (currency === USD) return 1;
    const { rows } = await this.pool.query<{ rate: number }>(
      "SELECT rate FROM fx_rate_daily WHERE day = $1::date AND currency = $2",
      [day, currency],
    );
    const rate = rows[0]?.rate;
    return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  /** Load the most recent day's rate for every currency. */
  async refresh(): Promise<void> {
    const { rows } = await this.pool.query<{ currency: string; rate: number }>(
      `SELECT DISTINCT ON (currency) currency, rate
         FROM fx_rate_daily
        ORDER BY currency, day DESC`,
    );
    const latest: Record<string, number> = {};
    for (const r of rows) {
      if (typeof r.rate === "number" && Number.isFinite(r.rate) && r.rate > 0) {
        latest[r.currency] = r.rate;
      }
    }
    this.#latest = latest;
    this.#currencies = [
      USD,
      ...Object.keys(latest)
        .filter((c) => c !== USD)
        .sort(),
    ];
  }

  start(intervalMs = 60 * 60 * 1000): () => void {
    const run = (): void => {
      void this.refresh().catch((e: unknown) => {
        this.log(`fx rates: refresh failed, keeping ${this.#currencies.length} — ${String(e)}`);
      });
    };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
