/**
 * A token bucket over ledger rows: the long-run read rate of the night build never exceeds
 * `perSecond`, whatever the pacer's duty cycle allows.
 *
 * The duty cycle bounds the build's share of time, not its volume: in a dense era a chunk reads
 * several times the rows of a sparse one in the same time. A row cap bounds the volume itself.
 * The bucket holds at most `burstSeconds` of rows, so a long rest (I/O pressure, a stop) never
 * turns into a long full-speed catch-up afterwards.
 */
export class RowRate {
  readonly #perSecond: number;
  readonly #capacity: number;
  readonly #now: () => number;
  #tokens: number;
  #at: number;

  constructor(perSecond: number, burstSeconds: number, now: () => number = Date.now) {
    if (!(perSecond > 0) || !(burstSeconds > 0)) throw new Error("RowRate needs positive limits");
    this.#perSecond = perSecond;
    this.#capacity = perSecond * burstSeconds;
    this.#now = now;
    this.#tokens = this.#capacity;
    this.#at = now();
  }

  /** Spends `rows`; returns how many milliseconds to wait before the next chunk (0 when within). */
  take(rows: number): number {
    const now = this.#now();
    this.#tokens = Math.min(
      this.#capacity,
      // A clock stepped backwards credits nothing rather than owing a long sleep.
      this.#tokens + (Math.max(0, now - this.#at) / 1000) * this.#perSecond,
    );
    this.#at = now;
    this.#tokens -= rows;
    return this.#tokens < 0 ? Math.ceil((-this.#tokens / this.#perSecond) * 1000) : 0;
  }
}
