import { mkdirSync, rmSync, statfsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "pg";
import { createPacer, IngestionBehindError, ioPressureAvg10 } from "./job-pacer";
import { LedgerAbort } from "./opendata/ledger";
import {
  buildLedgerRange,
  closedRanges,
  commitRange,
  isCached,
  rangeEnd,
} from "./opendata/ledger-cache";
import { CONFIRMATIONS, exportTypes } from "./opendata/read";
import { RowRate } from "./opendata/row-rate";
import { HEIGHTS_PER_LEDGER_FILE } from "./opendata/tables";

/**
 * Builds the open dataset's closed ledger files, once, into a persistent cache the nightly
 * release carries forward.
 *
 *   docker run … --entrypoint node <opendata-image> --max-old-space-size=1500 \
 *     opendata-ledger.mjs --out /out --until 02:10 [--max-files N] [--from HEIGHT]
 *
 * The one heavy read in the dataset (354M ledger rows), so it runs at night and protects the
 * site first. A whole dense range held in memory thrashes at the container limit and slows the
 * site while guards that check only between chunks, and only /health, see nothing. Hence:
 *  - memory is bounded by rows, not heights: queries adapt their span to ~100k rows, parts are
 *    written as they fill, and the process stops itself above `MAX_RSS`;
 *  - every statement has a 60 s timeout, so no query outlives a problem;
 *  - the latency guard probes the routes the site serves, not /health;
 *  - it rests half the time and longer under host I/O pressure, and stops when the follower falls
 *    behind, when the site slows (or pressure rises while a route is slower than usual), when
 *    free disk falls under 100 GB, or before a range that would end past `--until`.
 *
 * Every range is one REPEATABLE READ snapshot; a stopped range is read again next time. Finished
 * files are never rebuilt: each range has a sidecar written last, by rename. It builds closed
 * ranges only; the range still filling is the release's (see `opendata/ledger-release.ts`).
 *
 * Env: PGHOST, PGUSER, PGPASSWORD, PGDATABASE (the read-only `opendata_reader`); OPENDATA_API_URL,
 * the API container on the internal network (never through the CDN, whose cached answers would
 * hide a slow site).
 *
 * Exit codes: 0 stopped cleanly (done, out of time, or paced out); 1 a failed check or a guard a
 * human must look at (memory, disk); 2 a transient error (API or database unreachable), retried.
 */

const { values: args } = parseArgs({
  options: {
    out: { type: "string" },
    until: { type: "string" },
    "max-files": { type: "string" },
    from: { type: "string" },
    "max-rows-per-second": { type: "string" },
  },
});
const OUT = args.out;
if (!OUT) {
  console.error("--out is required");
  process.exit(1);
}
const CACHE = join(OUT, "ledger-cache");
/** The public API the site serves, on the internal network: what the latency guard probes. */
const API = process.env.OPENDATA_API_URL;
if (!API) {
  console.error("OPENDATA_API_URL is required: the build must watch the site it could slow");
  process.exit(1);
}
const MAX_FILES = args["max-files"] ? Number(args["max-files"]) : Infinity;
/** First range to consider (a trial on a chosen era); rounded down to a range boundary. */
const FROM = args.from
  ? Math.floor(Number(args.from) / HEIGHTS_PER_LEDGER_FILE) * HEIGHTS_PER_LEDGER_FILE
  : 0;

/** The routes the site serves; each answers in tens of milliseconds on the internal network. */
const PROBES = ["/v1/status", "/v1/blocks?limit=5", "/v1/transactions?limit=5"];
/** A probe's median of three above this, twice in a row, means the site is slowing. */
const SLOW_PROBE_MS = 200;
/** Under high I/O pressure, a route this slow already counts: the pressure is reaching the site. */
const PRESSURED_PROBE_MS = 100;
/** Host I/O pressure (some, avg10) that pauses the build, well above where the host idles. */
const IO_PRESSURE_LIMIT = 40;
/**
 * Resident memory above this stops the build. It guards against thrash at the 3 GB container
 * limit, not against a healthy heap: V8 lets garbage reach the 1.5 GB old space before collecting,
 * and the Parquet writer's wasm memory never shrinks.
 */
const MAX_RSS = 2_400_000_000;
/** Seconds between two rounds of site probes: chunks can be frequent in dense eras. */
const PROBE_EVERY_MS = 5_000;
/** A chunk that took this long counts as a sign of strain, whatever the probes say. */
const SLOW_CHUNK_MS = 20_000;
const MIN_FREE_DISK = 100_000_000_000;
/**
 * The long-run ledger read rate. About 60% of the rate the first full night held while the site
 * stayed fast; the guards above still stop the build on any sign of a slower site.
 */
const MAX_ROWS_PER_SECOND = Number(args["max-rows-per-second"] ?? 8_000);
/** Seconds of rows the cap lets through at once: a chunk or two, never a catch-up sprint. */
const ROW_BURST_SECONDS = 30;
if (!(MAX_ROWS_PER_SECOND > 0)) {
  console.error("--max-rows-per-second must be a positive number");
  process.exit(1);
}

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

/** Unreachable API or database: retried by the driver. */
class Transient extends Error {}

/**
 * Errors worth retrying later: a cancelled statement, a lost or refused connection, the role's
 * connection limit, an idle transaction timed out during a long rest, a network failure. Anything else is a failure a human must see.
 */
function isTransient(e: unknown): boolean {
  const code = String((e as { code?: unknown }).code ?? "");
  return (
    code === "57014" ||
    code === "53300" ||
    code === "25P03" ||
    code.startsWith("08") ||
    ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE"].includes(code)
  );
}
/** A guard a human must look at: memory or disk. */
class Guard extends Error {}

/**
 * The UTC time `--until` names, as epoch milliseconds. Tomorrow's only when today's passed more
 * than 12 h ago (a start before midnight for a window after it); a start just after `--until`
 * finds its window over, never a 24-hour run into the release's two connections.
 */
function deadline(): number {
  if (!args.until) return Infinity;
  const [hh, mm] = args.until.split(":").map(Number);
  const d = new Date();
  d.setUTCHours(hh!, mm!, 0, 0);
  if (Date.now() - d.getTime() > 12 * 3600_000) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

/** One timed GET; a failure or timeout counts as a slow answer, never as a crash. */
async function timedGet(path: string): Promise<{ ms: number; body: unknown }> {
  const began = Date.now();
  try {
    const res = await fetch(API + path, { signal: AbortSignal.timeout(10_000) });
    const body: unknown = res.ok ? await res.json() : null;
    return { ms: res.ok ? Date.now() - began : Infinity, body };
  } catch {
    return { ms: Infinity, body: null };
  }
}

const probe = new Client({});
const snap = new Client({ types: exportTypes });
let exitCode = 0;
try {
  mkdirSync(CACHE, { recursive: true });
  try {
    await probe.connect();
    await snap.connect();
  } catch (e) {
    if (!isTransient(e)) throw e;
    throw new Transient(`database unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  const stopAt = deadline();

  const sync = async () =>
    (
      await probe.query<{ tip: number; updated_at: string }>(
        "SELECT tip_height AS tip, updated_at::text AS updated_at FROM opendata.sync_state",
      )
    ).rows[0]!;

  const pacer = createPacer(
    {
      // An unreachable API or node is "unknown", which the pacer treats as a stall: it rests and
      // re-samples, then stops cleanly, rather than crash the run.
      ingestLag: async () => {
        const [{ body }, s] = await Promise.all([timedGet("/v1/status"), sync()]);
        const nodeHeight = (body as { height?: unknown } | null)?.height;
        return {
          blocksBehind: typeof nodeHeight === "number" ? Math.max(0, nodeHeight - s.tip) : Infinity,
          commitAgeSeconds: Math.floor(Date.now() / 1000) - Number(s.updated_at),
        };
      },
      ioPressure: () => ioPressureAvg10((path) => readFile(path, "utf8")),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log,
    },
    { duty: 0.5, pressureThreshold: IO_PRESSURE_LIMIT },
  );
  await pacer.preflight();

  // Strain is read right after a chunk, before any rest: a chunk that ran long, a slow site route
  // (probed at most every few seconds), or high host I/O pressure while a route is already slower
  // than usual. Pressure alone is mostly this build's own reads, which the pacer answers by
  // resting; stopping on it threw away half-built ranges while the site stayed fast. Two strained
  // measurements in a row stop the run; it resumes on the driver's next pass. A unit that took no
  // measurement (no probe round, an ordinary chunk) leaves the count alone: resetting it there
  // would let fast chunks between probe rounds hide a slow site forever.
  let strained = 0;
  let lastProbe = 0;
  /** The slowest route seen this run, printed when the run ends: how close the site came. */
  let slowestOfRun = { path: "", ms: 0 };
  const rowRate = new RowRate(MAX_ROWS_PER_SECOND, ROW_BURST_SECONDS);
  let rowsRead = 0;
  let capRestedMs = 0;
  log(`ledger rows capped at ${MAX_ROWS_PER_SECOND}/s on average`);
  const afterChunk = async (workedMs: number, rows: number) => {
    const rss = process.memoryUsage().rss;
    if (rss > MAX_RSS) throw new Guard(`memory guard: ${Math.round(rss / 1e6)} MB resident`);
    if (Date.now() >= stopAt) return "abort" as const;
    const reasons: string[] = [];
    const slowChunk = workedMs > SLOW_CHUNK_MS;
    if (slowChunk) reasons.push(`a chunk took ${Math.round(workedMs / 1000)} s`);
    const probed = Date.now() - lastProbe >= PROBE_EVERY_MS;
    if (probed) {
      lastProbe = Date.now();
      let slowest = { path: "", ms: 0 };
      for (const path of PROBES) {
        const samples: number[] = [];
        for (let i = 0; i < 3; i++) samples.push((await timedGet(path)).ms);
        const median = samples.sort((a, b) => a - b)[1]!;
        if (median > slowest.ms) slowest = { path, ms: median };
        if (median > SLOW_PROBE_MS) reasons.push(`${path} took ${median} ms`);
      }
      if (slowest.ms > slowestOfRun.ms) slowestOfRun = slowest;
      const pressure = await ioPressureAvg10((path) => readFile(path, "utf8"));
      if (pressure !== null && pressure > IO_PRESSURE_LIMIT) {
        log(`pressure ${pressure}, slowest route ${slowest.path} at ${slowest.ms} ms`);
        if (slowest.ms > PRESSURED_PROBE_MS) {
          reasons.push(`I/O pressure ${pressure} with ${slowest.path} at ${slowest.ms} ms`);
        }
      }
    }
    if (probed || slowChunk) {
      strained = reasons.length > 0 ? strained + 1 : 0;
      if (strained === 1) log(`strained: ${reasons.join(", ")}`);
    }
    if (strained >= 2) {
      log(`stopping: ${reasons.join(", ")}, twice in a row`);
      return "abort" as const;
    }
    const decision = await pacer.afterUnit(workedMs);
    if (decision === "abort") return decision;
    // After the pacer's rest, which refills the bucket: the cap only adds the rest it still owes.
    rowsRead += rows;
    const owed = rowRate.take(rows);
    // A rest that ends past the window would only read a range that is thrown away.
    if (Date.now() + owed >= stopAt) return "abort" as const;
    if (owed > 0) {
      capRestedMs += owed;
      await new Promise((resolve) => setTimeout(resolve, owed));
    }
    return decision;
  };

  const height = (await sync()).tip - CONFIRMATIONS;
  let built = 0;
  let lastRangeMs = 0;
  for (const start of closedRanges(height, FROM)) {
    if (built >= MAX_FILES) break;
    if (isCached(CACHE, start)) continue;
    if (Date.now() + lastRangeMs >= stopAt) {
      log("stopping: the next range would not finish inside the window");
      break;
    }
    const disk = statfsSync(OUT);
    if (disk.bavail * disk.bsize < MIN_FREE_DISK) {
      throw new Guard(`disk guard: under ${MIN_FREE_DISK / 1e9} GB free`);
    }
    const end = rangeEnd(start);
    const began = Date.now();

    // Parts are written as they fill, under a temporary folder, then moved in by rename.
    const tmp = join(CACHE, ".tmp");
    rmSync(tmp, { recursive: true, force: true });
    let range;
    try {
      range = await buildLedgerRange(snap, start, end, tmp, afterChunk);
    } catch (e) {
      if (e instanceof LedgerAbort) {
        log(`stopped in ${start}-${end}; it is read again next time`);
        break;
      }
      if (e instanceof Guard || !isTransient(e)) throw e;
      throw new Transient(`${start}-${end}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const failures = range.checker.failures.list();
    if (failures.length > 0) {
      log(`FAILED ${start}-${end}:`);
      for (const f of failures) log(`  ${f}`);
      exitCode = 1;
      break;
    }
    const { files } = commitRange(CACHE, tmp, start, range);
    built++;
    lastRangeMs = Date.now() - began;
    const ledgerRows = files.slice(0, -1).reduce((n, f) => n + f.rows, 0);
    log(
      `${start}-${end}: ${ledgerRows} ledger rows in ${range.parts} part(s), ` +
        `${files.at(-1)!.rows} transactions, ${Math.round(lastRangeMs / 1000)} s, ` +
        `rss ${Math.round(process.memoryUsage().rss / 1e6)} MB`,
    );
  }
  log(
    `done for now: ${built} range(s) built, ${rowsRead} ledger rows read, ` +
      `the cap rested ${Math.round(capRestedMs / 1000)} s; slowest route ` +
      `${slowestOfRun.path || "(none probed)"} at ${slowestOfRun.ms} ms`,
  );
} catch (e) {
  if (e instanceof IngestionBehindError) {
    // Someone else's stall, not ours: stop cleanly and let the next run try again.
    log(`stopping: ${e.message}`);
  } else if (e instanceof Transient) {
    log(`TRANSIENT: ${e.message}`);
    exitCode = 2;
  } else {
    log(`FAILED: ${e instanceof Error ? e.message || e.name : String(e)}`);
    exitCode = 1;
  }
} finally {
  await snap.end().catch(() => {});
  await probe.end().catch(() => {});
}
process.exit(exitCode);
