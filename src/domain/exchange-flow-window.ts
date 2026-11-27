/**
 * The exchange flows over one window, as the page reads them from `/v1/labels/exchanges/flows`
 * and `/movements`: each exchange's totals with where the ZEC came from or went, a day or month
 * series, and the largest single movements.
 */

import { EXCHANGES, type ExchangeId } from "./exchange-reserves";
import type { FlowKind } from "./exchange-flows";

export interface ExchangeFlowPart {
  kind: FlowKind;
  /** The other exchange, on an `exchange` part; null otherwise. */
  exchange: ExchangeId | null;
  zat: number;
}

export interface ExchangeFlowSide {
  /** Transactions, not customers: one sweep of many deposits is one. */
  txs: number;
  zat: number;
  parts: ExchangeFlowPart[];
}

export interface ExchangeFlowTotal {
  in: ExchangeFlowSide;
  out: ExchangeFlowSide;
  /** Moves between the exchange's own wallets, and the fees they paid. */
  internalTxs: number;
  internalFeeZat: number;
}

export interface ExchangeFlowPeriodFigures {
  inZat: number;
  outZat: number;
  inTxs: number;
  outTxs: number;
}

export interface ExchangeFlowPeriod {
  /** The period's first UTC day, unix seconds. */
  timestamp: number;
  /** The last day counted, when the count stops inside the period. */
  through: number | null;
  /** Null for an exchange not counted yet. */
  exchanges: Record<ExchangeId, ExchangeFlowPeriodFigures | null>;
  /**
   * Every exchange as one, a move between two of them left out and stated as `betweenZat`; null
   * when one of them is not counted.
   */
  all: { inZat: number; outZat: number; betweenZat: number } | null;
}

export interface ExchangeFlowWindow {
  /** Days in the window, or null for all of history. */
  windowDays: number | null;
  interval: "day" | "month";
  /** The first and last whole days counted, unix seconds; null when none is. */
  counted: { from: number; to: number } | null;
  /** Null for an exchange not counted yet. */
  totals: Record<ExchangeId, ExchangeFlowTotal | null>;
  points: ExchangeFlowPeriod[];
  /** The source's coverage notes, verbatim. */
  notes: string[];
}

export interface ExchangeMovement {
  txid: string;
  exchange: ExchangeId;
  direction: "in" | "out";
  zat: number;
  timestamp: number;
  parts: ExchangeFlowPart[];
}

/** The page's windows: trailing whole days, ending with the last day counted. */
export const EXCHANGE_FLOW_WINDOWS = [
  { value: "7d", label: "7D", days: 7 },
  { value: "30d", label: "30D", days: 30 },
  { value: "90d", label: "90D", days: 90 },
  { value: "1y", label: "1Y", days: 365 },
  { value: "all", label: "ALL", days: null },
] as const;

export type ExchangeFlowWindowId = (typeof EXCHANGE_FLOW_WINDOWS)[number]["value"];

/** A window read off a URL: a closed set, so anything unrecognised is the default, 30 days. */
export function parseExchangeFlowWindow(raw: string | undefined): ExchangeFlowWindowId {
  return EXCHANGE_FLOW_WINDOWS.find((w) => w.value === raw)?.value ?? "30d";
}

export function exchangeFlowWindowDays(id: ExchangeFlowWindowId): number | null {
  return EXCHANGE_FLOW_WINDOWS.find((w) => w.value === id)!.days;
}

/** An exchange read off a URL, or null for all of them. */
export function parseExchangeParam(raw: string | undefined): ExchangeId | null {
  return (EXCHANGES as readonly string[]).includes(raw ?? "") ? (raw as ExchangeId) : null;
}

/** Days per bar: daily up to three months, monthly beyond, where daily bars stop being legible. */
export function exchangeFlowInterval(windowDays: number | null): "day" | "month" {
  return windowDays !== null && windowDays <= 90 ? "day" : "month";
}

/** A window's first UTC day, `windowDays` back from today; null for all of history. */
export function exchangeFlowWindowStart(windowDays: number | null, nowSec: number): number | null {
  if (windowDays === null) return null;
  const today = Math.floor(nowSec / 86_400) * 86_400;
  return today - windowDays * 86_400;
}

export interface CombinedFlowSide {
  zat: number;
  txs: number;
  parts: ExchangeFlowPart[];
}

export interface CombinedFlows {
  in: CombinedFlowSide;
  out: CombinedFlowSide;
  internalTxs: number;
  internalFeeZat: number;
  /** Sent from one of the exchanges to another of them: in neither `in` nor `out`. */
  betweenZat: number;
}

/**
 * Several exchanges as one: their sums, with a move between two of them left out of both sides
 * and stated apart, as `/v1`'s `allExchanges` does. Transaction counts add up exchange by
 * exchange, so a move between two of them counts once on each side.
 */
export function combineFlows(
  totals: Record<ExchangeId, ExchangeFlowTotal | null>,
  exchanges: readonly ExchangeId[],
): CombinedFlows | null {
  const picked = exchanges.map((e) => totals[e]);
  if (picked.some((t) => t === null)) return null;
  const inside = new Set<ExchangeId>(exchanges);
  let betweenZat = 0;
  let betweenIn = 0;
  const side = (pick: (t: ExchangeFlowTotal) => ExchangeFlowSide, sent: boolean) => {
    const parts = new Map<string, ExchangeFlowPart>();
    let zat = 0;
    let txs = 0;
    for (const t of picked as ExchangeFlowTotal[]) {
      const s = pick(t);
      zat += s.zat;
      txs += s.txs;
      for (const p of s.parts) {
        if (p.kind === "exchange" && p.exchange !== null && inside.has(p.exchange)) {
          if (sent) betweenZat += p.zat;
          else betweenIn += p.zat;
          continue;
        }
        const key = `${p.kind}:${p.exchange ?? ""}`;
        const held = parts.get(key);
        if (held) held.zat += p.zat;
        else parts.set(key, { ...p });
      }
    }
    return { zat, txs, parts: [...parts.values()] };
  };
  const out = side((t) => t.out, true);
  const inn = side((t) => t.in, false);
  return {
    in: { ...inn, zat: inn.zat - betweenIn },
    out: { ...out, zat: out.zat - betweenZat },
    internalTxs: (picked as ExchangeFlowTotal[]).reduce((s, t) => s + t.internalTxs, 0),
    internalFeeZat: (picked as ExchangeFlowTotal[]).reduce((s, t) => s + t.internalFeeZat, 0),
    betweenZat,
  };
}
