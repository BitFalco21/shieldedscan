import type { Pool, PoolClient } from "pg";
import type { ZcashNetwork } from "@/lib/network";
import type { LabelFlowTx } from "@/domain";
import { REORG_DEPTH } from "./follow";
import type { Pacer } from "./job-pacer";
import { rollbackQuietly } from "./pg-pool";
import "./pg-types";

/**
 * `label_flow_io` and `label_flow_tx`: every transaction that touches a labelled address, for the
 * exchange flows. Each transaction is stored whole for the current label set: the gain or loss of
 * every labelled address in it, and the transparent value on its unlabelled side.
 *
 * The walk follows `ReserveTracker`: the addresses furthest behind share one watermark and walk a
 * height chunk together; the transactions they appear in are rewritten whole. An address added
 * later walks from genesis on its own, which rewrites exactly the transactions it appears in, the
 * only ones whose unlabelled side it changes. Only heights at least `REORG_DEPTH` below the tip are
 * stored, so a row never needs taking back.
 */

/** One lock for every write to the flow tables, so two writers can never interleave. */
const WRITE_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('label_flow'))";

/** Heights per chunk; the busiest labelled address holds ~370k transactions. */
export const LABEL_FLOW_CHUNK_BLOCKS = 20_000;

/** The smallest chunk a failed one shrinks to. */
export const LABEL_FLOW_MIN_CHUNK_BLOCKS = 500;

/**
 * Rewrites `txids` whole for the labelled set `labelled`: deletes their rows, then stores one row
 * per labelled address that appears in each, and the transparent value on its unlabelled side. A
 * transaction no labelled address appears in any more is left with no rows.
 */
export async function rewriteTransactions(
  client: PoolClient,
  txids: readonly string[],
  labelled: readonly string[],
): Promise<void> {
  if (txids.length === 0) return;
  await client.query("DELETE FROM label_flow_io WHERE txid = ANY($1::text[])", [txids]);
  await client.query("DELETE FROM label_flow_tx WHERE txid = ANY($1::text[])", [txids]);
  await client.query(
    `INSERT INTO label_flow_io (txid, address, block_height, delta_zat)
     SELECT i.txid, i.address, t.block_height,
            sum(CASE i.io WHEN 'out' THEN coalesce(i.value_zat, 0) ELSE -coalesce(i.value_zat, 0) END)::bigint
       FROM tx_transparent_io i JOIN tx t ON t.txid = i.txid
      WHERE i.txid = ANY($1::text[]) AND i.address = ANY($2::text[])
      GROUP BY i.txid, i.address, t.block_height`,
    [txids, labelled],
  );
  await client.query(
    `INSERT INTO label_flow_tx (txid, block_height, timestamp, unlabelled_in_zat, unlabelled_out_zat)
     SELECT i.txid, t.block_height, t.timestamp,
            coalesce(sum(coalesce(i.value_zat, 0)) FILTER (
              WHERE i.io = 'in' AND (i.address IS NULL OR NOT i.address = ANY($2::text[]))), 0)::bigint,
            coalesce(sum(coalesce(i.value_zat, 0)) FILTER (
              WHERE i.io = 'out' AND (i.address IS NULL OR NOT i.address = ANY($2::text[]))), 0)::bigint
       FROM tx_transparent_io i JOIN tx t ON t.txid = i.txid
      WHERE i.txid = ANY($1::text[])
      GROUP BY i.txid, t.block_height, t.timestamp
     HAVING bool_or(i.address = ANY($2::text[]))`,
    [txids, labelled],
  );
}

/** The transactions `addresses` appear in at heights `lo`..`hi`. */
async function transactionsOf(
  client: PoolClient,
  addresses: readonly string[],
  lo: number,
  hi: number,
): Promise<string[]> {
  const { rows } = await client.query<{ txid: string }>(
    `SELECT DISTINCT txid FROM tx_transparent_io
      WHERE address = ANY($1::text[]) AND block_height BETWEEN $2 AND $3`,
    [addresses, lo, hi],
  );
  return rows.map((r) => r.txid);
}

/** Transactions per batch when a label is removed: one batch is a few seconds of reads. */
export const LABEL_FLOW_PRUNE_BATCH = 2_000;

/**
 * Rewrites, one batch at a time, the transactions of every address no longer labelled, so its
 * value counts as unlabelled there and a transaction left with no labelled address leaves no rows.
 * Each batch is its own transaction; the addresses' state goes with the last, so a pass cut short
 * finds them again next time. An empty list prunes nothing, so a misconfigured list cannot empty
 * the tables. Returns how many addresses were dropped, or null when `afterBatch` paused it.
 */
export async function pruneLabelFlowAddresses(
  pool: Pool,
  labelled: readonly string[],
  afterBatch: (ms: number) => Promise<"continue" | "abort"> = async () => "continue",
  batch = LABEL_FLOW_PRUNE_BATCH,
): Promise<number | null> {
  if (labelled.length === 0) return 0;
  for (;;) {
    const started = Date.now();
    const client = await pool.connect();
    let done: number | null = null;
    try {
      await client.query("BEGIN");
      await client.query(WRITE_LOCK_SQL);
      const gone = (
        await client.query<{ address: string }>(
          "SELECT address FROM label_flow_state WHERE NOT address = ANY($1::text[])",
          [labelled],
        )
      ).rows.map((r) => r.address);
      if (gone.length === 0) {
        await client.query("COMMIT");
        return 0;
      }
      const txids = (
        await client.query<{ txid: string }>(
          `SELECT DISTINCT txid FROM label_flow_io WHERE address = ANY($1::text[]) LIMIT $2`,
          [gone, batch],
        )
      ).rows.map((r) => r.txid);
      await rewriteTransactions(client, txids, labelled);
      if (txids.length < batch) {
        await client.query("DELETE FROM label_flow_state WHERE address = ANY($1::text[])", [gone]);
        done = gone.length;
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
    if (done !== null) return done;
    if ((await afterBatch(Math.max(1, Date.now() - started))) === "abort") return null;
  }
}

/**
 * Walks `group`, every address at watermark `from`, through `hi`: rewrites the transactions they
 * appear in and moves their watermarks, in one transaction. Refused when a watermark moved under it
 * (two passes can never both apply a chunk), or when the chain is no longer the one the rows were
 * stored from or `hi` is within the reorg depth: checked here, under the lock, because a walk from
 * genesis runs for hours after the pass began.
 */
export async function applyLabelFlowChunk(
  pool: Pool,
  group: readonly string[],
  from: number,
  hi: number,
  labelled: readonly string[],
  nowSec: number,
): Promise<"applied" | "moved" | "chain"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(WRITE_LOCK_SQL);
    const tip = (await client.query<{ h: number | null }>("SELECT max(height) AS h FROM block"))
      .rows[0]!.h;
    if (tip === null || hi > tip - REORG_DEPTH || !(await labelFlowChainIntact(client))) {
      await client.query("ROLLBACK");
      return "chain";
    }
    const moved = await client.query(
      `UPDATE label_flow_state SET through_height = $3, updated_at = $4
        WHERE address = ANY($1::text[]) AND through_height = $2`,
      [group, from, hi, nowSec],
    );
    if (moved.rowCount !== group.length) {
      await client.query("ROLLBACK");
      return "moved";
    }
    await rewriteTransactions(client, await transactionsOf(client, group, from + 1, hi), labelled);
    await client.query(
      `INSERT INTO label_flow_meta (id, height, hash)
       SELECT TRUE, height, hash FROM block WHERE height = $1
       ON CONFLICT (id) DO UPDATE SET height = EXCLUDED.height, hash = EXCLUDED.hash
        WHERE label_flow_meta.height < EXCLUDED.height`,
      [hi],
    );
    await client.query("COMMIT");
    return "applied";
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Whether the block the rows were last stored through still has the hash it had then. False means
 * the chain changed below stored rows: a reorg deeper than the reorg depth, or a repaired chain.
 */
export async function labelFlowChainIntact(pool: Pool | PoolClient): Promise<boolean> {
  const { rows } = await pool.query<{ stored: string; now: string | null }>(
    `SELECT m.hash AS stored, b.hash AS now
       FROM label_flow_meta m LEFT JOIN block b ON b.height = m.height`,
  );
  const r = rows[0];
  return r === undefined || r.stored === r.now;
}

/** The lowest watermark across `addresses`: rows are complete for every height at or below it. */
export async function labelFlowCompleteThrough(
  pool: Pool | PoolClient,
  addresses: readonly string[],
): Promise<number | null> {
  const { rows } = await pool.query<{ low: number | null; n: number }>(
    `SELECT min(through_height) AS low, count(*)::int AS n
       FROM label_flow_state WHERE address = ANY($1::text[])`,
    [addresses],
  );
  const r = rows[0]!;
  return r.n < addresses.length || r.low === null || r.low < 0 ? null : r.low;
}

export interface LabelFlowTrackerDeps {
  pool: Pool;
  network: ZcashNetwork;
  /** Every labelled address: the flows are measured between these and everything else. */
  addresses: readonly string[];
  pacer: () => Pacer;
  log: (line: string) => void;
  /** False while a heavier backfill should go first; the walk then waits for the next pass. */
  ready?: () => Promise<boolean>;
  chunkBlocks?: number;
  minChunkBlocks?: number;
  now?: () => number;
}

/**
 * Keeps the flow tables current: on start, then every ten minutes, on mainnet only. Each step takes
 * the addresses furthest behind, which share one watermark, and walks the next chunk of heights for
 * them. A chunk that fails (above all one overrunning its statement bound) is retried smaller.
 */
export class LabelFlowTracker {
  #running = false;
  #chunk: number;
  constructor(private readonly deps: LabelFlowTrackerDeps) {
    this.#chunk = deps.chunkBlocks ?? LABEL_FLOW_CHUNK_BLOCKS;
  }

  get chunkBlocks(): number {
    return this.#chunk;
  }

  async refresh(): Promise<{ chunks: number; aborted: boolean }> {
    if (this.#running || this.deps.network !== "mainnet") return { chunks: 0, aborted: false };
    this.#running = true;
    const now = this.deps.now ?? Date.now;
    const { pool, addresses } = this.deps;
    const fullChunk = this.deps.chunkBlocks ?? LABEL_FLOW_CHUNK_BLOCKS;
    try {
      if (addresses.length === 0) return { chunks: 0, aborted: false };
      const { rows } = await pool.query<{ height: number | null }>(
        "SELECT max(height) AS height FROM block",
      );
      const tip = rows[0]?.height;
      if (tip === null || tip === undefined) return { chunks: 0, aborted: false };
      if (!(await labelFlowChainIntact(pool))) {
        // Rows above a changed block may describe a dead fork. Rebuilding (truncate the four
        // label_flow tables) is an operator's decision, so this stops and says so every pass.
        this.deps.log(
          "label flows: a block below the stored rows has changed; stopped. Rebuild: TRUNCATE label_flow_io, label_flow_tx, label_flow_state, label_flow_meta",
        );
        return { chunks: 0, aborted: true };
      }
      let pacer: Pacer | null = null;
      const paced = async (): Promise<Pacer | null> => {
        if (pacer === null) {
          if (this.deps.ready && !(await this.deps.ready())) return null;
          pacer = this.deps.pacer();
          await pacer.preflight();
        }
        return pacer;
      };
      const unlisted = await pool.query(
        "SELECT 1 FROM label_flow_state WHERE NOT address = ANY($1::text[]) LIMIT 1",
        [addresses],
      );
      if (unlisted.rowCount !== 0) {
        const p = await paced();
        if (p === null) return { chunks: 0, aborted: false };
        const dropped = await pruneLabelFlowAddresses(pool, addresses, (ms) => p.afterUnit(ms));
        if (dropped === null) {
          this.deps.log("label flows: paused removing unlisted addresses, ingestion is behind");
          return { chunks: 0, aborted: true };
        }
        if (dropped > 0) {
          this.deps.log(`label flows: dropped ${dropped} address(es) no longer listed`);
        }
      }
      await pool.query(
        `INSERT INTO label_flow_state (address, through_height, updated_at)
         SELECT a, -1, $2 FROM unnest($1::text[]) AS a ON CONFLICT (address) DO NOTHING`,
        [addresses, Math.floor(now() / 1000)],
      );
      const final = tip - REORG_DEPTH;
      let chunks = 0;
      for (;;) {
        const states = (
          await pool.query<{ address: string; through_height: number }>(
            `SELECT address, through_height FROM label_flow_state WHERE address = ANY($1::text[])`,
            [addresses],
          )
        ).rows;
        const low = Math.min(...states.map((s) => s.through_height));
        if (low + 1 > final) break;
        const group = states.filter((s) => s.through_height === low).map((s) => s.address);
        const p = await paced();
        if (p === null) return { chunks, aborted: false };
        const started = now();
        const chunk = this.#chunk;
        const hi = Math.min(final, low + chunk);
        let result: "applied" | "moved" | "chain";
        try {
          result = await applyLabelFlowChunk(
            pool,
            group,
            low,
            hi,
            addresses,
            Math.floor(now() / 1000),
          );
        } catch (error) {
          // Retried at the same size, a chunk that overran its statement bound would fail on
          // every pass.
          this.#chunk = Math.max(
            this.deps.minChunkBlocks ?? LABEL_FLOW_MIN_CHUNK_BLOCKS,
            Math.floor(chunk / 4),
          );
          throw error;
        }
        this.#chunk = Math.min(fullChunk, chunk * 2);
        if (result !== "applied") {
          this.deps.log(
            result === "moved"
              ? "label flows: a watermark moved under this pass; stopping it"
              : "label flows: the chain changed under this pass; stopping it",
          );
          return { chunks, aborted: true };
        }
        chunks += 1;
        if ((await p.afterUnit(Math.max(1, now() - started))) === "abort") {
          this.deps.log(`label flows: paused at height ${hi}, ingestion is behind`);
          return { chunks, aborted: true };
        }
      }
      if (chunks > 3) this.deps.log(`label flows: ${chunks} chunk(s) through height ${final}`);
      return { chunks, aborted: false };
    } finally {
      this.#running = false;
    }
  }

  start(intervalMs = 10 * 60 * 1000): () => void {
    const run = (): void => {
      void this.refresh().catch((e: unknown) => {
        this.deps.log(`label flows: pass failed, will retry — ${String(e)}`);
      });
    };
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}

/**
 * The stored transactions at heights `lo`..`hi`, oldest first, each with the gain or loss of every
 * labelled address in it. Coinbase and the shielded pools come from `tx`: a stored height is below
 * the reorg depth, so its row is final.
 */
export async function loadLabelFlowTxs(
  pool: Pool | PoolClient,
  lo: number,
  hi: number,
): Promise<LabelFlowTx[]> {
  const { rows } = await pool.query<{
    txid: string;
    block_height: number;
    timestamp: number;
    is_coinbase: boolean;
    pools_gave: number;
    pools_took: number;
    unlabelled_in_zat: number;
    unlabelled_out_zat: number;
    addresses: string[];
    deltas: string[];
  }>(
    `SELECT f.txid, f.block_height, f.timestamp, t.is_coinbase,
            -- Sapling, Orchard and Ironwood are stored positive into the pool; Sprout's net is
            -- stored positive out of it (RPC sign).
            (greatest(0, -coalesce(t.sapling_value_balance_zat, 0)) + greatest(0, -coalesce(t.orchard_value_balance_zat, 0))
              + greatest(0, -coalesce(t.ironwood_value_balance_zat, 0)) + greatest(0, coalesce(t.sprout_vpub_net_zat, 0)))::bigint AS pools_gave,
            (greatest(0, coalesce(t.sapling_value_balance_zat, 0)) + greatest(0, coalesce(t.orchard_value_balance_zat, 0))
              + greatest(0, coalesce(t.ironwood_value_balance_zat, 0)) + greatest(0, -coalesce(t.sprout_vpub_net_zat, 0)))::bigint AS pools_took,
            f.unlabelled_in_zat, f.unlabelled_out_zat,
            array_agg(i.address ORDER BY i.address) AS addresses,
            array_agg(i.delta_zat::text ORDER BY i.address) AS deltas
       FROM label_flow_tx f
       JOIN tx t ON t.txid = f.txid
       JOIN label_flow_io i ON i.txid = f.txid
      WHERE f.block_height BETWEEN $1 AND $2
      GROUP BY f.txid, f.block_height, f.timestamp, t.is_coinbase, t.sapling_value_balance_zat,
               t.orchard_value_balance_zat, t.ironwood_value_balance_zat, t.sprout_vpub_net_zat,
               f.unlabelled_in_zat, f.unlabelled_out_zat
      ORDER BY f.block_height, f.txid`,
    [lo, hi],
  );
  return rows.map((r) => ({
    txid: r.txid,
    height: r.block_height,
    timestamp: r.timestamp,
    isCoinbase: r.is_coinbase,
    poolsGaveZat: r.pools_gave,
    poolsTookZat: r.pools_took,
    unlabelledInZat: r.unlabelled_in_zat,
    unlabelledOutZat: r.unlabelled_out_zat,
    deltas: r.addresses.map((address, k) => ({ address, deltaZat: Number(r.deltas[k]) })),
  }));
}
