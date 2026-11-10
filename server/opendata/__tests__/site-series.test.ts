import { describe, expect, it } from "vitest";
import { base58checkEncode } from "@/domain/encoding/base58check";
import type { BlockRow } from "../checks";
import { DailyBlocks } from "../derived";
import { DailyPoolFlows, DailySupply } from "../metrics";
import type { BoundaryTx } from "../site-boundary";
import { siteSeries, type SiteInputs } from "../site-series";
import { SiteStream } from "../site-stream";
import type { SiteViews } from "../site-views";
import { SITE_TABLES } from "../tables";

/**
 * A small chain over a month end (Jan 31 → Feb 2), its site views built from the chain itself,
 * then each broken one way at a time: every break must fail the release, every exemption must not.
 */

type Row = Record<string, unknown>;

const T0 = 1_769_817_600n; // 2026-01-31 00:00 UTC
const DAYS = ["2026-01-31", "2026-02-01", "2026-02-02"];
const FINAL = DAYS[1]!;
const hex = (n: number) => n.toString(16).padStart(64, "0");
const MINER = base58checkEncode(Uint8Array.from([0x1c, 0xb8, ...new Array<number>(20).fill(9)]));
const midnight = (day: string) => BigInt(Date.parse(`${day}T00:00:00Z`) / 1000);

function chain() {
  const stream = new SiteStream();
  const blocks = new DailyBlocks();
  const flows = new DailyPoolFlows();
  const supply = new DailySupply();
  let sapling = 0n;
  let height = 0;
  for (let d = 0; d < DAYS.length; d++) {
    for (let b = 0; b < 2; b++) {
      const timestamp = T0 + BigInt(d * 86_400 + b * 3_600);
      const txs: BoundaryTx[] = [
        tx({ txid: hex(height * 10), timestamp, kind: "coinbase", fee_zat: null }),
        tx({
          txid: hex(height * 10 + 1),
          timestamp,
          kind: "mixed",
          direction: "shielding",
          sapling_spends: 0,
          sapling_outputs: 1,
          sapling_value_balance_zat: BigInt(1_000 + height),
        }),
      ];
      if (height === 1) {
        txs.push(
          tx({
            txid: hex(7),
            timestamp,
            kind: "shielded",
            sapling_spends: 1,
            sapling_outputs: 0,
            sapling_value_balance_zat: -300n,
            orchard_actions: 1,
            orchard_value_balance_zat: 300n,
          }),
        );
      }
      sapling += BigInt(1_000 + height);
      const row: BlockRow = {
        height,
        hash: hex(100 + height),
        prev_hash: hex(99 + height),
        timestamp,
        size_bytes: 1_000 + height,
        tx_count: txs.length,
        transparent_tx_count: 0,
        mixed_tx_count: 1,
        shielded_tx_count: txs.length - 2,
        total_fee_zat: 10n,
        sapling_flow_zat: 0n,
        orchard_flow_zat: 0n,
        transparent_pool_zat: 5_000n,
        sprout_pool_zat: null,
        sapling_pool_zat: sapling,
        orchard_pool_zat: null,
        lockbox_pool_zat: null,
        ironwood_pool_zat: null,
        difficulty: 1.5 + height,
        miner_kind: "transparent",
        miner_reward_zat: 100n,
      };
      stream.pushBlock(row);
      blocks.push(row);
      supply.push(row);
      for (const t of txs) {
        stream.pushTx(t);
        flows.push(t);
      }
      height++;
    }
  }
  const inputs: SiteInputs = {
    finalDay: FINAL,
    stream,
    blocksDaily: blocks.rows(FINAL),
    poolFlows: flows.rows(FINAL),
    supply: supply.rows(FINAL),
  };
  const last = DAYS.at(-1)!;
  const allBlocks = blocks.rows(last);
  const kinds = new Map(stream.txKindRows(last).map((k) => [k.day, k]));
  const records = stream.boundary.recordRows(last, DAYS);
  const views: SiteViews = {
    check_day_rollup: stream.poolRows(last).map((p) => ({
      day: p.day,
      ts: midnight(String(p.day)),
      top_height: p.top_height,
      transparent: kinds.get(p.day)!.transparent_txs,
      mixed: kinds.get(p.day)!.mixed_txs,
      shielded: kinds.get(p.day)!.shielded_txs,
    })),
    check_day_supply_close: stream.poolRows(last),
    check_day_network: allBlocks.map((b) => ({
      day: b.day,
      ts: midnight(String(b.day)),
      blocks: b.blocks,
      avg_difficulty: b.avg_difficulty,
      avg_block_bytes: b.avg_size_bytes,
    })),
    check_day_fee_total: allBlocks.map((b) => ({
      day: b.day,
      ts: midnight(String(b.day)),
      fee_zat: b.fees_zat,
      blocks: b.blocks,
      blocks_covered: b.blocks_with_fees,
    })),
    check_day_pool_tx: flows.rows(last).map((p) => ({
      day: p.day,
      pool: p.pool,
      txs: BigInt(p.txs as number),
      value_in_zat: p.inflow_zat,
      value_out_zat: p.outflow_zat,
    })),
    check_mining_day: allBlocks.map((b) => ({
      day: b.day,
      blocks: b.blocks,
      unrecorded_blocks: 0,
    })),
    shielding_daily: records.map((r) => ({
      day: r.day,
      shielding_txs: BigInt(r.shielding_txs as number),
      unshielding_txs: BigInt(r.unshielding_txs as number),
      indeterminate_txs: BigInt(r.indeterminate_txs as number),
      migration_txs: BigInt(r.migration_txs as number),
    })),
    pool_boundary_daily: stream.boundary.boundaryRows(last),
    shielding_flow_daily: stream.boundary
      .flowRows(last)
      .map((r) => ({ ...r, ts: midnight(String(r.day)) })),
    pool_migration_daily: stream.boundary.migrationRows(last),
    fees_monthly: stream.feeTxRows().map((r) => ({
      ...r,
      ts: midnight(r.month),
      p25_zat: 10n,
      median_zat: 10n,
      p75_zat: 10n,
    })),
    shielding_records_daily: records.map((r) =>
      Object.fromEntries(Object.entries(r).filter(([k]) => k === "day" || k.startsWith("max_"))),
    ),
    mining_payouts_daily: allBlocks.map((b) => ({
      day: b.day,
      kind: "transparent",
      address: MINER,
      blocks: b.blocks,
      reward_zat: 100n * BigInt(b.blocks as number),
      fee_zat: b.fees_zat,
      fee_blocks: b.blocks_with_fees,
    })),
    // One tracked address over every day, each read at the day's highest block (two blocks a day).
    address_balance_daily: DAYS.map((day, d) => ({
      address: MINER,
      day,
      balance_zat: 100n * BigInt(d + 1),
      close_height: 2 * d + 1,
    })),
  };
  return { views, inputs };
}

function tx(over: Partial<BoundaryTx>): BoundaryTx {
  return {
    txid: "",
    timestamp: T0,
    kind: "transparent",
    direction: null,
    version: 5,
    fee_zat: 1n,
    sprout_joinsplits: null,
    sprout_vpub_net_zat: 0n,
    sapling_spends: null,
    sapling_outputs: null,
    sapling_value_balance_zat: null,
    orchard_actions: null,
    orchard_value_balance_zat: null,
    ironwood_actions: null,
    ironwood_value_balance_zat: null,
    ...over,
  };
}

/** The consistent chain with one view or input changed; its failures. */
function broken(change: (v: SiteViews, x: SiteInputs) => void): string {
  const { views, inputs } = chain();
  change(views, inputs);
  return siteSeries(views, inputs).failures.join("\n");
}

const on = (rows: Row[] | null, day: string) => rows!.find((r) => r.day === day)!;
const drop = (v: SiteViews, view: keyof SiteViews, day: string) => {
  v[view] = v[view]!.filter((r) => r.day !== day);
};

describe("the site's series, consistent", () => {
  it("publishes every table, cut at the final day, with no failure", () => {
    const { views, inputs } = chain();
    const r = siteSeries(views, inputs);
    expect(r.failures).toEqual([]);
    expect(r.tables.map(([name]) => name)).toEqual([...SITE_TABLES]);
    const table = new Map(r.tables);
    for (const [name, rows] of table) {
      for (const row of rows) expect(String(row.day ?? row.month) <= FINAL, name).toBe(true);
    }
    expect(table.get("pools_daily")!.map((p) => p.top_height)).toEqual([1, 3]);
    expect(table.get("pool_migration_daily")).toEqual([
      { day: DAYS[0], destination: "orchard", source: "sapling", txs: 1, zat: 300n },
    ]);
    // January is complete on the final day (Feb 1); February is not.
    expect(table.get("fees_monthly")!.map((m) => [m.month, m.kind])).toEqual([
      ["2026-01-01", "mixed"],
      ["2026-01-01", "shielded"],
    ]);
  });

  it("asks nothing of pool migration on quiet days", () => {
    // The only migration is on the first day; the days after have no row at all.
    const { views, inputs } = chain();
    expect(views.pool_migration_daily!.map((r) => r.day)).toEqual([DAYS[0]]);
    expect(siteSeries(views, inputs).failures).toEqual([]);
  });

  it("holds a day with no block (a halt) to the trackers' zero rows", () => {
    // The trackers walk calendar days; the stream only sees days with blocks.
    const { views, inputs } = chain();
    const halt = "2026-01-30";
    views.check_mining_day!.unshift({ day: halt, blocks: 0, unrecorded_blocks: 0 });
    views.shielding_daily!.unshift({
      day: halt,
      shielding_txs: 0n,
      unshielding_txs: 0n,
      indeterminate_txs: 0n,
      migration_txs: 0n,
    });
    views.shielding_records_daily!.unshift({
      day: halt,
      max_shielding_zat: null,
      max_shielding_ties: 0,
      max_shielding_txid: null,
      max_unshielding_zat: null,
      max_unshielding_ties: 0,
      max_unshielding_txid: null,
      max_migration_zat: null,
      max_migration_ties: 0,
      max_migration_txid: null,
    });
    expect(siteSeries(views, inputs).failures).toEqual([]);
    // But not one that claims a block there.
    views.check_mining_day![0]!.blocks = 1;
    expect(siteSeries(views, inputs).failures.join("\n")).toMatch(
      /the stream differs from mining_day/,
    );
  });

  it("fails, without crashing, when every view is unreadable", () => {
    const { views, inputs } = chain();
    for (const k of Object.keys(views) as (keyof SiteViews)[]) views[k] = null;
    const r = siteSeries(views, inputs);
    expect(new Map(r.tables).get("pool_boundary_daily")).toEqual([]);
    // The reader reports each unreadable view; the stream's own tables are still built.
    expect(new Map(r.tables).get("tx_kinds_daily")).toHaveLength(2);
  });
});

describe("the site's series, stale", () => {
  it("fails a matview with nothing after the final day", () => {
    expect(broken((v) => drop(v, "check_day_rollup", DAYS[2]!))).toMatch(
      /stale view: nothing after the final day: 1 \(e\.g\. chain_day_rollup\)/,
    );
  });

  it("fails a view with no row for the final day", () => {
    expect(broken((v) => drop(v, "shielding_flow_daily", FINAL))).toMatch(
      /stale view: no row for the final day: 1 \(e\.g\. chain_day_shielding_flow\)/,
    );
    expect(broken((v) => drop(v, "mining_payouts_daily", FINAL))).toMatch(
      /no row for the final day: 1 \(e\.g\. mining_day_payout\)/,
    );
    expect(broken((v) => drop(v, "shielding_records_daily", FINAL))).toMatch(
      /no row for the final day: 1 \(e\.g\. boundary_daily\)/,
    );
  });

  it("fails monthly fees without a row for the month after the final day", () => {
    expect(
      broken((v) => {
        v.fees_monthly = v.fees_monthly!.filter((r) => r.month !== "2026-02-01");
      }),
    ).toMatch(/no row for the month after the final day/);
  });

  it("fails a day truncated outside UTC", () => {
    expect(
      broken((v) => {
        on(v.check_day_network, FINAL).ts = midnight(FINAL) - 32_400n;
      }),
    ).toMatch(/day not truncated in UTC.*chain_day_network/);
  });
});

describe("the site's series, disagreeing with the stream", () => {
  const cases: [string, (v: SiteViews, x: SiteInputs) => void, RegExp][] = [
    [
      "a transaction count",
      (v) => void (on(v.check_day_rollup, FINAL).mixed = 3),
      /tx_kinds_daily differs from chain_day_rollup: 1 \(e\.g\. 2026-02-01 mixed: 2 vs 3\)/,
    ],
    [
      "a closing block",
      (v) => void (on(v.check_day_supply_close, FINAL).hash = hex(1)),
      /pools_daily differs from chain_day_supply_close/,
    ],
    [
      "the supply identity",
      (_, x) => void ((x.supply.at(-1) as Row).issued_zat = 1n),
      /chain_day_supply_close \+ NSM differs from supply_daily.issued_zat/,
    ],
    [
      "a site close that breaks the supply identity",
      (v) => void (on(v.check_day_supply_close, FINAL).transparent_pool_zat = 1n),
      /chain_day_supply_close \+ NSM differs from supply_daily.issued_zat: 1 \(e\.g\. 2026-02-01\)/,
    ],
    [
      "an average past rounding",
      (v) => {
        const r = on(v.check_day_network, FINAL);
        r.avg_difficulty = (r.avg_difficulty as number) * (1 + 1e-7);
      },
      /blocks_daily differs from chain_day_network/,
    ],
    [
      "fee coverage",
      (v) => void (on(v.check_day_fee_total, FINAL).blocks_covered = 1),
      /blocks_daily differs from chain_day_fee_total/,
    ],
    [
      "a pool's transaction count",
      (v) => void (v.check_day_pool_tx![0]!.txs = 9n),
      /pool_flows_daily differs from chain_day_pool_tx/,
    ],
    [
      "a boundary leg",
      (v) => void (v.pool_boundary_daily![0]!.shielded_zat = 1n),
      /pool_boundary_daily differs from the stream/,
    ],
    [
      "a shielding flow",
      (v) => void (on(v.shielding_flow_daily, FINAL).unshielded_zat = 1n),
      /shielding_flow_daily differs from the stream/,
    ],
    [
      "a migration missing from its day's count",
      (v) => void (v.pool_migration_daily = []),
      /pool_migration_daily differs from boundary_daily/,
    ],
    [
      "a month's fee count",
      (v) => void (v.fees_monthly![0]!.txs = 99),
      /fees_monthly differs from the stream/,
    ],
    [
      "a daily maximum",
      (v) => void (on(v.shielding_records_daily, FINAL).max_shielding_zat = 1n),
      /shielding_records_daily differs from the stream/,
    ],
    [
      "a day's direction count behind the records",
      (v) => void (on(v.shielding_daily, FINAL).shielding_txs = 0n),
      /shielding_records_daily differs from the stream/,
    ],
    [
      "a payout's fee share",
      (v) => void (on(v.mining_payouts_daily, FINAL).fee_zat = 21n),
      /mining_payouts_daily differs from the stream: 1 \(e\.g\. 2026-02-01 fee_zat: 21 vs 20\)/,
    ],
    [
      "a payout's blocks",
      (v) => void (on(v.mining_payouts_daily, FINAL).blocks = 3),
      /mining_payouts_daily differs from the stream/,
    ],
    [
      "a payout's reward left unknown",
      (v) => void (on(v.mining_payouts_daily, FINAL).reward_zat = null),
      /2026-02-01 reward_zat: NULL vs 200/,
    ],
    [
      "a day with blocks of no recorded miner",
      (v) => void (on(v.check_mining_day, FINAL).unrecorded_blocks = 1),
      /the stream differs from mining_day/,
    ],
  ];
  for (const [what, change, expected] of cases) {
    it(`fails on ${what}`, () => expect(broken(change)).toMatch(expected));
  }

  it("accepts an average within rounding", () => {
    expect(
      broken((v) => {
        const r = on(v.check_day_network, FINAL);
        r.avg_block_bytes = (r.avg_block_bytes as number) * (1 + 1e-12);
      }),
    ).toBe("");
  });
});

describe("the site's series, malformed", () => {
  it("fails a payout address that is not a mainnet t-address, or empty", () => {
    for (const address of ["t1notreallyanaddressatall000000000", ""]) {
      expect(broken((v) => void (on(v.mining_payouts_daily, FINAL).address = address))).toMatch(
        /mining payout address is not a mainnet t-address: 1 \(e\.g\. \d+ characters\)/,
      );
    }
  });

  it("fails a payout address on a kind that has none, and a transparent kind without one", () => {
    expect(broken((v) => void (on(v.mining_payouts_daily, FINAL).kind = "shielded"))).toMatch(
      /mining payout address does not match its kind/,
    );
    expect(broken((v) => void (on(v.mining_payouts_daily, FINAL).address = null))).toMatch(
      /mining payout address does not match its kind/,
    );
  });

  it("fails a record txid that is not one, and a unique maximum without one", () => {
    const day = DAYS[0]!; // the migration's day: its maximum is unique
    expect(
      broken((v) => void (on(v.shielding_records_daily, day).max_migration_txid = "x")),
    ).toMatch(/max_migration_txid: not a transaction id/);
    expect(
      broken((v) => void (on(v.shielding_records_daily, day).max_migration_txid = null)),
    ).toMatch(/max_migration: a unique maximum without its txid/);
    expect(broken((v) => void (on(v.shielding_records_daily, day).max_migration_ties = 0))).toMatch(
      /max_migration: amount and ties disagree/,
    );
  });

  it("fails a published string that looks like an address", () => {
    expect(broken((v) => void (v.pool_boundary_daily![0]!.pool = "http://evil.example"))).toMatch(
      /pool_boundary_daily.pool: a value looks like an address/,
    );
  });
});

describe("address_balance_daily", () => {
  it("publishes each address's days through the final day", () => {
    const { views, inputs } = chain();
    const rows = new Map(siteSeries(views, inputs).tables).get("address_balance_daily")!;
    expect(rows.map((r) => [r.day, r.close_height])).toEqual([
      [DAYS[0], 1],
      [FINAL, 3],
    ]);
  });

  it("fails a close that is not the day's highest block", () => {
    expect(broken((v) => void (on(v.address_balance_daily, FINAL).close_height = 2))).toMatch(
      /close_height is not the day's highest block/,
    );
  });

  it("fails an address with a day missing, or one that stops before the final day", () => {
    expect(broken((v) => drop(v, "address_balance_daily", DAYS[0]!))).toEqual("");
    expect(
      broken((v) => {
        v.address_balance_daily!.push({
          address: MINER.replace(/.$/, (c) => (c === "a" ? "b" : "a")),
          day: DAYS[0],
          balance_zat: 1n,
          close_height: 1,
        });
      }),
    ).toMatch(/not a mainnet t-address/);
    expect(broken((v) => drop(v, "address_balance_daily", FINAL))).toMatch(
      /no row for the final day: 1 \(e\.g\. address_balance_daily\)/,
    );
    const second = base58checkEncode(
      Uint8Array.from([0x1c, 0xb8, ...new Array<number>(20).fill(7)]),
    );
    expect(
      broken((v) => {
        v.address_balance_daily!.push(
          { address: second, day: DAYS[0], balance_zat: 5n, close_height: 1 },
          { address: second, day: DAYS[2], balance_zat: 5n, close_height: 5 },
        );
      }),
    ).toMatch(/stops before the final day/);
  });

  it("fails a balance below zero", () => {
    expect(broken((v) => void (on(v.address_balance_daily, FINAL).balance_zat = -1n))).toMatch(
      /balance below zero/,
    );
  });
});
