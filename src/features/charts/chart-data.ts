import type {
  BlocksDayPoint,
  ChainInflowPoint,
  ChainOutflowPoint,
  InflowKindMonthPoint,
  SupplyDayPoint,
  VenueMonthPoint,
  DestinationWindows,
  MinerSeries,
  MinerShareMonth,
  NetReleases,
  NoteTreeDayPoint,
  ReorgWeekSeries,
  OrphanRateSeries,
  TransparentDayPoint,
  CrossChainVolumeSeries,
  PoolMigrationDayPoint,
  PoolUsageDayPoint,
  FeeTotalSeries,
  ChainMonthPoint,
  FeeDistribution,
  FeeKindMonthPoint,
  HalvingSchedule,
  IronwoodInflow,
  NetworkDayPoint,
  ShieldedSupplyPoint,
  ShieldingFlowPoint,
  SupplyBreakdown,
} from "@/domain";

/**
 * Everything any chart in the catalog can need. Each member is null when unreadable —
 * the figure degrades to `DataUnavailable` per chart, never per page.
 *
 * The `days` / `flowDays` / `feesDaily` members are the daily siblings of the monthly
 * series, trailing 366 days: they exist for the range toggle, where every range short of
 * ALL is too narrow for month grain.
 *
 * In its own module rather than in `ChartFigure.tsx` because that file is a client
 * component: a server page can pass props INTO it but cannot call a function it exports,
 * and `chartData` is exactly the helper the server call sites need.
 */
export interface ChartData {
  months: ChainMonthPoint[] | null;
  flow: ShieldingFlowPoint[] | null;
  fees: FeeDistribution | null;
  supply: ShieldedSupplyPoint[] | null;
  poolUsage: PoolUsageDayPoint[] | null;
  poolMigrations: PoolMigrationDayPoint[] | null;
  ironwood: IronwoodInflow | null;
  network: NetworkDayPoint[] | null;
  /** "YYYY-MM-DD" → USD close, ordered at render time. */
  prices: Record<string, number> | null;
  days: ChainMonthPoint[] | null;
  flowDays: ShieldingFlowPoint[] | null;
  feesDaily: FeeKindMonthPoint[] | null;
  /** Both grains in one object — see the note on `FeeTotalSeries`. */
  feeTotals: FeeTotalSeries | null;
  crosschainVolume: CrossChainVolumeSeries | null;
  noteTrees: NoteTreeDayPoint[] | null;
  transparentDays: TransparentDayPoint[] | null;
  minerShares: MinerShareMonth[] | null;
  reorgWeeks: ReorgWeekSeries | null;
  orphanRate: OrphanRateSeries | null;
  chainInflow: ChainInflowPoint[] | null;
  chainOutflow: ChainOutflowPoint[] | null;
  venueMonths: VenueMonthPoint[] | null;
  inflowKinds: InflowKindMonthPoint[] | null;
  supplyDays: SupplyDayPoint[] | null;
  blocksDaily: BlocksDayPoint[] | null;
  /** The crawler's daily release record, for the upgrade readiness trend. */
  releases: NetReleases | null;
  /** The tip and observed block rate the issuance projection is dated from. */
  halving: HalvingSchedule | null;
  /** The live supply at the tip, for the issuance chart's headline. */
  supplyNow: SupplyBreakdown | null;
  /** Every group's blocks per month, by reviewed mining pool: the pools-to-51% chart. */
  minerMonths: MinerSeries | null;
  /** Inbound swaps by source chain and address family, over each range: the by-chain chart. */
  destinationWindows: DestinationWindows | null;
  /**
   * When these series were read, Unix seconds: what a period still running is measured against.
   * Stamped with the data rather than read in the browser, so a cached page never calls a month
   * partial that its data had finished, or the reverse. 0 means unknown: no period is partial.
   */
  asOf: number;
}

/** A fully-null `ChartData` with the given members filled — for single-chart call sites. */
export function chartData(partial: Partial<ChartData>): ChartData {
  return {
    months: null,
    flow: null,
    fees: null,
    supply: null,
    poolUsage: null,
    poolMigrations: null,
    ironwood: null,
    network: null,
    prices: null,
    days: null,
    flowDays: null,
    feesDaily: null,
    feeTotals: null,
    crosschainVolume: null,
    noteTrees: null,
    transparentDays: null,
    minerShares: null,
    reorgWeeks: null,
    orphanRate: null,
    chainInflow: null,
    chainOutflow: null,
    venueMonths: null,
    inflowKinds: null,
    supplyDays: null,
    blocksDaily: null,
    releases: null,
    halving: null,
    supplyNow: null,
    minerMonths: null,
    destinationWindows: null,
    asOf: 0,
    ...partial,
  };
}
