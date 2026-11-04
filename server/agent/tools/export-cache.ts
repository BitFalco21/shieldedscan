/**
 * What the export tool read, held per process and shared by every conversation, so a crowd asking
 * for the same file costs the API one in-process read, whatever the number of asks.
 *
 *  - Keyed by the exact in-process path, so two spellings of one request are one entry (the tool
 *    builds paths canonically).
 *  - Single-flight: concurrent misses on one key share one read.
 *  - Holds the summary the tool keeps (columns, a count, a few rows), never a whole body, and at
 *    most `maxEntries` of them, oldest out first.
 *  - A caller waits at most `timeoutMs`, then is told the read is unavailable; the read is left to
 *    finish and fill the entry. One still running after `abandonMs` is given up on.
 *  - A failed read (null, or a throw) is never served as data, and is remembered for `failMs` only,
 *    so an API answering badly is not asked again by every call in the meantime.
 */
export class ExportPreviewCache<T extends object> {
  readonly #timeoutMs: number;
  readonly #abandonMs: number;
  readonly #failMs: number;
  readonly #maxEntries: number;
  readonly #clock: () => number;
  readonly #held = new Map<string, { until: number; value: T }>();
  readonly #failed = new Map<string, number>();
  readonly #inflight = new Map<string, { since: number; read: Promise<T | null> }>();

  constructor(
    opts: {
      timeoutMs?: number;
      abandonMs?: number;
      failMs?: number;
      maxEntries?: number;
      clock?: () => number;
    } = {},
  ) {
    this.#timeoutMs = opts.timeoutMs ?? 20_000;
    this.#abandonMs = opts.abandonMs ?? 90_000;
    this.#failMs = opts.failMs ?? 10_000;
    this.#maxEntries = opts.maxEntries ?? 128;
    this.#clock = opts.clock ?? Date.now;
  }

  /** The value for `key`, read through `load` at most once per `ttlMs`; null when unavailable. */
  async get(key: string, ttlMs: number, load: () => Promise<T | null>): Promise<T | null> {
    const now = this.#clock();
    const held = this.#held.get(key);
    if (held !== undefined && now < held.until) return held.value;
    const failedAt = this.#failed.get(key);
    if (failedAt !== undefined && now - failedAt < this.#failMs) return null;
    let running = this.#inflight.get(key);
    if (running === undefined || now - running.since >= this.#abandonMs) {
      const entry: { since: number; read: Promise<T | null> } = {
        since: now,
        read: Promise.resolve(null),
      };
      entry.read = load()
        .catch(() => null)
        .then((value) => {
          if (value !== null) this.#hold(key, value, ttlMs);
          else this.#fail(key);
          return value;
        })
        .finally(() => {
          // Only its own entry: an abandoned read finishing late must not drop its replacement.
          if (this.#inflight.get(key) === entry) this.#inflight.delete(key);
        });
      this.#inflight.set(key, entry);
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

  #hold(key: string, value: T, ttlMs: number): void {
    this.#held.delete(key);
    this.#held.set(key, { until: this.#clock() + ttlMs, value });
    this.#failed.delete(key);
    while (this.#held.size > this.#maxEntries) {
      const oldest = this.#held.keys().next().value;
      if (oldest === undefined) break;
      this.#held.delete(oldest);
    }
  }

  #fail(key: string): void {
    this.#failed.set(key, this.#clock());
    // Failures are keyed by what a model asked, so they are bounded like the entries.
    while (this.#failed.size > this.#maxEntries) {
      const oldest = this.#failed.keys().next().value;
      if (oldest === undefined) break;
      this.#failed.delete(oldest);
    }
  }
}
