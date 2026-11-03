import type { SourceRows } from "./chart-sources";

/**
 * Parsed chart sources, held per process and shared by every conversation, so a chart costs the
 * database nothing past one read of each source per `ttlMs`, however many people ask at once.
 *
 *  - Single-flight: concurrent misses on one source share one read.
 *  - A caller waits at most `timeoutMs` and is then told the source is unavailable. The read itself
 *    is left to finish and fill the cache, so a slow cold source helps the next caller instead of
 *    being started again; one still running after `abandonMs` is given up on, so a read that never
 *    returns cannot make the source unavailable for the life of the process.
 *  - A failed read (null, or a throw) is never served as data. It is remembered for `failMs` only,
 *    so a source answering badly is not read again by every call that asks for it, and is retried
 *    soon after.
 *
 * The routes behind most sources keep their own ten-minute cache; this one also spares the parse of
 * whole-history bodies on every call, and is the only cache in front of the cross-chain series and
 * the price history, which their routes do not cache in-process.
 */
export class ChartSourceCache {
  readonly #ttlMs: number;
  readonly #timeoutMs: number;
  readonly #abandonMs: number;
  readonly #failMs: number;
  readonly #clock: () => number;
  readonly #held = new Map<string, { at: number; rows: SourceRows }>();
  readonly #failed = new Map<string, number>();
  readonly #inflight = new Map<string, { since: number; read: Promise<SourceRows | null> }>();

  constructor(
    opts: {
      ttlMs?: number;
      timeoutMs?: number;
      abandonMs?: number;
      failMs?: number;
      clock?: () => number;
    } = {},
  ) {
    this.#ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.#timeoutMs = opts.timeoutMs ?? 20_000;
    this.#abandonMs = opts.abandonMs ?? 90_000;
    this.#failMs = opts.failMs ?? 30_000;
    this.#clock = opts.clock ?? Date.now;
  }

  async get(name: string, load: () => Promise<SourceRows | null>): Promise<SourceRows | null> {
    const now = this.#clock();
    const held = this.#held.get(name);
    if (held !== undefined && now - held.at < this.#ttlMs) return held.rows;
    const failedAt = this.#failed.get(name);
    if (failedAt !== undefined && now - failedAt < this.#failMs) return null;
    let running = this.#inflight.get(name);
    if (running === undefined || now - running.since >= this.#abandonMs) {
      const entry = { since: now, read: Promise.resolve<SourceRows | null>(null) };
      entry.read = load()
        .catch(() => null)
        .then((rows) => {
          if (rows !== null) {
            this.#held.set(name, { at: this.#clock(), rows });
            this.#failed.delete(name);
          } else {
            this.#failed.set(name, this.#clock());
          }
          return rows;
        })
        .finally(() => {
          // Only its own entry: an abandoned read finishing late must not drop its replacement.
          if (this.#inflight.get(name) === entry) this.#inflight.delete(name);
        });
      this.#inflight.set(name, entry);
      running = entry;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.#timeoutMs);
    });
    try {
      return await Promise.race([running.read, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
