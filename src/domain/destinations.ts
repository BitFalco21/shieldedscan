import type { ZcashAddressKind } from "./address";

/**
 * Where inbound swaps land, per counterpart chain: the address FAMILY each swap's venue published
 * for its Zcash side. Sapling and unified addresses can receive shielded funds; that is a
 * capability, never a claim the funds were shielded, because a unified address may also carry a
 * transparent receiver and which one a payout used is not public. A swap whose venue published no
 * Zcash address (`kind: null`) is in neither term of the share, and is counted beside it.
 */

/** Whether an address family can receive shielded funds; null when no address was published. */
export function isShieldedCapableKind(kind: ZcashAddressKind | null): boolean | null {
  return kind === null ? null : kind !== "transparent";
}

/** Inbound swaps from one counterpart chain that landed at one Zcash address family. */
export interface DestinationBucket {
  chain: string;
  kind: ZcashAddressKind | null;
  transfers: number;
  zat: number;
}

/**
 * The buckets over trailing windows ending at `asOf`, one per chart range: `days` null is all of
 * history. Each window is counted on its own, never cut from a monthly series.
 */
export interface DestinationWindows {
  asOf: number;
  windows: { days: number | null; fromTimestamp: number | null; buckets: DestinationBucket[] }[];
}

/** The trailing windows served, in days, all of history first: the chart's ranges. */
export const DESTINATION_WINDOW_DAYS: readonly (number | null)[] = [null, 365, 180, 90, 60, 30];

/** One counterpart chain's inbound swaps by landing family, or several folded into one row. */
export interface ChainDestinations {
  /** A chain ticker, or the fold's key. */
  chain: string;
  /** How many chains the row holds: 1, or the fold's count. */
  chains: number;
  capable: number;
  transparent: number;
  /** Swaps whose venue published no Zcash address: in neither term of the share. */
  unknown: number;
  capableZat: number;
  transparentZat: number;
  unknownZat: number;
}

const empty = (chain: string, chains = 1): ChainDestinations => ({
  chain,
  chains,
  capable: 0,
  transparent: 0,
  unknown: 0,
  capableZat: 0,
  transparentZat: 0,
  unknownZat: 0,
});

/** Every swap a row counts, published address or not. */
export const destinationSwaps = (r: ChainDestinations) => r.capable + r.transparent + r.unknown;

/**
 * The shielded-capable share of a row's swaps, in percent, over the swaps whose venue published a
 * classifiable address. Null when there were none: no denominator, not a zero share.
 */
export function shieldedCapableSharePct(r: ChainDestinations): number | null {
  const classified = r.capable + r.transparent;
  return classified === 0 ? null : (100 * r.capable) / classified;
}

/**
 * The buckets as one row per counterpart chain, the chains with the most inbound swaps first (the
 * ticker breaks a tie, so the order is stable).
 */
export function destinationsByChain(buckets: readonly DestinationBucket[]): ChainDestinations[] {
  const rows = new Map<string, ChainDestinations>();
  for (const b of buckets) {
    const row = rows.get(b.chain) ?? empty(b.chain);
    const capable = isShieldedCapableKind(b.kind);
    if (capable === null) {
      row.unknown += b.transfers;
      row.unknownZat += b.zat;
    } else if (capable) {
      row.capable += b.transfers;
      row.capableZat += b.zat;
    } else {
      row.transparent += b.transfers;
      row.transparentZat += b.zat;
    }
    rows.set(b.chain, row);
  }
  return [...rows.values()].sort(
    (a, b) => destinationSwaps(b) - destinationSwaps(a) || (a.chain < b.chain ? -1 : 1),
  );
}

/**
 * The `shown` busiest chains on their own and the rest added into one `foldKey` row that says how
 * many chains it holds: a small chain's share over a handful of swaps would read as a finding.
 * Nothing is dropped, so the rows still add up to every swap.
 */
export function foldDestinations(
  rows: readonly ChainDestinations[],
  shown: number,
  foldKey: string,
): ChainDestinations[] {
  if (rows.length <= shown + 1) return [...rows];
  const fold = empty(foldKey, 0);
  for (const r of rows.slice(shown)) {
    fold.chains += r.chains;
    fold.capable += r.capable;
    fold.transparent += r.transparent;
    fold.unknown += r.unknown;
    fold.capableZat += r.capableZat;
    fold.transparentZat += r.transparentZat;
    fold.unknownZat += r.unknownZat;
  }
  return [...rows.slice(0, shown), fold];
}
