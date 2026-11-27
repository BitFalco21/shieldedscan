import type { Pool, PoolClient } from "pg";
import type { ZcashNetwork } from "@/lib/network";
import {
  LABEL_FLOW_CLASSIFIER,
  exchangeFlowsOf,
  labelGroupKey,
  labelGroupOf,
  type LabelFlowTx,
  type LabelGroup,
} from "@/domain";
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
  groupOf: GroupOf = labelGroupOf,
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
    `INSERT INTO label_flow_tx (txid, block_height, timestamp, unlabelled_in_zat, unlabelled_out_zat, unresolved)
     SELECT i.txid, t.block_height, t.timestamp,
            coalesce(sum(coalesce(i.value_zat, 0)) FILTER (
              WHERE i.io = 'in' AND (i.address IS NULL OR NOT i.address = ANY($2::text[]))), 0)::bigint,
            coalesce(sum(coalesce(i.value_zat, 0)) FILTER (
              WHERE i.io = 'out' AND (i.address IS NULL OR NOT i.address = ANY($2::text[]))), 0)::bigint,
            coalesce(bool_or(i.io = 'in' AND i.value_zat IS NULL), FALSE)
              OR (coalesce(t.sprout_joinsplits, 0) > 0 AND t.sprout_vpub_net_zat IS NULL)
       FROM tx_transparent_io i JOIN tx t ON t.txid = i.txid
      WHERE i.txid = ANY($1::text[])
      GROUP BY i.txid, t.block_height, t.timestamp, t.sprout_joinsplits, t.sprout_vpub_net_zat
     HAVING bool_or(i.address = ANY($2::text[]))`,
    [txids, labelled],
  );
  await writeFlows(client, txids, groupOf);
}

export type GroupOf = (address: string) => LabelGroup | null;

/**
 * Classifies the stored transactions among `txids` and replaces their flow rows, in the caller's
 * transaction: a flow row is always the classification of the rows beside it.
 */
export async function writeFlows(
  client: PoolClient,
  txids: readonly string[],
  groupOf: GroupOf = labelGroupOf,
): Promise<void> {
  if (txids.length === 0) return;
  await client.query("DELETE FROM label_flow_flow WHERE txid = ANY($1::text[])", [txids]);
  const cols = {
    txid: [] as string[],
    exchange: [] as string[],
    direction: [] as string[],
    zat: [] as string[],
    height: [] as number[],
    timestamp: [] as string[],
    parts: [] as string[],
  };
  const add = (
    t: LabelFlowTx,
    exchange: string,
    direction: string,
    zat: number,
    parts: unknown[],
  ) => {
    cols.txid.push(t.txid);
    cols.exchange.push(exchange);
    cols.direction.push(direction);
    cols.zat.push(String(zat));
    cols.height.push(t.height);
    cols.timestamp.push(String(t.timestamp));
    cols.parts.push(JSON.stringify(parts));
  };
  for (const t of await loadLabelFlowTxsById(client, txids)) {
    const { flows, internal } = exchangeFlowsOf(t, groupOf);
    for (const f of flows) add(t, f.exchange, f.direction, f.zat, f.parts);
    for (const m of internal) add(t, m.exchange, "internal", m.feeZat, []);
  }
  if (cols.txid.length === 0) return;
  await client.query(
    `INSERT INTO label_flow_flow (txid, exchange, direction, zat, block_height, timestamp, parts)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::bigint[], $5::int[], $6::bigint[],
                          $7::jsonb[])`,
    [cols.txid, cols.exchange, cols.direction, cols.zat, cols.height, cols.timestamp, cols.parts],
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
  groupOf: GroupOf = labelGroupOf,
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
      await rewriteTransactions(client, txids, labelled, groupOf);
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
  groupOf: GroupOf = labelGroupOf,
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
    await rewriteTransactions(
      client,
      await transactionsOf(client, group, from + 1, hi),
      labelled,
      groupOf,
    );
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
 * Makes `version` the classifier of record, under the lock and before anything else in a pass
 * writes. A different stored version is reset to "nothing reclassified yet", so a reader still
 * built with the old one stops answering before any row of the new one is written. True when it
 * reset.
 */
export async function claimClassifierVersion(pool: Pool, version: string): Promise<boolean> {
  return withLock(pool, async (client) => {
    const row = (await client.query<{ version: string }>("SELECT version FROM label_flow_derive"))
      .rows[0];
    if (row?.version === version) return false;
    await client.query(
      `INSERT INTO label_flow_derive (id, version, through_height, done) VALUES (TRUE, $1, -1, FALSE)
       ON CONFLICT (id) DO UPDATE SET version = $1, through_height = -1, done = FALSE`,
      [version],
    );
    return true;
  });
}

/** Runs `fn` in one transaction holding the flow tables' write lock. */
async function withLock<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(WRITE_LOCK_SQL);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reclassifies every stored transaction at heights `from`+1..`hi` with `version`, and moves the
 * cursor. Past the highest stored height it is done, and every listed address is recorded under
 * the group it was classified with. Refused ("moved") when the cursor or the version moved under
 * it.
 */
export async function applyReclassifyChunk(
  pool: Pool,
  version: string,
  from: number,
  hi: number,
  groups: ReadonlyArray<{ address: string; grp: string }>,
  groupOf: GroupOf = labelGroupOf,
): Promise<"applied" | "done" | "moved"> {
  return withLock(pool, async (client) => {
    const row = (
      await client.query<{ version: string; through_height: number; done: boolean }>(
        "SELECT version, through_height, done FROM label_flow_derive",
      )
    ).rows[0];
    if (row === undefined || row.version !== version || row.done || row.through_height !== from) {
      return "moved";
    }
    const txids = (
      await client.query<{ txid: string }>(
        "SELECT txid FROM label_flow_tx WHERE block_height > $1 AND block_height <= $2",
        [from, hi],
      )
    ).rows.map((r) => r.txid);
    await writeFlows(client, txids, groupOf);
    const top = (
      await client.query<{ h: number | null }>("SELECT max(height) AS h FROM label_flow_meta")
    ).rows[0]!.h;
    const done = hi >= (top ?? -1);
    await client.query("UPDATE label_flow_derive SET through_height = $1, done = $2", [hi, done]);
    if (done) {
      await client.query(
        `UPDATE label_flow_state s SET grp = g.grp
           FROM unnest($1::text[], $2::text[]) AS g(address, grp) WHERE s.address = g.address`,
        [groups.map((g) => g.address), groups.map((g) => g.grp)],
      );
    }
    return done ? "done" : "applied";
  });
}

/**
 * Marks an address being reclassified: `pending:<old>:<new>`, so a reader built with either
 * grouping knows both groups whose flows are half old, half new.
 */
export const PENDING_GROUP = "pending:";

/**
 * Every group a stored `grp` says the address's flows may count under: one when settled, the old
 * and the new while pending. Null when unknown (never classified).
 */
export function storedGroupsOf(grp: string | null): string[] | null {
  if (grp === null) return null;
  if (!grp.startsWith(PENDING_GROUP)) return [grp];
  const named = grp
    .slice(PENDING_GROUP.length)
    .split(":")
    .filter((g) => g !== "");
  return named.length === 0 ? null : named;
}

/**
 * Reclassifies the transactions of one address whose group changed, in batches, then records the
 * new group. The address is marked pending first, so readers built with either grouping do not
 * count the groups involved while its flows are half old, half new. Returns false when paused.
 */
export async function regroupLabelFlowAddress(
  pool: Pool,
  address: string,
  grp: string,
  groupOf: GroupOf = labelGroupOf,
  afterBatch: (ms: number) => Promise<"continue" | "abort"> = async () => "continue",
  batch = LABEL_FLOW_PRUNE_BATCH,
): Promise<boolean> {
  await withLock(pool, async (client) => {
    const current = (
      await client.query<{ grp: string | null }>(
        "SELECT grp FROM label_flow_state WHERE address = $1",
        [address],
      )
    ).rows[0]?.grp;
    if (current === undefined) return;
    // Already pending (a pass cut short): keep every group it names, adding this target.
    const marker = current?.startsWith(PENDING_GROUP)
      ? storedGroupsOf(current)?.includes(grp)
        ? current
        : `${current}:${grp}`
      : `${PENDING_GROUP}${current ?? ""}:${grp}`;
    await client.query("UPDATE label_flow_state SET grp = $2 WHERE address = $1", [
      address,
      marker,
    ]);
  });
  let after = "";
  for (;;) {
    const started = Date.now();
    const n = await withLock(pool, async (client) => {
      const txids = (
        await client.query<{ txid: string }>(
          `SELECT txid FROM label_flow_io WHERE address = $1 AND txid > $2 ORDER BY txid LIMIT $3`,
          [address, after, batch],
        )
      ).rows.map((r) => r.txid);
      await writeFlows(client, txids, groupOf);
      if (txids.length > 0) after = txids[txids.length - 1]!;
      if (txids.length < batch) {
        await client.query("UPDATE label_flow_state SET grp = $2 WHERE address = $1", [
          address,
          grp,
        ]);
      }
      return txids.length;
    });
    if (n < batch) return true;
    if ((await afterBatch(Math.max(1, Date.now() - started))) === "abort") return false;
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

export interface LabelFlowReadiness {
  /**
   * Per group (an exchange id, `bridge`, `other`): the highest block its flows are complete and
   * classified through by this build, or null when they cannot be counted (an address of it is
   * being reclassified or removed, or has never been walked).
   */
  caps: Map<string, number | null>;
}

/**
 * How far the stored flows can be read, for a reader built with `version` and grouping `addresses`
 * by `groupOf`. Null when they cannot be read at all: another classifier version, or the chain
 * changed below the stored rows. Read it in the same snapshot as the flows it caps.
 */
export async function labelFlowReadiness(
  client: Pool | PoolClient,
  addresses: readonly string[],
  groupOf: GroupOf = labelGroupOf,
  version: string = LABEL_FLOW_CLASSIFIER,
): Promise<LabelFlowReadiness | null> {
  const derive = (
    await client.query<{ version: string; through_height: number; done: boolean }>(
      "SELECT version, through_height, done FROM label_flow_derive",
    )
  ).rows[0];
  if (derive === undefined || derive.version !== version) return null;
  if (!(await labelFlowChainIntact(client))) return null;
  const rows = (
    await client.query<{ address: string; through_height: number; grp: string | null }>(
      "SELECT address, through_height, grp FROM label_flow_state",
    )
  ).rows;
  const stored = new Map(rows.map((r) => [r.address, r]));
  const listed = new Set(addresses);
  const ceiling = derive.done ? Infinity : derive.through_height;
  const low = new Map<string, number>();
  const bad = new Set<string>();
  let unknownBad = false;
  const markOld = (grp: string | null) => {
    const named = storedGroupsOf(grp);
    if (named === null) unknownBad = true;
    else for (const g of named) bad.add(g);
  };
  for (const address of addresses) {
    const key = labelGroupKey(groupOf(address));
    const r = stored.get(address);
    if (r === undefined || r.through_height < 0) {
      bad.add(key);
      continue;
    }
    if (derive.done && r.grp !== key) {
      // Counted under another group, or half reclassified: neither group is whole.
      bad.add(key);
      markOld(r.grp);
    }
    low.set(key, Math.min(low.get(key) ?? Infinity, r.through_height));
  }
  // An address no longer listed is being removed: its group still holds its rows.
  for (const r of rows) if (!listed.has(r.address)) markOld(r.grp);
  const caps = new Map<string, number | null>();
  for (const [key, h] of low) {
    caps.set(key, unknownBad || bad.has(key) ? null : Math.min(h, ceiling));
  }
  for (const key of bad) caps.set(key, null);
  return { caps };
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
  /** Which group each address counts under; the labels by default. */
  groupOf?: GroupOf;
  /** The classifier version written; this build's by default. */
  version?: string;
}

/**
 * Keeps the flow tables current: on start, then every ten minutes, on mainnet only. Each step takes
 * the addresses furthest behind, which share one watermark, and walks the next chunk of heights for
 * them. A chunk that fails (above all one overrunning its statement bound) is retried smaller.
 */
export class LabelFlowTracker {
  #running = false;
  #chunk: number;
  #reclassifyChunk: number;
  constructor(private readonly deps: LabelFlowTrackerDeps) {
    this.#chunk = deps.chunkBlocks ?? LABEL_FLOW_CHUNK_BLOCKS;
    this.#reclassifyChunk = this.#chunk;
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
          "label flows: a block below the stored rows has changed; stopped. Rebuild: TRUNCATE label_flow_io, label_flow_tx, label_flow_flow, label_flow_state, label_flow_meta, label_flow_derive",
        );
        return { chunks: 0, aborted: true };
      }
      const groupOf = this.deps.groupOf ?? labelGroupOf;
      const version = this.deps.version ?? LABEL_FLOW_CLASSIFIER;
      // First write of the pass, before anything is classified with this build.
      if (await claimClassifierVersion(pool, version)) {
        this.deps.log(
          `label flows: classifier ${version} is new; reclassifying every stored transaction`,
        );
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
        const dropped = await pruneLabelFlowAddresses(
          pool,
          addresses,
          (ms) => p.afterUnit(ms),
          LABEL_FLOW_PRUNE_BATCH,
          groupOf,
        );
        if (dropped === null) {
          this.deps.log("label flows: paused removing unlisted addresses, ingestion is behind");
          return { chunks: 0, aborted: true };
        }
        if (dropped > 0) {
          this.deps.log(`label flows: dropped ${dropped} address(es) no longer listed`);
        }
      }
      const groups = addresses.map((address) => ({
        address,
        grp: labelGroupKey(groupOf(address)),
      }));
      // A new address is classified as it is walked, so it starts under its own group.
      await pool.query(
        `INSERT INTO label_flow_state (address, through_height, updated_at, grp)
         SELECT a, -1, $2, g FROM unnest($1::text[], $3::text[]) AS x(a, g)
         ON CONFLICT (address) DO NOTHING`,
        [addresses, Math.floor(now() / 1000), groups.map((g) => g.grp)],
      );
      const derive = (
        await pool.query<{ through_height: number; done: boolean }>(
          "SELECT through_height, done FROM label_flow_derive",
        )
      ).rows[0];
      if (derive !== undefined && !derive.done) {
        // Every stored transaction, in height order, with this build's classifier.
        let from = derive.through_height;
        for (;;) {
          const p = await paced();
          if (p === null) return { chunks: 0, aborted: false };
          const started = now();
          const chunk = this.#reclassifyChunk;
          let result: "applied" | "done" | "moved";
          try {
            result = await applyReclassifyChunk(pool, version, from, from + chunk, groups, groupOf);
          } catch (error) {
            this.#reclassifyChunk = Math.max(
              this.deps.minChunkBlocks ?? LABEL_FLOW_MIN_CHUNK_BLOCKS,
              Math.floor(chunk / 4),
            );
            throw error;
          }
          this.#reclassifyChunk = Math.min(fullChunk, chunk * 2);
          if (result === "moved") return { chunks: 0, aborted: true };
          if (result === "done") {
            this.deps.log("label flows: every stored transaction is classified");
            break;
          }
          from += chunk;
          if ((await p.afterUnit(Math.max(1, now() - started))) === "abort") {
            this.deps.log(
              `label flows: reclassifying paused at height ${from}, ingestion is behind`,
            );
            return { chunks: 0, aborted: true };
          }
        }
      } else {
        // Addresses whose group changed: their own transactions only.
        const stale = (
          await pool.query<{ address: string; grp: string | null }>(
            "SELECT address, grp FROM label_flow_state WHERE address = ANY($1::text[])",
            [addresses],
          )
        ).rows.filter((r) => r.grp !== groups.find((g) => g.address === r.address)!.grp);
        const want = new Map(groups.map((g) => [g.address, g.grp]));
        for (const r of stale) {
          const p = await paced();
          if (p === null) return { chunks: 0, aborted: false };
          const finished = await regroupLabelFlowAddress(
            pool,
            r.address,
            want.get(r.address)!,
            groupOf,
            (ms) => p.afterUnit(ms),
          );
          if (!finished) {
            this.deps.log("label flows: paused reclassifying an address, ingestion is behind");
            return { chunks: 0, aborted: true };
          }
          this.deps.log(`label flows: reclassified ${r.address} as ${want.get(r.address)!}`);
        }
      }
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
            groupOf,
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
 * One stored transaction per row, with the gain or loss of every labelled address in it. Coinbase
 * and the shielded pools come from `tx`: a stored height is below the reorg depth, so its row is
 * final. `{where}` is filled with a condition on `f` (label_flow_tx).
 */
export const LABEL_FLOW_TX_SQL = `SELECT f.txid, f.block_height, f.timestamp, t.is_coinbase,
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
      WHERE {where}
      GROUP BY f.txid, f.block_height, f.timestamp, t.is_coinbase, t.sapling_value_balance_zat,
               t.orchard_value_balance_zat, t.ironwood_value_balance_zat, t.sprout_vpub_net_zat,
               f.unlabelled_in_zat, f.unlabelled_out_zat
`;

type LabelFlowTxRow = {
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
};

function toLabelFlowTx(r: LabelFlowTxRow): LabelFlowTx {
  return {
    txid: r.txid,
    height: r.block_height,
    timestamp: r.timestamp,
    isCoinbase: r.is_coinbase,
    poolsGaveZat: r.pools_gave,
    poolsTookZat: r.pools_took,
    unlabelledInZat: r.unlabelled_in_zat,
    unlabelledOutZat: r.unlabelled_out_zat,
    deltas: r.addresses.map((address, k) => ({ address, deltaZat: Number(r.deltas[k]) })),
  };
}

/** The stored transactions at heights `lo`..`hi`, oldest first. */
export async function loadLabelFlowTxs(
  pool: Pool | PoolClient,
  lo: number,
  hi: number,
): Promise<LabelFlowTx[]> {
  const { rows } = await pool.query<LabelFlowTxRow>(
    `${LABEL_FLOW_TX_SQL.replace("{where}", "f.block_height BETWEEN $1 AND $2")}
      ORDER BY f.block_height, f.txid`,
    [lo, hi],
  );
  return rows.map(toLabelFlowTx);
}

/** The stored transactions among `txids`. */
async function loadLabelFlowTxsById(
  client: PoolClient,
  txids: readonly string[],
): Promise<LabelFlowTx[]> {
  const { rows } = await client.query<LabelFlowTxRow>(
    LABEL_FLOW_TX_SQL.replace("{where}", "f.txid = ANY($1::text[])"),
    [txids],
  );
  return rows.map(toLabelFlowTx);
}

// ------------------------------------------------------------------------------- reading

/**
 * Blocks a group's cap may trail the best one and still be counted. Further behind, its addresses
 * are still being walked (a new label) and it is reported uncounted rather than cutting every
 * other exchange's answer back to it.
 */
export const LABEL_FLOW_LAG_BLOCKS = 2_000;

/** The groups counted: a cap, and within `LABEL_FLOW_LAG_BLOCKS` of the best group's. */
export function countedCaps(caps: ReadonlyMap<string, number | null>): Map<string, number> {
  let best = -1;
  for (const c of caps.values()) if (c !== null) best = Math.max(best, c);
  const out = new Map<string, number>();
  for (const [g, c] of caps) if (c !== null && c >= best - LABEL_FLOW_LAG_BLOCKS) out.set(g, c);
  return out;
}

export interface LabelFlowDayRow {
  /** UTC days since 1970-01-01. */
  day: number;
  exchange: string;
  direction: "in" | "out" | "internal";
  txs: number;
  zat: number;
}

export interface LabelFlowPartRow {
  day: number;
  exchange: string;
  direction: "in" | "out";
  kind: string;
  /** The other exchange, on an `exchange` part. */
  counterpart: string | null;
  zat: number;
}

export interface LabelFlowAggregates {
  caps: Map<string, number | null>;
  days: LabelFlowDayRow[];
  parts: LabelFlowPartRow[];
  /** Transactions with an input this index could not resolve, by day. */
  unresolved: Map<number, number>;
  /** Each day's highest block, through the last day that has ended. */
  dayLastHeight: Map<number, number>;
}

/**
 * Every stored flow summed by UTC day, read in one snapshot with the caps that say how far it can
 * be counted. Null when it cannot be read at all (another classifier version, a changed chain).
 */
export async function loadLabelFlowAggregates(
  pool: Pool,
  addresses: readonly string[],
  nowSec: number,
  groupOf: GroupOf = labelGroupOf,
  version: string = LABEL_FLOW_CLASSIFIER,
): Promise<LabelFlowAggregates | null> {
  return inSnapshot(pool, async (client) => {
    const readiness = await labelFlowReadiness(client, addresses, groupOf, version);
    if (readiness === null) return null;
    const days = (
      await client.query<LabelFlowDayRow>(
        `SELECT (timestamp / 86400)::int AS day, exchange, direction, count(*)::int AS txs,
                sum(zat)::bigint AS zat
           FROM label_flow_flow GROUP BY 1, 2, 3`,
      )
    ).rows;
    const parts = (
      await client.query<LabelFlowPartRow>(
        `SELECT (f.timestamp / 86400)::int AS day, f.exchange, f.direction, p->>'kind' AS kind,
                p->>'exchange' AS counterpart, sum((p->>'zat')::bigint)::bigint AS zat
           FROM label_flow_flow f CROSS JOIN LATERAL jsonb_array_elements(f.parts) p
          WHERE f.direction <> 'internal'
          GROUP BY 1, 2, 3, 4, 5`,
      )
    ).rows;
    const unresolved = new Map(
      (
        await client.query<{ day: number; txs: number }>(
          `SELECT (timestamp / 86400)::int AS day, count(*)::int AS txs
             FROM label_flow_tx WHERE unresolved GROUP BY 1`,
        )
      ).rows.map((r) => [r.day, r.txs]),
    );
    // Settled days from mining_day, then the newest days live from the blocks above its last one;
    // today has not ended, so it is never a day whose last block is known.
    const today = Math.floor(nowSec / 86400);
    const dayLastHeight = new Map<number, number>();
    let above = -1;
    for (const r of (
      await client.query<{ day: number; last_height: number }>(
        `SELECT (extract(epoch FROM day) / 86400)::int AS day, last_height
           FROM mining_day WHERE last_height IS NOT NULL ORDER BY day`,
      )
    ).rows) {
      dayLastHeight.set(r.day, r.last_height);
      above = Math.max(above, r.last_height);
    }
    for (const r of (
      await client.query<{ day: number; last_height: number }>(
        `SELECT (timestamp / 86400)::int AS day, max(height) AS last_height
           FROM block WHERE height > $1 GROUP BY 1`,
        [above],
      )
    ).rows) {
      if (r.day < today)
        dayLastHeight.set(r.day, Math.max(dayLastHeight.get(r.day) ?? -1, r.last_height));
    }
    return { caps: readiness.caps, days, parts, unresolved, dayLastHeight };
  });
}

export interface LabelFlowRow {
  txid: string;
  exchange: string;
  direction: "in" | "out";
  zat: number;
  height: number;
  timestamp: number;
  parts: Array<{ kind: string; exchange?: string; zat: number }>;
}

/**
 * The largest flows under the narrowing, each counted only below its exchange's cap: a ranking,
 * bounded, never paged. Null when the flows cannot be read.
 */
export async function loadLargestLabelFlows(
  pool: Pool,
  addresses: readonly string[],
  q: {
    exchange: string | null;
    direction: "in" | "out" | null;
    fromTs: number;
    toTs: number;
    limit: number;
  },
  groupOf: GroupOf = labelGroupOf,
  version: string = LABEL_FLOW_CLASSIFIER,
): Promise<{ caps: Map<string, number | null>; rows: LabelFlowRow[] } | null> {
  return inSnapshot(pool, async (client) => {
    const readiness = await labelFlowReadiness(client, addresses, groupOf, version);
    if (readiness === null) return null;
    const counted = [...countedCaps(readiness.caps)].filter(
      ([g]) => q.exchange === null || g === q.exchange,
    );
    const { rows } = await client.query<{
      txid: string;
      exchange: string;
      direction: "in" | "out";
      zat: number;
      block_height: number;
      timestamp: number;
      parts: LabelFlowRow["parts"];
    }>(
      `SELECT f.txid, f.exchange, f.direction, f.zat, f.block_height, f.timestamp, f.parts
         FROM label_flow_flow f
         JOIN unnest($1::text[], $2::int[]) AS c(grp, cap)
           ON c.grp = f.exchange AND f.block_height <= c.cap
        WHERE f.direction <> 'internal'
          AND ($3::text IS NULL OR f.direction = $3)
          AND f.timestamp >= $4 AND f.timestamp < $5
        ORDER BY f.zat DESC, f.txid DESC, f.exchange DESC
        LIMIT $6`,
      [
        counted.map(([g]) => g),
        counted.map(([, c]) => c),
        q.direction,
        q.fromTs,
        Number.isFinite(q.toTs) ? q.toTs : Number.MAX_SAFE_INTEGER,
        q.limit,
      ],
    );
    return {
      caps: readiness.caps,
      rows: rows.map((r) => ({
        txid: r.txid,
        exchange: r.exchange,
        direction: r.direction,
        zat: r.zat,
        height: r.block_height,
        timestamp: r.timestamp,
        parts: r.parts,
      })),
    };
  });
}

/** Runs `fn` in one read-only REPEATABLE READ transaction: every read sees one snapshot. */
async function inSnapshot<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}
