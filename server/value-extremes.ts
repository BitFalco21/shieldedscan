import type { Pool } from "pg";
import { rollbackQuietly } from "./pg-pool";
import { REORG_DEPTH } from "./follow";
import type { Pacer } from "./job-pacer";
import { nextChunkSpan, spanAfterTimeout } from "./tx-count-backfill";

/**
 * The highest and lowest transparent value any transaction has moved, computed online while the
 * follower keeps ingesting, without adding a column to a published table.
 *
 * Extrema and their tie counts combine exactly across disjoint height ranges:
 *
 *     global_min   = min(chunk_min)
 *     global_count = sum(chunk_min_count) over chunks whose chunk_min equals global_min
 *
 * A txid belongs to exactly one block, so no transaction is seen by two chunks. A walk therefore
 * keeps only a running extremum per chunk (a few hundred tiny rows) and never stores a
 * per-transaction value. That avoids an `ALTER TABLE tx` with a full backfill (dead tuples, disk
 * growth, and a NULL hole below the write head), and after the first pass staying current costs
 * only the new blocks, folded in by the same rule. Prefer this over a `tx.public_value_zat`
 * column.
 *
 * Each chunk writes one row for its own height range and first deletes any row overlapping that
 * range, so the accumulator never holds two rows covering one height and re-running any part of
 * the walk is a no-op. Keying on `height_lo` alone is not enough: spans move (`nextChunkSpan`
 * resizes them), so a resumed run re-tiles the same heights at different boundaries.
 */

/**
 * Scratch tables, deliberately not in `server/schema-chain.sql`: that file is re-applied on every
 * follower and backfiller boot, so a later `DROP` there would be a hazard.
 *
 * `UNLOGGED` skips WAL. A crash truncates both tables together, and `stageValueExtremes` refuses a
 * watermark above zero with an empty accumulator rather than resuming into a silent gap.
 */
export const VALUE_STAGING_DDL = `
CREATE UNLOGGED TABLE IF NOT EXISTS value_extremes_chunk (
  height_lo      INTEGER PRIMARY KEY,
  height_hi      INTEGER NOT NULL,
  lowest_zat     BIGINT  NOT NULL,
  lowest_count   BIGINT  NOT NULL,
  highest_zat    BIGINT  NOT NULL,
  highest_count  BIGINT  NOT NULL,
  highest_txid   TEXT    NOT NULL,
  highest_height INTEGER NOT NULL,
  considered     BIGINT  NOT NULL
);
CREATE UNLOGGED TABLE IF NOT EXISTS value_extremes_state (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  h_target       INTEGER NOT NULL,
  through_height INTEGER NOT NULL,
  started_at     BIGINT  NOT NULL
);
`;

export interface ValueStagingState {
  hTarget: number;
  throughHeight: number;
  startedAt: number;
}

export class ValueBackfillRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueBackfillRefused";
  }
}

export async function ensureValueStaging(pool: Pool): Promise<void> {
  await pool.query(VALUE_STAGING_DDL);
}

export async function readValueState(pool: Pool): Promise<ValueStagingState | null> {
  const { rows } = await pool.query<{
    h_target: number;
    through_height: number;
    started_at: string;
  }>("SELECT h_target, through_height, started_at FROM value_extremes_state");
  const row = rows[0];
  return row
    ? {
        hTarget: row.h_target,
        throughHeight: row.through_height,
        startedAt: Number(row.started_at),
      }
    : null;
}

export async function dropValueStaging(pool: Pool): Promise<void> {
  await pool.query("DROP TABLE IF EXISTS value_extremes_chunk, value_extremes_state");
}

/**
 * The transactions this measures, shared by the chunk query and its test.
 *
 * `kind` is read, never recomputed: it stores `classifyTxKind`'s output, so the judgement stays in
 * `domain/`. A fully shielded transaction has no public value (`publicValueZat` returns null), and
 * a coinbase is excluded because it creates value rather than moving it.
 */
const MEASURED_KINDS = "t.kind IN ('transparent', 'mixed')";

/**
 * The SQL transcription of `publicValueZat`, the one place this design duplicates a domain
 * function.
 *
 * `src/domain/value.ts`: outputs, falling back to inputs when the outputs sum to zero, null when
 * neither is positive. `value-extremes.test.ts` checks this against the domain function row by
 * row, because the fallback is the branch a naive transcription drops.
 *
 * `NULLIF(..., 0)` lets `COALESCE` express the fallback: a zero output total is treated as absent
 * so the input total is consulted, and a transaction with neither is NULL and excluded rather than
 * ranked as moving nothing.
 */
const PUBLIC_VALUE_SQL = `COALESCE(
  NULLIF(sum(i.value_zat) FILTER (WHERE i.io = 'out'), 0),
  NULLIF(sum(i.value_zat) FILTER (WHERE i.io = 'in'), 0)
)`;

export interface ValueStageOptions {
  pool: Pool;
  log?: (message: string) => void;
  pacer?: Pacer;
  chunk?: number;
  targetChunkMs?: number;
  adaptive?: boolean;
  chunks?: number;
  workMem?: string;
  statementTimeoutMs?: number;
  reorgMargin?: number;
}

export interface ValueStageResult {
  throughHeight: number;
  hTarget: number;
  chunksRun: number;
  complete: boolean;
  abortedForIngestion: boolean;
  timeouts: number;
}

/** The highest height it is safe to measure: below the reorg window, so nothing can be rewritten. */
export async function valueTargetHeight(pool: Pool, reorgMargin = REORG_DEPTH): Promise<number> {
  const { rows } = await pool.query<{ tip: number | null }>("SELECT max(height) AS tip FROM block");
  const tip = rows[0]?.tip ?? 0;
  return Math.max(0, tip - reorgMargin);
}

/**
 * Phase A: walk the chain in height order, recording each chunk's extrema.
 *
 * Height order because `tx_transparent_io` is append-only in block order, so a height range's rows
 * are physically clustered. Density varies roughly 45x along the chain, so the span adapts through
 * `nextChunkSpan` (shared with `tx-count-backfill.ts`).
 */
export async function stageValueExtremes({
  pool,
  log = () => {},
  pacer,
  chunk = 10_000,
  chunks,
  workMem = "256MB",
  statementTimeoutMs = 180_000,
  targetChunkMs = 20_000,
  adaptive = true,
  reorgMargin,
}: ValueStageOptions): Promise<ValueStageResult> {
  await ensureValueStaging(pool);

  const existing = await readValueState(pool);
  let hTarget = existing?.hTarget ?? (await valueTargetHeight(pool, reorgMargin ?? REORG_DEPTH));
  const { rows: minRows } = await pool.query<{ lo: number | null }>(
    "SELECT min(height) AS lo FROM block",
  );
  let from = minRows[0]?.lo ?? 0;

  if (existing !== null) {
    hTarget = existing.hTarget;
    from = existing.throughHeight + 1;
    // Both staging tables are unlogged, so a crash truncates them together. A watermark above the
    // start with nothing accumulated means exactly that, and resuming would silently narrow the
    // population the extremum is taken over.
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM value_extremes_chunk",
    );
    if (existing.throughHeight > (minRows[0]?.lo ?? 0) && rows[0]?.n === "0") {
      throw new ValueBackfillRefused(
        `the accumulator is empty but its watermark is at height ${existing.throughHeight}. ` +
          `An unlogged table was truncated by a crash. Reset with REPAIR_PHASE=cleanup and ` +
          `start again — resuming would leave a hole an extremum cannot survive.`,
      );
    }
    log(`resuming at height ${from} toward H ${hTarget}`);
  }

  if (pacer !== undefined) await pacer.preflight();

  let span = chunk;
  let chunksRun = 0;
  let abortedForIngestion = false;
  let timeouts = 0;

  while (from <= hTarget) {
    if (chunks !== undefined && chunksRun >= chunks) break;
    const to = Math.min(from + span - 1, hTarget);
    const startedAt = Date.now();
    let timedOut = false;

    const client = await pool.connect();
    const onError = (error: Error) => log(`value staging connection error: ${String(error)}`);
    client.on("error", onError);
    try {
      // Set on the connection and reset in `finally`, because it returns to a shared pool.
      await client.query(`SET work_mem = '${workMem}'`);
      await client.query(`SET statement_timeout = ${statementTimeoutMs}`);
      await client.query("BEGIN");

      /*
       * Clear any chunk whose range overlaps this one, before writing this one.
       *
       * `ON CONFLICT (height_lo)` alone makes a chunk idempotent only when re-run at the identical
       * span. Spans move (resized from the last chunk's rate, halved on a timeout), so a re-run
       * from a rewound watermark would tile the same heights at different boundaries and the fold
       * would count those transactions twice. This makes the invariant structural: no two rows
       * cover the same height.
       */
      await client.query(
        "DELETE FROM value_extremes_chunk WHERE height_lo <= $2 AND height_hi >= $1",
        [from, to],
      );

      /*
       * One chunk's extrema, in one statement.
       *
       * The inner aggregate produces one row per transaction; `b` takes the chunk's bounds; the
       * outer aggregate counts how many sit on each bound and picks an identifier for the maximum.
       * `min(txid)` is arbitrary among ties and only used when the count is 1.
       *
       * Only `t.block_height` is filtered, never `i.block_height`: they are equal by construction
       * (`#writeTransparentIo` stamps one height per block), and the redundant predicate collapses
       * the planner's row estimate so the chosen sort spills.
       */
      await client.query(
        `WITH v AS (
           SELECT t.txid, t.block_height, ${PUBLIC_VALUE_SQL} AS value_zat
             FROM tx t
             JOIN tx_transparent_io i ON i.txid = t.txid
            WHERE t.block_height BETWEEN $1 AND $2
              AND ${MEASURED_KINDS}
            GROUP BY t.txid, t.block_height
         ),
         priced AS (SELECT * FROM v WHERE value_zat IS NOT NULL),
         b AS (SELECT min(value_zat) AS lo, max(value_zat) AS hi FROM priced)
         INSERT INTO value_extremes_chunk
                (height_lo, height_hi, lowest_zat, lowest_count,
                 highest_zat, highest_count, highest_txid, highest_height, considered)
         SELECT $1, $2, b.lo,
                count(*) FILTER (WHERE p.value_zat = b.lo),
                b.hi,
                count(*) FILTER (WHERE p.value_zat = b.hi),
                min(p.txid) FILTER (WHERE p.value_zat = b.hi),
                min(p.block_height) FILTER (WHERE p.value_zat = b.hi),
                count(*)
           FROM priced p CROSS JOIN b
          GROUP BY b.lo, b.hi
         ON CONFLICT (height_lo) DO UPDATE SET
                height_hi      = EXCLUDED.height_hi,
                lowest_zat     = EXCLUDED.lowest_zat,
                lowest_count   = EXCLUDED.lowest_count,
                highest_zat    = EXCLUDED.highest_zat,
                highest_count  = EXCLUDED.highest_count,
                highest_txid   = EXCLUDED.highest_txid,
                highest_height = EXCLUDED.highest_height,
                considered     = EXCLUDED.considered`,
        [from, to],
      );

      await client.query(
        `INSERT INTO value_extremes_state (id, h_target, through_height, started_at)
         VALUES (TRUE, $1, $2, EXTRACT(EPOCH FROM now())::bigint)
         ON CONFLICT (id) DO UPDATE SET through_height = EXCLUDED.through_height`,
        [hTarget, to],
      );
      await client.query("COMMIT");
    } catch (error) {
      await rollbackQuietly(client);
      // 57014 is `statement_timeout`. A span too large for this stretch of chain is retried
      // smaller rather than counted as progress; anything else is a real failure.
      if ((error as { code?: string }).code === "57014") {
        const smaller = spanAfterTimeout(span);
        if (smaller === null) throw error;
        timedOut = true;
        timeouts += 1;
        span = smaller;
        log(`chunk ${from}-${to} timed out; retrying at span ${span}`);
      } else {
        throw error;
      }
    } finally {
      await client.query("RESET work_mem").catch(() => {});
      await client.query("RESET statement_timeout").catch(() => {});
      client.removeListener("error", onError);
      client.release();
    }

    const workedMs = Date.now() - startedAt;
    if (!timedOut) {
      from = to + 1;
      chunksRun += 1;
      if (adaptive) span = nextChunkSpan(span, workedMs, targetChunkMs);
    }

    if (pacer !== undefined) {
      const verdict = await pacer.afterUnit(workedMs);
      if (verdict === "abort") {
        abortedForIngestion = true;
        log("aborting for ingestion pressure — this is a resumable pause, not a failure");
        break;
      }
    }
  }

  const state = await readValueState(pool);
  const throughHeight = state?.throughHeight ?? 0;
  return {
    throughHeight,
    hTarget,
    chunksRun,
    complete: throughHeight >= hTarget,
    abortedForIngestion,
    timeouts,
  };
}

/**
 * Phase B: fold every chunk into the one published row.
 *
 * Exact: the minimum of the chunk minima is the global minimum, and summing the tie counts of the
 * chunks that hold it gives the global tie count. The identifier is meaningful only when
 * `highest_count` is 1, which the consumer checks.
 *
 * `covered_through_height` travels with the figures because an extremum over part of the chain
 * may be the wrong row entirely; the route refuses to serve until it reaches the target. Coverage
 * comes from the watermark, never `max(height_hi)`: a chunk with no priced transaction writes no
 * row, so the highest boundary is not how far the walk reached.
 */
export async function foldValueExtremes(pool: Pool): Promise<void> {
  await pool.query(
    `WITH g AS (
       SELECT min(lowest_zat) AS lo, max(highest_zat) AS hi,
              sum(considered)::bigint AS considered,
              (SELECT through_height FROM value_extremes_state) AS through
         FROM value_extremes_chunk
     )
     INSERT INTO chain_value_extremes
            (scope, lowest_zat, lowest_count, highest_zat, highest_count,
             highest_txid, highest_height, considered, covered_through_height, updated_at)
     SELECT 'transaction', g.lo,
            (SELECT sum(lowest_count)::bigint FROM value_extremes_chunk WHERE lowest_zat = g.lo),
            g.hi,
            (SELECT sum(highest_count)::bigint FROM value_extremes_chunk WHERE highest_zat = g.hi),
            (SELECT min(highest_txid) FROM value_extremes_chunk WHERE highest_zat = g.hi),
            (SELECT min(highest_height) FROM value_extremes_chunk WHERE highest_zat = g.hi),
            g.considered, g.through, EXTRACT(EPOCH FROM now())::bigint
       FROM g
      WHERE g.lo IS NOT NULL
     ON CONFLICT (scope) DO UPDATE SET
            lowest_zat             = EXCLUDED.lowest_zat,
            lowest_count           = EXCLUDED.lowest_count,
            highest_zat            = EXCLUDED.highest_zat,
            highest_count          = EXCLUDED.highest_count,
            highest_txid           = EXCLUDED.highest_txid,
            highest_height         = EXCLUDED.highest_height,
            considered             = EXCLUDED.considered,
            covered_through_height = EXCLUDED.covered_through_height,
            updated_at             = EXCLUDED.updated_at`,
  );
}
