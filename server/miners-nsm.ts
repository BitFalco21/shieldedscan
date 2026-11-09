import type { Pool } from "pg";
import {
  NU7_HEIGHT,
  REISSUANCE_START_HEIGHT,
  nextSubsidyChangeHeight,
  scheduledSubsidyZat,
  utcDayOf,
  type NsmDay,
  type NsmOverview,
} from "@/domain";
import { DAY_SECONDS } from "@/domain/time";
import "./pg-types";

/**
 * The NSM's daily series for `/miners`, read from `block` by height from NU7 on: every block,
 * whatever its coinbase, because the fee split is public. Bounded by the longest window it serves,
 * a year (`1y`, and `all` until NU7 is a year old), so a read is at most 366 days of blocks on the
 * primary key, memoised by the route.
 *
 * The NSM's share is `floor(6 × fees / 10)` on each block's own total, summed per day, the rounding
 * `minerFeeShareZat` and the miners rollup (`mining-daily.ts`) use; the day of a block is the UTC
 * day of its timestamp, as `nsm_daily` in the open dataset has it, so the two agree day by day.
 */

/** The trailing days served: `1y`'s 365 and one, so a year's window is whole whatever the hour. */
export const NSM_SERIES_DAYS = 366;

export const NSM_DAYS_SQL = `
  SELECT to_char((to_timestamp(timestamp) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
         count(*)::int AS blocks, min(height) AS lo, max(height) AS hi,
         count(total_fee_zat)::int AS fee_blocks,
         sum(total_fee_zat)::text AS fees,
         sum((total_fee_zat * 6) / 10)::text AS nsm,
         sum(($4::bigint[])[width_bucket(height, $3::int[])])::text AS issued
    FROM block
   WHERE height >= $1::int AND timestamp >= $2::bigint
   GROUP BY 1 ORDER BY 1`;

/**
 * The scheduled subsidy as stretches of constant per-block amount from NU7 on: `starts[i]` is the
 * first height paying `subsidies[i]`. `width_bucket(height, starts)` picks a block's stretch in
 * SQL, so a day's issuance is summed block by block, exactly, even across a halving. Runs to the
 * last block that pays a zatoshi.
 */
export function subsidyStretches(from = NU7_HEIGHT): { starts: number[]; subsidies: number[] } {
  const starts: number[] = [];
  const subsidies: number[] = [];
  for (let h = from; starts.length < 64; h = nextSubsidyChangeHeight(h)) {
    const subsidy = scheduledSubsidyZat(h);
    starts.push(h);
    subsidies.push(subsidy);
    if (subsidy === 0) break;
  }
  return { starts, subsidies };
}

const STRETCHES = subsidyStretches();

export interface NsmDayRow {
  day: string;
  blocks: number;
  lo: number;
  hi: number;
  fee_blocks: number;
  fees: string | null;
  nsm: string | null;
  issued: string | null;
}

/**
 * Rows into days. `contiguous` is whether the index holds every height the rows span: a missing
 * block's fees are in no row, so a gap leaves every day unknown rather than quietly short. A
 * closed day is priced at its stored close; today has none, whatever the feed stored for it.
 */
export function nsmDaysOf(
  rows: readonly NsmDayRow[],
  closes: ReadonlyMap<string, number>,
  today: string,
  contiguous: boolean,
): NsmDay[] {
  return rows.map((r) => {
    const known = contiguous && r.fee_blocks === r.blocks && r.fees !== null && r.nsm !== null;
    const partial = r.day === today;
    return {
      day: r.day,
      blocks: r.blocks,
      feeZat: known ? Number(r.fees) : null,
      nsmZat: known ? Number(r.nsm) : null,
      issuedZat: contiguous && r.issued !== null ? Number(r.issued) : null,
      closeUsd: partial ? null : (closes.get(r.day) ?? null),
      partial,
    };
  });
}

/** The series without the balance, which the route reads from the node. */
export async function loadNsmDays(
  pool: Pick<Pool, "query">,
  nowSec: number,
): Promise<Omit<NsmOverview, "balance">> {
  const todayStart = Math.floor(nowSec / DAY_SECONDS) * DAY_SECONDS;
  const today = utcDayOf(todayStart);
  const activation = await pool.query<{ timestamp: string }>(
    "SELECT timestamp::text AS timestamp FROM block WHERE height = $1",
    [NU7_HEIGHT],
  );
  const at = activation.rows[0];
  if (at === undefined) {
    return { activationHeight: NU7_HEIGHT, activationDay: null, days: [] };
  }
  const activationStart = Math.floor(Number(at.timestamp) / DAY_SECONDS) * DAY_SECONDS;
  const from = Math.max(activationStart, todayStart - (NSM_SERIES_DAYS - 1) * DAY_SECONDS);
  const [days, prices] = await Promise.all([
    pool.query<NsmDayRow>(NSM_DAYS_SQL, [NU7_HEIGHT, from, STRETCHES.starts, STRETCHES.subsidies]),
    pool.query<{ day: string; usd: number }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, usd FROM zec_price_daily
        WHERE day >= $1::date AND day < $2::date`,
      [utcDayOf(from), today],
    ),
  ]);
  const rows = days.rows;
  let contiguous = true;
  if (rows.length > 0) {
    const lo = Math.min(...rows.map((r) => r.lo));
    const hi = Math.max(...rows.map((r) => r.hi));
    // Counted by height, not from the day rows: a block stamped before the first day's midnight
    // is in the range but in no row, and is not missing.
    const held = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM block WHERE height BETWEEN $1 AND $2",
      [lo, hi],
    );
    contiguous = held.rows[0]!.n === hi - lo + 1 && (from > activationStart || lo === NU7_HEIGHT);
  }
  return {
    activationHeight: NU7_HEIGHT,
    activationDay: utcDayOf(activationStart),
    days: nsmDaysOf(rows, new Map(prices.rows.map((p) => [p.day, p.usd])), today, contiguous),
  };
}

// ------------------------------------------------------------------------------ carried in

/**
 * Blocks the cached prefix stops short of the index's newest, deeper than any reorg: the prefix
 * is held for minutes, so it must not cover a block that can still be replaced.
 */
const PREFIX_MARGIN = 100;

export const NSM_SPAN_SQL = `
  SELECT count(*)::int AS n, count(total_fee_zat)::int AS known,
         COALESCE(sum((total_fee_zat * 6) / 10), 0)::text AS nsm
    FROM block WHERE height > $1::int AND height <= $2::int`;

/** Fee shares into the NSM over heights `(after, upTo]`, or null unless every block is stored with its fee. */
async function nsmSpanZat(
  pool: Pick<Pool, "query">,
  after: number,
  upTo: number,
): Promise<number | null> {
  const r = (
    await pool.query<{ n: number; known: number; nsm: string }>(NSM_SPAN_SQL, [after, upTo])
  ).rows[0];
  return r !== undefined && r.n === upTo - after && r.known === r.n ? Number(r.nsm) : null;
}

/** Fee shares into the NSM from NU7 to `height` inclusive; null when any is unknown. */
export interface NsmPrefix {
  height: number;
  nsmZat: number | null;
}

/** The prefix up to `PREFIX_MARGIN` blocks below the index's newest: the slow part, memoised. */
export async function loadNsmPrefix(pool: Pick<Pool, "query">): Promise<NsmPrefix> {
  const top = await pool.query<{ h: number | null }>("SELECT max(height) AS h FROM block");
  const height = (top.rows[0]?.h ?? 0) - PREFIX_MARGIN;
  if (height < NU7_HEIGHT) return { height: NU7_HEIGHT - 1, nsmZat: 0 };
  return { height, nsmZat: await nsmSpanZat(pool, NU7_HEIGHT - 1, height) };
}

/**
 * The balance less every fee share from NU7 to the block it was read at: the cached prefix plus
 * the few blocks after it, read now. Null unless the index holds that very block (same hash, so
 * not a branch the node has left) and every block before it with its fee: an index a block behind
 * the node answers null, never a figure short by that block's share. Null too from ZIP 237's
 * reissuance height, where ZEC also leaves the balance, and for a negative result, which only a
 * misreading can produce.
 */
export async function nsmCarriedInZat(
  pool: Pick<Pool, "query">,
  prefix: NsmPrefix,
  tip: { height: number; hash: string; nsmZat: number | null },
): Promise<number | null> {
  if (tip.nsmZat === null || prefix.nsmZat === null) return null;
  if (tip.height < NU7_HEIGHT || tip.height >= REISSUANCE_START_HEIGHT) return null;
  if (tip.height < prefix.height) return null;
  const [tail, held] = await Promise.all([
    nsmSpanZat(pool, prefix.height, tip.height),
    pool.query<{ hash: string }>("SELECT hash FROM block WHERE height = $1", [tip.height]),
  ]);
  if (tail === null || held.rows[0]?.hash !== tip.hash) return null;
  const carried = tip.nsmZat - prefix.nsmZat - tail;
  return carried >= 0 ? carried : null;
}
