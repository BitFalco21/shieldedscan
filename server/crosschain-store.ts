import { classifyZcashAddress } from "@/domain";
import { SETTLEMENT_ASSETS } from "@/domain/crosschain";
import type {
  ChainInflowPoint,
  ChainOutflowPoint,
  InflowKindMonthPoint,
  VenueMonthPoint,
  CrossChainAggregate,
  CrossChainDirection,
  CrossChainFlowSummary,
  CrossChainGroupBy,
  CrossChainNarrowing,
  CrossChainProtocol,
  CrossChainTopBasis,
  CrossChainTopOrder,
  CrossChainTransfer,
  ZcashTxCrossings,
  CrossChainVolumePoint,
  CrossChainVolumeSeries,
} from "@/domain";
import type { CursorPage, CursorQuery } from "@/data/source";
import { CrossChainStore, type ListOptions, type VenueHealth } from "@/data/crosschain/store";

/**
 * What the API and the poller need from storage.
 *
 * Async because Postgres is; the in-memory adapter resolves immediately, so swapping the backing
 * store is additive.
 *
 * Deliberately narrow: every method is a read the API serves or a write the poller makes, with no
 * query builder or escape hatch. A new access pattern should be a named method so both adapters
 * have to implement it.
 */
export type { AddressKindBucket, CrossChainEdgeRow } from "@/data/crosschain/store";
import type { AddressKindBucket, CrossChainEdgeRow } from "@/data/crosschain/store";

export interface CrossChainVolumeSide {
  transfers: number;
  zecAmountZat: number;
  /** Sum of swap-time USD over the rows that carry one — a floor, with coverage beside it. */
  usdAtSwap: number;
  usdCoveredTransfers: number;
}

export interface CrossChainVolume {
  in: CrossChainVolumeSide;
  out: CrossChainVolumeSide;
}

export interface CrossChainStorePort {
  upsert(transfers: readonly CrossChainTransfer[]): Promise<number>;
  list(query: CursorQuery, options?: ListOptions): Promise<CursorPage<CrossChainTransfer>>;
  get(id: string): Promise<CrossChainTransfer | undefined>;
  /**
   * Crossings whose Zcash leg is `txid` (lowercase hex), newest first, at most `limit`, with
   * the exact `total` they were cut from; settlement legs excluded. Empty is an answer: most
   * transactions crossed nothing.
   */
  byZcashTxid(txid: string, limit: number): Promise<ZcashTxCrossings>;
  /** Flow per chain and direction, over a trailing `windowDays` or all-time when omitted. */
  flows(windowDays?: number | null): Promise<CrossChainFlowSummary>;
  /**
   * A narrowed slice (chain, venue, direction, value floor and an absolute window), totalled and
   * grouped along one axis.
   *
   * Distinct from `flows()`, which takes a trailing window anchored on now and always groups by
   * chain: that suits a page with `30D` chips, while this answers questions with fixed edges ("how
   * much came from Bitcoin in July").
   */
  aggregate(filters: CrossChainNarrowing, groupBy: CrossChainGroupBy): Promise<CrossChainAggregate>;
  /**
   * One end of a ranking in a slice. `by: "usd"` ranks only rows that carry a price, whichever end
   * is asked for: an unpriced transfer is unknown, not cheap.
   */
  top(
    filters: CrossChainNarrowing,
    by: CrossChainTopBasis,
    limit: number,
    order?: CrossChainTopOrder,
  ): Promise<CrossChainTransfer[]>;
  /** The shielded-capable-destination statistic. */
  countByAddressKind(direction: CrossChainDirection): Promise<AddressKindBucket[]>;
  /**
   * Gross ZEC crossing per (counterpart chain, direction, Zcash address kind): one ribbon each on
   * `/pulse`.
   *
   * Completed only, unlike `aggregate()` and `flows()`: a ribbon states value that crossed, and a
   * `pending` crossing has not happened while a `refunded` one was undone.
   *
   * Split by address kind because the kinds land in different places: only a transparent delivery
   * demonstrably reached the transparent box. `pulseZcashEnd` is the one rule turning a kind into
   * an end, shared with the per-transfer pulses.
   *
   * `fromTimestamp` is an inclusive lower bound in unix seconds, or null for all of history.
   * Settlement legs (CACAO, RUNE) are excluded by asset, never by chain: a chain filter would drop
   * every wrapped-ZEC crossing.
   */
  crossChainEdges(fromTimestamp: number | null): Promise<CrossChainEdgeRow[]>;
  count(): Promise<number>;
  /** Exact count for the totals line, filter-aware. */
  countFiltered(options?: ListOptions): Promise<number>;
  /**
   * Volume per direction: exact ZEC, and swap-time USD as a floor with its coverage
   * (`usd_value_at_swap` is the venue's own price and is null on older rows). Today's price times
   * historical ZEC is never the answer here.
   */
  volume(): Promise<CrossChainVolume>;
  /** ZEC crossing per month and per day, both grains — see `volumeSeries` in the store. */
  volumeSeries(): Promise<CrossChainVolumeSeries>;
  /**
   * ZEC arriving per source chain per month, settlement-asset legs excluded as in `volumeSeries`.
   * One row per (month, chain) that saw an inbound transfer, oldest first.
   */
  inflowByChain(): Promise<ChainInflowPoint[]>;
  /** ZEC leaving per destination chain per month, on `inflowByChain`'s rules. */
  outflowByChain(): Promise<ChainOutflowPoint[]>;
  /** ZEC per swap venue per month, both directions as separate sums, settlement legs excluded. */
  volumeByVenue(): Promise<VenueMonthPoint[]>;
  /** Inbound ZEC and transfers per Zcash address kind per month, settlement legs excluded. */
  inflowByAddressKind(): Promise<InflowKindMonthPoint[]>;
  markSuccess(protocol: CrossChainProtocol, atSeconds: number): Promise<void>;
  markFailure(protocol: CrossChainProtocol, error: string): Promise<void>;
  health(protocols: readonly CrossChainProtocol[], nowSeconds: number): Promise<VenueHealth[]>;
  /** Resumable ingest bookkeeping — backfill offsets and cursors. */
  readIngestState<T>(key: string): Promise<T | null>;
  writeIngestState(key: string, state: unknown): Promise<void>;
  close(): Promise<void>;
}

/** The first instant of the UTC month holding `seconds`. */
const monthOf = (seconds: number): number => {
  const d = new Date(seconds * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth()) / 1000;
};

/**
 * The memory-backed adapter, for local development and running without a database.
 *
 * Wraps the pure keyset store rather than reimplementing it, so the pagination under test is the
 * pagination served. Ingest state is process-local: without persistence a restart has no resume
 * point.
 */
export class MemoryStorePort implements CrossChainStorePort {
  readonly #store = new CrossChainStore();
  readonly #ingest = new Map<string, unknown>();

  async upsert(transfers: readonly CrossChainTransfer[]): Promise<number> {
    return this.#store.upsert(transfers);
  }
  async list(
    query: CursorQuery,
    options: ListOptions = {},
  ): Promise<CursorPage<CrossChainTransfer>> {
    return this.#store.list(query, options);
  }
  async get(id: string): Promise<CrossChainTransfer | undefined> {
    return this.#store.get(id);
  }
  async byZcashTxid(txid: string, limit: number): Promise<ZcashTxCrossings> {
    return this.#store.byZcashTxid(txid, limit);
  }
  // The window is forwarded, not dropped. A parameterless override would typecheck (a method may
  // take fewer arguments than its port declares) and silently answer all-time for every window.
  async flows(windowDays: number | null = null): Promise<CrossChainFlowSummary> {
    return this.#store.flows(windowDays);
  }
  async aggregate(
    filters: CrossChainNarrowing,
    groupBy: CrossChainGroupBy,
  ): Promise<CrossChainAggregate> {
    return this.#store.aggregate(filters, groupBy);
  }
  async top(
    filters: CrossChainNarrowing,
    by: CrossChainTopBasis,
    limit: number,
    order: CrossChainTopOrder = "largest",
  ): Promise<CrossChainTransfer[]> {
    return this.#store.top(filters, by, limit, order);
  }
  async countByAddressKind(direction: CrossChainDirection): Promise<AddressKindBucket[]> {
    return this.#store.countByAddressKind(direction);
  }
  async crossChainEdges(fromTimestamp: number | null): Promise<CrossChainEdgeRow[]> {
    return this.#store.crossChainEdges(fromTimestamp);
  }
  async count(): Promise<number> {
    return this.#store.size;
  }

  async countFiltered(options: ListOptions = {}): Promise<number> {
    // Reuses the SAME keyset store filter as list(), so the two can never disagree about
    // what matches — count with one big page and read the length.
    const page = this.#store.list({ limit: 1_000_000 }, options);
    return page.items.length;
  }

  async volume(): Promise<CrossChainVolume> {
    const empty = { transfers: 0, zecAmountZat: 0, usdAtSwap: 0, usdCoveredTransfers: 0 };
    const out = { in: { ...empty }, out: { ...empty } };
    for (const t of this.#store.list({ limit: 1_000_000 }).items) {
      const side = out[t.direction];
      side.transfers += 1;
      side.zecAmountZat += t.zecAmountZat;
      if (typeof t.usdValueAtSwap === "number") {
        side.usdAtSwap += t.usdValueAtSwap;
        side.usdCoveredTransfers += 1;
      }
    }
    return out;
  }
  /** Same rows as the Postgres store's, computed in memory for tests and fixture mode. */
  async inflowByChain(): Promise<ChainInflowPoint[]> {
    const by = new Map<string, ChainInflowPoint>();
    for (const t of this.#swaps("in")) {
      const timestamp = monthOf(t.timestamp);
      const key = `${timestamp}:${t.counterpartChain}`;
      const point = by.get(key) ?? { timestamp, chain: t.counterpartChain, inZat: 0 };
      point.inZat += t.zecAmountZat;
      by.set(key, point);
    }
    return [...by.values()].sort(
      (a, b) => a.timestamp - b.timestamp || a.chain.localeCompare(b.chain),
    );
  }

  /** Same rows as the Postgres store's, computed in memory for tests and fixture mode. */
  async outflowByChain(): Promise<ChainOutflowPoint[]> {
    const by = new Map<string, ChainOutflowPoint>();
    for (const t of this.#swaps("out")) {
      const timestamp = monthOf(t.timestamp);
      const key = `${timestamp}:${t.counterpartChain}`;
      const point = by.get(key) ?? { timestamp, chain: t.counterpartChain, outZat: 0 };
      point.outZat += t.zecAmountZat;
      by.set(key, point);
    }
    return [...by.values()].sort(
      (a, b) => a.timestamp - b.timestamp || a.chain.localeCompare(b.chain),
    );
  }

  /** Same rows as the Postgres store's, computed in memory for tests and fixture mode. */
  async volumeByVenue(): Promise<VenueMonthPoint[]> {
    const by = new Map<string, VenueMonthPoint>();
    for (const t of this.#swaps(null)) {
      const timestamp = monthOf(t.timestamp);
      const key = `${timestamp}:${t.protocol}`;
      const point = by.get(key) ?? { timestamp, protocol: t.protocol, inZat: 0, outZat: 0 };
      if (t.direction === "in") point.inZat += t.zecAmountZat;
      else point.outZat += t.zecAmountZat;
      by.set(key, point);
    }
    return [...by.values()].sort(
      (a, b) => a.timestamp - b.timestamp || a.protocol.localeCompare(b.protocol),
    );
  }

  /** Same rows as the Postgres store's, computed in memory for tests and fixture mode. */
  async inflowByAddressKind(): Promise<InflowKindMonthPoint[]> {
    const by = new Map<string, InflowKindMonthPoint>();
    for (const t of this.#swaps("in")) {
      const timestamp = monthOf(t.timestamp);
      const kind = classifyZcashAddress(t.zcashAddress);
      const key = `${timestamp}:${kind}`;
      const point = by.get(key) ?? { timestamp, kind, transfers: 0, zat: 0 };
      point.transfers += 1;
      point.zat += t.zecAmountZat;
      by.set(key, point);
    }
    return [...by.values()].sort(
      (a, b) => a.timestamp - b.timestamp || String(a.kind).localeCompare(String(b.kind)),
    );
  }

  /** Every transfer in one direction (or both), settlement legs excluded. */
  #swaps(direction: "in" | "out" | null): CrossChainTransfer[] {
    return this.#store
      .list({ limit: 1_000_000 })
      .items.filter(
        (t) =>
          (direction === null || t.direction === direction) &&
          !SETTLEMENT_ASSETS.includes(t.counterpartAsset),
      );
  }

  /** Same buckets as the Postgres store, computed in memory for tests and fixture mode. */
  async volumeSeries(): Promise<CrossChainVolumeSeries> {
    const bucket = (seconds: number, unit: "month" | "day") => {
      const d = new Date(seconds * 1000);
      return unit === "month"
        ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth()) / 1000
        : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
    };
    const roll = (unit: "month" | "day"): CrossChainVolumePoint[] => {
      const by = new Map<number, CrossChainVolumePoint>();
      for (const t of this.#store.list({ limit: 1_000_000 }).items) {
        const ts = bucket(t.timestamp, unit);
        const point = by.get(ts) ?? {
          timestamp: ts,
          inZat: 0,
          outZat: 0,
          transfers: 0,
          inTransfers: 0,
          outTransfers: 0,
          inUsdAtSwap: 0,
          outUsdAtSwap: 0,
          inUsdCoveredTransfers: 0,
          outUsdCoveredTransfers: 0,
        };
        if (t.direction === "in") {
          point.inZat += t.zecAmountZat;
          point.inTransfers += 1;
        } else {
          point.outZat += t.zecAmountZat;
          point.outTransfers += 1;
        }
        point.transfers += 1;
        // Mirrors `volume()` and the SQL `sum()`/`count()` pair: a null price adds no dollars and
        // no count, so the total stays a floor with its own denominator. Split by direction like
        // the ZEC totals, so the reader never has to reconcile one combined dollar figure against
        // two ZEC ones.
        if (typeof t.usdValueAtSwap === "number" && Number.isFinite(t.usdValueAtSwap)) {
          if (t.direction === "in") {
            point.inUsdAtSwap += t.usdValueAtSwap;
            point.inUsdCoveredTransfers += 1;
          } else {
            point.outUsdAtSwap += t.usdValueAtSwap;
            point.outUsdCoveredTransfers += 1;
          }
        }
        by.set(ts, point);
      }
      return [...by.values()].sort((a, b) => a.timestamp - b.timestamp);
    };
    return { monthly: roll("month"), daily: roll("day") };
  }
  async markSuccess(protocol: CrossChainProtocol, atSeconds: number): Promise<void> {
    this.#store.markSuccess(protocol, atSeconds);
  }
  async markFailure(protocol: CrossChainProtocol, error: string): Promise<void> {
    this.#store.markFailure(protocol, error);
  }
  async health(
    protocols: readonly CrossChainProtocol[],
    nowSeconds: number,
  ): Promise<VenueHealth[]> {
    return this.#store.health(protocols, nowSeconds);
  }
  async readIngestState<T>(key: string): Promise<T | null> {
    return (this.#ingest.get(key) as T) ?? null;
  }
  async writeIngestState(key: string, state: unknown): Promise<void> {
    this.#ingest.set(key, state);
  }
  async close(): Promise<void> {}
}
