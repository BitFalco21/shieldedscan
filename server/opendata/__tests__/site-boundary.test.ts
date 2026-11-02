import { describe, expect, it } from "vitest";
import { DailyBoundary, type BoundaryTx } from "../site-boundary";

const DAY = 86_400n;
const T0 = 1_700_000_000n - (1_700_000_000n % DAY);
const D0 = new Date(Number(T0) * 1000).toISOString().slice(0, 10);
const hex = (n: number) => n.toString(16).padStart(64, "0");

const tx = (over: Partial<BoundaryTx>): BoundaryTx => ({
  txid: hex(1),
  timestamp: T0,
  kind: "mixed",
  direction: null,
  version: 5,
  fee_zat: 0n,
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
});
const sapling = (b: bigint) => ({
  sapling_spends: 1,
  sapling_outputs: 1,
  sapling_value_balance_zat: b,
});
const orchard = (b: bigint) => ({ orchard_actions: 1, orchard_value_balance_zat: b });

describe("boundary_daily's maxima, from the stream", () => {
  it("keeps the largest amount, its ties, and names a transaction only when it is unique", () => {
    const b = new DailyBoundary();
    b.push(tx({ txid: hex(3), direction: "shielding", ...sapling(700n) }));
    b.push(tx({ txid: hex(2), direction: "shielding", ...orchard(700n) }));
    b.push(tx({ txid: hex(4), direction: "shielding", ...sapling(5n) }));
    b.push(tx({ txid: hex(5), direction: "unshielding", ...sapling(-900n) }));
    b.push(tx({ txid: hex(6), direction: "indeterminate", ...sapling(1n), ...orchard(-2n) }));
    const [r] = b.recordRows(D0, [D0]);
    expect(r).toEqual({
      day: D0,
      shielding_txs: 3,
      unshielding_txs: 1,
      indeterminate_txs: 1,
      migration_txs: 0,
      max_shielding_zat: 700n,
      max_shielding_ties: 2,
      max_shielding_txid: null,
      max_unshielding_zat: 900n,
      max_unshielding_ties: 1,
      max_unshielding_txid: hex(5),
      max_migration_zat: null,
      max_migration_ties: 0,
      max_migration_txid: null,
    });
  });

  it("writes a row for a day with no crossing, as the tracker does", () => {
    const b = new DailyBoundary();
    const next = new Date(Number(T0 + DAY) * 1000).toISOString().slice(0, 10);
    expect(b.recordRows(next, [D0, next]).map((r) => [r.day, r.shielding_txs])).toEqual([
      [D0, 0],
      [next, 0],
    ]);
  });
});

describe("pool migrations, from the stream", () => {
  it("files one gaining pool by its sources, multi when several lose, and skips two gaining", () => {
    const b = new DailyBoundary();
    b.push(tx({ txid: hex(1), kind: "shielded", ...sapling(-500n), ...orchard(500n) }));
    // Sprout's node sign: vpub_net -300 is 300 entering Sprout.
    b.push(
      tx({
        txid: hex(2),
        kind: "shielded",
        sprout_joinsplits: 1,
        sprout_vpub_net_zat: -300n,
        ...sapling(-100n),
        ...orchard(-200n),
      }),
    );
    b.push(
      tx({
        txid: hex(3),
        kind: "shielded",
        ...sapling(5n),
        ...orchard(-1n),
        ironwood_actions: 1,
        ironwood_value_balance_zat: 1n,
      }),
    );
    // A mixed transaction is never a migration.
    b.push(tx({ txid: hex(4), direction: "shielding", ...sapling(-1n), ...orchard(9n) }));
    expect(b.migrationRows(D0)).toEqual([
      { day: D0, destination: "orchard", source: "sapling", txs: 1, zat: 500n },
      { day: D0, destination: "sprout", source: "multi", txs: 1, zat: 300n },
    ]);
    expect(b.recordRows(D0, [D0])[0]).toMatchObject({
      migration_txs: 2,
      max_migration_zat: 500n,
      max_migration_txid: hex(1),
    });
  });
});

describe("shielding flow, from the stream", () => {
  it("sums each non-coinbase transaction's net by sign, Sprout negated, coinbase excluded", () => {
    const b = new DailyBoundary();
    b.push(tx({ kind: "mixed", ...sapling(400n), ...orchard(-100n) }));
    b.push(tx({ kind: "mixed", sprout_joinsplits: 1, sprout_vpub_net_zat: 250n }));
    b.push(tx({ kind: "coinbase", ...orchard(1_000n) }));
    b.push(tx({ kind: "transparent" }));
    expect(b.flowRows(D0)).toEqual([{ day: D0, shielded_zat: 300n, unshielded_zat: 250n }]);
  });
});

describe("pool boundary legs, from the stream", () => {
  it("files legs by direction, a contradicted one under hub once, and coinbase apart", () => {
    const b = new DailyBoundary();
    b.push(tx({ direction: "shielding", ...sapling(400n), ...orchard(100n) }));
    // Shielding while Sapling fell: a published pool contradicts it, so it is a hub row.
    b.push(tx({ direction: "shielding", ...sapling(-50n), ...orchard(80n) }));
    b.push(tx({ direction: "unshielding", ...orchard(-70n) }));
    b.push(tx({ kind: "coinbase", ...orchard(1_000n) }));
    // A present pool that moved nothing has no leg; an absent one never has.
    b.push(tx({ direction: "shielding", ...sapling(0n), ...orchard(9n) }));
    const rows = new Map(b.boundaryRows(D0).map((r) => [r.pool, r]));
    expect([...rows.keys()].sort()).toEqual(["hub", "orchard", "sapling"]);
    expect(rows.get("sapling")).toMatchObject({ shielded_zat: 400n, shielded_txs: 1, hub_txs: 0 });
    expect(rows.get("orchard")).toMatchObject({
      shielded_zat: 109n,
      shielded_txs: 2,
      unshielded_zat: 70n,
      unshielded_txs: 1,
      coinbase_zat: 1_000n,
      coinbase_txs: 1,
    });
    expect(rows.get("hub")).toMatchObject({ hub_zat: 130n, hub_txs: 1, shielded_txs: 0 });
  });

  it("makes every unsettled or undirected mixed transaction a hub row", () => {
    const b = new DailyBoundary();
    b.push(tx({ direction: "indeterminate", ...sapling(5n), ...orchard(-5n) }));
    b.push(tx({ direction: null, ...sapling(3n) }));
    const hub = b.boundaryRows(D0).find((r) => r.pool === "hub");
    expect(hub).toMatchObject({ hub_zat: 13n, hub_txs: 2 });
  });
});
