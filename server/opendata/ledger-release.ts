import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import type { ChunkHook } from "./ledger";
import {
  buildLedgerRange,
  commitRange,
  hashFile,
  linkInto,
  rangeEnd,
  readSidecar,
  sidecarProblems,
} from "./ledger-cache";
import type { OutputFile } from "./read";
import { HEIGHTS_PER_LEDGER_FILE, LEDGER_CACHE_VERSION } from "./tables";

/**
 * The transparent ledger in a release: who builds which range, and whether it is published.
 *
 * With N the release height, a range is closed when it ends below N and open when it contains N.
 *  - Closed ranges come from the cache, by sidecar. The night builder fills it; the release builds
 *    a closed range itself only among the newest few (the tip crossed a boundary since the builder
 *    last ran), and caches it exactly as the builder would.
 *  - The open range is built by every release, up to N, and never cached: it is not final.
 *  - While an older closed range is not cached, the release publishes no ledger at all, never part
 *    of one. No flag: the first release after the cache is complete publishes it.
 * Builder and release share a lock and the sidecar is the only "done" mark, so a range is built
 * once; built twice, it would give the same bytes.
 */

/** Newest closed ranges a release builds when the cache lacks them: ~9 days of blocks from NU7. */
export const RELEASE_BUILDS_AT_MOST = 3;

export const isLedgerPath = (path: string) =>
  path.startsWith("transparent_io/") || path.startsWith("transactions_extra/");

/** A range's sidecar: this cache version, another one ("stale", rebuilt like a missing one), none. */
export type RangeState = "cached" | "stale" | "absent";

export interface LedgerPlan {
  open: { start: number; end: number };
  carry: number[];
  build: number[];
  /** Closed ranges too old for the release to build, not cached: the ledger is withheld. */
  missing: number[];
  /** Of `build` and `missing`, those cached for another version. */
  stale: number;
}

export function planLedger(
  height: number,
  state: (start: number) => RangeState,
  buildsAtMost = RELEASE_BUILDS_AT_MOST,
): LedgerPlan {
  const closed: number[] = [];
  for (let start = 0; rangeEnd(start) < height; start += HEIGHTS_PER_LEDGER_FILE) {
    closed.push(start);
  }
  const plan: LedgerPlan = {
    open: { start: closed.length * HEIGHTS_PER_LEDGER_FILE, end: height },
    carry: [],
    build: [],
    missing: [],
    stale: 0,
  };
  const newest = closed.length - buildsAtMost;
  closed.forEach((start, i) => {
    const s = state(start);
    if (s === "stale") plan.stale++;
    if (s === "cached") plan.carry.push(start);
    else (i >= newest ? plan.build : plan.missing).push(start);
  });
  return plan;
}

export interface LedgerContext {
  /** The release's snapshot connection, outside any transaction. */
  client: Client;
  height: number;
  afterChunk: ChunkHook;
}

export interface LedgerReleaseOptions {
  cacheDir: string;
  /** The release's staging directory. */
  outDir: string;
  /**
   * Whether a carried file may skip re-hashing: true when the last release published this path
   * with this hash (it was verified then, and the published copy is the same bytes on disk) and
   * the run is not `--full`.
   */
  trusted: (path: string, sha256: string) => boolean;
  log?: (line: string) => void;
  buildsAtMost?: number;
}

export type LedgerOutcome =
  | { status: "withheld"; closed: number; notCached: number; stale: number }
  | {
      status: "published";
      files: OutputFile[];
      failures: string[];
      carried: number;
      built: number[];
      open: { start: number; end: number };
      underclaimZat: bigint;
      underclaimedBlocks: number;
      skippedBlocks: number;
    };

/**
 * Why a withheld ledger must stop the release, or null if it may simply wait. Once published it
 * cannot be withheld again: its files would leave the manifest, and the dataset would silently
 * lose a table. Until the cache is whole again (after a version bump, or a lost cache), no release.
 */
export function withheldFailure(
  outcome: Extract<LedgerOutcome, { status: "withheld" }>,
  publishedBefore: boolean,
): string | null {
  if (!publishedBefore) return null;
  const stale = outcome.stale > 0 ? `, ${outcome.stale} of them for another cache version` : "";
  return `the ledger was published, but ${outcome.notCached} of ${outcome.closed} closed ranges are not cached${stale}`;
}

export async function releaseLedger(
  ctx: LedgerContext,
  opts: LedgerReleaseOptions,
): Promise<LedgerOutcome> {
  const log = opts.log ?? (() => {});
  const plan = planLedger(
    ctx.height,
    (start) => {
      const s = readSidecar(opts.cacheDir, start);
      return s === null ? "absent" : s.version === LEDGER_CACHE_VERSION ? "cached" : "stale";
    },
    opts.buildsAtMost,
  );
  const closed = plan.carry.length + plan.build.length + plan.missing.length;
  if (plan.missing.length > 0) {
    return {
      status: "withheld",
      closed,
      notCached: plan.missing.length + plan.build.length,
      stale: plan.stale,
    };
  }

  const failures: string[] = [];
  const files: OutputFile[] = [];
  let underclaimZat = 0n;
  let underclaimedBlocks = 0;
  let skippedBlocks = 0;
  const range = (start: number, end = rangeEnd(start)) => `ledger ${start}-${end}`;

  // Newly closed ranges first, into the cache, so every closed range is then carried one way.
  // The temporary folder is cleared first: a crashed run may have left one behind.
  const built: number[] = [];
  const tmp = join(opts.cacheDir, ".tmp-release");
  rmSync(tmp, { recursive: true, force: true });
  for (const start of plan.build) {
    const b = await buildLedgerRange(ctx.client, start, rangeEnd(start), tmp, ctx.afterChunk);
    if (b.checker.failures.size > 0) {
      failures.push(...b.checker.failures.list().map((f) => `${range(start)}: ${f}`));
      rmSync(tmp, { recursive: true, force: true });
      continue;
    }
    commitRange(opts.cacheDir, tmp, start, b);
    built.push(start);
    log(`${range(start)}: built and cached by the release`);
  }

  for (const start of [...plan.carry, ...built].sort((a, b) => a - b)) {
    const s = readSidecar(opts.cacheDir, start)!;
    const problems = sidecarProblems(opts.cacheDir, s, start);
    if (problems.length > 0) {
      failures.push(...problems);
      continue;
    }
    for (const f of s.files) {
      const from = join(opts.cacheDir, f.path);
      if (!opts.trusted(f.path, f.sha256) && hashFile(from) !== f.sha256) {
        failures.push(`ledger cache ${start}: ${f.path} does not match its sidecar's hash`);
        continue;
      }
      linkInto(from, join(opts.outDir, f.path));
      files.push(f);
    }
    underclaimZat += BigInt(s.underclaimZat);
    underclaimedBlocks += s.underclaimedBlocks;
    skippedBlocks += s.skippedBlocks;
  }

  const open = await buildLedgerRange(
    ctx.client,
    plan.open.start,
    plan.open.end,
    opts.outDir,
    ctx.afterChunk,
  );
  failures.push(
    ...open.checker.failures.list().map((f) => `${range(plan.open.start, plan.open.end)}: ${f}`),
  );
  files.push(...open.files);
  underclaimZat += open.checker.underclaimZat;
  underclaimedBlocks += open.checker.underclaimedBlocks;
  skippedBlocks += open.checker.skippedBlocks;

  return {
    status: "published",
    files,
    failures,
    carried: plan.carry.length,
    built,
    open: plan.open,
    underclaimZat,
    underclaimedBlocks,
    skippedBlocks,
  };
}
