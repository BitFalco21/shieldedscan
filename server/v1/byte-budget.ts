/**
 * A budget of bytes shared by every caller, keyed on nothing.
 *
 * Built for `include=raw`, the one public answer whose size is out of proportion to the request:
 * the widest transaction serialises to ~4 MB of hex, where other public responses stay under
 * ~175 KB. A request-count rate limit cannot bound that bandwidth; a byte count can, and it leaves
 * ordinary raw requests (a few KB) untouched.
 *
 * It lives in the app rather than Caddy because only the app knows an answer's size before
 * sending it (the MCP never offers `include=raw`, so `/v1` is the one door). Nothing about a
 * caller is kept, so one caller can spend it for everyone: a niche, opt-in field goes briefly
 * unavailable rather than the host's bandwidth going to one URL.
 *
 * A token bucket that is never overdrawn: a reservation is granted or refused whole, which is
 * exact for the indexed path (the hex is twice the serialised size the index stores, so the
 * bytes are known before the node is asked).
 */
export class ByteBudget {
  #tokens: number;
  #at: number;

  constructor(
    readonly capacityBytes: number,
    readonly refillBytesPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.#tokens = capacityBytes;
    this.#at = now();
  }

  /**
   * Reserves `bytes` when the budget holds them and returns 0; otherwise reserves nothing and
   * returns the whole seconds until it would (at least 1). A reservation above the capacity is
   * clamped to it, so no single answer can be refused forever.
   */
  reserve(bytes: number): number {
    const t = this.now();
    this.#tokens = Math.min(
      this.capacityBytes,
      this.#tokens + (Math.max(0, t - this.#at) / 1000) * this.refillBytesPerSecond,
    );
    this.#at = t;
    const need = Math.min(Math.max(0, bytes), this.capacityBytes);
    if (this.#tokens >= need) {
      this.#tokens -= need;
      return 0;
    }
    return Math.max(1, Math.ceil((need - this.#tokens) / this.refillBytesPerSecond));
  }
}

/** Hex bytes the public surface may serve a second, across every caller: about 8 Mbit/s. */
export const RAW_HEX_BYTES_PER_SECOND = 1_000_000;
/** What may be served at once before the rate applies: seven of the widest transaction. */
export const RAW_HEX_BURST_BYTES = 32_000_000;
