import type {
  BlockSummary,
  ChainMonthPoint,
  FeeKindMonthPoint,
  SupplyBreakdown,
  CrossChainFlow,
  CrossChainFlowSummary,
  CrossChainProtocolSummary,
  CrossChainNarrowing,
  ActivityPoint,
  Fees24h,
  IronwoodInflow,
  ShieldingFlowPoint,
  FeeDistribution,
  AddressInfo,
  Block,
  ChainInfo,
  CrossChainTransfer,
  ZcashTxCrossings,
  HalvingSchedule,
  MarketSnapshot,
  MempoolEntry,
  RichListEntry,
  RichListSummary,
  MempoolStats,
  MiningOverview,
  MiningTerms,
  MiningWindowKey,
  NetCrawlHistory,
  NetHealth,
  NetMap,
  NetNodeFilters,
  NetNodePage,
  NetPeers,
  NetReleases,
  NetSummary,
  NetTopology,
  NetTopologyScope,
  ReorgEvent,
  ReorgSummary,
  ShieldedPool,
  PriceSeries,
  Stats,
  StatsRange,
  PoolMigrationDayPoint,
  PoolUsageDayPoint,
  PulseFrame,
  PulsePendingFrame,
  PulseRibbonsPayload,
  PulseWindowFrame,
  ShieldedSupplyPoint,
  Transaction,
  TxKindFilter,
  CrossChainVolume,
  NetworkDayPoint,
  FeeTotalSeries,
  CrossChainVolumeSeries,
  ZipIndex,
  ZnsLookup,
  BlocksDayPoint,
  ChainInflowPoint,
  ChainOutflowPoint,
  InflowKindMonthPoint,
  SupplyDayPoint,
  VenueMonthPoint,
  MinerShareMonth,
  NoteTreeDayPoint,
  ReorgWeekSeries,
  TransparentDayPoint,
} from "@/domain";
// Not part of the `@/domain` barrel; every consumer imports it from its own module.
import type { SocialPost, SocialSnapshot } from "@/domain/social";
import type { SwapFigures } from "@/domain/swap";
import type { BoundaryFigures } from "@/domain/boundary";

export interface Paginated<T> {
  items: T[];
  totalPages: number;
}

/**
 * A keyset ("cursor") page. There is no page number and no total count — a real
 * index seek doesn't know either without a separate `COUNT(*)`, and inventing one
 * would be dishonest. `before`/`after` cursors are opaque strings: the caller passes
 * one back verbatim, but must never inspect, parse, or construct one.
 */
export interface CursorPage<T> {
  items: T[];
  /** Pass as `before` to get the next (older) page. Null when this is the last page. */
  nextCursor: string | null;
  /** Pass as `after` to get the previous (newer) page. Null when on the first page. */
  prevCursor: string | null;
}

/**
 * Cursors are opaque above `src/data/` — only the adapter that produced a cursor may
 * decode it (see `src/data/cursor.ts`), so the format can change freely.
 *
 * A cursor encodes the full sort-key tuple `(sortKey, id)` of the boundary row, not just
 * its id. `listBlocks` sorts by `height`, which is unique, so a single-column comparison is
 * correct there. `listTransactions` and `listCrossChainTransfers` sort by `timestamp`,
 * which is not unique, so an adapter must translate `before`/`after` into a composite
 * range scan, e.g. for transactions:
 *
 *   WHERE (block_time, txid) < ($ts, $id) ORDER BY block_time DESC, txid DESC LIMIT $n
 *
 * never `WHERE txid < $cursor ORDER BY block_time DESC`, which returns an arbitrary slice
 * on every page past the first. Never use `OFFSET`: it walks and discards every skipped
 * row, while a keyset seek costs the same at any depth.
 *
 * `before`/`after` come from the URL and are untrusted: a garbage, stale or hostile cursor
 * resolves to the first page — never a throw, never an empty page.
 */
export interface CursorQuery {
  /** Opaque cursor — return items strictly older than it. */
  before?: string;
  /** Opaque cursor — return items strictly newer than it. */
  after?: string;
  limit: number;
}

/**
 * Cross-chain list filters, as one object so that an adapter which forgets to forward a
 * filter fails to compile rather than silently dropping it.
 */
export type CrossChainFilters = CrossChainNarrowing;

/**
 * Everything the routes need from a data source, in domain types.
 *
 * Every method is async so that swapping the fixture adapter for a network one is
 * additive. `getChainInfo()` is called by nearly every route; a network-backed adapter
 * should memoize it per request or on a short TTL.
 *
 * Error contract: `undefined` means "does not exist" and becomes a 404. A transient
 * failure (RPC timeout, indexer down) must reject, never resolve to `undefined` — an
 * outage must not be masked as missing data.
 */
export interface ExplorerDataSource {
  getChainInfo(): Promise<ChainInfo>;

  getPools(): Promise<ShieldedPool[]>;
  /** Every value pool, including transparent and the lockbox — the whole supply. */
  getSupplyBreakdown(): Promise<SupplyBreakdown>;
  getSupplySeries(): Promise<ShieldedSupplyPoint[]>;
  /** Transactions touching each pool per UTC day, all-time. NOT a partition — see the type. */
  getPoolUsageSeries(): Promise<PoolUsageDayPoint[]>;
  /** ZEC migrating between pools per UTC day, keyed by the destination pool, all-time. */
  getPoolMigrationSeries(): Promise<PoolMigrationDayPoint[]>;

  /**
   * The `/stats` page's live scalars: price, today's change, and the shielded totals with
   * the height they were read at. One call for the whole page.
   */
  getStats(): Promise<Stats>;
  /**
   * Every window the price face offers, in one read — the range control is a viewport over
   * data the page already carries. A window the venue could not answer is absent from the
   * map (rendered as unavailable); an empty series would claim ZEC did not trade.
   */
  getPriceSeries(): Promise<Partial<Record<StatsRange, PriceSeries>>>;

  /**
   * Block list rows: what a list renders, without the header fields and txid list only a
   * detail page needs. Built from the chain index in a few queries, where a full `Block`
   * costs one node read per row.
   */
  listLatestBlocks(count: number): Promise<BlockSummary[]>;
  listBlocks(query: CursorQuery): Promise<CursorPage<BlockSummary>>;
  getBlock(idOrHeight: string): Promise<Block | undefined>;
  /**
   * Takes the whole `Block` because it already carries its `txids`, so an adapter can
   * batch-fetch them without re-fetching the block.
   */
  getBlockTransactions(block: Block): Promise<Transaction[]>;
  /** Lowest height this source can serve — bounds the block-detail prev link. */
  getOldestHeight(): Promise<number>;

  listLatestTransactions(count: number): Promise<Transaction[]>;
  listTransactions(query: CursorQuery, kind: TxKindFilter): Promise<CursorPage<Transaction>>;
  getTransaction(txid: string): Promise<Transaction | undefined>;

  getAddress(address: string): Promise<AddressInfo | undefined>;
  /**
   * Keyset over the composite `(blockHeight, txid)` — a block can hold several of an
   * address's transactions, so height alone is not unique.
   */
  getAddressTransactions(address: string, query: CursorQuery): Promise<CursorPage<Transaction>>;

  /**
   * `protocol` filters by venue; "all" (the default) means every venue. Filters are applied
   * in the adapter, not the page: filtering one page of 25 rows would look like filtering
   * the list while filtering only the page.
   */
  listCrossChainTransfers(
    query: CursorQuery,
    filters?: CrossChainFilters,
  ): Promise<CursorPage<CrossChainTransfer>>;
  getCrossChainTransfer(id: string): Promise<CrossChainTransfer | undefined>;
  /**
   * The crossings whose Zcash leg is this transaction, newest first and bounded, with the
   * exact `total` — so a `/tx` page can say "Zcash leg of a swap" and link to it. An empty list
   * is an answer (most transactions cross nothing); a transient failure must reject, never
   * resolve to empty, or an outage would read as "this transaction was not part of a swap".
   */
  listCrossChainTransfersForZcashTx(txid: string): Promise<ZcashTxCrossings>;
  /**
   * Flow per chain and direction, over a trailing window of `windowDays` or all-time.
   * Aggregated in the store (one GROUP BY), never by paging the list.
   *
   * Takes a count of days rather than a `ChartRange` so the wire contract does not change
   * whenever the UI's range vocabulary grows; `chartRangeDays` converts at the route.
   */
  getCrossChainFlows(windowDays?: number | null): Promise<CrossChainFlowSummary>;
  /**
   * Per-venue figures over a trailing window of `windowDays` calendar days (today included),
   * or all-time. Every indexed venue is present, an idle one with zeroed sides: a venue that
   * carried nothing is a finding, not a missing card.
   */
  getCrossChainProtocols(windowDays?: number | null): Promise<CrossChainProtocolSummary>;
  /**
   * The per-direction chain lists the SOURCE/DESTINATION filter menus are built from.
   *
   * Separate from `getCrossChainFlows` although it reads the same aggregate, because the two
   * have opposite freshness needs: the flows tab wants current numbers, while a menu only
   * needs to know which chains exist. Keeping them apart lets the adapter memoise this one
   * on a route that otherwise runs with no fetch cache.
   */
  getCrossChainChains(): Promise<CrossChainFlow[]>;

  /**
   * Everything `/mining` shows for one window, in a single call: every panel is a projection
   * of the same `GROUP BY` over the same block range, and splitting them would run the scan
   * several times and let the answers disagree about which blocks were in the window.
   */
  getMiningOverview(window: MiningWindowKey): Promise<MiningOverview>;

  getActivitySeries(): Promise<ActivityPoint[]>;
  /**
   * Fees paid over the trailing day, with the coverage behind the figure.
   *
   * `null` means nothing could be measured — never `0`, which is a different claim. Partial
   * coverage is returned rather than suppressed: a fee is unknowable when an input cannot be
   * resolved, and a floor stated as a floor is more useful than silence.
   */
  getFees24h(): Promise<Fees24h | null>;
  /**
   * What is filling Ironwood since NU6.3 activated.
   *
   * `null` before activation, or where the pool has received nothing — never a zero-filled
   * object, which would draw an empty breakdown asserting the pool exists and is unused.
   */
  getIronwoodInflow(): Promise<IronwoodInflow | null>;
  /**
   * Monthly gross shielding flow, both directions. `[]` only when the chain genuinely has no
   * months — the caller distinguishes "unreadable" by catching, not by an empty array.
   */
  getShieldingFlow(): Promise<ShieldingFlowPoint[]>;
  /**
   * Fee statistics by privacy kind: the recent window plus the monthly trend. Percentiles
   * with their sample sizes, never means — the distribution is heavy-tailed.
   */
  getFeeDistribution(): Promise<FeeDistribution>;
  /** Per-kind transaction totals (matview, minutes stale) plus their sum under "all". */
  getTxCounts(): Promise<Record<string, number>>;
  /**
   * Daily ZEC/USD closes as "YYYY-MM-DD" -> usd, for pricing a fee AT ITS DATE. Today has
   * no close yet — callers fall back to the current price for today's rows only.
   */
  getDailyPriceMap(): Promise<Record<string, number>>;
  /** Daily difficulty and average block size, for the network-health charts. */
  getNetworkDaily(): Promise<NetworkDayPoint[]>;
  /** Exact filtered count of cross-chain transfers, for the totals line. */
  countCrossChainTransfers(filters?: CrossChainFilters): Promise<number>;
  /** Per-direction volume: exact ZEC, swap-time USD as a floor with coverage. */
  getCrossChainVolume(): Promise<CrossChainVolume>;
  /**
   * Monthly chain history — the series behind /analytics. Monthly rather than daily because
   * a decade of daily points is a quarter-megabyte of JSON per page view.
   */
  getMonthlySeries(): Promise<ChainMonthPoint[]>;
  /**
   * The daily siblings of the three monthly series, trailing 366 days only — they exist
   * for the chart range toggles, where thirty days of a monthly series is one point. The
   * longest sub-ALL range is 1Y, so a longer daily tail would be payload for nothing.
   */
  getDailySeries(): Promise<ChainMonthPoint[]>;
  getShieldingFlowDaily(): Promise<ShieldingFlowPoint[]>;
  getFeeKindsDaily(): Promise<FeeKindMonthPoint[]>;
  /**
   * These two carry both grains in one object — monthly for the ALL range, daily for
   * everything shorter.
   */
  getFeeTotals(): Promise<FeeTotalSeries>;
  getCrossChainVolumeSeries(): Promise<CrossChainVolumeSeries>;
  /** ZEC arriving per source chain per month, through the public swap venues indexed. */
  getChainInflow(): Promise<ChainInflowPoint[]>;
  /** ZEC leaving per destination chain per month, on the inflow's rules. */
  getChainOutflow(): Promise<ChainOutflowPoint[]>;
  /** ZEC per swap venue per month, both directions as separate sums. */
  getVenueMonths(): Promise<VenueMonthPoint[]>;
  /** Inbound ZEC and transfers per Zcash address kind per month. */
  getInflowKinds(): Promise<InflowKindMonthPoint[]>;
  /** Every value pool's balance at each complete UTC day's close, all history. */
  getSupplyDays(): Promise<SupplyDayPoint[]>;
  /** Each shielded pool's note commitment tree size at every day's close. */
  getNoteTrees(): Promise<NoteTreeDayPoint[]>;
  /** Transparent active addresses per complete day, with gaps where not computed. */
  getTransparentDays(): Promise<TransparentDayPoint[]>;
  /** The largest payout addresses' share of each month's blocks. */
  getMinerShares(): Promise<MinerShareMonth[]>;
  /** Blocks per complete UTC day, with each day's top height. */
  getBlocksDaily(): Promise<BlocksDayPoint[]>;
  /** Reorganisations this node observed per ISO week, from when it began observing. */
  getReorgWeeks(): Promise<ReorgWeekSeries>;
  /** The mempool is unbounded on a busy chain — always paginated. */
  listMempool(page: number, pageSize: number): Promise<Paginated<MempoolEntry>>;
  /** Reorgs our own node observed, newest first — keyset over (detectedAt, id). */
  listReorgEvents(query: CursorQuery): Promise<CursorPage<ReorgEvent>>;
  getReorgSummary(): Promise<ReorgSummary>;
  getMempoolStats(): Promise<MempoolStats>;
  /**
   * Market capitalisations for `/compare` — Zcash and every asset we hold a figure for.
   *
   * `null` when the upstream snapshot is missing or too old, so the page renders its
   * unavailable state. Never an empty snapshot (that would claim nothing is larger than
   * Zcash). The only method whose data comes from neither the chain nor our own
   * measurement, which is why the page attributes it.
   */
  getMarketSnapshot(): Promise<MarketSnapshot | null>;
  /**
   * The ZIP index behind `/zips` — every numbered Zcash Improvement Proposal, read from
   * github.com/zcash/zips by the API's tracker.
   *
   * `null` when the tracker has no snapshot yet (503), so the page renders its
   * unavailable state. Never an empty list: an empty index would claim Zcash has no
   * improvement proposals.
   */
  getZipIndex(): Promise<ZipIndex | null>;
  /**
   * A Zcash Name System name to its registration, from the API's verified snapshot of the
   * registry — never a call to the registry itself. Forward only: a claim does not prove control
   * of the address it names, so nothing here answers "which names point at this address".
   *
   * `null` when the API has no snapshot yet (503). A miss is a lookup with no registrations, and
   * a registry too stale to trust is one with `withheld: true` — neither is null.
   */
  getZnsName(name: string): Promise<ZnsLookup | null>;
  /**
   * The halving schedule behind `/halving` — every past halving, the next one, and the
   * observed block interval every estimated date is derived from.
   *
   * Not nullable: unlike a market snapshot this is consensus data the node can always
   * answer, so an outage here is a real failure and must reach the error boundary rather
   * than render as an absence.
   */
  getHalvingSchedule(): Promise<HalvingSchedule>;
  /**
   * The chain-side terms behind `/mining-cost`, read at one tip: difficulty, the network
   * solution rate with its basis (the node's own measurement, or a labelled estimate), the
   * miner's subsidy, the observed block interval and the tracked price.
   *
   * Not nullable: every term but the price comes from the node, so an outage here belongs
   * at the error boundary. The price alone is null when the tracker is cold, and the page
   * then shows no dollar figure rather than a substitute.
   */
  getMiningTerms(): Promise<MiningTerms>;
  /**
   * The `/pulse` frame: the tip, the six closes the boxes read, the confirmed movements
   * behind them, and the transparent outputs the ledger box lists — in one call.
   *
   * Not nullable: an empty frame would state that every pool holds nothing, so an outage
   * belongs at the error boundary.
   */
  getPulseFrame(): Promise<PulseFrame>;
  /**
   * The mempool layer, or `null` when our node has not been read.
   *
   * `null` and a snapshot with `count: 0` are opposite claims and both are reachable: the
   * first is an outage of ours or a tracker that has not warmed, the second a measurement
   * that the mempool held nothing. Collapsing them would report our own downtime as a fact
   * about the chain.
   */
  getPulsePending(): Promise<PulsePendingFrame | null>;
  /**
   * One aligned hour of history, for the replay transport.
   *
   * Half-open `[from, to)`, so no instant belongs to two hours. Both boundaries are whole
   * seconds and `from` is a multiple of the hour. An adapter must refuse a response that does
   * not echo the hour it asked for: an hour of some other time is still well-formed.
   */
  getPulseWindow(fromSeconds: number, toSeconds: number): Promise<PulseWindowFrame>;
  /**
   * The cumulative gross flow along every edge, over all of history, the trailing year and
   * the trailing thirty days.
   *
   * `null` while the day views behind it have not been filled, so the page renders its
   * unavailable state instead of drawing no ribbons. Any other failure still rejects.
   */
  getPulseRibbons(): Promise<PulseRibbonsPayload | null>;

  /**
   * The node map behind `/network`: what this explorer's own P2P crawler can say about the
   * Zcash network. All reads come off one server-side snapshot, so no two tabs disagree;
   * every count is a floor and every payload holds derived facts only (country, city,
   * network operator, cells, one-way ids — never an address).
   *
   * Not nullable: an outage belongs at the error boundary, never dressed as an empty
   * network. `getNetworkPeers` is the exception.
   */
  getNetworkSummary(): Promise<NetSummary>;
  /** One payload for every map lens; which stat colours the map is client state. */
  getNetworkMap(): Promise<NetMap>;
  /**
   * The gossip graph. `hubs` is answering nodes only; `all` adds every advertised-but-
   * never-answered address hanging off its advertisers, capped and COUNTED so the legend
   * says "N of M drawn". An adapter must refuse a response whose `scope` is not the one
   * asked for: a hubs-only graph is a well-formed graph.
   */
  getNetworkTopology(scope: NetTopologyScope): Promise<NetTopology>;
  getNetworkHealth(): Promise<NetHealth>;
  /**
   * Keyset over `(reliabilityBps, id)` — reliability ties constantly, so the id tiebreak
   * matters from page one. Filters are parsed in the domain, applied before the slice and
   * echoed back as `applied`; an adapter refuses a page whose echo differs from what it sent.
   */
  listNetworkNodes(query: CursorQuery, filters: NetNodeFilters): Promise<NetNodePage>;
  /** Every finished crawl, oldest first, capped by the route and saying so. */
  getNetworkCrawls(): Promise<NetCrawlHistory>;
  /**
   * OUR node's own peer table, reduced to counts. `null` when the node could not be read —
   * a count of zero is a claim about our connectivity and is never substituted for an outage.
   * Marked `basis: "ours"` and never folded into a crawl figure: a crawler counts the
   * network's listening nodes; this counts who is connected to one node.
   */
  getNetworkPeers(): Promise<NetPeers | null>;
  /**
   * The releases answering nodes run, grouped by (client, release, declared protocol version),
   * with each group's lag behind our tip and the crawler's daily record beneath. Raw counts
   * only: which releases are ready for an upgrade is decided page-side, from a committed table
   * (`domain/network-upgrade.ts`), so adding a release that ships support needs no API deploy.
   */
  getNetworkReleases(): Promise<NetReleases>;

  /**
   * The transparent rich list — every address holding a positive balance, largest first.
   *
   * Keyset over the composite `(balanceZat, address)`: balances are not unique (round
   * holdings repeat), so a single-column seek would return an arbitrary slice past page one.
   */
  listRichList(query: CursorQuery): Promise<CursorPage<RichListEntry>>;
  /** Totals, the balance-band distribution, and the top-N concentration figures. */
  getRichListSummary(): Promise<RichListSummary>;
  /**
   * Read back a published social post. The card route renders from this rather than a fresh
   * live read, so the image shows exactly the figures the post text was composed from.
   * `null` when the key has no ledger row, which the route turns into a 404.
   *
   * The figures are `SocialSnapshot` for `daily`/`daily-dryrun`, `SwapFigures` for
   * `swap`/`swap-dryrun`, and `BoundaryFigures` for `shielding`/`unshielding` and their
   * dry-run twins. A union rather than a generic, because runtime validation has to pick a
   * shape guard from `kind`, which a type parameter cannot carry.
   */
  readSocialPost(
    kind: string,
    key: string,
  ): Promise<SocialPost<SocialSnapshot | SwapFigures | BoundaryFigures> | null>;
}
