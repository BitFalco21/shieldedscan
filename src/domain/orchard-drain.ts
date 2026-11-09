/**
 * How far Orchard has emptied into Ironwood since NU6.3 opened it at height 3,428,143.
 *
 * Two figures per UTC day, both public: the ZEC that migrated from Orchard into Ironwood (the
 * migration rule `/v1/analytics/migrations` and the pool-migration chart apply: no transparent
 * side, exactly one pool gaining, the amount Ironwood's own published value balance), and what
 * Orchard still holds at the day's last block.
 *
 * The share's denominator is fixed and stated: Orchard's balance at the block before activation,
 * the last block at which nothing could yet have crossed. Its numerator is everything that has
 * crossed through that day, as Ironwood received it (fees are paid on the way, so Orchard's own
 * drop is a little larger). A migration drawing on two or more pools at once, which need not
 * include Orchard, is counted
 * apart, never apportioned, and is never in the share. Orchard also shrinks by unshielding, fees
 * and migrations into other pools, so migrated plus remaining is not the base.
 */

export interface OrchardDrainDay {
  /** Unix seconds at the start of the UTC day. */
  timestamp: number;
  /** The day's last block. */
  closeHeight: number;
  /** Orchard's balance at `closeHeight`. Null where the node did not report it. */
  orchardZat: number | null;
  /** ZEC that migrated from Orchard alone into Ironwood that day: a measured zero on a quiet day. */
  migratedZat: number;
  /** Migrations into Ironwood that day drawing on two or more pools at once. */
  multiSourceZat: number;
}

export interface OrchardDrain {
  activationHeight: number;
  /** The block before activation, where the denominator is read. */
  baseHeight: number;
  /** Orchard's balance at `baseHeight`; null until the index holds that block's pools. */
  baseOrchardZat: number | null;
  /** Every complete UTC day from activation's, oldest first. */
  days: OrchardDrainDay[];
}

/** One day of the drain, with everything that crossed through it. */
export interface OrchardDrainPoint extends OrchardDrainDay {
  /** Orchard-alone migrations into Ironwood from activation through this day. */
  cumulativeZat: number;
  cumulativeMultiSourceZat: number;
  /** `cumulativeZat` as a percent of `baseOrchardZat`; null when there is no base. */
  sharePct: number | null;
}

/** A share in percent to the hundredth of a point, null over nothing. */
const pct = (part: number, whole: number | null) =>
  whole === null || whole <= 0 ? null : Math.round((10_000 * part) / whole) / 100;

/** The drain day by day, with running totals and the share crossed so far. */
export function orchardDrainSeries(drain: OrchardDrain): OrchardDrainPoint[] {
  let cumulative = 0;
  let multi = 0;
  return drain.days.map((d) => {
    cumulative += d.migratedZat;
    multi += d.multiSourceZat;
    return {
      ...d,
      cumulativeZat: cumulative,
      cumulativeMultiSourceZat: multi,
      sharePct: pct(cumulative, drain.baseOrchardZat),
    };
  });
}

/** The drain at its newest complete day; null before one exists. */
export function orchardDrainLatest(drain: OrchardDrain): OrchardDrainPoint | null {
  return orchardDrainSeries(drain).at(-1) ?? null;
}
