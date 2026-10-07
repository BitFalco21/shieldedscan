import type { Pool } from "pg";
import {
  MINER_SIGNATURES,
  MINING_WINDOW_SECONDS,
  ZEBRA_COINBASE_MARK,
  type MinerGroup,
  type MiningOverview,
  type MiningWindowKey,
} from "@/domain";
import { blockHeightRange } from "./chain-window";

/**
 * Who mined a range of blocks, from the `block` table's miner columns: the source of
 * `/chain/mining` (the `/mining` page) and of `/v1/analytics/miners`.
 *
 * Every figure reads columns the follower writes from `parseBlock` (and the miner repair fills
 * for the oldest blocks with the same function): `miner_kind`, `miner_address`,
 * `miner_reward_zat`, `coinbase_tag`, `difficulty`, `total_fee_zat`. Nothing here re-derives a
 * miner. Grouping is by payout address and two addresses are never merged, so a share is a lower
 * bound for any operator behind several addresses.
 *
 * Names come only from `MINER_SIGNATURES` (operators that wrote their own name into their
 * coinbase), matched in SQL generated from that table in `selfDeclaredMiner`'s first-match
 * order, so the page and the domain function cannot name a block differently. Names stay off
 * `/v1`.
 */

/** A committed constant as an SQL literal. Never used for anything a caller supplies. */
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
const contains = (needle: string) =>
  `strpos(lower(coinbase_tag), ${literal(needle.toLowerCase())}) > 0`;

/** The k-th signature counts the blocks no earlier signature claimed. */
export const SIGNATURE_FILTERS: readonly string[] = MINER_SIGNATURES.map((s, k) =>
  [
    contains(s.needle),
    ...MINER_SIGNATURES.slice(0, k).map((e) => `NOT ${contains(e.needle)}`),
  ].join(" AND "),
);

/** One row per (kind, payout address) over heights `$1..$2`. */
export const MINING_GROUPS_SQL = `
  SELECT miner_kind, miner_address, count(*)::int AS blocks,
         COALESCE(sum(miner_reward_zat), 0)::bigint AS reward,
         sum(total_fee_zat)::bigint AS fees, count(total_fee_zat)::int AS fee_blocks,
         min(height)::int AS first_height, max(height)::int AS last_height
         ${SIGNATURE_FILTERS.map((f, k) => `, count(*) FILTER (WHERE ${f})::int AS sig${k}`).join("")}
    FROM block WHERE height BETWEEN $1 AND $2
   GROUP BY miner_kind, miner_address`;

/** The range's network facts over heights `$1..$2`. */
export const MINING_RANGE_SQL = `
  SELECT count(*)::int AS blocks, min(timestamp)::bigint AS first_ts,
         max(timestamp)::bigint AS last_ts, avg(difficulty)::float8 AS avg_difficulty,
         avg(tx_count - 1)::float8 AS avg_tx, avg(total_fee_zat)::float8 AS avg_fee,
         count(total_fee_zat)::int AS fee_blocks,
         count(*) FILTER (WHERE strpos(coinbase_tag, ${literal(ZEBRA_COINBASE_MARK)}) > 0)::int
           AS zebra,
         count(*) FILTER (WHERE miner_kind IS NULL)::int AS unrecorded
    FROM block WHERE height BETWEEN $1 AND $2`;

export interface MinerGroupRow {
  kind: "transparent" | "shielded" | "unknown" | null;
  address: string | null;
  blocks: number;
  rewardZat: number;
  /** Null unless every block in the group has a fee total. */
  feeZat: number | null;
  firstHeight: number;
  lastHeight: number;
  /** The operator that named itself in most of the group's blocks, and in how many. */
  name: string | null;
  selfDeclaredBlocks: number;
}

export interface MiningRange {
  fromHeight: number;
  toHeight: number;
  blocks: number;
  spanSeconds: number;
  avgDifficulty: number | null;
  avgTxCount: number | null;
  /** Null unless every block in the range has a fee total. */
  avgFeeZat: number | null;
  zebraBlocks: number;
  /** Blocks whose miner columns are not filled yet (the repair's range, while it runs). */
  unrecordedBlocks: number;
  groups: MinerGroupRow[];
}

export async function loadMiningRange(
  pool: Pool,
  fromHeight: number,
  toHeight: number,
): Promise<MiningRange> {
  const [range, groups] = await Promise.all([
    pool.query<Record<string, string | number | null>>(MINING_RANGE_SQL, [fromHeight, toHeight]),
    pool.query<Record<string, string | number | null>>(MINING_GROUPS_SQL, [fromHeight, toHeight]),
  ]);
  const r = range.rows[0] ?? {};
  const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));
  const blocks = Number(r.blocks ?? 0);
  return {
    fromHeight,
    toHeight,
    blocks,
    spanSeconds: blocks > 0 ? Number(r.last_ts) - Number(r.first_ts) : 0,
    avgDifficulty: num(r.avg_difficulty),
    avgTxCount: num(r.avg_tx),
    avgFeeZat: blocks > 0 && Number(r.fee_blocks) === blocks ? num(r.avg_fee) : null,
    zebraBlocks: Number(r.zebra ?? 0),
    unrecordedBlocks: Number(r.unrecorded ?? 0),
    groups: groups.rows.map((g) => {
      const counts = MINER_SIGNATURES.map((_, k) => Number(g[`sig${k}`] ?? 0));
      const best = counts.reduce((b, n, k) => (n > counts[b]! ? k : b), 0);
      const declared = counts[best] ?? 0;
      const groupBlocks = Number(g.blocks);
      return {
        kind: (g.miner_kind as MinerGroupRow["kind"]) ?? null,
        address: (g.miner_address as string | null) ?? null,
        blocks: groupBlocks,
        rewardZat: Number(g.reward),
        feeZat: Number(g.fee_blocks) === groupBlocks ? num(g.fees) : null,
        firstHeight: Number(g.first_height),
        lastHeight: Number(g.last_height),
        name: declared > 0 ? MINER_SIGNATURES[best]!.name : null,
        selfDeclaredBlocks: declared,
      };
    }),
  };
}

/** Thirty difficulty readings at evenly spaced heights — exact header values. */
async function trendOf(pool: Pool, lo: number, hi: number) {
  const points = 30;
  const heights = [
    ...new Set(
      Array.from({ length: points }, (_, i) => Math.round(lo + ((hi - lo) * i) / (points - 1))),
    ),
  ];
  const { rows } = await pool.query<{
    height: number;
    timestamp: string;
    difficulty: number | null;
  }>(
    "SELECT height, timestamp, difficulty FROM block WHERE height = ANY($1::int[]) ORDER BY height",
    [heights],
  );
  return rows
    .filter((r) => r.difficulty !== null)
    .map((r) => ({ timestamp: Number(r.timestamp), height: r.height, difficulty: r.difficulty! }));
}

/**
 * The `/mining` page's overview for a rolling window ending now. The solution rate is the node's
 * own figure over the window's blocks when it answers, else null, and the page then shows its
 * labelled estimate.
 */
export async function loadMiningOverview(
  pool: Pool,
  key: MiningWindowKey,
  nowSec: number,
  nodeSolps: (blocks: number, height: number) => Promise<number | null> = async () => null,
): Promise<MiningOverview | null> {
  const span = MINING_WINDOW_SECONDS[key];
  const { lo, hi } = await blockHeightRange(pool, nowSec - span, nowSec + 1);
  if (lo === null || hi === null) return null;
  const [range, trend] = await Promise.all([loadMiningRange(pool, lo, hi), trendOf(pool, lo, hi)]);
  const solps = await nodeSolps(range.blocks, hi).catch(() => null);
  const groups: MinerGroup[] = range.groups
    .filter((g) => g.kind === "transparent" || g.kind === "shielded")
    .map((g) => ({
      address: g.kind === "transparent" ? g.address : null,
      name: g.name,
      basis: g.name === null ? ("unattributed" as const) : ("self-declared" as const),
      blocks: g.blocks,
      selfDeclaredBlocks: g.selfDeclaredBlocks,
      rewardZat: g.rewardZat,
      feeZat: g.feeZat,
      avgIntervalSeconds: g.blocks < 2 ? null : range.spanSeconds / g.blocks,
    }));
  return {
    window: {
      key,
      fromHeight: lo,
      toHeight: hi,
      blocks: range.blocks,
      spanSeconds: range.spanSeconds,
      avgDifficulty: range.avgDifficulty ?? 0,
      avgTxCount: range.avgTxCount ?? 0,
      avgFeeZat: range.avgFeeZat,
      solutionsPerSecond: solps !== null && Number.isFinite(solps) && solps > 0 ? solps : null,
    },
    groups,
    trend,
    software: { zebra: range.zebraBlocks, unidentified: range.blocks - range.zebraBlocks },
  };
}
