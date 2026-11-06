import type { Pool } from "pg";
import { DAY_SECONDS } from "@/domain/time";
import { writeMiningDay } from "./mining-daily";
import { rollbackQuietly } from "./pg-pool";
import { readMinerFields, type MinerFields, type MinerRpc } from "./repair-miner";

/**
 * Rewrite one block's recorded miner from the parser's current rule, keyed on the block's hash.
 *
 * For a row the parser once got wrong, which `repair-miner` cannot reach: that job fills only
 * `miner_kind IS NULL` rows and leaves filled ones alone by design. This touches exactly one
 * row's `miner_kind`, `miner_address` and `miner_reward_zat`, and recomputes that block's UTC day
 * in `mining_day` / `mining_day_payout` in the same transaction, so the day can never disagree
 * with its block. Everything else that reads these columns (the blocks list, `/v1`, the open
 * dataset) reads them on demand.
 *
 * Refuses rather than guesses: a hash with no stored row, a row the miner repair has not filled,
 * a node that cannot answer for this exact hash, or a coinbase tag that differs from the stored
 * one (a sign the row and the node disagree about the block). The UPDATE also requires the old
 * values, so a concurrent writer wins and the run reports it changed nothing.
 */

export interface StoredMiner {
  height: number;
  hash: string;
  timestamp: number;
  kind: MinerFields["kind"] | null;
  address: string | null;
  rewardZat: number | null;
  coinbaseTag: string | null;
}

export interface PayoutRow {
  kind: string;
  address: string;
  blocks: number;
  rewardZat: string | null;
  feeZat: string;
  feeBlocks: number;
}

export type RepairBlockMinerResult =
  | { status: "refused"; reason: string; stored: StoredMiner | null }
  | { status: "unchanged"; stored: StoredMiner }
  | {
      status: "rewritten";
      committed: boolean;
      stored: StoredMiner;
      derived: MinerFields;
      /** The day's payout rows before and after, or null when the tracker never computed it. */
      day: { day: string; before: PayoutRow[]; after: PayoutRow[] } | null;
    };

const sameMiner = (s: StoredMiner, d: MinerFields) =>
  s.kind === d.kind && s.address === d.address && s.rewardZat === d.minerRewardZat;

/** `YYYY-MM-DD` of a UTC midnight in unix seconds. */
const dayOf = (dayStart: number) => new Date(dayStart * 1000).toISOString().slice(0, 10);

export async function repairBlockMiner(deps: {
  pool: Pool;
  rpc: MinerRpc;
  hash: string;
  commit: boolean;
  nowSec?: number;
}): Promise<RepairBlockMinerResult> {
  const { pool, rpc, hash, commit } = deps;
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return { status: "refused", reason: "not a block hash", stored: null };
  }
  const { rows } = await pool.query<{
    height: number;
    hash: string;
    timestamp: string;
    miner_kind: MinerFields["kind"] | null;
    miner_address: string | null;
    miner_reward_zat: string | null;
    coinbase_tag: string | null;
  }>(
    `SELECT height, hash, timestamp::text AS timestamp, miner_kind, miner_address,
            miner_reward_zat::text AS miner_reward_zat, coinbase_tag
       FROM block WHERE hash = $1`,
    [hash],
  );
  const r = rows[0];
  if (r === undefined)
    return { status: "refused", reason: "no stored block has this hash", stored: null };
  const stored: StoredMiner = {
    height: r.height,
    hash: r.hash,
    timestamp: Number(r.timestamp),
    kind: r.miner_kind,
    address: r.miner_address,
    rewardZat: r.miner_reward_zat === null ? null : Number(r.miner_reward_zat),
    coinbaseTag: r.coinbase_tag,
  };
  if (stored.kind === null) {
    return { status: "refused", reason: "the row has no miner yet: repair-miner fills it", stored };
  }

  const { fields, failed } = await readMinerFields(rpc, { height: stored.height, hash });
  if (fields === null) {
    const reason = failed
      ? "the node did not answer for this hash"
      : "the node's block does not match the stored row";
    return { status: "refused", reason, stored };
  }
  if (fields.coinbaseTag !== stored.coinbaseTag) {
    return {
      status: "refused",
      reason: "the node's coinbase tag differs from the stored one",
      stored,
    };
  }
  if (sameMiner(stored, fields)) return { status: "unchanged", stored };

  const dayStart = Math.floor(stored.timestamp / DAY_SECONDS) * DAY_SECONDS;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE block SET miner_kind = $3, miner_address = $4, miner_reward_zat = $5
        WHERE hash = $1 AND height = $2
          AND miner_kind IS NOT DISTINCT FROM $6 AND miner_address IS NOT DISTINCT FROM $7
          AND miner_reward_zat IS NOT DISTINCT FROM $8::bigint`,
      [
        hash,
        stored.height,
        fields.kind,
        fields.address,
        fields.minerRewardZat,
        stored.kind,
        stored.address,
        stored.rewardZat,
      ],
    );
    if (updated.rowCount !== 1) {
      await rollbackQuietly(client);
      return { status: "refused", reason: "the row changed while this ran", stored };
    }
    const payouts = async () =>
      (
        await client.query<PayoutRow>(
          `SELECT kind, address, blocks, reward_zat::text AS "rewardZat",
                  fee_zat::text AS "feeZat", fee_blocks AS "feeBlocks"
             FROM mining_day_payout
            WHERE day = (to_timestamp($1) AT TIME ZONE 'UTC')::date
            ORDER BY kind, address`,
          [dayStart],
        )
      ).rows;
    // The tracker runs on mainnet only: no row for the day means there is nothing to recompute.
    const tracked = await client.query(
      "SELECT 1 FROM mining_day WHERE day = (to_timestamp($1) AT TIME ZONE 'UTC')::date",
      [dayStart],
    );
    let day: { day: string; before: PayoutRow[]; after: PayoutRow[] } | null = null;
    if ((tracked.rowCount ?? 0) > 0) {
      const before = await payouts();
      await writeMiningDay(client, dayStart, deps.nowSec ?? Math.floor(Date.now() / 1000));
      day = { day: dayOf(dayStart), before, after: await payouts() };
    }
    if (commit) await client.query("COMMIT");
    else await rollbackQuietly(client);
    return { status: "rewritten", committed: commit, stored, derived: fields, day };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}
