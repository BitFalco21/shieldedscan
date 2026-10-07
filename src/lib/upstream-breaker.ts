/**
 * A circuit breaker for the read-only API, shared by every adapter that talks to it.
 *
 * Without it, a dead backend makes every server render wait out its full retry budget, and
 * serverless billing makes an outage cost in proportion to its duration. After `threshold`
 * consecutive failed requests the circuit opens and every call fails at once, with no fetch,
 * for `openMs`; then one probe is let through, and its outcome closes or reopens the circuit.
 *
 * What a reader sees does not change: the rejection is classified by `isTransientUpstream`
 * like any outage, and nothing here is cached or a fallback.
 *
 * State is module-scoped, i.e. per warm function instance. It counts failed requests, not
 * failed attempts, so the retries inside one request still run while the circuit is closed
 * and a single stall is absorbed as before.
 */

/** Thrown while the circuit is open. Classified as transient by `isTransientUpstream`. */
export class UpstreamOpenError extends Error {
  constructor(path: string, openForMs: number) {
    super(`chain API circuit open (${Math.ceil(openForMs / 1000)}s left) for ${path}`);
    this.name = "UpstreamOpenError";
  }
}

export interface UpstreamBreakerOptions {
  /** Consecutive failed requests before the circuit opens. */
  threshold?: number;
  /** How long the circuit stays open before one probe is allowed through. */
  openMs?: number;
  /** Test seam for the clock. */
  now?: () => number;
}

export class UpstreamBreaker {
  readonly #threshold: number;
  readonly #openMs: number;
  readonly #now: () => number;
  #failures = 0;
  #openedAt: number | null = null;
  #probing = false;

  constructor({
    threshold = 3,
    openMs = 30_000,
    // Read the global at call time: binding `Date.now` here would pin the real clock even
    // after a test installs fake timers.
    now = () => Date.now(),
  }: UpstreamBreakerOptions = {}) {
    this.#threshold = threshold;
    this.#openMs = openMs;
    this.#now = now;
  }

  /**
   * Call before a request. Throws `UpstreamOpenError` while the circuit is open; once
   * `openMs` has elapsed it lets exactly one caller through as the probe and keeps refusing
   * the rest until that probe reports back.
   */
  assertClosed(path: string): void {
    if (this.#openedAt === null) return;
    const elapsed = this.#now() - this.#openedAt;
    if (elapsed >= this.#openMs && !this.#probing) {
      this.#probing = true;
      return;
    }
    throw new UpstreamOpenError(path, Math.max(0, this.#openMs - elapsed));
  }

  /** A request completed with any answer that is not a server failure — 200 and 404 alike. */
  recordSuccess(): void {
    this.#failures = 0;
    this.#openedAt = null;
    this.#probing = false;
  }

  /** A request exhausted its attempts, or the probe failed. */
  recordFailure(): void {
    this.#failures += 1;
    this.#probing = false;
    if (this.#failures >= this.#threshold) this.#openedAt = this.#now();
  }

  /** Test seam: forget everything, as a fresh instance would. */
  reset(): void {
    this.recordSuccess();
  }

  /** Test and diagnostics seam. */
  get isOpen(): boolean {
    return this.#openedAt !== null;
  }
}

/** The one API on the one box: every adapter shares one view of its health. */
export const apiBreaker = new UpstreamBreaker();
