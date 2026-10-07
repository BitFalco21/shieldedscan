import type { Pool } from "pg";
import { rollbackQuietly } from "./pg-pool";
import { DAY_SECONDS } from "@/domain/time";

/**
 * Who mined each UTC day, by payout address: `mining_day` and `mining_day_payout`, kept by
 * `PoolUsageTracker` beside the pool-usage and boundary counts, and read by
 * `/v1/analytics/miners`.
 *
 * A day is one indexed range read of `block` (about 1,150 rows on `block_timestamp_idx`), so the
 * whole chain is a few thousand small paced units, and a window of any length is a sum over tens
 * of thousands of stored rows instead of a grouping over all of `block`.
 *
 * Every figure is a column the follower writes from `parseBlock` (the miner repair filled the
 * oldest blocks with the same function); nothing here re-derives a miner, and two payout
 * addresses are never merged, so any share is a lower bound for an operator behind several
 * addresses. Names are not stored: `/v1` serves none.
 */

/** A day computed while some of its blocks had no recorded miner is recomputed at most hourly. */
const UNRECORDED_RECHECK_SECONDS = 3_600;

const DAY_OF = "(to_timestamp($1) AT TIME ZONE 'UTC')::date";

/** One day's rows, `$1`/`$2` its half-open unix-second edges. */
export const MINING_DAY_PAYOUT_SQL = `
  INSERT INTO mining_day_payout (day, kind, address, blocks, reward_zat, fee_zat, fee_blocks,
                                 first_height, last_height)
  SELECT ${DAY_OF}, miner_kind, COALESCE(miner_address, ''), count(*)::int,
         CASE WHEN count(miner_reward_zat) = count(*) THEN sum(miner_reward_zat) END,
         COALESCE(sum(total_fee_zat), 0), count(total_fee_zat)::int, min(height), max(height)
    FROM block
   WHERE timestamp >= $1::bigint AND timestamp < $2::bigint AND miner_kind IS NOT NULL
   GROUP BY miner_kind, COALESCE(miner_address, '')`;

/** The day's header, `$3` the computation time. */
export const MINING_DAY_SQL = `
  INSERT INTO mining_day (day, blocks, unrecorded_blocks, first_height, last_height, computed_at)
  SELECT ${DAY_OF}, count(*)::int, count(*) FILTER (WHERE miner_kind IS NULL)::int,
         min(height), max(height), $3::bigint
    FROM block WHERE timestamp >= $1::bigint AND timestamp < $2::bigint
  ON CONFLICT (day) DO UPDATE SET
    blocks = EXCLUDED.blocks, unrecorded_blocks = EXCLUDED.unrecorded_blocks,
    first_height = EXCLUDED.first_height, last_height = EXCLUDED.last_height,
    computed_at = EXCLUDED.computed_at
  RETURNING blocks, unrecorded_blocks`;

/**
 * (Re)compute one UTC day (its midnight in unix seconds) in one transaction. The day's payout rows
 * are replaced rather than upserted, because a recompute can remove a row: a block that was
 * unrecorded, or reorged away, takes its address with it.
 */
export async function computeMiningDay(
  pool: Pool,
  dayStart: number,
  nowSec: number,
): Promise<{ blocks: number; unrecorded: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM mining_day_payout WHERE day = ${DAY_OF}`, [dayStart]);
    await client.query(MINING_DAY_PAYOUT_SQL, [dayStart, dayStart + DAY_SECONDS]);
    const { rows } = await client.query<{ blocks: number; unrecorded_blocks: number }>(
      MINING_DAY_SQL,
      [dayStart, dayStart + DAY_SECONDS, nowSec],
    );
    await client.query("COMMIT");
    return { blocks: rows[0]!.blocks, unrecorded: rows[0]!.unrecorded_blocks };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The UTC days to (re)compute, `first`..`last` being the chain's day extent: every day never
 * computed, every day computed while some of its blocks had no recorded miner (at most hourly,
 * while the miner repair fills them), and the newest three, which late and reorged blocks can
 * still change.
 */
export async function miningDaysToCompute(
  pool: Pool,
  first: number,
  last: number,
  nowSec: number,
): Promise<number[]> {
  const { rows } = await pool.query<{
    day: string;
    unrecorded: number;
    computed_at: string;
    bounded: boolean;
  }>(
    `SELECT EXTRACT(EPOCH FROM day)::bigint::text AS day, unrecorded_blocks AS unrecorded,
            computed_at::text AS computed_at, (blocks = 0 OR first_height IS NOT NULL) AS bounded
       FROM mining_day`,
  );
  // A row computed before the height bounds existed is not settled either: `windowHeightRange`
  // reads them, and recomputing is one cheap unit.
  const settled = new Set(
    rows
      .filter(
        (r) =>
          r.bounded &&
          (r.unrecorded === 0 || Number(r.computed_at) > nowSec - UNRECORDED_RECHECK_SECONDS),
      )
      .map((r) => Number(r.day)),
  );
  const recent = last - 2 * DAY_SECONDS;
  const days: number[] = [];
  for (let d = first; d <= last; d += DAY_SECONDS) {
    if (d >= recent || !settled.has(d)) days.push(d);
  }
  return days;
}

// ------------------------------------------------------------------------------ a window

export interface MinerWindowRow {
  /** Competition rank by blocks: tied addresses share a rank. */
  rank: number;
  address: string;
  blocks: number;
  /** Null unless every block carries the miner's own reward. */
  rewardZat: number | null;
  /** Null unless every block's fee total is known. */
  feeZat: number | null;
  firstHeight: number;
  lastHeight: number;
  /** The tag of the address's newest block in the window, as the miner wrote it. */
  newestCoinbaseTag: string | null;
}

export interface MinerWindow {
  /** Days in the window the tracker has computed (a computed day with no blocks counts). */
  daysComputed: number;
  /** Every block in the computed days, each kind and the unrecorded included. */
  blocks: number;
  unrecordedBlocks: number;
  fromHeight: number | null;
  toHeight: number | null;
  transparent: { blocks: number; addresses: number };
  shieldedBlocks: number;
  /** The miner's output names no address — a bare public key, which some miners used until 2018. */
  noAddressBlocks: number;
  /** The largest addresses, at least ten when that many exist (for the concentration figures). */
  top: MinerWindowRow[];
  /** Total blocks of the ten largest addresses, and of the largest one and three. */
  topBlocks: { top1: number; top3: number; top10: number };
  /**
   * The chain's first UTC day (midnight), null with no blocks, so a caller can compare the days a
   * window should hold with `daysComputed`: the tracker fills the oldest days first, and a window
   * it has not reached yet is empty, not quiet.
   */
  chainFirstDay: number | null;
}

const WINDOW_EDGES =
  "day >= (to_timestamp($1) AT TIME ZONE 'UTC')::date AND day < (to_timestamp($2) AT TIME ZONE 'UTC')::date";

/**
 * A window of whole UTC days, `fromTs` inclusive and `toTs` exclusive (unix seconds at midnight).
 * The top `limit` addresses are ranked in SQL, and the concentration sums ride beside them, so a
 * short list still states the top-ten share.
 */
export async function loadMinerWindow(
  pool: Pool,
  fromTs: number,
  toTs: number,
  limit: number,
): Promise<MinerWindow> {
  const want = Math.max(limit, 10);
  const [kinds, top, header] = await Promise.all([
    pool.query<{ kind: string; blocks: string; lo: number; hi: number }>(
      `SELECT kind, sum(blocks)::bigint::text AS blocks, min(first_height) AS lo,
              max(last_height) AS hi
         FROM mining_day_payout WHERE ${WINDOW_EDGES} GROUP BY kind`,
      [fromTs, toTs],
    ),
    pool.query<{
      address: string;
      blocks: string;
      rank: number;
      /** How many addresses the window holds — the groups, counted before the LIMIT. */
      addresses: number;
      reward: string | null;
      fees: string;
      fee_blocks: string;
      lo: number;
      hi: number;
    }>(
      `SELECT address, sum(blocks)::bigint::text AS blocks,
              rank() OVER (ORDER BY sum(blocks) DESC)::int AS rank,
              count(*) OVER ()::int AS addresses,
              CASE WHEN count(reward_zat) = count(*) THEN sum(reward_zat) END::text AS reward,
              sum(fee_zat)::text AS fees, sum(fee_blocks)::text AS fee_blocks,
              min(first_height) AS lo, max(last_height) AS hi
         FROM mining_day_payout WHERE ${WINDOW_EDGES} AND kind = 'transparent'
        GROUP BY address ORDER BY sum(blocks) DESC, address LIMIT $3`,
      [fromTs, toTs, want],
    ),
    pool.query<{ days: number; blocks: string; unrecorded: string; first: string | null }>(
      `SELECT count(*)::int AS days, COALESCE(sum(blocks), 0)::text AS blocks,
              COALESCE(sum(unrecorded_blocks), 0)::text AS unrecorded,
              (SELECT ((min(timestamp) / 86400) * 86400)::text FROM block) AS first
         FROM mining_day WHERE ${WINDOW_EDGES}`,
      [fromTs, toTs],
    ),
  ]);
  const kind = (k: string) => kinds.rows.find((r) => r.kind === k);
  const blocksOf = (k: string) => Number(kind(k)?.blocks ?? 0);
  const rows = top.rows.map((r) => ({ ...r, blocks: Number(r.blocks) }));
  const sumTop = (n: number) => rows.slice(0, n).reduce((s, r) => s + r.blocks, 0);
  const tags = new Map<number, string | null>();
  const listed = rows.slice(0, limit);
  if (listed.length > 0) {
    const found = await pool.query<{ height: number; coinbase_tag: string | null }>(
      "SELECT height, coinbase_tag FROM block WHERE height = ANY($1::int[])",
      [listed.map((r) => r.hi)],
    );
    for (const f of found.rows) tags.set(f.height, f.coinbase_tag);
  }
  const edges = kinds.rows.flatMap((r) => [r.lo, r.hi]);
  const h = header.rows[0];
  return {
    daysComputed: h?.days ?? 0,
    blocks: Number(h?.blocks ?? 0),
    unrecordedBlocks: Number(h?.unrecorded ?? 0),
    fromHeight: edges.length === 0 ? null : Math.min(...edges),
    toHeight: edges.length === 0 ? null : Math.max(...edges),
    transparent: {
      blocks: blocksOf("transparent"),
      addresses: top.rows[0]?.addresses ?? 0,
    },
    shieldedBlocks: blocksOf("shielded"),
    noAddressBlocks: blocksOf("unknown"),
    top: listed.map((r) => ({
      rank: r.rank,
      address: r.address,
      blocks: r.blocks,
      rewardZat: r.reward === null ? null : Number(r.reward),
      feeZat: Number(r.fee_blocks) === r.blocks ? Number(r.fees) : null,
      firstHeight: r.lo,
      lastHeight: r.hi,
      newestCoinbaseTag: tags.get(r.hi) ?? null,
    })),
    topBlocks: { top1: sumTop(1), top3: sumTop(3), top10: sumTop(10) },
    chainFirstDay: h?.first == null ? null : Number(h.first),
  };
}
