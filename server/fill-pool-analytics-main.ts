/**
 * The first fill of the per-pool day matviews, and the measurement that sizes their schedule.
 *
 * `REFRESH MATERIALIZED VIEW` is a single statement that cannot be chunked or paced mid-flight;
 * what can be controlled is whether it starts. This refuses to start against a follower that is
 * already behind, runs one pass, and prints how long it took. `preflight()` throws rather than
 * blocks: a non-zero exit saying ingestion was behind is a correct outcome; run it again later.
 *
 * Ingestion must never be paused, and "takes no exclusive lock" is not sufficient: even read-only
 * load can push the follower behind.
 *
 * This is the only thing that populates a never-filled view. The follower's hourly
 * `refreshPoolAnalytics` skips an unpopulated view and names it, so the exclusive lock of a first
 * fill only happens here, behind the preflight. A view added to the schema stays visibly empty
 * until this runs.
 *
 *   npm run fill:pool-analytics
 */
import { hostPacer } from "./job-pacer";
import { PostgresChainStore } from "./postgres-chain-store";
import { createPool } from "./pg-pool";
import { log } from "./entrypoint";

/**
 * The gate, in seconds. Above it an hourly full refresh is the wrong shape: a pass that outlives
 * its interval overlaps the next, every overlap competes for the same disk, and it does not
 * converge.
 */
const HOURLY_REFRESH_GATE_SECONDS = 120;

const NODE_RPC_URL = process.env.NODE_RPC_URL ?? "http://zakura:8232";

async function main(): Promise<void> {
  const pool = createPool(process.env.DATABASE_URL, { max: 2 });
  const store = new PostgresChainStore(pool);

  // The stall signal must be how far the follower is behind the node: "time since the last block"
  // cannot tell a stalled follower from a quiet chain.
  const pacer = hostPacer(pool, NODE_RPC_URL, log);

  log("preflight — refusing to start if ingestion is already behind");
  await pacer.preflight();

  const startedAt = Date.now();
  const pass = await store.fillPoolAnalytics(log);
  const seconds = (Date.now() - startedAt) / 1000;

  log(`filled ${pass.rows} rows across ${pass.refreshed.length} view(s) in ${seconds.toFixed(1)}s`);
  log(
    seconds > HOURLY_REFRESH_GATE_SECONDS
      ? `OVER the ${HOURLY_REFRESH_GATE_SECONDS}s gate — do NOT schedule hourly; take the incremental fallback`
      : `within the ${HOURLY_REFRESH_GATE_SECONDS}s gate — an hourly full refresh is the right shape`,
  );
  await pool.end();
}

void main();
