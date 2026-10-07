import { hostPacer } from "./job-pacer";
import { HttpNodeRpc } from "./node-rpc";
import { createPool } from "./pg-pool";
import { repairMiner, verifyMinerFields } from "./repair-miner";
import { log, envNumber, requirePostgres } from "./entrypoint";

/**
 * The miner-field repair, an entrypoint in the follower's image:
 *
 *   docker run --rm --network <network> --env-file <db.env> \
 *     -e NODE_RPC_URL=http://<node>:8232 -e REPAIR_PHASE=verify \
 *     <follower-image> node repair-miner.mjs
 *
 * `--rm` and no restart policy: this job finishes. Run it with the follower running; it paces
 * itself against ingestion and stops rather than push through a stall. Safe to kill and re-run:
 * the remaining work is always `miner_kind IS NULL`.
 *
 * Phases, in the order to run them:
 *
 *   `REPAIR_PHASE=status`  read-only: rows still to fill.
 *   `REPAIR_PHASE=verify`  read-only: derive the fields for rows the follower filled and compare,
 *                          across eras, before writing anything. Any mismatch is a stop.
 *   `REPAIR_PHASE=fill`    the repair, paced. `REPAIR_END` bounds a first run.
 *   `REPAIR_PHASE=check`   read-only, after filling: compare a random sample of filled
 *                          transparent miners with the largest coinbase output in our own index,
 *                          an independent derivation used as a check, never as a source.
 *
 * It applies no schema.
 *
 * Env: PGHOST/DATABASE_URL (required), NODE_RPC_URL, REPAIR_PHASE, REPAIR_END, REPAIR_BATCH,
 * REPAIR_CONCURRENCY, REPAIR_DUTY, REPAIR_STALL_BLOCKS, REPAIR_SAMPLE.
 */

const PHASE = process.env.REPAIR_PHASE ?? "status";
const NODE_RPC_URL = process.env.NODE_RPC_URL ?? "http://zakura:8232";

requirePostgres();

const pool = createPool(process.env.DATABASE_URL);
const rpc = new HttpNodeRpc(NODE_RPC_URL);
const startedAt = Date.now();
const minutes = () => ((Date.now() - startedAt) / 60000).toFixed(1);

async function remaining(): Promise<string> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM block WHERE miner_kind IS NULL",
  );
  return rows[0]?.n ?? "?";
}

try {
  if (PHASE === "status") {
    log(`rows with no miner: ${await remaining()}`);
  } else if (PHASE === "verify") {
    // A spread of follower-filled heights: uniform steps to the tip, the first rows above the
    // hole, and a random set of shielded coinbases (ZIP 213), the case most easily got wrong.
    const sample = envNumber("REPAIR_SAMPLE") ?? 2000;
    const { rows } = await pool.query<{ height: number }>(
      `WITH bounds AS (SELECT min(height) AS lo, max(height) AS hi FROM block
                        WHERE miner_kind IS NOT NULL)
       SELECT DISTINCT height FROM (
         SELECT (lo::bigint + (hi - lo)::bigint * g / $1)::int AS height
           FROM bounds, generate_series(0, $1) AS g
         UNION ALL
         SELECT height FROM block, bounds WHERE height BETWEEN lo AND lo + 200
         UNION ALL
         (SELECT height FROM block WHERE miner_kind = 'shielded' ORDER BY random() LIMIT 300)
       ) s ORDER BY height`,
      [sample],
    );
    const result = await verifyMinerFields({
      pool,
      rpc,
      heights: rows.map((r) => r.height),
      concurrency: envNumber("REPAIR_CONCURRENCY") ?? 4,
    });
    log(
      `verify: ${result.checked} rows compared, ${result.mismatches.length} mismatching fields, ` +
        `${result.failed} unreadable`,
    );
    for (const m of result.mismatches.slice(0, 20)) log(`  MISMATCH ${JSON.stringify(m)}`);
    if (result.mismatches.length > 0 || result.checked === 0) process.exitCode = 2;
  } else if (PHASE === "fill") {
    log(`miner repair starting against ${NODE_RPC_URL}: ${await remaining()} rows to fill`);
    const pacer = hostPacer(pool, NODE_RPC_URL, log, {
      duty: envNumber("REPAIR_DUTY") ?? 0.5,
      stallBlocks: envNumber("REPAIR_STALL_BLOCKS") ?? 5,
    });
    const result = await repairMiner({
      pool,
      rpc,
      pacer,
      log,
      ...(envNumber("REPAIR_BATCH") !== undefined ? { batch: envNumber("REPAIR_BATCH")! } : {}),
      ...(envNumber("REPAIR_CONCURRENCY") !== undefined
        ? { concurrency: envNumber("REPAIR_CONCURRENCY")! }
        : {}),
      ...(envNumber("REPAIR_END") !== undefined ? { end: envNumber("REPAIR_END")! } : {}),
    });
    log(
      `done in ${minutes()} min: ${result.written} written, ${result.scanned} scanned, ` +
        `${result.refused} refused, ${result.failed} failed` +
        (result.aborted ? " — STOPPED early; re-run to continue" : ""),
    );
    log(
      `pacer: slept ${Math.round(pacer.stats.sleptMs / 1000)} s, worst lag ` +
        `${pacer.stats.maxBlocksBehind} blocks`,
    );
    // Report what is still missing, not only what was done: "nothing to do" and "skipped
    // everything" both print "0 written".
    log(`rows with no miner: ${await remaining()}`);
  } else if (PHASE === "check") {
    const sample = envNumber("REPAIR_SAMPLE") ?? 5000;
    // Equal when the stored miner is among the largest outputs: some early coinbases split the
    // reward equally across several addresses, where the parser names the first.
    const { rows } = await pool.query<{ compared: string; equal: string; tied: string }>(
      `WITH s AS (SELECT height, miner_address FROM block
                   WHERE height < 1463800 AND miner_kind = 'transparent'
                   ORDER BY random() LIMIT $1),
            outs AS (SELECT t.block_height AS height, io.address, io.value_zat,
                            max(io.value_zat) OVER (PARTITION BY t.block_height) AS mx
                       FROM s JOIN tx t ON t.block_height = s.height AND t.kind = 'coinbase'
                       JOIN tx_transparent_io io ON io.txid = t.txid AND io.io = 'out'),
            top AS (SELECT height, array_agg(address) AS addresses, count(*) AS n
                      FROM outs WHERE value_zat = mx GROUP BY height)
       SELECT count(*)::text AS compared,
              count(*) FILTER (WHERE s.miner_address = ANY(top.addresses))::text AS equal,
              count(*) FILTER (WHERE top.n > 1)::text AS tied
         FROM s JOIN top ON top.height = s.height`,
      [sample],
    );
    log(
      `check: ${rows[0]?.equal ?? "?"} of ${rows[0]?.compared ?? "?"} sampled miners are the ` +
        `largest coinbase output in the index (${rows[0]?.tied ?? "?"} of them tied for largest)`,
    );
    log(`rows with no miner: ${await remaining()}`);
  } else {
    throw new Error(`unknown REPAIR_PHASE ${PHASE}: status | verify | fill | check`);
  }
} catch (error) {
  log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
