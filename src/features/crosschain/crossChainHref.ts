import type {
  ChartRange,
  CrossChainDirectionFilter,
  CrossChainFlow,
  CrossChainNarrowing,
  CrossChainProtocolFilter,
  CrossChainSide,
} from "@/domain";
import { chainFilterOptions, serializeChainFilter } from "@/domain";

/**
 * Everything `/cross-chain` can be narrowed by, as one value. A single state rather than four
 * independent ones, because every control must preserve the other three; one builder makes that
 * structural instead of something each control has to remember.
 */
export interface CrossChainFilterState {
  protocol: CrossChainProtocolFilter;
  direction: CrossChainDirectionFilter;
  sourceChains: string[];
  destinationChains: string[];
  /** Minimum swap-time USD, or `null` for every transfer. */
  minUsd: number | null;
}

export const EMPTY_CROSSCHAIN_FILTERS: CrossChainFilterState = {
  protocol: "all",
  direction: "all",
  sourceChains: [],
  destinationChains: [],
  minUsd: null,
};

/**
 * The URL-state filters as the data port's narrowing. One definition for the route's query, the
 * live feed's client-side narrowing and their tests: the URL state carries `minUsd` and may hold
 * `null`, while the port speaks `minUsdAtSwap` and omits it when absent.
 */
export function toCrossChainNarrowing(state: CrossChainFilterState): CrossChainNarrowing {
  return {
    protocol: state.protocol,
    direction: state.direction,
    sourceChains: state.sourceChains,
    destinationChains: state.destinationChains,
    ...(state.minUsd === null ? {} : { minUsdAtSwap: state.minUsd }),
  };
}

/** Whether anything is narrowing the list at all. */
export function isFiltered(state: CrossChainFilterState): boolean {
  return (
    state.protocol !== "all" ||
    state.direction !== "all" ||
    state.sourceChains.length > 0 ||
    state.destinationChains.length > 0 ||
    state.minUsd !== null
  );
}

/**
 * The URL for a filter state, optionally at a cursor.
 *
 * A filter link passes no cursor, which is what makes changing a filter reset to the newest
 * page: a cursor names a position in a list that no longer exists once the list changes.
 */
export function crossChainHref(
  state: CrossChainFilterState,
  cursor: { before?: string; after?: string } = {},
): string {
  const params = new URLSearchParams();
  if (cursor.before) params.set("before", cursor.before);
  if (cursor.after) params.set("after", cursor.after);
  if (state.protocol !== "all") params.set("protocol", state.protocol);
  if (state.direction !== "all") params.set("direction", state.direction);
  const source = serializeChainFilter(state.sourceChains);
  const destination = serializeChainFilter(state.destinationChains);
  if (source) params.set("source", source);
  if (destination) params.set("destination", destination);
  if (state.minUsd !== null) params.set("min", String(state.minUsd));
  const qs = params.toString();
  return qs ? `/cross-chain?${qs}` : "/cross-chain";
}

/**
 * The URL for one time window on the flows tab.
 *
 * A link, unlike the visually identical `RangeToggle` on `/charts`, which windows a series
 * already on the page. This one changes every claim the page makes and requires a refetch, which
 * makes it a filter and so something shareable. ALL carries no parameter, so the default view
 * has one URL and one cache key.
 */
export function flowsHref(range: ChartRange): string {
  return range === "all" ? "/cross-chain/flows" : `/cross-chain/flows?range=${range}`;
}

/** The venues tab's window links — the same `?range=` vocabulary as flows, ALL carrying none. */
export function protocolsHref(range: ChartRange): string {
  return range === "all" ? "/cross-chain/protocols" : `/cross-chain/protocols?range=${range}`;
}

/**
 * Switch direction, dropping chain selections the new direction cannot offer. Under INBOUND
 * every destination is Zcash, so a destination selection is unreachable rather than empty;
 * carrying it over would strand the reader at an empty table with chips for chains the menu no
 * longer lists.
 */
export function withDirection(
  state: CrossChainFilterState,
  direction: CrossChainDirectionFilter,
  chains: readonly CrossChainFlow[],
): CrossChainFilterState {
  const options = chainFilterOptions(chains, direction);
  return {
    ...state,
    direction,
    sourceChains: state.sourceChains.filter((c) => options.source.includes(c)),
    destinationChains: state.destinationChains.filter((c) => options.destination.includes(c)),
  };
}

/**
 * Add or remove one chain on one side, pinning the direction that side implies.
 *
 * A foreign SOURCE chain only exists on an inbound transfer (an outbound one's source is always
 * Zcash), so the direction follows the chain rather than being an independent choice. That makes
 * impossible routes (BTC → ETH, or ZEC at both ends) unreachable: the opposite side offers no
 * menu and is cleared here. It also keeps the direction chips truthful.
 *
 * Removing the last chain leaves the direction where it is: the reader chose that view, and
 * widening it back silently would change the page under them.
 */
export function withChainToggled(
  state: CrossChainFilterState,
  side: CrossChainSide,
  chain: string,
): CrossChainFilterState {
  const current = side === "source" ? state.sourceChains : state.destinationChains;
  const next = current.includes(chain)
    ? current.filter((c) => c !== chain)
    : [...current, chain].sort();
  return side === "source"
    ? { ...state, direction: "in", sourceChains: next, destinationChains: [] }
    : { ...state, direction: "out", destinationChains: next, sourceChains: [] };
}

/** Clear one side entirely. */
export function withSideCleared(
  state: CrossChainFilterState,
  side: CrossChainSide,
): CrossChainFilterState {
  return side === "source" ? { ...state, sourceChains: [] } : { ...state, destinationChains: [] };
}
