/**
 * The windowed analytics' wire types.
 *
 * Imports NOTHING, for the reason `server/v1/dto.ts` does: a contract a third party codes
 * against must not change because a domain type was renamed. `map.ts` is the one place domain
 * values become these shapes.
 *
 * Conventions every shape here follows (the reference is `/api-docs`):
 * every ZEC amount travels as an integer `…Zat` beside an exact decimal-string `…Zec`; fiat is a
 * decimal string valued at each day's own close; no key is ever omitted, and a null that needs
 * explaining carries its reason in `unknowns`.
 */

export type AnalyticsInterval = "none" | "day" | "month";
export type AnalyticsPool = "sprout" | "sapling" | "orchard" | "ironwood";
export type AnalyticsCoverageStatus = "complete" | "partial" | "floor";

export interface AnalyticsWindow {
  from: string;
  to: string;
  /** Always true: `to` is the first day NOT included. */
  toExclusive: true;
  fromTimestamp: number;
  toTimestamp: number;
  /** First and last block inside the window; null when the window holds no block. */
  fromHeight: number | null;
  toHeight: number | null;
}

export interface AnalyticsEnvelope<Q, D> {
  /** The parameters as applied, after normalisation. */
  query: Q;
  window: AnalyticsWindow;
  indexed: { height: number; timestamp: number; time: string };
  coverage: { status: AnalyticsCoverageStatus; notes: string[] };
  source: { name: "ShieldedScan"; url: string };
  asOf: number;
  data: D;
  unknowns: Record<string, "shielded" | "unmeasured" | "nonexistent" | "indeterminate">;
}

export interface AnalyticsAmount {
  amountZat: number;
  amountZec: string;
}

export interface AnalyticsShare {
  pct: number | null;
  numerator: number;
  denominator: number;
}

// ----------------------------------------------------------------------------- /activity

export interface ActivityQuery {
  from: string;
  to: string;
  interval: AnalyticsInterval;
  minZec: string | null;
  minFiat: string | null;
  currency: string;
}

export interface ActivityBucket {
  /** First UTC day of the bucket. Absent on the window totals. */
  periodStart?: string;
  blocks: number;
  transactions: {
    total: number;
    byKind: { transparent: number; mixed: number; fullyShielded: number };
    mixedByDirection: { shielding: number; unshielding: number; indeterminate: number };
    byPool: {
      sprout: number;
      sapling: number;
      orchard: number;
      ironwood: number;
      /** Window totals only, and null above the exact-count range (see `unknowns`). */
      transparentOnly?: number | null;
    };
  };
  fullyShieldedShare: AnalyticsShare;
  fees: { feeZat: number; feeZec: string; blocksCovered: number; blocks: number };
  /** Present only when a value floor was asked for. */
  overFloor?: { shielding: number; unshielding: number; priced: number; considered: number };
}

export interface ActivityData {
  interval: AnalyticsInterval;
  totals: ActivityBucket;
  buckets: ActivityBucket[];
}

// ------------------------------------------------------------------------ /shielding-flow

export interface ShieldingFlowQuery {
  from: string;
  to: string;
  interval: AnalyticsInterval;
  pool: AnalyticsPool[];
}

export interface PoolFlow {
  shielded: AnalyticsAmount & { txs: number };
  unshielded: AnalyticsAmount & { txs: number };
  netZat: number;
  netZec: string;
  coinbase: AnalyticsAmount & { txs: number };
}

export interface ShieldingFlowBucket {
  periodStart?: string;
  pools: Partial<Record<AnalyticsPool, PoolFlow>>;
  unattributed: { txs: number; magnitudeZat: number; magnitudeZec: string };
}

export interface ShieldingFlowData {
  interval: AnalyticsInterval;
  totals: ShieldingFlowBucket;
  buckets: ShieldingFlowBucket[];
}

// ---------------------------------------------------------------------------- /migrations

export interface MigrationsQuery {
  from: string;
  to: string;
  interval: AnalyticsInterval;
  source: string | null;
  destination: string | null;
  currency: string;
}

export interface MigrationCell extends AnalyticsAmount {
  source: string;
  destination: string;
  txs: number;
  value: { currency: string; amount: string | null; pricedTxs: number };
}

export interface MigrationsData {
  interval: AnalyticsInterval;
  totals: MigrationCell[];
  buckets: { periodStart: string; cells: MigrationCell[] }[];
}

// ---------------------------------------------------------------------------- /crosschain

export type CrossChainGroupKey = "none" | "chain" | "protocol" | "day" | "month";

export interface CrossChainQuery {
  from: string;
  to: string;
  groupBy: CrossChainGroupKey;
  direction: "in" | "out" | null;
  chain: string[];
  protocol: string | null;
  minZec: string | null;
  minUsd: string | null;
}

export interface CrossChainSide extends AnalyticsAmount {
  transfers: number;
  usdAtSwap: string;
  usdPricedTransfers: number;
}

export interface CrossChainData {
  groupBy: CrossChainGroupKey;
  totals: { in: CrossChainSide; out: CrossChainSide };
  groups: { key: string; in: CrossChainSide; out: CrossChainSide }[];
}
