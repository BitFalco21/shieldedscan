import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "pg";
import { createPacer, IngestionBehindError, ioPressureAvg10 } from "./job-pacer";
import { LedgerAbort, readLedgerRange } from "./opendata/ledger";
import { CONFIRMATIONS, exportTypes, writeFile } from "./opendata/read";
import {
  HEIGHTS_PER_LEDGER_FILE,
  LEDGER_CACHE_VERSION,
  TRANSACTIONS_EXTRA_COLUMNS,
  TRANSPARENT_IO_COLUMNS,
  transactionsExtraFile,
  transparentIoFile,
} from "./opendata/tables";

/**
 * Builds the open dataset's closed ledger files, once, into a persistent cache the nightly
 * release carries forward.
 *
 *   docker run … <opendata-image> node opendata-ledger.mjs --out /out --until 05:30 \
 *     [--max-files N] [--from HEIGHT]
 *
 * The one heavy read in the dataset: 354M ledger rows. So it runs at night, in short chunks,
 * paced: it rests in proportion to its work, stops when the follower falls behind the node or the
 * API slows down, and stops at `--until` (UTC). Every range is one REPEATABLE READ snapshot, so no
 * transaction stays open for long; a stopped range is simply read again next time. Finished files
 * are never rebuilt: each has a sidecar with its hashes, re-verified before it is trusted.
 *
 * Env: PGHOST, PGUSER, PGPASSWORD, PGDATABASE (the read-only `opendata_reader`); OPENDATA_API_URL,
 * the API container on the internal network (never through the CDN, whose cached tip would hide
 * a stall). Exits 0 when it stopped cleanly (done, out of time, or paced out), 1 on a failed check.
 */

const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    until: { type: "string" },
    "max-files": { type: "string" },
    from: { type: "string" },
  },
});
const OUT = args.out;
if (!OUT) {
  console.error("--out is required");
  process.exit(1);
}
const CACHE = join(OUT, "ledger-cache");
const API = process.env.OPENDATA_API_URL ?? "http://explorer-api-public:8080";
const MAX_FILES = args["max-files"] ? Number(args["max-files"]) : Infinity;
/** First range to consider (a trial on a chosen era); rounded down to a file boundary. */
const FROM = args.from
  ? Math.floor(Number(args.from) / HEIGHTS_PER_LEDGER_FILE) * HEIGHTS_PER_LEDGER_FILE
  : 0;
/** Heights per query: about 130,000 ledger rows in the busiest era. */
const CHUNK_HEIGHTS = 1_000;
/**
 * The API's /health, median of three, above this twice in a row means the site is suffering.
 * It answers in 3–5 ms on the internal network when the database is idle (measured 2026-11-01).
 */
const SLOW_HEALTH_MS = 300;
/** Ledger files' dictionary-encoded columns: few distinct values, repeated millions of times. */
const DICTIONARY = ["io", "script_type", "address"];

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** The UTC time `--until` names, today or tomorrow, as epoch milliseconds. */
function deadline(): number {
  if (!args.until) return Infinity;
  const [hh, mm] = args.until.split(":").map(Number);
  const d = new Date();
  d.setUTCHours(hh!, mm!, 0, 0);
  if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

async function fetchJson(path: string): Promise<{ ms: number; body: unknown }> {
  const began = Date.now();
  const res = await fetch(API + path, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return { ms: Date.now() - began, body: await res.json() };
}

interface Sidecar {
  version: number;
  start: number;
  end: number;
  files: { path: string; rows: number; size: number; sha256: string; contentSha256: string }[];
  underclaimZat: string;
  underclaimedBlocks: number;
  skippedBlocks: number;
  builtAt: string;
  indexerCommit: string;
}

/** A cached range is done only if its sidecar matches this version and every file its hash. */
function cached(start: number): boolean {
  const path = join(CACHE, `${start}.json`);
  if (!existsSync(path)) return false;
  const s = JSON.parse(readFileSync(path, "utf8")) as Sidecar;
  if (s.version !== LEDGER_CACHE_VERSION) return false;
  return s.files.every(
    (f) =>
      existsSync(join(CACHE, f.path)) && sha256(readFileSync(join(CACHE, f.path))) === f.sha256,
  );
}

const probe = new Client({});
const snap = new Client({ types: exportTypes });
let exitCode = 0;
try {
  mkdirSync(CACHE, { recursive: true });
  await probe.connect();
  await snap.connect();
  const stopAt = deadline();

  const sync = async () =>
    (
      await probe.query<{ tip: number; updated_at: string }>(
        "SELECT tip_height AS tip, updated_at::text AS updated_at FROM opendata.sync_state",
      )
    ).rows[0]!;

  let slowUnits = 0;
  const pacer = createPacer(
    {
      ingestLag: async () => {
        const [{ body }, s] = await Promise.all([fetchJson("/v1/status"), sync()]);
        const nodeHeight = (body as { height?: number }).height;
        return {
          blocksBehind: typeof nodeHeight === "number" ? Math.max(0, nodeHeight - s.tip) : Infinity,
          commitAgeSeconds: Math.floor(Date.now() / 1000) - Number(s.updated_at),
        };
      },
      ioPressure: () => ioPressureAvg10((path) => readFile(path, "utf8")),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log,
    },
    { duty: 0.5 },
  );
  await pacer.preflight();

  const afterChunk = async (workedMs: number) => {
    if (Date.now() >= stopAt) return "abort" as const;
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) samples.push((await fetchJson("/health")).ms);
    const median = samples.sort((a, b) => a - b)[1]!;
    slowUnits = median > SLOW_HEALTH_MS ? slowUnits + 1 : 0;
    if (slowUnits >= 2) {
      log(`stopping: the API's /health took ${median} ms twice in a row`);
      return "abort" as const;
    }
    return pacer.afterUnit(workedMs);
  };

  const height = (await sync()).tip - CONFIRMATIONS;
  let built = 0;
  for (
    let start = FROM;
    start + HEIGHTS_PER_LEDGER_FILE - 1 <= height;
    start += HEIGHTS_PER_LEDGER_FILE
  ) {
    if (built >= MAX_FILES || Date.now() >= stopAt) break;
    if (cached(start)) continue;
    const end = start + HEIGHTS_PER_LEDGER_FILE - 1;

    await snap.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    let range;
    try {
      range = await readLedgerRange(snap, start, end, CHUNK_HEIGHTS, afterChunk);
      await snap.query("COMMIT");
    } catch (e) {
      await snap.query("ROLLBACK").catch(() => {});
      if (e instanceof LedgerAbort) {
        log(`stopped in ${start}-${end}; it is read again next time`);
        break;
      }
      throw e;
    }
    const failures = range.checker.failures.list();
    if (failures.length > 0) {
      log(`FAILED ${start}-${end}:`);
      for (const f of failures) log(`  ${f}`);
      exitCode = 1;
      break;
    }

    // Written under a temporary name, then renamed: a crash never leaves a half file trusted.
    const tmp = join(CACHE, ".tmp");
    rmSync(tmp, { recursive: true, force: true });
    const files = [
      writeFile(tmp, transparentIoFile(start), TRANSPARENT_IO_COLUMNS, range.io, DICTIONARY),
      writeFile(tmp, transactionsExtraFile(start), TRANSACTIONS_EXTRA_COLUMNS, range.extra),
    ];
    for (const f of files) {
      mkdirSync(join(CACHE, f.path, ".."), { recursive: true });
      renameSync(join(tmp, f.path), join(CACHE, f.path));
    }
    const sidecar: Sidecar = {
      version: LEDGER_CACHE_VERSION,
      start,
      end,
      files,
      underclaimZat: range.checker.underclaimZat.toString(),
      underclaimedBlocks: range.checker.underclaimedBlocks,
      skippedBlocks: range.checker.skippedBlocks,
      builtAt: new Date().toISOString(),
      indexerCommit: process.env.OPENDATA_GIT_SHA ?? "unknown",
    };
    rmSync(tmp, { recursive: true, force: true });
    writeFileSync(join(CACHE, `${start}.json.tmp`), JSON.stringify(sidecar, null, 2) + "\n");
    renameSync(join(CACHE, `${start}.json.tmp`), join(CACHE, `${start}.json`));
    built++;
    log(
      `${start}-${end}: ${files[0]!.rows} ledger rows, ${files[1]!.rows} transactions, ` +
        `${(files[0]!.size / 1e6).toFixed(1)} MB; slept ${Math.round(pacer.stats.sleptMs / 1000)} s so far`,
    );
  }
  log(`done for now: ${built} range(s) built`);
} catch (e) {
  if (e instanceof IngestionBehindError) {
    // Someone else's stall, not ours: stop cleanly and let the next run try again.
    log(`stopping: ${e.message}`);
  } else {
    log(`FAILED: ${e instanceof Error ? e.message || e.name : String(e)}`);
    exitCode = 1;
  }
} finally {
  await snap.end().catch(() => {});
  await probe.end().catch(() => {});
}
process.exit(exitCode);
