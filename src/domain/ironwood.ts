/**
 * What is in Ironwood, the fourth shielded pool (NU6.3, active at height 3,428,143), and where
 * it came from.
 *
 * Not framed as "the turnstile": much of the pool migrated from Orchard, but a meaningful slice
 * arrived straight from transparent, which is new shielding rather than relocated value.
 *
 * This is the pool's current balance broken down, not its gross deposits. Each source term is
 * the net of that counterparty's own declared value balance across every transaction touching
 * Ironwood, so the parts sum to the whole: summing every transaction's Ironwood value balance
 * reproduces the node's pool balance to the zatoshi. Where one transaction draws on two pools,
 * each pool's own movement is summed separately; nothing is apportioned. A ZIP-213 shielded
 * coinbase mines value straight into the pool and gets its own term.
 *
 * Fees are a term and are not burned: a fee paid from Ironwood goes to the miner's coinbase
 * (from NU7, ZIP 235 moves 60% of it into the NSM balance, still not destroyed). Carrying it
 * explicitly lets the sources reconcile to the balance exactly.
 */

import type { PoolName } from "./pool";

/** Where Ironwood's current balance came from, and how much. All figures in zatoshi. */
export interface IronwoodInflow {
  /** The height NU6.3 activated. Every figure here is measured from it, never backdated. */
  activationHeight: number;
  /**
   * The pool's balance now: the sum of every transaction's own Ironwood value balance, which
   * reproduces the node's figure exactly. The source terms below account for it.
   */
  balanceZat: number;
  /** Net from Orchard: what Orchard released into Ironwood, minus what Ironwood sent back. */
  netFromOrchardZat: number;
  /** Net from Sapling. */
  netFromSaplingZat: number;
  /**
   * Net from Sprout. Zero so far, but carried as its own field: folded into a neighbour, a
   * future non-zero value would still sum correctly while being attributed to the wrong pool.
   */
  netFromSproutZat: number;
  /**
   * Net shielded from transparent, minus whatever was unshielded back out. New shielding
   * rather than a migration.
   */
  netFromTransparentZat: number;
  /** How many transactions shielded into Ironwood from transparent. */
  fromTransparentTxCount: number;
  /**
   * How many transactions carry an Ironwood bundle at all, since activation.
   *
   * Counted on `ironwood_actions > 0`, a wider population than the attribution terms above,
   * which key on a non-zero `ironwood_value_balance_zat` (value crossing the pool boundary). A
   * fully shielded Ironwood-to-Ironwood transfer used the pool without crossing it.
   */
  txCount: number;
  /**
   * Newly issued ZEC mined straight into the pool by a ZIP-213 shielded coinbase. Its own term
   * because it is neither a migration nor a shielding; without it the sources do not reconcile.
   */
  minedZat: number;
  /**
   * Fees paid by transactions spending from Ironwood, which left for a miner's coinbase.
   * Carried explicitly so the source terms reconcile instead of absorbing it.
   */
  feesPaidZat: number;
  /** Hourly balance since activation. Hourly because the window is days, not years. */
  balance: IronwoodBalancePoint[];
  /**
   * Pool-migration counts, amounts and dollar values, per trailing window.
   *
   * A migration is `poolMigration`'s definition in SQL: no transparent side
   * (`kind = 'shielded'`), exactly one pool gaining, at least one losing. The trailing windows
   * cover every destination pool (a cheap timestamp range on `tx_keyset_idx`); only
   * `sinceActivation` is Ironwood-only, since an all-time matrix for other pools is an
   * unbounded scan.
   *
   * A count over a window is a flow, so windowing it is valid; the `balance` series is a level
   * and is never summed. Optional because older APIs omit it.
   */
  migrations?: IronwoodMigrations;
}

/**
 * One source bucket of migrations into Ironwood. Buckets are disjoint (single-source Orchard,
 * Sapling, Sprout, and multi-source) and sum to the window's totals. A multi-source
 * migration's amount is the destination's published balance, never split between sources.
 */
export interface IronwoodMigrationBucket {
  txCount: number;
  /** Sum of the destination (Ironwood) value balances — public by construction. */
  amountZat: number;
  /**
   * This bucket's amount in dollars, on the same bases as its window's total (each transaction
   * at its own day's stored close, today's at the live price). Null when nothing in the bucket
   * could be priced, never $0.
   */
  valueUsdText: string | null;
}

/** Migration totals over one period. The buckets sum to `txCount` / `amountZat` exactly. */
export interface IronwoodMigrationTotals {
  txCount: number;
  amountZat: number;
  /**
   * The amount in dollars, as a finished string. Each transaction is priced at its own day's
   * stored close; today's (no close yet) at the live tracked price, and the text names both
   * bases. Null when nothing could be priced, never $0.
   */
  valueUsdText: string | null;
  fromOrchard: IronwoodMigrationBucket;
  fromSapling: IronwoodMigrationBucket;
  /** Zero so far, carried anyway so a future value is attributed to the right pool. */
  fromSprout: IronwoodMigrationBucket;
  /** More than one pool losing in one transaction. Counted whole, never apportioned. */
  multiSource: IronwoodMigrationBucket;
}

/**
 * One directed migration flow inside a trailing window: value that left `from` and arrived
 * in `to`, with the amount being the DESTINATION pool's own published balance. `from` is
 * "multi" when more than one pool lost value in the same transaction — counted whole, never
 * apportioned between its sources.
 */
export interface PoolMigrationPair {
  from: PoolName | "multi";
  to: PoolName;
  txCount: number;
  amountZat: number;
  /** Finished dollar string for this pair, same bases as the window's. Null when unpriced. */
  valueUsdText: string | null;
}

/**
 * All pool-to-pool migrations inside one trailing window, every destination included.
 * `pairs` lists only observed flows; an absent pair is a measured zero. The totals sum the
 * pairs exactly.
 */
export interface PoolMigrationWindow {
  /** Unix seconds — the window's inclusive lower edge, anchored on the server's clock. */
  fromTimestamp: number;
  txCount: number;
  amountZat: number;
  valueUsdText: string | null;
  pairs: PoolMigrationPair[];
}

export interface IronwoodMigrations {
  /** Into Ironwood only — the one all-time range that is cheaply indexed. */
  sinceActivation: IronwoodMigrationTotals;
  last24Hours: PoolMigrationWindow;
  last7Days: PoolMigrationWindow;
  last30Days: PoolMigrationWindow;
}

export interface IronwoodBalancePoint {
  /** Unix seconds at the top of the hour. */
  timestamp: number;
  /** The pool's balance at that hour's highest block — a closing value, never an average. */
  ironwoodZat: number;
}

/**
 * The share of the pool's balance that is new shielding rather than value relocated from
 * another shielded pool. `null` when the pool is empty: "0% of nothing" is not a measurement.
 */
export function freshShieldingPct(inflow: IronwoodInflow): number | null {
  if (inflow.balanceZat <= 0) return null;
  return Math.round((inflow.netFromTransparentZat / inflow.balanceZat) * 1000) / 10;
}

/** One source term as a share of the pool's balance. */
export interface IronwoodSourceShare {
  /** Which source, in the vocabulary the pages use. */
  source: "orchard" | "sapling" | "sprout" | "transparent" | "mined";
  zat: number;
  /** Percent of the pool's current balance, to one decimal. */
  pct: number;
}

/**
 * Every source term as a share of the pool's balance, each with the figure it came from, so
 * consumers never divide for themselves.
 *
 * Signs are preserved: `netFrom*` is a net, and a negative share is an outflow. `null` when the
 * balance is not positive.
 */
export function ironwoodSourceShares(inflow: IronwoodInflow): IronwoodSourceShare[] | null {
  if (inflow.balanceZat <= 0) return null;
  const share = (zat: number) => Math.round((zat / inflow.balanceZat) * 1000) / 10;
  return [
    { source: "orchard", zat: inflow.netFromOrchardZat, pct: share(inflow.netFromOrchardZat) },
    { source: "sapling", zat: inflow.netFromSaplingZat, pct: share(inflow.netFromSaplingZat) },
    { source: "sprout", zat: inflow.netFromSproutZat, pct: share(inflow.netFromSproutZat) },
    {
      source: "transparent",
      zat: inflow.netFromTransparentZat,
      pct: share(inflow.netFromTransparentZat),
    },
    { source: "mined", zat: inflow.minedZat, pct: share(inflow.minedZat) },
  ];
}

/**
 * Balance that came from another shielded pool. Summed from its parts rather than derived as
 * `balance − transparent`, which would silently absorb any future source.
 */
export function migratedZat(inflow: IronwoodInflow): number {
  return inflow.netFromOrchardZat + inflow.netFromSaplingZat + inflow.netFromSproutZat;
}

/**
 * What the source terms leave unaccounted for, in zatoshi. Zero by construction; computed so a
 * change that breaks the identity becomes visible.
 */
export function ironwoodResidualZat(inflow: IronwoodInflow): number {
  return (
    inflow.balanceZat -
    (migratedZat(inflow) + inflow.netFromTransparentZat + inflow.minedZat - inflow.feesPaidZat)
  );
}
