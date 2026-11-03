import type { SourceRows } from "./chart-sources";

/**
 * Parsed chart sources, held per process and shared by every conversation, so a chart costs the
 * database nothing past one read of each source per `ttlMs`, however many people ask at once.
 *
 *  - Single-flight: concurrent misses on one source share one read.
 *  - A failed read (null, or a throw) is never stored: the next caller retries.
 *  - A caller waits at most `timeoutMs` and is then told the source is unavailable. The read itself
 *    is left to finish and fill the cache, so a slow cold source helps the next caller instead of
 *    being started again.
 *
 * The routes behind most sources keep their own ten-minute cache; this one also spares the parse of
 * whole-history bodies on every call, and is the only cache in front of the cross-chain series and
 * the price history, which their routes do not cache in-process.
 */
export class ChartSourceCache {
  readonly #ttlMs: number;
  readonly #timeoutMs: number;
  readonly #clock: () => number;
  readonly #held = new Map<string, { at: number; rows: SourceRows }>();
  readonly #inflight = new Map<string, Promise<SourceRows | null>>();

  constructor(opts: { ttlMs?: number; timeoutMs?: number; clock?: () => number } = {}) {
    this.#ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.#timeoutMs = opts.timeoutMs ?? 20_000;
    this.#clock = opts.clock ?? Date.now;
  }

  async get(name: string, load: () => Promise<SourceRows | null>): Promise<SourceRows | null> {
    const held = this.#held.get(name);
    if (held !== undefined && this.#clock() - held.at < this.#ttlMs) return held.rows;
    let running = this.#inflight.get(name);
    if (running === undefined) {
      running = load()
        .catch(() => null)
        .then((rows) => {
          if (rows !== null) this.#held.set(name, { at: this.#clock(), rows });
          return rows;
        })
        .finally(() => this.#inflight.delete(name));
      this.#inflight.set(name, running);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.#timeoutMs);
    });
    try {
      return await Promise.race([running, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
