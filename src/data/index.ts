import { readApiConfig } from "./api-request";
import { createChainApiSource } from "./chain-api-source";
import { createCrossChainApiSource } from "./crosschain-api-source";
import { fixtureDataSource } from "./fixture-source";
import type { ExplorerDataSource } from "./source";
import { isPublicStage } from "@/lib/site";

export type { CursorPage, CursorQuery, ExplorerDataSource, Paginated } from "./source";
export { ORIGIN_CURSOR } from "./cursor";

/**
 * Refuses to build a public deployment that would serve fixtures.
 *
 * The fixture fallback below is right for local work and previews. In production it would
 * let a dropped environment variable produce a green build in which every page shows
 * hand-written sample data as the chain, with nothing on screen to say so. Throwing turns
 * that into a red build. Only `NEXT_PUBLIC_STAGE=public` is affected.
 *
 * Both adapters talk to one API through one `readApiConfig`, so there is one pair of names to
 * check and print.
 */
function assertLiveSourcesConfigured(configured: boolean): void {
  if (!isPublicStage || configured) return;
  throw new Error(
    "Refusing to build the public site on fixtures: CROSSCHAIN_API_URL and/or " +
      "EXPLORER_API_TOKEN are not set, so every page would serve hand-written sample data " +
      "as if it were the chain. Set both, or drop NEXT_PUBLIC_STAGE=public if this " +
      "deployment is meant to be a preview.",
  );
}

/**
 * The data source for this deployment: the live API when it is configured, fixtures otherwise.
 * Routes never learn which they got — that is the point of the port.
 *
 * The live source lists every port method explicitly, with no fixture spread underneath, so a
 * method added to `ExplorerDataSource` and not wired here fails to compile instead of quietly
 * serving sample data in production.
 */
function build(tipRevalidateSeconds?: number): ExplorerDataSource {
  const config = readApiConfig();
  assertLiveSourcesConfigured(config !== null);
  if (config === null) return fixtureDataSource;

  const crossChain = createCrossChainApiSource({
    ...config,
    revalidateSeconds: tipRevalidateSeconds,
  });
  const chain = createChainApiSource({ ...config, tipRevalidateSeconds });
  return {
    listCrossChainTransfers: (query, filters) => crossChain.listCrossChainTransfers(query, filters),
    getCrossChainTransfer: (id) => crossChain.getCrossChainTransfer(id),
    listCrossChainTransfersForZcashTx: (txid) => crossChain.listCrossChainTransfersForZcashTx(txid),
    getCrossChainFlows: (windowDays) => crossChain.getCrossChainFlows(windowDays),
    getCrossChainChains: () => crossChain.getCrossChainChains(),
    getCrossChainProtocols: (windowDays) => crossChain.getCrossChainProtocols(windowDays),
    countCrossChainTransfers: (filters) => crossChain.countCrossChainTransfers(filters),
    getCrossChainVolume: () => crossChain.getCrossChainVolume(),
    getCrossChainVolumeSeries: () => crossChain.getCrossChainVolumeSeries(),
    getChainInflow: () => crossChain.getChainInflow(),
    getChainOutflow: () => crossChain.getChainOutflow(),
    getVenueMonths: () => crossChain.getVenueMonths(),
    getInflowKinds: () => crossChain.getInflowKinds(),

    getPools: () => chain.getPools(),
    getSupplyBreakdown: () => chain.getSupplyBreakdown(),
    getOldestHeight: () => chain.getOldestHeight(),
    listLatestBlocks: (count) => chain.listLatestBlocks(count),
    listBlocks: (query) => chain.listBlocks(query),
    getBlock: (idOrHeight) => chain.getBlock(idOrHeight),
    getBlockTransactions: (block) => chain.getBlockTransactions(block),
    listLatestTransactions: (count) => chain.listLatestTransactions(count),
    listTransactions: (query, kind) => chain.listTransactions(query, kind),
    getTransaction: (txid) => chain.getTransaction(txid),
    getAddress: (address) => chain.getAddress(address),
    getAddressTransactions: (address, query) => chain.getAddressTransactions(address, query),
    listMempool: (page, pageSize) => chain.listMempool(page, pageSize),
    listReorgEvents: (query) => chain.listReorgEvents(query),
    getReorgSummary: () => chain.getReorgSummary(),
    getMempoolStats: () => chain.getMempoolStats(),
    getActivitySeries: () => chain.getActivitySeries(),
    getFees24h: () => chain.getFees24h(),
    getIronwoodInflow: () => chain.getIronwoodInflow(),
    getShieldingFlow: () => chain.getShieldingFlow(),
    getFeeDistribution: () => chain.getFeeDistribution(),
    getTxCounts: () => chain.getTxCounts(),
    getDailyPriceMap: () => chain.getDailyPriceMap(),
    getNetworkDaily: () => chain.getNetworkDaily(),
    getNoteTrees: () => chain.getNoteTrees(),
    getTransparentDays: () => chain.getTransparentDays(),
    getMinerShares: () => chain.getMinerShares(),
    getReorgWeeks: () => chain.getReorgWeeks(),
    getBlocksDaily: () => chain.getBlocksDaily(),
    getSupplyDays: () => chain.getSupplyDays(),
    getMiningOverview: (window) => chain.getMiningOverview(window),
    getMonthlySeries: () => chain.getMonthlySeries(),
    getDailySeries: () => chain.getDailySeries(),
    getShieldingFlowDaily: () => chain.getShieldingFlowDaily(),
    getFeeKindsDaily: () => chain.getFeeKindsDaily(),
    getFeeTotals: () => chain.getFeeTotals(),
    getSupplySeries: () => chain.getSupplySeries(),
    getPoolUsageSeries: () => chain.getPoolUsageSeries(),
    getPoolMigrationSeries: () => chain.getPoolMigrationSeries(),
    getStats: () => chain.getStats(),
    getPriceSeries: () => chain.getPriceSeries(),
    getMarketSnapshot: () => chain.getMarketSnapshot(),
    getZipIndex: () => chain.getZipIndex(),
    getZnsName: (name) => chain.getZnsName(name),
    getHalvingSchedule: () => chain.getHalvingSchedule(),
    getMiningTerms: () => chain.getMiningTerms(),
    listRichList: (query) => chain.listRichList(query),
    getRichListSummary: () => chain.getRichListSummary(),
    readSocialPost: (kind, key) => chain.readSocialPost(kind, key),
    getPulseFrame: () => chain.getPulseFrame(),
    getPulsePending: () => chain.getPulsePending(),
    getPulseWindow: (fromSeconds, toSeconds) => chain.getPulseWindow(fromSeconds, toSeconds),
    getPulseRibbons: () => chain.getPulseRibbons(),
    getNetworkSummary: () => chain.getNetworkSummary(),
    getNetworkMap: () => chain.getNetworkMap(),
    getNetworkTopology: (scope) => chain.getNetworkTopology(scope),
    getNetworkHealth: () => chain.getNetworkHealth(),
    listNetworkNodes: (query, filters) => chain.listNetworkNodes(query, filters),
    getNetworkCrawls: () => chain.getNetworkCrawls(),
    getNetworkPeers: () => chain.getNetworkPeers(),
    getNetworkReleases: () => chain.getNetworkReleases(),

    /**
     * `ChainInfo` is the one deliberately mixed value in the source, mixed here so it stays
     * visible.
     *
     * Measured: height, best block hash, tip timestamp, circulating supply.
     * Measured while the API's trackers are warm, `null` otherwise: `priceUsd` and
     * `priceChange24hPct` from the price poller, `txCount24h` and `fullyShieldedPct24h` from
     * the 24h block tracker.
     *
     * Those four always arrive as explicit keys, so the spread always overrides the fixture.
     * Falling back to a fixture is fine for a missing page and wrong for a missing number: an
     * unavailable price is information, and inventing one discards it.
     *
     * Height must be overridden: it drives confirmation counts and every relative timestamp.
     */
    async getChainInfo() {
      const [facts, fallback] = await Promise.all([
        chain.getChainFacts(),
        fixtureDataSource.getChainInfo(),
      ]);
      return { ...fallback, ...facts };
    },
  };
}

/**
 * Built once per process: the config comes from the environment, which does not change
 * between requests.
 */
const dataSource: ExplorerDataSource = build();

export function getDataSource(): ExplorerDataSource {
  return dataSource;
}

/**
 * The tip window a prerendered page runs on, and the floor for its `export const
 * revalidate`.
 *
 * Next uses the minimum revalidate across every fetch in a route. The default source's tip
 * reads carry 15 s (right for detail pages, where confirmations are measured against the
 * tip), so a prerendered page reading through it would regenerate every 15 s whatever it
 * declared. Every such page has a live layer or prints the block it was read at, so 60 s
 * costs a reader nothing. `freshness-config.test.ts` pins that these pages use this source.
 */
export const PRERENDERED_REVALIDATE_SECONDS = 60;

const prerenderedDataSource: ExplorerDataSource = build(PRERENDERED_REVALIDATE_SECONDS);

/** The data source for a page that is prerendered with `revalidate = PRERENDERED_REVALIDATE_SECONDS`. */
export function getPrerenderedDataSource(): ExplorerDataSource {
  return prerenderedDataSource;
}
