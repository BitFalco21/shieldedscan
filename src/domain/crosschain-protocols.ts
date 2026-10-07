import type {
  CrossChainAggregate,
  CrossChainDirection,
  CrossChainGroup,
  CrossChainProtocol,
  CrossChainTransfer,
  CrossChainVolumeSide,
} from "./crosschain";
import { SETTLEMENT_ASSETS, aggregateCrossChain } from "./crosschain";
import { CROSSCHAIN_PROTOCOL_FILTERS } from "./list";
import { DAY_SECONDS } from "./time";

/**
 * Every protocol this explorer indexes. Derived from the protocol filter's options so the
 * protocols tab and the `/cross-chain` PROTOCOL menu cannot disagree.
 */
export const CROSSCHAIN_PROTOCOLS: readonly CrossChainProtocol[] =
  CROSSCHAIN_PROTOCOL_FILTERS.filter((p): p is CrossChainProtocol => p !== "all");

/**
 * The single largest swap at a protocol, as far as the protocols tab needs it.
 *
 * Not a whole `CrossChainTransfer`: the live path reads it from `/v1/crosschain/transfers/top`,
 * whose DTO is shaped differently. These are the fields the card renders, plus the id for the
 * transfer link.
 */
export interface CrossChainSwapRef {
  id: string;
  direction: CrossChainDirection;
  counterpartChain: string;
  zecAmountZat: number;
  /** The protocol's own swap-time USD for the Zcash leg; null when it published none. */
  usdValueAtSwap: number | null;
  timestamp: number;
}

/** One protocol over the page's window. */
export interface CrossChainProtocolStats {
  protocol: CrossChainProtocol;
  in: CrossChainVolumeSide;
  out: CrossChainVolumeSide;
  /** Counterpart chains in the window, largest first by ZEC across both directions. */
  chains: CrossChainGroup[];
  /**
   * The protocol's first swap in our records, all-time, ignoring the window: a protocol fact
   * that explains a young protocol's small figures. It marks the start of what we observed,
   * not the protocol's listing date. 0 when never.
   */
  firstSeenAt: number;
  /**
   * The protocol's newest swap in our records, all-time, so an idle protocol's card can say
   * when it last carried ZEC. 0 when never.
   */
  lastSeenAt: number;
  /**
   * The single largest swap by ZEC in the window. `null` when the window holds none,
   * `"unavailable"` when the read failed; the card renders the latter as `Unmeasured`, never
   * as "no swaps".
   */
  largest: CrossChainSwapRef | null | "unavailable";
}

export interface CrossChainProtocolSummary {
  /** The window echoed, in days; null for all-time. */
  windowDays: number | null;
  /** Unix seconds the window starts at (a UTC midnight); null for all-time. */
  windowStart: number | null;
  /** Largest first by ZEC crossed in the window. Every indexed protocol, including an idle one. */
  protocols: CrossChainProtocolStats[];
}

/**
 * Where an N-day window starts: the UTC midnight that makes it N calendar days, today included.
 *
 * Day-aligned because the aggregate route takes UTC days (`?from=YYYY-MM-DD`, half-open) and
 * the page prints the start date. Today is partial; nothing on this tab compares windows.
 */
export function protocolWindowStart(windowDays: number | null, nowSeconds: number): number | null {
  if (windowDays === null) return null;
  const today = Math.floor(nowSeconds / DAY_SECONDS) * DAY_SECONDS;
  return today - (windowDays - 1) * DAY_SECONDS;
}

/** Two volume sides summed field by field: every field is a count or an amount, so all add. */
export function addSides(a: CrossChainVolumeSide, b: CrossChainVolumeSide): CrossChainVolumeSide {
  return {
    transfers: a.transfers + b.transfers,
    zecAmountZat: a.zecAmountZat + b.zecAmountZat,
    usdAtSwap: a.usdAtSwap + b.usdAtSwap,
    usdCoveredTransfers: a.usdCoveredTransfers + b.usdCoveredTransfers,
  };
}

/** Both directions of one side folded together. */
export function bothSides(v: {
  in: CrossChainVolumeSide;
  out: CrossChainVolumeSide;
}): CrossChainVolumeSide {
  return addSides(v.in, v.out);
}

/**
 * One protocol's card, from a CHAIN-grouped aggregate narrowed to that protocol.
 *
 * Used by both the API adapter (store aggregate) and the fixtures (`aggregateCrossChain`), so
 * the two builds assemble a card the same way.
 */
export function protocolStatsFromAggregate(
  protocol: CrossChainProtocol,
  windowed: CrossChainAggregate,
  allTime: Pick<CrossChainAggregate, "firstAt" | "lastAt">,
  largest: CrossChainProtocolStats["largest"],
): CrossChainProtocolStats {
  return {
    protocol,
    in: windowed.totals.in,
    out: windowed.totals.out,
    chains: windowed.groups,
    firstSeenAt: allTime.firstAt,
    lastSeenAt: allTime.lastAt,
    largest,
  };
}

/** Largest first by ZEC; ties broken by name so the order is stable between renders. */
export function orderProtocols(protocols: CrossChainProtocolStats[]): CrossChainProtocolStats[] {
  return [...protocols].sort(
    (a, b) =>
      bothSides(b).zecAmountZat - bothSides(a).zecAmountZat || a.protocol.localeCompare(b.protocol),
  );
}

/**
 * The whole tab from an in-memory list of transfers — the fixture path.
 *
 * Settlement legs are excluded by asset here, matching the store's `narrowingClauses`, because
 * `aggregateCrossChain` leaves that to the caller.
 */
export function buildProtocolSummary(
  transfers: readonly CrossChainTransfer[],
  windowDays: number | null,
  nowSeconds: number,
): CrossChainProtocolSummary {
  const counted = transfers.filter((t) => !SETTLEMENT_ASSETS.includes(t.counterpartAsset));
  const windowStart = protocolWindowStart(windowDays, nowSeconds);
  const window = windowStart === null ? {} : { fromTimestamp: windowStart };

  const protocols = CROSSCHAIN_PROTOCOLS.map((protocol) => {
    const windowed = aggregateCrossChain(counted, { ...window, protocol }, "chain");
    const allTime =
      windowStart === null ? windowed : aggregateCrossChain(counted, { protocol }, "none");
    const inWindow = counted.filter(
      (t) => t.protocol === protocol && (windowStart === null || t.timestamp >= windowStart),
    );
    const top = inWindow.reduce<CrossChainTransfer | null>(
      (best, t) => (best === null || t.zecAmountZat > best.zecAmountZat ? t : best),
      null,
    );
    return protocolStatsFromAggregate(
      protocol,
      windowed,
      allTime,
      top === null
        ? null
        : {
            id: top.id,
            direction: top.direction,
            counterpartChain: top.counterpartChain,
            zecAmountZat: top.zecAmountZat,
            usdValueAtSwap: top.usdValueAtSwap,
            timestamp: top.timestamp,
          },
    );
  });

  return { windowDays, windowStart, protocols: orderProtocols(protocols) };
}
