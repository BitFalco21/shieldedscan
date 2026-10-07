import { Hono } from "hono";
import type { Pool } from "pg";
import { parseUtcDayStart } from "@/domain";
import { utcDayFromMs } from "@/domain/time";
import { Cached } from "../cached";
import { coreRouteErrors, rejectUnknownParams, setCache, upstreamDown } from "./http";
import type { V1DailyPrice, V1DailyPrices, V1Unknowns } from "./dto";
import { ParamError } from "./params";

/**
 * `GET /v1/prices/daily`: daily ZEC closes since launch, in USD or any rated currency. Every row
 * names its source, because two reputable free aggregators disagree on the same day by a couple of
 * percent, and a number without its source would be an unattributed claim about a market price.
 */
export function v1PriceRoutes(pool: Pool | undefined): Hono {
  const app = new Hono();
  app.onError(coreRouteErrors);
  const fxCurrencies = new Cached<string[]>(60 * 60 * 1000);

  app.get("/v1/prices/daily", async (c) => {
    rejectUnknownParams(c, ["from", "to", "currency"]);
    // Shape is validated BEFORE upstream availability: a malformed date is the caller's
    // error whether or not our store happens to be up, and answering 503 to it would tell
    // them to retry a request that can never succeed.
    const from = c.req.query("from");
    const to = c.req.query("to");
    // A real calendar day, round-tripped: `2026-02-31` has the right shape and no date.
    if ((from && parseUtcDayStart(from) === null) || (to && parseUtcDayStart(to) === null)) {
      throw new ParamError("invalid_parameter", "from/to must be YYYY-MM-DD", "descriptor");
    }
    if (!pool) return upstreamDown(c, "the price store");
    /*
     * Another currency: the close in X on day D is the USD close times that day's reference rate
     * (`fx_rate_daily`, units of X per USD), the same cross-rate the analytics use, so a price here
     * and a valuation there cannot disagree. Every day carries a rate (`rateDay` names the day it
     * was published); a day with none is null, never USD.
     */
    const currency = (c.req.query("currency") ?? "usd").trim().toLowerCase();
    if (currency !== "usd") {
      // An unreadable rate table is our outage: a 503, never a 400 telling the caller their
      // currency does not exist.
      const offered = await fxCurrencies
        .get(async () => {
          const { rows } = await pool.query<{ currency: string }>(
            "SELECT DISTINCT currency FROM fx_rate_daily ORDER BY currency",
          );
          return ["usd", ...rows.map((r) => r.currency).filter((x) => x !== "usd")];
        })
        .catch(() => null);
      if (offered === null) return upstreamDown(c, "the currency list");
      if (!offered.includes(currency)) {
        throw new ParamError(
          "invalid_parameter",
          `currency must be one of ${offered.join(", ")}`,
          "descriptor",
        );
      }
    }
    /*
     * A hard cap on rows returned (not on the range asked for). It takes the newest rows, which is
     * what a caller with no range in mind wants; history stays reachable by paging with
     * `from`/`to`, and `truncated` says when there is more.
     */
    const MAX_PRICE_ROWS = 1_000;
    /*
     * The current UTC day is excluded because it is not a close yet: the source's last daily point
     * is the day in progress, whose "close" tracks spot until midnight. The row stays stored (it
     * becomes the real close) but is not served as settled. Spot is `/v1/chain`'s `priceUsd`.
     */
    const { rows } = await pool.query<{ day: Date; usd: number; source: string }>(
      `SELECT day, usd, source FROM (
         SELECT day, usd, source FROM zec_price_daily
          WHERE ($1::date IS NULL OR day >= $1::date)
            AND ($2::date IS NULL OR day <= $2::date)
            AND day < (now() AT TIME ZONE 'utc')::date
          ORDER BY day DESC
          LIMIT $3
       ) newest ORDER BY day ASC`,
      [from ?? null, to ?? null, MAX_PRICE_ROWS + 1],
    );
    const truncated = rows.length > MAX_PRICE_ROWS;
    const kept = truncated ? rows.slice(rows.length - MAX_PRICE_ROWS) : rows;
    const items = kept.map((r) => ({
      day: utcDayFromMs(r.day.getTime()),
      usd: r.usd,
      source: r.source,
    }));
    /*
     * The extent of the whole series. `firstDay`/`lastDay` describe the returned page, and with
     * no range the cap returns only the newest 1,000 rows, so `truncated: true` alone cannot say
     * how far back the data goes. A cap is honest only when the true extent travels with it.
     *
     * Always emitted and unaffected by `from`/`to`/the cap; both bounds are index-only scans on the
     * `day` primary key. Null only when the table is empty.
     */
    const { rows: extent } = await pool.query<{ from: Date | null; to: Date | null }>(
      `SELECT min(day) AS from, max(day) AS to FROM zec_price_daily
        WHERE day < (now() AT TIME ZONE 'utc')::date`,
    );
    /*
     * The all-time high and low close over the whole series, unaffected by the page, so the record
     * is answerable from any single response despite the row cap. Two index-only scans.
     */
    const { rows: extremes } = await pool.query<{
      kind: "high" | "low";
      day: Date;
      usd: number;
      source: string;
    }>(
      `(SELECT 'high' AS kind, day, usd, source FROM zec_price_daily
         WHERE day < (now() AT TIME ZONE 'utc')::date ORDER BY usd DESC, day ASC LIMIT 1)
       UNION ALL
       (SELECT 'low' AS kind, day, usd, source FROM zec_price_daily
         WHERE day < (now() AT TIME ZONE 'utc')::date ORDER BY usd ASC, day ASC LIMIT 1)`,
    );
    const day = (d: Date | null | undefined): string | null =>
      d ? utcDayFromMs(d.getTime()) : null;
    const extreme = (kind: "high" | "low") => {
      const row = extremes.find((r) => r.kind === kind);
      return row ? { day: day(row.day)!, usd: row.usd, source: row.source } : null;
    };
    // The page's closes and the all-time pair in the asked currency, when it is not USD.
    let converted: {
      items: V1DailyPrice[];
      high: V1DailyPrice | null;
      low: V1DailyPrice | null;
      unknowns: V1Unknowns;
    } | null = null;
    if (currency !== "usd" && items.length > 0) {
      const { rows: rates } = await pool.query<{
        day: Date;
        rate: number;
        rate_day: Date;
      }>(
        `SELECT day, rate, rate_day FROM fx_rate_daily
          WHERE currency = $1 AND day >= $2::date AND day <= $3::date`,
        [currency, items[0]!.day, items.at(-1)!.day],
      );
      const byDay = new Map(rates.map((r) => [day(r.day)!, r]));
      const unknowns: V1Unknowns = {};
      const round8 = (x: number) => Math.round(x * 1e8) / 1e8;
      const withClose = items.map((it, i) => {
        const r = byDay.get(it.day);
        if (r === undefined) unknowns[`items.${i}.close`] = "unmeasured";
        return {
          ...it,
          close: r === undefined ? null : round8(it.usd * r.rate),
          rateDay: r === undefined ? null : day(r.rate_day),
        };
      });
      const { rows: ext } = await pool.query<{
        kind: "high" | "low";
        day: Date;
        usd: number;
        close: number;
        source: string;
      }>(
        `(SELECT 'high' AS kind, p.day, p.usd, p.usd * f.rate AS close, p.source
            FROM zec_price_daily p JOIN fx_rate_daily f ON f.day = p.day AND f.currency = $1
           WHERE p.day < (now() AT TIME ZONE 'utc')::date ORDER BY close DESC, p.day ASC LIMIT 1)
         UNION ALL
         (SELECT 'low' AS kind, p.day, p.usd, p.usd * f.rate AS close, p.source
            FROM zec_price_daily p JOIN fx_rate_daily f ON f.day = p.day AND f.currency = $1
           WHERE p.day < (now() AT TIME ZONE 'utc')::date ORDER BY close ASC, p.day ASC LIMIT 1)`,
        [currency],
      );
      const pickExt = (kind: "high" | "low") => {
        const r = ext.find((e) => e.kind === kind);
        return r
          ? { day: day(r.day)!, usd: r.usd, close: round8(r.close), source: r.source }
          : null;
      };
      converted = { items: withClose, high: pickExt("high"), low: pickExt("low"), unknowns };
    }
    setCache(c, "aggregate");
    return c.json({
      currency,
      items: converted?.items ?? items,
      firstDay: items[0]?.day ?? null,
      lastDay: items.at(-1)?.day ?? null,
      // The series, not this page. A caller wanting a day outside the page pages to it with
      // `?from=`/`?to=`.
      availableFrom: day(extent[0]?.from),
      availableTo: day(extent[0]?.to),
      allTimeHigh: converted ? converted.high : extreme("high"),
      allTimeLow: converted ? converted.low : extreme("low"),
      sources: [...new Set(items.map((i) => i.source))],
      // Never omitted: a caller must be able to tell a complete answer from a capped one
      // without counting rows against a limit documented somewhere else.
      maxRows: MAX_PRICE_ROWS,
      truncated,
      ...(converted && Object.keys(converted.unknowns).length > 0
        ? { unknowns: converted.unknowns }
        : {}),
      asOf: Math.floor(Date.now() / 1000),
    } satisfies V1DailyPrices);
  });
  return app;
}
