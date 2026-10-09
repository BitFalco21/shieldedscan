import type {
  BlocksDayPoint,
  ChainInflowPoint,
  FeeSpreadSeries,
  MinerShareMonth,
  NetReleases,
  NoteTreeDayPoint,
  ReorgWeekSeries,
  TransparentDayPoint,
  CrossChainVolumeSeries,
  PoolMigrationDayPoint,
  PoolUsageDayPoint,
  FeeTotalSeries,
  ChainMonthPoint,
  FeeDistribution,
  FeeKindMonthPoint,
  IronwoodInflow,
  NetworkDayPoint,
  ShieldedSupplyPoint,
  ShieldingFlowPoint,
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
  feeSpread: FeeSpreadSeries | null;
  noteTrees: NoteTreeDayPoint[] | null;
  transparentDays: TransparentDayPoint[] | null;
  minerShares: MinerShareMonth[] | null;
  reorgWeeks: ReorgWeekSeries | null;
  chainInflow: ChainInflowPoint[] | null;
  blocksDaily: BlocksDayPoint[] | null;
  /** The crawler's daily release record, for the upgrade readiness trend. */
  releases: NetReleases | null;
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
    feeSpread: null,
    noteTrees: null,
    transparentDays: null,
    minerShares: null,
    reorgWeeks: null,
    chainInflow: null,
    blocksDaily: null,
    releases: null,
    ...partial,
  };
}
