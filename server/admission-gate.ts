/**
 * A bounded admission gate: at most `max` units of work run at once, at most `maxWaiting` wait,
 * and a waiter gives up after `maxWaitMs`. Used for the agent's concurrent turns and the public
 * windowed analytics. It admits whole requests rather than rationing database connections, since
 * each request runs several sub-queries in parallel and would otherwise wait on its own second
 * connection under load.
 *
 * It counts waiters and never identifies them.
 */
export class AdmissionGate {
  #inFlight = 0;
  readonly #waiters: (() => void)[] = [];
  readonly #max: number;
  readonly #maxWaiting: number;
  readonly #maxWaitMs: number;

  constructor(max: number, maxWaiting: number, maxWaitMs: number) {
    this.#max = max;
    this.#maxWaiting = maxWaiting;
    this.#maxWaitMs = maxWaitMs;
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  get waiting(): number {
    return this.#waiters.length;
  }

  /**
   * `admitted` with a slot taken; `full` when the waiting room is also full; `timeout` when no
   * slot freed in time. An aborted signal also resolves `timeout`: the caller has gone and nothing
   * should run for it.
   */
  acquire(signal?: AbortSignal): Promise<"admitted" | "full" | "timeout"> {
    if (this.#inFlight < this.#max) {
      this.#inFlight++;
      return Promise.resolve("admitted");
    }
    if (this.#waiters.length >= this.#maxWaiting) return Promise.resolve("full");
    return new Promise((resolve) => {
      let settled = false;
      const settle = (outcome: "admitted" | "timeout") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const at = this.#waiters.indexOf(wake);
        if (at !== -1) this.#waiters.splice(at, 1);
        resolve(outcome);
      };
      const wake = () => {
        // The releasing turn hands its slot straight over: the count never dips and refills.
        this.#inFlight++;
        settle("admitted");
      };
      const onAbort = () => settle("timeout");
      const timer = setTimeout(() => settle("timeout"), this.#maxWaitMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.push(wake);
    });
  }

  /** Give a slot back; the longest-waiting caller, if any, takes it immediately. */
  release(): void {
    this.#inFlight--;
    const next = this.#waiters.shift();
    if (next !== undefined) next();
  }
}
