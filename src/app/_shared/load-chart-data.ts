import type { ExplorerDataSource } from "@/data/source";
import { nowSeconds } from "@/lib/clock";
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
  "privacy-share": ["months", "days"],
  "anonymity-set": ["noteTrees"],
  "blocks-per-day": ["blocksDaily"],
  "transparent-activity": ["transparentDays"],
  "upgrade-readiness": ["releases"],
  "miner-concentration": ["minerShares"],
  reorgs: ["reorgWeeks"],
  "inflow-by-chain": ["chainInflow"],
  "outflow-by-chain": ["chainOutflow"],
  "volume-by-venue": ["venueMonths"],
  "shielded-capable-swaps": ["inflowKinds"],
  "shielded-share": ["supplyDays"],
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
    noteTrees,
    transparentDays,
    minerShares,
    reorgWeeks,
    chainInflow,
    chainOutflow,
    venueMonths,
    inflowKinds,
    supplyDays,
    blocksDaily,
    releases,
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
    wanted.has("noteTrees") ? guard(() => data.getNoteTrees()) : null,
    wanted.has("transparentDays") ? guard(() => data.getTransparentDays()) : null,
    wanted.has("minerShares") ? guard(() => data.getMinerShares()) : null,
    wanted.has("reorgWeeks") ? guard(() => data.getReorgWeeks()) : null,
    wanted.has("chainInflow") ? guard(() => data.getChainInflow()) : null,
    wanted.has("chainOutflow") ? guard(() => data.getChainOutflow()) : null,
    wanted.has("venueMonths") ? guard(() => data.getVenueMonths()) : null,
    wanted.has("inflowKinds") ? guard(() => data.getInflowKinds()) : null,
    wanted.has("supplyDays") ? guard(() => data.getSupplyDays()) : null,
    wanted.has("blocksDaily") ? guard(() => data.getBlocksDaily()) : null,
    wanted.has("releases") ? guard(() => data.getNetworkReleases()) : null,
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
    noteTrees,
    transparentDays,
    minerShares,
    reorgWeeks,
    chainInflow,
    chainOutflow,
    venueMonths,
    inflowKinds,
    supplyDays,
    blocksDaily,
    releases,
    asOf: nowSeconds(),
  };
}
