import type { ExplorerDataSource } from "@/data/source";
import { nullIfTransient } from "@/lib/transient-upstream";
import type { ChartData } from "@/features/charts/chart-data";
import type { ChartSlug } from "@/features/charts/catalog";

/** Which series each chart needs — the loader fetches only these for a detail page. */
const NEEDS: Record<ChartSlug, (keyof ChartData)[]> = {
  "transactions-by-kind": ["months", "days"],
  "pool-balances": ["months", "days"],
  "pool-usage": ["poolUsage"],
  "pool-migrations": ["poolMigrations"],
  "shielding-flow": ["flow", "flowDays"],
  "median-fee": ["fees", "feesDaily"],
  "shielded-supply": ["supply"],
  "ironwood-balance": ["ironwood"],
  price: ["prices"],
  difficulty: ["network"],
  "block-size": ["network"],
  "fee-totals": ["feeTotals"],
  "crosschain-volume": ["crosschainVolume"],
};

/**
 * Load the series a set of charts needs, each guarded independently.
 *
 * The /analytics rule applies here per chart rather than per page: a transient failure
 * yields null and that chart renders "unavailable" while its neighbours stay real; a shape
 * error still throws, so the version-skew tripwire keeps failing builds instead of hiding
 * a missing API deploy behind a wall of unavailable panels.
 */
export async function loadChartData(
  data: ExplorerDataSource,
  slugs: readonly ChartSlug[],
): Promise<ChartData> {
  const wanted = new Set(slugs.flatMap((s) => NEEDS[s]));
  const guard = nullIfTransient;
  const [
    months,
    flow,
    fees,
    supply,
    poolUsage,
    poolMigrations,
    ironwood,
    network,
    prices,
    days,
    flowDays,
    feesDaily,
    feeTotals,
    crosschainVolume,
  ] = await Promise.all([
    wanted.has("months") ? guard(() => data.getMonthlySeries()) : null,
    wanted.has("flow") ? guard(() => data.getShieldingFlow()) : null,
    wanted.has("fees") ? guard(() => data.getFeeDistribution()) : null,
    wanted.has("supply") ? guard(() => data.getSupplySeries()) : null,
    wanted.has("poolUsage") ? guard(() => data.getPoolUsageSeries()) : null,
    wanted.has("poolMigrations") ? guard(() => data.getPoolMigrationSeries()) : null,
    wanted.has("ironwood") ? guard(() => data.getIronwoodInflow()) : null,
    wanted.has("network") ? guard(() => data.getNetworkDaily()) : null,
    wanted.has("prices") ? guard(() => data.getDailyPriceMap()) : null,
    wanted.has("days") ? guard(() => data.getDailySeries()) : null,
    wanted.has("flowDays") ? guard(() => data.getShieldingFlowDaily()) : null,
    wanted.has("feesDaily") ? guard(() => data.getFeeKindsDaily()) : null,
    wanted.has("feeTotals") ? guard(() => data.getFeeTotals()) : null,
    wanted.has("crosschainVolume") ? guard(() => data.getCrossChainVolumeSeries()) : null,
  ]);
  return {
    months,
    flow,
    fees,
    supply,
    poolUsage,
    poolMigrations,
    ironwood,
    network,
    prices,
    days,
    flowDays,
    feesDaily,
    feeTotals,
    crosschainVolume,
  };
}
