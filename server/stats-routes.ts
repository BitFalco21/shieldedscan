import { Hono } from "hono";
import type { Pool } from "pg";
import type { PricePoint, PriceSeries, Stats, StatsRange } from "@/domain";
import { STATS_RANGES } from "@/domain";
import { Cached } from "./cached";
import "./pg-types";
import { DAILY_INTERVAL, spliceAllTime, type KrakenTracker } from "./kraken";
import type { NodeChainSource } from "./chain-source";

/**
 * `/chain/stats` and `/chain/stats/series` — the two reads behind the `/stats` page.
 *
 * Split by cadence, not subject: the scalars are polled by every reader and must be as fresh as
 * the venue allows; the series are thousands of points that ship once with the page and are
 * never polled. One endpoint serving both would make every poll carry the whole history.
 *
 * Mounted independently of the node routes: the price half is a third party's and a node outage
 * must not take it down.
 */

export const STATS_PATH = "/chain/stats";
export const STATS_SERIES_PATH = "/chain/stats/series";

/** Long enough that readers share the work, short enough that a new candle lands promptly. */
const SERIES_TTL_MS = 60_000;

export interface StatsDeps {
  source: NodeChainSource;
  kraken: KrakenTracker;
  /** Absent on a deployment with no index: the two figures it answers then read null. */
  pool: Pool | null;
}

/**
 * Net ZEC that crossed into the shielded pools today, in zatoshis.
 *
 * The same window as the price change, so both faces of the page state one period. Null, never
 * zero, when the daily view has no row yet: no row means the day has not been rolled up.
 */
async function netShieldedTodayZat(pool: Pool | null): Promise<number | null> {
  if (pool === null) return null;
  try {
    const { rows } = await pool.query<{ net: string }>(
      `SELECT (shielded_zat - unshielded_zat)::text AS net
         FROM chain_day_shielding_flow
        WHERE ts = EXTRACT(EPOCH FROM date_trunc('day', now() AT TIME ZONE 'UTC'))::bigint`,
    );
    const net = rows[0]?.net;
    return net === undefined ? null : Number(net);
  } catch {
    // A missing or unpopulated view is an absence, not an outage worth failing the page for.
    return null;
  }
}

/** Stored daily closes, oldest first — the years the venue cannot reach. */
async function storedCloses(pool: Pool | null): Promise<PricePoint[]> {
  if (pool === null) return [];
  try {
    const { rows } = await pool.query<{ ts: string; usd: string }>(
      `SELECT EXTRACT(EPOCH FROM day)::bigint::text AS ts, usd::text AS usd
         FROM zec_price_daily
        ORDER BY day`,
    );
    return rows.map((r) => ({ t: Number(r.ts), usd: Number(r.usd) }));
  } catch {
    return [];
  }
}

export function statsRoutes(deps: StatsDeps): Hono {
  const app = new Hono();
  const series = new Cached<Partial<Record<StatsRange, PriceSeries>>>(SERIES_TTL_MS);

  app.get(STATS_PATH, async (c) => {
    const [facts, pools, netToday] = await Promise.all([
      deps.source.getChainFacts(),
      deps.source.getPools(),
      netShieldedTodayZat(deps.pool),
    ]);
    const quote = deps.kraken.current();
    const totalShieldedZat = pools.reduce((sum: number, p) => sum + p.balanceZat, 0);

    const stats: Stats = {
      // A cold or stale tracker contributes nothing: absent beats fabricated, which is why both
      // fields are nullable in the domain type.
      priceUsd: quote?.usd ?? null,
      changeTodayPct: quote?.changeTodayPct ?? null,
      shielded: {
        // Largest first: the order the page renders and the order a reader reads.
        pools: [...pools].sort((a, b) => b.balanceZat - a.balanceZat),
        totalShieldedZat,
        circulatingSupplyZat: facts.circulatingSupplyZat,
        netShieldedTodayZat: netToday,
      },
      height: facts.height,
      // The instant the price was read, not the instant this response was built, so a stale quote
      // cannot pass for live.
      asOf: Math.floor((quote?.fetchedAt ?? Date.now()) / 1000),
    };
    return c.json(stats);
  });

  app.get(STATS_SERIES_PATH, async (c) => {
    const built = await series.get(async () => {
      const out: Partial<Record<StatsRange, PriceSeries>> = {};
      for (const range of STATS_RANGES) {
        if (range === "all") continue;
        const s = deps.kraken.series(range);
        // A range the venue could not answer is omitted, so the page renders it as unavailable. An
        // empty points array would draw an axis around nothing and read as a broken chart.
        if (s !== null) out[range] = s;
      }
      const daily = deps.kraken.dailyCloses();
      if (daily !== null) {
        const points = spliceAllTime(await storedCloses(deps.pool), daily);
        if (points.length > 1) out.all = { range: "all", points };
      }
      return out;
    });
    return c.json(built);
  });

  return app;
}

export { DAILY_INTERVAL };
