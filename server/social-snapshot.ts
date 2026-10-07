import { Pool } from "pg";
import type { SocialSnapshot } from "@/domain/social";
import { POOL_NAMES, type PoolName, type ShieldedPool } from "@/domain/pool";
import { parisDay } from "@/lib/paris-day";
import { DAY_SECONDS } from "@/domain/time";
import "./pg-types";

/** How many daily closes the card's sparkline draws. */
const SPARKLINE_DAYS = 30;

/** Seconds in a day, for the trailing flow window. */

interface TipRow {
  height: number;
  transparent_pool_zat: number | null;
  sprout_pool_zat: number | null;
  sapling_pool_zat: number | null;
  orchard_pool_zat: number | null;
  lockbox_pool_zat: number | null;
  ironwood_pool_zat: number | null;
}

interface CloseRow {
  day: string;
  usd: number;
}

interface FlowRow {
  tx_count: number;
  shielded: number;
  unshielded: number;
}

/**
 * One live instant of the chain, for publication.
 *
 * Reads the tip's value-pool columns rather than a day-grain matview, because the daily post
 * states the value at the moment it is made; every figure is stamped with `readAtHeight` and
 * `readAtUnix`.
 *
 * `price` arrives as plain terms rather than a `PriceTracker`, so a cold tracker's null simply
 * travels through.
 */
export async function buildSnapshot(
  pool: Pool,
  price: { usd: number | null; change24hPct: number | null },
  nowMs: number,
): Promise<SocialSnapshot> {
  const { rows: tip } = await pool.query<TipRow>(
    `SELECT height, transparent_pool_zat, sprout_pool_zat, sapling_pool_zat,
            orchard_pool_zat, lockbox_pool_zat, ironwood_pool_zat
       FROM block ORDER BY height DESC LIMIT 1`,
  );
  const b = tip[0];
  if (b === undefined) throw new Error("no blocks");

  // The four shielded pools, in POOL_NAMES order (the order `snapshotIsComplete` checks). A NULL
  // column is refused rather than coerced (`Number(null)` is 0): an unread pool is omitted from
  // `pools`, which is what gives `snapshotIsComplete`'s four-pool check something to catch.
  const columnByPool: Record<PoolName, number | null> = {
    ironwood: b.ironwood_pool_zat,
    orchard: b.orchard_pool_zat,
    sapling: b.sapling_pool_zat,
    sprout: b.sprout_pool_zat,
  };
  const pools: ShieldedPool[] = POOL_NAMES.filter((name) => columnByPool[name] !== null).map(
    (name) => ({ pool: name, balanceZat: Number(columnByPool[name]) }),
  );

  // Circulating = every spendable pool. The NU6 lockbox holds deferred subsidy no transaction can
  // spend, so it is mined but not circulating, the site-wide definition of `circulatingSupplyZat`.
  //
  // A NULL transparent column means it was not read, not that it is zero; coercing it would yield a
  // confidently wrong 100% shielded share. So the whole circulating figure, and the share, is null.
  const circulating =
    b.transparent_pool_zat === null
      ? null
      : b.transparent_pool_zat + pools.reduce((sum, p) => sum + p.balanceZat, 0);

  const { rows: closes } = await pool.query<CloseRow>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, usd FROM zec_price_daily
      ORDER BY day DESC LIMIT $1`,
    [SPARKLINE_DAYS],
  );

  return {
    readAtUnix: Math.floor(nowMs / 1000),
    readAtHeight: Number(b.height),
    parisDay: parisDay(nowMs),
    priceUsd: price.usd,
    priceChange24hPct: price.change24hPct,
    pools,
    circulatingSupplyZat:
      circulating !== null && Number.isFinite(circulating) && circulating > 0 ? circulating : null,
    flow24h: await flow24h(pool, nowMs),
    recentCloses: closes.reverse().map((r) => ({ day: r.day, usd: Number(r.usd) })),
  };
}

/**
 * Gross shielded and unshielded ZEC over the trailing 24 hours.
 *
 * The trailing-window equivalent of `chain_day_shielding_flow` in `server/schema-chain.sql`, with
 * that view's `per_tx` expression copied verbatim: the Sprout term is subtracted (stored in RPC
 * sign, opposite to the other three pools), coinbase rows are excluded (ZIP-213 value is issuance,
 * not shielding) and mempool rows are excluded (`block_height IS NULL`).
 *
 * The outer SELECT also counts the rows `per_tx` saw. A GROUP-less aggregate always returns one
 * row, so `row === undefined` cannot detect an empty read. Zcash carries well over a thousand
 * transactions a day, so zero in a 24-hour window means a stalled `tx` table, not a quiet chain,
 * and is refused rather than published as "+0.00".
 */
async function flow24h(pool: Pool, nowMs: number): Promise<SocialSnapshot["flow24h"]> {
  const from = Math.floor(nowMs / 1000) - DAY_SECONDS;
  const { rows } = await pool.query<FlowRow>(
    `WITH per_tx AS (
       SELECT COALESCE(sapling_value_balance_zat, 0)
            + COALESCE(orchard_value_balance_zat, 0)
            + COALESCE(ironwood_value_balance_zat, 0)
            - COALESCE(sprout_vpub_net_zat, 0) AS net_in
         FROM tx
        WHERE kind <> 'coinbase' AND block_height IS NOT NULL AND timestamp >= $1
     )
     SELECT COUNT(*)::bigint AS tx_count,
            COALESCE(SUM(net_in) FILTER (WHERE net_in > 0), 0)::bigint  AS shielded,
            COALESCE(-SUM(net_in) FILTER (WHERE net_in < 0), 0)::bigint AS unshielded
       FROM per_tx`,
    [from],
  );
  const row = rows[0];
  if (row === undefined || Number(row.tx_count) === 0) return null;
  return {
    timestamp: from,
    shieldedZat: Number(row.shielded),
    unshieldedZat: Number(row.unshielded),
  };
}
