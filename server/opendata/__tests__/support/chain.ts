import { rebuildRollups } from "../../../rollup/run";
import { Pool, type Client } from "pg";
import { base58checkEncode } from "@/domain/encoding/base58check";
import { blockSubsidyZat } from "@/domain/halving";
import { computeBoundaryDay, upsertBoundaryDay } from "../../../boundary-daily";
import { computeMiningDay } from "../../../mining-daily";
import { CONFIRMATIONS } from "../../read";

/**
 * A small chain whose numbers agree with each other, as the follower and the API's trackers would
 * have written it: the export suites read it, and the self-host import is held to it.
 */

export const TIP = 299;
export const RELEASE = TIP - CONFIRMATIONS;
export const START = 1_477_612_800; // 2016-10-28 00:00 UTC
export const SPACING = 6 * 3600; // four blocks a day, so the chain spans 75 days
export const hex = (n: number) => n.toString(16).padStart(64, "0");
export const dayOf = (h: number) =>
  new Date((START + h * SPACING) * 1000).toISOString().slice(0, 10);
/** A well-formed mainnet P2PKH address (prefix 1cb8), so the payout address check passes. */
export const MINER = base58checkEncode(
  Uint8Array.from([0x1c, 0xb8, ...new Array<number>(20).fill(7)]),
);
/** One Sapling-to-Orchard migration of 500 zat, so the migration series have a row. */
export const MIGRATION_HEIGHT = 130;
/** Every matview the export reads, refreshed as the follower would. */

/** Fills an empty database that has the schema applied; `url` is that database's. */
export async function seedChain(db: Client, url: URL): Promise<void> {
  // A chain whose numbers agree with each other: Sapling starts reporting at 100 and its flow
  // equals its pool's change, and the pools together hold exactly the slow-start subsidy so far.
  let issued = 0n;
  for (let h = 0; h <= TIP; h++) {
    const sapling = h >= 100 ? BigInt((h - 100) * 1000) : null;
    issued += BigInt(blockSubsidyZat(h));
    await db.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count,
         transparent_tx_count, mixed_tx_count, shielded_tx_count, total_fee_zat,
         sapling_flow_zat, orchard_flow_zat, transparent_pool_zat, sapling_pool_zat,
         difficulty, miner_kind, miner_address, coinbase_tag, miner_reward_zat)
       VALUES ($1,$2,$3,$4,1000,2,0,1,0,0,$5,0,$6,$7,1.5,'transparent','t1secret','tag',100)`,
      [
        h,
        hex(h + 1),
        h === 0 ? hex(0) : hex(h),
        START + h * SPACING,
        h > 100 ? 1000 : 0,
        issued - (sapling ?? 0n),
        sapling,
      ],
    );
  }
  await db.query(
    `INSERT INTO chain_sync_state (id, tip_height, tip_hash, updated_at) VALUES (true, $1, $2, $3)`,
    [TIP, hex(TIP + 1), START + (TIP + 8) * SPACING],
  );
  for (let d = 0; d < 75; d++) {
    const day = dayOf(d * 4);
    await db.query(
      `INSERT INTO pool_usage_daily (day, pool, txs, fully_shielded, mixed, shielding, unshielding,
         indeterminate, coinbase, close_height, computed_at)
       VALUES ($1, 'sapling', 5, 1, 4, 2, 1, 1, 0, $2, 0)`,
      [day, d * 4 + 3],
    );
  }
  await db.query(
    `INSERT INTO net_release_day (day, user_agent, protocol_version, nodes, behind_tip, tip_unknown) VALUES
       ($1, '/Zakura:1.7.0/', 170190, 50, 1, 0),
       ($1, '/visit-my-site.example:1.2.3.4/', 170190, 1, 0, 0),
       ($1, '/Zebra:7.0.0-mybanner/', 170190, 3, 0, 0)`,
    [dayOf(200)],
  );
  await db.query(
    `INSERT INTO reorg_event (detected_at, height, depth, orphaned_hash, replaced_by) VALUES (0, 150, 1, $1, $2)`,
    [hex(77), hex(78)],
  );
  // Each block holds what it says: a coinbase and one mixed transaction with a zero fee that
  // carries the block's Sapling flow, shielding and unshielding in turn.
  await db.query(
    `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, version, size_bytes, kind, direction, fee_zat,
                     sapling_spends, sapling_outputs, sapling_value_balance_zat)
     SELECT lpad(to_hex(1000000 + h * 2 + k), 64, '0'), h, $1 + h * $2, k = 0, 5, 300,
            CASE WHEN k = 0 THEN 'coinbase' ELSE 'mixed' END,
            CASE WHEN k = 0 THEN NULL WHEN h % 2 = 0 THEN 'shielding' ELSE 'unshielding' END,
            CASE WHEN k = 0 THEN NULL ELSE 0 END,
            CASE WHEN k = 1 AND h > 100 THEN 0 END, CASE WHEN k = 1 AND h > 100 THEN 1 END,
            CASE WHEN k = 1 AND h > 100 THEN 1000 END
       FROM generate_series(0, $3::int) AS h, generate_series(0, 1) AS k`,
    [START, SPACING, TIP],
  );
  // The migration: Sapling gives 500 to Orchard at one height, so each pool's balance and flow
  // still agree, and what exists is unchanged.
  await db.query(
    `UPDATE block SET sapling_pool_zat = sapling_pool_zat - 500, orchard_pool_zat = 500
      WHERE height >= $1`,
    [MIGRATION_HEIGHT],
  );
  await db.query(
    `UPDATE block SET sapling_flow_zat = 500, orchard_flow_zat = 500, tx_count = 3,
            shielded_tx_count = 1 WHERE height = $1`,
    [MIGRATION_HEIGHT],
  );
  await db.query(
    `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, version, size_bytes, kind, fee_zat,
                     sapling_spends, sapling_outputs, sapling_value_balance_zat, orchard_actions,
                     orchard_value_balance_zat)
     VALUES ($1, $2, $3, false, 5, 500, 'shielded', 0, 1, 0, -500, 1, 500)`,
    [hex(5000), MIGRATION_HEIGHT, START + MIGRATION_HEIGHT * SPACING],
  );
  await db.query("UPDATE block SET miner_address = $1", [MINER]);
  // The API's trackers, by their own functions, and the follower's rollups.
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  try {
    for (let d = 0; d < 75; d++) {
      const dayStart = START + d * 86_400;
      await upsertBoundaryDay(pool, await computeBoundaryDay(pool, dayStart), 0);
      await computeMiningDay(pool, dayStart, 0);
    }
    await rebuildRollups(pool);
  } finally {
    await pool.end();
  }
  await db.query(`UPDATE block SET coinbase_tag = 'Foundry Zcash Pool' WHERE height % 3 = 0`);
  // The transparent ledger that makes those numbers true: each coinbase pays exactly the
  // slow-start subsidy to one output, and from 101 the mixed transaction spends 1,000 zat of
  // the previous coinbase into Sapling.
  await db.query(
    `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, script_type, block_height)
     SELECT lpad(to_hex(1000000 + h * 2), 64, '0'), 'out', 0, 't1coinbase', 62500 * h, 'pubkeyhash', h
       FROM generate_series(0, $1::int) AS h`,
    [TIP],
  );
  await db.query(
    `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, script_type, prev_txid, prev_vout, block_height)
     SELECT lpad(to_hex(1000000 + h * 2 + 1), 64, '0'), 'in', 0, 't1coinbase', 1000, 'pubkeyhash',
            lpad(to_hex(1000000 + (h - 1) * 2), 64, '0'), 0, h
       FROM generate_series(101, $1::int) AS h`,
    [TIP],
  );
}
