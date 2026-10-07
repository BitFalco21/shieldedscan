import type { Pool } from "pg";
import type { Transaction, TxDirection } from "@/domain";
import { txDirection } from "@/domain";
import type { StoredTxDirection } from "./tx-direction-column";
import { txDirectionColumn } from "./tx-direction-column";

/**
 * Fill `tx.direction` for mixed transactions written before the column existed. The writer fills
 * it going forward; older mixed rows are NULL until this runs.
 *
 * No node calls: `txDirection` reads the pools' published value balances (columns on `tx`) and
 * the transparent input/output counts (rows in `tx_transparent_io`, whose primary key
 * `(txid, io, ordinal)` makes the count an index-only scan). So this cannot degrade the site.
 *
 * Not computed in SQL: a `CASE` reproducing the classifier would be a second derivation of a fact
 * `domain/` already answers. Rows are rebuilt into the minimum domain shape and passed through
 * the real {@link txDirection}.
 *
 * Termination: the remaining work is `kind = 'mixed' AND direction IS NULL`, and every visited
 * row is written with one of the three stored values (a mixed transaction whose pools disagree
 * gets `'indeterminate'`, never NULL), so the predicate strictly shrinks.
 *
 * Idempotent and safe to interrupt; `AND direction IS NULL` on the UPDATE means a concurrent
 * follower write always wins.
 */

export interface RepairDirectionDeps {
  pool: Pool;
  log: (message: string) => void;
  /** Rows per pass. Bounded so no single statement bloats the table. */
  batch?: number;
  /**
   * Stop after this many rows; defaults to every row with a hole. Lets a first run against a real
   * database be bounded to something checkable by hand.
   */
  limit?: number;
  /** Refresh the counts matview when finished. On by default. */
  refresh?: boolean;
}

export interface RepairDirectionResult {
  scanned: number;
  written: number;
  /** Written as each value, so the run can be checked against the expected distribution. */
  shielding: number;
  unshielding: number;
  indeterminate: number;
}

/** The columns the classifier needs, and nothing else. */
export interface StoredMixedRow {
  txid: string;
  /**
   * Sprout's joinsplit count: the only thing that shows the pool was touched.
   *
   * Sprout publishes no `valueBalanceZat`, so a Sprout-only transaction has all three balance
   * columns NULL. Rebuilt without this, it has no shielded bundle, `txKind` calls it `transparent`,
   * and every Sprout-only row would be stored as `indeterminate`. A new pool can be missing from a
   * sum; an old one can be shaped differently from it.
   */
  sprout_joinsplits: string | number | null;
  sapling_value_balance_zat: string | number | null;
  orchard_value_balance_zat: string | number | null;
  ironwood_value_balance_zat: string | number | null;
  t_in: string | number;
  t_out: string | number;
}

/**
 * `BIGINT` arrives from `pg` as a string. A value balance is far inside
 * `Number.MAX_SAFE_INTEGER` (the entire supply is 2.1e15), so converting is safe, but null is
 * mapped before conversion because `Number(null)` is `0`.
 */
function bigintOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rebuild just enough of a domain `Transaction` for {@link txDirection}.
 *
 * The transparent sides are arrays of the right length with placeholder entries, which is all the
 * classifier reads (it never consults an input's value or address). A bundle is present exactly
 * when its value balance column is non-null, the invariant the `*_bundle_whole` CHECK constraints
 * enforce on write.
 */
export function rowToClassifiable(row: StoredMixedRow): Transaction {
  const side = { address: "", valueZat: 0 };
  // A bundle exists when the count is present AND non-zero: `parseSprout` returns null for an
  // empty `vjoinsplit`, and the writer stores 0 for "derived, and this transaction has none".
  const storedJoinSplits = bigintOrNull(row.sprout_joinsplits);
  const sproutJoinSplits =
    storedJoinSplits === null || storedJoinSplits === 0 ? null : storedJoinSplits;
  const sapling = bigintOrNull(row.sapling_value_balance_zat);
  const orchard = bigintOrNull(row.orchard_value_balance_zat);
  const ironwood = bigintOrNull(row.ironwood_value_balance_zat);
  return {
    txid: row.txid,
    blockHeight: 0,
    blockHash: null,
    timestamp: 0,
    isCoinbase: false,
    version: 5,
    sizeBytes: 0,
    lockTime: null,
    expiryHeight: null,
    rawHex: null,
    feeZat: null,
    bindingSigValid: null,
    transparentInputs: Array.from({ length: Number(row.t_in) }, () => ({ ...side })),
    transparentOutputs: Array.from({ length: Number(row.t_out) }, () => ({ ...side })),
    // Sprout must be reconstructed even though it publishes no value balance (see
    // `sprout_joinsplits`): its presence makes `hasShielded` true and the transaction `mixed`. A
    // Sprout-only transaction with transparent value on exactly one side has an unambiguous
    // direction.
    sprout: sproutJoinSplits === null ? null : { joinSplits: sproutJoinSplits },
    sapling: sapling === null ? null : { spends: 0, outputs: 0, valueBalanceZat: sapling },
    orchard: orchard === null ? null : { actions: 0, valueBalanceZat: orchard },
    ironwood: ironwood === null ? null : { actions: 0, valueBalanceZat: ironwood },
  };
}

/** What to store for one row. Never null: see the termination note above. */
export function directionForRow(row: StoredMixedRow): StoredTxDirection {
  const direction: TxDirection = txDirection(rowToClassifiable(row));
  // The row came from `WHERE kind = 'mixed'`, so the encoder's non-mixed branch is unreachable.
  return txDirectionColumn("mixed", direction) ?? "indeterminate";
}

export async function repairDirection(deps: RepairDirectionDeps): Promise<RepairDirectionResult> {
  const { pool, log } = deps;
  const batch = deps.batch ?? 5000;
  const result: RepairDirectionResult = {
    scanned: 0,
    written: 0,
    shielding: 0,
    unshielding: 0,
    indeterminate: 0,
  };

  for (;;) {
    if (deps.limit !== undefined && result.scanned >= deps.limit) break;
    const take = deps.limit === undefined ? batch : Math.min(batch, deps.limit - result.scanned);

    /*
     * Counts come from a LATERAL rather than a GROUP BY join: each subquery is a primary-key range
     * scan on `(txid, io, ...)` for one txid, so the planner never aggregates a slice of the large
     * io table. `block_height IS NOT NULL` excludes mempool rows, which the follower rewrites on
     * confirmation anyway.
     */
    const { rows } = await pool.query<StoredMixedRow>(
      `SELECT t.txid,
              t.sprout_joinsplits,
              t.sapling_value_balance_zat,
              t.orchard_value_balance_zat,
              t.ironwood_value_balance_zat,
              io.t_in,
              io.t_out
         FROM tx AS t
         CROSS JOIN LATERAL (
           SELECT count(*) FILTER (WHERE io = 'in')  AS t_in,
                  count(*) FILTER (WHERE io = 'out') AS t_out
             FROM tx_transparent_io
            WHERE txid = t.txid
         ) AS io
        WHERE t.kind = 'mixed' AND t.direction IS NULL AND t.block_height IS NOT NULL
        LIMIT $1`,
      [take],
    );
    if (rows.length === 0) break;
    result.scanned += rows.length;

    const txids: string[] = [];
    const values: StoredTxDirection[] = [];
    for (const row of rows) {
      const direction = directionForRow(row);
      txids.push(row.txid);
      values.push(direction);
      result[direction]++;
    }

    // `AND t.direction IS NULL` so a concurrent follower write always wins: this job only fills
    // holes.
    const { rowCount } = await pool.query(
      `UPDATE tx AS t
          SET direction = v.d
         FROM (SELECT unnest($1::text[]) AS txid, unnest($2::text[]) AS d) AS v
        WHERE t.txid = v.txid AND t.direction IS NULL`,
      [txids, values],
    );
    result.written += rowCount ?? 0;
    log(
      `direction: ${result.written} written (${result.shielding} shielding, ` +
        `${result.unshielding} unshielding, ${result.indeterminate} indeterminate)`,
    );
  }

  if (deps.refresh ?? true) {
    log("refreshing chain_tx_mixed_direction_count");
    await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_tx_mixed_direction_count");
  }
  return result;
}
