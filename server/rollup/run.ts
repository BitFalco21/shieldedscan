import type { Pool, PoolClient } from "pg";
import { rollbackQuietly } from "../pg-pool";
import { ROLLUP_PASS_LOCK, withSessionLock } from "./lock";
import {
  applyMarks,
  beginRollupTransaction,
  describeWork,
  monthEnd,
  monthStart,
  recomputeMonth,
  recomputeTotals,
  recomputeWholeMonth,
  rowsWritten,
  sourceExtent,
  type WorkLog,
} from "./pass";
import { ROLLUP_TABLES } from "./definitions";
import { resolveTargets, type RollupTargets } from "./targets";

/**
 * The rollup operations, each one transaction under `ROLLUP_PASS_LOCK`.
 *
 * The lock is a session lock taken before the transaction's snapshot and released after its
 * commit (`withSessionLock`), so whoever holds it next sees everything the previous holder wrote:
 * a pass, a fill chunk and the swap can interleave but never overwrite newer rows with older.
 */

type Log = (line: string) => void;

/** Default time a pass may spend before leaving older months for the next one. */
export const DEFAULT_PASS_BUDGET_MS = 60_000;

async function inRollupTransaction<T>(
  client: PoolClient,
  log: Log,
  work: (targets: RollupTargets) => Promise<T>,
): Promise<T | null> {
  await beginRollupTransaction(client);
  try {
    const resolution = await resolveTargets(client);
    if (!resolution.ok) {
      await rollbackQuietly(client);
      log(`rollups SKIPPED — no table for ${resolution.missing.join(", ")}; marks kept`);
      return null;
    }
    const result = await work(resolution.targets);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

/**
 * The follower's periodic pass: recompute every period the dirty-period log names.
 *
 * Returns the rows written, or null when it did not run (another writer holds the lock, or the
 * tables are missing). A pass with nothing marked costs two catalogue reads and an empty DELETE.
 */
export async function runRollupPass(
  pool: Pool,
  log: Log,
  budgetMs = DEFAULT_PASS_BUDGET_MS,
): Promise<number | null> {
  const locked = await withSessionLock(pool, ROLLUP_PASS_LOCK, {}, async (client) => ({
    result: await inRollupTransaction(client, log, (targets) =>
      applyMarks(client, targets, budgetMs),
    ),
  }));
  if (locked === null) {
    log("rollups SKIPPED — another rollup writer holds the lock");
    return null;
  }
  const { result } = locked;
  if (result === null) return null;
  if (result.months > 0) {
    log(
      `rollups: ${result.days} day(s) in ${result.months} month(s)` +
        (result.deferredMonths > 0
          ? `, ${result.deferredMonths} month(s) deferred to the next pass`
          : "") +
        ` — ${describeWork(result.work)}`,
    );
  }
  return rowsWritten(result.work);
}

/**
 * Recompute one whole UTC month of every rollup table, then the totals; one chunk of the paced
 * fill. Waits for the lock, so the follower's pass runs between chunks, never during one.
 *
 * `afterWork` runs inside the chunk's transaction, so the fill's resume point commits with it.
 */
export async function recomputeMonthChunk(
  pool: Pool,
  month: number,
  log: Log,
  afterWork: (client: PoolClient) => Promise<void> = async () => {},
): Promise<WorkLog | null> {
  return withSessionLock(pool, ROLLUP_PASS_LOCK, { wait: true }, (client) =>
    inRollupTransaction(client, log, async (targets) => {
      const work: WorkLog = new Map();
      await recomputeWholeMonth(client, targets, month, work);
      await afterWork(client);
      return work;
    }),
  );
}

/**
 * Rebuild every rollup from scratch in one transaction: empties every table, drops the marks this
 * snapshot covers, and recomputes each month from the first source row to the last.
 *
 * Unpaced, so only for a database nothing reads yet (self-host derive) and for tests. Production
 * rebuilds with the paced `fill-rollups` job.
 */
export async function rebuildRollups(pool: Pool, log: Log = () => {}): Promise<WorkLog | null> {
  return withSessionLock(pool, ROLLUP_PASS_LOCK, { wait: true }, (client) =>
    inRollupTransaction(client, log, async (targets) => {
      for (const table of ROLLUP_TABLES) {
        await client.query(`DELETE FROM ${targets.get(table.name) ?? table.name}`);
      }
      await client.query("DELETE FROM chain_rollup_dirty");
      const work: WorkLog = new Map();
      const extent = await sourceExtent(client);
      if (extent !== null) {
        for (let m = monthStart(extent.lo); m <= extent.hi; m = monthEnd(m)) {
          await recomputeMonth(client, targets, m, [[m, monthEnd(m)]], work);
        }
      }
      await recomputeTotals(client, targets, work);
      return work;
    }),
  );
}
