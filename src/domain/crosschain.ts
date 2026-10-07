import type { CrossChainDirectionFilter, CrossChainProtocolFilter } from "./list";
import { DAY_SECONDS } from "./time";

export type CrossChainDirection = "in" | "out";
export type CrossChainProtocol = "thorchain" | "maya" | "near-intents";
export type CrossChainStatus = "completed" | "pending" | "refunded";

/**
 * Zcash's own ticker as it appears at either end of a transfer. Zcash is one end of every
 * row by construction; which end depends on `direction`.
 *
 * The `import type` above is deliberate: `list.ts` imports `protocolLabel` from this module,
 * so a value import back would create a runtime cycle.
 */
export const ZCASH_CHAIN = "ZEC";

/**
 * Each venue's own settlement asset, by the chain it lives on. A transfer whose counterpart
 * asset is one of these is a venue settling internal accounts, not a crossing, and every read
 * path excludes it. Filter by asset, never by chain alone: wrapped ZEC also lives on Maya, and
 * a chain filter would drop every ZEC-to-wrapped-ZEC transfer.
 */
export const SETTLEMENT_ASSET_BY_CHAIN = { MAYA: "CACAO", THOR: "RUNE" } as const;

/** The settlement assets alone, for the Postgres store's and the swap poller's queries. */
export const SETTLEMENT_ASSETS: readonly string[] = Object.values(SETTLEMENT_ASSET_BY_CHAIN);

/**
 * A ZEC transfer across chains via a swap protocol. The Zcash leg is
 * transparent at the boundary; what happens before/after on the Zcash
 * side may be shielded — the type only carries public facts.
 */
export interface CrossChainTransfer {
  id: string;
  direction: CrossChainDirection;
  protocol: CrossChainProtocol;
  /** Counterpart chain ticker, e.g. "BTC", "ETH", "NEAR". */
  counterpartChain: string;
  counterpartAsset: string;
  /** Asset units (decimal); null while unknown (unsettled leg). */
  counterpartAmount: number | null;
  /**
   * The counterparty is a wrapped claim rather than the asset itself, e.g. Maya's synthetic
   * `ZEC/ZEC`. Still a boundary crossing, so it is tracked, but it must be labelled: "1 ZEC"
   * and "1 wrapped ZEC" are not the same claim.
   */
  counterpartIsSynthetic: boolean;
  counterpartTxHash: string | null;
  /**
   * The counterparty's address on the other chain (`0x…`, `bc1…`, `r…`, …), never a Zcash
   * address. Null when the venue publishes none. Not named "from"/"to" because which end it
   * sits at depends on `direction`.
   */
  counterpartAddress: string | null;
  /** Zcash-leg txid; null while the Zcash leg hasn't settled. */
  zcashTxid: string | null;
  /**
   * The Zcash-side address at the boundary. Not necessarily transparent: a swap can deliver
   * to a unified (`u1…`) address. Use `classifyZcashAddress` rather than assuming a family.
   * Null (never `""`) when the venue publishes none.
   */
  zcashAddress: string | null;
  zecAmountZat: number;
  /**
   * The venue's own published USD value of the ZEC leg at swap time. Null when the venue
   * published no price; never substitute a spot price.
   */
  usdValueAtSwap: number | null;
  /**
   * The venue's published USD value of the counterpart leg at swap time (NEAR Intents
   * publishes both legs' USD; Midgard publishes both legs' unit prices). Null when the venue
   * published none or for rows ingested before the column existed. The two legs usually
   * differ by the venue's fee and slippage; never average or reconcile them, and never
   * substitute a spot price.
   */
  counterpartUsdAtSwap: number | null;
  /**
   * The venue's own deposit address for this swap: the key its explorer indexes transfers by
   * (`/transactions/<deposit address>` on NEAR Intents, not a transaction hash).
   *
   * Distinct from `counterpartAddress`, which is the user's address. This is the protocol's
   * ephemeral receiving address; it says nothing about who swapped, so it is never shown as
   * a boundary address and exists only to build a link to the venue's record. Null when the
   * venue publishes none or for rows ingested before the column existed.
   */
  venueDepositAddress: string | null;
  status: CrossChainStatus;
  /** Unix seconds, matching every other timestamp in the domain. */
  timestamp: number;
}

/**
 * The crossings one Zcash transaction is a leg of: a bounded list and the exact total.
 * Venues batch, so one transaction can settle many crossings; a capped list is only honest
 * beside the count it was cut from.
 */
export interface ZcashTxCrossings {
  transfers: CrossChainTransfer[];
  total: number;
}

export function protocolLabel(p: CrossChainProtocol): string {
  switch (p) {
    case "thorchain":
      return "THORChain";
    case "maya":
      return "Maya Protocol";
    case "near-intents":
      return "NEAR Intents";
  }
}

export function statusLabel(s: CrossChainStatus): string {
  switch (s) {
    case "completed":
      return "COMPLETED";
    case "pending":
      return "PENDING";
    case "refunded":
      return "REFUNDED";
  }
}

export function statusGlyph(s: CrossChainStatus): string {
  switch (s) {
    case "completed":
      return "✓";
    case "pending":
      return "◌";
    case "refunded":
      return "↩";
  }
}

/**
 * Whether `counterpartAsset` is a real ticker or the parser's placeholder for one.
 *
 * NEAR Intents identifies many tokens only by contract address, so `near-intents.ts` emits
 * `"<CHAIN> asset"` rather than guessing a ticker. A space is the test: no exchange ticker
 * contains one and the placeholder always does, which also recognises already-stored rows.
 *
 * Callers should show the chain's mark and say the ticker is unknown. Never substitute the
 * chain's native ticker: an SPL token on Solana is not SOL.
 */
export function assetTickerIsKnown(asset: string): boolean {
  return !asset.includes(" ");
}

/** Which end of a transfer a question is about. */
export type CrossChainSide = "source" | "destination";

/**
 * The chain at one end of a transfer. Direction is relative to Zcash: an inbound transfer's
 * source is the counterpart chain and its destination is Zcash.
 *
 * The single source of this mapping: the list's columns and the SOURCE/DESTINATION filters
 * both derive from it, so they cannot disagree about a row.
 */
export function transferChainSide(t: CrossChainTransfer, side: CrossChainSide): string {
  const counterpartIsSource = t.direction === "in";
  return (side === "source") === counterpartIsSource ? t.counterpartChain : ZCASH_CHAIN;
}

/** Whether a transfer's `side` end is one of `chains`; an empty selection means "all". */
export function matchesChainFilter(
  t: CrossChainTransfer,
  side: CrossChainSide,
  chains: readonly string[],
): boolean {
  return chains.length === 0 || chains.includes(transferChainSide(t, side));
}

/**
 * How a cross-chain list may be narrowed. Shared by the data port, the store and the HTTP
 * query. Every member is optional and absent means "all".
 */
export interface CrossChainNarrowing {
  /** One venue, or "all". */
  protocol?: CrossChainProtocolFilter;
  /** One side of the boundary, or "all". */
  direction?: CrossChainDirectionFilter;
  /**
   * Chains at the source end, matched against `transferChainSide`: `["ZEC"]` means "left
   * Zcash", `["BTC"]` means "arrived from Bitcoin". Empty means every chain.
   *
   * The two sides AND together and with `protocol` and `direction`. Zcash is at exactly one
   * end of every transfer, so a foreign chain on both sides is a legitimately empty result.
   */
  sourceChains?: readonly string[];
  /** Chains at the destination end. See `sourceChains`. */
  destinationChains?: readonly string[];
  /**
   * The counterpart chain at whichever end it sits ("to or from Bitcoin"). Needed because
   * `sourceChains: ["BTC"]` with `destinationChains: ["BTC"]` is the empty set, not "BTC at
   * either end".
   */
  counterpartChains?: readonly string[];
  /**
   * Only transfers worth at least this many USD at swap time (the venue's own price, never
   * today's price on a historical amount). A row with no published price is excluded, not
   * assumed to clear the threshold.
   */
  minUsdAtSwap?: number;
  /**
   * Only transfers moving at least this many zatoshi. Every row carries its exact amount, so
   * unlike the USD floor nothing is excluded for want of a price.
   */
  minZecZat?: number;
  /**
   * An absolute window in unix seconds, `fromTimestamp` inclusive and `toTimestamp`
   * exclusive, for questions naming a period. Distinct from the flows tab's trailing
   * `windowDays`. Half-open so adjacent calendar months never share an instant.
   */
  fromTimestamp?: number;
  toTimestamp?: number;
  /**
   * Only transfers the venue reports as `completed`: a `pending` transfer has not happened
   * and a `refunded` one was undone. Absent means every status.
   */
  completedOnly?: boolean;
}

/**
 * Whether one transfer survives every part of a narrowing. Shared by the fixtures and the
 * in-memory store; `server/postgres-crosschain-store.ts` mirrors it in SQL and tests hold the two to the
 * same answers.
 */
export function matchesCrossChainFilters(
  t: CrossChainTransfer,
  filters: CrossChainNarrowing,
): boolean {
  const protocol = filters.protocol ?? "all";
  const direction = filters.direction ?? "all";
  const min = filters.minUsdAtSwap;
  const minZec = filters.minZecZat;
  const { fromTimestamp, toTimestamp } = filters;
  return (
    (protocol === "all" || t.protocol === protocol) &&
    (direction === "all" || t.direction === direction) &&
    matchesChainFilter(t, "source", filters.sourceChains ?? []) &&
    matchesChainFilter(t, "destination", filters.destinationChains ?? []) &&
    // Direction-blind, so one ticker means "to or from that chain" rather than the empty set
    // the two directional filters would AND to.
    ((filters.counterpartChains ?? []).length === 0 ||
      filters.counterpartChains!.includes(t.counterpartChain)) &&
    // An unknown price never clears a threshold; written out rather than relying on null
    // coercing to 0.
    (min === undefined || (t.usdValueAtSwap !== null && t.usdValueAtSwap >= min)) &&
    (minZec === undefined || t.zecAmountZat >= minZec) &&
    (fromTimestamp === undefined || t.timestamp >= fromTimestamp) &&
    (toTimestamp === undefined || t.timestamp < toTimestamp) &&
    (filters.completedOnly !== true || t.status === "completed")
  );
}

/** One chain's aggregate flow across the Zcash boundary, in one direction. */
export interface CrossChainFlow {
  /** Counterpart chain ticker; Zcash is the implicit other end. */
  chain: string;
  direction: CrossChainDirection;
  transfers: number;
  zecAmountZat: number;
  /**
   * The venues' own swap-time USD, summed; never today's price on a historical amount.
   *
   * A transfer with no published price contributes its ZEC and no dollars, so where
   * `usdCoveredTransfers` is below `transfers` this is a lower bound. Render it with `≥`.
   */
  usdAtSwap: number;
  /** Transfers of the `transfers` above whose venue published a swap-time USD price. */
  usdCoveredTransfers: number;
}

/**
 * Flow across the boundary, aggregated per chain and direction. Public swap venues only, so
 * the figures are a lower bound on ZEC's cross-chain movement; `firstAt`/`lastAt` bound what
 * was counted.
 */
export interface CrossChainFlowSummary {
  flows: CrossChainFlow[];
  firstAt: number;
  lastAt: number;
  /**
   * The trailing window applied, in days; `null` for all-time. An echo of what the API
   * applied: the adapter refuses a mismatch, because an older API that ignores `?days=`
   * would otherwise return an all-time aggregate under a windowed label.
   */
  windowDays: number | null;
  /**
   * The window of the same length immediately before this one, for a per-chain trend.
   *
   * - `none`: the view is all-time, so there is no previous window.
   * - `incomplete`: the previous window starts before our records do, so a comparison would
   *   be against a partly observed period and show spurious growth. `recordsBeginAt` lets
   *   the page name the date.
   * - `flows`: a fully covered previous window; `[]` means nothing crossed.
   */
  previous: CrossChainPreviousWindow;
}

export type CrossChainPreviousWindow =
  | { kind: "none" }
  | { kind: "incomplete"; recordsBeginAt: number }
  | { kind: "flows"; flows: CrossChainFlow[] };

/**
 * How a chain's volume moved against the previous window of the same length.
 *
 * `new` is not a percentage because a change from zero has no denominator. A fall to zero
 * needs no special case: −100% is exact.
 */
export type FlowTrend = { kind: "pct"; pct: number } | { kind: "new" } | { kind: "absent" };

/** The fields the flow aggregate reads; narrowed so callers can pass partial rows in tests. */
type FlowRow = Pick<
  CrossChainTransfer,
  "direction" | "counterpartChain" | "zecAmountZat" | "timestamp" | "usdValueAtSwap"
>;

/**
 * A flow row before anything is counted into it. Shared by the accumulator and the
 * zero-volume rows `flowRowsWithPrevious` adds, so a new field is initialised in one place.
 */
function emptyFlow(chain: string, direction: CrossChainDirection): CrossChainFlow {
  return {
    chain,
    direction,
    transfers: 0,
    zecAmountZat: 0,
    usdAtSwap: 0,
    usdCoveredTransfers: 0,
  };
}

/**
 * The whole flow summary (current window, previous window and coverage) from transfers
 * already in memory.
 *
 * The one implementation for the in-memory callers (the API's `CrossChainStore` and the
 * fixtures). Postgres has its own copy in SQL, pinned to this one by `server/__tests__`.
 *
 * Settlement legs are the caller's to exclude, by asset and never by chain (wrapped ZEC
 * also lives on Maya).
 */
export function aggregateFlowWindows(
  transfers: readonly FlowRow[],
  windowDays: number | null,
  now: number,
): CrossChainFlowSummary {
  const currentStart = windowDays === null ? null : now - windowDays * DAY_SECONDS;
  const previousStart = windowDays === null ? null : now - 2 * windowDays * DAY_SECONDS;

  const current = new Map<string, CrossChainFlow>();
  const previous = new Map<string, CrossChainFlow>();
  let firstAt = Number.POSITIVE_INFINITY;
  let lastAt = 0;
  let recordsBeginAt = Number.POSITIVE_INFINITY;

  for (const t of transfers) {
    if (t.timestamp > 0) recordsBeginAt = Math.min(recordsBeginAt, t.timestamp);
    const inCurrent = currentStart === null || t.timestamp >= currentStart;
    const inPrevious =
      previousStart !== null &&
      currentStart !== null &&
      t.timestamp >= previousStart &&
      t.timestamp < currentStart;
    if (!inCurrent && !inPrevious) continue;

    const into = inCurrent ? current : previous;
    const key = `${t.direction}:${t.counterpartChain}`;
    const row = into.get(key) ?? emptyFlow(t.counterpartChain, t.direction);
    row.transfers += 1;
    row.zecAmountZat += t.zecAmountZat;
    // A null price adds no dollars and no coverage; the ZEC still counts.
    if (typeof t.usdValueAtSwap === "number" && Number.isFinite(t.usdValueAtSwap)) {
      row.usdAtSwap += t.usdValueAtSwap;
      row.usdCoveredTransfers += 1;
    }
    into.set(key, row);

    if (inCurrent && t.timestamp > 0) {
      firstAt = Math.min(firstAt, t.timestamp);
      lastAt = Math.max(lastAt, t.timestamp);
    }
  }

  const summary: CrossChainFlowSummary = {
    flows: [...current.values()],
    firstAt: Number.isFinite(firstAt) ? firstAt : 0,
    lastAt,
    windowDays,
    previous: { kind: "none" },
  };
  if (previousStart === null) return summary;
  if (!Number.isFinite(recordsBeginAt) || recordsBeginAt > previousStart) {
    return {
      ...summary,
      previous: {
        kind: "incomplete",
        recordsBeginAt: Number.isFinite(recordsBeginAt) ? recordsBeginAt : 0,
      },
    };
  }
  return { ...summary, previous: { kind: "flows", flows: [...previous.values()] } };
}

export function flowTrend(currentZat: number, previousZat: number): FlowTrend {
  if (previousZat > 0)
    return { kind: "pct", pct: ((currentZat - previousZat) / previousZat) * 100 };
  return currentZat > 0 ? { kind: "new" } : { kind: "absent" };
}

/**
 * The chains a direction's table lists: those that moved ZEC in the window, plus those that
 * moved it in the previous window and have since gone quiet (shown as 0.00 ZEC, −100%), so a
 * chain that stopped bridging does not silently vanish.
 *
 * Not folded back into `CrossChainFlowSummary.flows`: the Sankey's folded tail counts chains,
 * and zero-volume entries would inflate it.
 */
export function flowRowsWithPrevious(
  flows: readonly CrossChainFlow[],
  previous: readonly CrossChainFlow[],
  direction: CrossChainDirection,
): { flow: CrossChainFlow; previousZat: number }[] {
  const previousByChain = new Map(
    previous.filter((f) => f.direction === direction).map((f) => [f.chain, f.zecAmountZat]),
  );
  const rows = flows
    .filter((f) => f.direction === direction)
    .map((flow) => ({ flow, previousZat: previousByChain.get(flow.chain) ?? 0 }));

  const present = new Set(rows.map((r) => r.flow.chain));
  for (const [chain, previousZat] of previousByChain) {
    if (present.has(chain) || previousZat <= 0) continue;
    rows.push({ flow: emptyFlow(chain, direction), previousZat });
  }
  return rows.sort((a, b) => b.flow.zecAmountZat - a.flow.zecAmountZat);
}

/** Total zatoshis crossing in one direction. */
export function flowTotalZat(flows: readonly CrossChainFlow[], direction: CrossChainDirection) {
  return flows.filter((f) => f.direction === direction).reduce((sum, f) => sum + f.zecAmountZat, 0);
}

/** What the SOURCE and DESTINATION menus may offer, given the direction in force. */
export interface ChainFilterOptions {
  source: string[];
  destination: string[];
}

/**
 * The chains that can appear in each column, largest first. Derived from the flow aggregate,
 * which applies the same settlement-leg exclusion as the transfer list, so a menu never
 * offers a chain with no rows.
 *
 * A side offers nothing (`[]`) when the direction pins it to Zcash or when no direction is
 * chosen, so at most one side ever offers a menu.
 */
export function chainFilterOptions(
  flows: readonly CrossChainFlow[],
  direction: CrossChainDirectionFilter,
): ChainFilterOptions {
  return {
    source: sideOptions(flows, "in", direction),
    destination: sideOptions(flows, "out", direction),
  };
}

/**
 * One side's menu: the counterpart chains that can sit there, largest first.
 *
 * `counterpartWhen` is the direction that puts the counterpart chain on this side. The
 * opposite direction puts Zcash here, and `[]` means no menu.
 *
 * ZEC is never listed. A transfer is fully described by (direction, counterpart chain), so
 * the direction chips choose the side and this menu chooses the chain; listing ZEC would
 * duplicate a direction and allow selections no row can satisfy.
 */
function sideOptions(
  flows: readonly CrossChainFlow[],
  counterpartWhen: CrossChainDirection,
  direction: CrossChainDirectionFilter,
): string[] {
  // A chain filter only means something once a direction says which end is being filtered.
  if (direction === "all") return [];
  const opposite = counterpartWhen === "in" ? "out" : "in";
  if (direction === opposite) return [];

  return flows
    .filter((f) => f.direction === counterpartWhen && f.zecAmountZat > 0)
    .sort((a, b) => b.zecAmountZat - a.zecAmountZat)
    .map((f) => f.chain);
}

/**
 * One direction's flows, largest first, with everything past `limit` folded into a single
 * `other` row.
 *
 * Folded rather than truncated so a Sankey's ribbons still sum to the boundary total. The
 * folded row carries its chain count.
 */
export interface FoldedFlows {
  top: CrossChainFlow[];
  otherZat: number;
  otherTransfers: number;
  otherChains: number;
}

export function foldFlows(
  flows: readonly CrossChainFlow[],
  direction: CrossChainDirection,
  limit: number,
): FoldedFlows {
  const ranked = flows
    .filter((f) => f.direction === direction && f.zecAmountZat > 0)
    .sort((a, b) => b.zecAmountZat - a.zecAmountZat);
  const top = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  return {
    top,
    otherZat: rest.reduce((s, f) => s + f.zecAmountZat, 0),
    otherTransfers: rest.reduce((s, f) => s + f.transfers, 0),
    otherChains: rest.length,
  };
}

/** One direction's volume. USD is swap-time and a lower bound; see `CrossChainFlow.usdAtSwap`. */
export interface CrossChainVolumeSide {
  transfers: number;
  zecAmountZat: number;
  usdAtSwap: number;
  usdCoveredTransfers: number;
}

export interface CrossChainVolume {
  in: CrossChainVolumeSide;
  out: CrossChainVolumeSide;
}

/**
 * The axis a narrowed aggregate is grouped along.
 *
 * `asset` is intentionally absent: NEAR Intents rows often carry a `"<CHAIN> asset"`
 * placeholder instead of a ticker (see `assetTickerIsKnown`), so grouping on it would present
 * placeholders as assets.
 */
export const CROSS_CHAIN_GROUP_BYS = ["none", "chain", "venue", "month", "day"] as const;
export type CrossChainGroupBy = (typeof CROSS_CHAIN_GROUP_BYS)[number];

/**
 * What "largest" means when transfers are ranked. ZEC and swap-time USD answer different
 * questions because ZEC's price has moved by an order of magnitude across the data. Ranking by
 * `usd` narrows the population to transfers with a published price.
 */
export type CrossChainTopBasis = "zec" | "usd";

/**
 * Which end of the ranking to return; independent of the basis.
 *
 * `smallest` keeps the `usd` basis's exclusion of unpriced transfers: an unknown price is not
 * a small one. `basisExcludesUnpricedTransfers` reports the exclusion either way.
 */
export type CrossChainTopOrder = "largest" | "smallest";

/** One row of a narrowed aggregate: both directions of one key, never netted. */
export interface CrossChainGroup {
  /** A chain ticker, a venue id, or a UTC `YYYY-MM` / `YYYY-MM-DD`, per the `groupBy`. */
  key: string;
  in: CrossChainVolumeSide;
  out: CrossChainVolumeSide;
}

/**
 * A narrowed cross-chain aggregate: the totals for the slice and its breakdown along one axis.
 *
 * Both directions ride on every row because they are separate populations of unrelated
 * transfers and must never be netted against each other.
 */
export interface CrossChainAggregate {
  groupBy: CrossChainGroupBy;
  totals: CrossChainVolume;
  /** Ordered by `groupOrder`. Empty when `groupBy` is "none". */
  groups: CrossChainGroup[];
  /**
   * The narrowing the server applied, echoed back. A caller must refuse a payload whose echo
   * does not match its request: an older API ignoring an unknown parameter returns a
   * well-formed aggregate for a different question.
   */
  applied: CrossChainNarrowing;
  /** Bounds of what was actually counted; both 0 when nothing matched. */
  firstAt: number;
  lastAt: number;
}

const emptySide = (): CrossChainVolumeSide => ({
  transfers: 0,
  zecAmountZat: 0,
  usdAtSwap: 0,
  usdCoveredTransfers: 0,
});

function addToSide(side: CrossChainVolumeSide, t: CrossChainTransfer): void {
  side.transfers += 1;
  side.zecAmountZat += t.zecAmountZat;
  // A null price adds no dollars and no coverage; `usdCoveredTransfers` records the gap.
  if (typeof t.usdValueAtSwap === "number" && Number.isFinite(t.usdValueAtSwap)) {
    side.usdAtSwap += t.usdValueAtSwap;
    side.usdCoveredTransfers += 1;
  }
}

/** The UTC month or day a transfer falls in, as the key a grouped row carries. */
function periodKey(timestamp: number, grain: "month" | "day"): string {
  const iso = new Date(timestamp * 1_000).toISOString();
  return grain === "month" ? iso.slice(0, 7) : iso.slice(0, 10);
}

function groupKeyOf(t: CrossChainTransfer, groupBy: CrossChainGroupBy): string | null {
  switch (groupBy) {
    case "none":
      return null;
    case "chain":
      return t.counterpartChain;
    case "venue":
      return t.protocol;
    case "month":
    case "day":
      return periodKey(t.timestamp, groupBy);
  }
}

/**
 * Aggregate an in-memory list of transfers under a narrowing, along one axis.
 *
 * The one implementation for the in-memory store and the fixtures; Postgres has its own copy
 * in SQL, held to the same answers by a parity test.
 *
 * Settlement legs are the caller's to exclude, by asset and never by chain (wrapped ZEC also
 * lives on Maya).
 *
 * A narrowing that matched nothing returns zeroed totals with `firstAt`/`lastAt` at 0. That
 * is a real answer, distinct from a failed read.
 */
export function aggregateCrossChain(
  transfers: Iterable<CrossChainTransfer>,
  filters: CrossChainNarrowing,
  groupBy: CrossChainGroupBy,
): CrossChainAggregate {
  const totals: CrossChainVolume = { in: emptySide(), out: emptySide() };
  const byKey = new Map<string, CrossChainGroup>();
  let firstAt = Number.POSITIVE_INFINITY;
  let lastAt = 0;

  for (const t of transfers) {
    if (!matchesCrossChainFilters(t, filters)) continue;
    addToSide(totals[t.direction], t);
    const key = groupKeyOf(t, groupBy);
    if (key !== null) {
      const row = byKey.get(key) ?? { key, in: emptySide(), out: emptySide() };
      addToSide(row[t.direction], t);
      byKey.set(key, row);
    }
    if (t.timestamp > 0) {
      firstAt = Math.min(firstAt, t.timestamp);
      lastAt = Math.max(lastAt, t.timestamp);
    }
  }

  return {
    groupBy,
    totals,
    groups: [...byKey.values()].sort(groupOrder(groupBy)),
    applied: filters,
    firstAt: Number.isFinite(firstAt) ? firstAt : 0,
    lastAt,
  };
}

/**
 * How grouped rows are ordered: time keys chronologically, everything else by total ZEC
 * across both directions, largest first (so a cap keeps the largest rows).
 */
export function groupOrder(
  groupBy: CrossChainGroupBy,
): (a: CrossChainGroup, b: CrossChainGroup) => number {
  if (groupBy === "month" || groupBy === "day") {
    return (a, b) => a.key.localeCompare(b.key);
  }
  return (a, b) =>
    b.in.zecAmountZat + b.out.zecAmountZat - (a.in.zecAmountZat + a.out.zecAmountZat);
}
