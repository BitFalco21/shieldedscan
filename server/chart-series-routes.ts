import { Hono } from "hono";
import type { Pool } from "pg";
import type {
  BlocksDayPoint,
  MinerShareMonth,
  NoteTreeDayPoint,
  SupplyDayPoint,
  TransparentDayPoint,
} from "@/domain";
import { Cached } from "./cached";
import { createPool } from "./pg-pool";
import "./pg-types";

export const NOTE_TREES_PATH = "/chain/analytics/note-trees";
export const TRANSPARENT_DAYS_PATH = "/chain/analytics/transparent-days";
export const MINER_SHARES_PATH = "/chain/analytics/miner-shares";
export const BLOCKS_DAILY_PATH = "/chain/analytics/blocks-daily";
export const SUPPLY_DAYS_PATH = "/chain/analytics/supply-days";

/**
 * The private series behind the chart library's newer charts, one route each.
 *
 * Every one reads a table or view something else already maintains (the hourly matviews, the
 * pool-usage, transparent and mining trackers), so a cache miss is a short read and nothing here
 * writes. Each mirrors the definition of the public endpoint the chart names, so the chart and the
 * figure a reader fetches agree: concentration on `/v1/analytics/miners`' rule, transparent activity on
 * `/v1/analytics/transparent`'s.
 */
export function chartSeriesRoutes(connection?: string, injected?: Pool): Hono {
  const app = new Hono();
  const pool = injected ?? createPool(connection, { max: 2, statement_timeout: 30_000 });
  const noteTrees = new Cached<NoteTreeDayPoint[]>();
  const transparentDays = new Cached<TransparentDayPoint[]>();
  const minerShares = new Cached<MinerShareMonth[]>();
  const blocksDaily = new Cached<BlocksDayPoint[]>();
  const supplyDays = new Cached<SupplyDayPoint[]>();

  /**
   * Each shielded pool's note commitment tree size at every complete day's close, all history.
   * Today is left out: its row is a close not yet made.
   */
  app.get(NOTE_TREES_PATH, async (c) =>
    c.json(
      await noteTrees.get(async () => {
        const { rows } = await pool.query<{
          ts: string;
          sapling: string | null;
          orchard: string | null;
          ironwood: string | null;
        }>(
          `SELECT EXTRACT(EPOCH FROM day)::bigint AS ts,
                  max(notes_at_close) FILTER (WHERE pool = 'sapling')  AS sapling,
                  max(notes_at_close) FILTER (WHERE pool = 'orchard')  AS orchard,
                  max(notes_at_close) FILTER (WHERE pool = 'ironwood') AS ironwood
             FROM pool_usage_daily
            WHERE day < (now() AT TIME ZONE 'UTC')::date
            GROUP BY day
            ORDER BY day`,
        );
        const n = (v: string | null) => (v === null ? null : Number(v));
        return rows.map((r) => ({
          timestamp: Number(r.ts),
          saplingNotes: n(r.sapling),
          orchardNotes: n(r.orchard),
          ironwoodNotes: n(r.ironwood),
        }));
      }),
    ),
  );

  /**
   * Transparent activity per complete UTC day, every day from the first computed to yesterday. A
   * day the backfill has not reached is a row of nulls, so the chart draws a gap rather than a
   * quiet day; today, still filling, is left out, or it would draw as a collapse.
   */
  app.get(TRANSPARENT_DAYS_PATH, async (c) =>
    c.json(
      await transparentDays.get(async () => {
        const { rows } = await pool.query<{
          ts: string;
          active: number | null;
        }>(
          `WITH bounds AS (
             SELECT min(day) AS lo, max(day) AS hi
               FROM transparent_daily
              WHERE day < (now() AT TIME ZONE 'UTC')::date
           )
           SELECT EXTRACT(EPOCH FROM d)::bigint AS ts,
                  t.active_addresses AS active
             FROM bounds, generate_series(bounds.lo, bounds.hi, interval '1 day') AS d
             LEFT JOIN transparent_daily t ON t.day = d::date
            WHERE bounds.lo IS NOT NULL
            ORDER BY d`,
        );
        return rows.map((r) => ({
          timestamp: Number(r.ts),
          activeAddresses: r.active === null ? null : Number(r.active),
        }));
      }),
    ),
  );

  /**
   * The largest transparent payout addresses' share of each month's blocks, on the rule
   * `/v1/analytics/miners` applies to any window: addresses ranked within the month and never
   * merged, against every block the month holds. The denominator rides with each month, beside
   * the blocks paid to a shielded coinbase (ZIP 213), whose miner no one can name.
   */
  app.get(MINER_SHARES_PATH, async (c) =>
    c.json(
      await minerShares.get(async () => {
        const { rows } = await pool.query<{
          ts: string;
          blocks: string;
          days: number;
          top1: string | null;
          top3: string | null;
          top10: string | null;
          shielded: string | null;
        }>(
          `WITH by_address AS (
             SELECT date_trunc('month', day)::date AS month, address, sum(blocks)::bigint AS blocks
               FROM mining_day_payout
              WHERE kind = 'transparent'
              GROUP BY 1, 2
           ), ranked AS (
             SELECT month, blocks,
                    row_number() OVER (PARTITION BY month ORDER BY blocks DESC, address) AS rn
               FROM by_address
           ), tops AS (
             SELECT month,
                    sum(blocks) FILTER (WHERE rn <= 1)  AS top1,
                    sum(blocks) FILTER (WHERE rn <= 3)  AS top3,
                    sum(blocks) FILTER (WHERE rn <= 10) AS top10
               FROM ranked GROUP BY month
           ), shielded AS (
             SELECT date_trunc('month', day)::date AS month, sum(blocks)::bigint AS blocks
               FROM mining_day_payout
              WHERE kind = 'shielded'
              GROUP BY 1
           ), totals AS (
             SELECT date_trunc('month', day)::date AS month, sum(blocks)::bigint AS blocks,
                    count(*)::int AS days
               FROM mining_day GROUP BY 1
           )
           SELECT EXTRACT(EPOCH FROM totals.month)::bigint AS ts, totals.blocks, totals.days,
                  tops.top1, tops.top3, tops.top10, shielded.blocks AS shielded
             FROM totals
             LEFT JOIN tops USING (month)
             LEFT JOIN shielded USING (month)
            ORDER BY totals.month`,
        );
        return rows.map((r) => ({
          timestamp: Number(r.ts),
          blocks: Number(r.blocks),
          days: r.days,
          top1Blocks: Number(r.top1 ?? 0),
          top3Blocks: Number(r.top3 ?? 0),
          top10Blocks: Number(r.top10 ?? 0),
          shieldedBlocks: Number(r.shielded ?? 0),
        }));
      }),
    ),
  );

  /**
   * Blocks per complete UTC day, with each day's top height. Today is excluded: a day still
   * filling would draw as a collapse.
   */
  app.get(BLOCKS_DAILY_PATH, async (c) =>
    c.json(
      await blocksDaily.get(async () => {
        const { rows } = await pool.query<{ ts: string; blocks: number; top_height: number }>(
          `SELECT n.ts, n.blocks, r.top_height
             FROM chain_day_network n
             JOIN chain_day_rollup r USING (ts)
            WHERE n.ts < EXTRACT(EPOCH FROM date_trunc('day', now() AT TIME ZONE 'UTC'))::bigint
            ORDER BY n.ts`,
        );
        return rows.map((r) => ({
          timestamp: Number(r.ts),
          blocks: Number(r.blocks),
          topHeight: Number(r.top_height),
        }));
      }),
    ),
  );

  /**
   * Every value pool's balance at each complete UTC day's last block, all history: the shielded
   * share's two sides and the lockbox, from one row so they agree. Today is left out, as on every
   * daily series here. Nulls pass through: a pool before it existed is not a pool at zero.
   */
  app.get(SUPPLY_DAYS_PATH, async (c) =>
    c.json(
      await supplyDays.get(async () => {
        const { rows } = await pool.query<{
          ts: string;
          transparent: string | null;
          sprout: string | null;
          sapling: string | null;
          orchard: string | null;
          ironwood: string | null;
          lockbox: string | null;
        }>(
          `SELECT EXTRACT(EPOCH FROM day)::bigint AS ts,
                  transparent_pool_zat AS transparent, sprout_pool_zat AS sprout,
                  sapling_pool_zat AS sapling, orchard_pool_zat AS orchard,
                  ironwood_pool_zat AS ironwood, lockbox_pool_zat AS lockbox
             FROM chain_day_supply_close
            WHERE day < (now() AT TIME ZONE 'UTC')::date
            ORDER BY day`,
        );
        const zat = (v: string | null) => (v === null ? null : Number(v));
        return rows.map((r) => ({
          timestamp: Number(r.ts),
          transparentZat: zat(r.transparent),
          sproutZat: zat(r.sprout),
          saplingZat: zat(r.sapling),
          orchardZat: zat(r.orchard),
          ironwoodZat: zat(r.ironwood),
          lockboxZat: zat(r.lockbox),
        }));
      }),
    ),
  );

  return app;
}
