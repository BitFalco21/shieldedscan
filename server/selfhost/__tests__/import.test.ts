// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Manifest } from "../../opendata/manifest";
import { MINER } from "../../opendata/__tests__/support/chain";
import { runImport, type ImportOptions } from "../import";
import { huggingFaceSource } from "../source";
import { serveRelease, type Hub } from "./support/hub";
import { buildRelease } from "./support/release";
import { smokeApi } from "./support/api";

/**
 * The self-host import end to end: a real release of the export suites' chain, written by the
 * exporter, served over HTTP like the Hub, imported into an empty PostgreSQL, held to the release,
 * then read through the API. Skips without TEST_DATABASE_URL, like the other DB suites.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const SOURCE_DB = `selfhost_source_${process.pid}`;
const TARGET_DB = `selfhost_target_${process.pid}`;
const SPARE_DB = `selfhost_spare_${process.pid}`;
const REPO = "test-org/zcash-mainnet";
const COMMIT = "c0ffee".padEnd(40, "0");
const ROOT = join(__dirname, "../../..");

describe.skipIf(!ADMIN_URL)("self-host import", () => {
  let admin: Client;
  let work: string;
  let manifest: Manifest;
  let hub: Hub;
  const pools: Pool[] = [];
  const lines: string[] = [];

  const database = async (name: string) => {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${name}`;
    return url.toString();
  };
  const options = (pool: Pool, endpoint: string, dataDir: string): ImportOptions => ({
    pool,
    source: huggingFaceSource({ repo: REPO, endpoint }),
    repo: REPO,
    revision: "main",
    dataDir,
    schemaDir: join(ROOT, "server"),
    jobs: 2,
    keepFiles: false,
    maintenanceWorkMem: "64MB",
    log: (l) => lines.push(l),
  });

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    work = mkdtempSync(join(tmpdir(), "selfhost-test-"));
    const releaseDir = join(work, "release");
    manifest = await buildRelease(ADMIN_URL!, SOURCE_DB, releaseDir);
    hub = await serveRelease({ dir: releaseDir, repo: REPO, commit: COMMIT });
  }, 120_000);

  afterAll(async () => {
    for (const p of pools) await p.end().catch(() => undefined);
    await hub?.close();
    for (const db of [TARGET_DB, SPARE_DB]) {
      await admin?.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    }
    await admin?.end();
    rmSync(work, { recursive: true, force: true });
  });

  it("imports the release, rebuilds what derives from it, and passes every check", async () => {
    const pool = new Pool({ connectionString: await database(TARGET_DB), max: 4 });
    pools.push(pool);
    const started = Date.now();
    const result = await runImport(options(pool, hub.endpoint, join(work, "data")));
    lines.push(`import took ${Date.now() - started} ms`);
    expect(result.failures).toEqual([]);
    expect(result.commit).toBe(COMMIT);

    const one = async (sql: string) => (await pool.query(sql)).rows[0] as Record<string, unknown>;
    expect(await one("SELECT tip_height, tip_hash FROM chain_sync_state")).toEqual({
      tip_height: manifest.height,
      tip_hash: manifest.hash,
    });
    // The companion files landed in their columns.
    expect(
      await one(
        `SELECT count(*) FILTER (WHERE miner_address = '${MINER}')::int AS addressed,
                count(*) FILTER (WHERE coinbase_tag = 'Foundry Zcash Pool')::int AS tagged,
                count(received_at)::int AS received
           FROM block`,
      ),
    ).toEqual({ addressed: manifest.height + 1, tagged: 67, received: 0 });
    expect(
      await one(
        "SELECT count(*) FILTER (WHERE is_coinbase)::int AS coinbase, count(*)::int AS n FROM tx",
      ),
    ).toEqual({ coinbase: manifest.height + 1, n: (manifest.height + 1) * 2 + 1 });
    // Keys, foreign keys and indexes are back, exactly as the schema defines them.
    const indexes = (
      await pool.query<{ n: string }>("SELECT indexname AS n FROM pg_indexes")
    ).rows.map((r) => r.n);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "tx_pkey",
        "block_pkey",
        "block_hash_key",
        "io_address_idx",
        "tx_keyset_idx",
      ]),
    );
    expect(
      await one(
        "SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND convalidated AND conrelid::regclass::text IN ('tx', 'tx_transparent_io')",
      ),
    ).toEqual({ n: 2 });
    // Derived tables, from their production functions.
    expect(
      await one(
        "SELECT address, rank, computed_height FROM chain_address_balance, chain_rich_list_meta",
      ),
    ).toEqual({
      address: MINER,
      rank: 1,
      computed_height: manifest.height,
    });
    expect(await one("SELECT count(*)::int AS n FROM pg_matviews WHERE NOT ispopulated")).toEqual({
      n: 0,
    });
    expect(
      await one("SELECT count(*)::int AS days, sum(blocks)::int AS blocks FROM mining_day"),
    ).toEqual({
      days: 50,
      blocks: manifest.height + 1,
    });
    expect(
      await one(
        "SELECT covered_through_height FROM chain_value_extremes WHERE scope = 'transaction'",
      ),
    ).toEqual({ covered_through_height: manifest.height });
    expect(
      await one(
        "SELECT count(*)::int AS n FROM boundary_daily WHERE max_migration_txid IS NOT NULL",
      ),
    ).toEqual({
      n: 1,
    });

    // A second run finds the import done and changes nothing.
    const again = await runImport(options(pool, hub.endpoint, join(work, "data")));
    expect(again.failures).toEqual([]);
    expect(lines.at(-1)).toMatch(/already imported/);
  }, 120_000);

  it("serves the imported database through the API, without a node", async () => {
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${TARGET_DB}`;
    const answers = await smokeApi(url.toString(), join(work, "api"));
    // No node: the live status is an outage, answered as one, never a crash.
    expect(answers.status.code).toBe(503);
    expect(answers.richList.code).toBe(200);
    expect(JSON.stringify(answers.richList.body)).toContain(MINER);
    expect(answers.transactions.code).toBe(200);
    expect(answers.reorgs.code).toBe(200);
    expect(answers.health.code).toBe(200);
  }, 120_000);

  it("refuses a file whose bytes differ from the manifest", async () => {
    const tampered = await serveRelease({
      dir: join(work, "release"),
      repo: REPO,
      commit: COMMIT,
      tamper: "transactions/0000000-0099999.parquet",
    });
    const pool = new Pool({ connectionString: await database(SPARE_DB), max: 4 });
    pools.push(pool);
    try {
      await expect(
        runImport(options(pool, tampered.endpoint, join(work, "spare"))),
      ).rejects.toThrow(/transactions\/0000000-0099999\.parquet: downloaded .* sha256/);
      const { rows } = await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM selfhost_import_file WHERE path LIKE 'transactions/%'",
      );
      expect(rows[0]!.n).toBe(0);
    } finally {
      await tampered.close();
    }
  }, 120_000);
});
