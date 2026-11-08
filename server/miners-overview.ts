import type { Pool } from "pg";
import {
  MINERS_HISTORY_FROM_DAY,
  MINING_POOL_LABELS,
  NO_ADDRESS_GROUP,
  SHIELDED_GROUP,
  UNATTRIBUTED_GROUP,
  minersWindowDays,
  utcDayOf,
  type MinerAddressRow,
  type MinerSeries,
  type MinerTotals,
  type MinersOverview,
  type MinersWindowKey,
  type MiningPoolBlock,
  type MinerUsdParts,
} from "@/domain";
import { DAY_SECONDS } from "@/domain/time";
import "./pg-types";

/**
 * The `/miners` page's reads, from the daily rollups (`mining_day_payout`, `mining_day`) and the
 * daily close (`zec_price_daily`) only; one pool's recent blocks read `block` by primary-key
 * ranges found in the rollup. Every bound is a whole UTC day as `YYYY-MM-DD`; the payout table's
 * primary key leads with `day`, so a window is a key range.
 *
 * USD is priced in SQL per (address, day) at that day's stored close, for closed days only.
 * Today's reward is returned unpriced, decided by date: the price feed stores today's unfinished
 * bar too, and that is not a close. The registry goes in as array parameters; no SQL is built
 * from it.
 */

/** The registry the API groups by: every reviewed payout address and its pool, sorted. */
export function miningRegistry(): { addresses: string[]; pools: string[] } {
  const addresses = Object.keys(MINING_POOL_LABELS).sort();
  return { addresses, pools: addresses.map((a) => MINING_POOL_LABELS[a]!.miningPool) };
}

/** The day after `day`, `YYYY-MM-DD`. */
const nextDay = (day: string) => utcDayOf(Date.parse(`${day}T00:00:00Z`) / 1000 + DAY_SECONDS);

const n = (v: string | number | null) => (v === null ? null : Number(v));

interface AddressAgg {
  address: string;
  blocks: number;
  reward: string | null;
  fees: string | null;
  lo: number;
  hi: number;
  closed_usd: number;
  unpriced: string;
  today: string;
}

/** Per transparent address over `[from, to]`, with the USD parts; `today` is the unfinished day. */
export const MINERS_ADDRESS_SQL = `
  SELECT m.address, sum(m.blocks)::int AS blocks,
         CASE WHEN count(m.reward_zat) = count(*) THEN sum(m.reward_zat) END::text AS reward,
         CASE WHEN sum(m.fee_blocks) = sum(m.blocks) THEN sum(m.fee_zat) END::text AS fees,
         min(m.first_height) AS lo, max(m.last_height) AS hi,
         COALESCE(sum(m.reward_zat * p.usd / 1e8)
                    FILTER (WHERE m.day < $3::date AND p.usd IS NOT NULL), 0)::float8 AS closed_usd,
         COALESCE(sum(m.reward_zat) FILTER (WHERE m.day < $3::date AND p.usd IS NULL), 0)::text
           AS unpriced,
         COALESCE(sum(m.reward_zat) FILTER (WHERE m.day >= $3::date), 0)::text AS today
    FROM mining_day_payout m
    LEFT JOIN zec_price_daily p ON p.day = m.day
   WHERE m.day >= $1::date AND m.day < $2::date AND m.kind = 'transparent'
   GROUP BY m.address`;

const usdOf = (r: Pick<AddressAgg, "closed_usd" | "unpriced" | "today">): MinerUsdParts => ({
  closedUsd: r.closed_usd,
  unpricedZat: Number(r.unpriced),
  todayZat: Number(r.today),
});

function totalsOf(rows: readonly MinerAddressRow[]): MinerTotals {
  const known = <K extends "rewardZat" | "feeZat">(k: K) =>
    rows.some((r) => r[k] === null) ? null : rows.reduce((s, r) => s + r[k]!, 0);
  return {
    blocks: rows.reduce((s, r) => s + r.blocks, 0),
    addresses: rows.length,
    rewardZat: known("rewardZat"),
    feeZat: known("feeZat"),
    usd: {
      closedUsd: rows.reduce((s, r) => s + r.usd.closedUsd, 0),
      unpricedZat: rows.reduce((s, r) => s + r.usd.unpricedZat, 0),
      todayZat: rows.reduce((s, r) => s + r.usd.todayZat, 0),
    },
  };
}

/** The unattributed addresses listed under their row. */
const UNATTRIBUTED_LISTED = 10;

export async function loadMinersOverview(
  pool: Pool,
  window: MinersWindowKey,
  nowSec: number,
): Promise<MinersOverview> {
  const { fromDay, toDay } = minersWindowDays(window, nowSec);
  const end = nextDay(toDay);
  const registry = miningRegistry();
  const poolOf = new Map(registry.addresses.map((a, i) => [a, registry.pools[i]!]));
  const [addresses, kinds, header] = await Promise.all([
    pool.query<AddressAgg>(MINERS_ADDRESS_SQL, [fromDay, end, toDay]),
    pool.query<{ kind: string; blocks: number }>(
      `SELECT kind, sum(blocks)::int AS blocks FROM mining_day_payout
        WHERE day >= $1::date AND day < $2::date GROUP BY kind`,
      [fromDay, end],
    ),
    pool.query<{
      days: number;
      blocks: number;
      unrecorded: number;
      lo: number | null;
      hi: number | null;
      first: string | null;
    }>(
      `SELECT count(*)::int AS days, COALESCE(sum(blocks), 0)::int AS blocks,
              COALESCE(sum(unrecorded_blocks), 0)::int AS unrecorded,
              min(first_height) AS lo, max(last_height) AS hi,
              (SELECT to_char(min(day), 'YYYY-MM-DD') FROM mining_day) AS first
         FROM mining_day WHERE day >= $1::date AND day < $2::date`,
      [fromDay, end],
    ),
  ]);

  const rows: MinerAddressRow[] = addresses.rows.map((r) => ({
    address: r.address,
    miningPool: poolOf.get(r.address) ?? null,
    blocks: r.blocks,
    rewardZat: n(r.reward),
    feeZat: n(r.fees),
    firstHeight: r.lo,
    lastHeight: r.hi,
    usd: usdOf(r),
  }));
  const byBlocks = (a: MinerAddressRow, b: MinerAddressRow) =>
    b.blocks - a.blocks || (a.address < b.address ? -1 : 1);
  rows.sort(byBlocks);
  const labelled = rows.filter((r) => r.miningPool !== null);
  const unattributed = rows.filter((r) => r.miningPool === null);
  const top = (k: number) => rows.slice(0, k).reduce((s, r) => s + r.blocks, 0);
  const blocksOf = (k: string) => kinds.rows.find((r) => r.kind === k)?.blocks ?? 0;
  const h = header.rows[0]!;
  const start = h.first !== null && h.first > fromDay ? h.first : fromDay;
  const daysExpected =
    Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) +
    1;

  return {
    window,
    fromDay,
    toDay,
    fromHeight: h.lo,
    toHeight: h.hi,
    daysComputed: h.days,
    daysExpected: Math.max(daysExpected, 0),
    blocks: h.blocks,
    unrecordedBlocks: h.unrecorded,
    shieldedBlocks: blocksOf("shielded"),
    noAddressBlocks: blocksOf("unknown"),
    transparent: totalsOf(rows),
    unattributed: {
      ...totalsOf(unattributed),
      largest: unattributed.slice(0, UNATTRIBUTED_LISTED),
    },
    labelled,
    topBlocks: { top1: top(1), top3: top(3), top10: top(10) },
    registry: registry.addresses,
  };
}

/**
 * Blocks, reward and fees per period × group (pool id, unattributed, shielded, no address). Month:
 * every month from `MINERS_HISTORY_FROM_DAY`; day: the trailing 365 days within it. Each period's
 * total comes from `mining_day`, so a share's denominator counts unrecorded blocks too.
 */
export async function loadMinerSeries(
  pool: Pool,
  interval: "month" | "day",
  nowSec: number,
): Promise<MinerSeries> {
  const toDay = utcDayOf(Math.floor(nowSec / DAY_SECONDS) * DAY_SECONDS);
  const floor = MINERS_HISTORY_FROM_DAY ?? "1970-01-01";
  const yearAgo = utcDayOf(Math.floor(nowSec / DAY_SECONDS) * DAY_SECONDS - 364 * DAY_SECONDS);
  const fromDay = interval === "month" ? floor : yearAgo > floor ? yearAgo : floor;
  const end = nextDay(toDay);
  const unit = interval === "month" ? "month" : "day";
  const registry = miningRegistry();
  const [points, periods] = await Promise.all([
    pool.query<{
      period: string;
      grp: string;
      blocks: number;
      reward: string | null;
      fees: string | null;
    }>(
      `SELECT to_char(date_trunc('${unit}', m.day), 'YYYY-MM-DD') AS period,
              CASE WHEN m.kind = 'shielded' THEN '${SHIELDED_GROUP}'
                   WHEN m.kind = 'unknown' THEN '${NO_ADDRESS_GROUP}'
                   ELSE COALESCE(g.pool, '${UNATTRIBUTED_GROUP}') END AS grp,
              sum(m.blocks)::int AS blocks,
              CASE WHEN count(m.reward_zat) = count(*) THEN sum(m.reward_zat) END::text AS reward,
              CASE WHEN sum(m.fee_blocks) = sum(m.blocks) THEN sum(m.fee_zat) END::text AS fees
         FROM mining_day_payout m
         LEFT JOIN unnest($3::text[], $4::text[]) AS g(address, pool)
           ON m.kind = 'transparent' AND g.address = m.address
        WHERE m.day >= $1::date AND m.day < $2::date
        GROUP BY 1, 2 ORDER BY 1, 2`,
      [fromDay, end, registry.addresses, registry.pools],
    ),
    pool.query<{ period: string; blocks: number; lo: number | null; hi: number | null }>(
      `SELECT to_char(date_trunc('${unit}', day), 'YYYY-MM-DD') AS period,
              sum(blocks)::int AS blocks, min(first_height) AS lo, max(last_height) AS hi
         FROM mining_day WHERE day >= $1::date AND day < $2::date GROUP BY 1 ORDER BY 1`,
      [fromDay, end],
    ),
  ]);
  const running = interval === "month" ? `${toDay.slice(0, 7)}-01` : toDay;
  return {
    interval,
    fromDay,
    toDay,
    periods: periods.rows.map((p) => ({
      period: p.period,
      blocks: p.blocks,
      firstHeight: p.lo,
      lastHeight: p.hi,
      partial: p.period === running,
    })),
    points: points.rows.map((p) => ({
      period: p.period,
      group: p.grp,
      blocks: p.blocks,
      rewardZat: n(p.reward),
      feeZat: n(p.fees),
    })),
  };
}

/** Blocks the pool-blocks read lists by default, and at most. */
export const POOL_BLOCKS = 20;
/** The payout days it walks at most to find them. */
const POOL_BLOCK_DAYS = 31;

/**
 * A pool's newest blocks, below `beforeHeight` when given (a keyset page: heights are unique). The
 * rollup names the newest days its addresses were paid and each day's height span; `block` is then
 * read by those primary-key ranges only, never scanned. A day whose span reaches `beforeHeight` is
 * read but not counted toward the page, since the rollup cannot say how many of its blocks lie
 * below the cut. Nothing before `MINERS_HISTORY_FROM_DAY` is read, so paging ends there.
 */
export async function loadMiningPoolBlocks(
  pool: Pool,
  addresses: readonly string[],
  page: { beforeHeight?: number; limit?: number } = {},
): Promise<MiningPoolBlock[]> {
  const floor = MINERS_HISTORY_FROM_DAY ?? "1970-01-01";
  const limit = Math.min(Math.max(1, page.limit ?? POOL_BLOCKS), POOL_BLOCKS);
  const before = page.beforeHeight ?? 2_147_483_647;
  const days = await pool.query<{ lo: number; hi: number; blocks: number }>(
    `SELECT min(first_height) AS lo, max(last_height) AS hi, sum(blocks)::int AS blocks
       FROM mining_day_payout
      WHERE day >= $2::date AND kind = 'transparent' AND address = ANY($1::text[])
      GROUP BY day HAVING min(first_height) < $3 ORDER BY day DESC LIMIT ${POOL_BLOCK_DAYS}`,
    [addresses, floor, before],
  );
  const ranges: { lo: number; hi: number }[] = [];
  let found = 0;
  for (const d of days.rows) {
    ranges.push({ lo: d.lo, hi: Math.min(d.hi, before - 1) });
    if (d.hi < before) found += d.blocks;
    if (found >= limit) break;
  }
  if (ranges.length === 0) return [];
  const { rows } = await pool.query<{
    height: number;
    timestamp: string;
    miner_address: string;
    reward: string | null;
  }>(
    // One primary-key range scan per day. The inner LIMIT keeps the subquery from being flattened:
    // as a plain join the planner walks the key backward from the tip with the ranges as a
    // filter, which for a pool that stopped mining months ago reads most of the table.
    `SELECT b.height, b.timestamp::text AS timestamp, b.miner_address,
            b.miner_reward_zat::text AS reward
       FROM unnest($2::int[], $3::int[]) AS r(lo, hi)
      CROSS JOIN LATERAL (
        SELECT height, timestamp, miner_address, miner_reward_zat FROM block
         WHERE height BETWEEN r.lo AND r.hi
           AND miner_kind = 'transparent' AND miner_address = ANY($1::text[])
         ORDER BY height DESC LIMIT ${POOL_BLOCKS}
      ) b
      ORDER BY b.height DESC LIMIT $4`,
    [addresses, ranges.map((r) => r.lo), ranges.map((r) => r.hi), limit],
  );
  return rows.map((r) => ({
    height: r.height,
    timestamp: Number(r.timestamp),
    address: r.miner_address,
    rewardZat: n(r.reward),
  }));
}
