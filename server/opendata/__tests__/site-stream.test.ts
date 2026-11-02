import { describe, expect, it } from "vitest";
import { NU7_HEIGHT } from "@/domain/halving";
import type { BlockRow } from "../checks";
import { minerFeeShare, SiteStream } from "../site-stream";
import type { BoundaryTx } from "../site-boundary";

const DAY = 86_400n;
const T0 = 1_700_000_000n - (1_700_000_000n % DAY);
const day = (n: number) => new Date(Number(T0 + BigInt(n) * DAY) * 1000).toISOString().slice(0, 10);

const block = (over: Partial<BlockRow>): BlockRow => ({
  height: 100_000,
  hash: "",
  prev_hash: "",
  timestamp: T0,
  size_bytes: 1000,
  tx_count: 1,
  transparent_tx_count: 0,
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
  miner_reward_zat: 100n,
  ...over,
});

const tx = (over: Partial<BoundaryTx>): BoundaryTx => ({
  txid: "",
  timestamp: T0,
  kind: "transparent",
  direction: null,
  version: 5,
  fee_zat: 10n,
  sprout_joinsplits: null,
  sprout_vpub_net_zat: null,
  sapling_spends: null,
  sapling_outputs: null,
  sapling_value_balance_zat: null,
  orchard_actions: null,
  orchard_value_balance_zat: null,
  ironwood_actions: null,
  ironwood_value_balance_zat: null,
  ...over,
});

describe("the site's block series, from the stream", () => {
  it("sums transaction kinds per day, up to the final day", () => {
    const s = new SiteStream();
    s.pushBlock(block({ height: 1, transparent_tx_count: 2, mixed_tx_count: 1 }));
    s.pushBlock(block({ height: 2, shielded_tx_count: 3, transparent_tx_count: 1 }));
    s.pushBlock(block({ height: 3, timestamp: T0 + DAY, mixed_tx_count: 9 }));
    expect(s.txKindRows(day(0))).toEqual([
      { day: day(0), transparent_txs: 3, mixed_txs: 1, shielded_txs: 3 },
    ]);
  });

  it("closes a day at its highest block, even one stamped after the next day began", () => {
    const s = new SiteStream();
    s.pushBlock(block({ height: 1, hash: "a", sapling_pool_zat: 5n }));
    s.pushBlock(block({ height: 2, hash: "b", timestamp: T0 + DAY, sapling_pool_zat: 6n }));
    s.pushBlock(block({ height: 3, hash: "c", timestamp: T0 + DAY - 1n, sapling_pool_zat: 7n }));
    expect(
      s.poolRows(day(1)).map((r) => [r.day, r.top_height, r.hash, r.sapling_pool_zat]),
    ).toEqual([
      [day(0), 3, "c", 7n],
      [day(1), 2, "b", 6n],
    ]);
    // A NULL close stays NULL: never read as zero.
    expect(s.poolRows(day(0))[0]!.orchard_pool_zat).toBeNull();
  });

  it("gives the miner all fees before NU7 and four tenths, rounded up, from it", () => {
    expect(minerFeeShare(NU7_HEIGHT - 1, 1_005n)).toBe(1_005n);
    expect(minerFeeShare(NU7_HEIGHT, 1_005n)).toBe(1_005n - 603n);
    const s = new SiteStream();
    s.pushBlock(block({ height: NU7_HEIGHT - 1, total_fee_zat: 1_000n }));
    s.pushBlock(block({ height: NU7_HEIGHT, total_fee_zat: 1_005n }));
    s.pushBlock(block({ height: NU7_HEIGHT + 1, total_fee_zat: null }));
    expect(s.minerRows(day(0))[0]).toMatchObject({ fee_zat: 1_402n });
  });

  it("counts blocks per miner kind, and leaves the reward unknown if any block's is", () => {
    const s = new SiteStream();
    s.pushBlock(block({ height: 1 }));
    s.pushBlock(block({ height: 2, miner_kind: "shielded", miner_reward_zat: null }));
    s.pushBlock(block({ height: 3, miner_kind: null, miner_reward_zat: null }));
    s.pushBlock(block({ height: 4, timestamp: T0 + DAY, miner_reward_zat: null }));
    expect(s.minerRows(day(1))).toEqual([
      {
        day: day(0),
        transparent_blocks: 1,
        shielded_blocks: 1,
        unknown_blocks: 0,
        unrecorded_blocks: 1,
        fee_zat: 0n,
        reward_zat: 100n,
      },
      {
        day: day(1),
        transparent_blocks: 1,
        shielded_blocks: 0,
        unknown_blocks: 0,
        unrecorded_blocks: 0,
        fee_zat: 0n,
        reward_zat: null,
      },
    ]);
  });

  it("counts fee-bearing transactions per month and kind, coinbase and unknown fees excluded", () => {
    const s = new SiteStream();
    s.pushTx(tx({}));
    s.pushTx(tx({ kind: "mixed", direction: "shielding" }));
    s.pushTx(tx({ fee_zat: null }));
    s.pushTx(tx({ kind: "coinbase", fee_zat: null }));
    const month = `${day(0).slice(0, 7)}-01`;
    expect(s.feeTxRows().sort((a, b) => (a.kind < b.kind ? -1 : 1))).toEqual([
      { month, kind: "mixed", txs: 1 },
      { month, kind: "transparent", txs: 1 },
    ]);
  });
});
