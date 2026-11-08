import type { Pool } from "pg";
import { NU7_HEIGHT, utcDayOf, type NsmDay, type NsmOverview } from "@/domain";
import { DAY_SECONDS } from "@/domain/time";
import "./pg-types";

/**
 * The NSM's daily series for `/miners`, read from `block` by height from NU7 on: every block,
 * whatever its coinbase, because the fee split is public. Bounded by the page's longest window,
 * so a read is at most 90 days of blocks on the primary key, memoised by the route.
 *
 * The NSM's share is `floor(6 × fees / 10)` on each block's own total, summed per day, the rounding
 * `minerFeeShareZat` and the miners rollup (`mining-daily.ts`) use; the day of a block is the UTC
 * day of its timestamp, as `nsm_daily` in the open dataset has it, so the two agree day by day.
 */

/** The trailing days served: the longest window `/miners` offers. */
export const NSM_SERIES_DAYS = 90;

export const NSM_DAYS_SQL = `
  SELECT to_char((to_timestamp(timestamp) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
         count(*)::int AS blocks, min(height) AS lo, max(height) AS hi,
         count(total_fee_zat)::int AS fee_blocks,
         sum(total_fee_zat)::text AS fees,
         sum((total_fee_zat * 6) / 10)::text AS nsm
    FROM block
   WHERE height >= $1::int AND timestamp >= $2::bigint
   GROUP BY 1 ORDER BY 1`;

export interface NsmDayRow {
  day: string;
  blocks: number;
  lo: number;
  hi: number;
  fee_blocks: number;
  fees: string | null;
  nsm: string | null;
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
    pool.query<NsmDayRow>(NSM_DAYS_SQL, [NU7_HEIGHT, from]),
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
