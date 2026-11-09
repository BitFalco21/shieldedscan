import { NU7_HEIGHT } from "./halving";
import { minerFeeSharePct, type MinerUsdParts } from "./miners";

/**
 * The NSM (Network Sustainability Mechanism) as `/miners` shows it. From NU7, ZIP 235 moves
 * `floor(6 × fees / 10)` of each block's fees into the NSM balance and leaves the rest to the
 * miner. Read per UTC day over every block from NU7 on, whatever its coinbase: a block's fee total
 * is public, so both shares are too. Before NU7 there is no NSM, so no day before it exists here,
 * not even as a zero.
 */

/** The NSM's percentage of a block's fees from NU7 (ZIP 235), from the one fee-split formula. */
export const NSM_FEE_SHARE_PCT = 100 - minerFeeSharePct(NU7_HEIGHT);

export interface NsmDay {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  /** The day's blocks from NU7 on. */
  blocks: number;
  /** The day's fee total; null when any block's is unknown, never a partial sum. */
  feeZat: number | null;
  /** What ZIP 235 moved into the NSM, block by block on each block's total. Null when `feeZat` is. */
  nsmZat: number | null;
  /**
   * The scheduled subsidy the day's blocks issued (`scheduledSubsidyZat`, block by block): new ZEC,
   * funding streams included. Null when the index does not hold every block the day spans.
   */
  issuedZat: number | null;
  /** The day's stored close; null for today, which has none yet, or a day the feed missed. */
  closeUsd: number | null;
  /** Today, still running. */
  partial: boolean;
}

export interface NsmBalance {
  /** The height the node read it at. */
  height: number;
  /** Null when the node does not report it (before Zakura 1.7.0): unknown, never zero. */
  zat: number | null;
  /**
   * What the balance held beyond fees: the balance less every block's fee share from NU7 to
   * `height`. The node opened the NSM at NU7 with the subsidy miners never claimed since
   * genesis, and no reissuance has left it yet. Null unless the index holds every one of those blocks,
   * with its fee, up to the very block the balance was read at.
   */
  carriedInZat: number | null;
}

export interface NsmOverview {
  activationHeight: number;
  /** The UTC day of the activation block, null until the index holds it. */
  activationDay: string | null;
  /** The node's balance now; null when the node could not be read just now. */
  balance: NsmBalance | null;
  /** The trailing days from activation, oldest first, today last. */
  days: NsmDay[];
}

export interface NsmWindow {
  /** The first day summed: the window's own, or activation's when the window opens before it. */
  fromDay: string;
  /** The window opens before activation: its earlier days had no NSM and are not in the sums. */
  sinceActivation: boolean;
  blocks: number;
  feeZat: number | null;
  nsmZat: number | null;
  /** The miners' share: the fees less the NSM's. */
  minerZat: number | null;
  /** The scheduled subsidy the window's blocks issued. */
  issuedZat: number | null;
  /** Issued less what the NSM removed: the window's change in circulating ZEC from the schedule and ZIP 235. */
  netIssuedZat: number | null;
  nsmUsd: MinerUsdParts;
  minerUsd: MinerUsdParts;
}

const sumOrNull = (values: (number | null)[]) =>
  values.some((v) => v === null) ? null : values.reduce<number>((s, v) => s + v!, 0);

/** What `share` of each day is worth, the way `minerValueUsd` values a reward. */
function usdParts(days: readonly NsmDay[], share: (d: NsmDay) => number | null): MinerUsdParts {
  const parts: MinerUsdParts = { closedUsd: 0, unpricedZat: 0, todayZat: 0 };
  for (const d of days) {
    const zat = share(d);
    if (zat === null) continue;
    if (d.partial) parts.todayZat += zat;
    else if (d.closeUsd === null) parts.unpricedZat += zat;
    else parts.closedUsd += (zat / 1e8) * d.closeUsd;
  }
  return parts;
}

/**
 * The NSM's figures over a window of whole UTC days, `fromDay` to `toDay` inclusive, or null when
 * the window ends before activation (or the index has not reached it). A window that opens
 * before activation is summed from activation and says so. Sums are null when any day in them is
 * unknown, or when the series does not reach back to the first day summed.
 */
export function nsmWindow(o: NsmOverview, fromDay: string, toDay: string): NsmWindow | null {
  if (o.activationDay === null || o.activationDay > toDay) return null;
  const sinceActivation = o.activationDay > fromDay;
  const start = sinceActivation ? o.activationDay : fromDay;
  const days = o.days.filter((d) => d.day >= start && d.day <= toDay);
  const covered = o.days.length > 0 && o.days[0]!.day <= start;
  const feeZat = covered ? sumOrNull(days.map((d) => d.feeZat)) : null;
  const nsmZat = covered ? sumOrNull(days.map((d) => d.nsmZat)) : null;
  const issuedZat = covered ? sumOrNull(days.map((d) => d.issuedZat)) : null;
  const minerOf = (d: NsmDay) =>
    d.feeZat === null || d.nsmZat === null ? null : d.feeZat - d.nsmZat;
  return {
    fromDay: start,
    sinceActivation,
    blocks: days.reduce((s, d) => s + d.blocks, 0),
    feeZat,
    nsmZat,
    minerZat: feeZat === null || nsmZat === null ? null : feeZat - nsmZat,
    issuedZat,
    netIssuedZat: issuedZat === null || nsmZat === null ? null : issuedZat - nsmZat,
    nsmUsd: usdParts(days, (d) => d.nsmZat),
    minerUsd: usdParts(days, minerOf),
  };
}

/** A day's issuance net of ZIP 235's removal; null when either term is unknown. */
export const netIssuedZat = (d: Pick<NsmDay, "issuedZat" | "nsmZat">): number | null =>
  d.issuedZat === null || d.nsmZat === null ? null : d.issuedZat - d.nsmZat;
