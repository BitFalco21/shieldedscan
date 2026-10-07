import type { PoolName } from "@/domain";
import { sinceFirstValue } from "@/domain";
import type { MultiLineSeries } from "@/components/MultiLineChart";
import type { AreaSeries } from "@/components/StackedAreaChart";
import { capitalise } from "@/lib/format";
import { POOL_CLASSES } from "@/lib/pool-palette";

/** The pools in stacking order, oldest at the bottom, each in its site-wide colour. */
export const POOL_STACK: readonly PoolName[] = ["sprout", "sapling", "orchard", "ironwood"];

/**
 * One band per pool for `StackedAreaChart`. `sinceFirstValue` keeps a pool out of the hover
 * readout until it first held value, rather than reporting "0.00 ZEC" for a pool that did not
 * exist yet; it is a no-op for a pool that held value from the first point.
 */
export function poolBands(values: Record<PoolName, number[]>): AreaSeries[] {
  return POOL_STACK.map((pool) => ({
    key: pool,
    label: capitalise(pool),
    colorClass: POOL_CLASSES[pool],
    values: sinceFirstValue(values[pool]),
  }));
}

/** One line per pool for `MultiLineChart`, on the same rule as `poolBands`. */
export function poolLines(values: Record<PoolName, number[]>): MultiLineSeries[] {
  return POOL_STACK.map((pool) => ({
    name: capitalise(pool),
    values: sinceFirstValue(values[pool]),
    className: POOL_CLASSES[pool],
    omitNullFromReadout: true,
  }));
}
