import { priceSeries, stats } from "./stats";
import type {
  PriceSeries,
  Stats,
  StatsRange,
  ActivityPoint,
  AddressInfo,
  Block,
  ChainInfo,
  ChainMonthPoint,
  FeeKindMonthPoint,
  FeeTotalPoint,
  FeeTotalSeries,
  CrossChainVolumePoint,
  CrossChainVolumeSeries,
  CrossChainFlowSummary,
  CrossChainProtocolSummary,
  CrossChainNarrowing,
  CrossChainVolume,
  NetworkDayPoint,
  CrossChainTransfer,
  ZcashTxCrossings,
  MempoolEntry,
  MempoolStats,
  ReorgEvent,
  ReorgSummary,
  ShieldedPool,
  PoolMigrationDayPoint,
  PoolUsageDayPoint,
  ShieldedSupplyPoint,
  SupplyBreakdown,
  ValuePoolName,
  Transaction,
  TxKindFilter,
  Fees24h,
  IronwoodInflow,
  ShieldingFlowPoint,
  FeeDistribution,
} from "@/domain";
import {
  buildProtocolSummary,
  aggregateFlowWindows,
  matchesCrossChainFilters,
  matchesTxKindFilter,
  txDirection,
  txKind,
} from "@/domain";
import { cursorSlice } from "../data/cursor";
import { activitySeries } from "./analytics";
import { addresses } from "./addresses";
import { blocks } from "./blocks";
import { chainInfo } from "./chain";
import { poolMigrationSeries, pools, poolUsageSeries, supplySeries } from "./pools";
import { crossChainById, crossChainTransfers } from "./crosschain";
import { mempoolEntries, mempoolStats, mempoolTransactions } from "./mempool";
import { reorgEvents, reorgSummary } from "./reorgs";
import { transactions, transactionsById } from "./transactions";
import { TIP_HEIGHT, TIP_TIME } from "./ids";
import { richListAddresses } from "./rich-list";
// Re-exported rather than wrapped: these already return the port's payload shapes, built
// from the same domain functions the API uses.
export { getPulseFrame, getPulsePending, getPulseRibbons, getPulseWindow } from "./pulse";
export {
  getNetworkCrawls,
  getNetworkHealth,
  getNetworkMap,
  getNetworkPeers,
  getNetworkReleases,
  getNetworkSummary,
  getNetworkTopology,
  listNetworkNodes,
} from "./netmap";

export function getChainInfo(): ChainInfo {
  return chainInfo;
}

export function getPools(): ShieldedPool[] {
  return pools;
}

/** Derived from the shielded pool fixtures, plus a plausible transparent side. */
export function getSupplyBreakdown(): SupplyBreakdown {
  return {
    height: TIP_HEIGHT,
    pools: [
      { pool: "transparent", balanceZat: 1_250_845_176_000_000 },
      { pool: "lockbox", balanceZat: 5_299_350_000_000 },
      ...pools.map((p) => ({ pool: p.pool as ValuePoolName, balanceZat: p.balanceZat })),
    ],
  };
}

export function getSupplySeries(): ShieldedSupplyPoint[] {
  return supplySeries;
}

export function getPoolUsageSeries(): PoolUsageDayPoint[] {
  return poolUsageSeries;
}

export function getPoolMigrationSeries(): PoolMigrationDayPoint[] {
  return poolMigrationSeries;
}

export function getStats(): Stats {
  return stats;
}

export function getPriceSeries(): Partial<Record<StatsRange, PriceSeries>> {
  return priceSeries;
}

export function listLatestBlocks(n: number): Block[] {
  return [...blocks].sort((a, b) => b.height - a.height).slice(0, n);
}

export function listBlocks(query: { before?: string; after?: string; limit: number }): {
  items: Block[];
  nextCursor: string | null;
  prevCursor: string | null;
} {
  const sorted = [...blocks].sort((a, b) => b.height - a.height);
  return cursorSlice(sorted, (b) => ({ sortKey: b.height, id: b.hash }), query);
}

export function getOldestHeight(): number {
  return Math.min(...blocks.map((b) => b.height));
}

export function getBlock(idOrHeight: string): Block | undefined {
  if (/^\d+$/.test(idOrHeight)) {
    const h = Number(idOrHeight);
    return blocks.find((b) => b.height === h);
  }
  const hash = idOrHeight.toLowerCase();
  return blocks.find((b) => b.hash === hash);
}

/** Mempool transactions aren't in a block yet, so `getTransaction` must also check them. */
const mempoolById = new Map(mempoolTransactions.map((t) => [t.txid, t]));

/**
 * List paths never carry `rawHex` — the same contract as the live API, so fixture mode
 * cannot render something live mode would not. Only `getTransaction` returns the
 * transaction whole.
 */
function withoutRawHex(tx: Transaction): Transaction {
  return tx.rawHex === null ? tx : { ...tx, rawHex: null };
}

export function getTransaction(txid: string): Transaction | undefined {
  const id = txid.toLowerCase();
  return transactionsById.get(id) ?? mempoolById.get(id);
}

export function getBlockTransactions(block: Block): Transaction[] {
  return block.txids.flatMap((id) => transactionsById.get(id) ?? []).map(withoutRawHex);
}

export function listLatestTransactions(n: number): Transaction[] {
  return [...transactions]
    .filter((t) => !t.isCoinbase)
    .sort((a, b) => b.timestamp - a.timestamp || b.txid.localeCompare(a.txid))
    .slice(0, n)
    .map(withoutRawHex);
}

export function getAddress(addr: string): AddressInfo | undefined {
  // The rich-list fixtures are a second source of transparent addresses, and every
  // `/rich-list` row links to `/address/<addr>`, so they must resolve here.
  return (
    addresses.find((a) => a.address === addr) ?? richListAddresses().find((a) => a.address === addr)
  );
}

export function getAddressTransactions(
  address: string,
  query: { before?: string; after?: string; limit: number },
): { items: Transaction[]; nextCursor: string | null; prevCursor: string | null } {
  const info = addresses.find((a) => a.address === address);
  if (!info || info.kind !== "transparent") {
    return { items: [], nextCursor: null, prevCursor: null };
  }
  const sorted = info.txids
    .flatMap((id) => transactionsById.get(id) ?? [])
    .map(withoutRawHex)
    .sort((a, b) => (b.blockHeight ?? 0) - (a.blockHeight ?? 0) || b.txid.localeCompare(a.txid));
  return cursorSlice(sorted, (t) => ({ sortKey: t.blockHeight ?? 0, id: t.txid }), query);
}

export function listTransactions(
  query: { before?: string; after?: string; limit: number },
  kind: TxKindFilter,
): { items: Transaction[]; nextCursor: string | null; prevCursor: string | null } {
  const sorted = [...transactions]
    .filter((t) => matchesTxKindFilter(t, kind))
    .sort((a, b) => b.timestamp - a.timestamp || b.txid.localeCompare(a.txid))
    .map(withoutRawHex);
  return cursorSlice(sorted, (t) => ({ sortKey: t.timestamp, id: t.txid }), query);
}

export function listCrossChainTransfers(
  query: {
    before?: string;
    after?: string;
    limit: number;
  },
  filters: CrossChainNarrowing = {},
): { items: CrossChainTransfer[]; nextCursor: string | null; prevCursor: string | null } {
  // Filtered before the cursor slice, never after: filtering a page would hand back fewer
  // than `limit` rows and a cursor that skips the ones it removed.
  const matching = crossChainTransfers.filter((t) => matchesCrossChainFilters(t, filters));
  const sorted = [...matching].sort(
    (a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id),
  );
  return cursorSlice(sorted, (t) => ({ sortKey: t.timestamp, id: t.id }), query);
}

/**
 * Aggregated from the transfer fixtures, through the same `aggregateFlowWindows` the API's
 * in-memory store uses, so the two cannot disagree about what a window means or when a
 * previous-window comparison is refused.
 *
 * The window anchors on `TIP_TIME` rather than the clock, because fixture timestamps are
 * expressed against it; a wall-clock cutoff would empty every window as the fixture aged.
 */
export function getCrossChainFlows(windowDays: number | null = null): CrossChainFlowSummary {
  return aggregateFlowWindows(crossChainTransfers, windowDays, TIP_TIME);
}

/**
 * The venues tab, through the same `buildProtocolSummary` the live adapter feeds, anchored on
 * `TIP_TIME` for the same reason as `getCrossChainFlows`.
 */
export function getCrossChainProtocols(
  windowDays: number | null = null,
): CrossChainProtocolSummary {
  return buildProtocolSummary(crossChainTransfers, windowDays, TIP_TIME);
}

export function getCrossChainTransfer(id: string): CrossChainTransfer | undefined {
  return crossChainById.get(id);
}

export function listCrossChainTransfersForZcashTx(txid: string): ZcashTxCrossings {
  const key = txid.toLowerCase();
  const transfers = crossChainTransfers
    .filter((t) => t.zcashTxid === key)
    .sort((a, b) => b.timestamp - a.timestamp || (a.id < b.id ? 1 : -1));
  return { transfers, total: transfers.length };
}

export function getActivitySeries(): ActivityPoint[] {
  return activitySeries;
}

/**
 * Ironwood inflow, with proportions close to the real chain's rather than round numbers.
 * Equal sources would render a breakdown that looks right while hiding whether the
 * component orders and labels them correctly, and the transparent slice — the novel figure —
 * is the smallest.
 */
export function getIronwoodInflow(): IronwoodInflow | null {
  const hours = 76;
  const finalZat = 60_812_843_700_000;
  return {
    activationHeight: 3_428_143,
    // Orchard ~87%, Sapling ~6%, fresh shielding ~6%, plus a few tens of ZEC mined straight
    // in. The terms reconcile to `balanceZat` exactly, so `ironwoodResidualZat` is 0 — a
    // fixture that did not add up would make the panel's own check meaningless.
    balanceZat: 60_812_843_700_000,
    netFromOrchardZat: 53_141_396_100_000,
    netFromSaplingZat: 3_744_302_000_000,
    netFromSproutZat: 0,
    netFromTransparentZat: 3_923_138_500_000,
    fromTransparentTxCount: 1_924,
    txCount: 5_180,
    minedZat: 4_143_600_000,
    feesPaidZat: 136_500_000,
    // A curve rather than a line: the balance climbed fastest right after activation.
    // `1 - (1 - x)^2` eases out.
    balance: Array.from({ length: hours }, (_, i) => {
      const x = (i + 1) / hours;
      return {
        timestamp: 1_785_247_620 + i * 3_600,
        ironwoodZat: Math.round(finalZat * (1 - (1 - x) ** 2)),
      };
    }),
  };
}

/**
 * Monthly gross shielding flow, derived from the monthly series so the two fixtures cannot
 * disagree.
 *
 * Gross is much larger than net, as on the real chain (thousands of ZEC each way on a day
 * whose net is a few ZEC); a fixture where gross barely exceeds net would not exercise what
 * the chart exists to reveal.
 */
export function getShieldingFlow(): ShieldingFlowPoint[] {
  return getMonthlySeries().map((m, i) => {
    const pooled = m.sproutZat + m.saplingZat + m.orchardZat + m.ironwoodZat;
    const prev =
      i === 0
        ? 0
        : (() => {
            const p = getMonthlySeries()[i - 1]!;
            return p.sproutZat + p.saplingZat + p.orchardZat + p.ironwoodZat;
          })();
    const net = pooled - prev;
    // Churn several times the net, which is what the chain actually looks like.
    const churn = Math.abs(net) * 3 + 40_000_000_000;
    return {
      timestamp: m.timestamp,
      shieldedZat: Math.round(churn + Math.max(net, 0)),
      unshieldedZat: Math.round(churn + Math.max(-net, 0)),
    };
  });
}

/**
 * Fee distribution with realistic medians: transparent 20k, mixed 15k, shielded 10k zat.
 * Shielded being cheapest is the finding, so equal kinds would hide what the panel exists
 * to show.
 */
export function getFeeDistribution(): FeeDistribution {
  const month = 2_592_000;
  return {
    windowDays: 90,
    recent: [
      {
        kind: "transparent",
        medianZat: 20_000,
        avgZat: 31_000,
        p25Zat: 10_000,
        p75Zat: 42_400,
        txs: 297_454,
      },
      {
        kind: "mixed",
        medianZat: 15_000,
        avgZat: 19_000,
        p25Zat: 15_000,
        p75Zat: 25_000,
        txs: 102_321,
      },
      {
        kind: "shielded",
        medianZat: 10_000,
        avgZat: 14_000,
        p25Zat: 10_000,
        p75Zat: 20_000,
        txs: 30_374,
      },
    ],
    monthly: Array.from({ length: 12 }, (_, i) => ({
      timestamp: 1_756_684_800 - (11 - i) * month,
      transparentZat: 20_000 + (i % 3) * 2_500,
      mixedZat: 15_000,
      shieldedZat: 10_000,
    })),
  };
}

/** Counted from the fixture transactions, so the line and the table cannot disagree. */
/** Flat at the fixture chain price, over the fixture chain's own dates. */
export function getDailyPriceMap(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of transactions) {
    out[new Date(t.timestamp * 1000).toISOString().slice(0, 10)] = 38.42;
  }
  // The two past halving days, with their real closes. `/halving`'s price column shows that
  // ZEC was lower at the second halving than the first; without these it would be empty in
  // every fixture build.
  out["2020-11-18"] = 63.154701232910156;
  out["2024-11-23"] = 48.86812210083008;
  return out;
}

/** Derived from the fixture blocks — a short, plausible series. */
export function getNetworkDaily(): NetworkDayPoint[] {
  const byDay = new Map<number, { d: number[]; b: number[] }>();
  for (const b of blocks) {
    const day = Math.floor(b.timestamp / 86_400) * 86_400;
    const cell = byDay.get(day) ?? { d: [], b: [] };
    cell.d.push(b.difficulty);
    cell.b.push(b.sizeBytes);
    byDay.set(day, cell);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, cell]) => ({
      timestamp,
      avgDifficulty: cell.d.reduce((s, v) => s + v, 0) / cell.d.length,
      avgBlockBytes: cell.b.reduce((s, v) => s + v, 0) / cell.b.length,
    }));
}

export function getTxCounts(): Record<string, number> {
  const out: Record<string, number> = { all: 0 };
  for (const t of transactions) {
    const k = txKind(t);
    out[k] = (out[k] ?? 0) + 1;
    out.all = (out.all ?? 0) + 1;
    // The mixed sub-filters are counted alongside their parent, never instead of it: a
    // shielding transaction is one `mixed` and one `shielding`. They do not sum to `mixed` —
    // rows whose pools disagree belong to neither.
    const direction = txDirection(t);
    if (k === "mixed" && (direction === "shielding" || direction === "unshielding")) {
      out[direction] = (out[direction] ?? 0) + 1;
    }
  }
  return out;
}

/** Summed from the transfer fixtures, so cards and table cannot disagree. */
export function getCrossChainVolume(): CrossChainVolume {
  const empty = { transfers: 0, zecAmountZat: 0, usdAtSwap: 0, usdCoveredTransfers: 0 };
  const out: CrossChainVolume = { in: { ...empty }, out: { ...empty } };
  for (const t of crossChainTransfers) {
    const side = out[t.direction];
    side.transfers += 1;
    side.zecAmountZat += t.zecAmountZat;
    if (typeof t.usdValueAtSwap === "number") {
      side.usdAtSwap += t.usdValueAtSwap;
      side.usdCoveredTransfers += 1;
    }
  }
  return out;
}

export function countCrossChainTransfers(filters: CrossChainNarrowing = {}): number {
  // The same predicate the list uses, so the totals line counts exactly the set the table
  // shows.
  return crossChainTransfers.filter((t) => matchesCrossChainFilters(t, filters)).length;
}

/**
 * A 24h fee total with complete coverage, derived from the activity fixture's latest day so
 * it cannot drift from the transaction counts beside it. The multiplier is ZIP-317's
 * conventional 10,000 zat per transaction, which most Zcash transactions pay.
 */
export function getFees24h(): Fees24h | null {
  const latest = activitySeries.at(-1);
  if (latest === undefined) return null;
  const txs = latest.transparentTxs + latest.mixedTxs + latest.shieldedTxs;
  const blocks = Math.max(1, Math.round(86_400 / 75));
  return { zat: txs * 10_000, blocksCovered: blocks, blocksTotal: blocks };
}

/**
 * Monthly series, folded from the daily activity fixture so the two cannot disagree.
 */
export function getMonthlySeries(): ChainMonthPoint[] {
  const byMonth = new Map<number, ChainMonthPoint>();
  for (const [i, point] of activitySeries.entries()) {
    const d = new Date(point.timestamp * 1000);
    const key = Date.UTC(d.getUTCFullYear(), d.getUTCMonth()) / 1000;
    const row = byMonth.get(key) ?? {
      timestamp: key,
      topHeight: TIP_HEIGHT - (activitySeries.length - i) * 1150,
      transparentTxs: 0,
      mixedTxs: 0,
      shieldedTxs: 0,
      sproutZat: 0,
      saplingZat: 0,
      orchardZat: 0,
      ironwoodZat: 0,
    };
    row.transparentTxs += point.transparentTxs;
    row.mixedTxs += point.mixedTxs;
    row.shieldedTxs += point.shieldedTxs;
    row.topHeight = TIP_HEIGHT - (activitySeries.length - i) * 1150;
    // Closing balances follow the real chain's shape: Sprout flat and legacy, Sapling and
    // Orchard carrying the value, Ironwood only at the end.
    const step = i + 1;
    row.sproutZat = 226_000_000_000;
    row.saplingZat = 5_900_000_000_000 + step * 1_000_000_000;
    row.orchardZat = 36_000_000_000_000 + step * 9_000_000_000;
    row.ironwoodZat = i >= activitySeries.length - 2 ? 1_700_000_000_000 : 0;
    byMonth.set(key, row);
  }
  return [...byMonth.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Daily series for the chart range toggles, derived from the same `activitySeries` as
 * `getMonthlySeries` — one source, two grains.
 */
export function getDailySeries(): ChainMonthPoint[] {
  return activitySeries.map((point, i) => ({
    timestamp: point.timestamp,
    topHeight: TIP_HEIGHT - (activitySeries.length - 1 - i) * 1150,
    transparentTxs: point.transparentTxs,
    mixedTxs: point.mixedTxs,
    shieldedTxs: point.shieldedTxs,
    sproutZat: 226_000_000_000,
    saplingZat: 5_900_000_000_000 + i * 30_000_000,
    orchardZat: 36_000_000_000_000 + i * 300_000_000,
    ironwoodZat: i >= activitySeries.length - 2 ? 1_700_000_000_000 : 0,
  }));
}

/** Daily gross shielding flow — same derivation as `getShieldingFlow`, day grain. */
export function getShieldingFlowDaily(): ShieldingFlowPoint[] {
  const days = getDailySeries();
  return days.map((d, i) => {
    const pooled = d.sproutZat + d.saplingZat + d.orchardZat + d.ironwoodZat;
    const prev =
      i === 0
        ? pooled
        : (() => {
            const p = days[i - 1]!;
            return p.sproutZat + p.saplingZat + p.orchardZat + p.ironwoodZat;
          })();
    const net = pooled - prev;
    const churn = Math.abs(net) * 3 + 1_400_000_000;
    return {
      timestamp: d.timestamp,
      shieldedZat: Math.round(churn + Math.max(net, 0)),
      unshieldedZat: Math.round(churn + Math.max(-net, 0)),
    };
  });
}

/**
 * Daily fee medians by kind, with the realistic proportions (transparent 20k / mixed 15k /
 * shielded 10k zat) and day-to-day wiggle so the three lines are separable.
 */
export function getFeeKindsDaily(): FeeKindMonthPoint[] {
  return getDailySeries().map((d, i) => ({
    timestamp: d.timestamp,
    transparentZat: 20_000 + (i % 4) * 1_500,
    mixedZat: 15_000 + (i % 3) * 1_000,
    shieldedZat: 10_000 + (i % 5) * 500,
  }));
}

/**
 * Total fees the network paid, per month and per day, from the same daily activity fixture
 * at ZIP-317's conventional 10,000 zat, so fee totals and transaction counts agree. Coverage
 * is complete.
 */
export function getFeeTotals(): FeeTotalSeries {
  const blocksPerDay = Math.round(86_400 / 75);
  const daily: FeeTotalPoint[] = activitySeries.map((p) => ({
    timestamp: p.timestamp,
    feeZat: (p.transparentTxs + p.mixedTxs + p.shieldedTxs) * 10_000,
    blocks: blocksPerDay,
    blocksCovered: blocksPerDay,
  }));
  const byMonth = new Map<number, FeeTotalPoint>();
  for (const d of daily) {
    const t = new Date(d.timestamp * 1000);
    const key = Date.UTC(t.getUTCFullYear(), t.getUTCMonth()) / 1000;
    const row = byMonth.get(key) ?? { timestamp: key, feeZat: 0, blocks: 0, blocksCovered: 0 };
    row.feeZat += d.feeZat;
    row.blocks += d.blocks;
    row.blocksCovered += d.blocksCovered;
    byMonth.set(key, row);
  }
  return { monthly: [...byMonth.values()].sort((a, b) => a.timestamp - b.timestamp), daily };
}

/** ZEC crossing per month and per day, folded from the transfer fixtures so they agree. */
export function getCrossChainVolumeSeries(): CrossChainVolumeSeries {
  const roll = (unit: "month" | "day"): CrossChainVolumePoint[] => {
    const by = new Map<number, CrossChainVolumePoint>();
    for (const t of crossChainTransfers) {
      const d = new Date(t.timestamp * 1000);
      const ts =
        unit === "month"
          ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth()) / 1000
          : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
      const row = by.get(ts) ?? {
        timestamp: ts,
        inZat: 0,
        outZat: 0,
        transfers: 0,
        inTransfers: 0,
        outTransfers: 0,
        inUsdAtSwap: 0,
        outUsdAtSwap: 0,
        inUsdCoveredTransfers: 0,
        outUsdCoveredTransfers: 0,
      };
      if (t.direction === "in") {
        row.inZat += t.zecAmountZat;
        row.inTransfers += 1;
      } else {
        row.outZat += t.zecAmountZat;
        row.outTransfers += 1;
      }
      row.transfers += 1;
      if (typeof t.usdValueAtSwap === "number" && Number.isFinite(t.usdValueAtSwap)) {
        if (t.direction === "in") {
          row.inUsdAtSwap += t.usdValueAtSwap;
          row.inUsdCoveredTransfers += 1;
        } else {
          row.outUsdAtSwap += t.usdValueAtSwap;
          row.outUsdCoveredTransfers += 1;
        }
      }
      by.set(ts, row);
    }
    return [...by.values()].sort((a, b) => a.timestamp - b.timestamp);
  };
  return { monthly: roll("month"), daily: roll("day") };
}

export function listMempool(
  page: number,
  pageSize: number,
): { entries: MempoolEntry[]; totalPages: number } {
  const sorted = [...mempoolEntries]
    .sort((a, b) => b.seenAt - a.seenAt || b.transaction.txid.localeCompare(a.transaction.txid))
    .map((entry) => ({ ...entry, transaction: withoutRawHex(entry.transaction) }));
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const p = Math.min(Math.max(1, page), totalPages);
  return { entries: sorted.slice((p - 1) * pageSize, p * pageSize), totalPages };
}

export function getMempoolStats(): MempoolStats {
  return mempoolStats;
}

export function listReorgEvents(query: { before?: string; after?: string; limit: number }): {
  items: ReorgEvent[];
  nextCursor: string | null;
  prevCursor: string | null;
} {
  const sorted = [...reorgEvents].sort((a, b) => b.detectedAt - a.detectedAt || b.id - a.id);
  // detectedAt is not unique, so the cursor carries the composite (detectedAt, id) tuple.
  return cursorSlice(sorted, (e) => ({ sortKey: e.detectedAt, id: String(e.id) }), query);
}

export function getReorgSummary(): ReorgSummary {
  return reorgSummary;
}

export { getMiningOverview } from "./mining";
export { getMarketSnapshot } from "./market";
export { getHalvingSchedule } from "./halving";
export { getMiningTerms } from "./mining-terms";
export { getRichListSummary, listRichList } from "./rich-list";
export { getSocialPost } from "./social";
export { getZipIndex } from "./zips";
export { getZnsName } from "./zns";
