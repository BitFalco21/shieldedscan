import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { HttpNodeRpc } from "./node-rpc";

/**
 * Yield the host back to the follower between units of a long batch job.
 *
 * "Takes no exclusive lock" is not a sufficient test for a background job: a heavy full-table job
 * starves the follower's own periodic refreshes, which hold row locks the per-block delta needs,
 * so ingestion stalls indirectly. On a host with a small buffer cache, even a handful of
 * read-only queries can push ingestion minutes behind.
 *
 * Everything is injected (clock, sleep, both signals), so the policy is unit-testable without a
 * database. `readIngestLag` and `ioPressureAvg10` below are the real readers.
 */

/** How the caller should proceed after a unit of work. */
export type PaceVerdict = "continue" | "abort";

export interface IngestLag {
  /** Node tip minus our tip. The authoritative signal; see `PacerDeps.ingestLag`. */
  blocksBehind: number;
  /** Seconds since we last committed a block. Diagnostic only; see `PacerDeps.ingestLag`. */
  commitAgeSeconds: number;
}

export interface PacerDeps {
  /**
   * How far the follower is behind the node, in blocks.
   *
   * Not `now() - max(block.timestamp)`: that column is the miner-supplied header time, which can
   * skew and may run ahead of the wall clock. Not `now() - chain_sync_state.updated_at` either:
   * that is "time since we last committed a block", which is minutes long whenever no block has
   * been mined (arrival is Poisson around 75 s), so it would refuse to start on a healthy chain.
   *
   * Blocks-behind is 0 while the follower keeps up however slow the chain is, and rises only when
   * the follower genuinely cannot keep pace. `commitAgeSeconds` is carried for the log, never as a
   * trigger.
   */
  ingestLag: () => Promise<IngestLag>;
  /**
   * `some avg10` from `/proc/pressure/io`, or null when it cannot be read.
   *
   * Null means "no signal", and the pacer then relies on `ingestLag` alone. That is safe because
   * the lag is the authoritative signal; pressure is a supplementary early warning that lets the
   * job back off before a stall is measurable.
   */
  ioPressure: () => Promise<number | null>;
  sleep: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export interface PacerOptions {
  /**
   * Fraction of wall clock the job may spend working. 0.5 means "rest for as long as the chunk
   * itself took", roughly doubling the job's wall time.
   */
  duty?: number;
  /**
   * Blocks behind the node at or above which a sample counts as a stall.
   *
   * Five is roughly six minutes of ingestion debt at a 75 s target. Normal operation is 0–1: the
   * follower polls every few seconds, so it is briefly one block behind whenever one is mined.
   */
  stallBlocks?: number;
  /**
   * Consecutive stall samples before aborting. Two, not one: a single sample can catch a burst of
   * blocks arriving together, which is the follower working, not failing.
   */
  stallSamples?: number;
  /** `some avg10` above which to spend an extra rest period. */
  pressureThreshold?: number;
  /** How long to wait before re-sampling a suspected stall. */
  stallBackoffMs?: number;
}

export interface PacerStats {
  sleptMs: number;
  /** Times a sample came back at or above `stallBlocks`, including ones that then recovered. */
  stallSamples: number;
  /** Worst lag seen, in blocks behind the node. */
  maxBlocksBehind: number;
}

export interface Pacer {
  /**
   * Refuse to start against a follower that is already behind; otherwise the job would inherit
   * someone else's stall and either abort immediately or be blamed for it.
   */
  preflight: () => Promise<void>;
  /** Rest in proportion to the work just done, then decide whether it is safe to continue. */
  afterUnit: (workedMs: number) => Promise<PaceVerdict>;
  readonly stats: PacerStats;
}

export class IngestionBehindError extends Error {
  constructor(readonly blocksBehind: number) {
    super(
      `the follower is already ${blocksBehind} blocks behind the node; refusing to add load. ` +
        `Wait for it to catch up, or investigate before starting this job.`,
    );
    this.name = "IngestionBehindError";
  }
}

export function createPacer(deps: PacerDeps, options: PacerOptions = {}): Pacer {
  const duty = options.duty ?? 0.5;
  const stallBlocks = options.stallBlocks ?? 5;
  const stallSamples = options.stallSamples ?? 2;
  const pressureThreshold = options.pressureThreshold ?? 60;
  const stallBackoffMs = options.stallBackoffMs ?? 30_000;
  const log = deps.log ?? (() => {});

  if (duty <= 0 || duty > 1) throw new Error(`duty must be in (0, 1], got ${duty}`);

  const stats: PacerStats = { sleptMs: 0, stallSamples: 0, maxBlocksBehind: 0 };
  let consecutiveStalls = 0;

  const rest = async (ms: number): Promise<void> => {
    if (ms <= 0) return;
    stats.sleptMs += ms;
    await deps.sleep(ms);
  };

  const sampleLag = async (): Promise<IngestLag> => {
    const lag = await deps.ingestLag();
    if (lag.blocksBehind > stats.maxBlocksBehind) stats.maxBlocksBehind = lag.blocksBehind;
    return lag;
  };

  return {
    stats,

    async preflight() {
      const lag = await sampleLag();
      if (lag.blocksBehind >= stallBlocks) throw new IngestionBehindError(lag.blocksBehind);
      log(
        `pacer: follower ${lag.blocksBehind} block(s) behind the node (last commit ` +
          `${lag.commitAgeSeconds}s ago), duty ${duty}, abort at ${stallBlocks} blocks`,
      );
    },

    async afterUnit(workedMs: number) {
      // `duty` is the fraction of wall clock spent working, so the rest is worked × (1−duty)/duty.
      await rest(Math.round((workedMs * (1 - duty)) / duty));

      const pressure = await deps.ioPressure();
      if (pressure !== null && pressure > pressureThreshold) {
        log(`pacer: io pressure ${pressure.toFixed(1)}, resting again`);
        await rest(workedMs);
      }

      // A stall only counts if it persists, so a suspected one is re-sampled rather than acted on.
      // Each pass is one sample; recovery resets the count, because the target is a follower that
      // has stopped, not one that is merely slow.
      for (;;) {
        const lag = await sampleLag();
        if (lag.blocksBehind < stallBlocks) {
          if (consecutiveStalls > 0) {
            log(`pacer: ingestion recovered to ${lag.blocksBehind} block(s) behind`);
          }
          consecutiveStalls = 0;
          return "continue";
        }

        consecutiveStalls += 1;
        stats.stallSamples += 1;
        log(
          `pacer: follower ${lag.blocksBehind} blocks behind (sample ` +
            `${consecutiveStalls}/${stallSamples} at or above ${stallBlocks})`,
        );
        if (consecutiveStalls >= stallSamples) {
          // Abort is a return, not a throw. The watermark is committed per unit, so stopping is a
          // resumable pause; an exception would make the entrypoint exit non-zero as if the job had
          // failed.
          log(
            `pacer: ABORTING — ingestion has not recovered. Resume when the follower is caught up.`,
          );
          return "abort";
        }
        await rest(stallBackoffMs);
      }
    },
  };
}

/**
 * How far the follower is behind the node, read from Postgres and the node's tip height.
 *
 * `commitAgeSeconds` comes from `chain_sync_state.updated_at`, written inside the same
 * transaction as every ingested block; it is carried for the log only (see `PacerDeps.ingestLag`).
 *
 * If either side cannot be read, the lag is reported as `Infinity`, so a job refuses to start
 * rather than treating "no evidence" as "ingestion is fine".
 */
export async function readIngestLag(
  pool: Pool,
  nodeTip: () => Promise<number>,
): Promise<IngestLag> {
  const { rows } = await pool.query<{ tip: number | null; age: string | null }>(
    `SELECT (SELECT max(height) FROM block) AS tip,
            (SELECT (EXTRACT(EPOCH FROM now())::bigint - updated_at)::text
               FROM chain_sync_state WHERE id = TRUE) AS age`,
  );
  const ourTip = rows[0]?.tip ?? null;
  const commitAgeSeconds = rows[0]?.age == null ? Number.POSITIVE_INFINITY : Number(rows[0].age);
  if (ourTip === null) return { blocksBehind: Number.POSITIVE_INFINITY, commitAgeSeconds };
  try {
    const tip = await nodeTip();
    // Negative means our tip is ahead of the node's, which happens briefly after a node restart
    // drops its non-finalized state: the node catching up, not us falling behind.
    return { blocksBehind: Math.max(0, tip - ourTip), commitAgeSeconds };
  } catch {
    return { blocksBehind: Number.POSITIVE_INFINITY, commitAgeSeconds };
  }
}

/**
 * `some avg10` from `/proc/pressure/io`: the share of the last ten seconds in which at least one
 * task was stalled on I/O.
 *
 * Without cgroup2 PSI delegation, a container reads the host's root cgroup, which is the signal
 * wanted here: the I/O being waited on is Postgres's, in a different container.
 *
 * Returns null on any failure: an unreadable file is "no signal", never "quiet".
 */
export async function ioPressureAvg10(
  read: (path: string) => Promise<string>,
): Promise<number | null> {
  try {
    const text = await read("/proc/pressure/io");
    const match = /^some\s+avg10=([0-9.]+)/m.exec(text);
    if (match === null) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** How long the pacer waits for the node's tip before counting it unreadable. */
const NODE_TIP_TIMEOUT_MS = 10_000;

/**
 * The pacer every batch job on this host uses: ingestion lag from Postgres and the node at
 * `nodeRpcUrl`, I/O pressure from `/proc`, and real sleeps.
 */
export function hostPacer(
  pool: Pool,
  nodeRpcUrl: string,
  log: (message: string) => void,
  options: PacerOptions = {},
): Pacer {
  const node = new HttpNodeRpc(nodeRpcUrl, { timeoutMs: NODE_TIP_TIMEOUT_MS });
  return createPacer(
    {
      ingestLag: () => readIngestLag(pool, () => node.getTipHeight()),
      ioPressure: () => ioPressureAvg10((path) => readFile(path, "utf8")),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log,
    },
    options,
  );
}
