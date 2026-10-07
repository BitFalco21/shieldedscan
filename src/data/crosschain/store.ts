import type {
  CrossChainAggregate,
  CrossChainFlowSummary,
  CrossChainGroupBy,
  CrossChainTopBasis,
  CrossChainTopOrder,
  CrossChainDirection,
  CrossChainNarrowing,
  CrossChainProtocol,
  CrossChainTransfer,
  ZcashTxCrossings,
} from "@/domain";
import {
  aggregateCrossChain,
  aggregateFlowWindows,
  classifyZcashAddress,
  matchesCrossChainFilters,
} from "@/domain";
import { type CursorPage, type CursorQuery } from "../source";
import { cursorSlice } from "../cursor";
import { isSettlementLeg } from "./venues";

/** One `crossChainEdges` row. Declared beside the computation; the server port re-exports it. */
export interface CrossChainEdgeRow {
  chain: string;
  direction: CrossChainDirection;
  addressKind: ReturnType<typeof classifyZcashAddress>;
  transfers: number;
  zecAmountZat: number;
}

/**
 * One landing bucket for `countByAddressKind`; the server port re-exports the same shape.
 * `kind: null` means the venue published no Zcash-side address — a real bucket, not a
 * dropped row.
 */
export interface AddressKindBucket {
  kind: ReturnType<typeof classifyZcashAddress>;
  transfers: number;
  zecAmountZat: number;
}

/** How many transfers to retain. ~500 B each, so 5,000 is a couple of megabytes. */
const DEFAULT_CAPACITY = 5_000;

/** A venue is considered live if it succeeded within this window. */
export const VENUE_STALE_AFTER_SECONDS = 10 * 60;

export interface VenueHealth {
  protocol: CrossChainProtocol;
  /** Unix seconds of the last successful poll, or null if it has never succeeded. */
  lastSuccessAt: number | null;
  /** Message from the most recent failure. Cleared on the next success. */
  lastError: string | null;
  live: boolean;
}

interface VenueState {
  lastSuccessAt: number | null;
  lastError: string | null;
}

/**
 * Every narrowing the store understands. The venue/direction/chain half is
 * `CrossChainNarrowing`, shared with the data port. All of it is applied in the store, so a
 * filter narrows the list rather than the page: filtering after the cursor slice would
 * return fewer than `limit` rows and a cursor that steps over the ones it dropped.
 */
export interface ListOptions extends CrossChainNarrowing {
  /**
   * Include swaps whose counterparty is the venue's own settlement asset (CACAO, RUNE).
   * Wrapped ZEC is not excluded by this — it is a real boundary crossing. Off by default:
   * settlement legs are venue-internal and would inflate volume with a chain nobody bridged
   * to. The rows are still stored, so this is a read-time decision.
   */
  includeProtocolLegs?: boolean;
}

/**
 * The transfers a poller has seen, held in memory.
 *
 * Deliberately the same shape as the Postgres-backed store: upsert by id, keyset pagination
 * over the composite `(timestamp, id)` tuple, lookup by id. The in-memory comparison mirrors
 * the SQL row-value comparison, so the two are interchangeable above `data/`.
 */
export class CrossChainStore {
  readonly #byId = new Map<string, CrossChainTransfer>();
  readonly #venues = new Map<CrossChainProtocol, VenueState>();
  readonly #capacity: number;
  /** Sorted newest-first; rebuilt on write, since reads vastly outnumber writes. */
  #sorted: CrossChainTransfer[] = [];

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#byId.size;
  }

  /**
   * Inserts or replaces by id, then re-sorts and trims to capacity. Replacing matters: a
   * venue re-publishes a swap as it settles, so the newest copy is the accurate one. Returns
   * how many rows were new.
   */
  upsert(transfers: readonly CrossChainTransfer[]): number {
    let added = 0;
    for (const t of transfers) {
      if (!this.#byId.has(t.id)) added += 1;
      this.#byId.set(t.id, t);
    }
    if (transfers.length > 0) this.#reindex();
    return added;
  }

  #reindex(): void {
    const all = [...this.#byId.values()].sort(compareNewestFirst);
    if (all.length > this.#capacity) {
      for (const evicted of all.slice(this.#capacity)) this.#byId.delete(evicted.id);
      all.length = this.#capacity;
    }
    this.#sorted = all;
  }

  list(query: CursorQuery, options: ListOptions = {}): CursorPage<CrossChainTransfer> {
    const items = this.#sorted.filter(
      (t) =>
        (options.includeProtocolLegs || !isSettlementLeg(t)) &&
        matchesCrossChainFilters(t, options),
    );
    return cursorSlice(items, (t) => ({ sortKey: t.timestamp, id: t.id }), query);
  }

  /**
   * Where transfers land, by Zcash address family — classified with the same
   * `classifyZcashAddress` the Postgres adapter applies at ingest, so the two stores agree.
   * Settlement legs are excluded by asset.
   */
  countByAddressKind(direction: CrossChainDirection): AddressKindBucket[] {
    const buckets = new Map<string, AddressKindBucket>();
    for (const t of this.#sorted) {
      if (t.direction !== direction || isSettlementLeg(t)) continue;
      const kind = classifyZcashAddress(t.zcashAddress);
      const key = kind ?? "none";
      const bucket = buckets.get(key) ?? { kind, transfers: 0, zecAmountZat: 0 };
      bucket.transfers += 1;
      bucket.zecAmountZat += t.zecAmountZat;
      buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((a, b) => b.zecAmountZat - a.zecAmountZat);
  }

  /**
   * Gross ZEC per (counterpart chain, direction, Zcash address kind), completed only. The
   * in-memory twin of the Postgres query (see `CrossChainStorePort.crossChainEdges`),
   * classified with the same `classifyZcashAddress`; settlement legs excluded by asset.
   */
  crossChainEdges(fromTimestamp: number | null): CrossChainEdgeRow[] {
    const rows = new Map<string, CrossChainEdgeRow>();
    for (const t of this.#sorted) {
      if (t.status !== "completed" || isSettlementLeg(t)) continue;
      if (fromTimestamp !== null && t.timestamp < fromTimestamp) continue;
      const addressKind = classifyZcashAddress(t.zcashAddress);
      const key = `${t.counterpartChain}|${t.direction}|${addressKind ?? "none"}`;
      const row = rows.get(key) ?? {
        chain: t.counterpartChain,
        direction: t.direction,
        addressKind,
        transfers: 0,
        zecAmountZat: 0,
      };
      row.transfers += 1;
      row.zecAmountZat += t.zecAmountZat;
      rows.set(key, row);
    }
    return [...rows.values()];
  }

  /**
   * Flow per chain and direction, over a trailing window of `windowDays` or all-time.
   *
   * Settlement legs are excluded by asset, never by chain: wrapped ZEC also lives on MAYA, and
   * a chain filter would drop those crossings. Wrapped ZEC is a crossing and is counted. The
   * cutoff uses the wall clock, matching the Postgres store's `now()`.
   */
  flows(windowDays: number | null = null): CrossChainFlowSummary {
    return aggregateFlowWindows(
      this.#sorted.filter((t) => !isSettlementLeg(t)),
      windowDays,
      Math.floor(Date.now() / 1000),
    );
  }

  /**
   * A narrowed slice, totalled and grouped along one axis, through the same
   * `aggregateCrossChain` the fixtures use. Postgres mirrors it in SQL, held to the same
   * answers by a parity test. Settlement legs are excluded by asset, never by chain.
   */
  aggregate(filters: CrossChainNarrowing, groupBy: CrossChainGroupBy): CrossChainAggregate {
    return aggregateCrossChain(
      this.#sorted.filter((t) => !isSettlementLeg(t)),
      filters,
      groupBy,
    );
  }

  /**
   * The largest transfers in a slice, by ZEC or by the venues' swap-time dollars.
   *
   * Ranking by `usd` narrows the population to rows whose venue published a price: treating
   * an unknown value as zero would rank it last as though it were small. Callers must say
   * which basis they used.
   */
  top(
    filters: CrossChainNarrowing,
    by: CrossChainTopBasis,
    limit: number,
    order: CrossChainTopOrder = "largest",
  ): CrossChainTransfer[] {
    const sign = order === "largest" ? 1 : -1;
    return this.#sorted
      .filter(
        (t) =>
          !isSettlementLeg(t) &&
          matchesCrossChainFilters(t, filters) &&
          (by === "zec" || typeof t.usdValueAtSwap === "number"),
      )
      .sort(
        (a, b) =>
          sign *
          (by === "zec"
            ? b.zecAmountZat - a.zecAmountZat
            : (b.usdValueAtSwap ?? 0) - (a.usdValueAtSwap ?? 0)),
      )
      .slice(0, Math.max(0, limit));
  }

  /**
   * Lookup is unfiltered: a link to a ZEC↔CACAO swap resolves even though that row is
   * excluded from volume figures.
   */
  get(id: string): CrossChainTransfer | undefined {
    return this.#byId.get(id);
  }

  /**
   * The crossings whose Zcash leg is `txid`, newest first. Unlike `get`, settlement legs are
   * excluded: this answers "was this transaction part of a swap?", and a venue's internal
   * settlement is not a crossing.
   */
  byZcashTxid(txid: string, limit: number): ZcashTxCrossings {
    const key = txid.toLowerCase();
    const all = this.#sorted.filter((t) => t.zcashTxid === key && !isSettlementLeg(t));
    return { transfers: all.slice(0, limit), total: all.length };
  }

  markSuccess(protocol: CrossChainProtocol, atSeconds: number): void {
    this.#venues.set(protocol, { lastSuccessAt: atSeconds, lastError: null });
  }

  markFailure(protocol: CrossChainProtocol, error: string): void {
    const previous = this.#venues.get(protocol);
    this.#venues.set(protocol, {
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      lastError: error,
    });
  }

  /**
   * Health is derived from the last success timestamp rather than a flag the poller flips, so
   * a restarted process does not claim health it has not yet demonstrated.
   */
  health(protocols: readonly CrossChainProtocol[], nowSeconds: number): VenueHealth[] {
    return protocols.map((protocol) => {
      const state = this.#venues.get(protocol);
      const lastSuccessAt = state?.lastSuccessAt ?? null;
      return {
        protocol,
        lastSuccessAt,
        lastError: state?.lastError ?? null,
        live: lastSuccessAt !== null && nowSeconds - lastSuccessAt < VENUE_STALE_AFTER_SECONDS,
      };
    });
  }
}

/**
 * Newest first, id descending as the tiebreak — the ordering `cursorSlice` compares under,
 * and the one `ORDER BY timestamp DESC, id DESC` produces.
 */
function compareNewestFirst(a: CrossChainTransfer, b: CrossChainTransfer): number {
  return b.timestamp - a.timestamp || b.id.localeCompare(a.id);
}
