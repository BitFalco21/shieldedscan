import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blockSubsidyZat } from "@/domain/halving";
import { checkUnderclaim } from "../checks";
import { compareHistory } from "../history";
import { readSidecar, type Sidecar } from "../ledger-cache";
import { planLedger, releaseLedger, type LedgerOutcome } from "../ledger-release";
import { readBackSample } from "../publish";
import { exportTypes } from "../read";

describe("which ranges a release carries, builds or lacks", () => {
  const all = (state: "cached" | "stale" | "absent") => (): "cached" | "stale" | "absent" => state;

  it("calls a range closed once it ends below the release height, open while it holds it", () => {
    expect(planLedger(9_999, all("absent"))).toEqual({
      open: { start: 0, end: 9_999 },
      carry: [],
      build: [],
      missing: [],
      stale: 0,
    });
    expect(planLedger(10_000, all("absent")).open).toEqual({ start: 10_000, end: 10_000 });
    expect(planLedger(10_000, all("absent")).build).toEqual([0]);
  });

  it("carries what is cached and builds only the newest closed ranges", () => {
    const plan = planLedger(55_000, (start) => (start >= 30_000 ? "absent" : "cached"));
    expect(plan).toMatchObject({
      carry: [0, 10_000, 20_000],
      build: [30_000, 40_000],
      missing: [],
    });
    expect(plan.open).toEqual({ start: 50_000, end: 55_000 });
  });

  it("lists an older range the cache lacks as missing, and counts stale ones", () => {
    const plan = planLedger(55_000, (start) =>
      start === 10_000 ? "absent" : start === 40_000 ? "stale" : "cached",
    );
    expect(plan.missing).toEqual([10_000]);
    expect(plan.build).toEqual([40_000]);
    expect(plan.stale).toBe(1);
    expect(planLedger(55_000, all("absent"), 0).missing).toHaveLength(5);
  });
});

describe("the underclaim cross-check", () => {
  it("passes only when the ledger and the supply audit agree to the zatoshi", () => {
    expect(checkUnderclaim(7n, 7n)).toEqual([]);
    expect(checkUnderclaim(7n, 8n)).toEqual([
      "ledger underclaim 7 zat differs from the supply audit's 8 zat",
    ]);
    expect(checkUnderclaim(0n, null)).toEqual([
      "ledger underclaim: the supply at the release height is unknown",
    ]);
  });
});

describe("read-back of a large commit", () => {
  it("reads back everything, or an even sample with both ends", () => {
    const paths = Array.from({ length: 400 }, (_, i) => `p${i}`);
    expect(readBackSample(paths.slice(0, 20))).toEqual(new Set(paths.slice(0, 20)));
    const sample = readBackSample(paths);
    expect(sample.size).toBe(20);
    expect(sample.has("p0") && sample.has("p399")).toBe(true);
  });
});

/**
 * Against a real PostgreSQL, through the `opendata` views, on a chain one boundary long: 10,301
 * blocks, each a coinbase paying the slow-start subsidy to one output, except at 5,000 where it
 * leaves 7 zat unclaimed. Skips without TEST_DATABASE_URL, like read.test.ts. Read as the database
 * owner: `opendata_reader` allows two connections in the whole cluster, and read.test.ts (which
 * also proves the role's confinement) runs alongside.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL;
const DB = `opendata_ledger_test_${process.pid}`;
const ROOT = join(__dirname, "../../..");
const TOP = 10_300;
const UNDER_AT = 5_000;
const UNDER = 7n;
const START = 1_477_612_800;

const RANGE0 = [
  "transparent_io/0000000-0009999-000.parquet",
  "transactions_extra/0000000-0009999.parquet",
];
const RANGE1 = [
  "transparent_io/0010000-0019999-000.parquet",
  "transactions_extra/0010000-0019999.parquet",
];

describe.skipIf(!ADMIN_URL)("the ledger in a release", () => {
  let admin: Client;
  let reader: Client;
  const dirs: string[] = [];
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), "opendata-ledger-"));
    dirs.push(d);
    return d;
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${DB}`;
    reader = new Client({ connectionString: url.toString(), types: exportTypes });
    await reader.connect();
    for (const f of ["server/schema-chain.sql", "server/schema.sql", "server/schema-net.sql"]) {
      await reader.query(readFileSync(join(ROOT, f), "utf8"));
    }
    await reader.query(readFileSync(join(ROOT, "server/schema-opendata.sql"), "utf8"));

    const heights: number[] = [];
    const claimed: string[] = [];
    const pools: string[] = [];
    let pool = 0n;
    for (let h = 0; h <= TOP; h++) {
      const c = BigInt(blockSubsidyZat(h)) - (h === UNDER_AT ? UNDER : 0n);
      pool += c;
      heights.push(h);
      claimed.push(c.toString());
      pools.push(pool.toString());
    }
    await reader.query(
      `INSERT INTO block (height, hash, prev_hash, timestamp, size_bytes, tx_count,
         transparent_tx_count, mixed_tx_count, shielded_tx_count, total_fee_zat,
         sapling_flow_zat, orchard_flow_zat, transparent_pool_zat, difficulty, miner_kind)
       SELECT h, lpad(to_hex(h + 1), 64, '0'), lpad(to_hex(h), 64, '0'), $1 + h * 75, 1000, 1,
              0, 0, 0, 0, 0, 0, p, 1.5, 'transparent'
         FROM unnest($2::int[], $3::bigint[]) AS u(h, p)`,
      [START, heights, pools],
    );
    await reader.query(
      `INSERT INTO tx (txid, block_height, timestamp, is_coinbase, version, size_bytes, kind)
       SELECT lpad(to_hex(1000000 + h), 64, '0'), h, $1 + h * 75, true, 5, 300, 'coinbase'
         FROM generate_series(0, $2::int) AS h`,
      [START, TOP],
    );
    await reader.query(
      `INSERT INTO tx_transparent_io (txid, io, ordinal, address, value_zat, script_type, block_height)
       SELECT lpad(to_hex(1000000 + h), 64, '0'), 'out', 0, 't1coinbase', v, 'pubkeyhash', h
         FROM unnest($1::int[], $2::bigint[]) AS u(h, v)`,
      [heights, claimed],
    );
  }, 120_000);

  afterAll(async () => {
    await reader?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  const release = async (
    height: number,
    cacheDir: string,
    opts: { trusted?: boolean; buildsAtMost?: number } = {},
  ) => {
    const outDir = dir();
    const outcome = await releaseLedger(
      { client: reader, height, afterChunk: async () => "continue" },
      {
        cacheDir,
        outDir,
        trusted: () => opts.trusted ?? false,
        ...(opts.buildsAtMost !== undefined ? { buildsAtMost: opts.buildsAtMost } : {}),
      },
    );
    return { outcome, outDir };
  };
  const published = (o: LedgerOutcome) => {
    if (o.status !== "published") throw new Error(`ledger ${o.status}`);
    return o;
  };
  const shas = (o: LedgerOutcome) =>
    new Map(published(o).files.map((f) => [f.path, f.sha256] as const));

  it("builds a newly closed range into the cache, and the open range into the release", async () => {
    const cache = dir();
    const { outcome, outDir } = await release(10_150, cache);
    const o = published(outcome);
    expect(o.failures).toEqual([]);
    expect(o.built).toEqual([0]);
    expect(o.carried).toBe(0);
    expect(o.files.map((f) => f.path)).toEqual([...RANGE0, ...RANGE1]);
    expect(o.underclaimZat).toBe(UNDER);
    expect(o.files.find((f) => f.path === RANGE1[0])!.rows).toBe(151);

    // Cached with its sidecar, and placed in the release by hard link: one copy on disk.
    expect(readSidecar(cache, 0)).toMatchObject({ version: 2, start: 0, end: 9_999 });
    expect(statSync(join(outDir, RANGE0[0]!)).ino).toBe(statSync(join(cache, RANGE0[0]!)).ino);
    // The open range is never cached: it is not final.
    expect(readSidecar(cache, 10_000)).toBeNull();
    expect(existsSync(join(cache, RANGE1[0]!))).toBe(false);

    // The next release carries it, building nothing but the open range.
    const again = published((await release(10_150, cache)).outcome);
    expect([again.built, again.carried]).toEqual([[], 1]);
    expect(shas(again)).toEqual(shas(o));
  });

  it("crosses a boundary without a gap or a double", async () => {
    const cache = dir();
    // While open, range 0 is built by the release up to its height, and nothing is cached.
    const before = await release(9_000, cache);
    expect(published(before.outcome).files.map((f) => f.path)).toEqual(RANGE0);
    expect(readSidecar(cache, 0)).toBeNull();
    // Built to its last height, the open range is byte for byte the closed one cached later.
    const full = shas((await release(9_999, cache)).outcome);
    const after = await release(10_150, cache);
    for (const p of RANGE0) expect(shas(after.outcome).get(p)).toBe(full.get(p));

    // The grown file keeps every row already published.
    const asPublished = (r: { outcome: LedgerOutcome; outDir: string }) =>
      published(r.outcome).files.map((f) => ({
        path: f.path,
        sha256: f.sha256,
        read: () => new Uint8Array(readFileSync(join(r.outDir, f.path))),
      }));
    expect(compareHistory(asPublished(before), asPublished(after))).toEqual({
      failures: [],
      fills: [],
    });
  });

  it("withholds the whole ledger while an older closed range is not cached", async () => {
    const { outcome, outDir } = await release(10_150, dir(), { buildsAtMost: 0 });
    expect(outcome).toEqual({ status: "withheld", closed: 1, notCached: 1, stale: 0 });
    expect(existsSync(join(outDir, "transparent_io"))).toBe(false);
  });

  it("never carries a range cached for another version", async () => {
    const cache = dir();
    await release(10_150, cache);
    const sidecar = join(cache, "0.json");
    const s = JSON.parse(readFileSync(sidecar, "utf8")) as Sidecar;
    writeFileSync(sidecar, JSON.stringify({ ...s, version: s.version - 1 }));
    expect((await release(10_150, cache, { buildsAtMost: 0 })).outcome).toMatchObject({
      status: "withheld",
      stale: 1,
    });
    // Among the newest, it is rebuilt like a missing range.
    expect(published((await release(10_150, cache)).outcome).built).toEqual([0]);
    expect(readSidecar(cache, 0)!.version).toBe(s.version);
  });

  it("fails a cached file whose bytes differ from its sidecar", async () => {
    const cache = dir();
    await release(10_150, cache);
    const part = join(cache, RANGE0[0]!);
    const bytes = readFileSync(part);
    bytes[100] = bytes[100]! ^ 0xff;
    // A new inode: the earlier release's hard link keeps the good bytes.
    unlinkSync(part);
    writeFileSync(part, bytes);
    expect(published((await release(10_150, cache)).outcome).failures).toEqual([
      `ledger cache 0: ${RANGE0[0]} does not match its sidecar's hash`,
    ]);
    // A file already published with that hash is trusted by size: `--full` is what re-hashes it.
    expect(published((await release(10_150, cache, { trusted: true })).outcome).failures).toEqual(
      [],
    );
    unlinkSync(part);
    expect(published((await release(10_150, cache)).outcome).failures).toEqual([
      `ledger cache 0: ${RANGE0[0]} is missing`,
    ]);
  });

  it("sums each closed range's underclaim from its sidecar, for the cross-check", async () => {
    const cache = dir();
    await release(10_150, cache);
    const sidecar = join(cache, "0.json");
    const s = JSON.parse(readFileSync(sidecar, "utf8")) as Sidecar;
    writeFileSync(sidecar, JSON.stringify({ ...s, underclaimZat: "8" }));
    const o = published((await release(10_150, cache)).outcome);
    expect(o.underclaimZat).toBe(8n);
    expect(checkUnderclaim(o.underclaimZat, UNDER)).toHaveLength(1);
  });
});
