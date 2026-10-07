import { sleep } from "./venues";

/**
 * Serialises calls and spaces them by at least `minIntervalMs`.
 *
 * NEAR Intents rate-limits to one request per five seconds per key, so the budget is shared by
 * everything holding that key (the live poller and the historical backfill). Two independent
 * limiters would each respect the interval and still collide, so there is one instance per key
 * and both callers queue on it. This is also why the backfill runs inside the poller process.
 */
export class RateLimiter {
  #tail: Promise<unknown> = Promise.resolve();
  #lastStart = 0;

  constructor(private readonly minIntervalMs: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    // Chain onto the tail so tasks execute one at a time, in call order. A rejection is
    // swallowed for the *queue* only — the caller still receives it.
    const result = this.#tail.then(async () => {
      const waitFor = this.#lastStart + this.minIntervalMs - Date.now();
      if (waitFor > 0) await sleep(waitFor);
      this.#lastStart = Date.now();
      return task();
    });
    this.#tail = result.catch(() => undefined);
    return result;
  }
}
