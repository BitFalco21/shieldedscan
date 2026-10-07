import { Pool } from "pg";
import {
  BOUNDARY_CONFIRMATIONS,
  type BoundaryFigures,
  type BoundaryPoolMove,
} from "@/domain/boundary";
import type { PoolName } from "@/domain/pool";
import { encodeEventWatermark, parseEventWatermark } from "@/domain/watermark";
import "./pg-types";

export { encodeEventWatermark, parseEventWatermark };

export interface EligibleBoundaryOptions {
  /** The floor, in zatoshi, on the total that crossed. */
  minZat: number;
  /** The composite `(block_height, txid)` watermark, or null on a first-ever run. */
  since: string | null;
  /** The chain tip, for the confirmation depth. */
  tipHeight: number;
  /** How many candidates to consider per poll. */
  limit: number;
}

export interface EligibleBoundaryBatch {
  /** Candidates oldest first: the poster settles each in the order the chain made them. */
  candidates: BoundaryFigures[];
  /**
   * The keyset position of the furthest eligible row, which is not necessarily the last candidate
   * (candidates are bounded by `limit` and the floor). Computed in the same statement as the
   * candidates, from the same snapshot, so a block landing between round trips cannot advance the
   * watermark past a crossing that was never considered.
   */
  frontier: string | null;
}

/**
 * One result row: the frontier, always, plus a candidate when there is one.
 *
 * The candidate columns are nullable because the join is a LEFT JOIN from the frontier: a poll
 * where nothing clears the floor still learns how far it looked, or the watermark would never move
 * and every later poll would rescan a growing range.
 */
interface BoundaryRow {
  txid: string | null;
  block_height: number | null;
  timestamp: number | null;
  ironwood: number | null;
  orchard: number | null;
  sapling: number | null;
  sprout: number | null;
  frontier_height: number;
  frontier_txid: string;
}

/** The four columns that carry a pool's signed movement, and which pool each names. */
const POOL_COLUMNS: readonly { pool: PoolName; column: keyof BoundaryRow }[] = [
  { pool: "ironwood", column: "ironwood" },
  { pool: "orchard", column: "orchard" },
  { pool: "sapling", column: "sapling" },
  { pool: "sprout", column: "sprout" },
];

/**
 * The pools that actually moved on this row.
 *
 * A zero is dropped: a transaction can carry a pool's bundle with a balance of exactly zero beside
 * another pool's real crossing, and naming the zero-balance pool would be wrong (it is present, and
 * nothing crossed its boundary). NULL is dropped for the same reason: no bundle, no movement.
 */
function movingPools(row: BoundaryRow): BoundaryPoolMove[] {
  const moves: BoundaryPoolMove[] = [];
  for (const { pool, column } of POOL_COLUMNS) {
    const value = row[column];
    if (typeof value === "number" && value !== 0) {
      moves.push({ pool, valueBalanceZat: value });
    }
  }
  return moves;
}

/**
 * The candidates for one poll: crossings past the watermark, deep enough to be safe from a reorg,
 * at or above the floor, oldest first.
 *
 * The magnitude is `abs(sum of the four pool balances)`, the quantity `boundaryAmountZat` derives
 * in the domain. That is a deliberate second expression of one rule (a TypeScript function cannot
 * be interpolated into SQL, and the floor must be in the query so `LIMIT` applies to postable
 * rows); a real-database test holds the two together.
 *
 * The direction rule is not duplicated: a crossing whose pools contradict each other is left in
 * the result and refused by `boundaryIsComplete` at the poster, so there is one definition of when
 * a direction may be claimed.
 */
export async function eligibleBoundaryCrossings(
  pool: Pool,
  opts: EligibleBoundaryOptions,
): Promise<EligibleBoundaryBatch> {
  const params: unknown[] = [
    opts.minZat, // $1
    opts.tipHeight - BOUNDARY_CONFIRMATIONS, // $2
  ];
  // Optional, as in the swap query: on a first run there is nothing already considered, and the
  // clause must not fire at all. A row-value comparison over (block_height, txid), both ascending,
  // because a txid is only unique within a block.
  let sinceClause = "";
  if (opts.since !== null) {
    const watermark = parseEventWatermark(opts.since);
    params.push(watermark.position, watermark.id);
    sinceClause = `AND (block_height, txid) > ($${params.length - 1}, $${params.length})`;
  }
  params.push(opts.limit);
  const limitParam = params.length;

  const { rows } = await pool.query<BoundaryRow>(
    `WITH eligible AS (
       SELECT t.txid, t.block_height, b.timestamp,
              t.ironwood_value_balance_zat AS ironwood,
              t.orchard_value_balance_zat  AS orchard,
              t.sapling_value_balance_zat  AS sapling,
              t.sprout_vpub_net_zat        AS sprout,
              abs(COALESCE(t.ironwood_value_balance_zat, 0)
                + COALESCE(t.orchard_value_balance_zat, 0)
                + COALESCE(t.sapling_value_balance_zat, 0)
                + COALESCE(t.sprout_vpub_net_zat, 0)) AS magnitude
         FROM tx t
         JOIN block b ON b.height = t.block_height
        WHERE t.kind = 'mixed'
          -- Both directions in one query: the poster splits them by kind afterwards, and
          -- one scan of the same index serves both.
          AND t.direction IN ('shielding', 'unshielding')
          -- Confirmations are correctness, not caution. Posting about a block that is then
          -- orphaned is the worst failure available here, and this site publishes a reorg
          -- log precisely because reorgs happen.
          AND t.block_height <= $2
          ${sinceClause}
     ),
     -- The furthest row in BLOCK order among everything CONSIDERED — deliberately before
     -- the floor is applied, and this is load-bearing. A crossing below the floor has been
     -- looked at and rejected, so the watermark must pass it; scoping the frontier to rows
     -- that clear the floor would leave a quiet week advancing nothing and every later poll
     -- rescanning a range that only grows.
     frontier AS (
       SELECT block_height, txid FROM eligible ORDER BY block_height DESC, txid DESC LIMIT 1
     ),
     -- Oldest first, over the same (block_height, txid) keyset the watermark encodes, so a
     -- batch can be settled one row at a time and resumed from where it stopped.
     candidates AS (
       SELECT * FROM eligible WHERE magnitude >= $1 ORDER BY block_height ASC, txid ASC
        LIMIT $${limitParam}
     )
     -- LEFT JOIN from the frontier, not a CROSS JOIN: a poll with a frontier and no
     -- candidate must still return the frontier. Zero rows means nothing was eligible at
     -- all, which is the one case where there is genuinely nowhere to advance to.
     SELECT c.txid, c.block_height, c.timestamp, c.ironwood, c.orchard, c.sapling, c.sprout,
            f.block_height AS frontier_height, f.txid AS frontier_txid
       FROM frontier f
       LEFT JOIN candidates c ON true`,
    params,
  );

  if (rows.length === 0) return { candidates: [], frontier: null };

  return {
    candidates: rows
      .filter((row) => row.txid !== null)
      .map((row) => ({
        txid: row.txid!,
        blockHeight: row.block_height!,
        timestamp: row.timestamp!,
        pools: movingPools(row),
        // Filled in by the poster at claim time from the live tracker, never here: the card must
        // render the price the text was composed against, and a price read twice is two prices.
        priceUsd: null,
      })),
    frontier: encodeEventWatermark(rows[0]!.frontier_height, rows[0]!.frontier_txid),
  };
}
