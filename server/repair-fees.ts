import type { Pool } from "pg";
import { blockTotalFeeZat, feeFromTermsZat, parseBlock } from "@/data/chain/parse";
import type { NodeRpcPort } from "./follow";
import { RESOLVE_INPUTS_JOIN } from "./postgres-chain-store";

/**
 * Recompute every stored fee from stored terms, without re-ingesting the chain.
 *
 * Re-running the backfiller would upsert every `tx_transparent_io` row and leave a dead tuple per
 * row on a very large table. This writes only the small `tx` and `block` rows instead, and
 * re-reads the node only for blocks that contain a joinsplit.
 *
 * It does not reimplement the fee equation: that lives once, in `feeFromTermsZat`, and this
 * module supplies the same terms from Postgres. `blockTotalFeeZat` is shared for the same reason.
 *
 * The one translation performed here is the sign flip. `tx.*_value_balance_zat` is stored in
 * domain sign (positive = value entering the pool) while the fee equation is defined in RPC sign;
 * omitting the flip yields the correct magnitude with the wrong sign. `sprout_vpub_net_zat` is
 * stored already in RPC sign and needs no flip.
 *
 * Idempotent and safe to interrupt: it holds no checkpoint, because each phase's remaining work
 * is derivable from the rows themselves.
 */

export interface RepairFeesDeps {
  pool: Pool;
  rpc: Pick<NodeRpcPort, "getBlock">;
  log: (message: string) => void;
  /** Rows per statement. Bounded so no single transaction bloats the table. */
  batch?: number;
  /** Stop before this height; defaults to every block present. */
  end?: number;
}

export interface RepairFeesResult {
  inputsResolved: number;
  sproutTermsFilledTrivially: number;
  sproutBlocksRefetched: number;
  sproutTxsUpdated: number;
  feesWritten: number;
  blockTotalsWritten: number;
}

const DEFAULT_BATCH = 20_000;

/**
 * The ceiling for "no end height given": INT4 max, exactly what `block_height` can hold.
 * `Number.MAX_SAFE_INTEGER` would be rejected by Postgres as out of range for an INTEGER bind.
 */
const MAX_BLOCK_HEIGHT = 2_147_483_647;

/** A transaction's fee terms as stored, before any sign translation. */
interface StoredTerms {
  txid: string;
  is_coinbase: boolean;
  transparent_in: string | null;
  transparent_out: string | null;
  unresolved_inputs: number;
  has_io_rows: boolean;
  sprout_vpub_net_zat: string | null;
  sapling_value_balance_zat: string | null;
  orchard_value_balance_zat: string | null;
  ironwood_value_balance_zat: string | null;
}

/**
 * BIGINT arrives as a string from `pg` unless a global parser is installed, and this module must
 * not assume one. `Number` is exact to 2^53, far above the supply cap in zatoshi (2.1e15).
 */
const num = (v: string | null): number => (v === null ? 0 : Number(v));

/**
 * Phase 1a: every transaction with no joinsplits has a Sprout term of exactly 0. No joinsplit
 * means no `vpub_old`/`vpub_new` to sum, so no node round trip is needed.
 */
async function fillTrivialSproutTerms(deps: RepairFeesDeps, batch: number): Promise<number> {
  let filled = 0;
  for (;;) {
    const { rowCount } = await deps.pool.query(
      `UPDATE tx SET sprout_vpub_net_zat = 0
        WHERE txid IN (
          SELECT txid FROM tx
           WHERE sprout_vpub_net_zat IS NULL AND sprout_joinsplits IS NULL
           LIMIT $1
        )`,
      [batch],
    );
    const written = rowCount ?? 0;
    if (written === 0) break;
    filled += written;
    if (filled % (batch * 25) === 0) deps.log(`  sprout term (trivial): ${filled} rows`);
  }
  return filled;
}

/**
 * Phase 1b: the joinsplit-bearing blocks, the only ones re-read from the node. `parseBlock`
 * supplies `rpcSproutVB`, so the value comes from the same parser the ingest uses.
 */
async function fillSproutTermsFromNode(
  deps: RepairFeesDeps,
  end: number,
): Promise<{ blocks: number; txs: number }> {
  const { rows } = await deps.pool.query<{ block_height: number }>(
    `SELECT DISTINCT block_height FROM tx
      WHERE sprout_joinsplits IS NOT NULL AND sprout_vpub_net_zat IS NULL
        AND block_height IS NOT NULL AND block_height <= $1
      ORDER BY block_height`,
    [end],
  );
  if (rows.length > 0) {
    deps.log(`  ${rows.length} joinsplit-bearing blocks to re-read from the node`);
  }

  let blocks = 0;
  let txs = 0;
  const startedAt = Date.now();
  for (const { block_height: height } of rows) {
    const parsed = parseBlock(await deps.rpc.getBlock(height));
    const txids = parsed.transactions.map((t) => t.txid);
    const terms = parsed.transactions.map((t) => t.rpcSproutVB);
    const { rowCount } = await deps.pool.query(
      `UPDATE tx SET sprout_vpub_net_zat = data.vpub
         FROM (SELECT * FROM UNNEST($1::text[], $2::bigint[]) AS t(txid, vpub)) AS data
        WHERE tx.txid = data.txid`,
      [txids, terms],
    );
    txs += rowCount ?? 0;
    blocks += 1;
    if (blocks % 5_000 === 0) {
      const rate = blocks / ((Date.now() - startedAt) / 1000);
      const eta = Math.round((rows.length - blocks) / Math.max(rate, 0.001) / 60);
      deps.log(
        `  sprout term (node): ${blocks}/${rows.length} blocks, ${rate.toFixed(1)}/s, ~${eta}m left`,
      );
    }
  }
  return { blocks, txs };
}

/**
 * Summarise every transaction's transparent I/O once, into an indexed table.
 *
 * `tx_transparent_io` has no index on `block_height` (only the `(txid, io, ordinal)` primary key
 * and the partial `io_address_idx`), so filtering it by height per span would scan the whole
 * table once per span, and keying the join on `txid` loses to one parallel scan at this size. So:
 * one scan into an UNLOGGED table keyed by txid (derived and disposable, so WAL would be pure
 * cost), which phase 2 joins by primary key.
 */
async function buildIoSummary(deps: RepairFeesDeps): Promise<void> {
  deps.log("  summarising transparent I/O in one pass (no index on block_height exists)");
  const startedAt = Date.now();
  await deps.pool.query("DROP TABLE IF EXISTS fee_io_sums");
  await deps.pool.query(
    `CREATE UNLOGGED TABLE fee_io_sums AS
       SELECT txid,
              SUM(value_zat) FILTER (WHERE io = 'in')  AS transparent_in,
              SUM(value_zat) FILTER (WHERE io = 'out') AS transparent_out,
              COUNT(*) FILTER (WHERE io = 'in' AND value_zat IS NULL)::int AS unresolved_inputs
         FROM tx_transparent_io
        GROUP BY txid`,
  );
  await deps.pool.query("ALTER TABLE fee_io_sums ADD PRIMARY KEY (txid)");
  await deps.pool.query("ANALYZE fee_io_sums");
  deps.log(`  I/O summary built in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

/**
 * Phase 2: recompute every non-coinbase fee from stored terms.
 *
 * Walks by block height, which is indexed on `tx`, joining the I/O summary by its primary key.
 * Resumes by being re-run.
 */
async function recomputeFees(deps: RepairFeesDeps, end: number): Promise<number> {
  const { rows: bounds } = await deps.pool.query<{ lo: number | null; hi: number | null }>(
    "SELECT min(block_height) AS lo, max(block_height) AS hi FROM tx WHERE block_height IS NOT NULL",
  );
  const lo = bounds[0]?.lo ?? 0;
  const hi = Math.min(bounds[0]?.hi ?? 0, end);
  if (hi < lo) return 0;

  await buildIoSummary(deps);

  // Paced in heights for the read, chunked by row count for the write; the two must stay separate.
  // Reading wants a wide span (one indexed range joined by primary key). Writing does not:
  // `UPDATE … FROM UNNEST(array)` plans as an index seek per row while the array is small, but
  // flips to hash-joining the whole `tx` table once it is large, producing one very long statement.
  const span = 25_000;
  const WRITE_CHUNK = 10_000;
  let written = 0;
  const startedAt = Date.now();

  for (let from = lo; from <= hi; from += span) {
    const to = Math.min(from + span - 1, hi);
    const { rows } = await deps.pool.query<StoredTerms>(
      `SELECT t.txid, t.is_coinbase,
              t.sprout_vpub_net_zat, t.sapling_value_balance_zat,
              t.orchard_value_balance_zat, t.ironwood_value_balance_zat,
              io.transparent_in, io.transparent_out,
              COALESCE(io.unresolved_inputs, 0) AS unresolved_inputs,
              (io.txid IS NOT NULL) AS has_io_rows
         FROM tx t
         LEFT JOIN fee_io_sums io ON io.txid = t.txid
        WHERE t.block_height BETWEEN $1 AND $2`,
      [from, to],
    );
    if (rows.length === 0) continue;

    const txids: string[] = [];
    const fees: (number | null)[] = [];
    for (const row of rows) {
      txids.push(row.txid);
      fees.push(feeForStoredRow(row));
    }

    for (let i = 0; i < txids.length; i += WRITE_CHUNK) {
      await deps.pool.query(
        `UPDATE tx SET fee_zat = data.fee
           FROM (SELECT * FROM UNNEST($1::text[], $2::bigint[]) AS t(txid, fee)) AS data
          WHERE tx.txid = data.txid`,
        [txids.slice(i, i + WRITE_CHUNK), fees.slice(i, i + WRITE_CHUNK)],
      );
    }
    written += txids.length;

    if (to % (span * 8) < span) {
      const done = to - lo + 1;
      const rate = done / ((Date.now() - startedAt) / 1000);
      deps.log(`  fees: height ${to}/${hi}, ${written} rows, ${Math.round(rate)} blk/s`);
    }
  }
  return written;
}

/**
 * The fee for one stored row, or null where it is genuinely unknowable.
 *
 * Two null cases: a coinbase has no fee, and an unresolved input makes the transparent total
 * unknown (a partial sum would be a confident wrong number). A row with no I/O rows is neither:
 * it is fully shielded, so its transparent total is exactly 0.
 */
export function feeForStoredRow(row: StoredTerms): number | null {
  if (row.is_coinbase) return null;
  if (row.unresolved_inputs > 0) return null;
  return feeFromTermsZat({
    transparentInZat: row.has_io_rows ? num(row.transparent_in) : 0,
    transparentOutZat: row.has_io_rows ? num(row.transparent_out) : 0,
    // Domain sign -> RPC sign: see the module comment.
    rpcSproutVB: num(row.sprout_vpub_net_zat), // already RPC sign, by design
    rpcSaplingVB: -num(row.sapling_value_balance_zat),
    rpcOrchardVB: -num(row.orchard_value_balance_zat),
    rpcIronwoodVB: -num(row.ironwood_value_balance_zat),
  });
}

/**
 * Phase 3: each block's total, through the shared all-or-nothing rule.
 *
 * Done in TypeScript via `blockTotalFeeZat` rather than a SQL aggregate, so the null rule has one
 * definition. A block holding only its coinbase totals 0: it collected no fees, which is a
 * measurement rather than an absence.
 */
async function recomputeBlockTotals(deps: RepairFeesDeps, end: number): Promise<number> {
  const span = 20_000;
  const { rows: bounds } = await deps.pool.query<{ lo: number | null; hi: number | null }>(
    "SELECT min(height) AS lo, max(height) AS hi FROM block",
  );
  const lo = bounds[0]?.lo ?? 0;
  const hi = Math.min(bounds[0]?.hi ?? 0, end);
  let written = 0;

  for (let from = lo; from <= hi; from += span) {
    const to = Math.min(from + span - 1, hi);
    const { rows } = await deps.pool.query<{ height: number; fees: (string | null)[] }>(
      `SELECT b.height,
              COALESCE(ARRAY_AGG(t.fee_zat) FILTER (WHERE t.txid IS NOT NULL), '{}') AS fees
         FROM block b
         LEFT JOIN tx t ON t.block_height = b.height AND t.kind <> 'coinbase'
        WHERE b.height BETWEEN $1 AND $2
        GROUP BY b.height`,
      [from, to],
    );
    if (rows.length === 0) continue;

    const heights = rows.map((r) => r.height);
    const totals = rows.map((r) =>
      blockTotalFeeZat(r.fees.map((f) => (f === null ? null : Number(f)))),
    );
    await deps.pool.query(
      `UPDATE block SET total_fee_zat = data.total
         FROM (SELECT * FROM UNNEST($1::int[], $2::bigint[]) AS t(height, total)) AS data
        WHERE block.height = data.height`,
      [heights, totals],
    );
    written += heights.length;
  }
  return written;
}

/**
 * Phase 0: re-resolve inputs left NULL because the output they spend had not been stored yet.
 *
 * Must run before fees: an unresolved input makes a fee unknowable. Ingest resolves against
 * outputs already stored, which is correct only while ingest runs strictly in block order;
 * switching the follower's ingest mode can leave a reorg-depth band unresolved.
 *
 * A pure join, idempotent: it only fills a NULL. Inputs whose output is genuinely not in our
 * history stay NULL.
 */
async function resolveOrphanedInputs(deps: RepairFeesDeps): Promise<number> {
  // One statement over the whole table, not one per height range: with no index on
  // `block_height`, each range would scan the whole table. The self-join reads it once and updates
  // only the rows that can now resolve.
  const { rowCount } = await deps.pool.query(RESOLVE_INPUTS_JOIN);
  return rowCount ?? 0;
}

export async function repairFees(deps: RepairFeesDeps): Promise<RepairFeesResult> {
  const batch = deps.batch ?? DEFAULT_BATCH;
  const end = deps.end ?? MAX_BLOCK_HEIGHT;

  deps.log("phase 0: re-resolve inputs whose output was not yet stored when they were ingested");
  const inputsResolved = await resolveOrphanedInputs(deps);
  deps.log(`  ${inputsResolved} inputs resolved`);

  deps.log("phase 1a: sprout term for transactions with no joinsplits");
  const sproutTermsFilledTrivially = await fillTrivialSproutTerms(deps, batch);
  deps.log(`  ${sproutTermsFilledTrivially} rows set to 0`);

  deps.log("phase 1b: sprout term from the node, joinsplit-bearing blocks only");
  const sprout = await fillSproutTermsFromNode(deps, end);
  deps.log(`  ${sprout.blocks} blocks re-read, ${sprout.txs} transactions updated`);

  deps.log("phase 2: recompute every fee from stored terms");
  const feesWritten = await recomputeFees(deps, end);
  deps.log(`  ${feesWritten} fees written`);

  // The I/O summary is disposable and large; dropping it ensures the next run cannot recompute
  // fees from a stale summary.
  await deps.pool.query("DROP TABLE IF EXISTS fee_io_sums");

  deps.log("phase 3: recompute block totals");
  const blockTotalsWritten = await recomputeBlockTotals(deps, end);
  deps.log(`  ${blockTotalsWritten} block totals written`);

  return {
    inputsResolved,
    sproutTermsFilledTrivially,
    sproutBlocksRefetched: sprout.blocks,
    sproutTxsUpdated: sprout.txs,
    feesWritten,
    blockTotalsWritten,
  };
}
