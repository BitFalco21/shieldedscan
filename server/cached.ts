/** The default time a value is held: long enough to absorb traffic, short next to a day. */
const DEFAULT_TTL_MS = 10 * 60_000;

/**
 * One value, remembered for `ttlMs`.
 *
 * The TTL is a constructor argument (the DeFiLlama route caches a large third-party index for much
 * longer than ten minutes). A `load()` that throws stores nothing and the error propagates: a
 * failed upstream read must reach the caller as a failure, never as an empty result cached for the
 * TTL.
 */
export class Cached<T> {
  readonly #ttlMs: number;
  #value: { at: number; data: T } | null = null;
  /**
   * Single-flight: concurrent misses share one `load()`, so a cold, slow query does not run once
   * per concurrent reader on a small pool. A rejected load is dropped, never stored, so the next
   * caller retries.
   */
  #inflight: Promise<T> | null = null;
  /**
   * How long past its TTL a value may still be served while a refresh runs behind it. 0 (the
   * default) makes an expired value wait for its reload. Opt-in for series whose source changes
   * hourly at most and whose reload is a slow cold query. Past the window the next caller waits
   * again, so an outage still reaches someone as a failure rather than an old answer served
   * forever.
   */
  readonly #staleMs: number;
  constructor(ttlMs: number = DEFAULT_TTL_MS, opts: { staleMs?: number } = {}) {
    this.#ttlMs = ttlMs;
    this.#staleMs = opts.staleMs ?? 0;
  }
  async get(load: () => Promise<T>): Promise<T> {
    const held = this.#value;
    const age = held === null ? Infinity : Date.now() - held.at;
    if (held && age < this.#ttlMs) return held.data;
    if (held && age < this.#ttlMs + this.#staleMs) {
      // A failed refresh keeps the held value until the window closes; nothing is stored.
      void this.#reload(load).catch(() => undefined);
      return held.data;
    }
    return this.#reload(load);
  }
  #reload(load: () => Promise<T>): Promise<T> {
    this.#inflight ??= load()
      .then((data) => {
        this.#value = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        this.#inflight = null;
      });
    return this.#inflight;
  }
  /**
   * Forget the stored value.
   *
   * A `load()` that throws already stores nothing, but a load that succeeds with a value meaning
   * "not available yet" looks like a real answer to this class, and holding it for the full TTL
   * would keep a 503 alive after its cause is fixed. `/chain/pulse/ribbons` clears it when a
   * matview is not yet populated, so the next request retries.
   */
  clear(): void {
    this.#value = null;
  }
}
