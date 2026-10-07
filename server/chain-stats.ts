import type { MempoolComposition, TxKind } from "@/domain";
import { parseBlock } from "@/data/chain/parse";
import type { HttpNodeRpc } from "./node-rpc";
import { readJsonCapped } from "./body-limit";
import { DAY_SECONDS } from "@/domain/time";

/**
 * The live statistics the node cannot answer in one call: the ZEC price and the 24-hour activity
 * counts. Both are kept as small in-memory trackers in the long-lived API process and served only
 * while fresh; when they are stale or cold the figure is absent, never a substituted value.
 */

// ------------------------------------------------------------------------- price

export interface PriceQuote {
  usd: number;
  /** Null when the feed carried no change figure — never coerced to a zero move. */
  change24hPct: number | null;
  fetchedAt: number;
}

/** CoinGecko's free endpoint, keyless. A Demo key only raises rate limits. */
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd&include_24hr_change=true";
const PRICE_INTERVAL_MS = 90_000;
/**
 * Past this age the price is withheld rather than served: an old price shown as live is a
 * fabricated figure. Exported because a replica applies the same rule to the quote it reads from
 * the primary (`live-state.ts`).
 */
export const PRICE_MAX_AGE_MS = 10 * 60_000;

export function parseCoingecko(body: unknown, now: number): PriceQuote | null {
  const zcash = (body as { zcash?: { usd?: unknown; usd_24h_change?: unknown } })?.zcash;
  if (typeof zcash?.usd !== "number" || !Number.isFinite(zcash.usd)) return null;
  return {
    usd: zcash.usd,
    change24hPct:
      typeof zcash.usd_24h_change === "number" && Number.isFinite(zcash.usd_24h_change)
        ? zcash.usd_24h_change
        : null,
    fetchedAt: now,
  };
}

export class PriceTracker {
  #quote: PriceQuote | null = null;
  #timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly log: (m: string) => void,
    private readonly apiKey?: string,
  ) {}

  /** The latest quote, or null when none has been fetched recently enough to be honest. */
  current(now = Date.now()): PriceQuote | null {
    if (this.#quote === null || now - this.#quote.fetchedAt > PRICE_MAX_AGE_MS) return null;
    return this.#quote;
  }

  async #poll(): Promise<void> {
    try {
      const res = await fetch(COINGECKO_URL, {
        headers: this.apiKey ? { "x-cg-demo-api-key": this.apiKey } : {},
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const quote = parseCoingecko(await readJsonCapped(res), Date.now());
      if (quote === null) throw new Error("unrecognised response shape");
      this.#quote = quote;
    } catch (error) {
      // Keep the previous quote; current() ages it out if the outage persists.
      this.log(`[price] fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  start(): () => void {
    void this.#poll();
    this.#timer = setInterval(() => void this.#poll(), PRICE_INTERVAL_MS);
    // Never let a stats timer keep the process alive after shutdown.
    this.#timer.unref();
    return () => clearTimeout(this.#timer);
  }
}

// ---------------------------------------------------------------------- 24h stats

export interface Stats24h {
  txCount24h: number;
  fullyShieldedPct24h: number;
  /** Blocks contributing — a consumer can judge coverage. */
  blocks: number;
}

interface BlockCounts {
  timestamp: number;
  transparent: number;
  mixed: number;
  shielded: number;
}

/**
 * How far past the 24-hour edge the walk reaches before it stops. Miner timestamps are only
 * loosely ordered, so the first block older than the edge is not proof that none beyond it is
 * younger; two hours is wider than any skew consensus allows a block to carry.
 */
const EDGE_SLACK_SECONDS = 2 * 3_600;
/**
 * A ceiling on the walk, in blocks. The window is a day, never a block count, because block
 * spacing differs across networks and upgrades (about 1,150 blocks a day at a 75 s target, more at
 * shorter targets, and far more during testnet bursts). Past this ceiling the figures are
 * withheld rather than undercounted.
 */
const MAX_WINDOW_BLOCKS = 20_000;
const REFRESH_INTERVAL_MS = 30_000;
const WARMUP_CONCURRENCY = 16;

/**
 * Maintains per-block activity counts for the trailing day.
 *
 * Coinbase is excluded by the rollup (one per block, no user intent; counting it would deflate the
 * shielded share). "Fully shielded" is the strict reading: z→z transactions only. A t→z shielding
 * transaction has transparent inputs and counts as mixed.
 *
 * Warm-up walks back from the tip until it passes the day's edge; after that each refresh fetches
 * only what the tip added. Blocks are immutable, so the window only changes at its ends.
 */
export class Stats24hTracker {
  readonly #byHeight = new Map<number, BlockCounts>();
  #warm = false;
  /** False when the walk hit `MAX_WINDOW_BLOCKS` before reaching the day's edge. */
  #coversDay = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly rpc: HttpNodeRpc,
    private readonly log: (m: string) => void,
    private readonly clock: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /** The stats, or null until the warm-up covers a whole day — absent, never a partial count. */
  current(now = this.clock()): Stats24h | null {
    if (!this.#warm || !this.#coversDay) return null;
    let transparent = 0;
    let mixed = 0;
    let shielded = 0;
    let blocks = 0;
    for (const counts of this.#byHeight.values()) {
      if (counts.timestamp < now - DAY_SECONDS) continue;
      transparent += counts.transparent;
      mixed += counts.mixed;
      shielded += counts.shielded;
      blocks += 1;
    }
    const total = transparent + mixed + shielded;
    return {
      txCount24h: total,
      fullyShieldedPct24h: total === 0 ? 0 : Math.round((shielded / total) * 1000) / 10,
      blocks,
    };
  }

  async #ingest(height: number): Promise<void> {
    const raw = await this.rpc.getBlock(height);
    const { rollup, block } = parseBlock(raw);
    this.#byHeight.set(height, {
      timestamp: block.timestamp,
      transparent: rollup.transparentTxCount,
      mixed: rollup.mixedTxCount,
      shielded: rollup.shieldedTxCount,
    });
  }

  /**
   * Walks down from the tip in batches until a block older than the day's edge (plus slack) is
   * held, fetching only heights not already held. Stops at genesis or at the ceiling, and records
   * which, so `current()` can withhold a window that does not reach back a full day.
   */
  async #refresh(): Promise<void> {
    const tip = await this.rpc.getTipHeight();
    const edge = this.clock() - DAY_SECONDS - EDGE_SLACK_SECONDS;
    const lowest = Math.max(0, tip - MAX_WINDOW_BLOCKS + 1);
    let covered = false;
    let floor = tip;
    for (let top = tip; top >= lowest && !covered; top -= WARMUP_CONCURRENCY) {
      const bottom = Math.max(lowest, top - WARMUP_CONCURRENCY + 1);
      const missing: number[] = [];
      for (let h = top; h >= bottom; h -= 1) if (!this.#byHeight.has(h)) missing.push(h);
      await Promise.all(missing.map((h) => this.#ingest(h)));
      floor = bottom;
      for (let h = top; h >= bottom; h -= 1) {
        if ((this.#byHeight.get(h)?.timestamp ?? Infinity) < edge) covered = true;
      }
      if (bottom === 0) covered = true;
    }
    this.#coversDay = covered;
    // Below the batch that proved coverage only: that batch's own older block is what lets the
    // next refresh prove it again without fetching, and `current()` excludes it by timestamp.
    for (const h of this.#byHeight.keys()) if (h < floor) this.#byHeight.delete(h);
  }

  start(): () => void {
    void (async () => {
      try {
        const started = Date.now();
        await this.#refresh();
        this.#warm = true;
        this.log(
          `[stats24h] warm: ${this.#byHeight.size} blocks in ${Math.round((Date.now() - started) / 1000)}s`,
        );
      } catch (error) {
        this.log(
          `[stats24h] warm-up failed, retrying on the timer: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.#timer = setInterval(() => {
        void this.#refresh()
          .then(() => {
            this.#warm = true;
          })
          .catch((error: unknown) => {
            // Stale-but-warm keeps serving; blocks already held are immutable, so the worst
            // case is a window that trails the tip until the node is reachable again.
            this.log(
              `[stats24h] refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
      }, REFRESH_INTERVAL_MS);
      this.#timer.unref();
    })();
    return () => clearTimeout(this.#timer);
  }
}

// ------------------------------------------------------------------------ mempool

export interface MempoolStatsResult {
  pendingCount: number;
  totalSizeBytes: number;
  medianFeeZat: number | null;
  medianFeeRateZatPerByte: number | null;
}

/** Median of an unsorted list, or null for an empty one — never 0 standing in for unknown. */
export function medianZat(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Entries of `getrawmempool true`. `fee` is decimal ZEC (zcashd convention), converted to zatoshi
 * immediately and never summed as a float.
 */
export interface RpcMempoolEntry {
  size?: number;
  fee?: number;
  /** Unix seconds the node first saw the transaction. */
  time?: number;
  /** Txids of other PENDING transactions this one spends from. */
  depends?: string[];
}

/** A verbose entry's fee in zatoshis, or null when the node omitted it. */
export function entryFeeZat(entry: RpcMempoolEntry): number | null {
  if (typeof entry.fee !== "number" || !Number.isFinite(entry.fee)) return null;
  return Math.round(entry.fee * 1e8);
}

/**
 * Fee rate in zat/byte, which is what orders inclusion. Null when either side of the division is
 * missing; a rate of 0 would be a claim, not a gap.
 */
export function entryFeeRateZatPerByte(entry: RpcMempoolEntry): number | null {
  const feeZat = entryFeeZat(entry);
  if (feeZat === null || typeof entry.size !== "number" || entry.size <= 0) return null;
  return feeZat / entry.size;
}

export function summariseMempool(entries: Record<string, RpcMempoolEntry>): MempoolStatsResult {
  const list = Object.values(entries);
  const fees = list.map(entryFeeZat).filter((fee): fee is number => fee !== null);
  const rates = list
    .map(entryFeeRateZatPerByte)
    .filter((rate): rate is number => rate !== null)
    // medianZat rounds when averaging a middle pair, which would flatten sub-1 zat/B
    // rates; a tenth of a zat/byte is precision enough for ordering.
    .map((rate) => Math.round(rate * 10));
  const medianTenths = medianZat(rates);
  return {
    pendingCount: list.length,
    totalSizeBytes: list.reduce((sum, e) => sum + (e.size ?? 0), 0),
    medianFeeZat: medianZat(fees),
    medianFeeRateZatPerByte: medianTenths === null ? null : medianTenths / 10,
  };
}

/**
 * Privacy composition of a set of classified kinds — the pure half of sampling, so the
 * arithmetic is testable without a node. `sampled` is the count actually classified; the
 * caller reports it beside the counts rather than scaling them up to the mempool total.
 */
export function countKinds(kinds: readonly TxKind[]): MempoolComposition {
  const composition: MempoolComposition = {
    sampled: kinds.length,
    transparent: 0,
    mixed: 0,
    shielded: 0,
    coinbase: 0,
  };
  for (const kind of kinds) composition[kind] += 1;
  return composition;
}
