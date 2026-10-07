import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import {
  type ParsedBlock,
  type ParsedTransaction,
  blockTotalFeeZat,
  computeFeeZat,
} from "@/data/chain/parse";
import { classifyTxDirection, classifyTxKind } from "@/data/chain/parse";
import { txDirectionColumn } from "./tx-direction-column";
import { REORG_DEPTH } from "./follow";
import { minerRewardZat } from "@/domain";
import type { ChainStorePort, ChainSyncState, ReorgEventRecord } from "./chain-store";
import { createPool, rollbackQuietly } from "./pg-pool";
import "./pg-types";

/**
 * The input-resolution join, with no row filter; callers append their own.
 *
 * Shared by `#resolveInputs` (a block's transactions at ingest) and the fee repair's re-resolution
 * of inputs ingested before their outputs. It is a pure join from `(prev_txid, prev_vout)` to
 * `(txid, ordinal)` with no domain logic, which is what makes running it outside the ingest path
 * safe. Both sides are primary-key prefixes, so no extra index is needed.
 *
 * `i.value_zat IS NULL` makes it idempotent: it only fills a hole, never overwrites.
 */
export const RESOLVE_INPUTS_JOIN = `
  UPDATE tx_transparent_io i
     SET address = o.address, value_zat = o.value_zat, script_type = o.script_type
    FROM tx_transparent_io o
   WHERE i.io = 'in'
     AND i.value_zat IS NULL
     AND o.io = 'out'
     AND o.txid = i.prev_txid
     AND o.ordinal = i.prev_vout`;

/**
 * The day-grained pool matviews `refreshPoolAnalytics` maintains and `npm run fill:pool-analytics`
 * fills. One list for the refresh, its row count and the fill script, so a view cannot reach the
 * schema and silently never be refreshed.
 */
export const POOL_ANALYTICS_MATVIEWS = [
  "chain_day_pool_tx",
  "chain_day_pool_migration",
  "chain_day_pool_boundary",
  "chain_day_supply_close",
] as const;

/**
 * What one pass over {@link POOL_ANALYTICS_MATVIEWS} did. `skipped` distinguishes a partial pass
 * from a full one: a view left unrefreshed serves rows that look as fresh as any other.
 */
export interface PoolAnalyticsPass {
  /** Rows across the views this pass refreshed — never over one it could not read. */
  rows: number;
  /** Views this pass refreshed, in the constant's order. */
  refreshed: readonly string[];
  /** Views left alone because they have never been populated. Only the fill script fills one. */
  skipped: readonly string[];
}

/** What {@link PostgresChainStore.repairReorgCreatedAddresses} found and did. */
export interface ReorgAddressRepair {
  /** The watermark the re-derivation was bounded at and the residual was read at. */
  height: number;
  /** Rows whose first height lies inside a recorded reorg. */
  candidates: number;
  /** Rows that re-derived to nothing and were deleted. */
  removed: number;
  /** Rows kept with a different balance or transaction count. */
  corrected: number;
  /** Stored minus re-derived balance, summed over the candidates. */
  excessZat: bigint;
  /** Balances + unattributed − the node's transparent pool; null when the pool is unknown. */
  residualBeforeZat: bigint | null;
  residualAfterZat: bigint | null;
  /** True only when asked to commit AND the residual afterwards was exactly zero. */
  committed: boolean;
}

/**
 * Rows are written with `UNNEST` rather than one statement per row: a full backfill writes
 * millions of transactions and tens of millions of I/O rows, so per-row round trips would
 * dominate. `UNNEST` also avoids Postgres' 65,535-parameter ceiling, which multi-row `VALUES`
 * would hit on a large block.
 */
export class PostgresChainStore implements ChainStorePort {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;

  readonly #rollupOnly: boolean;

  /**
   * When false, `ingestBlock` leaves `chain_sync_state` alone.
   *
   * That row is the live follower's resume point and reorg detector. The one-shot backfiller walks
   * historical heights while the follower polls the tip; if it advanced the sync state, the two
   * processes would fight over the same row. The backfiller has its own checkpoint
   * (`chain_backfill_state`).
   */
  readonly #trackSyncState: boolean;

  /**
   * When false, `ingestBlock` leaves the rich-list tables alone.
   *
   * The balances are a running total, correct only if every block is applied exactly once and in
   * order. `chain_rich_list_meta.computed_height` is the watermark that guarantees it: a block at
   * or below it is skipped, so a re-ingest after a crash is a no-op instead of a double count. The
   * backfiller walks heights out of order relative to that watermark, so applying its deltas would
   * silently drop blocks. The live follower, which advances one block at a time, owns these tables;
   * a fresh database gets them from `bootstrapRichList`.
   */
  readonly #maintainRichList: boolean;

  /**
   * When true, `ingestBlock` stamps `block.received_at` with the wall clock: the moment this
   * indexer first stored the block. Only the live follower sets it, because its write time is an
   * arrival observation (a few seconds behind the node's own acceptance). The backfiller must not:
   * re-walking history would stamp old blocks with today's date, which looks like propagation data
   * and is not.
   */
  readonly #stampReceivedAt: boolean;

  /**
   * Pass an existing `Pool` to share connections with the cross-chain store, preferable on a
   * single host. A connection string creates a small dedicated pool instead.
   */
  constructor(
    source?: Pool | string,
    options: {
      rollupOnly?: boolean;
      trackSyncState?: boolean;
      maintainRichList?: boolean;
      stampReceivedAt?: boolean;
    } = {},
  ) {
    if (source instanceof Pool) {
      this.#pool = source;
      this.#ownsPool = false;
    } else {
      this.#pool = createPool(source, { max: 4 });
      this.#ownsPool = true;
    }
    this.#rollupOnly = options.rollupOnly ?? false;
    this.#trackSyncState = options.trackSyncState ?? true;
    this.#maintainRichList = options.maintainRichList ?? false;
    this.#stampReceivedAt = options.stampReceivedAt ?? false;
  }

  async applySchema(schemaPath = "./schema-chain.sql"): Promise<void> {
    await this.#pool.query(readFileSync(schemaPath, "utf8"));
  }

  async getSyncState(): Promise<ChainSyncState | null> {
    const { rows } = await this.#pool.query<{ tip_height: number; tip_hash: string }>(
      "SELECT tip_height, tip_hash FROM chain_sync_state WHERE id = TRUE",
    );
    const row = rows[0];
    return row === undefined ? null : { tipHeight: row.tip_height, tipHash: row.tip_hash };
  }

  async hashAt(height: number): Promise<string | null> {
    const { rows } = await this.#pool.query<{ hash: string }>(
      "SELECT hash FROM block WHERE height = $1",
      [height],
    );
    return rows[0]?.hash ?? null;
  }

  /**
   * Discard everything above `height`. One DELETE suffices because `tx` and `tx_transparent_io`
   * cascade from `block`. The sync state is then rebuilt from the highest remaining block.
   */
  async rollbackAbove(height: number, event?: ReorgEventRecord): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      // The audit record travels in the same transaction as the deletion it describes, so a crash
      // cannot record a rollback that did not happen, nor apply one unrecorded. `reorg_event` has
      // no FK to block on purpose: the log of rollbacks must not be erased by one.
      if (event !== undefined) {
        await client.query(
          `INSERT INTO reorg_event (detected_at, height, depth, orphaned_hash, replaced_by)
             VALUES ($1, $2, $3, $4, $5)`,
          [event.detectedAt, event.height, event.depth, event.orphanedHash, event.replacedBy],
        );
      }
      // The rich list is corrected only once it has been bootstrapped, which the watermark row
      // records (the same guard as `#applyBalanceDeltaAt`). Without it a reorg would recompute its
      // handful of addresses into an empty table, and those few would be shown as the chain's whole
      // holdings.
      const tracksRichList =
        this.#maintainRichList &&
        (await client.query("SELECT 1 FROM chain_rich_list_meta WHERE id = TRUE FOR UPDATE")).rows
          .length > 0;

      // Read the rich list's side of the doomed blocks before the cascade removes it. `tx` is
      // indexed on `block_height` and `tx_transparent_io` on `txid`, so both halves are index
      // scans.
      const affected = tracksRichList
        ? await client.query<{ address: string | null; unattributed_zat: string }>(
            `SELECT i.address,
                    COALESCE(SUM(CASE WHEN i.io = 'out' THEN i.value_zat ELSE -i.value_zat END)
                             FILTER (WHERE i.address IS NULL), 0)::bigint AS unattributed_zat
               FROM tx t
               JOIN tx_transparent_io i ON i.txid = t.txid
              WHERE t.block_height > $1
              GROUP BY i.address`,
            [height],
          )
        : null;

      await client.query("DELETE FROM block WHERE height > $1", [height]);
      if (affected !== null) {
        // After the delete, so the re-derivation reads the chain as it now stands.
        await this.recomputeAddresses(
          affected.rows.map((r) => r.address).filter((a): a is string => a !== null),
          client,
        );
        // The unattributed running total has no index to re-derive from, so this term is reversed
        // by arithmetic: safe because it is a plain sum with an exact inverse, unlike
        // `first_height`/`last_height`.
        const undone = affected.rows.reduce((sum, r) => sum + Number(r.unattributed_zat), 0);
        await client.query(
          `UPDATE chain_rich_list_meta
              SET unattributed_zat = unattributed_zat - $1::bigint,
                  computed_height  = LEAST(computed_height, $2::int)
            WHERE id = TRUE`,
          [undone, height],
        );
      }

      const { rows } = await client.query<{ height: number; hash: string }>(
        "SELECT height, hash FROM block ORDER BY height DESC LIMIT 1",
      );
      const top = rows[0];
      if (top === undefined) {
        await client.query("DELETE FROM chain_sync_state");
      } else {
        await this.#writeSyncState(client, top.height, top.hash);
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Persist a block and everything derived from it, atomically.
   *
   * The order is forced by the data:
   *
   *   1. block, then transactions, then transparent I/O (foreign keys);
   *   2. resolve inputs against stored outputs, because `getblock` gives a `vin` no address and no
   *      value, only a pointer to the output it spends;
   *   3. derive fees, which needs the resolved input totals from step 2;
   *   4. roll up the block's fee total and advance the sync state.
   *
   * All in one transaction: a crash between steps would otherwise leave the next pass computing
   * fees from a half-written block, with no error.
   */
  async ingestBlock(parsed: ParsedBlock): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await this.#writeBlock(client, parsed);
      // Rollup-only mode: the block row is the product (per-block activity counts and pool totals
      // for the analytics matviews), at a tiny fraction of the transparent-I/O index's size.
      // Transactions and addresses are then served from the node, and block-level fees stay NULL
      // because deriving them needs resolved inputs.
      if (!this.#rollupOnly) {
        await this.#writeTransactions(client, parsed);
        await this.#writeTransparentIo(client, parsed);
        await this.#resolveInputs(client, parsed);
        await this.#deriveFees(client, parsed);
        // Strictly after resolution: an input arrives with a NULL address and value and is filled
        // from the output it spends, so a delta taken earlier would count every credit and no
        // debit.
        if (this.#maintainRichList) await this.#applyBalanceDelta(client, parsed);
      }
      if (this.#trackSyncState) {
        await this.#writeSyncState(client, parsed.block.height, parsed.block.hash);
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The backfiller's own resume point: the next height it has not yet ingested.
   *
   * Separate from `chain_sync_state` (see `#trackSyncState`). Written once per batch rather than
   * per block: a crash re-ingests at most one batch, which the idempotent upserts make harmless.
   */
  async getBackfillCheckpoint(): Promise<number | null> {
    const { rows } = await this.#pool.query<{ next_height: number }>(
      "SELECT next_height FROM chain_backfill_state WHERE id = TRUE",
    );
    return rows[0]?.next_height ?? null;
  }

  async setBackfillCheckpoint(nextHeight: number): Promise<void> {
    await this.#pool.query(
      `INSERT INTO chain_backfill_state (id, next_height, updated_at)
       VALUES (TRUE, $1, EXTRACT(EPOCH FROM now())::bigint)
       ON CONFLICT (id) DO UPDATE SET
         next_height = EXCLUDED.next_height,
         updated_at = EXCLUDED.updated_at`,
      [nextHeight],
    );
  }

  /**
   * Refresh the materialised monthly series.
   *
   * CONCURRENTLY is required: a plain refresh takes an ACCESS EXCLUSIVE lock that would block every
   * analytics read for its duration. It needs the unique index `schema-chain.sql` creates with the
   * view. Only the follower calls this; the API is read-only and must not write.
   */
  async refreshMonthlyRollup(): Promise<void> {
    await this.#pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_month_rollup");
  }

  /**
   * Refresh the monthly shielding-flow view. Separate from the rollup above, and awaited separately
   * by the caller, because it aggregates `tx` where that one aggregates `block`: one failing or
   * being slow must not hold up the other.
   */
  async refreshShieldingFlow(): Promise<void> {
    await this.#pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_month_shielding_flow");
  }

  /** Refresh the monthly fee-by-kind view. Same contract as its two siblings. */
  async refreshFeeKinds(): Promise<void> {
    await this.#pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_month_fee_kind");
  }

  /**
   * Refresh the per-kind transaction counts and the per-direction counts beside them. Two views
   * rather than one grouped view; see `chain_tx_mixed_direction_count` in `schema-chain.sql`.
   */
  async refreshTxCounts(): Promise<void> {
    await this.#pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_tx_kind_count");
    await this.#pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_tx_mixed_direction_count");
  }

  /**
   * Refresh the daily views behind the chart range toggles. Same contract as the monthly set; the
   * caller runs these on a slower cadence because a day-grain series changes once a day.
   */
  async refreshDayRollup(): Promise<void> {
    await this.#pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_day_rollup");
  }

  async refreshDayShieldingFlow(): Promise<void> {
    await this.#pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_day_shielding_flow");
  }

  async refreshDayFeeKinds(): Promise<void> {
    await this.#pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_day_fee_kind");
  }

  /**
   * Refresh the per-pool day matviews that are already populated; what the hourly timer calls.
   *
   * It never performs a first fill, which is why it is separate from {@link fillPoolAnalytics}. An
   * unpopulated matview forbids `REFRESH ... CONCURRENTLY`, so populating one takes an ACCESS
   * EXCLUSIVE lock for an unmeasured scan in front of ingestion, and even lock-free heavy reads can
   * push ingestion behind. So a never-filled view is skipped and named, and stays empty until an
   * operator runs `npm run fill:pool-analytics` (paced, with the time printed). An empty view is
   * visible: its routes answer 503.
   *
   * Uses its own client with its own `work_mem`, RESET in `finally`, because a pooled connection
   * left raised would lift the ceiling for every later query on it; at the 4 MB default these
   * refreshes spill.
   *
   * Returns the rows across the views it refreshed and the names it skipped, because a view that
   * stops being refreshed looks exactly like a fresh one.
   */
  async refreshPoolAnalytics(
    log: (message: string) => void = () => {},
  ): Promise<PoolAnalyticsPass> {
    return this.#poolAnalyticsPass(false, log);
  }

  /**
   * Fill the per-pool day matviews, populating any that have never been filled.
   *
   * The only caller is `fill-pool-analytics-main.ts`, which refuses to start against a follower
   * that is already behind. `REFRESH MATERIALIZED VIEW` is a single statement that cannot be paced
   * mid-flight, so whether it starts is an operator's decision, never a timer's.
   */
  async fillPoolAnalytics(log: (message: string) => void = () => {}): Promise<PoolAnalyticsPass> {
    return this.#poolAnalyticsPass(true, log);
  }

  async #poolAnalyticsPass(
    populateUnfilled: boolean,
    log: (message: string) => void,
  ): Promise<PoolAnalyticsPass> {
    const client = await this.#pool.connect();
    try {
      await client.query("SET work_mem = '256MB'");
      const { rows: state } = await client.query<{ matviewname: string; ispopulated: boolean }>(
        `SELECT matviewname, ispopulated FROM pg_matviews WHERE matviewname = ANY($1::text[])`,
        [[...POOL_ANALYTICS_MATVIEWS]],
      );
      const refreshed: string[] = [];
      const skipped: string[] = [];
      for (const view of POOL_ANALYTICS_MATVIEWS) {
        const populated = state.find((s) => s.matviewname === view)?.ispopulated === true;
        if (!populated && !populateUnfilled) {
          skipped.push(view);
          // By name: the remedy is one specific command.
          log(
            `${view} SKIPPED — never populated, and a first fill is not the timer's to take; ` +
              "run `npm run fill:pool-analytics`",
          );
          continue;
        }
        await client.query(`REFRESH MATERIALIZED VIEW ${populated ? "CONCURRENTLY " : ""}${view}`);
        refreshed.push(view);
      }
      // The names are a compile-time constant, never a query parameter. Counted only over what was
      // refreshed: `count(*)` on an unpopulated matview is an error, not a zero.
      if (refreshed.length === 0) return { rows: 0, refreshed, skipped };
      const { rows } = await client.query<{ n: string }>(
        `SELECT ${refreshed.map((v) => `(SELECT count(*) FROM ${v})`).join(" + ")} AS n`,
      );
      return { rows: Number(rows[0]?.n ?? 0), refreshed, skipped };
    } finally {
      await client.query("RESET work_mem").catch(() => undefined);
      client.release();
    }
  }

  /**
   * Build the rich list from scratch, once. Supervised only, never on a timer.
   *
   * This is the full aggregate over `tx_transparent_io` that `#applyBalanceDelta` exists to avoid:
   * it reads the whole table off disk and saturates the disk the API shares. Needed for a fresh
   * database, or after the running totals were invalidated wholesale (for example the fee
   * repair re-resolving inputs across the chain).
   *
   * `work_mem` is raised on this connection alone and RESET in `finally`, because at the server's
   * 4 MB default the hash aggregate spills to disk and runs many times slower, and the connection
   * returns to a shared pool.
   */
  async bootstrapRichList(): Promise<void> {
    const client = await this.#pool.connect();
    // A terminated backend (`pg_terminate_backend`, a Postgres restart) surfaces as an out-of-band
    // `error` event on the checked-out client, and an unlistened `error` event kills the process.
    // The listener turns termination into this method's rejection alone; `release(err)` evicts the
    // dead connection.
    let clientError: Error | undefined;
    const onClientError = (error: Error) => {
      clientError = error;
    };
    client.on("error", onClientError);
    try {
      await client.query("SET work_mem = '256MB'");
      // One transaction: a half-built rich list beside a watermark claiming it is complete would be
      // served as fact.
      //
      // REPEATABLE READ is required. The balances and the watermark are separate aggregates; under
      // READ COMMITTED a block landing between them would put `computed_height` ahead of the
      // balances it dates, invisibly. One snapshot makes the two agree by construction.
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await client.query("DELETE FROM chain_address_balance");
      await client.query(
        `INSERT INTO chain_address_balance (address, balance_zat, received_zat, first_height, last_height, tx_count)
         SELECT address, balance_zat, received_zat, first_height, last_height, tx_count
           FROM (
             SELECT address,
                    SUM(CASE WHEN io = 'out' THEN value_zat ELSE -value_zat END)::bigint AS balance_zat,
                    SUM(CASE WHEN io = 'out' THEN value_zat ELSE 0 END)::bigint          AS received_zat,
                    MIN(block_height)                                                    AS first_height,
                    MAX(block_height)                                                    AS last_height,
                    COUNT(DISTINCT txid)::bigint                                         AS tx_count
               FROM tx_transparent_io
              WHERE address IS NOT NULL
              GROUP BY address
           ) b
          WHERE balance_zat > 0`,
      );
      await client.query(
        `INSERT INTO chain_rich_list_meta AS m (id, unattributed_zat, computed_height)
         SELECT TRUE,
                COALESCE(SUM(CASE WHEN io = 'out' THEN value_zat ELSE -value_zat END)
                         FILTER (WHERE address IS NULL), 0)::bigint,
                COALESCE(MAX(block_height), 0)
           FROM tx_transparent_io
         ON CONFLICT (id) DO UPDATE
            SET unattributed_zat = EXCLUDED.unattributed_zat,
                computed_height  = EXCLUDED.computed_height`,
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      await client.query("RESET work_mem").catch(() => undefined);
      client.removeListener("error", onClientError);
      client.release(clientError);
    }
    await this.refreshRichListRanks();
  }

  /**
   * Re-derive these addresses' balances from `tx_transparent_io`, replacing whatever is stored.
   *
   * The exact counterpart to the delta below, and why rollback does not reverse arithmetic:
   * `balance_zat` and `received_zat` would subtract back cleanly, but `first_height`/`last_height`
   * are MIN/MAX, and undoing the block that set one leaves the previous value unknowable.
   *
   * Cheap because it is bounded by each address's own history (an `io_address_idx` range scan) and
   * the callers are rare: a reorg, or an address the table has never seen.
   *
   * An address that re-derives to zero or less is deleted. The table lists holders, so a zero row
   * is not a holding, and a negative balance cannot come from the chain, so storing one would
   * publish an ingestion gap as a fact. The next credit re-derives the address in full.
   *
   * Also the repair path after inputs are re-resolved, which fills values on rows the delta already
   * walked past: recompute the addresses it touched.
   *
   * `maxHeight` bounds the re-derivation to blocks at or below a given height, and is required
   * wherever blocks above the one being applied are already stored (every catch-up); otherwise
   * those blocks would be counted here and again when their deltas are applied.
   */
  async recomputeAddresses(
    addresses: string[],
    client?: PoolClient,
    maxHeight?: number,
  ): Promise<void> {
    if (addresses.length === 0) return;
    const db = client ?? this.#pool;
    await db.query(
      // `COUNT(DISTINCT i.txid)` rather than `COUNT(*)`: an address paid by two outputs of one
      // transaction appears twice in the io table but was in one transaction. It rides on the scan
      // the balance already pays for.
      `INSERT INTO chain_address_balance AS b
              (address, balance_zat, received_zat, first_height, last_height, tx_count)
       SELECT i.address,
              SUM(CASE WHEN i.io = 'out' THEN i.value_zat ELSE -i.value_zat END)::bigint,
              SUM(CASE WHEN i.io = 'out' THEN i.value_zat ELSE 0 END)::bigint,
              MIN(i.block_height),
              MAX(i.block_height),
              COUNT(DISTINCT i.txid)::bigint
         FROM tx_transparent_io i
        WHERE i.address = ANY($1::text[])
          AND ($2::int IS NULL OR i.block_height <= $2::int)
        GROUP BY i.address
       ON CONFLICT (address) DO UPDATE
          SET balance_zat  = EXCLUDED.balance_zat,
              received_zat = EXCLUDED.received_zat,
              first_height = EXCLUDED.first_height,
              last_height  = EXCLUDED.last_height,
              tx_count     = EXCLUDED.tx_count`,
      [addresses, maxHeight ?? null],
    );
    // Addresses whose every row has gone leave no group above, so the upsert cannot reach them;
    // they are deleted here with any that re-derived to nothing. "Every row has gone" is tested
    // against the index, never the stored balance: an address the upsert did not reach still holds
    // its old, positive balance. Testing `balance_zat <= 0` alone would keep an address first
    // created by an orphaned block, which the replacing block would then credit a second time.
    await db.query(
      `DELETE FROM chain_address_balance b
        WHERE b.address = ANY($1::text[])
          AND (b.balance_zat <= 0
               OR NOT EXISTS (SELECT 1 FROM tx_transparent_io i
                               WHERE i.address = b.address
                                 AND ($2::int IS NULL OR i.block_height <= $2::int)))`,
      [addresses, maxHeight ?? null],
    );
  }

  /**
   * Re-derive every address a reorg could have left standing, and commit only if the list then
   * reconciles with the node's transparent pool exactly.
   *
   * A one-off repair for rows left by an earlier rollback defect in `recomputeAddresses`. The
   * affected addresses are exactly those whose first height lies inside a recorded reorg: a delta
   * only ever lowers `first_height` and every later block is higher, so such a row keeps the first
   * height the orphaned block gave it, while a row re-derived since is already right. So the
   * candidate set is a join on `reorg_event`, not a scan of the chain.
   *
   * One transaction holding the watermark row (which the follower's per-block delta also takes), so
   * the re-derivation, bounded at the watermark, cannot interleave with a block being applied. The
   * gate: balances plus the unattributed total must equal the transparent pool the node reported at
   * the watermark. A repair that cannot prove itself rolls back and reports the miss; `commit:
   * false` runs the same transaction and always rolls back.
   */
  async repairReorgCreatedAddresses(options: { commit: boolean }): Promise<ReorgAddressRepair> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      // The follower holds this lock for milliseconds per block; waiting longer means something
      // else is wrong, and the repair should not queue behind it.
      await client.query("SET LOCAL lock_timeout = '5s'");
      const { rows: mark } = await client.query<{ computed_height: number }>(
        "SELECT computed_height FROM chain_rich_list_meta WHERE id = TRUE FOR UPDATE",
      );
      const height = mark[0]?.computed_height;
      if (height === undefined) throw new Error("the rich list has never been bootstrapped");

      const residual = async (): Promise<bigint | null> => {
        const { rows } = await client.query<{ residual: string | null }>(
          `SELECT ((SELECT COALESCE(sum(balance_zat), 0) FROM chain_address_balance)
                   + m.unattributed_zat - b.transparent_pool_zat)::text AS residual
             FROM chain_rich_list_meta m
             LEFT JOIN block b ON b.height = m.computed_height
            WHERE m.id = TRUE`,
        );
        const value = rows[0]?.residual;
        return value === null || value === undefined ? null : BigInt(value);
      };
      const residualBeforeZat = await residual();

      const row = "address, balance_zat::text AS balance, tx_count::text AS txs";
      const { rows: before } = await client.query<{
        address: string;
        balance: string;
        txs: string;
      }>(
        `SELECT ${row}
           FROM chain_address_balance b
           JOIN (SELECT DISTINCT generate_series(height, height + depth - 1) AS h
                   FROM reorg_event) r
             ON b.first_height = r.h`,
      );
      const addresses = before.map((r) => r.address);
      await this.recomputeAddresses(addresses, client, height);
      const { rows: after } = await client.query<{ address: string; balance: string; txs: string }>(
        `SELECT ${row} FROM chain_address_balance WHERE address = ANY($1::text[])`,
        [addresses],
      );
      const afterBy = new Map(after.map((r) => [r.address, r]));

      let removed = 0;
      let corrected = 0;
      let excessZat = 0n;
      for (const old of before) {
        const now = afterBy.get(old.address);
        if (now === undefined) removed += 1;
        else if (now.balance !== old.balance || now.txs !== old.txs) corrected += 1;
        excessZat += BigInt(old.balance) - BigInt(now?.balance ?? "0");
      }
      const residualAfterZat = await residual();
      const committed = options.commit && residualAfterZat === 0n;
      await client.query(committed ? "COMMIT" : "ROLLBACK");
      return {
        height,
        candidates: addresses.length,
        removed,
        corrected,
        excessZat,
        residualBeforeZat,
        residualAfterZat,
        committed,
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Fold one block into the running balances.
   *
   * Keyed on the block's own `txid`s (the primary-key prefix `(txid, io, ordinal)`, the same access
   * `#deriveFees` uses). It does not filter on `block_height`: that column is unindexed, so a
   * height predicate would scan the whole io table.
   *
   * The watermark makes it exactly-once. Other tables are idempotent via `ON CONFLICT DO NOTHING`,
   * but re-applying a running total after a crash would count the block twice, so a block at or
   * below `computed_height` is skipped.
   */
  async #applyBalanceDelta(
    client: PoolClient,
    { block, transactions }: ParsedBlock,
  ): Promise<void> {
    await this.#applyBalanceDeltaAt(
      client,
      block.height,
      transactions.map((t) => t.txid),
    );
  }

  /**
   * The delta itself, given a height and the transactions at it. Separate so the ingest path and
   * `catchUpRichList` share one definition of folding a block into the balances.
   */
  async #applyBalanceDeltaAt(client: PoolClient, height: number, txids: string[]): Promise<void> {
    const { rows: mark } = await client.query<{ computed_height: number }>(
      "SELECT computed_height FROM chain_rich_list_meta WHERE id = TRUE FOR UPDATE",
    );
    // No row means the tables were never bootstrapped. Starting a running total from zero here
    // would present a balance built from this block forward as an address's whole holding.
    if (mark.length === 0) return;
    if (height <= (mark[0]?.computed_height ?? 0)) return;

    // Existing rows first, by arithmetic. Restricting to rows already present keeps this disjoint
    // from the recompute below, so no address is counted by both.
    if (txids.length > 0) {
      await client.query(
        // `tx_count` is added to, never set: on a row the backfill has not reached it is NULL, and
        // `NULL + n` stays NULL, so the row stays unknown rather than becoming a partial count.
        // That is why the column is nullable, and what lets the backfill run online.
        `UPDATE chain_address_balance b
            SET balance_zat  = b.balance_zat + d.d_balance,
                received_zat = b.received_zat + d.d_received,
                first_height = LEAST(b.first_height, $2::int),
                last_height  = GREATEST(b.last_height, $2::int),
                tx_count     = b.tx_count + d.d_txns
           FROM (
             SELECT address,
                    SUM(CASE WHEN io = 'out' THEN value_zat ELSE -value_zat END)::bigint AS d_balance,
                    SUM(CASE WHEN io = 'out' THEN value_zat ELSE 0 END)::bigint          AS d_received,
                    COUNT(DISTINCT txid)::bigint                                         AS d_txns
               FROM tx_transparent_io
              WHERE txid = ANY($1::text[]) AND address IS NOT NULL
              GROUP BY address
           ) d
          WHERE b.address = d.address`,
        [txids, height],
      );

      // Then the addresses this block touched that the table does not hold (new, or previously
      // emptied and dropped). They are re-derived in full rather than inserted at the delta,
      // because the delta would understate a returning address's lifetime received and misdate its
      // first height.
      const { rows: unknown } = await client.query<{ address: string }>(
        `SELECT DISTINCT i.address
           FROM tx_transparent_io i
          WHERE i.txid = ANY($1::text[])
            AND i.address IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM chain_address_balance b WHERE b.address = i.address)`,
        [txids],
      );
      await this.recomputeAddresses(
        unknown.map((r) => r.address),
        client,
        // Bounded at the block being applied: during a catch-up the blocks above it are already
        // stored, and re-deriving across them would count them twice.
        height,
      );

      // Spent to nothing: see `recomputeAddresses` on why zero is a deletion. Last, so an address
      // the recompute above legitimately re-created is not caught by it.
      await client.query(
        `DELETE FROM chain_address_balance b
           WHERE b.balance_zat <= 0
             AND EXISTS (SELECT 1 FROM tx_transparent_io i
                          WHERE i.txid = ANY($1::text[]) AND i.address = b.address)`,
        [txids],
      );
    }

    // The unattributed total is the same sum over rows that name no address, and it moves the
    // watermark in the same statement so the two always cover the same blocks.
    await client.query(
      `INSERT INTO chain_rich_list_meta AS m (id, unattributed_zat, computed_height)
       SELECT TRUE,
              COALESCE(SUM(CASE WHEN io = 'out' THEN value_zat ELSE -value_zat END)
                       FILTER (WHERE address IS NULL), 0)::bigint,
              $2::int
         FROM tx_transparent_io
        WHERE txid = ANY($1::text[])
       ON CONFLICT (id) DO UPDATE
          SET unattributed_zat = m.unattributed_zat + EXCLUDED.unattributed_zat,
              computed_height  = EXCLUDED.computed_height`,
      [txids, height],
    );
  }

  /**
   * The figures a rich list is checked against, plus the node's own answer beside them.
   *
   * `poolZat` is the transparent value pool the node reported for the block at the height the
   * balances cover, stored on the block row at ingest, so this compares our arithmetic against
   * consensus. `balances + unattributed` must equal it exactly.
   *
   * The heights must match: reading the pool at the live tip would show a residual equal to
   * whatever moved in between, and a misreported watermark would hide a real residual.
   */
  async richListSummaryForCheck(): Promise<{
    addresses: number;
    totalZat: number;
    unattributedZat: number;
    computedHeight: number;
    poolZat: number | null;
  }> {
    const { rows } = await this.#pool.query<{
      addresses: number;
      total_zat: number;
      unattributed_zat: number;
      computed_height: number;
      pool_zat: number | null;
    }>(
      `SELECT (SELECT count(*)::int FROM chain_address_balance)                    AS addresses,
              (SELECT COALESCE(sum(balance_zat), 0)::bigint FROM chain_address_balance) AS total_zat,
              m.unattributed_zat,
              m.computed_height,
              b.transparent_pool_zat AS pool_zat
         FROM chain_rich_list_meta m
         LEFT JOIN block b ON b.height = m.computed_height
        WHERE m.id = TRUE`,
    );
    const row = rows[0];
    return {
      addresses: row?.addresses ?? 0,
      totalZat: row?.total_zat ?? 0,
      unattributedZat: row?.unattributed_zat ?? 0,
      computedHeight: row?.computed_height ?? 0,
      poolZat: row?.pool_zat ?? null,
    };
  }

  /**
   * Fold every block already stored above the watermark into the balances.
   *
   * The balances are a running total, correct only if every ingested block has been applied.
   * Anything that writes blocks without applying deltas (rollup mode, a backfiller run) opens a gap
   * the forward path never closes, because `#applyBalanceDeltaAt` only moves the watermark up.
   * Called at follower start-up, so such a gap heals itself.
   *
   * One transaction per block rather than one for the range, so a gap does not hold rich-list locks
   * for its whole duration, and a failure part-way leaves a consistent list at a lower watermark.
   *
   * A gap wider than `maxBlocks` is refused, not walked: that is `bootstrapRichList`'s job, and a
   * follower boot is the wrong place to discover it.
   */
  async catchUpRichList(
    log: (message: string) => void = () => {},
    maxBlocks = 100_000,
  ): Promise<number> {
    const { rows: mark } = await this.#pool.query<{ computed_height: number }>(
      "SELECT computed_height FROM chain_rich_list_meta WHERE id = TRUE",
    );
    if (mark.length === 0) {
      log("rich list has no watermark — run bootstrapRichList before it can be maintained");
      return 0;
    }
    const from = (mark[0]?.computed_height ?? 0) + 1;
    const { rows: tip } = await this.#pool.query<{ height: number | null }>(
      "SELECT MAX(height) AS height FROM block",
    );
    const to = tip[0]?.height ?? 0;
    if (to < from) return 0;

    const gap = to - from + 1;
    if (gap > maxBlocks) {
      log(
        `rich list is ${gap} blocks behind (${from}..${to}) — too far to catch up per block; ` +
          "run bootstrapRichList instead. Balances left untouched",
      );
      return 0;
    }
    log(`rich list catching up ${gap} block(s), ${from}..${to}`);

    let applied = 0;
    for (let height = from; height <= to; height += 1) {
      const client = await this.#pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{ txid: string }>(
          "SELECT txid FROM tx WHERE block_height = $1",
          [height],
        );
        await this.#applyBalanceDeltaAt(
          client,
          height,
          rows.map((r) => r.txid),
        );
        await client.query("COMMIT");
        applied += 1;
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    }
    log(`rich list caught up to ${to}`);
    return applied;
  }

  /**
   * Rewrite `rank` from the balances alone.
   *
   * The one column a per-block delta cannot maintain: crediting one address renumbers every address
   * below it. Recomputed on its own timer, reading only `chain_address_balance`.
   *
   * `ORDER BY balance_zat DESC, address` is the keyset's own order, so the stored rank and the
   * page's pagination agree on which row is which.
   */
  async refreshRichListRanks(options: { batch?: number } = {}): Promise<number> {
    const batch = options.batch ?? 5_000;

    // Read the whole ordering first, then apply it in batches. As one
    // `UPDATE … FROM (SELECT row_number() …)` the planner builds a hash join over every row
    // (spilling at the default `work_mem`) and holds row locks on nearly every row for the whole
    // statement: the locks `#applyBalanceDeltaAt` needs, so every pass would stall ingestion.
    //
    // Split, neither half needs a hash: `chain_address_balance_keyset_idx` is
    // `(balance_zat DESC, address)`, exactly this window's ORDER BY, so the read is an index-only
    // scan with no sort, and each apply is a nested loop over the primary key.
    const { rows: ordering } = await this.#pool.query<{ address: string; rn: string }>(
      `SELECT address, row_number() OVER (ORDER BY balance_zat DESC, address)::bigint::text AS rn
         FROM chain_address_balance`,
    );

    let written = 0;
    // Applied in rank order. Address-order batching would publish a mixture of two numberings
    // anywhere in the list; rank order makes it a prefix/suffix split, so the top of the list stays
    // coherent while the seam moves downward.
    for (let i = 0; i < ordering.length; i += batch) {
      const slice = ordering.slice(i, i + batch);
      const result = await this.#pool.query(
        // `IS DISTINCT FROM` per batch so only changed rows are written. `rank` is in no index, so
        // those writes are HOT-eligible.
        `UPDATE chain_address_balance b
            SET rank = v.rn
           FROM unnest($1::text[], $2::bigint[]) AS v(address, rn)
          WHERE b.address = v.address AND b.rank IS DISTINCT FROM v.rn`,
        [slice.map((r) => r.address), slice.map((r) => r.rn)],
      );
      written += result.rowCount ?? 0;
    }
    // Returned so the steady-state write volume is observable: it decides how this job is
    // scheduled.
    return written;
  }

  /** Total fees per day — the network's fee bill, as opposed to one transaction's cost. */
  async refreshDayFeeTotals(): Promise<void> {
    await this.#pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_day_fee_total");
  }

  /** Daily difficulty and block size. */
  async refreshDayNetwork(): Promise<void> {
    await this.#pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY chain_day_network");
  }

  /**
   * Top up the transparent value range with the blocks added since it was last computed.
   *
   * Only the new heights: extrema combine across disjoint ranges, so folding in the newest blocks
   * is exact and cheap, where re-deriving would re-read `tx_transparent_io` from genesis. That is
   * why `chain_value_extremes` is a table and not a materialized view.
   *
   * A no-op until the first full walk has happened: `covered_through_height` of 0 means the
   * one-shot job has never run, and topping up from there would walk the whole chain inside the
   * follower's refresh cycle.
   */
  async refreshValueExtremes(): Promise<void> {
    const { rows } = await this.#pool.query<{ covered: number }>(
      "SELECT covered_through_height AS covered FROM chain_value_extremes WHERE scope = 'transaction'",
    );
    const covered = rows[0]?.covered ?? 0;
    if (covered <= 0) return;
    await this.#pool.query(
      `WITH target AS (
         SELECT GREATEST(0, max(height) - $2::int) AS h FROM block
       ),
       v AS (
         SELECT t.txid, t.block_height,
                COALESCE(NULLIF(sum(i.value_zat) FILTER (WHERE i.io = 'out'), 0),
                         NULLIF(sum(i.value_zat) FILTER (WHERE i.io = 'in'), 0)) AS value_zat
           FROM tx t
           JOIN tx_transparent_io i ON i.txid = t.txid
          WHERE t.block_height > $1 AND t.block_height <= (SELECT h FROM target)
            AND t.kind IN ('transparent', 'mixed')
          GROUP BY t.txid, t.block_height
       ),
       priced AS (SELECT * FROM v WHERE value_zat IS NOT NULL),
       b AS (SELECT min(value_zat) AS lo, max(value_zat) AS hi FROM priced)
       UPDATE chain_value_extremes e SET
         -- LEAST/GREATEST against the existing figures: the fold is a combine, never a replace.
         lowest_zat   = LEAST(e.lowest_zat, COALESCE(b.lo, e.lowest_zat)),
         lowest_count = CASE
             WHEN b.lo IS NULL OR b.lo > e.lowest_zat THEN e.lowest_count
             WHEN b.lo < e.lowest_zat THEN (SELECT count(*) FROM priced WHERE value_zat = b.lo)
             ELSE e.lowest_count + (SELECT count(*) FROM priced WHERE value_zat = b.lo)
           END,
         highest_zat   = GREATEST(e.highest_zat, COALESCE(b.hi, e.highest_zat)),
         highest_count = CASE
             WHEN b.hi IS NULL OR b.hi < e.highest_zat THEN e.highest_count
             WHEN b.hi > e.highest_zat THEN (SELECT count(*) FROM priced WHERE value_zat = b.hi)
             ELSE e.highest_count + (SELECT count(*) FROM priced WHERE value_zat = b.hi)
           END,
         highest_txid = CASE
             WHEN b.hi IS NOT NULL AND b.hi > e.highest_zat
               THEN (SELECT min(txid) FROM priced WHERE value_zat = b.hi)
             ELSE e.highest_txid
           END,
         highest_height = CASE
             WHEN b.hi IS NOT NULL AND b.hi > e.highest_zat
               THEN (SELECT min(block_height) FROM priced WHERE value_zat = b.hi)
             ELSE e.highest_height
           END,
         considered = e.considered + (SELECT count(*) FROM priced),
         covered_through_height = (SELECT h FROM target),
         updated_at = EXTRACT(EPOCH FROM now())::bigint
       FROM b
       WHERE e.scope = 'transaction' AND (SELECT h FROM target) > $1`,
      [covered, REORG_DEPTH],
    );
  }

  /**
   * The lowest and highest fee ever paid, by a transaction and by a block.
   *
   * `chain_fee_extremes` is created WITH NO DATA (so the scan stays out of the schema transaction
   * the follower runs on every boot), and `CONCURRENTLY` is illegal on a matview that has never
   * held data, so the first refresh here is a plain one. It is cheap next to the other daily views
   * and rides `DAILY_VIEWS`.
   */
  async refreshFeeExtremes(): Promise<void> {
    // The non-zero floor rides the same cycle: same source tables, same populated-check rule
    // (CONCURRENTLY is illegal on a never-populated matview).
    for (const view of ["chain_fee_extremes", "chain_fee_nonzero_floor"]) {
      const { rows } = await this.#pool.query<{ ispopulated: boolean }>(
        "SELECT ispopulated FROM pg_matviews WHERE matviewname = $1",
        [view],
      );
      const concurrently = rows[0]?.ispopulated === true ? "CONCURRENTLY " : "";
      await this.#pool.query(`REFRESH MATERIALIZED VIEW ${concurrently}${view}`);
    }
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  // ------------------------------------------------------------------ internals

  async #writeBlock(client: PoolClient, { block, rollup }: ParsedBlock): Promise<void> {
    const pools = rollup.poolTotals;
    await client.query(
      `INSERT INTO block (
         height, hash, prev_hash, timestamp, size_bytes, tx_count,
         transparent_tx_count, mixed_tx_count, shielded_tx_count,
         sapling_flow_zat, orchard_flow_zat,
         transparent_pool_zat, sprout_pool_zat, sapling_pool_zat,
         orchard_pool_zat, lockbox_pool_zat, ironwood_pool_zat,
         miner_kind, miner_address, coinbase_tag, difficulty, miner_reward_zat,
         received_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 $18,$19,$20,$21,$22,$23)
       ON CONFLICT (height) DO UPDATE SET
         hash = EXCLUDED.hash, prev_hash = EXCLUDED.prev_hash,
         timestamp = EXCLUDED.timestamp, size_bytes = EXCLUDED.size_bytes,
         tx_count = EXCLUDED.tx_count,
         transparent_tx_count = EXCLUDED.transparent_tx_count,
         mixed_tx_count = EXCLUDED.mixed_tx_count,
         shielded_tx_count = EXCLUDED.shielded_tx_count,
         sapling_flow_zat = EXCLUDED.sapling_flow_zat,
         orchard_flow_zat = EXCLUDED.orchard_flow_zat,
         transparent_pool_zat = EXCLUDED.transparent_pool_zat,
         sprout_pool_zat = EXCLUDED.sprout_pool_zat,
         sapling_pool_zat = EXCLUDED.sapling_pool_zat,
         orchard_pool_zat = EXCLUDED.orchard_pool_zat,
         lockbox_pool_zat = EXCLUDED.lockbox_pool_zat,
         ironwood_pool_zat = EXCLUDED.ironwood_pool_zat,
         miner_kind = EXCLUDED.miner_kind,
         miner_address = EXCLUDED.miner_address,
         coinbase_tag = EXCLUDED.coinbase_tag,
         difficulty = EXCLUDED.difficulty,
         miner_reward_zat = EXCLUDED.miner_reward_zat,
         -- First-seen is the observation, so a re-upsert of the SAME block never moves or
         -- erases it (the backfiller closing the seam over follower-stamped rows sends NULL,
         -- which must not win). A DIFFERENT hash at this height means the row now describes
         -- another block, and keeping the old stamp would date it by when its orphaned rival
         -- arrived — the new writer's value wins, NULL included.
         received_at = CASE WHEN block.hash = EXCLUDED.hash
                            THEN COALESCE(block.received_at, EXCLUDED.received_at)
                            ELSE EXCLUDED.received_at END`,
      [
        block.height,
        block.hash,
        block.prevHash,
        block.timestamp,
        block.sizeBytes,
        block.txids.length,
        rollup.transparentTxCount,
        rollup.mixedTxCount,
        rollup.shieldedTxCount,
        rollup.saplingFlowZat,
        rollup.orchardFlowZat,
        pools.transparent ?? null,
        pools.sprout ?? null,
        pools.sapling ?? null,
        pools.orchard ?? null,
        pools.lockbox ?? null,
        pools.ironwood ?? null,
        block.miner.kind,
        block.miner.kind === "transparent" ? block.miner.address : null,
        block.coinbaseTag,
        block.difficulty,
        minerRewardZat(block),
        this.#stampReceivedAt ? Math.floor(Date.now() / 1000) : null,
      ],
    );
  }

  async #writeTransactions(client: PoolClient, { transactions }: ParsedBlock): Promise<void> {
    if (transactions.length === 0) return;
    const classified = transactions.map((tx) => {
      const kind = classifyTxKind(tx);
      // Both from the domain classifiers, never recomputed in SQL: a query cannot see the
      // pool-disagreement rule and would name a direction where the domain refuses to.
      return { tx, kind, direction: txDirectionColumn(kind, classifyTxDirection(tx)) };
    });
    await client.query(
      `INSERT INTO tx (
         txid, block_height, timestamp, is_coinbase, version, size_bytes, expiry_height,
         kind, sprout_joinsplits, sprout_vpub_net_zat, sapling_spends,
         sapling_outputs,
         sapling_value_balance_zat, orchard_actions, orchard_value_balance_zat,
         ironwood_actions, ironwood_value_balance_zat, direction
       )
       SELECT * FROM UNNEST(
         $1::text[], $2::int[], $3::bigint[], $4::boolean[], $5::int[], $6::int[], $7::int[],
         $8::text[], $9::int[], $10::bigint[], $11::int[], $12::int[],
         $13::bigint[], $14::int[], $15::bigint[], $16::int[], $17::bigint[], $18::text[]
       )
       ON CONFLICT (txid) DO UPDATE SET
         block_height = EXCLUDED.block_height, timestamp = EXCLUDED.timestamp,
         kind = EXCLUDED.kind,
         direction = EXCLUDED.direction,
         sprout_joinsplits = EXCLUDED.sprout_joinsplits,
         sprout_vpub_net_zat = EXCLUDED.sprout_vpub_net_zat,
         sapling_spends = EXCLUDED.sapling_spends,
         sapling_outputs = EXCLUDED.sapling_outputs,
         sapling_value_balance_zat = EXCLUDED.sapling_value_balance_zat,
         orchard_actions = EXCLUDED.orchard_actions,
         orchard_value_balance_zat = EXCLUDED.orchard_value_balance_zat,
         ironwood_actions = EXCLUDED.ironwood_actions,
         ironwood_value_balance_zat = EXCLUDED.ironwood_value_balance_zat`,
      [
        classified.map((c) => c.tx.txid),
        classified.map((c) => c.tx.blockHeight),
        classified.map((c) => c.tx.timestamp),
        classified.map((c) => c.tx.isCoinbase),
        classified.map((c) => c.tx.version),
        classified.map((c) => c.tx.sizeBytes),
        classified.map((c) => c.tx.expiryHeight),
        classified.map((c) => c.kind),
        classified.map((c) => c.tx.sprout?.joinSplits ?? null),
        // Stored for every transaction, not just Sprout ones: 0 is a derived fact ("no joinsplits")
        // and NULL means "never derived", which the fee repair uses to find the rows it still has
        // to visit.
        classified.map((c) => c.tx.rpcSproutVB),
        classified.map((c) => c.tx.sapling?.spends ?? null),
        classified.map((c) => c.tx.sapling?.outputs ?? null),
        classified.map((c) => c.tx.sapling?.valueBalanceZat ?? null),
        classified.map((c) => c.tx.orchard?.actions ?? null),
        classified.map((c) => c.tx.orchard?.valueBalanceZat ?? null),
        // `?? null` on both halves keeps the bundle whole, which the CHECK constraint enforces:
        // absent bundle -> both NULL, present bundle -> both set.
        classified.map((c) => c.tx.ironwood?.actions ?? null),
        classified.map((c) => c.tx.ironwood?.valueBalanceZat ?? null),
        // Null for every kind but `mixed`, and never null for a mixed row (see
        // `txDirectionColumn`), which lets `repair-direction` find its remaining work as `kind =
        // 'mixed' AND direction IS NULL`.
        classified.map((c) => c.direction),
      ],
    );
  }

  async #writeTransparentIo(
    client: PoolClient,
    { transactions, block }: ParsedBlock,
  ): Promise<void> {
    const txids: string[] = [];
    const ios: string[] = [];
    const ordinals: number[] = [];
    const addresses: (string | null)[] = [];
    const values: (number | null)[] = [];
    const scriptTypes: (string | null)[] = [];
    const prevTxids: (string | null)[] = [];
    const prevVouts: (number | null)[] = [];

    for (const tx of transactions) {
      for (const out of tx.outputs) {
        txids.push(tx.txid);
        ios.push("out");
        ordinals.push(out.ordinal);
        addresses.push(out.address);
        values.push(out.valueZat);
        scriptTypes.push(out.scriptType);
        prevTxids.push(null);
        prevVouts.push(null);
      }
      // Inputs go in unresolved: address and value are filled by #resolveInputs.
      for (const ref of tx.inputRefs) {
        txids.push(tx.txid);
        ios.push("in");
        ordinals.push(ref.ordinal);
        addresses.push(null);
        values.push(null);
        scriptTypes.push(null);
        prevTxids.push(ref.prevTxid);
        prevVouts.push(ref.prevVout);
      }
    }
    if (txids.length === 0) return;

    await client.query(
      `INSERT INTO tx_transparent_io
         (txid, io, ordinal, address, value_zat, script_type, prev_txid, prev_vout, block_height)
       SELECT *, $9::int FROM UNNEST(
         $1::text[], $2::text[], $3::int[], $4::text[], $5::bigint[], $6::text[],
         $7::text[], $8::int[]
       )
       ON CONFLICT (txid, io, ordinal) DO NOTHING`,
      [txids, ios, ordinals, addresses, values, scriptTypes, prevTxids, prevVouts, block.height],
    );
  }

  /**
   * Fill in each input's address and value from the output it spends.
   *
   * Resolved locally rather than by RPC: ingest is in block order, so the referenced output is
   * already stored, where one `getrawtransaction` per input would be millions of extra calls.
   *
   * Inputs that resolve to nothing stay NULL, the honest outcome when the spent output predates our
   * history; an unresolved input makes the fee unknown rather than wrong.
   */
  async #resolveInputs(client: PoolClient, { transactions }: ParsedBlock): Promise<void> {
    const txids = transactions.filter((t) => t.inputRefs.length > 0).map((t) => t.txid);
    if (txids.length === 0) return;
    await client.query(`${RESOLVE_INPUTS_JOIN} AND i.txid = ANY($1::text[])`, [txids]);
  }

  /**
   * Derive each transaction's fee, then the block's total.
   *
   * The block total is NULL if any non-coinbase fee is unknown — never a partial sum.
   * Coinbase fees are NULL by design and excluded from that test, otherwise every block
   * would report an unknown total.
   */
  async #deriveFees(client: PoolClient, { transactions, block }: ParsedBlock): Promise<void> {
    const byTxid = new Map<string, ParsedTransaction>(transactions.map((t) => [t.txid, t]));
    const txids = [...byTxid.keys()];
    if (txids.length === 0) return;

    const { rows } = await client.query<{
      txid: string;
      in_sum: number | null;
      unresolved: number;
    }>(
      `SELECT txid,
              SUM(value_zat) FILTER (WHERE io = 'in')                        AS in_sum,
              COUNT(*) FILTER (WHERE io = 'in' AND value_zat IS NULL)::int    AS unresolved
         FROM tx_transparent_io
        WHERE txid = ANY($1::text[])
        GROUP BY txid`,
      [txids],
    );
    const sums = new Map(rows.map((r) => [r.txid, r]));

    const feeTxids: string[] = [];
    const fees: (number | null)[] = [];
    for (const [txid, parsed] of byTxid) {
      const row = sums.get(txid);
      // Only an unresolved input makes the total unknown. A transaction with no `tx_transparent_io`
      // rows is fully shielded, so its transparent input total is exactly 0 and the whole value
      // balance is the fee (see `computeFeeZat`).
      //
      // `row.in_sum ?? 0` covers a transaction with 'out' rows but no 'in' rows (z→t): the FILTER
      // yields NULL over zero rows, and 0 is the true total.
      const transparentIn = row === undefined ? 0 : row.unresolved > 0 ? null : (row.in_sum ?? 0);
      feeTxids.push(txid);
      fees.push(computeFeeZat(parsed, transparentIn));
    }

    await client.query(
      `UPDATE tx SET fee_zat = data.fee
         FROM (SELECT * FROM UNNEST($1::text[], $2::bigint[]) AS t(txid, fee)) AS data
        WHERE tx.txid = data.txid`,
      [feeTxids, fees],
    );

    const nonCoinbase = new Set(transactions.filter((t) => !t.isCoinbase).map((t) => t.txid));
    const total = blockTotalFeeZat(
      feeTxids
        .map((txid, i) => ({ txid, fee: fees[i] ?? null }))
        .filter((f) => nonCoinbase.has(f.txid))
        .map((f) => f.fee),
    );

    await client.query("UPDATE block SET total_fee_zat = $2 WHERE height = $1", [
      block.height,
      total,
    ]);
  }

  async #writeSyncState(client: PoolClient, height: number, hash: string): Promise<void> {
    await client.query(
      `INSERT INTO chain_sync_state (id, tip_height, tip_hash, updated_at)
       VALUES (TRUE, $1, $2, EXTRACT(EPOCH FROM now())::bigint)
       ON CONFLICT (id) DO UPDATE SET
         tip_height = EXCLUDED.tip_height,
         tip_hash = EXCLUDED.tip_hash,
         updated_at = EXCLUDED.updated_at`,
      [height, hash],
    );
  }
}
