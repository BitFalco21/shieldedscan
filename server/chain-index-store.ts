import type { Pool } from "pg";
import type {
  BlockMiner,
  BlockSummary,
  PoolName,
  PulseBlockPools,
  PulseLedgerRow,
  Transaction,
  TxKindFilter,
} from "@/domain";
import { blockRewardZatOf, fundingStreamsOf, type CoinbaseTerms } from "@/data/chain/parse";
import { isMixedDirectionFilter } from "@/domain";
import type { CursorPage, CursorQuery } from "@/data/source";
import {
  decodeCursorForColumn,
  encodeCursor,
  INT4_SORT_KEY_MAX,
  INT8_SORT_KEY_MAX,
  seekFromCursors,
} from "@/data/cursor";
import { keysetSlice } from "./keyset-page";
import { clampPageSize } from "./page-size";
import { POOL_USED_SQL } from "./pool-sql";

/**
 * What a chain-wide transaction list may be narrowed by, beside its kind: the pool a transaction
 * used, and a half-open window `[fromTs, toTs)` of block timestamps in unix seconds.
 */
export interface ChainTxNarrowing {
  pool?: PoolName;
  fromTs?: number;
  toTs?: number;
}

/**
 * List reads served from the chain index instead of walked off the node.
 *
 * One store, two lists, one hydrator: an address's history (over `io_address_idx`) and the
 * filtered transaction list (over `tx_keyset_idx` / `tx_kind_keyset_idx`). Each page is a keyset
 * seek followed by primary-key hydration from `tx` and `tx_transparent_io`, instead of per-row node
 * calls whose input resolution multiplies.
 *
 * Keyset pagination on the composite `(block_height, txid)`: a block can hold several of an
 * address's transactions, so height alone is not unique and a bare-txid cursor would return an
 * arbitrary slice past page one. `ORIGIN_CURSOR` (sort key −1) works because heights are
 * non-negative, so "oldest" is one ascending seek. There is no total page count, as with every
 * keyset list.
 *
 * Fees come from `tx.fee_zat` and are never recomputed here (the equation lives in
 * `feeFromTermsZat`). `lockTime` is null on this path: the column is not stored, and the domain
 * documents null as "not carried in this view".
 */

interface TxRow {
  txid: string;
  block_height: number;
  block_hash: string;
  timestamp: number;
  is_coinbase: boolean;
  version: number;
  size_bytes: number;
  expiry_height: number | null;
  fee_zat: number | null;
  binding_sig_valid: boolean | null;
  sprout_joinsplits: number | null;
  sprout_vpub_net_zat: number | null;
  sapling_spends: number | null;
  sapling_outputs: number | null;
  sapling_value_balance_zat: number | null;
  orchard_actions: number | null;
  orchard_value_balance_zat: number | null;
  ironwood_actions: number | null;
  ironwood_value_balance_zat: number | null;
}

/**
 * One block, in the terms `/pulse` reads it: the six closes the boxes resize to, the two
 * clocks the heartbeat measures, and the two figures a block's own events need.
 */
export interface PulseBlockRow {
  pools: PulseBlockPools;
  txCount: number;
  /** NULL when any transaction's fee was not derivable — never a partial sum. */
  totalFeeZat: number | null;
}

/**
 * One transaction, with the pool value the domain type cannot carry.
 *
 * `sproutNetZat` is in domain sign (positive = value entered Sprout): the store negates the column
 * once, so nothing above needs to know that `tx.sprout_vpub_net_zat` is stored in RPC sign. Null
 * when the transaction has no Sprout bundle.
 */
export interface PulseTxRow {
  tx: Transaction;
  sproutNetZat: number | null;
}

/**
 * A page of a block range's transactions, with what it did not return.
 *
 * `countsByHeight` is every height's true transaction count, from the same table as the rows, so
 * a caller can mark a block truncated rather than presenting a slice as whole.
 */
export interface PulseTxPage {
  rows: PulseTxRow[];
  countsByHeight: Map<number, number>;
}

/** `block`, exactly as the pulse reads select it. */
interface PulseBlockSqlRow {
  height: number;
  hash: string;
  prev_hash: string;
  timestamp: number;
  received_at: number | null;
  tx_count: number;
  total_fee_zat: number | null;
  transparent_pool_zat: number | null;
  sprout_pool_zat: number | null;
  sapling_pool_zat: number | null;
  orchard_pool_zat: number | null;
  ironwood_pool_zat: number | null;
  lockbox_pool_zat: number | null;
}

/**
 * A block row as the domain's `PulseBlockPools`.
 *
 * Every pool passes through unchanged, null included: a pool the node did not report is absent,
 * not zero. `issuanceZatBetween` and `lockboxLegForBlocks` both refuse on a null, which only works
 * if the null survives the mapping.
 */
function toPulseBlockRow(r: PulseBlockSqlRow): PulseBlockRow {
  return {
    pools: {
      height: r.height,
      hash: r.hash,
      prevHash: r.prev_hash,
      timestamp: r.timestamp,
      receivedAt: r.received_at,
      pools: {
        transparent: r.transparent_pool_zat,
        sprout: r.sprout_pool_zat,
        sapling: r.sapling_pool_zat,
        orchard: r.orchard_pool_zat,
        ironwood: r.ironwood_pool_zat,
        lockbox: r.lockbox_pool_zat,
      },
    },
    txCount: r.tx_count,
    totalFeeZat: r.total_fee_zat,
  };
}

interface IoRow {
  txid: string;
  io: "in" | "out";
  address: string | null;
  value_zat: number | null;
}

/** An io row as a domain input/output, refusing to fabricate a value it does not have. */
function toSide(txid: string, r: IoRow): { address: string; valueZat: number } {
  if (r.value_zat === null) {
    throw new Error(`unresolved ${r.io} on ${txid} — the index invariant is broken; repair fees`);
  }
  return { address: r.address ?? "", valueZat: r.value_zat };
}

export class ChainIndexStore {
  constructor(private readonly pool: Pool) {}

  /**
   * The /txs list, filtered by kind in SQL before the cursor slice, seeked via
   * `tx_kind_keyset_idx (kind, timestamp DESC, txid DESC)`. "all" includes coinbase.
   *
   * `shielding` and `unshielding` narrow `mixed` by the stored `direction` and seek a second,
   * partial index. Filtering in SQL means this cannot call the domain's `matchesTxKindFilter`, so
   * their agreement is asserted by `chain-index-filter.test.ts`.
   *
   * The cursor is the `(timestamp, txid)` tuple, since the sort key is not unique. `#seekOrNull`
   * treats any sort key between 0 and Zcash's genesis timestamp as a stale height cursor from an
   * older encoding and resolves it to the first page; the ORIGIN_CURSOR sentinel (−1) passes
   * through, so "oldest" keeps working.
   */
  async listChainTransactions(
    kind: TxKindFilter,
    query: CursorQuery,
    narrow: ChainTxNarrowing = {},
  ): Promise<CursorPage<Transaction>> {
    const limit = clampPageSize(query.limit);
    const before = this.#seekOrNull(query.before);
    const after = before === null ? this.#seekOrNull(query.after) : null;
    const seek = before ?? after;

    const params: unknown[] = [limit + 1];
    const wheres = ["block_height IS NOT NULL"];
    if (isMixedDirectionFilter(kind)) {
      /*
       * The two sub-filters of `mixed`, seeking `tx_direction_keyset_idx (direction, timestamp
       * DESC, txid DESC) WHERE kind = 'mixed'`. Both predicates are stated: only mixed rows carry a
       * direction, but the index is partial, and the planner uses a partial index only when the
       * query proves its predicate. Without `kind` this is a sequential scan of `tx`.
       *
       * Narrowed in SQL before the cursor slice: filtering after slicing would return fewer than
       * `limit` rows plus a cursor that steps over what it dropped.
       */
      params.push(kind);
      wheres.push(`kind = 'mixed'`, `direction = $${params.length}`);
    } else if (kind !== "all") {
      params.push(kind);
      wheres.push(`kind = $${params.length}`);
    }
    // Narrowed in SQL before the slice, like `kind`. The pool predicate is the partial index's own
    // (`POOL_USED_SQL`), so a rare pool seeks its index instead of walking the chain; the window
    // bounds the same `(timestamp, txid)` keyset the cursor seeks.
    if (narrow.pool) wheres.push(POOL_USED_SQL[narrow.pool]);
    if (narrow.fromTs !== undefined) {
      params.push(narrow.fromTs);
      wheres.push(`timestamp >= $${params.length}`);
    }
    if (narrow.toTs !== undefined) {
      params.push(narrow.toTs);
      wheres.push(`timestamp < $${params.length}`);
    }
    if (seek) {
      const op = before ? "<" : ">";
      params.push(seek.sortKey, seek.id);
      wheres.push(`(timestamp, txid) ${op} ($${params.length - 1}, $${params.length})`);
    }
    const order = after ? "timestamp ASC, txid ASC" : "timestamp DESC, txid DESC";

    const { rows: keys } = await this.pool.query<{ timestamp: number; txid: string }>(
      `SELECT timestamp, txid FROM tx
        WHERE ${wheres.join(" AND ")}
        ORDER BY ${order}
        LIMIT $1`,
      params,
    );

    const {
      rows: page,
      nextCursor,
      prevCursor,
    } = keysetSlice(keys, limit, before ? "before" : after ? "after" : null, (k) =>
      encodeCursor(k.timestamp, k.txid),
    );
    if (page.length === 0) return { items: [], nextCursor: null, prevCursor: null };
    return { items: await this.#hydrate(page.map((k) => k.txid)), nextCursor, prevCursor };
  }

  /**
   * A decoded cursor for a timestamp keyset, with stale height cursors floored away. Zcash's
   * genesis block is at unix 1477641360 and no height will reach 1e9 for millennia, so a sort key
   * in (−1, 1e9) is a height cursor, not a timestamp.
   *
   * The range check is `decodeCursorForColumn`'s: `tx.timestamp` is `BIGINT`, and an out-of-range
   * sort key would be a Postgres error rather than the first page.
   */
  #seekOrNull(raw: string | undefined): { sortKey: number; id: string } | null {
    const decoded = decodeCursorForColumn(raw, INT8_SORT_KEY_MAX);
    if (!decoded) return null;
    if (decoded.sortKey > -1 && decoded.sortKey < 1_000_000_000) return null;
    return decoded;
  }

  async listTransactions(address: string, query: CursorQuery): Promise<CursorPage<Transaction>> {
    const limit = clampPageSize(query.limit);
    // `before` wins when both arrive, matching the crosschain store. A malformed or out-of-range
    // cursor resolves to the first page, never an error; this keyset sorts by
    // `tx_transparent_io.block_height`, which is `INTEGER`, hence the int4 bound.
    const seekAt = seekFromCursors(query, INT4_SORT_KEY_MAX);
    const seek = seekAt?.seek ?? null;
    const before = seekAt?.direction === "before";
    const after = seekAt?.direction === "after";

    const params: unknown[] = [address, limit + 1];
    let where = "address = $1";
    if (seek) {
      const op = before ? "<" : ">";
      where += ` AND (block_height, txid) ${op} ($3, $4)`;
      params.push(seek.sortKey, seek.id);
    }
    // `after` reverses the scan to seek from the far end, then the slice is flipped back, as in the
    // crosschain store.
    const order = after ? "block_height ASC, txid ASC" : "block_height DESC, txid DESC";

    // GROUP BY, not DISTINCT ON: an address appears once per output it owns in a
    // transaction, and the page must count transactions, not outputs.
    const { rows: keys } = await this.pool.query<{ block_height: number; txid: string }>(
      `SELECT block_height, txid
         FROM tx_transparent_io
        WHERE ${where} AND block_height IS NOT NULL
        GROUP BY block_height, txid
        ORDER BY ${order}
        LIMIT $2`,
      params,
    );

    const {
      rows: page,
      nextCursor,
      prevCursor,
    } = keysetSlice(keys, limit, seekAt?.direction ?? null, (k) =>
      encodeCursor(k.block_height, k.txid),
    );
    if (page.length === 0) return { items: [], nextCursor: null, prevCursor: null };
    return { items: await this.#hydrate(page.map((k) => k.txid)), nextCursor, prevCursor };
  }

  /**
   * One block's transactions, paginated: a txid-ordered keyset within the block, seeked via
   * `tx_block_idx`.
   *
   * The cursor carries the block height as its sort key, constant within a block, so only the txid
   * orders anything and only `seek.id` is bound. It must not go through `#seekOrNull`, which
   * discards any sort key under 1e9 as a stale height cursor and would therefore discard every
   * cursor this method mints. The int4 range check is applied directly instead.
   */
  async listBlockTransactions(
    height: number,
    query: CursorQuery,
    narrow: { pool?: PoolName } = {},
  ): Promise<CursorPage<Transaction>> {
    const limit = clampPageSize(query.limit);
    const seekAt = seekFromCursors(query, INT4_SORT_KEY_MAX);
    const seek = seekAt?.seek ?? null;
    const before = seekAt?.direction === "before";
    const after = seekAt?.direction === "after";
    const params: unknown[] = [height, limit + 1];
    let where = "block_height = $1";
    // One block's rows at most (`tx_block_idx`), so the pool needs no index of its own here.
    if (narrow.pool) where += ` AND ${POOL_USED_SQL[narrow.pool]}`;
    if (seek) {
      params.push(seek.id);
      // txid ASC is the canonical order here, so "older" pages walk UP the txids.
      where += ` AND txid ${before ? ">" : "<"} $${params.length}`;
    }
    const order = after ? "txid DESC" : "txid ASC";
    const { rows: keys } = await this.pool.query<{ txid: string }>(
      `SELECT txid FROM tx WHERE ${where} ORDER BY ${order} LIMIT $2`,
      params,
    );
    const {
      rows: page,
      nextCursor,
      prevCursor,
    } = keysetSlice(keys, limit, seekAt?.direction ?? null, (k) => encodeCursor(height, k.txid));
    if (page.length === 0) return { items: [], nextCursor: null, prevCursor: null };
    return { items: await this.#hydrate(page.map((k) => k.txid)), nextCursor, prevCursor };
  }

  /**
   * `total_fee_zat` for a page of heights, in one primary-key query, so the block list can carry
   * real fees without a per-row node walk. Null stays null: an unknowable fee must not become 0.
   */
  async blockFees(heights: readonly number[]): Promise<Map<number, number | null>> {
    if (heights.length === 0) return new Map();
    const { rows } = await this.pool.query<{ height: number; total_fee_zat: number | null }>(
      "SELECT height, total_fee_zat FROM block WHERE height = ANY($1::int[])",
      [heights],
    );
    return new Map(rows.map((r) => [r.height, r.total_fee_zat]));
  }

  /**
   * The block each txid sits in on our index (height and timestamp), for the ZNS registry's
   * cross-check: a name is published only when its transaction is on our chain at the height the
   * registry claims, and its date comes from here rather than from the registry. One primary-key
   * query for the whole registry. A mempool row (null height) is left out, so it fails the check.
   */
  async txBlocks(
    txids: readonly string[],
  ): Promise<Map<string, { height: number; timestamp: number }>> {
    if (txids.length === 0) return new Map();
    const { rows } = await this.pool.query<{
      txid: string;
      block_height: number;
      timestamp: string | number;
    }>(
      `SELECT txid, block_height, timestamp FROM tx
        WHERE txid = ANY($1::text[]) AND block_height IS NOT NULL`,
      [txids],
    );
    return new Map(
      rows.map((r) => [r.txid, { height: r.block_height, timestamp: Number(r.timestamp) }]),
    );
  }

  /**
   * Block-list rows for heights `hi` down to `lo`, from the index alone: the rows `block-list.ts`
   * pages for `/chain/blocks` and `/v1/blocks`, without one node read per row. The coinbase's
   * reward and funding streams go through the parser's own `blockRewardZatOf` and
   * `fundingStreamsOf`, over the stored outputs and pool balances, so a row equals
   * `blockSummaryOf(parseBlock(raw))`.
   *
   * Null means "the node must answer this range": a height missing from `block`, a block whose
   * stored transaction count disagrees with its `tx` rows, a miner not yet recorded, or a missing
   * difficulty. A row is never partly filled.
   */
  async blockSummaries(lo: number, hi: number): Promise<BlockSummary[] | null> {
    if (hi < lo) return [];
    const [blocks, txs, coinbases] = await Promise.all([
      this.pool.query<{
        height: number;
        hash: string;
        prev_hash: string;
        timestamp: string;
        size_bytes: number;
        tx_count: number;
        difficulty: number | null;
        miner_kind: BlockMiner["kind"] | null;
        miner_address: string | null;
        coinbase_tag: string | null;
        total_fee_zat: string | null;
      }>(
        `SELECT height, hash, prev_hash, timestamp::text AS timestamp, size_bytes, tx_count,
                difficulty, miner_kind, miner_address, coinbase_tag,
                total_fee_zat::text AS total_fee_zat
           FROM block WHERE height BETWEEN $1 AND $2 ORDER BY height DESC`,
        [lo, hi],
      ),
      this.pool.query<
        Record<"block_height" | "n" | PoolName | "transparent" | "mixed" | "shielded", number>
      >(
        `SELECT block_height, count(*)::int AS n,
                count(*) FILTER (WHERE kind IN ('transparent', 'coinbase'))::int AS transparent,
                count(*) FILTER (WHERE kind = 'mixed')::int AS mixed,
                count(*) FILTER (WHERE kind = 'shielded')::int AS shielded,
                count(*) FILTER (WHERE ${POOL_USED_SQL.ironwood})::int AS ironwood,
                count(*) FILTER (WHERE ${POOL_USED_SQL.orchard})::int AS orchard,
                count(*) FILTER (WHERE ${POOL_USED_SQL.sapling})::int AS sapling,
                count(*) FILTER (WHERE ${POOL_USED_SQL.sprout})::int AS sprout
           FROM tx WHERE block_height BETWEEN $1 AND $2 GROUP BY block_height`,
        [lo, hi],
      ),
      this.pool.query<{
        block_height: number;
        sa: string | null;
        oc: string | null;
        iw: string | null;
        ordinal: number | null;
        address: string | null;
        value: string | null;
      }>(
        `SELECT t.block_height, t.sapling_value_balance_zat::text AS sa,
                t.orchard_value_balance_zat::text AS oc, t.ironwood_value_balance_zat::text AS iw,
                io.ordinal, io.address, io.value_zat::text AS value
           FROM tx t
           LEFT JOIN tx_transparent_io io ON io.txid = t.txid AND io.io = 'out'
          WHERE t.block_height BETWEEN $1 AND $2 AND t.is_coinbase
          ORDER BY t.block_height, io.ordinal`,
        [lo, hi],
      ),
    ]);
    if (blocks.rows.length !== hi - lo + 1) return null;
    const aggregates = new Map(txs.rows.map((r) => [r.block_height, r]));
    const bundle = (v: string | null) => (v === null ? null : { valueBalanceZat: Number(v) });
    const coinbase = new Map<
      number,
      CoinbaseTerms & { outputs: { address: string | null; valueZat: number }[] }
    >();
    for (const r of coinbases.rows) {
      let c = coinbase.get(r.block_height);
      if (c === undefined) {
        c = { outputs: [], sapling: bundle(r.sa), orchard: bundle(r.oc), ironwood: bundle(r.iw) };
        coinbase.set(r.block_height, c);
      }
      if (r.ordinal !== null) c.outputs.push({ address: r.address, valueZat: Number(r.value) });
    }

    const items: BlockSummary[] = [];
    for (const b of blocks.rows) {
      const agg = aggregates.get(b.height);
      const cb = coinbase.get(b.height);
      if (agg === undefined || agg.n !== b.tx_count || b.miner_kind === null) return null;
      if (b.difficulty === null || cb === undefined) return null;
      if (b.miner_kind === "transparent" && b.miner_address === null) return null;
      const miner: BlockMiner =
        b.miner_kind === "transparent"
          ? { kind: "transparent", address: b.miner_address! }
          : { kind: b.miner_kind };
      items.push({
        height: b.height,
        hash: b.hash,
        prevHash: b.prev_hash,
        timestamp: Number(b.timestamp),
        sizeBytes: b.size_bytes,
        txCount: b.tx_count,
        difficulty: b.difficulty,
        composition: {
          transparentTxs: agg.transparent,
          mixedTxs: agg.mixed,
          shieldedTxs: agg.shielded,
          byPool: {
            ironwood: agg.ironwood,
            orchard: agg.orchard,
            sapling: agg.sapling,
            sprout: agg.sprout,
          },
        },
        miner,
        coinbaseTag: b.coinbase_tag,
        fundingStreams: fundingStreamsOf(cb, miner),
        blockRewardZat: blockRewardZatOf(cb),
        totalFeeZat: b.total_fee_zat === null ? null : Number(b.total_fee_zat),
      });
    }
    return items;
  }

  /**
   * The highest block whose timestamp is at or before `ts` (unix seconds), or null when none is.
   *
   * Takes the highest height among the newest few hundred blocks by timestamp, because miner
   * timestamps are only loosely ordered (consensus bounds a block's time by the median of the
   * previous eleven and two hours ahead), so a single row off the timestamp index can be a few
   * blocks off. The MATERIALIZED fence keeps the read on `block_timestamp_idx`, as in
   * `blockHeightRange`.
   */
  async heightAtOrBefore(ts: number): Promise<number | null> {
    const { rows } = await this.pool.query<{ height: number | null }>(
      `WITH c AS MATERIALIZED (
         SELECT height FROM block WHERE timestamp <= $1::bigint ORDER BY timestamp DESC LIMIT 500
       )
       SELECT MAX(height)::int AS height FROM c`,
      [ts],
    );
    return rows[0]?.height ?? null;
  }

  /**
   * The first and last block an address appears in, with each block's time — two probes of
   * `io_address_idx` (`(address, block_height DESC)`, one read forwards and one backwards) and two
   * primary-key reads of `block`, however busy the address is. Null for an address the index does
   * not hold (yet).
   */
  async addressActivityExtent(address: string): Promise<{
    first: { height: number; timestamp: number } | null;
    last: { height: number; timestamp: number } | null;
  }> {
    const { rows } = await this.pool.query<{
      first: number | null;
      last: number | null;
      first_ts: string | null;
      last_ts: string | null;
    }>(
      `WITH f AS (SELECT block_height AS h FROM tx_transparent_io
                   WHERE address = $1 AND block_height IS NOT NULL
                   ORDER BY block_height ASC LIMIT 1),
            l AS (SELECT block_height AS h FROM tx_transparent_io
                   WHERE address = $1 AND block_height IS NOT NULL
                   ORDER BY block_height DESC LIMIT 1)
       SELECT (SELECT h FROM f) AS first,
              (SELECT h FROM l) AS last,
              (SELECT timestamp FROM block WHERE height = (SELECT h FROM f))::text AS first_ts,
              (SELECT timestamp FROM block WHERE height = (SELECT h FROM l))::text AS last_ts`,
      [address],
    );
    const r = rows[0];
    const point = (h: number | null | undefined, ts: string | null | undefined) =>
      h === null || h === undefined || ts === null || ts === undefined
        ? null
        : { height: h, timestamp: Number(ts) };
    return { first: point(r?.first, r?.first_ts), last: point(r?.last, r?.last_ts) };
  }

  /** Our indexed tip — the newest block row — or null on an empty index. */
  async tipHeight(): Promise<number | null> {
    const { rows } = await this.pool.query<{ height: number | null }>(
      "SELECT max(height) AS height FROM block",
    );
    return rows[0]?.height ?? null;
  }

  // ------------------------------------------------------------------------------- /pulse

  /**
   * The blocks one frame or one replay hour is built from, oldest first.
   *
   * Two shapes: the live frame wants the newest N, the replay wants an absolute span. Both return
   * the same rows oldest-first, because every consumer plays the array forward.
   *
   * The span is half-open `[from, to)`, so an hour boundary belongs to exactly one hour.
   *
   * Windowed on `block.timestamp` via `block_timestamp_idx`, never on `tx.timestamp`: header times
   * are only loosely monotonic, so a range over `tx` could include transactions whose block is
   * outside the window. Heights come from the blocks and transactions are fetched by height.
   */
  async listPulseBlocks(
    query: { latest: number } | { fromSeconds: number; toSeconds: number },
  ): Promise<PulseBlockRow[]> {
    const columns = `height, hash, prev_hash, timestamp, received_at, tx_count, total_fee_zat,
            transparent_pool_zat, sprout_pool_zat, sapling_pool_zat,
            orchard_pool_zat, ironwood_pool_zat, lockbox_pool_zat`;
    const { rows } =
      "latest" in query
        ? await this.pool.query<PulseBlockSqlRow>(
            `SELECT ${columns} FROM block ORDER BY height DESC LIMIT $1`,
            [Math.max(1, Math.min(query.latest, 720))],
          )
        : await this.pool.query<PulseBlockSqlRow>(
            `SELECT ${columns} FROM block
              WHERE timestamp >= $1 AND timestamp < $2
              ORDER BY height ASC`,
            [query.fromSeconds, query.toSeconds],
          );
    const blocks = rows.map(toPulseBlockRow);
    return "latest" in query ? blocks.reverse() : blocks;
  }

  /**
   * One block by height, or undefined.
   *
   * For the predecessor of a window's first block: the heartbeat interval and the lockbox delta are
   * differences against the previous block. Fetching it separately keeps the window exactly
   * half-open.
   */
  async blockAt(height: number): Promise<PulseBlockRow | undefined> {
    const { rows } = await this.pool.query<PulseBlockSqlRow>(
      `SELECT height, hash, prev_hash, timestamp, received_at, tx_count, total_fee_zat,
              transparent_pool_zat, sprout_pool_zat, sapling_pool_zat,
              orchard_pool_zat, ironwood_pool_zat, lockbox_pool_zat
         FROM block WHERE height = $1`,
      [height],
    );
    const row = rows[0];
    return row === undefined ? undefined : toPulseBlockRow(row);
  }

  /**
   * Every transaction in a set of blocks, capped per block and in total.
   *
   * Seeked through `tx_block_idx (block_height DESC)` with one `= ANY` for the whole set, so a
   * frame costs one query, never one per block.
   *
   * Two caps: `perBlock` is the page's drawing limit (a large block is more marks than a screen can
   * carry), and `total` bounds what one request may cost. Neither is silent: `countsByHeight`
   * carries every height's true count, so a caller marks a block truncated.
   *
   * The coinbase sorts first within each block: it is the block's first transaction, the mined edge
   * is drawn from it, and it is the last thing a cap should drop. Beyond that the order is by txid,
   * arbitrary but stable (the index does not store a transaction's position in its block).
   */
  async listTransactionsForHeights(
    heights: readonly number[],
    caps: { perBlock: number; total: number },
  ): Promise<PulseTxPage> {
    if (heights.length === 0) return { rows: [], countsByHeight: new Map() };
    const wanted = [...heights];
    const [keys, counts] = await Promise.all([
      this.pool.query<{ txid: string }>(
        `WITH ranked AS (
           SELECT txid, block_height,
                  row_number() OVER (
                    PARTITION BY block_height ORDER BY is_coinbase DESC, txid ASC
                  ) AS rn
             FROM tx
            WHERE block_height = ANY($1::int[])
         )
         SELECT txid FROM ranked
          WHERE rn <= $2
          ORDER BY block_height ASC, rn ASC
          LIMIT $3`,
        [wanted, caps.perBlock, caps.total],
      ),
      this.pool.query<{ block_height: number; n: string }>(
        `SELECT block_height, count(*)::text AS n
           FROM tx WHERE block_height = ANY($1::int[]) GROUP BY 1`,
        [wanted],
      ),
    ]);
    return {
      rows: await this.#hydrateRows(keys.rows.map((k) => k.txid)),
      countsByHeight: new Map(counts.rows.map((r) => [r.block_height, Number(r.n)])),
    };
  }

  /**
   * The newest real transparent outputs, for the ledger box's rows.
   *
   * Outputs only, never an input→output pairing: deciding which output was the payment and which
   * the change is an inference this site does not make. A row states only that this address
   * received this amount in this transaction.
   *
   * Confirmed only: a mempool output has not happened yet. Coinbase outputs are included, since
   * they are real transparent outputs; the row makes no claim about the kind of movement.
   *
   * Two steps: `tx_transparent_io` has no index on `block_height`, so the newest txids come from
   * `tx_block_idx` and their outputs are a primary-key prefix lookup, as in `#hydrate`.
   */
  async listLedgerRows(limit: number): Promise<PulseLedgerRow[]> {
    const want = Math.max(1, Math.min(limit, 200));
    const { rows } = await this.pool.query<{
      txid: string;
      block_height: number;
      hash: string;
      address: string;
      value_zat: number;
    }>(
      `WITH recent AS (
         SELECT txid, block_height FROM tx
          WHERE block_height IS NOT NULL
          ORDER BY block_height DESC, txid ASC
          LIMIT $2
       )
       SELECT io.txid, r.block_height, b.hash, io.address, io.value_zat
         FROM recent r
         JOIN tx_transparent_io io ON io.txid = r.txid AND io.io = 'out'
         JOIN block b ON b.height = r.block_height
        WHERE io.address IS NOT NULL AND io.value_zat IS NOT NULL AND io.value_zat > 0
        ORDER BY r.block_height DESC, io.txid ASC, io.ordinal ASC
        LIMIT $1`,
      // Enough transactions to fill the rows even when most of them carry a single output.
      [want, want * 4],
    );
    return rows.map((r) => ({
      txid: r.txid,
      height: r.block_height,
      blockHash: r.hash,
      address: r.address,
      valueZat: r.value_zat,
    }));
  }

  /**
   * The transparent outputs of a set of blocks, for a replay hour's ledger rows, so a replay shows
   * the rows of the hour it is replaying.
   *
   * Bounded by heights, never by a timestamp over `tx`, because header times are only loosely
   * monotonic. `tx_block_idx` is the path in and the outputs are a primary-key prefix lookup on
   * `tx_transparent_io`, which has no index on `block_height`.
   *
   * The cap is spread across the hour rather than taken off its newest end: rows are ranked within
   * each block and the cap takes every block's first output before any block's second, so a capped
   * hour is thinner everywhere instead of empty at its start.
   *
   * `truncated` is exact: one more row than the cap is requested, and the CTE covers every
   * transaction at those heights.
   */
  async listLedgerRowsForHeights(
    heights: readonly number[],
    limit: number,
  ): Promise<{ rows: PulseLedgerRow[]; truncated: boolean }> {
    if (heights.length === 0) return { rows: [], truncated: false };
    const want = Math.max(1, Math.min(limit, 200));
    const { rows } = await this.pool.query<{
      txid: string;
      block_height: number;
      hash: string;
      address: string;
      value_zat: number;
      ordinal: number;
    }>(
      `WITH outputs AS (
         SELECT io.txid, t.block_height, io.address, io.value_zat, io.ordinal,
                row_number() OVER (
                  PARTITION BY t.block_height ORDER BY t.txid ASC, io.ordinal ASC
                ) AS rn
           FROM tx t
           JOIN tx_transparent_io io ON io.txid = t.txid AND io.io = 'out'
          WHERE t.block_height = ANY($1::int[])
            AND io.address IS NOT NULL AND io.value_zat IS NOT NULL AND io.value_zat > 0
       )
       SELECT o.txid, o.block_height, b.hash, o.address, o.value_zat, o.ordinal
         FROM outputs o
         JOIN block b ON b.height = o.block_height
        ORDER BY o.rn ASC, o.block_height DESC, o.txid ASC, o.ordinal ASC
        LIMIT $2`,
      [[...heights], want + 1],
    );
    const truncated = rows.length > want;
    return {
      rows: rows
        .slice(0, want)
        .map((r) => ({
          txid: r.txid,
          height: r.block_height,
          blockHash: r.hash,
          address: r.address,
          valueZat: r.value_zat,
          ordinal: r.ordinal,
        }))
        // Back into reading order once the cap has been applied: the cap's order only chooses which
        // rows survive, and a caller reads them newest first.
        .sort(
          (a, b) => b.height - a.height || a.txid.localeCompare(b.txid) || a.ordinal - b.ordinal,
        )
        .map(({ ordinal: _ordinal, ...row }) => row),
      truncated,
    };
  }

  /**
   * One confirmed transaction, whole, from the index.
   *
   * Postgres holds every input resolved (ingest resolves them in the same transaction that writes
   * them), so this is one indexed query and exact, where the node path would fetch every input's
   * source transaction.
   *
   * `undefined` means "not in the index": a mempool transaction or one that does not exist. The
   * caller asks the node to decide which, which keeps mempool detail working.
   */
  async getTransaction(txid: string): Promise<Transaction | undefined> {
    const [tx] = await this.#hydrate([txid]);
    return tx;
  }

  /** Domain transactions from the three tables, in the page's order. */
  async #hydrate(txids: string[]): Promise<Transaction[]> {
    return (await this.#hydrateRows(txids)).map((r) => r.tx);
  }

  async #hydrateRows(txids: string[]): Promise<PulseTxRow[]> {
    const [txs, ios] = await Promise.all([
      this.pool.query<TxRow>(
        `SELECT t.txid, t.block_height, b.hash AS block_hash, t.timestamp, t.is_coinbase,
                t.version, t.size_bytes, t.expiry_height, t.fee_zat, t.binding_sig_valid,
                t.sprout_joinsplits, t.sprout_vpub_net_zat, t.sapling_spends, t.sapling_outputs,
                t.sapling_value_balance_zat, t.orchard_actions, t.orchard_value_balance_zat,
                t.ironwood_actions, t.ironwood_value_balance_zat
           FROM tx t JOIN block b ON b.height = t.block_height
          WHERE t.txid = ANY($1::text[])`,
        [txids],
      ),
      this.pool.query<IoRow>(
        `SELECT txid, io, address, value_zat
           FROM tx_transparent_io
          WHERE txid = ANY($1::text[])
          ORDER BY txid, io, ordinal`,
        [txids],
      ),
    ]);

    const ioByTx = new Map<string, IoRow[]>();
    for (const row of ios.rows) {
      const list = ioByTx.get(row.txid) ?? [];
      list.push(row);
      ioByTx.set(row.txid, list);
    }
    const byId = new Map(txs.rows.map((t) => [t.txid, t]));

    return txids.flatMap((txid) => {
      const t = byId.get(txid);
      if (!t) return []; // reorg between the two queries; the row simply drops out
      const io = ioByTx.get(txid) ?? [];
      const tx = {
        txid: t.txid,
        blockHeight: t.block_height,
        blockHash: t.block_hash,
        timestamp: t.timestamp,
        isCoinbase: t.is_coinbase,
        version: t.version,
        sizeBytes: t.size_bytes,
        // Not stored in the index; null is "not carried in this view", per the domain.
        lockTime: null,
        expiryHeight: t.expiry_height,
        rawHex: null,
        feeZat: t.fee_zat,
        bindingSigValid: t.binding_sig_valid,
        // `""` for a script naming no address is the domain's convention. A NULL value, though, is
        // a broken invariant: every output is stored and ingest resolves inputs in the same
        // transaction, so an unresolved value means corrupted data, which fails loudly rather than
        // becoming a 0.
        transparentInputs: io.filter((r) => r.io === "in").map((r) => toSide(txid, r)),
        transparentOutputs: io.filter((r) => r.io === "out").map((r) => toSide(txid, r)),
        sprout: t.sprout_joinsplits === null ? null : { joinSplits: t.sprout_joinsplits },
        sapling:
          t.sapling_spends === null
            ? null
            : {
                spends: t.sapling_spends,
                outputs: t.sapling_outputs ?? 0,
                valueBalanceZat: t.sapling_value_balance_zat ?? 0,
              },
        orchard:
          t.orchard_actions === null
            ? null
            : { actions: t.orchard_actions, valueBalanceZat: t.orchard_value_balance_zat ?? 0 },
        ironwood:
          t.ironwood_actions === null
            ? null
            : { actions: t.ironwood_actions, valueBalanceZat: t.ironwood_value_balance_zat ?? 0 },
      } satisfies Transaction;
      return [
        {
          tx,
          // The one negation: `sprout_vpub_net_zat` is stored in RPC sign (positive = value leaving
          // Sprout), and every consumer above works in domain sign (positive = entering), like the
          // other pools' balances. Flipping it once here keeps sign translation out of
          // `pulseEventForTx`.
          sproutNetZat: t.sprout_vpub_net_zat === null ? null : -t.sprout_vpub_net_zat,
        },
      ];
    });
  }
}
