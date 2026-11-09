import { describe, expect, it } from "vitest";
import { BlockChecker, type BlockRow } from "../checks";

const row = (over: Partial<BlockRow>): BlockRow => ({
  height: 3_146_400,
  hash: "",
  prev_hash: "",
  timestamp: 1_764_014_202n,
  size_bytes: 1945,
  tx_count: 1,
  transparent_tx_count: 1,
  mixed_tx_count: 0,
  shielded_tx_count: 0,
  total_fee_zat: 0n,
  sapling_flow_zat: 0n,
  orchard_flow_zat: 0n,
  transparent_pool_zat: null,
  sprout_pool_zat: null,
  sapling_pool_zat: null,
  orchard_pool_zat: null,
  lockbox_pool_zat: null,
  ironwood_pool_zat: null,
  difficulty: null,
  miner_kind: "transparent",
  miner_reward_zat: 125_000_000n,
  ...over,
});

const alertsFor = (r: BlockRow) => {
  const checker = new BlockChecker();
  checker.push(r);
  return checker.alerts.list();
};

describe("BlockChecker: a miner reward above what the block could pay", () => {
  it("alerts on the NU6.1 disbursement recorded as the miner's reward", () => {
    expect(alertsFor(row({ miner_reward_zat: 7_875_000_000_000n }))).toEqual([
      "miner reward above subsidy plus fees: 1 (e.g. 3146400)",
    ]);
  });

  it("is quiet on the corrected row and on an ordinary post-NU7 block", () => {
    expect(alertsFor(row({}))).toEqual([]);
    expect(
      alertsFor(row({ height: 3_543_405, miner_reward_zat: 41_786_668n, total_fee_zat: 300_000n })),
    ).toEqual([]);
  });

  it("does not decide without the fee total", () => {
    expect(alertsFor(row({ miner_reward_zat: 7_875_000_000_000n, total_fee_zat: null }))).toEqual(
      [],
    );
  });
});
