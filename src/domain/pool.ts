import { isOneOf } from "./closed-set";
import { ZATS_PER_ZEC } from "./transaction";
import type {
  IronwoodBundle,
  OrchardBundle,
  SaplingBundle,
  SproutBundle,
  Transaction,
} from "./transaction";

/**
 * The shielded pools, newest first. Ironwood joined when NU6.3 activated at height 3,428,143.
 *
 * `transparent` and `lockbox` are value pools the node tracks but are not shielded: transparent
 * is the public side, and the lockbox holds the NU6 deferred block subsidy, which no transaction
 * spends into or out of. `PoolId` in `data/chain/rpc-types.ts` covers all six.
 */
export const POOL_NAMES = ["ironwood", "orchard", "sapling", "sprout"] as const;

/** Derived from `POOL_NAMES` rather than declared beside it, so the two cannot drift. */
export type PoolName = (typeof POOL_NAMES)[number];

/**
 * Any pool's bundle on a transaction. Every modern bundle publishes `valueBalanceZat`; Sprout's
 * carries only a JoinSplit count (its public values live per JoinSplit in the RPC), and
 * `reportsValueBalance` tells the two apart.
 */
export type PoolBundle = SproutBundle | SaplingBundle | OrchardBundle | IronwoodBundle;

/**
 * Which field on `Transaction` carries each pool's bundle.
 *
 * A `Record<PoolName, …>`, so adding a pool to `POOL_NAMES` fails to compile here until its
 * accessor is written. `hasShielded`, `netShieldedZat`, `reportsValueBalance`, `txPools`,
 * `poolMigration` and the pulse's per-pool net all derive from this table; never enumerate the
 * pool fields by hand elsewhere.
 */
export const POOL_BUNDLE: Readonly<Record<PoolName, (tx: Transaction) => PoolBundle | null>> = {
  ironwood: (tx) => tx.ironwood,
  orchard: (tx) => tx.orchard,
  sapling: (tx) => tx.sapling,
  sprout: (tx) => tx.sprout,
};

/**
 * Every published per-pool balance on a transaction, newest pool first, in RPC sign
 * (positive = entering the pool). Sprout never appears: its bundle carries no balance, so a
 * caller that needs a net figure must gate on this list being non-empty.
 */
export function poolBalances(tx: Transaction): { pool: PoolName; zat: number }[] {
  const out: { pool: PoolName; zat: number }[] = [];
  for (const pool of POOL_NAMES) {
    const bundle = POOL_BUNDLE[pool](tx);
    if (bundle !== null && "valueBalanceZat" in bundle)
      out.push({ pool, zat: bundle.valueBalanceZat });
  }
  return out;
}

/**
 * Which shielded pools a transaction touches, newest protocol first.
 *
 * Complements `txKind`: the kind says what happened at the transparent boundary, the pool says
 * which cryptography carried it.
 */
export function txPools(tx: Transaction): PoolName[] {
  return POOL_NAMES.filter((pool) => POOL_BUNDLE[pool](tx) !== null);
}

export interface ShieldedPool {
  pool: PoolName;
  balanceZat: number;
}

export interface ShieldedSupplyPoint {
  /** Unix seconds at the start of the day this point closes; the chart's x axis. */
  timestamp: number;
  /** The day's highest block — the one the balance is read at. A closing value. */
  height: number;
  totalZat: number;
}

/**
 * Transactions that used each pool on one UTC day (carried its bundle, whatever the value did).
 *
 * Not a partition: one transaction can carry two pools' bundles, so these counts may sum past
 * the day's total and must never be stacked or added together.
 */
export interface PoolUsageDayPoint {
  /** Unix seconds at the start of the UTC day. */
  timestamp: number;
  sproutTxs: number;
  saplingTxs: number;
  orchardTxs: number;
  ironwoodTxs: number;
}

/**
 * ZEC migrating between shielded pools on one UTC day, keyed by the pool that gained.
 *
 * Each migration has exactly one destination (see `poolMigration`), so these values do
 * partition the day's migrated total and may be stacked. The amount is the destination's own
 * published value balance; Sprout's side derives from its public JoinSplit values, a different
 * accounting.
 */
export interface PoolMigrationDayPoint {
  /** Unix seconds at the start of the UTC day. */
  timestamp: number;
  toSproutZat: number;
  toSaplingZat: number;
  toOrchardZat: number;
  toIronwoodZat: number;
}

export function totalShieldedZat(pools: ShieldedPool[]): number {
  return pools.reduce((s, p) => s + p.balanceZat, 0);
}

/**
 * A transaction that moves value from one shielded pool into another — routine since Ironwood,
 * into which Orchard value migrates through a turnstile. Not a "transfer inside" the pools
 * involved: the crossing between pools is the transaction's main public fact.
 */
export interface PoolMigration {
  /** Pools value left, in `PoolName` order. */
  fromPools: PoolName[];
  /** The single pool value entered. */
  toPool: PoolName;
  /** How much crossed, in zatoshis. Public: it is the destination pool's own balance. */
  amountZat: number;
}

/**
 * Detects a pool migration, or `null` when the transaction is not one.
 *
 * The shape: no transparent side, at least one pool with a negative balance (value leaving),
 * and exactly one with a positive balance (value entering). With two destinations "how much
 * went where" would be a guess, so this returns null rather than apportioning.
 *
 * The amount is the destination pool's published `valueBalanceZat`, which reveals nothing about
 * the parties: the quantity that crossed a pool boundary is public, who sent it is not.
 *
 * Example, `ea0a65f6…` (block 3,428,172): Sapling −105.54966347 and Orchard −1,993.96763179
 * out, Ironwood +2,099.51599526 in, leaving 0.0013 as the fee.
 */
export function poolMigration(tx: Transaction): PoolMigration | null {
  if (tx.transparentInputs.length > 0 || tx.transparentOutputs.length > 0) return null;

  // Sprout publishes no per-bundle balance, so a Sprout-source migration is not detected here
  // (on `/pulse` it is drawn as a hub instead).
  const balances = poolBalances(tx);

  const entering = balances.filter((b) => b.zat > 0);
  const leaving = balances.filter((b) => b.zat < 0);
  if (entering.length !== 1 || leaving.length === 0) return null;

  const destination = entering[0]!;
  return {
    fromPools: leaving.map((b) => b.pool),
    toPool: destination.pool,
    amountZat: destination.zat,
  };
}

/**
 * Every value pool the chain tracks — the six that together hold every ZEC in existence.
 *
 * Wider than `PoolName` (the shielded four): `transparent` and `lockbox` do not belong in "which
 * cryptography carried this", but a supply accounting does not add up without them.
 */
export const VALUE_POOL_NAMES = [...POOL_NAMES, "transparent", "lockbox"] as const;

/** Derived from `VALUE_POOL_NAMES`, the same way `PoolName` is, so the two cannot drift. */
export type ValuePoolName = (typeof VALUE_POOL_NAMES)[number];

export interface ValuePoolBalance {
  pool: ValuePoolName;
  balanceZat: number;
}

/** Zcash's consensus maximum: 21,000,000 ZEC. A constant, not a measurement. */
export const MAX_SUPPLY_ZAT = 21_000_000 * ZATS_PER_ZEC;

export interface SupplyBreakdown {
  pools: ValuePoolBalance[];
  /** Height the balances were read at, so the figures can be checked against a block. */
  height: number;
}

const SHIELDED: ValuePoolName[] = [...POOL_NAMES];

/** Every ZEC mined so far: the six pools partition it, so their sum is the supply. */
export function minedZat(s: SupplyBreakdown): number {
  return s.pools.reduce((sum, p) => sum + p.balanceZat, 0);
}

/** ZEC that will exist but does not yet. Never negative, even if a pool reads oddly. */
export function unminedZat(s: SupplyBreakdown): number {
  return Math.max(0, MAX_SUPPLY_ZAT - minedZat(s));
}

/**
 * ZEC sitting in a shielded pool.
 *
 * The lockbox is excluded: it holds deferred block subsidy that nobody chose to shield.
 */
export function shieldedZat(s: SupplyBreakdown): number {
  return s.pools.filter((p) => SHIELDED.includes(p.pool)).reduce((sum, p) => sum + p.balanceZat, 0);
}

/**
 * Circulating ZEC: every mined coin except the NU6 lockbox.
 *
 * Same definition as `ChainInfo.circulatingSupplyZat` and `/v1/supply/circulating`, expressed
 * over one `SupplyBreakdown` so a share's numerator and denominator come from one read at one
 * height.
 */
export function circulatingZat(s: SupplyBreakdown): number {
  const lockbox = s.pools.find((p) => p.pool === "lockbox")?.balanceZat ?? 0;
  return minedZat(s) - lockbox;
}

/**
 * Whether a shielded pool's proofs rest on a trusted setup.
 *
 * Sprout (BCTV14, then Groth16) and Sapling (Groth16) use parameters from multi-party
 * ceremonies; Orchard and Ironwood prove with Halo 2, which needs none (protocol specification
 * §5.4.10.3). A `Record` over `PoolName`, so a new pool fails to compile until it is classified.
 */
export const POOL_NEEDS_TRUSTED_SETUP: Record<PoolName, boolean> = {
  ironwood: false,
  orchard: false,
  sapling: true,
  sprout: true,
};

/** Shielded ZEC held in pools whose proofs need no trusted setup. */
export function setupFreeShieldedZat(s: SupplyBreakdown): number {
  return s.pools
    .filter((p) => isPoolName(p.pool) && !POOL_NEEDS_TRUSTED_SETUP[p.pool])
    .reduce((sum, p) => sum + p.balanceZat, 0);
}

function isPoolName(pool: ValuePoolName): pool is PoolName {
  return isOneOf(POOL_NAMES, pool);
}

/**
 * The share of circulating ZEC that sits in a shielded pool — the site's headline figure.
 *
 * The denominator is circulating supply, not mined: the lockbox is unspendable deferred subsidy.
 * One function shared by `ShieldedPage` and the agent so the headline is computed one way.
 *
 * Null rather than zero when there is nothing to divide by.
 */
export function shieldedShareOfCirculatingPct(
  shieldedZatTotal: number,
  circulatingZat: number,
): number | null {
  if (!Number.isFinite(circulatingZat) || circulatingZat <= 0) return null;
  return (shieldedZatTotal / circulatingZat) * 100;
}
