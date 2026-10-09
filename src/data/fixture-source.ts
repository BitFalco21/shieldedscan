import { blockSummaryOf } from "@/domain";
import * as fixtures from "@/fixtures";
import * as chartSeries from "@/fixtures/chart-series";
import type { ExplorerDataSource } from "./source";

/** The fixture source: typed static data, resolved immediately. */
export const fixtureDataSource: ExplorerDataSource = {
  async getChainInfo() {
    return fixtures.getChainInfo();
  },
  async getPools() {
    return fixtures.getPools();
  },
  async getSupplyBreakdown() {
    return fixtures.getSupplyBreakdown();
  },
  async getSupplySeries() {
    return fixtures.getSupplySeries();
  },
  async getPoolUsageSeries() {
    return fixtures.getPoolUsageSeries();
  },
  async getPoolMigrationSeries() {
    return fixtures.getPoolMigrationSeries();
  },
  async getStats() {
    return fixtures.getStats();
  },
  async getPriceSeries() {
    return fixtures.getPriceSeries();
  },
  async listLatestBlocks(count) {
    return fixtures.listLatestBlocks(count).map(blockSummaryOf);
  },
  async listBlocks(query) {
    const page = fixtures.listBlocks(query);
    return { ...page, items: page.items.map(blockSummaryOf) };
  },
  async getBlock(idOrHeight) {
    return fixtures.getBlock(idOrHeight);
  },
  async getBlockTransactions(block) {
    return fixtures.getBlockTransactions(block);
  },
  async getOldestHeight() {
    return fixtures.getOldestHeight();
  },
  async listLatestTransactions(count) {
    return fixtures.listLatestTransactions(count);
  },
  async listTransactions(query, kind) {
    return fixtures.listTransactions(query, kind);
  },
  async getTransaction(txid) {
    return fixtures.getTransaction(txid);
  },
  async getAddress(address) {
    return fixtures.getAddress(address);
  },
  async getAddressTransactions(address, query) {
    return fixtures.getAddressTransactions(address, query);
  },
  async listCrossChainTransfers(query, filters = {}) {
    return fixtures.listCrossChainTransfers(query, filters);
  },
  async getCrossChainFlows(windowDays = null) {
    return fixtures.getCrossChainFlows(windowDays);
  },
  async getCrossChainProtocols(windowDays = null) {
    return fixtures.getCrossChainProtocols(windowDays);
  },
  async getCrossChainChains() {
    // Always all-time: a menu lists which chains exist, and narrowing it by the flows tab's
    // window would hide a chain from the list filter because it was quiet last month.
    return fixtures.getCrossChainFlows().flows;
  },
  async getCrossChainTransfer(id) {
    return fixtures.getCrossChainTransfer(id);
  },
  async listCrossChainTransfersForZcashTx(txid) {
    return fixtures.listCrossChainTransfersForZcashTx(txid);
  },
  async getMiningOverview(window) {
    return fixtures.getMiningOverview(window);
  },
  async getActivitySeries() {
    return fixtures.getActivitySeries();
  },
  async getFees24h() {
    return fixtures.getFees24h();
  },
  async getIronwoodInflow() {
    return fixtures.getIronwoodInflow();
  },
  async getShieldingFlow() {
    return fixtures.getShieldingFlow();
  },
  async getFeeDistribution() {
    return fixtures.getFeeDistribution();
  },
  async getTxCounts() {
    return fixtures.getTxCounts();
  },
  async getDailyPriceMap() {
    return fixtures.getDailyPriceMap();
  },
  async getNetworkDaily() {
    return fixtures.getNetworkDaily();
  },
  async countCrossChainTransfers(filters) {
    return fixtures.countCrossChainTransfers(filters);
  },
  async getCrossChainVolume() {
    return fixtures.getCrossChainVolume();
  },
  async getMonthlySeries() {
    return fixtures.getMonthlySeries();
  },
  async getDailySeries() {
    return fixtures.getDailySeries();
  },
  async getShieldingFlowDaily() {
    return fixtures.getShieldingFlowDaily();
  },
  async getFeeKindsDaily() {
    return fixtures.getFeeKindsDaily();
  },
  async getFeeTotals() {
    return fixtures.getFeeTotals();
  },
  async getCrossChainVolumeSeries() {
    return fixtures.getCrossChainVolumeSeries();
  },
  async getChainInflow() {
    return chartSeries.getChainInflow();
  },
  async getNoteTrees() {
    return chartSeries.getNoteTrees();
  },
  async getTransparentDays() {
    return chartSeries.getTransparentDays();
  },
  async getMinerShares() {
    return chartSeries.getMinerShares();
  },
  async getBlocksDaily() {
    return chartSeries.getBlocksDaily();
  },
  async getSupplyDays() {
    return chartSeries.getSupplyDays();
  },
  async getChainOutflow() {
    return chartSeries.getChainOutflow();
  },
  async getVenueMonths() {
    return chartSeries.getVenueMonths();
  },
  async getInflowKinds() {
    return chartSeries.getInflowKinds();
  },
  async getReorgWeeks() {
    return chartSeries.getReorgWeeks();
  },
  async listMempool(page, pageSize) {
    const { entries, totalPages } = fixtures.listMempool(page, pageSize);
    return { items: entries, totalPages };
  },
  async getMempoolStats() {
    return fixtures.getMempoolStats();
  },
  async listReorgEvents(query) {
    return fixtures.listReorgEvents(query);
  },
  async getReorgSummary() {
    return fixtures.getReorgSummary();
  },
  async getMarketSnapshot() {
    return fixtures.getMarketSnapshot();
  },
  async getZipIndex() {
    return fixtures.getZipIndex();
  },
  async getZnsName(name) {
    return fixtures.getZnsName(name);
  },
  async getHalvingSchedule() {
    return fixtures.getHalvingSchedule();
  },
  async getMiningTerms() {
    return fixtures.getMiningTerms();
  },
  async listRichList(query) {
    return fixtures.listRichList(query);
  },
  async getRichListSummary() {
    return fixtures.getRichListSummary();
  },
  async getPulseFrame() {
    return fixtures.getPulseFrame();
  },
  async getPulsePending() {
    return fixtures.getPulsePending();
  },
  async getPulseWindow(fromSeconds, toSeconds) {
    return fixtures.getPulseWindow(fromSeconds, toSeconds);
  },
  async getPulseRibbons() {
    return fixtures.getPulseRibbons();
  },
  async getNetworkSummary() {
    return fixtures.getNetworkSummary();
  },
  async getNetworkMap() {
    return fixtures.getNetworkMap();
  },
  async getNetworkTopology(scope) {
    return fixtures.getNetworkTopology(scope);
  },
  async getNetworkHealth() {
    return fixtures.getNetworkHealth();
  },
  async listNetworkNodes(query, filters) {
    return fixtures.listNetworkNodes(query, filters);
  },
  async getNetworkCrawls() {
    return fixtures.getNetworkCrawls();
  },
  async getNetworkPeers() {
    return fixtures.getNetworkPeers();
  },
  async getNetworkReleases() {
    return fixtures.getNetworkReleases();
  },
  async readSocialPost(kind, key) {
    return fixtures.getSocialPost(kind, key);
  },
};
