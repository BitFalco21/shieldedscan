import {
  existsSync,
  mkdirSync,
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
import { readSidecar, sidecarProblems, type Sidecar } from "../ledger-cache";
import { planLedger, releaseLedger, withheldFailure, type LedgerOutcome } from "../ledger-release";
import { readBackSample } from "../publish";
import { exportTypes, type OutputFile } from "../read";
import { LEDGER_CACHE_VERSION } from "../tables";

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
    expect(checkUnderclaim(0n, 5n, 1)).toEqual([
      "ledger underclaim 0 zat differs from the supply audit's 5 zat; " +
        "1 skipped blocks are outside the ledger's sum",
    ]);
  });
});

describe("a withheld ledger", () => {
  const withheld = { status: "withheld", closed: 355, notCached: 2, stale: 1 } as const;

  it("waits quietly until it is first published, and stops every release after", () => {
    expect(withheldFailure(withheld, false)).toBeNull();
    expect(withheldFailure(withheld, true)).toBe(
      "the ledger was published, but 2 of 355 closed ranges are not cached, " +
        "1 of them for another cache version",
    );
  });
});

describe("a sidecar's own consistency", () => {
  const cache = mkdtempSync(join(tmpdir(), "opendata-sidecar-"));
  afterAll(() => rmSync(cache, { recursive: true, force: true }));
  const part = (n: number) => `transparent_io/0010000-0019999-00${n}.parquet`;
  const extra = "transactions_extra/0010000-0019999.parquet";
  const entry = (path: string, size = 1): OutputFile => ({
    path,
    rows: 1,
    size,
    sha256: "",
    contentSha256: "",
  });
  const sidecar = (files: OutputFile[], over: Partial<Sidecar> = {}): Sidecar => ({
    version: LEDGER_CACHE_VERSION,
    start: 10_000,
    end: 19_999,
    files,
    underclaimZat: "0",
    underclaimedBlocks: 0,
    skippedBlocks: 0,
    builtAt: "",
    indexerCommit: "",
    ...over,
  });

  it("names only its own range: its parts from 000, then its extra file", () => {
    const ok = [entry(part(0)), entry(part(1)), entry(extra)];
    expect(sidecarProblems(cache, sidecar(ok, { start: 0 }), 10_000)).toEqual([
      "ledger cache 10000: names another range",
    ]);
    for (const files of [
      [entry(extra)],
      [entry(part(1)), entry(extra)],
      [entry(extra), entry(part(0))],
      [entry("../../etc/passwd"), entry(extra)],
    ]) {
      expect(sidecarProblems(cache, sidecar(files), 10_000)).toEqual([
        "ledger cache 10000: unexpected files",
      ]);
    }
    expect(sidecarProblems(cache, sidecar(ok, { underclaimZat: "-1" }), 10_000)).toEqual([
      "ledger cache 10000: malformed underclaim",
    ]);
  });

  it("finds each file it names, at its recorded size", () => {
    mkdirSync(join(cache, "transparent_io"), { recursive: true });
    writeFileSync(join(cache, part(0)), "x");
    writeFileSync(join(cache, part(1)), "xx");
    const files = [entry(part(0)), entry(part(1)), entry(extra)];
    expect(sidecarProblems(cache, sidecar(files), 10_000)).toEqual([
      `ledger cache 10000: ${part(1)} has another size`,
      `ledger cache 10000: ${extra} is missing`,
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
    expect(readSidecar(cache, 0)).toMatchObject({
      version: LEDGER_CACHE_VERSION,
      start: 0,
      end: 9_999,
    });
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

  it("caches nothing of a newly closed range that fails a check", async () => {
    const cache = dir();
    const coinbase = "lpad(to_hex(1000000 + 4000), 64, '0')";
    await reader.query(
      `UPDATE tx_transparent_io SET value_zat = value_zat + 1 WHERE txid = ${coinbase}`,
    );
    try {
      const o = published((await release(10_150, cache)).outcome);
      expect(o.failures.join("\n")).toMatch(
        /^ledger 0-9999: transparent pool change differs from the ledger/,
      );
      expect(o.built).toEqual([]);
      expect(readSidecar(cache, 0)).toBeNull();
      expect(existsSync(join(cache, ".tmp-release"))).toBe(false);
      // The open range is still built and checked.
      expect(o.files.map((f) => f.path)).toEqual(RANGE1);
    } finally {
      await reader.query(
        `UPDATE tx_transparent_io SET value_zat = value_zat - 1 WHERE txid = ${coinbase}`,
      );
    }
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
