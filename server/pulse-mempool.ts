import type { PulsePendingFrame, Transaction } from "@/domain";
import { pulseEventForTx, type PulseEvent } from "@/domain";

/**
 * The mempool layer behind `/chain/pulse/pending`: what our node is holding, as movements.
 *
 * Ids come from one `getrawmempool` every few seconds, and each transaction is fetched exactly
 * once however long it sits there, so the cost is per arrival rather than per poll; refetching
 * every entry each pass would multiply node calls against the node that serves every page.
 *
 * A tracker rather than a request-path read, like `PriceTracker`: a page poll costs a memory read,
 * and the node is asked on our schedule, not the visitor's.
 *
 * Everything here is unconfirmed: `pulseEventForTx` marks a transaction with no height `pending`.
 * A pending pulse either is replaced by the confirmed pulse with the same txid, or fades having
 * left the mempool without being mined.
 */

/** How often the ids are read. Under Zcash's 75-second block target by a wide margin. */
export const PULSE_MEMPOOL_POLL_MS = 5_000;

/**
 * How many movements are drawn. A cap on marks, not on knowledge: `count` always states what the
 * mempool held, so a capped snapshot reads "N pending · M drawn".
 */
export const PULSE_PENDING_DRAW_CAP = 60;

/**
 * How many transactions are remembered, so a long-running process does not grow an unbounded map.
 * An evicted entry that comes back is simply fetched again: the cache is an optimisation and never
 * decides whether a movement appears.
 */
const DEFAULT_CACHE_SIZE = 500;

/**
 * How many new transactions one pass may fetch. Fetches are sequential, so an unbounded pass over
 * a freshly filled mempool would outlive its interval. The remainder is fetched on later passes;
 * until then those ids are counted but not drawn.
 */
const DEFAULT_FETCH_BUDGET = 50;

export interface PulseMempoolDeps {
  /** `getrawmempool` — the ids our node is holding. */
  ids: () => Promise<string[]>;
  /**
   * One transaction by id. `undefined` when the node no longer has it, which is ordinary:
   * an entry can be mined or evicted between the two calls.
   */
  transaction: (txid: string) => Promise<Transaction | undefined>;
  now?: () => number;
  log?: (message: string) => void;
}

export interface PulseMempoolOptions {
  cacheSize?: number;
  fetchBudget?: number;
}

export class PulseMempoolTracker {
  readonly #deps: Required<Pick<PulseMempoolDeps, "ids" | "transaction">> &
    Pick<PulseMempoolDeps, "log"> & { now: () => number };
  readonly #cacheSize: number;
  readonly #fetchBudget: number;
  /**
   * Whether a pass is running. A pass can outlive the timer's interval, and two overlapping passes
   * would let the slower one overwrite a fresh snapshot with a staler `asOf`. A skipped tick costs
   * nothing.
   */
  #polling = false;
  /**
   * txid → the movement it draws, or `null` for one the node would not answer for. The null means
   * "seen", so a vanished-but-still-listed entry is not re-requested on every poll. Insertion order
   * is the eviction order.
   */
  readonly #seen = new Map<string, PulseEvent | null>();
  #snapshot: PulsePendingFrame | null = null;
  #timer: NodeJS.Timeout | null = null;

  constructor(deps: PulseMempoolDeps, options: PulseMempoolOptions = {}) {
    this.#deps = { ...deps, now: deps.now ?? Date.now };
    this.#cacheSize = Math.max(1, options.cacheSize ?? DEFAULT_CACHE_SIZE);
    this.#fetchBudget = Math.max(1, options.fetchBudget ?? DEFAULT_FETCH_BUDGET);
  }

  start(): void {
    if (this.#timer !== null) return;
    void this.poll();
    this.#timer = setInterval(() => void this.poll(), PULSE_MEMPOOL_POLL_MS);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * The last successful read, or null before there has been one. Never an empty snapshot:
   * `{count: 0}` is a measurement, and a tracker that has not been answered has made none. The
   * route turns null into a 503.
   */
  snapshot(): PulsePendingFrame | null {
    return this.#snapshot;
  }

  /**
   * One pass: read the ids, fetch what is new, draw what is held.
   *
   * Never throws. A failed pass leaves the previous snapshot standing with its own `asOf`, so the
   * page can judge its age, rather than taking the endpoint down for a blip.
   */
  async poll(): Promise<void> {
    // A pass already running owns the snapshot; overlapping passes would finish in an arbitrary
    // order.
    if (this.#polling) return;
    this.#polling = true;
    try {
      await this.#pass();
    } finally {
      this.#polling = false;
    }
  }

  async #pass(): Promise<void> {
    let ids: string[];
    try {
      ids = await this.#deps.ids();
    } catch (error) {
      this.#deps.log?.(`pulse mempool poll failed: ${String(error)}`);
      return;
    }
    // Stamped before the fetches: `asOf` names when the mempool was read, not when the answer was
    // assembled.
    const asOf = Math.floor(this.#deps.now() / 1000);

    let budget = this.#fetchBudget;
    for (const txid of ids) {
      if (this.#seen.has(txid)) continue;
      if (budget <= 0) break; // the rest are still in the mempool next pass
      budget -= 1;
      try {
        const tx = await this.#deps.transaction(txid);
        // `pulseEventForTx(tx, null)`: the index is not consulted for a mempool transaction, so
        // Sprout's public JoinSplit value is not carried here. Null draws a floor-sized dashed leg
        // saying so, never a redaction bar, which means "encrypted by design", not a gap in our
        // view.
        this.#remember(txid, tx === undefined ? null : pulseEventForTx(tx, null));
      } catch (error) {
        this.#deps.log?.(`pulse mempool fetch failed for ${txid}: ${String(error)}`);
      }
    }

    const events: PulseEvent[] = [];
    for (const txid of ids) {
      const event = this.#seen.get(txid);
      if (event) events.push(event);
    }
    const drawn = events.slice(0, PULSE_PENDING_DRAW_CAP);
    this.#snapshot = {
      asOf,
      count: ids.length,
      events: drawn,
      // Also true when an entry was counted but could not be drawn: our node listed it and we have
      // no movement to show for it.
      ...(drawn.length < ids.length ? { truncated: true as const } : {}),
    };
  }

  #remember(txid: string, event: PulseEvent | null): void {
    this.#seen.set(txid, event);
    while (this.#seen.size > this.#cacheSize) {
      const oldest = this.#seen.keys().next().value;
      if (oldest === undefined) break;
      this.#seen.delete(oldest);
    }
  }
}
