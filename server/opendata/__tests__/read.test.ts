import { rebuildRollups } from "../../rollup/run";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tableFromIPC } from "apache-arrow";
import { readParquet } from "parquet-wasm";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base58checkEncode } from "@/domain/encoding/base58check";
import { computeMiningDay } from "../../mining-daily";
import { readAddresses } from "../addresses";
import { readLedgerRange } from "../ledger";
import { releaseLedger } from "../ledger-release";
import { exportTypes, readRelease, type Release } from "../read";
import {
  dayOf,
  hex,
  MIGRATION_HEIGHT,
  MINER,
  RELEASE,
  seedChain,
  SPACING,
  START,
  TIP,
} from "./support/chain";
import { OPENDATA_ROLE_LOCK, READER_PASSWORD } from "./support/role-lock";

/**
 * The export end to end against a real PostgreSQL, through the restricted `opendata_reader` role,
 * on a small consistent chain; then the same chain broken one way at a time, each of which must
 * stop the release. Skips without TEST_DATABASE_URL (an owner connection), like the other DB suites:
 *
 *   TEST_DATABASE_URL=postgres://explorer:<pw>@localhost:55432/explorer npx vitest run server/opendata
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const DB = `opendata_test_${process.pid}`;
const ROOT = join(__dirname, "../../..");

/** A second well-formed mainnet P2PKH address (prefix 1cbd), for a payout that disagrees. */
const MINER_2 = base58checkEncode(Uint8Array.from([0x1c, 0xbd, ...new Array<number>(20).fill(9)]));

describe.skipIf(!ADMIN_URL)("open data export", () => {
  let admin: Client;
  let db: Client;
  let connection: { connectionString: string };

  // Each run writes into its own directory, remembered so `read` can find the files.
  const outDirs = new Map<Release, string>();
  const run = async (withLedger = false): Promise<Release> => {
    const outDir = mkdtempSync(join(tmpdir(), "opendata-test-"));
    const cacheDir = join(outDir, "ledger-cache");
    const r = await readRelease({
      connection,
      outDir,
      now: () => START + (TIP + 8) * SPACING,
      ...(withLedger
        ? { ledger: (ctx) => releaseLedger(ctx, { cacheDir, outDir, trusted: () => false }) }
        : {}),
    });
    outDirs.set(r, outDir);
    return r;
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${DB}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    for (const f of ["server/schema-chain.sql", "server/schema.sql", "server/schema-net.sql"]) {
      await db.query(readFileSync(join(ROOT, f), "utf8"));
    }
    // The role is cluster-wide and ledger-release.test.ts sets it up too: one suite at a time.
    await admin.query("SELECT pg_advisory_lock($1)", [OPENDATA_ROLE_LOCK]);
    try {
      await db.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opendata_reader') THEN
          CREATE ROLE opendata_reader LOGIN CONNECTION LIMIT 2 PASSWORD '${READER_PASSWORD}';
        END IF; END $$`);
      // A role may be left over from another run: set this run's password.
      await db.query(`ALTER ROLE opendata_reader PASSWORD '${READER_PASSWORD}'`);
      await db.query(readFileSync(join(ROOT, "server/schema-opendata.sql"), "utf8"));
    } finally {
      await admin.query("SELECT pg_advisory_unlock($1)", [OPENDATA_ROLE_LOCK]);
    }
    const reader = new URL(url.toString());
    reader.username = "opendata_reader";
    reader.password = READER_PASSWORD;
    connection = { connectionString: reader.toString() };

    await seedChain(db, url);
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
    for (const dir of outDirs.values()) rmSync(dir, { recursive: true, force: true });
  });

  const read = (r: Release, path: string) => {
    const f = r.files.find((x) => x.path === path);
    if (!f) throw new Error(`no ${path}`);
    const bytes = new Uint8Array(readFileSync(join(outDirs.get(r)!, f.path)));
    return tableFromIPC(readParquet(bytes).intoIPCStream());
  };

  it("exports a consistent chain with no failures, to the release height", async () => {
    const r = await run();
    expect(r.failures).toEqual([]);
    expect(r.height).toBe(RELEASE);
    expect(r.hash).toBe(hex(RELEASE + 1));
    expect(r.files.map((f) => f.path)).toEqual([
      "blocks/0000000-0499999.parquet",
      "blocks_coinbase/0000000-0499999.parquet",
      "pool_usage_daily.parquet",
      "shielding_daily.parquet",
      "transparent_daily.parquet",
      "transparent_monthly.parquet",
      "node_releases_daily.parquet",
      "reorgs.parquet",
      "blocks_daily.parquet",
      "fees_daily.parquet",
      "mining_daily.parquet",
      "hashrate_daily.parquet",
      "supply_daily.parquet",
      "nsm_daily.parquet",
      "block_arrival_daily.parquet",
      "nu7_capable_releases.parquet",
      "transactions/0000000-0099999.parquet",
      "tx_versions_daily.parquet",
      "pool_flows_daily.parquet",
      "coinbase_shielded_daily.parquet",
      "tx_kinds_daily.parquet",
      "pools_daily.parquet",
      "pool_boundary_daily.parquet",
      "shielding_flow_daily.parquet",
      "pool_migration_daily.parquet",
      "fees_monthly.parquet",
      "shielding_records_daily.parquet",
      "mining_payouts_daily.parquet",
      "address_balance_daily.parquet",
      "mining_concentration_daily.parquet",
    ]);
    // The tracked address's balances, through the final day and at each day's highest block.
    const balancesDaily = read(r, "address_balance_daily.parquet");
    expect(balancesDaily.numRows).toBeGreaterThan(40);
    expect(balancesDaily.schema.fields.map((f) => f.name)).toEqual([
      "address",
      "day",
      "balance_zat",
      "close_height",
    ]);
    expect(read(r, "transactions/0000000-0099999.parquet").numRows).toBe((RELEASE + 1) * 2 + 1);
    const balances = read(r, "transactions/0000000-0099999.parquet").getChild(
      "sapling_value_balance_zat",
    )!;
    let sapling = 0n;
    for (let i = 0; i < balances.length; i++) sapling += (balances.get(i) as bigint | null) ?? 0n;
    expect(sapling).toBe(BigInt(RELEASE - 100) * 1000n - 500n);
    const mining = read(r, "mining_daily.parquet")
      .toArray()
      .map((x) => x.miner);
    expect(new Set(mining)).toEqual(new Set(["Foundry USA", "unidentified"]));
    expect(read(r, "blocks_daily.parquet").getChild("median_interval_s")!.get(0)).toBe(SPACING);
    const blocks = read(r, "blocks/0000000-0499999.parquet");
    expect(blocks.numRows).toBe(RELEASE + 1);
    expect(blocks.schema.fields.map((f) => f.name)).not.toContain("miner_address");
    expect(blocks.schema.fields.map((f) => f.name)).not.toContain("coinbase_tag");
    // Slow start: Σ 62,500 × h for h ≤ RELEASE (< 10,000), less what Sapling holds.
    expect(blocks.getChild("transparent_pool_zat")!.get(RELEASE)).toBe(
      (62_500n * BigInt(RELEASE) * BigInt(RELEASE + 1)) / 2n - BigInt(RELEASE - 100) * 1000n,
    );
    // Every final day's supply is exactly the schedule: nothing unclaimed, nothing above it.
    const supply = read(r, "supply_daily.parquet").toArray();
    expect(supply.length).toBeGreaterThan(0);
    for (const row of supply) expect(row.unclaimed_zat).toBe(0n);
    expect(
      read(r, "tx_versions_daily.parquet")
        .toArray()
        .map((x) => x.version),
    ).toContain(5);
    expect(blocks.getChild("sapling_pool_zat")!.get(99)).toBeNull();
    // Only days at least three days behind block N's day are final.
    const days = [...read(r, "shielding_daily.parquet").getChild("day")!].map((d) =>
      new Date(Number(d)).toISOString().slice(0, 10),
    );
    expect(days.at(-1)).toBe(r.finalDay);
    expect(r.finalDay < dayOf(RELEASE)).toBe(true);
    expect(read(r, "shielding_daily.parquet").schema.fields.map((f) => f.name)).toEqual([
      "day",
      "shielding_txs",
      "unshielding_txs",
      "indeterminate_txs",
      "migration_txs",
    ]);
  });

  it("publishes the site's series, cut at the final day and equal to the stream", async () => {
    const r = await run();
    const rows = (path: string) => read(r, path).toArray();
    const day = (v: unknown) => new Date(Number(v)).toISOString().slice(0, 10);
    expect(
      rows("pool_migration_daily.parquet").map((m) => [
        day(m.day),
        m.destination,
        m.source,
        m.txs,
        m.zat,
      ]),
    ).toEqual([[dayOf(MIGRATION_HEIGHT), "orchard", "sapling", 1, 500n]]);
    const records = rows("shielding_records_daily.parquet");
    expect(records.find((x) => day(x.day) === dayOf(MIGRATION_HEIGHT))).toMatchObject({
      max_migration_zat: 500n,
      max_migration_ties: 1,
      max_migration_txid: hex(5000),
      max_shielding_ties: 2,
      max_shielding_txid: null,
    });
    const payouts = rows("mining_payouts_daily.parquet");
    expect(new Set(payouts.map((x) => [x.kind, x.address].join(" ")))).toEqual(
      new Set([`transparent ${MINER}`]),
    );
    expect(payouts.reduce((n, x) => n + (x.blocks as number), 0)).toBe(
      rows("blocks_daily.parquet").reduce((n, x) => n + (x.blocks as number), 0),
    );
    const pools = rows("pools_daily.parquet");
    expect(day(pools.at(-1)!.day)).toBe(r.finalDay);
    expect(pools.at(-1)!.orchard_pool_zat).toBe(500n);
    // Complete months only: the final day is in December. The migration is November's one
    // shielded transaction.
    expect(rows("fees_monthly.parquet").map((m) => [day(m.month), m.kind, m.txs])).toEqual([
      ["2016-10-01", "mixed", 16],
      ["2016-11-01", "mixed", 120],
      ["2016-11-01", "shielded", 1],
    ]);
    expect(rows("pool_boundary_daily.parquet").some((x) => x.pool === "hub")).toBe(true);
  });

  it("publishes each block's coinbase beside its blocks file, and the NU7 tables", async () => {
    const r = await run();
    expect(r.failures).toEqual([]);
    const coinbase = read(r, "blocks_coinbase/0000000-0499999.parquet");
    expect(coinbase.schema.fields.map((f) => [f.name, String(f.type), f.nullable])).toEqual([
      ["height", "Int32", false],
      ["miner_address", "Utf8", true],
      ["coinbase_tag", "Utf8", true],
    ]);
    const rows = coinbase.toArray();
    expect(rows.map((x) => x.height)).toEqual(
      [...read(r, "blocks/0000000-0499999.parquet").getChild("height")!].map(Number),
    );
    expect(rows[3]).toMatchObject({
      height: 3,
      miner_address: MINER,
      coinbase_tag: "Foundry Zcash Pool",
    });
    expect(rows[4]).toMatchObject({ height: 4, coinbase_tag: "tag" });

    // NU7 is far above this chain: the table is empty, with its schema, and that is no failure.
    const nsm = read(r, "nsm_daily.parquet");
    expect(nsm.numRows).toBe(0);
    expect(nsm.schema.fields.map((f) => f.name)).toEqual([
      "day",
      "nsm_inflow_zat",
      "nsm_total_zat",
    ]);

    expect(
      read(r, "nu7_capable_releases.parquet")
        .toArray()
        .map((x) => [x.client, x.min_version, x.source_url]),
    ).toEqual([
      ["Zakura", "1.7.0", "https://github.com/zakura-core/zakura/releases/tag/v1.7.0"],
      ["Zebra", "7.0.0", "https://zfnd.org/zebra-7-0-0-release/"],
    ]);

    // One payout address mines everything; four blocks a day, so the window fills at 120.
    const concentration = read(r, "mining_concentration_daily.parquet").toArray();
    expect(concentration.length).toBe(read(r, "blocks_daily.parquet").numRows);
    expect(concentration[0]).toMatchObject({ blocks: 4, distinct_addresses: 1, top1_share: 1 });
    expect(concentration.at(-1)).toMatchObject({
      blocks: 120,
      transparent_blocks: 120,
      shielded_blocks: 0,
      no_address_blocks: 0,
      top5_share: 1,
    });
  });

  it("writes the same bytes twice", async () => {
    const [a, b] = [await run(), await run()];
    expect(a.files.map((f) => f.sha256)).toEqual(b.files.map((f) => f.sha256));
  });

  it("publishes every block's age on arrival, never a pool's, and no unrecorded day", async () => {
    const { rows: firstDay } = await db.query<{ day: string }>(
      `SELECT to_char((to_timestamp(min(timestamp)) AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day
         FROM block`,
    );
    const day = firstDay[0]!.day;
    await db.query(
      `INSERT INTO block_arrival_day (day, grp, blocks, measured, late, p50_seconds, p90_seconds,
                                      computed_at)
       VALUES ($1::date, 'all', 4, 3, 1, -2, 30, 0), ($1::date, 'foundry', 4, 3, 1, NULL, NULL, 0),
              ($1::date + 1, 'all', 4, 0, 0, NULL, NULL, 0)`,
      [day],
    );
    try {
      const rows = read(await run(), "block_arrival_daily.parquet").toArray();
      expect(rows.map((r) => [r.blocks, r.measured, r.late, r.p50_seconds, r.p90_seconds])).toEqual(
        [[4, 3, 1, -2, 30]],
      );
    } finally {
      await db.query("DELETE FROM block_arrival_day");
    }
  });

  it("publishes only known clients and well-formed versions", async () => {
    const nodes = read(await run(), "node_releases_daily.parquet");
    const rows = nodes.toArray().map((r) => [r.client, r.version, r.nodes]);
    expect(rows).toEqual([
      ["Zakura", "1.7.0", 50],
      ["Zebra", null, 3],
      ["other", null, 1],
    ]);
  });

  it("reads the ledger by height range and holds it to the blocks", async () => {
    const client = new Client({ ...connection, types: exportTypes });
    await client.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const read = async (
        from: number,
        to: number,
        opts: { partRows?: number; chunkBytes?: number },
      ) => {
        const parts: number[] = [];
        const heights: number[][] = [];
        const range = await readLedgerRange(client, from, to, {
          ...opts,
          onPart: (io, part) => {
            parts.push(part);
            heights.push(io[1] as number[]);
          },
        });
        return { range, parts, heights };
      };
      const all = await read(0, RELEASE, {});
      expect(all.range.checker.failures.list()).toEqual([]);
      expect(all.range.checker.underclaimZat).toBe(0n);
      expect(all.parts).toEqual([0]);
      expect(all.heights[0]!.length).toBe(RELEASE + 1 + (RELEASE - 100));
      expect(all.range.extra[0]!.length).toBe((RELEASE + 1) * 2 + 1);

      // Small parts and two-block queries (1,000-byte blocks) give the same rows, cut between blocks.
      const split = await read(0, RELEASE, { partRows: 50, chunkBytes: 2_500 });
      expect(split.range.checker.failures.list()).toEqual([]);
      expect(split.parts.length).toBeGreaterThan(3);
      expect(split.heights.flat()).toEqual(all.heights[0]);
      for (let i = 1; i < split.heights.length; i++) {
        expect(split.heights[i]![0]).toBeGreaterThan(split.heights[i - 1]!.at(-1)!);
      }

      // A range that starts mid-chain reads its previous block for the deltas.
      const mid = await read(150, 179, {});
      expect(mid.range.checker.failures.list()).toEqual([]);
      expect(mid.heights[0]!.length).toBe(60);
      await client.query("COMMIT");
    } finally {
      await client.end();
    }
  });

  it("publishes the ledger's open range, held to the supply audit", async () => {
    const r = await run(true);
    expect(r.failures).toEqual([]);
    expect(r.ledger).toMatchObject({
      status: "published",
      carried: 0,
      built: [],
      underclaimZat: 0n,
    });
    expect(r.files.map((f) => f.path).slice(-2)).toEqual([
      "transparent_io/0000000-0009999-000.parquet",
      "transactions_extra/0000000-0009999.parquet",
    ]);
    const io = read(r, "transparent_io/0000000-0009999-000.parquet");
    expect(io.numRows).toBe(RELEASE + 1 + (RELEASE - 100));
    expect([...io.getChild("block_height")!].at(-1)).toBe(RELEASE);
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM tx WHERE block_height <= $1",
      [RELEASE],
    );
    expect(read(r, "transactions_extra/0000000-0009999.parquet").numRows).toBe(rows[0]!.n);
  });

  /**
   * Block `h` without a fee total, its coinbase 5 zat short and the pools with it; the trackers
   * and matviews follow, as the follower would make them.
   */
  const feeless = async (h: number, sign: "-" | "+") => {
    const coinbase = `lpad(to_hex(1000000 + ${h} * 2), 64, '0')`;
    await db.query(
      `UPDATE block SET total_fee_zat = ${sign === "-" ? "NULL" : "0"} WHERE height = ${h}`,
    );
    await db.query(
      `UPDATE tx_transparent_io SET value_zat = value_zat ${sign} 5 WHERE txid = ${coinbase}`,
    );
    await db.query(
      `UPDATE block SET transparent_pool_zat = transparent_pool_zat ${sign} 5 WHERE height >= ${h}`,
    );
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${DB}`;
    const pool = new Pool({ connectionString: url.toString(), max: 2 });
    try {
      await computeMiningDay(pool, START + Math.floor((h * SPACING) / 86_400) * 86_400, 0);
      await rebuildRollups(pool);
    } finally {
      await pool.end();
    }
  };

  it("reads a fee-less block's underclaim from the pools, so the cross-check still holds", async () => {
    await feeless(150, "-");
    try {
      const r = await run(true);
      expect(r.failures).toEqual([]);
      expect(r.ledger).toMatchObject({
        underclaimZat: 5n,
        underclaimedBlocks: 1,
        skippedBlocks: 0,
      });
      const supply = read(r, "supply_daily.parquet").toArray();
      expect(supply.at(-1)!.unclaimed_zat).toBe(5n);
    } finally {
      await feeless(150, "+");
    }
  });

  it("stops when the ledger's underclaim and the supply audit disagree", async () => {
    // At 100 Sapling starts reporting, so a fee-less block there has no pool change to read: its
    // 5 zat are in the supply audit and not in the ledger's sum.
    await feeless(100, "-");
    try {
      const r = await run(true);
      expect(r.failures).toEqual([
        "ledger underclaim 0 zat differs from the supply audit's 5 zat; " +
          "1 blocks whose underclaim could not be derived are outside the ledger's sum",
      ]);
      expect(r.ledger).toMatchObject({ skippedBlocks: 1 });
    } finally {
      await feeless(100, "+");
    }
    expect((await run(true)).failures).toEqual([]);
  });

  it("cannot read anything outside the views", async () => {
    const reader = new Client(connection);
    await reader.connect();
    try {
      await expect(reader.query("SELECT miner_address FROM block LIMIT 1")).rejects.toThrow(
        /permission denied/,
      );
      await expect(reader.query("SELECT 1 FROM net_node")).rejects.toThrow(/permission denied/);
    } finally {
      await reader.end();
    }
  });

  it("publishes the addresses snapshot, rewound to the release height", async () => {
    // The ledger's one address made a real t-address, and the rich list built from it at the tip.
    await db.query("UPDATE tx_transparent_io SET address = $1 WHERE address = 't1coinbase'", [
      MINER,
    ]);
    await db.query(
      `INSERT INTO chain_address_balance (address, balance_zat, received_zat, first_height, last_height, tx_count)
       SELECT address, SUM(CASE WHEN io = 'out' THEN value_zat ELSE -value_zat END),
              SUM(CASE WHEN io = 'out' THEN value_zat ELSE 0 END), MIN(block_height),
              MAX(block_height), COUNT(DISTINCT txid)
         FROM tx_transparent_io GROUP BY address`,
    );
    await db.query(
      "INSERT INTO chain_rich_list_meta (id, unattributed_zat, computed_height) VALUES (true, 0, $1)",
      [TIP],
    );
    try {
      const outDir = mkdtempSync(join(tmpdir(), "opendata-test-"));
      const r = await readRelease({
        connection,
        outDir,
        now: () => START + (TIP + 8) * SPACING,
        addresses: (ctx) => readAddresses(ctx, { outDir }),
      });
      outDirs.set(r, outDir);
      expect(r.failures).toEqual([]);
      expect(r.addresses).toMatchObject({ height: RELEASE, rewoundFrom: TIP, rows: 1 });
      expect(r.files.map((f) => f.path).at(-1)).toBe("addresses.parquet");
      const n = BigInt(RELEASE);
      // Every coinbase up to N, less the 1,000 zat spent from 101; its coinbases and spends.
      expect(
        read(r, "addresses.parquet")
          .toArray()
          .map((x) => [x.address, x.balance_zat, x.tx_count]),
      ).toEqual([[MINER, (62_500n * n * (n + 1n)) / 2n - (n - 100n) * 1000n, 2n * n - 99n]]);

      // The role reads the rich list through its two views, never the tables or the rank.
      const reader = new Client(connection);
      await reader.connect();
      try {
        for (const sql of [
          "SELECT address FROM chain_address_balance LIMIT 1",
          "SELECT computed_height FROM chain_rich_list_meta",
        ]) {
          await expect(reader.query(sql)).rejects.toThrow(/permission denied/);
        }
        await expect(reader.query("SELECT rank FROM opendata.addresses")).rejects.toThrow(
          /column "rank" does not exist/,
        );
        const { rows } = await reader.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM opendata.addresses",
        );
        expect(rows[0]!.n).toBe(1);
      } finally {
        await reader.end();
      }
    } finally {
      await db.query("DELETE FROM chain_rich_list_meta");
      await db.query("DELETE FROM chain_address_balance");
      await db.query("UPDATE tx_transparent_io SET address = 't1coinbase' WHERE address = $1", [
        MINER,
      ]);
    }
  });

  const breaks: [string, string, string, RegExp][] = [
    [
      "a flow that disagrees with its pool",
      "UPDATE block SET sapling_flow_zat = 999 WHERE height = 150",
      "UPDATE block SET sapling_flow_zat = 1000 WHERE height = 150",
      /sapling flow differs/,
    ],
    [
      "a pool reported, then missing",
      "UPDATE block SET sapling_pool_zat = NULL WHERE height = 160",
      "UPDATE block SET sapling_pool_zat = 59500 WHERE height = 160",
      /sapling_pool_zat NULL after a value/,
    ],
    [
      "a missing block",
      `UPDATE tx SET block_height = NULL WHERE block_height = 120;
       UPDATE block SET height = 100000 WHERE height = 120`,
      `UPDATE block SET height = 120 WHERE height = 100000;
       UPDATE tx SET block_height = 120 WHERE txid IN (lpad(to_hex(1000240), 64, '0'), lpad(to_hex(1000241), 64, '0'))`,
      /height gap/,
    ],
    [
      "daily directions that do not add up",
      `UPDATE pool_usage_daily SET shielding = 3 WHERE day = '${dayOf(40)}'`,
      `UPDATE pool_usage_daily SET shielding = 2 WHERE day = '${dayOf(40)}'`,
      /pool_usage directions do not add up/,
    ],
    [
      "daily counts that differ from the blocks",
      `UPDATE boundary_daily SET shielding_txs = 9 WHERE day = '${dayOf(40)}'`,
      `UPDATE boundary_daily SET shielding_txs = 2 WHERE day = '${dayOf(40)}'`,
      /daily directions differ from the blocks/,
    ],
    [
      "a reorg row that is not a hash",
      "UPDATE reorg_event SET replaced_by = 'http://evil.example'",
      `UPDATE reorg_event SET replaced_by = '${hex(78)}'`,
      /reorgs.replaced_by: a value is not a block hash/,
    ],
    [
      "a transaction missing from its block",
      `UPDATE tx SET block_height = NULL WHERE txid = lpad(to_hex(1000000 + 50 * 2 + 1), 64, '0')`,
      `UPDATE tx SET block_height = 50 WHERE txid = lpad(to_hex(1000000 + 50 * 2 + 1), 64, '0')`,
      /transaction count differs from the block's/,
    ],
    [
      "fees that do not add up to the block's",
      `UPDATE tx SET fee_zat = 5 WHERE txid = lpad(to_hex(1000000 + 60 * 2 + 1), 64, '0')`,
      `UPDATE tx SET fee_zat = 0 WHERE txid = lpad(to_hex(1000000 + 60 * 2 + 1), 64, '0')`,
      /transaction fees do not sum to the block's fee/,
    ],
    [
      "a direction on a transaction that is not mixed",
      `UPDATE tx SET direction = 'shielding' WHERE txid = lpad(to_hex(1000000 + 70 * 2), 64, '0')`,
      `UPDATE tx SET direction = NULL WHERE txid = lpad(to_hex(1000000 + 70 * 2), 64, '0')`,
      /direction does not match kind/,
    ],
    [
      "balances that do not add up to the block's pool flow",
      `UPDATE tx SET sapling_value_balance_zat = 999 WHERE txid = lpad(to_hex(1000000 + 150 * 2 + 1), 64, '0')`,
      `UPDATE tx SET sapling_value_balance_zat = 1000 WHERE txid = lpad(to_hex(1000000 + 150 * 2 + 1), 64, '0')`,
      /transaction balances do not sum to the block's pool flows/,
    ],
    [
      "a supply one zatoshi above the protocol schedule",
      "UPDATE block SET transparent_pool_zat = transparent_pool_zat + 1 WHERE height >= 150",
      "UPDATE block SET transparent_pool_zat = transparent_pool_zat - 1 WHERE height >= 150",
      /supply above the protocol schedule/,
    ],
    [
      "Sprout JoinSplits without their public value",
      `UPDATE tx SET sprout_joinsplits = 1 WHERE txid = lpad(to_hex(1000000 + 80 * 2 + 1), 64, '0')`,
      `UPDATE tx SET sprout_joinsplits = NULL WHERE txid = lpad(to_hex(1000000 + 80 * 2 + 1), 64, '0')`,
      /Sprout JoinSplits without their public value/,
    ],
  ];

  // The site's series: empty, stale, or disagreeing with the stream. Each must stop the release,
  // never be published as current. A rollup's rows are set aside in a temporary table (this
  // session's) and put back by the fix.
  const setAside = (table: string, where: string) =>
    `CREATE TEMP TABLE set_aside AS SELECT * FROM ${table} WHERE ${where};
     DELETE FROM ${table} WHERE ${where}`;
  const putBack = (table: string) =>
    `INSERT INTO ${table} SELECT * FROM set_aside; DROP TABLE set_aside`;
  breaks.push(
    [
      "a rollup never filled",
      setAside("chain_day_pool_boundary", "true"),
      putBack("chain_day_pool_boundary"),
      /stale view: no row for the final day: 1 \(e\.g\. chain_day_pool_boundary\)/,
    ],
    [
      "a rollup that stopped before the final day",
      setAside(
        "chain_day_fee_total",
        `ts > ${START + Math.floor((150 * SPACING) / 86_400) * 86_400}`,
      ),
      putBack("chain_day_fee_total"),
      /stale view: no row for the final day: 1 \(e\.g\. chain_day_fee_total\)/,
    ],
    [
      "a rollup keyed in another time zone",
      "UPDATE chain_day_network SET ts = ts - 32400",
      "UPDATE chain_day_network SET ts = ts + 32400",
      /day not truncated in UTC.*chain_day_network/,
    ],
    [
      "a tracker that stopped before the final day",
      `UPDATE boundary_daily SET day = day + 10000 WHERE day > '${dayOf(150)}'`,
      `UPDATE boundary_daily SET day = day - 10000 WHERE day > '${dayOf(150)}'::date + 9000`,
      /stale view: no row for the final day: 1 \(e\.g\. boundary_daily\)/,
    ],
    [
      "a rollup that disagrees with the stream",
      `UPDATE chain_day_pool_tx SET txs = txs - 1
        WHERE pool = 'orchard' AND day = '${dayOf(MIGRATION_HEIGHT)}'`,
      `UPDATE chain_day_pool_tx SET txs = txs + 1
        WHERE pool = 'orchard' AND day = '${dayOf(MIGRATION_HEIGHT)}'`,
      /pool_flows_daily differs from chain_day_pool_tx/,
    ],
    [
      "migrations that differ from the day's count",
      `UPDATE boundary_daily SET migration_txs = 2 WHERE day = '${dayOf(MIGRATION_HEIGHT)}'`,
      `UPDATE boundary_daily SET migration_txs = 1 WHERE day = '${dayOf(MIGRATION_HEIGHT)}'`,
      /pool_migration_daily differs from boundary_daily/,
    ],
    [
      "a record txid that is not a transaction id",
      `UPDATE boundary_daily SET max_migration_txid = 'not-a-txid' WHERE day = '${dayOf(MIGRATION_HEIGHT)}'`,
      `UPDATE boundary_daily SET max_migration_txid = '${hex(5000)}' WHERE day = '${dayOf(MIGRATION_HEIGHT)}'`,
      /max_migration_txid: not a transaction id/,
    ],
    [
      "a payout fee that differs from the stream",
      `UPDATE mining_day_payout SET fee_zat = fee_zat + 1 WHERE day = '${dayOf(40)}'`,
      `UPDATE mining_day_payout SET fee_zat = fee_zat - 1 WHERE day = '${dayOf(40)}'`,
      /mining_payouts_daily differs from the stream/,
    ],
    [
      "a payout address that is not a t-address",
      `UPDATE mining_day_payout SET address = 't1' || repeat('a', 33) WHERE day = '${dayOf(40)}'`,
      `UPDATE mining_day_payout SET address = '${MINER}' WHERE day = '${dayOf(40)}'`,
      /mining payout address is not a mainnet t-address/,
    ],
    [
      "a coinbase payout address that is not a t-address",
      `UPDATE block SET miner_address = 't1' || repeat('a', 33) WHERE height = 50`,
      `UPDATE block SET miner_address = '${MINER}' WHERE height = 50`,
      /miner_address is not a mainnet t-address: 1 \(e\.g\. 50\)/,
    ],
    [
      "a transparent coinbase with no payout address",
      "UPDATE block SET miner_address = NULL WHERE height = 50",
      `UPDATE block SET miner_address = '${MINER}' WHERE height = 50`,
      /miner_address does not match miner_kind/,
    ],
    [
      "coinbase text not in its sanitised form",
      `UPDATE block SET coinbase_tag = E'raw\\x01bytes' WHERE height = 50`,
      "UPDATE block SET coinbase_tag = 'tag' WHERE height = 50",
      /coinbase_tag is not in its sanitised form: 1 \(e\.g\. 50\)/,
    ],
    [
      "payouts credited to another address than the blocks name",
      `UPDATE mining_day_payout SET address = '${MINER_2}' WHERE day = '${dayOf(40)}'`,
      `UPDATE mining_day_payout SET address = '${MINER}' WHERE day = '${dayOf(40)}'`,
      /mining_concentration_daily differs from mining_payouts_daily/,
    ],
    [
      "a published day with blocks of no recorded miner",
      `UPDATE mining_day SET unrecorded_blocks = 1 WHERE day = '${dayOf(40)}'`,
      `UPDATE mining_day SET unrecorded_blocks = 0 WHERE day = '${dayOf(40)}'`,
      /the stream differs from mining_day/,
    ],
  );

  for (const [what, breakSql, fixSql, expected] of breaks) {
    it(`stops on ${what}`, async () => {
      await db.query(breakSql);
      try {
        const r = await run();
        expect(r.failures.join("\n")).toMatch(expected);
      } finally {
        await db.query(fixSql);
      }
      expect((await run()).failures).toEqual([]);
    });
  }
});
