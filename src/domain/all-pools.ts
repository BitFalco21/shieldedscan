import { isOneOf } from "./closed-set";
import { nu7ActiveAt, unspendablePools } from "./consensus";
import type { UpgradeNetwork } from "./network-upgrade";
import {
  MAX_SUPPLY_ZAT,
  POOL_NAMES,
  VALUE_POOL_NAMES,
  circulatingZat,
  shieldedShareOfCirculatingPct,
  shieldedZat,
  type SupplyBreakdown,
  type ValuePoolName,
} from "./pool";

/**
 * Every place a ZEC of the 21M can be, in display order: the six value pools, the NSM balance,
 * and what is not yet mined. Together they partition the cap exactly.
 */
export const SUPPLY_PART_IDS = [
  "transparent",
  "ironwood",
  "orchard",
  "sapling",
  "sprout",
  "lockbox",
  "nsm",
  "unmined",
] as const;

export type SupplyPartId = (typeof SUPPLY_PART_IDS)[number];

const POOL_PART_IDS = SUPPLY_PART_IDS.filter((id): id is ValuePoolName =>
  isOneOf(VALUE_POOL_NAMES, id),
);

export interface SupplyPart {
  /** Unique within one breakdown. */
  key: string;
  /** The part, or null for a pool a newer API reports that this build has never heard of. */
  id: SupplyPartId | null;
  /** The pool's own name for an unknown pool; the id otherwise. */
  name: string;
  /** Null when we could not read it — never 0. */
  zat: number | null;
}

export interface AllPoolsSupply {
  /** The block every figure below was read at: one read, so the parts add up. */
  height: number;
  parts: SupplyPart[];
  /** Every pool plus the NSM. Null when any of them is unknown. */
  issuedZat: number | null;
  circulatingZat: number | null;
  shieldedZat: number | null;
  /** Shielded over circulating, the site's headline definition. */
  shieldedSharePct: number | null;
  unminedZat: number | null;
}

/**
 * The NSM balance (ZIP 235) at the breakdown's height.
 *
 * A node older than Zakura 1.7.0 omits it. Before NU7 the balance is exactly zero by consensus,
 * since nothing can enter it yet, so the omission costs nothing; from NU7 it is unknown. Decided
 * on the breakdown's own height, never the clock, so a figure and its rule come from one block.
 */
export function nsmBalanceZat(s: SupplyBreakdown, network: UpgradeNetwork): number | null {
  if (s.nsmZat !== null) return s.nsmZat;
  return nu7ActiveAt(network, s.height) ? null : 0;
}

/**
 * The whole supply, part by part, for the all-pools view.
 *
 * Stricter than `minedZat`, which counts an absent NSM as zero at any height: here a part we
 * could not read makes every total that needs it unknown, rather than quietly smaller. An issued
 * total above the cap is a misreading, so nothing is left "to mine" from it.
 */
export function allPoolsSupply(s: SupplyBreakdown, network: UpgradeNetwork): AllPoolsSupply {
  // A pool reported twice has no one balance, and picking a row would be a guess: it is
  // unread, and so is every total, since none can say which row it summed.
  const seen = new Map<string, number>();
  for (const p of s.pools) seen.set(p.pool, (seen.get(p.pool) ?? 0) + 1);
  const ambiguous = s.pools.length !== seen.size;
  const balances = new Map<string, number>(
    s.pools.filter((p) => seen.get(p.pool) === 1).map((p) => [p.pool, p.balanceZat]),
  );
  const has = (pool: ValuePoolName) => !ambiguous && balances.has(pool);
  const nsm = nsmBalanceZat(s, network);

  const issued =
    VALUE_POOL_NAMES.every(has) && nsm !== null
      ? s.pools.reduce((sum, p) => sum + p.balanceZat, 0) + nsm
      : null;
  const unmined = issued === null || issued > MAX_SUPPLY_ZAT ? null : MAX_SUPPLY_ZAT - issued;

  const unspendable = unspendablePools(network, s.height);
  const circulating = VALUE_POOL_NAMES.filter((p) => !unspendable.includes(p)).every(has)
    ? circulatingZat(s, network)
    : null;
  const shielded = POOL_NAMES.every(has) ? shieldedZat(s) : null;

  const unknownPools = [...seen.keys()]
    .filter((pool) => !isOneOf(VALUE_POOL_NAMES, pool))
    .map((pool) => ({ pool, balanceZat: balances.get(pool) ?? null }));
  const parts: SupplyPart[] = [
    ...POOL_PART_IDS.map((id) => ({ key: id, id, name: id, zat: balances.get(id) ?? null })),
    { key: "nsm", id: "nsm", name: "nsm", zat: nsm },
    // Issued ZEC like any other pool, so it is shown rather than left out of the sum it is in.
    ...unknownPools.map((p) => ({
      key: `pool:${p.pool}`,
      id: null,
      name: p.pool,
      zat: p.balanceZat,
    })),
    { key: "unmined", id: "unmined", name: "unmined", zat: unmined },
  ];

  return {
    height: s.height,
    parts,
    issuedZat: issued,
    circulatingZat: circulating,
    shieldedZat: shielded,
    shieldedSharePct:
      shielded === null || circulating === null
        ? null
        : shieldedShareOfCirculatingPct(shielded, circulating),
    unminedZat: unmined,
  };
}

/** A part's share of the cap, 0–100. */
export function shareOfMaxSupplyPct(zat: number): number {
  return (zat / MAX_SUPPLY_ZAT) * 100;
}

/** A part's share of what has been issued, or null when either side is unknown. */
export function shareOfIssuedPct(zat: number | null, issuedZat: number | null): number | null {
  if (zat === null || issuedZat === null || issuedZat <= 0) return null;
  return (zat / issuedZat) * 100;
}

/**
 * The 21M bar's segments, each a share of the cap. Null unless every part is known: a bar with a
 * gap would draw a partition that does not add up.
 */
export function supplyBarSegments(
  supply: AllPoolsSupply,
): { part: SupplyPart; pct: number }[] | null {
  const segments = supply.parts.flatMap((part) =>
    part.zat === null ? [] : [{ part, pct: shareOfMaxSupplyPct(part.zat) }],
  );
  return segments.length === supply.parts.length ? segments : null;
}
