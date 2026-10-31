import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tableFromIPC } from "apache-arrow";
import { readParquet } from "parquet-wasm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONFIRMATIONS, readRelease, type Release } from "../read";

/**
 * The export end to end against a real PostgreSQL, through the restricted `opendata_reader` role,
 * on a small consistent chain; then the same chain broken one way at a time, each of which must
 * stop the release. Skips without TEST_DATABASE_URL (an owner connection), like the other DB suites:
 *
 *   TEST_DATABASE_URL=postgres://explorer:<pw>@localhost:55432/explorer npx vitest run server/opendata
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const DB = `opendata_test_${process.pid}`;
const READER_PASSWORD = "opendata-test-only";
const ROOT = join(__dirname, "../../..");

const TIP = 299;
const RELEASE = TIP - CONFIRMATIONS;
const START = 1_477_612_800; // 2016-10-28 00:00 UTC
const SPACING = 6 * 3600; // four blocks a day, so the chain spans 75 days
const hex = (n: number) => n.toString(16).padStart(64, "0");
const dayOf = (h: number) => new Date((START + h * SPACING) * 1000).toISOString().slice(0, 10);

describe.skipIf(!ADMIN_URL)("open data export", () => {
  let admin: Client;
  let db: Client;
  let connection: { connectionString: string };

  // Each run writes into its own directory, remembered so `read` can find the files.
  const outDirs = new Map<Release, string>();
  const run = async (): Promise<Release> => {
    const outDir = mkdtempSync(join(tmpdir(), "opendata-test-"));
    const r = await readRelease({ connection, outDir, now: () => START + (TIP + 8) * SPACING });
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
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'opendata_reader') THEN
        CREATE ROLE opendata_reader LOGIN CONNECTION LIMIT 2 PASSWORD '${READER_PASSWORD}';
      END IF; END $$`);
    // A role is cluster-wide and may be left over from another run: set this run's password.
    await db.query(`ALTER ROLE opendata_reader PASSWORD '${READER_PASSWORD}'`);
    await db.query(readFileSync(join(ROOT, "server/schema-opendata.sql"), "utf8"));
    const reader = new URL(url.toString());
    reader.username = "opendata_reader";
    reader.password = READER_PASSWORD;
    connection = { connectionString: reader.toString() };

    // A chain whose numbers agree with each other: Sapling starts reporting at 100 and its flow
    // equals its pool's change; the pools grow by less than the slow-start ceiling each block.
    for (let h = 0; h <= TIP; h++) {
      const sapling = h >= 100 ? BigInt((h - 100) * 1000) : null;
      await db.query(
        `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count,
           transparent_tx_count, mixed_tx_count, shielded_tx_count, total_fee_zat,
           sapling_flow_zat, orchard_flow_zat, transparent_pool_zat, sapling_pool_zat,
           difficulty, miner_kind, miner_address, coinbase_tag, miner_reward_zat)
         VALUES ($1,$2,$3,$4,1000,2,0,1,0,0,$5,0,$6,$7,1.5,'transparent','t1secret','tag',100)`,
        [
          h,
          hex(h + 1),
          h === 0 ? hex(0) : hex(h),
          START + h * SPACING,
          h > 100 ? 1000 : 0,
          BigInt(h) * 1_000_000_000n,
          sapling,
        ],
      );
    }
    await db.query(
      `INSERT INTO chain_sync_state (id, tip_height, tip_hash, updated_at) VALUES (true, $1, $2, $3)`,
      [TIP, hex(TIP + 1), START + (TIP + 8) * SPACING],
    );
    for (let d = 0; d < 75; d++) {
      const day = dayOf(d * 4);
      // Four mixed transactions a day (one per block): 2 shielding, 1 unshielding, 1 indeterminate.
      await db.query(
        `INSERT INTO boundary_daily (day, shielding_txs, unshielding_txs, indeterminate_txs, migration_txs,
           max_shielding_ties, max_unshielding_ties, max_migration_ties, max_shielding_zat, max_shielding_txid, computed_at)
         VALUES ($1, 2, 1, 1, 0, 0, 0, 0, 123456789, $2, 0)`,
        [day, hex(999)],
      );
      await db.query(
        `INSERT INTO pool_usage_daily (day, pool, txs, fully_shielded, mixed, shielding, unshielding,
           indeterminate, coinbase, close_height, computed_at)
         VALUES ($1, 'sapling', 5, 1, 4, 2, 1, 1, 0, $2, 0)`,
        [day, d * 4 + 3],
      );
    }
    await db.query(
      `INSERT INTO net_release_day (day, user_agent, protocol_version, nodes, behind_tip, tip_unknown) VALUES
         ($1, '/Zakura:1.7.0/', 170190, 50, 1, 0),
         ($1, '/visit-my-site.example:1.2.3.4/', 170190, 1, 0, 0),
         ($1, '/Zebra:7.0.0-mybanner/', 170190, 3, 0, 0)`,
      [dayOf(200)],
    );
    await db.query(
      `INSERT INTO reorg_event (detected_at, height, depth, orphaned_hash, replaced_by) VALUES (0, 150, 1, $1, $2)`,
      [hex(77), hex(78)],
    );
    // Each block holds what it says: a coinbase and one mixed transaction with a zero fee that
    // carries the block's Sapling flow, shielding and unshielding in turn.
    await db.query(
      `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, version, size_bytes, kind, direction, fee_zat,
                       sapling_spends, sapling_outputs, sapling_value_balance_zat)
       SELECT lpad(to_hex(1000000 + h * 2 + k), 64, '0'), h, $1 + h * $2, k = 0, 5, 300,
              CASE WHEN k = 0 THEN 'coinbase' ELSE 'mixed' END,
              CASE WHEN k = 0 THEN NULL WHEN h % 2 = 0 THEN 'shielding' ELSE 'unshielding' END,
              CASE WHEN k = 0 THEN NULL ELSE 0 END,
              CASE WHEN k = 1 AND h > 100 THEN 0 END, CASE WHEN k = 1 AND h > 100 THEN 1 END,
              CASE WHEN k = 1 AND h > 100 THEN 1000 END
         FROM generate_series(0, $3::int) AS h, generate_series(0, 1) AS k`,
      [START, SPACING, TIP],
    );
    await db.query("REFRESH MATERIALIZED VIEW chain_day_fee_kind");
    await db.query(`UPDATE block SET coinbase_tag = 'Foundry Zcash Pool' WHERE height % 3 = 0`);
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
      "pool_usage_daily.parquet",
      "shielding_daily.parquet",
      "transparent_daily.parquet",
      "transparent_monthly.parquet",
      "node_releases_daily.parquet",
      "reorgs.parquet",
      "blocks_daily.parquet",
      "fees_daily.parquet",
      "mining_daily.parquet",
      "transactions/0000000-0099999.parquet",
    ]);
    expect(read(r, "transactions/0000000-0099999.parquet").numRows).toBe((RELEASE + 1) * 2);
    const balances = read(r, "transactions/0000000-0099999.parquet").getChild(
      "sapling_value_balance_zat",
    )!;
    let sapling = 0n;
    for (let i = 0; i < balances.length; i++) sapling += (balances.get(i) as bigint | null) ?? 0n;
    expect(sapling).toBe(BigInt(RELEASE - 100) * 1000n);
    const mining = read(r, "mining_daily.parquet")
      .toArray()
      .map((x) => x.miner);
    expect(new Set(mining)).toEqual(new Set(["Foundry USA", "unidentified"]));
    expect(read(r, "blocks_daily.parquet").getChild("median_interval_s")!.get(0)).toBe(SPACING);
    const blocks = read(r, "blocks/0000000-0499999.parquet");
    expect(blocks.numRows).toBe(RELEASE + 1);
    expect(blocks.schema.fields.map((f) => f.name)).not.toContain("miner_address");
    expect(blocks.schema.fields.map((f) => f.name)).not.toContain("coinbase_tag");
    expect(blocks.getChild("transparent_pool_zat")!.get(RELEASE)).toBe(
      BigInt(RELEASE) * 1_000_000_000n,
    );
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

  it("writes the same bytes twice", async () => {
    const [a, b] = [await run(), await run()];
    expect(a.files.map((f) => f.sha256)).toEqual(b.files.map((f) => f.sha256));
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
      "UPDATE block SET sapling_pool_zat = 60000 WHERE height = 160",
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
  ];

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
