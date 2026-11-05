/**
 * The full fill of the rollup tables, paced: every UTC month from the first block to the last, one
 * month per transaction.
 *
 *   node fill-rollups.mjs             fill, resuming where an earlier run stopped
 *   node fill-rollups.mjs --restart   rebuild everything from the first month
 *
 * What it is for: the first fill of the `<name>_next` tables beside the old materialized views,
 * and a full rebuild afterwards (after a change made by hand, or to prove the tables from
 * scratch). Readers never see an empty table: each month is replaced in one transaction.
 *
 * Months after the last one at the start are not its business: every block ingested since the
 * tables were created marked its period, and the follower's pass recomputes those.
 *
 * Each month waits for the rollup lock, so the follower's pass runs between months, never during
 * one, and neither can overwrite the other's newer rows. The pacer refuses to start against a
 * follower that is already behind and rests between months; an abort is a resumable pause.
 *
 * Env: PGHOST/DATABASE_URL (required), NODE_RPC_URL (the pacer's lag signal).
 */
import type { Pool } from "pg";
import { hostPacer } from "./job-pacer";
import { createPool } from "./pg-pool";
import { log, requirePostgres } from "./entrypoint";
import { describeWork, monthEnd, monthStart, sourceExtent } from "./rollup/pass";
import { recomputeMonthChunk } from "./rollup/run";

const NODE_RPC_URL = process.env.NODE_RPC_URL ?? "http://zakura:8232";

const monthLabel = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 7);

interface FillState {
  next: number;
  end: number;
  completed: boolean;
}

async function readState(pool: Pool): Promise<FillState | null> {
  const { rows } = await pool.query<{
    next_ts: string;
    end_ts: string;
    completed_at: string | null;
  }>("SELECT next_ts, end_ts, completed_at FROM chain_rollup_fill WHERE id = TRUE");
  const row = rows[0];
  if (row === undefined) return null;
  return {
    next: Number(row.next_ts),
    end: Number(row.end_ts),
    completed: row.completed_at !== null,
  };
}

async function startState(pool: Pool): Promise<FillState | null> {
  const extent = await sourceExtent(pool);
  if (extent === null) return null;
  const state = {
    next: monthStart(extent.lo),
    end: monthEnd(monthStart(extent.hi)),
    completed: false,
  };
  await pool.query(
    `INSERT INTO chain_rollup_fill (id, next_ts, end_ts, started_at, completed_at)
     VALUES (TRUE, $1, $2, EXTRACT(EPOCH FROM now())::bigint, NULL)
     ON CONFLICT (id) DO UPDATE SET next_ts = EXCLUDED.next_ts, end_ts = EXCLUDED.end_ts,
       started_at = EXCLUDED.started_at, completed_at = NULL`,
    [state.next, state.end],
  );
  return state;
}

async function main(): Promise<void> {
  requirePostgres();
  const restart = process.argv.includes("--restart");
  const pool = createPool(process.env.DATABASE_URL, { max: 2 });
  try {
    const pacer = hostPacer(pool, NODE_RPC_URL, log);
    log("preflight — refusing to start if ingestion is already behind");
    await pacer.preflight();

    let state = restart ? null : await readState(pool);
    if (state?.completed) {
      log("the fill is complete; `--restart` rebuilds everything from the first month");
      return;
    }
    state ??= await startState(pool);
    if (state === null) {
      log("no blocks: nothing to fill");
      return;
    }
    log(`filling ${monthLabel(state.next)} to ${monthLabel(state.end - 1)}`);

    const startedAt = Date.now();
    for (let month = state.next; month < state.end; month = monthEnd(month)) {
      const chunkStarted = Date.now();
      const next = monthEnd(month);
      const work = await recomputeMonthChunk(pool, month, log, async (client) => {
        await client.query("UPDATE chain_rollup_fill SET next_ts = $1 WHERE id = TRUE", [next]);
      });
      if (work === null) throw new Error("the rollup tables are missing; start the follower first");
      const ms = Date.now() - chunkStarted;
      log(`${monthLabel(month)} in ${ms}ms — ${describeWork(work)}`);
      if ((await pacer.afterUnit(ms)) === "abort") {
        log(`paused before ${monthLabel(next)}; run again to resume`);
        return;
      }
    }
    await pool.query(
      "UPDATE chain_rollup_fill SET completed_at = EXTRACT(EPOCH FROM now())::bigint WHERE id = TRUE",
    );
    const s = pacer.stats;
    log(
      `fill complete in ${Math.round((Date.now() - startedAt) / 1000)}s ` +
        `(rested ${Math.round(s.sleptMs / 1000)}s, worst lag ${s.maxBlocksBehind} block(s))`,
    );
  } catch (error) {
    log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
