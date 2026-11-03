import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Client } from "pg";
import { readLedgerRange, type ChunkHook, type LedgerChecker } from "./ledger";
import { writeFile, type OutputFile } from "./read";
import {
  HEIGHTS_PER_LEDGER_FILE,
  LEDGER_CACHE_VERSION,
  TRANSACTIONS_EXTRA_COLUMNS,
  TRANSPARENT_IO_COLUMNS,
  transactionsExtraFile,
  transparentIoFile,
} from "./tables";

/**
 * The ledger cache, shared by the night builder and the release so a range is built, checked,
 * written and described one way whichever of them builds it: the same rows give the same bytes,
 * so it never matters which one did.
 *
 * Layout: `<cache>/<start>.json` (the sidecar) and the files it names, at their published paths.
 */

/** Ledger columns dictionary-encoded: few distinct values, repeated millions of times. */
export const LEDGER_DICTIONARY = ["io", "script_type"] as const;

/**
 * One closed range. Written last, by rename, and only by `commitRange`, which refuses a range
 * that failed a check: a sidecar exists only for a range whose every per-block check passed.
 * The underclaim figures are those checks' results, summed by the release.
 */
export interface Sidecar {
  version: number;
  start: number;
  end: number;
  files: OutputFile[];
  underclaimZat: string;
  underclaimedBlocks: number;
  skippedBlocks: number;
  builtAt: string;
  indexerCommit: string;
  /**
   * Its parts passed the text-column checks (`ledger-strings.ts`). Set at build since those
   * checks exist; a range cached before them is read and checked once by a release, which then
   * sets it (`ledger-release.ts`).
   */
  stringsChecked?: true;
}

export const rangeEnd = (start: number) => start + HEIGHTS_PER_LEDGER_FILE - 1;

/**
 * The starts of the ranges closed at release height `height`, from `from` (a range boundary): a
 * range is closed once it ends below the height. The one that holds it is open, even at its last
 * height, so the open range is never empty. One rule for the builder and the release.
 */
export function closedRanges(height: number, from = 0): number[] {
  const starts: number[] = [];
  for (let start = from; rangeEnd(start) < height; start += HEIGHTS_PER_LEDGER_FILE) {
    starts.push(start);
  }
  return starts;
}

const sidecarPath = (cache: string, start: number) => join(cache, `${start}.json`);

/** Written beside and renamed over, so a reader sees the old sidecar or the new, whole. */
function writeSidecar(cache: string, s: Sidecar): void {
  const path = sidecarPath(cache, s.start);
  writeFileSync(`${path}.tmp`, JSON.stringify(s, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
}

/** Records that a range cached before the text checks has now passed them. */
export function markStringsChecked(cache: string, s: Sidecar): void {
  writeSidecar(cache, { ...s, stringsChecked: true });
}

export function readSidecar(cache: string, start: number): Sidecar | null {
  const path = sidecarPath(cache, start);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Sidecar;
}

/**
 * What is wrong with a sidecar of the current version, from its own fields and its files' sizes:
 * it must name its own range's parts from 000 and then its `transactions_extra` file, nothing
 * else (a path from the cache is joined to a directory), and each must exist at its size.
 */
export function sidecarProblems(cache: string, s: Sidecar, start: number): string[] {
  const where = `ledger cache ${start}`;
  if (s.start !== start || s.end !== rangeEnd(start)) return [`${where}: names another range`];
  const parts = s.files.length - 1;
  const expected = [
    ...Array.from({ length: Math.max(parts, 0) }, (_, i) => transparentIoFile(start, i)),
    transactionsExtraFile(start),
  ];
  if (parts < 1 || s.files.some((f, i) => f.path !== expected[i])) {
    return [`${where}: unexpected files`];
  }
  if (!/^\d+$/.test(s.underclaimZat)) return [`${where}: malformed underclaim`];
  if (s.stringsChecked !== undefined && s.stringsChecked !== true) {
    return [`${where}: malformed stringsChecked`];
  }
  const problems: string[] = [];
  for (const f of s.files) {
    const p = join(cache, f.path);
    if (!existsSync(p)) problems.push(`${where}: ${f.path} is missing`);
    else if (statSync(p).size !== f.size) problems.push(`${where}: ${f.path} has another size`);
  }
  return problems;
}

/**
 * A range is cached when its sidecar is this version and its files are where it says, at their
 * sizes. Hashes are verified by the release, when a file enters it: re-reading gigabytes on every
 * builder restart would compete with Postgres for the disk.
 */
export function isCached(cache: string, start: number): boolean {
  const s = readSidecar(cache, start);
  return (
    s !== null &&
    s.version === LEDGER_CACHE_VERSION &&
    sidecarProblems(cache, s, start).length === 0
  );
}

/** sha256 of a file, read in pieces: a ledger part can be tens of megabytes. */
export function hashFile(path: string): string {
  const h = createHash("sha256");
  const buf = Buffer.alloc(8 << 20);
  const fd = openSync(path, "r");
  try {
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

/**
 * A file placed in the release by hard link, so the cache and the published copy share one set of
 * bytes on disk; copied only where a link is impossible (another filesystem).
 */
export function linkInto(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  try {
    linkSync(from, to);
  } catch (e) {
    if ((e as { code?: unknown }).code !== "EXDEV") throw e;
    copyFileSync(from, to);
  }
}

export interface BuiltRange {
  /** Parts in order, then the `transactions_extra` file; parts only if a check failed. */
  files: OutputFile[];
  checker: LedgerChecker;
  parts: number;
}

/**
 * Heights [start, end] read in one REPEATABLE READ snapshot, checked block by block, and written
 * under `dir` at their published paths. The caller decides what a failed check means; nothing is
 * written past the first one.
 */
export async function buildLedgerRange(
  client: Client,
  start: number,
  end: number,
  dir: string,
  afterChunk?: ChunkHook,
): Promise<BuiltRange> {
  const files: OutputFile[] = [];
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    // Each query is bounded before it runs (ledger.ts); this stops one that is not anyway.
    await client.query("SET LOCAL statement_timeout = '60s'");
    // The ordered reads sort ~100k rows a chunk: in memory, not in temporary files on disk.
    await client.query("SET LOCAL work_mem = '64MB'");
    const range = await readLedgerRange(client, start, end, {
      ...(afterChunk ? { afterChunk } : {}),
      onPart: (io, part, failing) => {
        // A NULL where none may be would otherwise throw here as something else.
        if (failing) return;
        files.push(
          writeFile(
            dir,
            transparentIoFile(start, part),
            TRANSPARENT_IO_COLUMNS,
            io,
            LEDGER_DICTIONARY,
          ),
        );
      },
    });
    await client.query("COMMIT");
    if (range.checker.failures.size === 0) {
      files.push(
        writeFile(dir, transactionsExtraFile(start), TRANSACTIONS_EXTRA_COLUMNS, range.extra),
      );
    }
    return { files, checker: range.checker, parts: range.parts };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/**
 * Moves a built closed range from `tmp` into the cache and writes its sidecar last, by rename, so
 * a range is either wholly cached or not at all.
 */
export function commitRange(cache: string, tmp: string, start: number, built: BuiltRange): Sidecar {
  if (built.checker.failures.size > 0) {
    throw new Error(`ledger range ${start} failed a check and cannot be cached`);
  }
  for (const f of built.files) {
    mkdirSync(dirname(join(cache, f.path)), { recursive: true });
    renameSync(join(tmp, f.path), join(cache, f.path));
  }
  rmSync(tmp, { recursive: true, force: true });
  const sidecar: Sidecar = {
    version: LEDGER_CACHE_VERSION,
    start,
    end: rangeEnd(start),
    files: built.files,
    underclaimZat: built.checker.underclaimZat.toString(),
    underclaimedBlocks: built.checker.underclaimedBlocks,
    skippedBlocks: built.checker.skippedBlocks,
    builtAt: new Date().toISOString(),
    indexerCommit: process.env.OPENDATA_GIT_SHA ?? "unknown",
    stringsChecked: true,
  };
  writeSidecar(cache, sidecar);
  return sidecar;
}
