import { describe, expect, it } from "vitest";
import { minerFeeShareZat } from "@/domain/consensus";
import { NU7_HEIGHT } from "@/domain/halving";
import { checkCapableReleases, checkNsm, type BlockRow } from "../checks";
import {
  DailyHashrate,
  DailyNsm,
  DailyPoolFlows,
  DailyShieldedCoinbase,
  DailySupply,
  DailyTxVersions,
  nsmShareZat,
  type MetricTx,
} from "../metrics";
import { NU7_CAPABLE_RELEASES } from "../tables";

const DAY = 86_400n;
const T0 = 1_700_000_000n - (1_700_000_000n % DAY); // a UTC midnight
const day = (n: number) => new Date(Number(T0 + BigInt(n) * DAY) * 1000).toISOString().slice(0, 10);

const tx = (over: Partial<MetricTx>): MetricTx => ({
  timestamp: T0,
  kind: "transparent",
  version: 5,
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
    const sapling = (balance: bigint) => ({
      sapling_spends: 1,
      sapling_outputs: 1,
      sapling_value_balance_zat: balance,
    });
    m.push(tx({ ...sapling(500n), orchard_actions: 2, orchard_value_balance_zat: -200n }));
    m.push(tx(sapling(-300n)));
    m.push(tx({ sprout_joinsplits: 1, sprout_vpub_net_zat: 70n })); // 70 leaving Sprout
    // Every transaction carries a Sprout value; without JoinSplits it is 0 and never counts.
    m.push(tx({ sprout_joinsplits: 0, sprout_vpub_net_zat: 0n }));
    m.push(tx({ sprout_joinsplits: null, sprout_vpub_net_zat: 0n }));
    expect(m.rows(day(0))).toEqual([
      { day: day(0), pool: "orchard", inflow_zat: 0n, outflow_zat: 200n, txs: 1 },
      { day: day(0), pool: "sapling", inflow_zat: 500n, outflow_zat: 300n, txs: 2 },
      { day: day(0), pool: "sprout", inflow_zat: 0n, outflow_zat: 70n, txs: 1 },
    ]);
  });

  it("counts a pool only where the transaction used it, as chain_day_pool_tx does", () => {
    const m = new DailyPoolFlows();
    // A bundle with nothing in it is present but unused.
    m.push(tx({ sapling_spends: 0, sapling_outputs: 0, sapling_value_balance_zat: 0n }));
    m.push(tx({ orchard_actions: 0, orchard_value_balance_zat: 0n }));
    m.push(tx({ sapling_spends: 0, sapling_outputs: 1, sapling_value_balance_zat: 0n }));
    expect(m.rows(day(0))).toEqual([
      { day: day(0), pool: "sapling", inflow_zat: 0n, outflow_zat: 0n, txs: 1 },
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

describe("unknown inputs stay unknown", () => {
  it("makes a day's hashrate NULL when one of its blocks has no difficulty", () => {
    const m = new DailyHashrate();
    m.push(block({ timestamp: T0 + DAY - 10n, difficulty: 1 }));
    m.push(block({ timestamp: T0 + DAY + 5n, difficulty: 1 }));
    m.push(block({ timestamp: T0 + DAY + 9n, difficulty: null }));
    expect(m.rows(day(1))[1]).toEqual({ day: day(1), solutions_per_second: null });
  });

  it("makes the NSM and the supply unknown after a post-NU7 block without a fee total", () => {
    const m = new DailySupply();
    m.push(block({ height: NU7_HEIGHT, total_fee_zat: 10n, transparent_pool_zat: 0n }));
    m.push(block({ height: NU7_HEIGHT + 1, total_fee_zat: null, transparent_pool_zat: 0n }));
    m.push(block({ height: NU7_HEIGHT + 2, timestamp: T0 + DAY, transparent_pool_zat: 0n }));
    expect(
      m.rows(day(1)).map((r) => [r.nsm_zat, r.nsm_total_zat, r.issued_zat, r.unclaimed_zat]),
    ).toEqual([
      [null, null, null, null],
      [0n, null, null, null],
    ]);
    // What the ledger's cross-check reads: unknown, and from which height.
    expect(m.atRelease).toEqual({
      unclaimedZat: null,
      unknownFeeFrom: NU7_HEIGHT + 1,
      poolsKnown: true,
    });
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
    expect(m.atRelease).toEqual({ unclaimedZat: null, unknownFeeFrom: null, poolsKnown: false });
  });

  it("moves six tenths of fees, rounded down, into the NSM from NU7 and counts it as issued", () => {
    const m = new DailySupply();
    m.push(block({ height: NU7_HEIGHT - 1, total_fee_zat: 1_000n, transparent_pool_zat: 0n }));
    m.push(block({ height: NU7_HEIGHT, total_fee_zat: 1_005n, transparent_pool_zat: 0n }));
    expect(m.rows(day(0))[0]).toMatchObject({ nsm_zat: 603n, nsm_total_zat: 603n });
  });
});

describe("nsm_daily", () => {
  const supplyAndNsm = (rows: Partial<BlockRow>[]) => {
    const supply = new DailySupply();
    const nsm = new DailyNsm();
    for (const r of rows) {
      const b = block({ transparent_pool_zat: 0n, ...r });
      supply.push(b);
      nsm.push(b);
    }
    return { supply, nsm };
  };
  const check = ({ supply, nsm }: ReturnType<typeof supplyAndNsm>) =>
    checkNsm(nsm.rows(day(9)), supply.rows(day(9)), {
      nsm: nsm.total,
      supply: supply.nsmTotalAtRelease,
    }).failures;

  it("splits a fee exactly as the site's miner share does", () => {
    for (const fee of [0, 1, 7, 10, 1_005, 123_456_789]) {
      const nsm = nsmShareZat(NU7_HEIGHT, BigInt(fee))!;
      expect(nsm).toBe(BigInt(Math.floor((fee * 6) / 10)));
      expect(nsm + BigInt(minerFeeShareZat("mainnet", NU7_HEIGHT, fee))).toBe(BigInt(fee));
    }
    expect(nsmShareZat(NU7_HEIGHT - 1, 1_000n)).toBe(0n);
    // Before NU7 nothing goes to the NSM whatever the fee, so an unknown fee is still zero there.
    expect(nsmShareZat(NU7_HEIGHT - 1, null)).toBe(0n);
    expect(nsmShareZat(NU7_HEIGHT, null)).toBeNull();
  });

  it("has no rows before NU7, and that is not a failure", () => {
    const both = supplyAndNsm([{ height: NU7_HEIGHT - 2 }, { height: NU7_HEIGHT - 1 }]);
    expect(both.nsm.rows(day(9))).toEqual([]);
    expect(both.nsm.total).toBe(0n);
    expect(check(both)).toEqual([]);
  });

  it("starts on the activation day, where pre-NU7 blocks add nothing", () => {
    const both = supplyAndNsm([
      { height: NU7_HEIGHT - 1, total_fee_zat: 1_000n },
      { height: NU7_HEIGHT, total_fee_zat: 1_005n },
      { height: NU7_HEIGHT + 1, total_fee_zat: 10n, timestamp: T0 + DAY },
    ]);
    expect(both.nsm.rows(day(9))).toEqual([
      { day: day(0), nsm_inflow_zat: 603n, nsm_total_zat: 603n },
      { day: day(1), nsm_inflow_zat: 6n, nsm_total_zat: 609n },
    ]);
    expect(both.nsm.rows(day(0))).toHaveLength(1);
    expect(both.nsm.total).toBe(609n);
    expect(check(both)).toEqual([]);
  });

  it("makes an unknown fee's day, and every later total, NULL, never zero", () => {
    const both = supplyAndNsm([
      { height: NU7_HEIGHT, total_fee_zat: 10n },
      { height: NU7_HEIGHT + 1, total_fee_zat: null },
      { height: NU7_HEIGHT + 2, total_fee_zat: 20n, timestamp: T0 + DAY },
    ]);
    expect(both.nsm.rows(day(9))).toEqual([
      { day: day(0), nsm_inflow_zat: null, nsm_total_zat: null },
      { day: day(1), nsm_inflow_zat: 12n, nsm_total_zat: null },
    ]);
    expect(both.nsm.total).toBeNull();
    expect(check(both)).toEqual([]);
  });

  it("fails when it and the supply audit disagree", () => {
    const { supply, nsm } = supplyAndNsm([
      { height: NU7_HEIGHT - 1, timestamp: T0 - DAY },
      { height: NU7_HEIGHT, total_fee_zat: 10n },
    ]);
    const supplyRows = supply.rows(day(9));
    const totals = { nsm: nsm.total, supply: supply.nsmTotalAtRelease };
    const changed = nsm.rows(day(9)).map((r) => ({ ...r, nsm_inflow_zat: 7n }));
    expect(checkNsm(changed, supplyRows, totals).failures.join()).toMatch(
      /nsm_daily differs from supply_daily/,
    );
    expect(checkNsm([], supplyRows, totals).failures.join()).toMatch(
      /NSM in supply_daily on a day without an nsm_daily row/,
    );
    const elsewhere = [{ day: day(5), nsm_inflow_zat: 6n, nsm_total_zat: 6n }];
    expect(checkNsm(elsewhere, supplyRows, totals).failures.join()).toMatch(
      /nsm_daily day missing from supply_daily/,
    );
    expect(
      checkNsm(nsm.rows(day(9)), supplyRows, { nsm: null, supply: 6n }).failures.join(),
    ).toMatch(/NSM total at the release differs/);
  });
});

describe("nu7_capable_releases", () => {
  it("publishes Zakura 1.7.0 and Zebra 7.0.0, both well formed", () => {
    expect(NU7_CAPABLE_RELEASES.map((r) => [r.client, r.min_version])).toEqual([
      ["Zakura", "1.7.0"],
      ["Zebra", "7.0.0"],
    ]);
    expect(checkCapableReleases(NU7_CAPABLE_RELEASES).failures).toEqual([]);
  });

  it("refuses an unpublished client, a malformed version or a non-https source", () => {
    const failures = checkCapableReleases([
      { client: "MyNode", min_version: "1.0.0", source_url: "https://example.org/x" },
      { client: "Zebra", min_version: "7.0", source_url: "https://example.org/x" },
      { client: "Zakura", min_version: "1.7.0", source_url: "http://example.org/x" },
    ]).failures.join("\n");
    expect(failures).toMatch(/unpublished client/);
    expect(failures).toMatch(/version malformed/);
    expect(failures).toMatch(/not an https link/);
  });
});
