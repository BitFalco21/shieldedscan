import { HttpNodeRpc } from "./node-rpc";
import { createPool } from "./pg-pool";
import { repairBlockMiner, type PayoutRow, type StoredMiner } from "./repair-block-miner";
import type { MinerFields } from "./repair-miner";
import { log, requirePostgres } from "./entrypoint";

/**
 * Rewrites one block's recorded miner from the current parser, an entrypoint in the follower's
 * image, run by hand and never on a timer:
 *
 *   docker run --rm --network <network> --env-file <db.env> \
 *     -e NODE_RPC_URL=http://<node>:8232 -e REPAIR_BLOCK_HASH=<hash> [-e REPAIR_COMMIT=1] \
 *     <follower-image> node repair-block-miner.mjs
 *
 * A dry run unless `REPAIR_COMMIT=1`: it makes the change and the day's recompute inside one
 * transaction, prints the row and the day's payout rows before and after, and rolls back.
 * One short transaction on one old row and one day's rollup rows; it does not touch the follower
 * and is safe beside it. Re-running after a commit reports the row unchanged.
 *
 * Env: PGHOST/DATABASE_URL (required), NODE_RPC_URL, REPAIR_BLOCK_HASH (required),
 * REPAIR_COMMIT=1 to commit.
 */

requirePostgres();

const hash = process.env.REPAIR_BLOCK_HASH ?? "";
const commit = process.env.REPAIR_COMMIT === "1";
const pool = createPool(process.env.DATABASE_URL, { max: 1 });
const rpc = new HttpNodeRpc(process.env.NODE_RPC_URL ?? "http://zakura:8232");

const miner = (m: Pick<StoredMiner, "kind" | "address"> & { rewardZat: number | null }) =>
  `${m.kind ?? "unrecorded"} ${m.address ?? "-"} reward ${m.rewardZat ?? "-"} zat`;
const payout = (p: PayoutRow) =>
  `  ${p.kind} ${p.address || "-"} blocks ${p.blocks} reward ${p.rewardZat ?? "NULL"} zat ` +
  `fees ${p.feeZat} zat (${p.feeBlocks} blocks)`;
const derivedMiner = (d: MinerFields) =>
  miner({ kind: d.kind, address: d.address, rewardZat: d.minerRewardZat });

try {
  const r = await repairBlockMiner({ pool, rpc, hash, commit });
  if (r.stored) log(`block ${r.stored.height} ${r.stored.hash}`);
  if (r.status === "refused") {
    log(`REFUSED: ${r.reason}; nothing changed`);
    process.exitCode = 1;
  } else if (r.status === "unchanged") {
    log(`stored miner already matches the parser: ${miner(r.stored)}; nothing to do`);
  } else {
    log(`before: ${miner(r.stored)}`);
    log(`after:  ${derivedMiner(r.derived)}`);
    if (r.day === null) log("no mining_day row for this block's day: no rollup to recompute");
    else {
      log(`${r.day.day} payout rows before:`);
      for (const p of r.day.before) log(payout(p));
      log(`${r.day.day} payout rows after:`);
      for (const p of r.day.after) log(payout(p));
    }
    log(
      r.committed
        ? "COMMITTED"
        : "dry run: rolled back, nothing changed (REPAIR_COMMIT=1 to commit)",
    );
  }
} catch (error) {
  log(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
