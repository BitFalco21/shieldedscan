import type { Pool } from "pg";
import { parseBlock } from "@/data/chain/parse";
import type { RpcBlockSummary, RpcTransaction } from "@/data/chain/rpc-types";
import { minerRewardZat } from "@/domain";
import type { Pacer } from "./job-pacer";

/**
 * Fill the four miner columns (`miner_kind`, `miner_address`, `coinbase_tag`,
 * `miner_reward_zat`) for blocks that predate them.
 *
 * The columns were added after the backfiller had written the early chain, so blocks below
 * height 1,463,800 carry NULL. Unlike `difficulty`, they cannot come from a header.
 *
 * Each column is written from `parseBlock`'s own output, never re-derived in SQL, because a query
 * cannot see the ZIP-213 rule. What changes is the input: all four fields come from the coinbase
 * alone (`blockMiner`, `decodeCoinbaseTag`, `fundingStreamsOf`, `blockRewardZatOf` read nothing
 * else), so `parseBlock` gets the block's verbosity-1 header with the coinbase as its only
 * transaction. That is a fraction of the node work of fetching whole blocks; a test runs every
 * captured block through both paths and requires identical fields.
 *
 * Keyed by hash, filled only where NULL: a hash names one block or nothing, so a reorg cannot put
 * another block's miner in a row, and `miner_kind IS NULL` in the UPDATE lets a concurrent
 * follower write win. Idempotent and safe to stop at any moment; a low-water mark guarantees
 * progress past a row that cannot be filled.
 *
 * Paced against ingestion (`job-pacer.ts`): it rests in proportion to each batch's work and stops
 * when the follower falls behind the node.
 */

export interface MinerFields {
  kind: "transparent" | "shielded" | "unknown";
  address: string | null;
  coinbaseTag: string | null;
  minerRewardZat: number | null;
}

export interface StoredBlockRow {
  height: number;
  hash: string;
}

/**
 * The four fields for one stored row, or null to leave it alone. Pure: the only decision here.
 *
 * Every refusal leaves the NULL in place, which the readers already treat as "not measured":
 * the node answering about a different block than the row (a reorg), a first txid that is not
 * the transaction handed over, or a first transaction that is not a coinbase.
 */
export function minerFieldsFor(
  row: StoredBlockRow,
  summary: RpcBlockSummary,
  coinbase: RpcTransaction,
): MinerFields | null {
  if (summary.hash !== row.hash || summary.height !== row.height) return null;
  if (summary.tx[0] === undefined || summary.tx[0] !== coinbase.txid) return null;
  const { block, transactions } = parseBlock({ ...summary, tx: [coinbase] });
  if (transactions[0]?.isCoinbase !== true) return null;
  return {
    kind: block.miner.kind,
    address: block.miner.kind === "transparent" ? block.miner.address : null,
    coinbaseTag: block.coinbaseTag,
    minerRewardZat: minerRewardZat(block),
  };
}

export interface MinerRpc {
  getBlockSummaryByHash(hash: string): Promise<RpcBlockSummary>;
  getRawTransaction(txid: string): Promise<RpcTransaction>;
}

/** The fields for one row via the node, or why not. */
export async function readMinerFields(
  rpc: MinerRpc,
  row: StoredBlockRow,
): Promise<{ fields: MinerFields | null; failed: boolean }> {
  try {
    const summary = await rpc.getBlockSummaryByHash(row.hash);
    const first = summary.tx[0];
    if (first === undefined) return { fields: null, failed: false };
    const coinbase = await rpc.getRawTransaction(first);
    return { fields: minerFieldsFor(row, summary, coinbase), failed: false };
  } catch {
    return { fields: null, failed: true };
  }
}

export interface RepairMinerDeps {
  pool: Pool;
  rpc: MinerRpc;
  pacer: Pacer;
  log: (message: string) => void;
  /** Rows per batch, each one UPDATE. */
  batch?: number;
  /** Blocks in flight at once; modest, because this node serves every page on the site. */
  concurrency?: number;
  /** Stop before this height, so a first run can be bounded to a range checked by hand. */
  end?: number;
  now?: () => number;
}

export interface RepairMinerResult {
  scanned: number;
  written: number;
  /** The node did not answer for the row: an orphan we stored, or a transport failure. */
  failed: number;
  /** The node answered, and the answer was not one this job may write. */
  refused: number;
  /** Stopped by the pacer (ingestion fell behind) or by a batch the node mostly failed. */
  aborted: boolean;
}

/** Resolve `items` through `fn` with at most `concurrency` in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export async function repairMiner(deps: RepairMinerDeps): Promise<RepairMinerResult> {
  const { pool, rpc, pacer, log } = deps;
  const batch = deps.batch ?? 500;
  const concurrency = deps.concurrency ?? 4;
  const now = deps.now ?? Date.now;
  const result: RepairMinerResult = {
    scanned: 0,
    written: 0,
    failed: 0,
    refused: 0,
    aborted: false,
  };
  await pacer.preflight();

  // The low-water mark is load-bearing: a row that cannot be filled keeps `miner_kind IS NULL`,
  // so selecting on that predicate alone would return it forever.
  let from = 0;
  for (;;) {
    const started = now();
    const { rows } = await pool.query<StoredBlockRow>(
      deps.end === undefined
        ? `SELECT height, hash FROM block
            WHERE miner_kind IS NULL AND height >= $1 ORDER BY height LIMIT $2`
        : `SELECT height, hash FROM block
            WHERE miner_kind IS NULL AND height >= $1 AND height < $3 ORDER BY height LIMIT $2`,
      deps.end === undefined ? [from, batch] : [from, batch, deps.end],
    );
    if (rows.length === 0) break;
    from = rows[rows.length - 1]!.height + 1;
    result.scanned += rows.length;

    const resolved = await mapWithConcurrency(rows, concurrency, (row) =>
      readMinerFields(rpc, row),
    );
    const failedHere = resolved.filter((r) => r.failed).length;
    result.failed += failedHere;
    // A batch the node mostly failed is the node in trouble, not a run of orphans: stop rather
    // than skip past thousands of rows the next run would have to re-scan anyway.
    if (failedHere * 2 > rows.length) {
      log(
        `miner repair: ${failedHere} of ${rows.length} reads failed at ${rows[0]!.height}; stopping`,
      );
      result.aborted = true;
      break;
    }

    const write = {
      heights: [] as number[],
      hashes: [] as string[],
      kinds: [] as string[],
      addresses: [] as (string | null)[],
      tags: [] as (string | null)[],
      rewards: [] as (number | null)[],
    };
    resolved.forEach((r, i) => {
      if (r.failed) return;
      if (r.fields === null) {
        result.refused++;
        return;
      }
      const row = rows[i]!;
      write.heights.push(row.height);
      write.hashes.push(row.hash);
      write.kinds.push(r.fields.kind);
      write.addresses.push(r.fields.address);
      write.tags.push(r.fields.coinbaseTag);
      write.rewards.push(r.fields.minerRewardZat);
    });
    if (write.heights.length > 0) {
      const { rowCount } = await pool.query(
        `UPDATE block AS b
            SET miner_kind = v.kind, miner_address = v.address,
                coinbase_tag = v.tag, miner_reward_zat = v.reward
           FROM (SELECT unnest($1::int[]) AS height, unnest($2::text[]) AS hash,
                        unnest($3::text[]) AS kind, unnest($4::text[]) AS address,
                        unnest($5::text[]) AS tag, unnest($6::bigint[]) AS reward) AS v
          WHERE b.height = v.height AND b.hash = v.hash AND b.miner_kind IS NULL`,
        [write.heights, write.hashes, write.kinds, write.addresses, write.tags, write.rewards],
      );
      result.written += rowCount ?? 0;
    }
    log(
      `miner repair: ${result.written} written, ${result.scanned} scanned, ` +
        `${result.refused} refused, ${result.failed} failed, next height >= ${from}`,
    );
    if ((await pacer.afterUnit(now() - started)) === "abort") {
      result.aborted = true;
      break;
    }
  }
  return result;
}

export interface MinerVerifyResult {
  checked: number;
  mismatches: Array<{
    height: number;
    field: keyof MinerFields;
    stored: unknown;
    derived: unknown;
  }>;
  failed: number;
}

/**
 * Read-only: derive the fields for rows the FOLLOWER already filled and compare. Run before any
 * write, over a spread of heights, so the coinbase-only path is checked against `parseBlock` on
 * the whole block across every era the filled range covers.
 */
export async function verifyMinerFields(deps: {
  pool: Pool;
  rpc: MinerRpc;
  heights: readonly number[];
  concurrency?: number;
}): Promise<MinerVerifyResult> {
  const { rows } = await deps.pool.query<{
    height: number;
    hash: string;
    miner_kind: string;
    miner_address: string | null;
    coinbase_tag: string | null;
    miner_reward_zat: string | null;
  }>(
    `SELECT height, hash, miner_kind, miner_address, coinbase_tag, miner_reward_zat
       FROM block WHERE height = ANY($1::int[]) AND miner_kind IS NOT NULL ORDER BY height`,
    [deps.heights],
  );
  const out: MinerVerifyResult = { checked: 0, mismatches: [], failed: 0 };
  const resolved = await mapWithConcurrency(rows, deps.concurrency ?? 4, (r) =>
    readMinerFields(deps.rpc, { height: r.height, hash: r.hash }),
  );
  resolved.forEach((r, i) => {
    const stored = rows[i]!;
    if (r.failed || r.fields === null) {
      out.failed++;
      return;
    }
    out.checked++;
    const expect: MinerFields = {
      kind: stored.miner_kind as MinerFields["kind"],
      address: stored.miner_address,
      coinbaseTag: stored.coinbase_tag,
      minerRewardZat: stored.miner_reward_zat === null ? null : Number(stored.miner_reward_zat),
    };
    for (const field of Object.keys(expect) as (keyof MinerFields)[]) {
      if (expect[field] !== r.fields[field]) {
        out.mismatches.push({
          height: stored.height,
          field,
          stored: expect[field],
          derived: r.fields[field],
        });
      }
    }
  });
  return out;
}
