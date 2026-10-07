import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseBlock } from "@/data/chain/parse";
import type { RpcBlock } from "@/data/chain/rpc-types";
import block3426950 from "@/data/chain/__fixtures__/block-3426950.json";
import type { Pacer } from "../job-pacer";
import { PostgresChainStore } from "../postgres-chain-store";
import {
  ADDRESS_RETENTION_DAYS,
  TransparentTracker,
  computeTransparentDay,
  countTrailingWindows,
  finalizeTransparentMonths,
  loadTransparentSeries,
  pruneTransparentAddresses,
  transparentDaysToCompute,
} from "../transparent-daily";

/**
 * The transparent tables against a real Postgres: a day's volume and distinct addresses, a month
 * counted as a UNION of its days and never their sum, a recompute that removes what a reorg
 * removed, the pruning that keeps the address rows to a few months, the trailing windows — and
 * one real captured block through the follower's own write path, so the columns read here mean
 * what the follower wrote.
 *
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/explorer \
 *     npx vitest run server/__tests__/transparent-daily-db.test.ts
 */
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const TEST_DB = "explorer_transparent_test";

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const DAY = 86_400;
const ZEC = 100_000_000;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

interface Io {
  io: "in" | "out";
  address: string | null;
  value: number | null;
}
interface Tx {
  txid: string;
  ts: number;
  kind: "transparent" | "shielded" | "mixed" | "coinbase";
  ios: Io[];
}

const pacer = (): Pacer => ({
  preflight: async () => {},
  afterUnit: async () => "continue",
  stats: { sleptMs: 0, stallSamples: 0, maxBlocksBehind: 0 },
});

describeDb("transparent tables", () => {
  let pool: Pool;
  let height = 1_000;

  /** One block per transaction, at the transaction's timestamp. */
  async function add(...txs: Tx[]): Promise<void> {
    for (const t of txs) {
      height += 1;
      await pool.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count)
         VALUES ($1, $2, $3, $4, 1000, 1)`,
        [height, `h${height}`.padEnd(64, "0"), `p${height}`.padEnd(64, "0"), t.ts],
      );
      await pool.query(
        `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, kind, size_bytes, version)
         VALUES ($1, $2, $3, $4, $5, 200, 5)`,
        [t.txid, height, t.ts, t.kind === "coinbase", t.kind],
      );
      for (const [ordinal, io] of t.ios.entries()) {
        await pool.query(
          `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, block_height)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [t.txid, io.io, ordinal, io.address, io.value, height],
        );
      }
    }
  }

  beforeAll(async () => {
    const admin = new Pool({ connectionString: withDatabase(DATABASE_URL!, "postgres"), max: 1 });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: withDatabase(DATABASE_URL!, TEST_DB) });
    await pool.query(readFileSync("server/schema-chain.sql", "utf8"));
    await pool.query(readFileSync("server/schema.sql", "utf8"));
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE transparent_daily, transparent_day_address, transparent_monthly,
                transparent_trailing, tx_transparent_io, tx, block CASCADE`,
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  const A = day("2024-01-30");
  /** Every kind of transparent activity, on one day. */
  const dayA: Tx[] = [
    {
      txid: "cb-a",
      ts: A + 10,
      kind: "coinbase",
      ios: [
        { io: "out", address: "tMiner", value: 312_500_000 },
        { io: "out", address: "tStream", value: 50_000_000 },
      ],
    },
    {
      txid: "t1",
      ts: A + 100,
      kind: "transparent",
      ios: [
        { io: "in", address: "tX", value: 1_000_000_000 },
        { io: "out", address: "tY", value: 700_000_000 },
        { io: "out", address: "tX", value: 299_990_000 },
      ],
    },
    // A shielding: transparent in, nothing transparent out.
    {
      txid: "s1",
      ts: A + 200,
      kind: "mixed",
      ios: [{ io: "in", address: "tZ", value: 500_000_000 }],
    },
    // An unshielding, one output naming no single address (an OP_RETURN, a multisig).
    {
      txid: "u1",
      ts: A + 300,
      kind: "mixed",
      ios: [
        { io: "out", address: "tW", value: 100_000_000 },
        { io: "out", address: null, value: 10_000_000 },
      ],
    },
    { txid: "z1", ts: A + 400, kind: "shielded", ios: [] },
    // An input whose value the index never resolved.
    {
      txid: "t2",
      ts: A + 500,
      kind: "transparent",
      ios: [
        { io: "in", address: "tX", value: null },
        { io: "out", address: "tV", value: 100_000_000 },
      ],
    },
  ];

  it("states a day's volume by kind and its distinct addresses", async () => {
    await add(...dayA);
    const row = await computeTransparentDay(pool, A, A + DAY);

    expect(row).toEqual({
      day: A,
      // Coinbase outputs are issuance, not movement: two from t1, two from u1, one from t2.
      outputs: 5,
      unaddressedOutputs: 1,
      outTransparentZat: 700_000_000 + 299_990_000 + 100_000_000,
      outMixedZat: 110_000_000,
      inputs: 3,
      unresolvedInputs: 1,
      // The unresolved input adds nothing: the sum is a floor, and `unresolvedInputs` says so.
      inTransparentZat: 1_000_000_000,
      inMixedZat: 500_000_000,
      // tMiner, tStream (a coinbase did pay them), tX, tY, tZ, tW, tV.
      active: 7,
      sending: 2,
      receiving: 6,
    });
    const stored = await loadTransparentSeries(pool);
    expect(stored.days).toEqual([row]);
  });

  it("drops an address with the block that carried it when the day is recomputed", async () => {
    await add(...dayA);
    await computeTransparentDay(pool, A, A + DAY);
    // A reorg removes the unshielding: tW received nothing on this chain after all.
    await pool.query("DELETE FROM tx WHERE txid = 'u1'");
    const row = await computeTransparentDay(pool, A, A + DAY);

    expect(row.active).toBe(6);
    expect(row.outMixedZat).toBe(0);
    const { rows } = await pool.query("SELECT address FROM transparent_day_address ORDER BY 1");
    expect(rows.map((r) => r.address)).not.toContain("tW");
  });

  it("counts a month as the union of its days, never their sum", async () => {
    const B = day("2024-01-31");
    const C = day("2024-02-01");
    await add(...dayA, {
      txid: "t3",
      ts: B + 50,
      kind: "transparent",
      ios: [
        { io: "in", address: "tX", value: 300_000_000 },
        { io: "out", address: "tQ", value: 299_000_000 },
      ],
    });
    await add({
      txid: "cb-c",
      ts: C + 5,
      kind: "coinbase",
      ios: [{ io: "out", address: "tMiner", value: ZEC }],
    });
    for (const d of [A, B, C]) await computeTransparentDay(pool, d, C + DAY);

    // The chain's last day is Feb 1, so January's last day is still one of the newest three.
    await finalizeTransparentMonths(pool, { first: A, last: C }, C + DAY);
    let { months } = await loadTransparentSeries(pool);
    const jan = months.find((m) => m.month === day("2024-01-01"))!;
    // Day A's seven plus tQ: tX sent on both days and is ONE address in the month.
    expect(jan).toEqual({
      month: day("2024-01-01"),
      active: 8,
      sending: 2,
      receiving: 7,
      days: 2,
      complete: false,
    });

    // Two days later January is outside the newest three, and final.
    await finalizeTransparentMonths(pool, { first: A, last: C + 2 * DAY }, C + 3 * DAY);
    ({ months } = await loadTransparentSeries(pool));
    expect(months.find((m) => m.month === day("2024-01-01"))?.complete).toBe(true);
  });

  it("leaves a month uncounted while any of its days is not computed", async () => {
    const B = day("2024-01-31");
    await add(...dayA, {
      txid: "cb-b",
      ts: B + 5,
      kind: "coinbase",
      ios: [{ io: "out", address: "tMiner", value: ZEC }],
    });
    // Only day A: January 31st is still missing, as in a backfill stopped mid-month.
    await computeTransparentDay(pool, A, B + DAY);
    expect(await finalizeTransparentMonths(pool, { first: A, last: B }, B + DAY)).toBe(0);
    expect((await loadTransparentSeries(pool)).months).toEqual([]);
  });

  it("prunes a final month's address rows once they are older than the retention window", async () => {
    await add(...dayA);
    await computeTransparentDay(pool, A, A + DAY);
    const later = A + 200 * DAY;
    await finalizeTransparentMonths(pool, { first: A, last: A }, A + DAY);
    // Not final yet (its last day is the chain's newest): nothing is deleted, however old.
    expect(await pruneTransparentAddresses(pool, later)).toBe(0);
    await pool.query("UPDATE transparent_monthly SET complete = TRUE");
    // Final, and inside the window: kept.
    expect(await pruneTransparentAddresses(pool, A + (ADDRESS_RETENTION_DAYS - 1) * DAY)).toBe(0);
    // Final and older than the window: deleted, the month's count kept.
    expect(await pruneTransparentAddresses(pool, later)).toBe(7);
    const series = await loadTransparentSeries(pool);
    expect(series.months[0]?.active).toBe(7);
    expect(series.days[0]?.active).toBe(7);
  });

  it("counts the trailing windows over complete days ending yesterday, and only whole ones", async () => {
    // Eight days, each paying the miner and one address of its own.
    const D1 = day("2024-03-01");
    for (let i = 0; i < 8; i += 1) {
      await add({
        txid: `cb-${i}`,
        ts: D1 + i * DAY + 30,
        kind: "coinbase",
        ios: [
          { io: "out", address: "tMiner", value: ZEC },
          { io: "out", address: `tDay${i}`, value: ZEC },
        ],
      });
      await computeTransparentDay(pool, D1 + i * DAY, D1 + 9 * DAY);
    }
    const extent = { first: D1, last: D1 + 7 * DAY };
    expect(await countTrailingWindows(pool, extent, D1 + 8 * DAY)).toBe(1);
    const { trailing } = await loadTransparentSeries(pool);
    // Through the seventh day: today (the eighth) is not complete. The miner once, seven others.
    expect(trailing).toEqual([
      { days: 7, lastDay: D1 + 6 * DAY, active: 8, sending: 0, receiving: 8 },
    ]);
  });

  it("puts the newest three days first, then the backlog newest first", async () => {
    const first = day("2024-01-01");
    const last = day("2024-01-10");
    await pool.query(
      `INSERT INTO transparent_daily (day, outputs, unaddressed_outputs, out_transparent_zat,
                                     out_mixed_zat, inputs, unresolved_inputs, in_transparent_zat,
                                     in_mixed_zat, active_addresses, sending_addresses,
                                     receiving_addresses, computed_at)
       VALUES ('2024-01-02', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
              ('2024-01-09', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`,
    );
    const days = await transparentDaysToCompute(pool, first, last);
    const iso = days.map((d) => new Date(d * 1000).toISOString().slice(0, 10));
    expect(iso).toEqual([
      "2024-01-08",
      "2024-01-09",
      "2024-01-10",
      "2024-01-07",
      "2024-01-06",
      "2024-01-05",
      "2024-01-04",
      "2024-01-03",
      "2024-01-01",
    ]);
  });

  it("runs a whole pass: every day, the months behind it, and the trailing windows", async () => {
    await add(...dayA);
    const now = day("2024-03-15");
    const tracker = new TransparentTracker({
      pool,
      pacer,
      log: () => undefined,
      now: () => now * 1000,
    });
    // The block table's last block is on day A, so the chain's day extent is that one day.
    expect(await tracker.refresh()).toEqual({ computed: 1, aborted: false });
    const series = await loadTransparentSeries(pool);
    expect(series.days.map((d) => d.active)).toEqual([7]);
    expect(series.months).toEqual([
      { month: day("2024-01-01"), active: 7, sending: 2, receiving: 6, days: 1, complete: false },
    ]);
  });

  it("counts every month a pass crosses, as it crosses it", async () => {
    const B = day("2024-01-31");
    const C = day("2024-02-01");
    await add(
      ...dayA,
      {
        txid: "t3",
        ts: B + 50,
        kind: "transparent",
        ios: [
          { io: "in", address: "tX", value: 300_000_000 },
          { io: "out", address: "tQ", value: 299_000_000 },
        ],
      },
      {
        txid: "cb-c",
        ts: C + 5,
        kind: "coinbase",
        ios: [{ io: "out", address: "tMiner", value: ZEC }],
      },
    );
    const tracker = new TransparentTracker({
      pool,
      pacer,
      log: () => undefined,
      now: () => (C + 30 * DAY) * 1000,
    });
    expect(await tracker.refresh()).toEqual({ computed: 3, aborted: false });
    const { months } = await loadTransparentSeries(pool);
    // The chain's newest block is on Feb 1, so January's last day is still one of the newest
    // three: counted as a union, and not final.
    expect(months.map((m) => [m.month, m.active, m.days, m.complete])).toEqual([
      [day("2024-01-01"), 8, 2, false],
      [day("2024-02-01"), 1, 1, false],
    ]);
  });

  it("reads a real block's columns the way the follower wrote them", async () => {
    // Through the follower's own write path: the kinds, the coinbase and the io rows are what
    // `parseBlock` and `ingestBlock` produce, not what this test assumes they are.
    const raw = block3426950 as unknown as RpcBlock;
    const parsed = parseBlock(raw);
    await new PostgresChainStore(pool, { trackSyncState: false }).ingestBlock(parsed);
    const dayStart = Math.floor(raw.time / DAY) * DAY;
    const row = await computeTransparentDay(pool, dayStart, dayStart + DAY);

    // The kinds as the follower classified them; the amounts and addresses from the parse.
    const { rows: kinds } = await pool.query<{ txid: string; kind: string }>(
      "SELECT txid, kind FROM tx",
    );
    const kindOf = new Map(kinds.map((k) => [k.txid, k.kind]));
    const nonCoinbase = parsed.transactions.filter((t) => !t.isCoinbase);
    const outputsOf = (kind: string) =>
      nonCoinbase
        .filter((t) => kindOf.get(t.txid) === kind)
        .flatMap((t) => t.outputs)
        .reduce((s, o) => s + o.valueZat, 0);
    expect(row.outputs).toBe(nonCoinbase.flatMap((t) => t.outputs).length);
    expect(row.outTransparentZat).toBe(outputsOf("transparent"));
    expect(row.outMixedZat).toBe(outputsOf("mixed"));
    expect(row.outputs).toBeGreaterThan(0);
    // These inputs spend outputs this database never saw, so none resolved.
    expect(row.inputs).toBe(nonCoinbase.flatMap((t) => t.inputRefs).length);
    expect(row.unresolvedInputs).toBe(row.inputs);
    const addresses = new Set(
      parsed.transactions
        .flatMap((t) => t.outputs.map((o) => o.address))
        .filter((a): a is string => typeof a === "string" && a !== ""),
    );
    expect(row.active).toBe(addresses.size);
  });
});
