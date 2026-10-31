import { describe, expect, it } from "vitest";
import { NU7_HEIGHT } from "@/domain/halving";
import type { BlockRow } from "../checks";
import {
  DailyHashrate,
  DailyPoolFlows,
  DailyShieldedCoinbase,
  DailySupply,
  DailyTxVersions,
  type MetricTx,
} from "../metrics";

const DAY = 86_400n;
const T0 = 1_700_000_000n - (1_700_000_000n % DAY); // a UTC midnight
const day = (n: number) => new Date(Number(T0 + BigInt(n) * DAY) * 1000).toISOString().slice(0, 10);

const tx = (over: Partial<MetricTx>): MetricTx => ({
  timestamp: T0,
  kind: "transparent",
  version: 5,
  sprout_vpub_net_zat: null,
  sapling_value_balance_zat: null,
  orchard_value_balance_zat: null,
  ironwood_value_balance_zat: null,
  ...over,
});

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
  miner_kind: null,
  miner_reward_zat: null,
  ...over,
});

describe("stream metrics", () => {
  it("counts transactions per day and version, in order, up to the final day", () => {
    const m = new DailyTxVersions();
    for (const t of [tx({ version: 6 }), tx({ version: 4 }), tx({ version: 6 })]) m.push(t);
    m.push(tx({ timestamp: T0 + DAY, version: 5 }));
    expect(m.rows(day(0))).toEqual([
      { day: day(0), version: 4, txs: 1 },
      { day: day(0), version: 6, txs: 2 },
    ]);
  });

  it("keeps pool flows gross, and turns Sprout's node sign into the domain sign", () => {
    const m = new DailyPoolFlows();
    m.push(tx({ sapling_value_balance_zat: 500n, orchard_value_balance_zat: -200n }));
    m.push(tx({ sapling_value_balance_zat: -300n }));
    m.push(tx({ sprout_vpub_net_zat: 70n })); // 70 leaving Sprout
    expect(m.rows(day(0))).toEqual([
      { day: day(0), pool: "orchard", inflow_zat: 0n, outflow_zat: 200n, txs: 1 },
      { day: day(0), pool: "sapling", inflow_zat: 500n, outflow_zat: 300n, txs: 2 },
      { day: day(0), pool: "sprout", inflow_zat: 0n, outflow_zat: 70n, txs: 1 },
    ]);
  });

  it("counts coinbase paid into shielded pools, and ignores every other kind", () => {
    const m = new DailyShieldedCoinbase();
    m.push(tx({ kind: "coinbase" }));
    m.push(tx({ kind: "coinbase", orchard_value_balance_zat: 312_500_000n }));
    m.push(tx({ kind: "shielded", sapling_value_balance_zat: 9n }));
    expect(m.rows(day(0))).toEqual([
      {
        day: day(0),
        coinbase_txs: 2,
        shielded_coinbase_txs: 1,
        to_sapling_zat: 0n,
        to_orchard_zat: 312_500_000n,
        to_ironwood_zat: 0n,
      },
    ]);
  });
});

describe("DailyHashrate", () => {
  it("divides a day's work by the span since the previous day's last block", () => {
    const m = new DailyHashrate();
    m.push(block({ timestamp: T0 + DAY - 100n, difficulty: 1 }));
    m.push(block({ timestamp: T0 + DAY + 50n, difficulty: 2 }));
    m.push(block({ timestamp: T0 + DAY + 100n, difficulty: 2 }));
    const [first, second] = m.rows(day(1));
    expect(first).toEqual({ day: day(0), solutions_per_second: null });
    expect(second).toEqual({ day: day(1), solutions_per_second: (4 * 8192) / 200 });
  });

  it("leaves a day NULL when miner clocks make its span zero or negative", () => {
    // A block stamped after midnight, then one stamped before it: the earlier day's span ends
    // before it starts.
    const m = new DailyHashrate();
    m.push(block({ timestamp: T0 + DAY + 10n, difficulty: 1 }));
    m.push(block({ timestamp: T0 + DAY - 5n, difficulty: 1 }));
    expect(m.rows(day(1))[0]).toEqual({ day: day(0), solutions_per_second: null });
  });
});

describe("DailySupply", () => {
  it("reports unclaimed subsidy as the schedule minus what exists", () => {
    const m = new DailySupply();
    // Slow start: heights 1 and 2 allow 62,500 and 125,000 zat; the miners claimed 150,000.
    m.push(block({ height: 0, transparent_pool_zat: null }));
    m.push(block({ height: 1, transparent_pool_zat: 62_500n }));
    m.push(block({ height: 2, transparent_pool_zat: 150_000n }));
    expect(m.rows(day(0))).toEqual([
      {
        day: day(0),
        schedule_zat: 187_500n,
        issued_zat: 150_000n,
        unclaimed_zat: 37_500n,
        nsm_zat: 0n,
        nsm_total_zat: 0n,
      },
    ]);
  });

  it("counts a pool's NULL as zero only before its first value", () => {
    const m = new DailySupply();
    m.push(block({ height: 1, transparent_pool_zat: 62_500n, sprout_pool_zat: 0n }));
    m.push(block({ height: 2, transparent_pool_zat: 187_500n, sprout_pool_zat: null }));
    expect(m.rows(day(0))[0]).toMatchObject({ issued_zat: null, unclaimed_zat: null });
  });

  it("moves six tenths of fees, rounded down, into the NSM from NU7 and counts it as issued", () => {
    const m = new DailySupply();
    m.push(block({ height: NU7_HEIGHT - 1, total_fee_zat: 1_000n, transparent_pool_zat: 0n }));
    m.push(block({ height: NU7_HEIGHT, total_fee_zat: 1_005n, transparent_pool_zat: 0n }));
    expect(m.rows(day(0))[0]).toMatchObject({ nsm_zat: 603n, nsm_total_zat: 603n });
  });
});
