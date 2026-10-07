import type { Pool, PoolClient } from "pg";
import { rollbackQuietly } from "./pg-pool";
import { REORG_DEPTH } from "./follow";
import type { PostgresChainStore } from "./postgres-chain-store";
import type { Pacer } from "./job-pacer";

/**
 * Fill `chain_address_balance.tx_count` for rows that predate the column, online, while the
 * follower keeps ingesting, without ever holding a lock across a slow statement.
 *
 * Why it walks height rather than address: `io_address_idx` is `(address, block_height DESC)`
 * and does not carry `txid`, so `COUNT(DISTINCT txid)` by address needs a heap fetch per row in
 * an order uncorrelated with the heap, and a batch's `UPDATE` would hold row locks the
 * follower's per-block delta needs for minutes. A full-table `GROUP BY address` spills, and an
 * `(address, txid)` index build saturates I/O in one unpauseable statement.
 *
 * Height order avoids all of that. A txid belongs to exactly one block, so `COUNT(DISTINCT txid)`
 * per address is exactly additive across disjoint height ranges, with no boundary correction.
 * And `tx_transparent_io` is append-only in block order, so a height range's rows are physically
 * clustered. Transaction density varies roughly 45x along the chain, so the chunk span adapts
 * (see `nextChunkSpan`); the run is resumable and paced, so a slow stretch costs time, not
 * correctness.
 *
 * Two phases, so the expensive read never touches the published table: Phase A aggregates into
 * an unlogged staging table and takes no lock on `chain_address_balance`; Phase B applies it in
 * statements that finish in milliseconds. The staging table also makes the result auditable
 * before it is published.
 */

/**
 * Scratch tables, deliberately not in `server/schema-chain.sql`: that file is re-applied on every
 * follower and backfiller boot, so a `CREATE` there would resurrect the table forever and a later
 * `DROP` there would be a hazard.
 *
 * `UNLOGGED` skips WAL for hundreds of upsert passes. A Postgres crash truncates it, which costs a
 * re-run of a resumable read; both tables are unlogged so they truncate together, and
 * `stageTxCounts` refuses a watermark above zero with an empty accumulator rather than resuming
 * into a silent undercount.
 *
 * Not `TEMP`: Phase B runs on a different connection, possibly in a different container, later.
 * `fillfactor = 70` keeps the repeated per-chunk updates HOT and prunable in-page.
 */
export const STAGING_DDL = `
CREATE UNLOGGED TABLE IF NOT EXISTS tx_count_backfill (
  address TEXT PRIMARY KEY,
  n       BIGINT NOT NULL
) WITH (fillfactor = 70);

CREATE UNLOGGED TABLE IF NOT EXISTS tx_count_backfill_state (
  id                        BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  h_target                  INTEGER NOT NULL,
  through_height            INTEGER NOT NULL,
  started_at                BIGINT  NOT NULL,
  start_computed_height     INTEGER NOT NULL,
  start_backfill_updated_at BIGINT,
  start_reorg_max_id        BIGINT,
  apply_cursor              TEXT    NOT NULL DEFAULT ''
);
`;

export interface StagingState {
  hTarget: number;
  throughHeight: number;
  startedAt: number;
  startComputedHeight: number;
  startBackfillUpdatedAt: number | null;
  startReorgMaxId: number | null;
  applyCursor: string;
}

/** Thrown when a precondition fails. Always fatal: the answer would be silently wrong. */
export class BackfillRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackfillRefused";
  }
}

export async function ensureStaging(pool: Pool): Promise<void> {
  await pool.query(STAGING_DDL);
}

export async function readState(db: Pool | PoolClient): Promise<StagingState | null> {
  const { rows } = await db.query<{
    h_target: number;
    through_height: number;
    started_at: string;
    start_computed_height: number;
    start_backfill_updated_at: string | null;
    start_reorg_max_id: string | null;
    apply_cursor: string;
  }>("SELECT * FROM tx_count_backfill_state WHERE id = TRUE");
  const row = rows[0];
  if (row === undefined) return null;
  return {
    hTarget: row.h_target,
    throughHeight: row.through_height,
    startedAt: Number(row.started_at),
    startComputedHeight: row.start_computed_height,
    startBackfillUpdatedAt:
      row.start_backfill_updated_at === null ? null : Number(row.start_backfill_updated_at),
    startReorgMaxId: row.start_reorg_max_id === null ? null : Number(row.start_reorg_max_id),
    applyCursor: row.apply_cursor,
  };
}

interface ChainMarks {
  tip: number;
  /** The lowest stored height. Chunking starts here — below it there are no io rows to count. */
  minHeight: number;
  computedHeight: number;
  backfillUpdatedAt: number | null;
  reorgMaxId: number | null;
}

async function readMarks(db: Pool | PoolClient): Promise<ChainMarks> {
  const { rows } = await db.query<{
    tip: number | null;
    min_height: number | null;
    computed_height: number | null;
    backfill_updated_at: string | null;
    reorg_max_id: string | null;
  }>(
    `SELECT (SELECT max(height) FROM block)                              AS tip,
            (SELECT min(height) FROM block)                              AS min_height,
            (SELECT computed_height FROM chain_rich_list_meta WHERE id)  AS computed_height,
            (SELECT updated_at FROM chain_backfill_state WHERE id)       AS backfill_updated_at,
            (SELECT max(id) FROM reorg_event)                            AS reorg_max_id`,
  );
  const row = rows[0];
  return {
    tip: row?.tip ?? 0,
    minHeight: row?.min_height ?? 0,
    computedHeight: row?.computed_height ?? 0,
    backfillUpdatedAt: row?.backfill_updated_at == null ? null : Number(row.backfill_updated_at),
    reorgMaxId: row?.reorg_max_id == null ? null : Number(row.reorg_max_id),
  };
}

/**
 * Establish the run's target height and refuse if anything would make the count wrong.
 *
 * `H = tip − REORG_DEPTH`, using the constant from `follow.ts`. `findCommonAncestor` throws
 * `DeepReorgError` past that depth instead of rolling back, so no automatic rollback can reach a
 * height a chunk has already covered.
 */
export async function preflight(
  pool: Pool,
  log: (message: string) => void,
  options: { skipHoleCheck?: boolean; reorgMargin?: number } = {},
): Promise<ChainMarks & { hTarget: number }> {
  // Configurable so a test can drive a short chain and an operator can widen the margin. The
  // default is the follower's own constant: it must match the depth past which the follower
  // refuses to roll back.
  const margin = options.reorgMargin ?? REORG_DEPTH;
  const marks = await readMarks(pool);
  if (marks.tip <= margin) throw new BackfillRefused(`chain tip ${marks.tip} is too low`);
  const hTarget = marks.tip - margin;

  // `last_height <= H` proves no block above H was folded in (`#applyBalanceDeltaAt` writes
  // `last_height` and `tx_count` in one statement), but says nothing about blocks that are stored
  // and not yet applied, which is the state `catchUpRichList` exists for. The staging pass would
  // count those blocks and `catchUpRichList` would later add them again: a silent, permanent
  // double count. So the delta must have caught up to H first.
  if (marks.computedHeight < hTarget) {
    throw new BackfillRefused(
      `the rich list watermark (${marks.computedHeight}) is below the target height ` +
        `${hTarget}: blocks are stored but not folded into tx_count, so counting them here would ` +
        `double when catchUpRichList applies them. Let the follower catch up first.`,
    );
  }

  // A mempool row has no height, so every chunk skips it while `recomputeAddresses` (the oracle
  // every test compares against) counts it. Asserted rather than assumed.
  const { rows: mem } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM tx WHERE block_height IS NULL",
  );
  if (mem[0] !== undefined && mem[0].n !== "0") {
    throw new BackfillRefused(
      `${mem[0].n} transactions have no block_height (mempool rows). A height-chunked pass ` +
        `cannot see them, so the counts would be short. Clear them or exclude them deliberately.`,
    );
  }

  if (options.skipHoleCheck !== true) {
    // A `block` row whose transactions were never ingested is a hole the one-shot backfiller closes
    // later, at heights a chunk has already passed, raising no `last_height`. Checked as the global
    // reconciliation `sum(block.tx_count)` against `count(*) FROM tx`.
    const { rows } = await pool.query<{ expected: string; actual: string }>(
      `SELECT (SELECT COALESCE(sum(tx_count), 0)::text FROM block WHERE height <= $1) AS expected,
              (SELECT count(*)::text FROM tx WHERE block_height <= $1)                 AS actual`,
      [hTarget],
    );
    const row = rows[0];
    if (row !== undefined && row.expected !== row.actual) {
      throw new BackfillRefused(
        `transaction coverage is incomplete below height ${hTarget}: blocks claim ` +
          `${row.expected} transactions, tx holds ${row.actual}. Re-run the backfiller to close ` +
          `the gap first — filling it later would land rows at heights this pass has covered.`,
      );
    }
  }

  log(
    `preflight ok: heights ${marks.minHeight}–${marks.tip}, watermark ${marks.computedHeight}, ` +
      `target H ${hTarget} (tip − ${margin})`,
  );
  return { ...marks, hTarget };
}

export interface StageOptions {
  pool: Pool;
  log?: (message: string) => void;
  pacer?: Pacer;
  /** Starting heights per chunk. Adapts from here — see `nextChunkSpan`. */
  chunk?: number;
  /**
   * Wall time each chunk should aim for; the span is resized to hit it. 20 s keeps every statement
   * well inside `statementTimeoutMs` and gives the pacer a yield point roughly every 40 s at 50%
   * duty.
   */
  targetChunkMs?: number;
  /** Set false to keep `chunk` fixed — for tests that assert an exact chunk count. */
  adaptive?: boolean;
  /** Stop after this many chunks — for a deliberately bounded first run. */
  chunks?: number;
  /** `work_mem` for the aggregate. The server default is 4 MB, which spills. */
  workMem?: string;
  /** A mis-planned chunk should fail as one chunk, not as a 100-second statement. */
  statementTimeoutMs?: number;
  skipHoleCheck?: boolean;
  /** Vacuum the accumulator every N chunks to keep the repeated updates from bloating it. */
  vacuumEvery?: number;
  /** Defaults to `REORG_DEPTH`. Lower it only in tests. */
  reorgMargin?: number;
}

export interface StageResult {
  throughHeight: number;
  hTarget: number;
  chunksRun: number;
  complete: boolean;
  abortedForIngestion: boolean;
  /** Spans abandoned to a statement timeout and retried smaller. Reported, not silent. */
  timeouts: number;
}

/**
 * Bounds on the adaptive chunk span. Below the floor the per-statement overhead dominates; the
 * ceiling limits how far a span grown through a light era can overshoot into a dense one. The
 * timeout retry in `stageTxCounts` is what actually recovers from an overshoot.
 */
export const MIN_CHUNK = 200;
export const MAX_CHUNK = 25_000;

/**
 * The span to retry a timed-out chunk at, or `null` when it is already as small as it goes.
 *
 * Pure and separate from the loop so the decision can be tested: forcing a real statement
 * timeout needs a chain slow enough to exceed it. Halving rather than dropping to the floor,
 * because an overshoot usually needs one or two halvings and `MIN_CHUNK` would crawl through a
 * dense era.
 */
export function spanAfterTimeout(currentSpan: number): number | null {
  if (currentSpan <= MIN_CHUNK) return null;
  return Math.max(MIN_CHUNK, Math.floor(currentSpan / 2));
}

/**
 * Choose the next chunk's height span from the last one's measured rate.
 *
 * Sizing by measured rate makes every chunk cost about the same wall time wherever it is, so the
 * pacer's yield points stay evenly spaced and the statement timeout can be tight. Growth is capped
 * at 2x per step and shrink at 4x, so one anomalous chunk cannot make the span oscillate.
 */
export function nextChunkSpan(currentSpan: number, workedMs: number, targetMs: number): number {
  // A chunk that returned instantly carries no rate information worth extrapolating from.
  if (workedMs <= 0) return Math.min(currentSpan * 2, MAX_CHUNK);
  const scaled = Math.round((currentSpan * targetMs) / workedMs);
  const capped = Math.min(scaled, currentSpan * 2);
  const floored = Math.max(capped, Math.ceil(currentSpan / 4));
  return Math.min(Math.max(floored, MIN_CHUNK), MAX_CHUNK);
}

/**
 * Phase A: accumulate per-address transaction counts, holding no lock on the published table.
 */
export async function stageTxCounts({
  pool,
  log = () => {},
  pacer,
  chunk = 10_000,
  chunks,
  workMem = "256MB",
  statementTimeoutMs = 180_000,
  skipHoleCheck,
  vacuumEvery = 50,
  reorgMargin,
  targetChunkMs = 20_000,
  adaptive = true,
}: StageOptions): Promise<StageResult> {
  await ensureStaging(pool);

  const existing = await readState(pool);
  const marks = await preflight(pool, log, {
    skipHoleCheck: skipHoleCheck ?? existing !== null,
    ...(reorgMargin !== undefined ? { reorgMargin } : {}),
  });

  // A resumed run must not adopt a different H, or the two halves of the accumulator would cover
  // different spans.
  let hTarget = marks.hTarget;
  // Start at the chain's own first block: there are no io rows below it.
  let from = marks.minHeight;
  if (existing !== null) {
    hTarget = existing.hTarget;
    from = existing.throughHeight + 1;

    // Both staging tables are unlogged, so a crash truncates them together. A watermark above zero
    // with nothing accumulated means exactly that, and resuming would silently skip every chunk
    // below it.
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM tx_count_backfill",
    );
    if (existing.throughHeight > 0 && rows[0]?.n === "0") {
      throw new BackfillRefused(
        `the accumulator is empty but its watermark is at height ${existing.throughHeight}. ` +
          `An unlogged table was truncated by a crash. Reset with REPAIR_PHASE=cleanup and start ` +
          `again — resuming would skip every chunk below the watermark.`,
      );
    }
    log(`resuming at height ${from} toward H ${hTarget}`);
  }

  if (pacer !== undefined) await pacer.preflight();

  let chunksRun = 0;
  let abortedForIngestion = false;
  let timeouts = 0;

  while (from <= hTarget) {
    if (chunks !== undefined && chunksRun >= chunks) break;
    const to = Math.min(from + chunk - 1, hTarget);
    const startedAt = Date.now();
    // Set by the catch below when a span was too large for this stretch of chain. The range is then
    // retried at half the span rather than counted as progress.
    let timedOut = false;

    const client = await pool.connect();
    // A terminated backend must not take the process down. The listener is removed in `finally`,
    // because a pooled client is reused and attaching per checkout would leak a listener per chunk.
    const onError = (error: Error) => log(`staging connection error: ${String(error)}`);
    client.on("error", onError);
    try {
      // Set on the connection and RESET in `finally`, because it returns to a shared pool. The
      // server default of 4 MB makes this aggregate spill.
      await client.query(`SET work_mem = '${workMem}'`);
      await client.query(`SET statement_timeout = ${statementTimeoutMs}`);
      await client.query("BEGIN");

      await client.query(
        // `count(*)` over a pre-DISTINCTed subquery, not `count(DISTINCT i.txid)`: Postgres
        // implements the latter as a tuplesort per group, which spills across millions of groups.
        // Here it is one hash over `(address, txid)`.
        //
        // Only `t.block_height` is filtered. An extra `i.block_height BETWEEN` predicate is
        // redundant (the join on `txid` already puts every io row of a txid in one chunk, and
        // `#writeTransparentIo` stamps one height per block), and it collapses the planner's row
        // estimate so the chosen Sort spills. It could also only exclude rows the oracle includes.
        //
        // The `EXISTS` sits above the GROUP BY so it probes once per address in the chunk, not once
        // per io row, narrowing all chain addresses to those with a balance row and keeping the
        // accumulator small.
        `INSERT INTO tx_count_backfill (address, n)
         SELECT d.address, count(*)::bigint
           FROM (SELECT DISTINCT i.address, i.txid
                   FROM tx t
                   JOIN tx_transparent_io i ON i.txid = t.txid
                  WHERE t.block_height BETWEEN $1 AND $2
                    AND i.address IS NOT NULL) d
          WHERE EXISTS (SELECT 1 FROM chain_address_balance b WHERE b.address = d.address)
          GROUP BY d.address
         ON CONFLICT (address) DO UPDATE SET n = tx_count_backfill.n + EXCLUDED.n`,
        [from, to],
      );

      // The watermark advances in the same transaction as the chunk. The counter is additive, so
      // unlike other repairs there is no `IS NULL` predicate to make a re-applied chunk a no-op: a
      // kill between the INSERT and this write would add one chunk's counts twice, undetectably.
      await client.query(
        `INSERT INTO tx_count_backfill_state
                (id, h_target, through_height, started_at, start_computed_height,
                 start_backfill_updated_at, start_reorg_max_id)
         VALUES (TRUE, $1, $2, EXTRACT(EPOCH FROM now())::bigint, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET through_height = EXCLUDED.through_height`,
        [hTarget, to, marks.computedHeight, marks.backfillUpdatedAt, marks.reorgMaxId],
      );
      await client.query("COMMIT");
      timedOut = false;
    } catch (error) {
      await rollbackQuietly(client);
      // A statement timeout means the span is too large for this stretch of chain, not a failure.
      // `nextChunkSpan` only learns from chunks that succeed, so without this the run would die at
      // the first density cliff. The chunk rolled back whole, so retrying the same range at half
      // the span is safe.
      const smaller = codeOf(error) === STATEMENT_TIMEOUT ? spanAfterTimeout(to - from + 1) : null;
      if (smaller !== null) {
        chunk = smaller;
        timeouts += 1;
        log(`chunk at ${from} timed out; halving span to ${chunk} and retrying`);
        timedOut = true;
      } else {
        throw error;
      }
    } finally {
      await client.query("RESET work_mem").catch(() => {});
      await client.query("RESET statement_timeout").catch(() => {});
      client.off("error", onError);
      client.release();
    }

    // A timed-out chunk committed nothing, so it must not advance `from`, resize from its own
    // duration, or count as a yield point.
    if (timedOut) continue;

    const workedMs = Date.now() - startedAt;
    chunksRun += 1;
    // The span actually covered: `chunk` except on the final chunk, where `hTarget` clamps it.
    // Resizing from the clamped value would shrink the span for no reason at the end.
    const span = to - from + 1;
    from = to + 1;
    if (adaptive) chunk = nextChunkSpan(span, workedMs, targetChunkMs);
    if (chunksRun % 10 === 0 || chunksRun === 1) {
      log(
        `staged heights up to ${to}/${hTarget} (chunk ${chunksRun}, ${workedMs}ms, ` +
          `next span ${chunk})`,
      );
    }

    if (chunksRun % vacuumEvery === 0) await pool.query("VACUUM tx_count_backfill");

    if (pacer !== undefined && (await pacer.afterUnit(workedMs)) === "abort") {
      abortedForIngestion = true;
      break;
    }
  }

  const complete = from > hTarget;
  if (complete) {
    // A fresh unlogged table joined to a large table would otherwise be planned off a default
    // estimate.
    await pool.query("ANALYZE tx_count_backfill");
    log(`staging complete through H ${hTarget}`);
  }
  return {
    throughHeight: Math.min(from - 1, hTarget),
    hTarget,
    chunksRun,
    complete,
    abortedForIngestion,
    timeouts,
  };
}

export interface ApplyOptions {
  pool: Pool;
  store: PostgresChainStore;
  log?: (message: string) => void;
  pacer?: Pacer;
  /**
   * Addresses per batch.
   *
   * Larger than intuition suggests: while most rows are still NULL the partial index is not
   * selective, so the planner picks a hash join over a sequential scan of `chain_address_balance`.
   * That scan is a fixed cost per batch, so small batches pay it repeatedly. 25,000 keeps each
   * statement well under a second while its row locks cover a small share of the table, so a
   * collision with the follower's per-block delta costs that block about a second.
   */
  batch?: number;
  /** Stop after this many addresses, for a deliberately bounded first run. */
  limit?: number;
  /** Addresses per `recomputeAddresses` call in the tail. Small: it re-derives from the index. */
  recomputeChunk?: number;
  lockTimeoutMs?: number;
}

export interface ApplyResult {
  filled: number;
  recomputed: number;
  batches: number;
  /** NULL rows left over, which should be 0. Reported rather than assumed. */
  remaining: number;
  abortedForIngestion: boolean;
  retries: number;
}

/** `query_canceled` — what `statement_timeout` raises. */
const STATEMENT_TIMEOUT = "57014";

/** Postgres codes worth retrying: deadlock, serialisation failure, lock timeout. */
const RETRYABLE = new Set(["40P01", "40001", "55P03"]);

function codeOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/**
 * Re-check, at apply time, everything that could have invalidated the accumulator since it was
 * built. Each of these can only be judged now, against the marks the first chunk froze.
 */
async function assertStillValid(
  pool: Pool,
  state: StagingState,
  log: (message: string) => void,
): Promise<number> {
  const marks = await readMarks(pool);

  if (marks.computedHeight < state.hTarget) {
    throw new BackfillRefused(
      `the rich list watermark (${marks.computedHeight}) has fallen below H ${state.hTarget}. ` +
        `A rollback lowers it, so the accumulator may cover blocks that no longer exist.`,
    );
  }

  // A reorg at or below H replaced blocks a chunk had already counted. `rollbackAbove` hands every
  // address in the orphaned blocks to `recomputeAddresses`, which assigns an exact count, but that
  // does not cover an address appearing only in the replacement block at a height ≤ H. So refuse.
  // `reorg_event` is written in the same transaction as the rollback, so it is an exact audit
  // trail.
  const { rows: reorgs } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM reorg_event
      WHERE height <= $1 AND ($2::bigint IS NULL OR id > $2::bigint)`,
    [state.hTarget, state.startReorgMaxId],
  );
  if (reorgs[0] !== undefined && reorgs[0].n !== "0") {
    throw new BackfillRefused(
      `${reorgs[0].n} reorg(s) at or below H ${state.hTarget} since staging began. Re-stage: a ` +
        `replacement block's rows were never counted.`,
    );
  }

  // The one-shot backfiller writes io rows at whatever heights it is closing, raising no
  // `last_height`. Its state row is touched once per batch, so a changed `updated_at` is an exact
  // "it ran" flag.
  if (marks.backfillUpdatedAt !== state.startBackfillUpdatedAt) {
    throw new BackfillRefused(
      `the one-shot backfiller has run since staging began (chain_backfill_state.updated_at ` +
        `${String(state.startBackfillUpdatedAt)} → ${String(marks.backfillUpdatedAt)}). It may ` +
        `have added rows at heights already counted. Re-stage.`,
    );
  }

  log(`apply preconditions ok (watermark ${marks.computedHeight}, H ${state.hTarget})`);
  return marks.computedHeight;
}

/**
 * Phase B: copy the accumulator onto the published table, in statements that finish in
 * milliseconds and hold no lock across anything slow.
 *
 * No `FOR UPDATE`: under READ COMMITTED an `UPDATE` that meets a concurrently modified row waits,
 * then re-evaluates its `WHERE` against the new row version and skips the row if it no longer
 * matches. So `tx_count IS NULL AND last_height <= H` is atomic with the write. The precondition
 * is that the accumulator is frozen while this runs.
 *
 * Pagination walks the staging table's primary key, not the live table's: the accumulator is
 * small, has no concurrent writers, and hands the UPDATE literal range bounds the planner can
 * seek, whereas `WHERE tx_count IS NULL ORDER BY address` gets slower as the NULL set thins.
 */
export async function applyTxCounts({
  pool,
  store,
  log = () => {},
  pacer,
  batch = 25_000,
  limit,
  recomputeChunk = 200,
  lockTimeoutMs = 2_000,
}: ApplyOptions): Promise<ApplyResult> {
  const state = await readState(pool);
  if (state === null) throw new BackfillRefused("nothing staged: run REPAIR_PHASE=stage first");
  if (state.throughHeight < state.hTarget) {
    throw new BackfillRefused(
      `staging is incomplete (through ${state.throughHeight} of ${state.hTarget}). Applying now ` +
        `would write counts missing every block above the watermark.`,
    );
  }

  // Called for its assertions only. The tail must not reuse a watermark read here, because it is
  // stale by the time the tail runs; the tail reads its own under `FOR UPDATE`.
  await assertStillValid(pool, state, log);
  if (pacer !== undefined) await pacer.preflight();

  let cursor = state.applyCursor;
  let filled = 0;
  let batches = 0;
  let retries = 0;
  let abortedForIngestion = false;

  for (;;) {
    if (limit !== undefined && filled >= limit) break;
    const size = limit === undefined ? batch : Math.min(batch, limit - filled);
    const startedAt = Date.now();

    // The batch's upper bound, read from the accumulator's own PK so the UPDATE below gets two
    // literals. Taken from rows claimed rather than rows written: an accumulator row with no live
    // row (its balance reached zero mid-run) writes nothing, and the cursor would otherwise stall.
    const { rows: bound } = await pool.query<{ address: string }>(
      "SELECT address FROM tx_count_backfill WHERE address > $1 ORDER BY address LIMIT $2",
      [cursor, size],
    );
    if (bound.length === 0) break;
    const hi = bound[bound.length - 1]!.address;

    let wrote = 0;
    for (let attempt = 1; ; attempt += 1) {
      const client = await pool.connect();
      const onError = (error: Error) => log(`apply connection error: ${String(error)}`);
      client.on("error", onError);
      try {
        await client.query(`SET lock_timeout = ${lockTimeoutMs}`);
        const result = await client.query(
          `UPDATE chain_address_balance b
              SET tx_count = s.n
             FROM tx_count_backfill s
            WHERE b.address = s.address
              AND s.address > $1 AND s.address <= $2
              AND b.tx_count IS NULL
              AND b.last_height <= $3`,
          [cursor, hi, state.hTarget],
        );
        wrote = result.rowCount ?? 0;
        break;
      } catch (error) {
        const code = codeOf(error);
        if (code !== undefined && RETRYABLE.has(code) && attempt < 5) {
          // A deadlock is survivable: if Postgres kills `ingestBlock` instead, `startFollowing`
          // logs and retries atomically after a short wait. It is still counted, because frequent
          // deadlocks add up to lost ingest spread too thin for the stall detector to see.
          retries += 1;
          log(`batch through ${hi} hit ${code}, retry ${attempt}`);
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
          continue;
        }
        throw error;
      } finally {
        await client.query("RESET lock_timeout").catch(() => {});
        client.off("error", onError);
        client.release();
      }
    }

    await pool.query("UPDATE tx_count_backfill_state SET apply_cursor = $1 WHERE id = TRUE", [hi]);
    cursor = hi;
    filled += wrote;
    batches += 1;
    if (batches % 10 === 0 || batches === 1) log(`applied ${filled} rows, through ${hi}`);

    if (pacer !== undefined && (await pacer.afterUnit(Date.now() - startedAt)) === "abort") {
      abortedForIngestion = true;
      break;
    }
  }

  // The tail: rows the delta touched above H, whose accumulated figure is short. Re-derived exactly
  // by the function the follower itself uses. `maxHeight` is required: unbounded, it would count
  // blocks above the watermark that the delta has yet to apply, and they would be applied twice.
  let recomputed = 0;
  if (!abortedForIngestion) {
    for (;;) {
      const { rows } = await pool.query<{ address: string }>(
        `SELECT address FROM chain_address_balance
          WHERE tx_count IS NULL AND last_height > $1
          ORDER BY address LIMIT $2`,
        [state.hTarget, recomputeChunk],
      );
      if (rows.length === 0) break;
      const addresses = rows.map((r) => r.address);
      const startedAt = Date.now();

      // The watermark is read under `FOR UPDATE`, in the same transaction as the recompute.
      //
      // `recomputeAddresses` derives the balance as of `maxHeight`, overwriting the row, while the
      // delta adds. The two are only compatible if they agree on the height: with a stale
      // `maxHeight`, the recompute would strip a block the follower had already applied while the
      // watermark stayed high, leaving a quietly short balance. Holding the meta row, as
      // `#applyBalanceDeltaAt` does, stops any block committing, so the height read and the
      // derivation are one instant.
      const client = await pool.connect();
      const onError = (error: Error) => log(`recompute connection error: ${String(error)}`);
      client.on("error", onError);
      try {
        await client.query("BEGIN");
        const mark = await client.query<{ computed_height: number }>(
          "SELECT computed_height FROM chain_rich_list_meta WHERE id = TRUE FOR UPDATE",
        );
        const atHeight = mark.rows[0]?.computed_height;
        if (atHeight === undefined) {
          throw new BackfillRefused("the rich list watermark row vanished mid-apply");
        }
        await store.recomputeAddresses(addresses, client, atHeight);
        await client.query("COMMIT");
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.off("error", onError);
        client.release();
      }
      recomputed += addresses.length;
      if (pacer !== undefined && (await pacer.afterUnit(Date.now() - startedAt)) === "abort") {
        abortedForIngestion = true;
        break;
      }
      // `recomputeAddresses` assigns a non-NULL count for every address it is given, so the
      // predicate above cannot re-select them and the loop terminates. A row it deletes (balance
      // resolved to zero) leaves the set the same way.
      if (addresses.length < recomputeChunk) break;
    }
  }

  const { rows: left } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM chain_address_balance WHERE tx_count IS NULL",
  );
  return {
    filled,
    recomputed,
    batches,
    remaining: Number(left[0]?.n ?? "0"),
    abortedForIngestion,
    retries,
  };
}

/**
 * Operator-initiated, never automatic on success: "the job finished" and "I have verified the
 * result" are different states, and the accumulator is the only evidence for the reconciliation
 * below.
 */
export async function reconcileStaging(
  pool: Pool,
): Promise<{ disagreements: number; notYetApplied: number; zeroCounts: number }> {
  // `disagreements` counts only rows that have a count. Before the apply every staged row is still
  // NULL, so comparing all joined rows would report a disagreement per address and make the figure
  // meaningless after a real apply.
  const { rows } = await pool.query<{
    disagreements: string;
    not_yet_applied: string;
    zero_counts: string;
  }>(
    `SELECT (SELECT count(*)::text FROM chain_address_balance b
               JOIN tx_count_backfill s USING (address)
              WHERE b.tx_count IS NOT NULL
                AND b.tx_count IS DISTINCT FROM s.n
                AND b.last_height <= (SELECT h_target FROM tx_count_backfill_state WHERE id))
              AS disagreements,
            (SELECT count(*)::text FROM chain_address_balance b
               JOIN tx_count_backfill s USING (address)
              WHERE b.tx_count IS NULL
                AND b.last_height <= (SELECT h_target FROM tx_count_backfill_state WHERE id))
              AS not_yet_applied,
            (SELECT count(*)::text FROM chain_address_balance WHERE tx_count = 0) AS zero_counts`,
  );
  return {
    disagreements: Number(rows[0]?.disagreements ?? "0"),
    notYetApplied: Number(rows[0]?.not_yet_applied ?? "0"),
    // Impossible by construction: an address in this table has at least one transaction, so a 0
    // is a fabricated value rather than a measurement.
    zeroCounts: Number(rows[0]?.zero_counts ?? "0"),
  };
}

export async function dropStaging(pool: Pool): Promise<void> {
  await pool.query("DROP TABLE IF EXISTS tx_count_backfill");
  await pool.query("DROP TABLE IF EXISTS tx_count_backfill_state");
}
