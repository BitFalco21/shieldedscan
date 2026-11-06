import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  NU61_FIRST_TXID,
  NU61_HASH,
  NU61_MINER,
  NU61_MULTISIG,
  nu61Block,
} from "@/data/chain/__fixtures__/block-3146400";
import type { RpcBlockSummary, RpcTransaction } from "@/data/chain/rpc-types";
import { computeMiningDay } from "../mining-daily";
import { repairBlockMiner } from "../repair-block-miner";
import type { MinerRpc } from "../repair-miner";

/**
 * The one-block miner repair on a real Postgres: block 3,146,400 stored as the parser first
 * recorded it (the ZIP-271 multisig as miner, 78,750 ZEC as its reward), its day computed from
 * that, then rewritten from the node's answer.
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55435/postgres \
 *     npx vitest run server/__tests__/repair-block-miner-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_repair_block_miner_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const DAY_START = Date.UTC(2025, 10, 24) / 1000;
const { tx, ...header } = nu61Block;
const rpc: MinerRpc = {
  getBlockSummaryByHash: async (hash) => {
    if (hash !== NU61_HASH) throw new Error("unknown block");
    return { ...header, tx: [NU61_FIRST_TXID] } as RpcBlockSummary;
  },
  getRawTransaction: async () => tx[0] as RpcTransaction,
};

describeDb("repairBlockMiner", () => {
  let pool: Pool;

  const stored = async () =>
    (
      await pool.query<{ miner_address: string; miner_reward_zat: string; coinbase_tag: null }>(
        "SELECT miner_address, miner_reward_zat::text AS miner_reward_zat FROM block WHERE height = 3146400",
      )
    ).rows[0];
  const payouts = async () =>
    (
      await pool.query<{ address: string; blocks: number; reward: string }>(
        `SELECT address, blocks, reward_zat::text AS reward FROM mining_day_payout
          WHERE day = '2025-11-24' ORDER BY address`,
      )
    ).rows;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));
    const insert = (height: number, hash: string, ts: number, address: string, reward: number) =>
      pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count, total_fee_zat,
                            miner_kind, miner_address, coinbase_tag, difficulty, miner_reward_zat)
         VALUES ($1, $2, $3, $4, 1000, 1, 0, 'transparent', $5, NULL, 1, $6)`,
        [height, hash, "0".repeat(64), ts, address, reward],
      );
    // As first recorded, and a neighbour paid to the real miner on the same day.
    await insert(3_146_400, NU61_HASH, nu61Block.time, NU61_MULTISIG, 7_875_000_000_000);
    await insert(3_146_401, "ab".repeat(32), nu61Block.time + 75, NU61_MINER, 125_000_000);
    await computeMiningDay(pool, DAY_START, DAY_START + 2 * 86_400);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("shows the row and its day before and after in a dry run, and changes nothing", async () => {
    const r = await repairBlockMiner({ pool, rpc, hash: NU61_HASH, commit: false });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    expect(r.committed).toBe(false);
    expect(r.stored).toMatchObject({ address: NU61_MULTISIG, rewardZat: 7_875_000_000_000 });
    expect(r.derived).toMatchObject({
      kind: "transparent",
      address: NU61_MINER,
      minerRewardZat: 125_000_000,
    });
    expect(r.day?.day).toBe("2025-11-24");
    expect(r.day?.before.map((p) => [p.address, p.blocks, p.rewardZat])).toEqual([
      [NU61_MINER, 1, "125000000"],
      [NU61_MULTISIG, 1, "7875000000000"],
    ]);
    expect(r.day?.after.map((p) => [p.address, p.blocks, p.rewardZat])).toEqual([
      [NU61_MINER, 2, "250000000"],
    ]);
    expect(await stored()).toEqual({
      miner_address: NU61_MULTISIG,
      miner_reward_zat: "7875000000000",
    });
    expect((await payouts()).map((p) => p.address)).toEqual([NU61_MINER, NU61_MULTISIG]);
  });

  it("commits the row and the day together, then finds nothing to do", async () => {
    const r = await repairBlockMiner({ pool, rpc, hash: NU61_HASH, commit: true });
    expect(r).toMatchObject({ status: "rewritten", committed: true });
    expect(await stored()).toEqual({ miner_address: NU61_MINER, miner_reward_zat: "125000000" });
    expect(await payouts()).toEqual([{ address: NU61_MINER, blocks: 2, reward: "250000000" }]);
    const days = await pool.query("SELECT blocks FROM mining_day WHERE day = '2025-11-24'");
    expect(days.rows).toEqual([{ blocks: 2 }]);
    expect((await repairBlockMiner({ pool, rpc, hash: NU61_HASH, commit: true })).status).toBe(
      "unchanged",
    );
  });

  it("refuses a hash it has no row for, or one the node cannot answer", async () => {
    const missing = await repairBlockMiner({ pool, rpc, hash: "cd".repeat(32), commit: true });
    expect(missing).toMatchObject({ status: "refused", reason: "no stored block has this hash" });
    const unanswered = await repairBlockMiner({ pool, rpc, hash: "ab".repeat(32), commit: true });
    expect(unanswered).toMatchObject({ status: "refused" });
    expect(await repairBlockMiner({ pool, rpc, hash: "not-a-hash", commit: true })).toMatchObject({
      status: "refused",
      reason: "not a block hash",
    });
  });
});
