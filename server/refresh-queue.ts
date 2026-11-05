/**
 * The follower's view refreshes, run one at a time.
 *
 * Each refresh re-reads a large table (`tx` and its indexes are bigger than the page cache leaves
 * room for). Started side by side, the passes compete for the same disk, every one of them gets
 * slower, and the API's reads stall behind them for seconds. One at a time, the disk carries a
 * single scan and each pass finishes sooner.
 *
 * A view already waiting or running is not queued twice: these are full recomputations, so a
 * skipped pass costs nothing. It is logged, because a view that silently stops refreshing looks
 * exactly like a fresh one.
 */
export interface RefreshJob {
  name: string;
  /** Resolves to the number of rows it changed, when it knows. */
  refresh: () => Promise<void | number>;
}

export interface RefreshQueue {
  /** Queues each job of a group behind whatever is already waiting. */
  enqueue: (jobs: readonly RefreshJob[]) => void;
  /** Resolves once nothing is waiting or running. */
  idle: () => Promise<void>;
}

export function createRefreshQueue(log: (line: string) => void): RefreshQueue {
  const waiting: { job: RefreshJob; queuedAt: number }[] = [];
  const pending = new Set<string>();
  // Cleared by `drain` in the same tick it finds the queue empty, so a job queued after that
  // always starts a new drain instead of sitting in `waiting` with nothing to drain it.
  let draining = false;
  let running: Promise<void> = Promise.resolve();

  async function drain(): Promise<void> {
    for (;;) {
      const next = waiting.shift();
      if (next === undefined) {
        draining = false;
        return;
      }
      const { job, queuedAt } = next;
      const startedAt = Date.now();
      try {
        const rows = await job.refresh();
        const waited = startedAt - queuedAt;
        log(
          `${job.name} refreshed in ${Date.now() - startedAt}ms` +
            (typeof rows === "number" ? ` (${rows} rows changed)` : "") +
            (waited >= 1000 ? `, after ${waited}ms in the queue` : ""),
        );
      } catch (error: unknown) {
        log(`${job.name} refresh FAILED (view keeps its previous contents): ${String(error)}`);
      } finally {
        pending.delete(job.name);
      }
    }
  }

  return {
    enqueue(jobs) {
      for (const job of jobs) {
        if (pending.has(job.name)) {
          log(`${job.name} refresh SKIPPED — the previous pass is still queued or running`);
          continue;
        }
        pending.add(job.name);
        waiting.push({ job, queuedAt: Date.now() });
      }
      if (!draining && waiting.length > 0) {
        draining = true;
        running = drain();
      }
    },
    idle: () => running,
  };
}
