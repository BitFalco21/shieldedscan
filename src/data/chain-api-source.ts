import type {
  ActivityPoint,
  AddressInfo,
  Block,
  BlockSummary,
  ChainMonthPoint,
  FeeDistribution,
  FeeKindMonthPoint,
  FeeTotalSeries,
  Fees24h,
  HalvingSchedule,
  IronwoodInflow,
  MarketSnapshot,
  MempoolEntry,
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
  NetworkDayPoint,
  PoolMigrationDayPoint,
  PoolUsageDayPoint,
  PriceSeries,
  PulseFrame,
  PulsePendingFrame,
  PulseRibbonsPayload,
  PulseWindowFrame,
  ReorgEvent,
  ReorgSummary,
  RichListEntry,
  RichListSummary,
  ShieldedPool,
  ShieldedSupplyPoint,
  ShieldingFlowPoint,
  Stats,
  StatsRange,
  SupplyBreakdown,
  Transaction,
  TxKindFilter,
  ZipIndex,
  ZnsLookup,
} from "@/domain";
import {
  isMixedDirectionFilter,
  PULSE_RIBBON_WINDOW_NAMES,
  STATS_RANGES,
  parseZnsName,
  ZIP_SOURCE_NAME,
} from "@/domain";
import type { BoundaryFigures } from "@/domain/boundary";
import type { SocialPost, SocialSnapshot } from "@/domain/social";
import type { SwapFigures } from "@/domain/swap";
import { finiteOrNull, isFiniteNumber } from "@/lib/finite";
import { isTestnet } from "@/lib/network";
import { apiRequest, type ApiRequestConfig } from "./api-request";
import { dailyPriceMap } from "./daily-price-map";
import { cursorSearchParams } from "./cursor";
import {
  isHalvingEvent,
  isMarketAsset,
  isMempoolEntry,
  isMiningOverview,
  isPulseRibbonWindow,
  isReorgEvent,
  isRichListEntry,
  isShieldingFlowPoint,
} from "./chain-guards";
import { isSocialPost } from "./social-guards";
import type { CursorPage, CursorQuery, Paginated } from "./source";
// Shape guards shared with `crosschain-api-source.ts` and the live feed.
import {
  assertNoAddressLiterals,
  blockListRow,
  isBlock,
  isNetCrawlHistory,
  isNetHealth,
  isNetMap,
  isNetNodePage,
  isNetPeers,
  isNetReleases,
  isNetSummary,
  isNetTopology,
  isPulseBlock,
  isPulseBlockPools,
  isPulseEvent,
  isPulseLedgerRow,
  isTransaction,
  isZnsNameEvent,
  isZnsRegistration,
} from "./shape-guards";

/**
 * Reads chain data — blocks, transactions, addresses, pools, mempool — from the explorer API.
 *
 * The API returns domain types verbatim, so this is a thin fetch-and-validate, like
 * `crosschain-api-source.ts`. It never speaks to the Zcash node: the node's RPC port is not
 * published, and the API is the only public surface.
 *
 * Error contract, per `ExplorerDataSource`: a 404 means "does not exist" and resolves to
 * `undefined`. Everything else — a timeout, a reboot, a bad gateway — rejects, so an outage
 * reaches the error boundary instead of being dressed up as missing data.
 */

/**
 * Cache windows, by how the data behaves: a confirmed block past reorg depth never changes,
 * while the tip changes every ~75 seconds.
 */
const REVALIDATE_TIP_SECONDS = 15;
const REVALIDATE_IMMUTABLE_SECONDS = 3_600;
/** Blocks within reorg depth are NOT immutable: the height→block mapping can change. */
const REVALIDATE_REORGABLE_SECONDS = 60;
const REORG_DEPTH = 100;

/**
 * Windows for reads whose freshness is a duration rather than the tip: day-grained series move
 * once a day, and the trackers behind the rest refresh on their own schedules.
 */
const CACHE_MINUTE = 60;
const CACHE_FIVE_MINUTES = 300;
const CACHE_QUARTER_HOUR = 900;
const CACHE_HOUR = 3_600;

/**
 * The chain facts the API always answers, plus the live statistics it answers only while
 * its trackers are warm and fresh. Those four are always present and `null` when the tracker
 * had nothing to report (see `getChainFacts`).
 */
export interface ChainFacts {
  height: number;
  bestBlockHash: string;
  lastBlockTimestamp: number;
  circulatingSupplyZat: number;
  /**
   * Always present, `null` when the API's poller had nothing to report. An absent key would
   * let a fixture value survive the spread in `data/index.ts` and publish a fabricated figure
   * as live; an explicit `null` cannot be spread over. The API omits what it lacks, so
   * normalising absence to `null` is the adapter's job.
   */
  priceUsd: number | null;
  priceChange24hPct: number | null;
  txCount24h: number | null;
  fullyShieldedPct24h: number | null;
}

export interface ChainApiConfig extends ApiRequestConfig {
  /**
   * The Data Cache window for tip reads (`/chain/info`, pools, stats, pulse, peers).
   *
   * Absent means `REVALIDATE_TIP_SECONDS`. A prerendered page passes its own declared window,
   * because Next uses the minimum revalidate across every fetch in a route: a page declaring
   * 60 s with a 15 s tip read regenerates every 15 s. Dynamic routes are unaffected — their
   * `force-no-store` drives every window to zero.
   */
  tipRevalidateSeconds?: number;
}

/**
 * One `apiRequest` (retries, timeouts, breaker) for both adapters — see `api-request.ts`.
 * Only the default cache window is this adapter's own: a TIP read on the source's window.
 */
function request(
  config: ChainApiConfig,
  path: string,
  revalidate: number = config.tipRevalidateSeconds ?? REVALIDATE_TIP_SECONDS,
): Promise<Response> {
  return apiRequest(config, path, revalidate);
}

/**
 * A client version string ("6.3.0") is the one node-map field that could look like an
 * address to a regex and is known not to be one; everything else on those payloads is
 * checked as it arrives.
 */
const NETMAP_ADDRESS_GUARD = { skipKeys: ["version"], label: "network" } as const;

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`chain API returned ${res.status} for ${what}`);
  return (await res.json()) as T;
}

/**
 * Refuse a transaction page the API did not narrow to the kind that was asked for.
 *
 * An API that predates `?kind=shielding` degrades it to `"all"` and returns every
 * transaction under a "MIXED · SHIELDING" chip — a well-formed list no shape check can tell
 * apart from a correct one, so the API must echo what it applied.
 *
 * Scoped to the mixed-direction values: an older API sends no `applied` key, and it serves
 * the other kinds correctly, so failing those would turn version skew into an outage.
 */
function assertTxKindApplied(asked: TxKindFilter, body: unknown): void {
  if (!isMixedDirectionFilter(asked)) return;
  const applied = (body as { applied?: { kind?: unknown } } | null)?.applied;
  if (applied?.kind === asked) return;
  throw new Error(
    `chain API applied kind=[${String(applied?.kind)}] for a request asking kind=[${asked}]`,
  );
}

function page<T>(body: unknown, ok: (v: unknown) => v is T, what: string): CursorPage<T> {
  return rowsPage(body, (v) => (ok(v) ? v : null), what);
}

/** A page whose rows are mapped as they are checked; one row that maps to null fails it all. */
function rowsPage<T>(body: unknown, toRow: (v: unknown) => T | null, what: string): CursorPage<T> {
  const p = body as Partial<CursorPage<unknown>>;
  const items = Array.isArray(p.items) ? p.items.map(toRow) : null;
  if (items === null || items.some((row) => row === null)) {
    throw new Error(`chain API returned an unrecognised ${what} page`);
  }
  return {
    items: items as T[],
    nextCursor: typeof p.nextCursor === "string" ? p.nextCursor : null,
    prevCursor: typeof p.prevCursor === "string" ? p.prevCursor : null,
  };
}

export function createChainApiSource(config: ChainApiConfig) {
  return {
    /**
     * The chain facts the node can answer, for composing into `ChainInfo`.
     *
     * The four poller-backed fields are normalised to `null` rather than left absent: a missing
     * key does not survive `{ ...fixtures, ...facts }` the way an explicit `null` does, so a
     * fixture value would otherwise be published as live.
     */
    async getChainFacts(): Promise<ChainFacts> {
      const body = await json<Partial<ChainFacts>>(
        await request(config, "/chain/info"),
        "chain info",
      );
      if (
        typeof body.height !== "number" ||
        typeof body.bestBlockHash !== "string" ||
        typeof body.lastBlockTimestamp !== "number" ||
        typeof body.circulatingSupplyZat !== "number"
      ) {
        throw new Error("chain API returned an unrecognised chain info shape");
      }
      return {
        height: body.height,
        bestBlockHash: body.bestBlockHash,
        lastBlockTimestamp: body.lastBlockTimestamp,
        circulatingSupplyZat: body.circulatingSupplyZat,
        // TAZ has no price. The API service is network-agnostic (one image serves both
        // deployments) and reports the mainnet ZEC price on testnet too, so the price keys are
        // nulled here. `getDailyPriceMap` guards the historical series the same way; both paths
        // need the guard.
        priceUsd: isTestnet ? null : finiteOrNull(body.priceUsd),
        priceChange24hPct: isTestnet ? null : finiteOrNull(body.priceChange24hPct),
        txCount24h: finiteOrNull(body.txCount24h),
        fullyShieldedPct24h: finiteOrNull(body.fullyShieldedPct24h),
      };
    },

    async getSupplyBreakdown(): Promise<SupplyBreakdown> {
      const body = await json<Partial<SupplyBreakdown>>(
        await request(config, "/chain/supply"),
        "supply",
      );
      if (!Array.isArray(body.pools) || typeof body.height !== "number") {
        throw new Error("chain API returned an unrecognised supply shape");
      }
      return { pools: body.pools, height: body.height };
    },

    async getMonthlySeries(): Promise<ChainMonthPoint[]> {
      const body = await json<unknown>(
        // The current month moves slowly and this is the API's heaviest query.
        await request(config, "/chain/analytics/months", CACHE_HOUR),
        "monthly series",
      );
      if (!Array.isArray(body)) throw new Error("chain API returned an unrecognised months shape");
      return body as ChainMonthPoint[];
    },

    /**
     * The daily siblings of the three monthly series, trailing 366 days, for the chart range
     * toggles. A missing field must fail the build (version-skew tripwire), never render as a
     * blank band.
     */
    async getDailySeries(): Promise<ChainMonthPoint[]> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/days", CACHE_QUARTER_HOUR),
        "daily series",
      );
      if (!Array.isArray(body)) throw new Error("chain API returned an unrecognised days shape");
      return body as ChainMonthPoint[];
    },

    async getShieldingFlowDaily(): Promise<ShieldingFlowPoint[]> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/shielding-flow-days", CACHE_QUARTER_HOUR),
        "daily shielding flow",
      );
      if (!Array.isArray(body) || !body.every(isShieldingFlowPoint)) {
        throw new Error("chain API returned an unrecognised daily shielding flow series");
      }
      return body as ShieldingFlowPoint[];
    },

    async getFeeKindsDaily(): Promise<FeeKindMonthPoint[]> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/fee-kinds-days", CACHE_QUARTER_HOUR),
        "daily fee kinds",
      );
      if (
        !Array.isArray(body) ||
        !body.every((p) => typeof (p as FeeKindMonthPoint).timestamp === "number")
      ) {
        throw new Error("chain API returned an unrecognised daily fee kinds series");
      }
      return body as FeeKindMonthPoint[];
    },

    async getFeeTotals(): Promise<FeeTotalSeries> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/fee-totals", CACHE_QUARTER_HOUR),
        "fee totals",
      );
      const d = body as FeeTotalSeries;
      if (
        typeof d !== "object" ||
        d === null ||
        !Array.isArray(d.monthly) ||
        !Array.isArray(d.daily)
      ) {
        throw new Error("chain API returned an unrecognised fee totals shape");
      }
      return d;
    },

    async getMempoolStats(): Promise<MempoolStats> {
      const body = await json<Partial<MempoolStats>>(
        await request(config, "/chain/mempool/stats", 10),
        "mempool stats",
      );
      const composition = body.composition;
      if (
        typeof body.pendingCount !== "number" ||
        typeof body.totalSizeBytes !== "number" ||
        (body.medianFeeZat !== null && typeof body.medianFeeZat !== "number") ||
        (body.medianFeeRateZatPerByte !== null &&
          typeof body.medianFeeRateZatPerByte !== "number") ||
        (composition !== null &&
          (typeof composition !== "object" ||
            composition === undefined ||
            typeof composition.sampled !== "number"))
      ) {
        throw new Error("chain API returned an unrecognised mempool stats shape");
      }
      return {
        pendingCount: body.pendingCount,
        totalSizeBytes: body.totalSizeBytes,
        medianFeeZat: body.medianFeeZat ?? null,
        medianFeeRateZatPerByte: body.medianFeeRateZatPerByte ?? null,
        composition: composition ?? null,
      };
    },

    /**
     * Daily series off the rollup table. Fifteen-minute cache: history is immutable and only
     * the newest day moves.
     */
    async getActivitySeries(): Promise<ActivityPoint[]> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/activity", CACHE_QUARTER_HOUR),
        "activity series",
      );
      if (
        !Array.isArray(body) ||
        !body.every(
          (p) =>
            typeof (p as ActivityPoint).timestamp === "number" &&
            typeof (p as ActivityPoint).transparentTxs === "number",
        )
      ) {
        throw new Error("chain API returned an unrecognised activity series");
      }
      return body as ActivityPoint[];
    },

    /**
     * Fees over the trailing day, with coverage. `null` is a legitimate body (no block in the
     * window has a measurable total) and renders "unavailable"; a malformed object must break
     * the build, so the check accepts null and rejects a wrong shape.
     */
    async getFees24h(): Promise<Fees24h | null> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/fees24h", CACHE_FIVE_MINUTES),
        "24h fees",
      );
      if (body === null) return null;
      const fees = body as Fees24h;
      if (
        typeof fees !== "object" ||
        typeof fees.zat !== "number" ||
        typeof fees.blocksCovered !== "number" ||
        typeof fees.blocksTotal !== "number"
      ) {
        throw new Error("chain API returned an unrecognised 24h fees shape");
      }
      return fees;
    },

    /**
     * What is filling Ironwood. `null` is a legitimate body (before the pool has received
     * anything). Every source field is checked, `fromSproutZat` included: an API predating a
     * field would send `undefined`, which renders as a blank slice instead of failing.
     */
    async getIronwoodInflow(): Promise<IronwoodInflow | null> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/ironwood", CACHE_FIVE_MINUTES),
        "ironwood inflow",
      );
      if (body === null) return null;
      const i = body as IronwoodInflow;
      if (
        typeof i !== "object" ||
        typeof i.activationHeight !== "number" ||
        typeof i.balanceZat !== "number" ||
        typeof i.netFromOrchardZat !== "number" ||
        typeof i.netFromSaplingZat !== "number" ||
        typeof i.netFromSproutZat !== "number" ||
        typeof i.netFromTransparentZat !== "number" ||
        typeof i.fromTransparentTxCount !== "number" ||
        typeof i.minedZat !== "number" ||
        typeof i.feesPaidZat !== "number" ||
        !Array.isArray(i.balance)
      ) {
        throw new Error("chain API returned an unrecognised ironwood inflow shape");
      }
      return i;
    },

    async getShieldingFlow(): Promise<ShieldingFlowPoint[]> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/shielding-flow", CACHE_QUARTER_HOUR),
        "shielding flow",
      );
      if (!Array.isArray(body) || !body.every(isShieldingFlowPoint)) {
        throw new Error("chain API returned an unrecognised shielding flow series");
      }
      return body as ShieldingFlowPoint[];
    },

    async getFeeDistribution(): Promise<FeeDistribution> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/fee-kinds", CACHE_QUARTER_HOUR),
        "fee distribution",
      );
      const d = body as FeeDistribution;
      if (
        typeof d !== "object" ||
        d === null ||
        typeof d.windowDays !== "number" ||
        !Array.isArray(d.recent) ||
        !Array.isArray(d.monthly) ||
        !d.recent.every(
          (s) =>
            typeof s.medianZat === "number" &&
            typeof s.p25Zat === "number" &&
            typeof s.p75Zat === "number" &&
            typeof s.txs === "number",
        )
      ) {
        throw new Error("chain API returned an unrecognised fee distribution shape");
      }
      return d;
    },

    /** Every daily close since launch, as "YYYY-MM-DD" -> usd. See `daily-price-map.ts`. */
    async getDailyPriceMap(): Promise<Record<string, number>> {
      // Testnet has no price: TAZ has no market and the testnet deployment serves no public
      // `/v1`. An empty map is the true answer there, and pages render coin-only.
      if (isTestnet) return {};
      return dailyPriceMap(config.baseUrl);
    },

    async getNetworkDaily(): Promise<NetworkDayPoint[]> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/network-daily", CACHE_QUARTER_HOUR),
        "network daily",
      );
      if (
        !Array.isArray(body) ||
        !body.every(
          (p) =>
            typeof (p as NetworkDayPoint).timestamp === "number" &&
            // A day with no difficulty is an explicit `null`; `undefined` is rejected, because a
            // missing key means the API is a build behind and must not render like a genuine gap.
            (typeof (p as NetworkDayPoint).avgDifficulty === "number" ||
              (p as NetworkDayPoint).avgDifficulty === null) &&
            typeof (p as NetworkDayPoint).avgBlockBytes === "number",
        )
      ) {
        throw new Error("chain API returned an unrecognised network daily shape");
      }
      return body as NetworkDayPoint[];
    },

    async getTxCounts(): Promise<Record<string, number>> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/tx-counts", CACHE_FIVE_MINUTES),
        "tx counts",
      );
      if (
        typeof body !== "object" ||
        body === null ||
        typeof (body as Record<string, unknown>).all !== "number"
      ) {
        throw new Error("chain API returned an unrecognised tx counts shape");
      }
      return body as Record<string, number>;
    },

    async getSupplySeries(): Promise<ShieldedSupplyPoint[]> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/supply", CACHE_QUARTER_HOUR),
        "supply series",
      );
      if (
        !Array.isArray(body) ||
        !body.every(
          (p) =>
            typeof (p as ShieldedSupplyPoint).height === "number" &&
            typeof (p as ShieldedSupplyPoint).totalZat === "number",
        )
      ) {
        throw new Error("chain API returned an unrecognised supply series");
      }
      return body as ShieldedSupplyPoint[];
    },

    async getPoolUsageSeries(): Promise<PoolUsageDayPoint[]> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/pool-usage", CACHE_QUARTER_HOUR),
        "pool usage series",
      );
      if (
        !Array.isArray(body) ||
        !body.every(
          (p) =>
            typeof (p as PoolUsageDayPoint).timestamp === "number" &&
            typeof (p as PoolUsageDayPoint).ironwoodTxs === "number",
        )
      ) {
        throw new Error("chain API returned an unrecognised pool usage series");
      }
      return body as PoolUsageDayPoint[];
    },

    async getPoolMigrationSeries(): Promise<PoolMigrationDayPoint[]> {
      const body = await json<unknown>(
        await request(config, "/chain/analytics/pool-migrations", CACHE_QUARTER_HOUR),
        "pool migration series",
      );
      // Checks a `to*Zat` field by name: the sibling usage series is also an array of
      // numbered pool fields, so a looser check would wave a swapped payload through.
      if (
        !Array.isArray(body) ||
        !body.every(
          (p) =>
            typeof (p as PoolMigrationDayPoint).timestamp === "number" &&
            typeof (p as PoolMigrationDayPoint).toIronwoodZat === "number",
        )
      ) {
        throw new Error("chain API returned an unrecognised pool migration series");
      }
      return body as PoolMigrationDayPoint[];
    },

    async getStats(): Promise<Stats> {
      const body = await json<Partial<Stats>>(await request(config, "/chain/stats"), "stats");
      /*
       * Shape check, deliberately shallow: a version-skew tripwire, not validation (the API is
       * ours). The price is not required, because null is its normal state on a freshly
       * restarted API.
       */
      const shielded = body.shielded;
      if (
        typeof body.height !== "number" ||
        typeof shielded !== "object" ||
        shielded === null ||
        !Array.isArray(shielded.pools) ||
        typeof shielded.circulatingSupplyZat !== "number" ||
        typeof shielded.totalShieldedZat !== "number" ||
        typeof body.asOf !== "number"
      ) {
        throw new Error("chain API returned an unrecognised stats shape");
      }
      return {
        // finiteOrNull, never a bare cast: `typeof x === "number"` admits NaN.
        priceUsd: finiteOrNull(body.priceUsd),
        changeTodayPct: finiteOrNull(body.changeTodayPct),
        shielded: {
          pools: shielded.pools,
          totalShieldedZat: shielded.totalShieldedZat,
          circulatingSupplyZat: shielded.circulatingSupplyZat,
          netShieldedTodayZat: finiteOrNull(shielded.netShieldedTodayZat),
        },
        height: body.height,
        asOf: body.asOf,
      };
    },

    async getPriceSeries(): Promise<Partial<Record<StatsRange, PriceSeries>>> {
      const body = await json<Record<string, unknown>>(
        await request(config, "/chain/stats/series"),
        "stats series",
      );
      if (typeof body !== "object" || body === null) {
        throw new Error("chain API returned an unrecognised stats series shape");
      }
      const out: Partial<Record<StatsRange, PriceSeries>> = {};
      for (const range of STATS_RANGES) {
        const entry = body[range] as Partial<PriceSeries> | undefined;
        // A range the API did not answer is absent; an older API loses a window, not the page.
        if (entry === undefined) continue;
        if (!Array.isArray(entry.points)) {
          throw new Error("chain API returned an unrecognised stats series shape");
        }
        // A series of one point cannot be drawn and would render an axis around nothing.
        if (entry.points.length > 1) out[range] = { range, points: entry.points };
      }
      return out;
    },

    async getPools(): Promise<ShieldedPool[]> {
      const body = await json<unknown>(await request(config, "/chain/pools"), "pools");
      if (!Array.isArray(body)) throw new Error("chain API returned an unrecognised pools shape");
      return body as ShieldedPool[];
    },

    async getOldestHeight(): Promise<number> {
      const body = await json<{ oldestHeight?: number }>(
        await request(config, "/chain/info", REVALIDATE_IMMUTABLE_SECONDS),
        "chain info",
      );
      return typeof body.oldestHeight === "number" ? body.oldestHeight : 0;
    },

    async listLatestBlocks(count: number): Promise<BlockSummary[]> {
      const body = await json<unknown>(
        await request(config, `/chain/blocks/latest?count=${count}`),
        "latest blocks",
      );
      const rows = Array.isArray(body) ? body.map(blockListRow) : null;
      if (rows === null || rows.some((row) => row === null)) {
        throw new Error("chain API returned an unrecognised blocks shape");
      }
      return rows as BlockSummary[];
    },

    async listBlocks(query: CursorQuery): Promise<CursorPage<BlockSummary>> {
      const res = await request(config, `/chain/blocks?${cursorSearchParams(query)}`);
      return rowsPage(await json<unknown>(res, "blocks"), blockListRow, "blocks");
    },

    /**
     * Cache window for a height-addressed block: within REORG_DEPTH of the tip the height→block
     * mapping can still change, so it gets the short window. Hash-addressed lookups are
     * immutable — a reorg mints a different hash.
     *
     * If the tip cannot be learned, use the short window: over-caching a reorgable block serves
     * wrong data, under-caching an immutable one costs a round trip.
     */
    async blockRevalidate(idOrHeight: string): Promise<number> {
      const height = Number(idOrHeight);
      if (!Number.isInteger(height) || idOrHeight.trim() === "") {
        return REVALIDATE_IMMUTABLE_SECONDS;
      }
      try {
        const tip = (await this.getChainFacts()).height;
        return tip - height < REORG_DEPTH
          ? REVALIDATE_REORGABLE_SECONDS
          : REVALIDATE_IMMUTABLE_SECONDS;
      } catch {
        return REVALIDATE_REORGABLE_SECONDS;
      }
    },

    async getBlock(idOrHeight: string): Promise<Block | undefined> {
      const res = await request(
        config,
        `/chain/blocks/${encodeURIComponent(idOrHeight)}`,
        await this.blockRevalidate(idOrHeight),
      );
      if (res.status === 404) return undefined;
      const body = await json<unknown>(res, "block");
      if (!isBlock(body)) throw new Error("chain API returned an unrecognised block shape");
      return body;
    },

    /**
     * Takes the whole `Block` rather than a height, matching `ExplorerDataSource` — the block
     * already carries its txids, so an adapter is free to batch rather than re-fetch.
     */
    async getBlockTransactions(block: Block): Promise<Transaction[]> {
      /*
       * The route is keyset-paginated; the block page wants one bounded page rather than a paging
       * control, so this asks for one page at the API's maximum (`limit=100`). A block with more
       * than 100 transactions renders partially, rather than streaming megabytes into a page.
       */
      const body = await json<unknown>(
        await request(
          config,
          `/chain/blocks/${block.height}/transactions?limit=100`,
          await this.blockRevalidate(String(block.height)),
        ),
        "block transactions",
      );
      const items = (body as { items?: unknown } | null)?.items;
      if (!Array.isArray(items) || !items.every(isTransaction)) {
        throw new Error("chain API returned an unrecognised transactions shape");
      }
      return items;
    },

    async listLatestTransactions(count: number): Promise<Transaction[]> {
      const body = await json<unknown>(
        await request(config, `/chain/transactions/latest?count=${count}`),
        "latest transactions",
      );
      if (!Array.isArray(body) || !body.every(isTransaction)) {
        throw new Error("chain API returned an unrecognised transactions shape");
      }
      return body;
    },

    async listTransactions(
      query: CursorQuery,
      kind: TxKindFilter,
    ): Promise<CursorPage<Transaction>> {
      const params = cursorSearchParams(query);
      if (kind !== "all") params.set("kind", kind);
      const res = await request(config, `/chain/transactions?${params}`);
      const body = await json<unknown>(res, "transactions");
      assertTxKindApplied(kind, body);
      return page(body, isTransaction, "transactions");
    },

    /**
     * Cached long even though a transaction inside reorg depth could move to a different block:
     * its depth is unknowable before fetching, and the failure mode is a stale confirmation
     * count after a shallow reorg — cosmetic, self-healing and rare.
     */
    async getTransaction(txid: string): Promise<Transaction | undefined> {
      const res = await request(
        config,
        `/chain/transactions/${encodeURIComponent(txid)}`,
        REVALIDATE_IMMUTABLE_SECONDS,
      );
      if (res.status === 404) return undefined;
      const body = await json<unknown>(res, "transaction");
      if (!isTransaction(body)) {
        throw new Error("chain API returned an unrecognised transaction shape");
      }
      return body;
    },

    async getAddress(address: string): Promise<AddressInfo | undefined> {
      // Not cached long: an address's balance changes whenever it is spent from.
      const res = await request(config, `/chain/addresses/${encodeURIComponent(address)}`);
      if (res.status === 404) return undefined;
      const body = await json<AddressInfo>(res, "address");
      if (typeof body !== "object" || body === null || !("kind" in body)) {
        throw new Error("chain API returned an unrecognised address shape");
      }
      return body;
    },

    async getAddressTransactions(
      address: string,
      query: CursorQuery,
    ): Promise<CursorPage<Transaction>> {
      const params = cursorSearchParams(query);
      const res = await request(
        config,
        `/chain/addresses/${encodeURIComponent(address)}/transactions?${params}`,
      );
      return page(
        await json<unknown>(res, "address transactions"),
        isTransaction,
        "address transactions",
      );
    },

    /**
     * The observed-reorg log. A minute's cache: events are append-only and rare, and a
     * page that trails a fresh reorg by a minute is still honest — `detectedAt` says when.
     */
    async listReorgEvents(query: CursorQuery): Promise<CursorPage<ReorgEvent>> {
      const res = await request(config, `/chain/reorgs?${cursorSearchParams(query)}`, CACHE_MINUTE);
      return page(await json<unknown>(res, "reorgs"), isReorgEvent, "reorgs");
    },

    async getReorgSummary(): Promise<ReorgSummary> {
      const body = await json<Partial<ReorgSummary>>(
        await request(config, "/chain/reorgs/summary", CACHE_MINUTE),
        "reorg summary",
      );
      if (
        typeof body.observedCount !== "number" ||
        typeof body.observingSince !== "number" ||
        (body.deepestDepth !== null && typeof body.deepestDepth !== "number")
      ) {
        throw new Error("chain API returned an unrecognised reorg summary shape");
      }
      return {
        observedCount: body.observedCount,
        deepestDepth: body.deepestDepth ?? null,
        observingSince: body.observingSince,
      };
    },

    /**
     * Market capitalisations for `/compare`.
     *
     * A 503 is an answer: the API returns it when its snapshot is missing or too old, which is
     * what the page's unavailable state is for, so it resolves to `null`. Any other non-OK
     * status throws — a 404 means the endpoint is not deployed and must stay loud.
     *
     * Cached for a minute; the upstream poll runs every five.
     */
    async getMarketSnapshot(): Promise<MarketSnapshot | null> {
      const res = await request(config, "/chain/market/assets", CACHE_MINUTE);
      if (res.status === 503) return null;
      const body = await json<Partial<MarketSnapshot>>(res, "market snapshot");
      if (
        typeof body.asOf !== "number" ||
        !isMarketAsset(body.zec) ||
        !Array.isArray(body.assets) ||
        !body.assets.every(isMarketAsset)
      ) {
        throw new Error("chain API returned an unrecognised market snapshot shape");
      }
      return { asOf: body.asOf, zec: body.zec, assets: body.assets };
    },

    /**
     * The ZIP index for `/zips`. A 503 (tracker cold) resolves to null; any other non-OK
     * throws. Cached for an hour: the tracker refreshes every six.
     */
    async getZipIndex(): Promise<ZipIndex | null> {
      const res = await request(config, "/chain/zips", CACHE_HOUR);
      if (res.status === 503) return null;
      const body = await json<Partial<ZipIndex>>(res, "zip index");
      if (
        typeof body.asOf !== "number" ||
        typeof body.skippedFiles !== "number" ||
        !Array.isArray(body.zips) ||
        body.zips.length === 0 ||
        !body.zips.every(
          (z) =>
            typeof z?.zip === "number" &&
            typeof z?.title === "string" &&
            typeof z?.status === "string" &&
            typeof z?.statusKind === "string",
        )
      ) {
        throw new Error("chain API returned an unrecognised zip index shape");
      }
      return {
        asOf: body.asOf,
        source: ZIP_SOURCE_NAME,
        skippedFiles: body.skippedFiles,
        zips: body.zips,
      };
    },

    /**
     * A ZNS name lookup. A 503 (no snapshot yet) resolves to null; any other non-OK throws.
     * The echoed name must be the one asked about: an answer to a different question would send
     * a reader to somebody else's address.
     *
     * Cached for 60 seconds; the API's snapshot is at most two minutes old.
     */
    async getZnsName(name: string): Promise<ZnsLookup | null> {
      const asked = parseZnsName(name);
      if (asked === null) throw new Error(`not a ZNS name: ${name}`);
      const res = await request(
        config,
        `/chain/zns/name/${encodeURIComponent(asked)}`,
        CACHE_MINUTE,
      );
      if (res.status === 503) return null;
      const body = await json<Partial<ZnsLookup>>(res, "zns lookup");
      if (
        typeof body.query !== "string" ||
        typeof body.withheld !== "boolean" ||
        typeof body.indexerHeight !== "number" ||
        typeof body.tipHeight !== "number" ||
        typeof body.asOf !== "number" ||
        !Array.isArray(body.registrations) ||
        !body.registrations.every(isZnsRegistration) ||
        !Array.isArray(body.history) ||
        !body.history.every(isZnsNameEvent)
      ) {
        throw new Error("chain API returned an unrecognised zns lookup shape");
      }
      if (body.query !== asked) {
        throw new Error(`chain API answered a zns lookup for ${body.query}, asked ${asked}`);
      }
      return {
        query: body.query,
        registrations: body.registrations,
        history: body.history,
        withheld: body.withheld,
        indexerHeight: body.indexerHeight,
        tipHeight: body.tipHeight,
        asOf: body.asOf,
      };
    },

    /**
     * The rich list, keyset-paginated. Five minutes: the balances are recomputed hourly and the
     * page prints the height they were computed at.
     */
    async listRichList(query: CursorQuery): Promise<CursorPage<RichListEntry>> {
      const res = await request(
        config,
        `/chain/rich-list?${cursorSearchParams(query)}`,
        CACHE_FIVE_MINUTES,
      );
      return page(await json<unknown>(res, "rich list"), isRichListEntry, "rich list");
    },

    async getRichListSummary(): Promise<RichListSummary> {
      const body = await json<Partial<RichListSummary>>(
        await request(config, "/chain/rich-list/summary", CACHE_FIVE_MINUTES),
        "rich list summary",
      );
      if (
        typeof body.height !== "number" ||
        typeof body.addressCount !== "number" ||
        typeof body.totalZat !== "number" ||
        typeof body.unattributedZat !== "number" ||
        !Array.isArray(body.bands) ||
        !Array.isArray(body.topShares) ||
        typeof body.asOf !== "number"
      ) {
        throw new Error("chain API returned an unrecognised rich list summary shape");
      }
      return {
        height: body.height,
        addressCount: body.addressCount,
        totalZat: body.totalZat,
        unattributedZat: body.unattributedZat,
        bands: body.bands,
        topShares: body.topShares,
        asOf: body.asOf,
      };
    },

    /**
     * Read back a published social post. The card route renders from this rather than a fresh
     * read, so the image shows exactly the figures the post text was composed from. A 404 (no
     * ledger row) resolves to `null`; any other non-OK throws.
     *
     * The route has already validated `kind` against `SOCIAL_POST_KINDS`.
     */
    async readSocialPost(
      kind: string,
      key: string,
    ): Promise<SocialPost<SocialSnapshot | SwapFigures | BoundaryFigures> | null> {
      const res = await request(
        config,
        `/chain/social/post/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`,
      );
      if (res.status === 404) return null;
      const body = await json<unknown>(res, "social post");
      if (!isSocialPost(kind, body)) {
        throw new Error("chain API returned an unrecognised social post shape");
      }
      return body;
    },

    /**
     * The live frame: the tip, the closes the boxes read, and the confirmed movements.
     *
     * A tip read on the source's tip window: the polling route forces it to zero with
     * `force-no-store`, and the prerendered page reads through `getPrerenderedDataSource`.
     *
     * A 503 rejects rather than resolving to null: there is no frame to draw, and an empty one
     * would claim the pools hold no ZEC.
     */
    async getPulseFrame(): Promise<PulseFrame> {
      const body = await json<Partial<PulseFrame>>(
        await request(config, "/chain/pulse/frame"),
        "pulse frame",
      );
      const window = body.window;
      if (
        !isFiniteNumber(body.tip) ||
        typeof window !== "object" ||
        window === null ||
        !isFiniteNumber(window.fromSeconds) ||
        !isFiniteNumber(window.toSeconds) ||
        !isPulseBlockPools(body.stocks) ||
        !Array.isArray(body.blocks) ||
        !body.blocks.every(isPulseBlock) ||
        !Array.isArray(body.swaps) ||
        !body.swaps.every(isPulseEvent) ||
        !Array.isArray(body.ledger) ||
        !body.ledger.every(isPulseLedgerRow)
      ) {
        throw new Error("chain API returned an unrecognised pulse frame shape");
      }
      return {
        window,
        tip: body.tip,
        stocks: body.stocks,
        blocks: body.blocks,
        swaps: body.swaps,
        // Only ever the literal `true`: an absent field must not become a `false` that reads as
        // "this is every crossing".
        ...(body.swapsTruncated === true ? { swapsTruncated: true as const } : {}),
        ledger: body.ledger,
      };
    },

    /**
     * The mempool layer, or `null` when our node has not been read. A 503 (tracker cold, or
     * no node configured) resolves to null. Never an empty snapshot: `{count: 0}` is a
     * measurement that the mempool held nothing, not a stand-in for an outage.
     */
    async getPulsePending(): Promise<PulsePendingFrame | null> {
      const res = await request(config, "/chain/pulse/pending");
      if (res.status === 503) return null;
      const body = await json<Partial<PulsePendingFrame>>(res, "pulse pending");
      if (
        !isFiniteNumber(body.asOf) ||
        !isFiniteNumber(body.count) ||
        !Array.isArray(body.events) ||
        !body.events.every(isPulseEvent)
      ) {
        throw new Error("chain API returned an unrecognised pulse pending shape");
      }
      return {
        asOf: body.asOf,
        count: body.count,
        events: body.events,
        ...(body.truncated === true ? { truncated: true as const } : {}),
      };
    },

    /**
     * One replay hour, refused unless the API echoes the hour asked for. An API that ignored
     * `?from`/`?to` would return a well-formed hour of some other time, and no shape check can
     * tell. A missing echo fails too, since that is what an older API sends.
     */
    async getPulseWindow(fromSeconds: number, toSeconds: number): Promise<PulseWindowFrame> {
      const body = await json<Partial<PulseWindowFrame>>(
        await request(config, `/chain/pulse/window?from=${fromSeconds}&to=${toSeconds}`),
        "pulse window",
      );
      const applied = body.applied;
      if (
        typeof applied !== "object" ||
        applied === null ||
        applied.fromSeconds !== fromSeconds ||
        applied.toSeconds !== toSeconds
      ) {
        throw new Error(
          `chain API applied window [${String(applied?.fromSeconds)}, ${String(applied?.toSeconds)}) ` +
            `for a request asking [${fromSeconds}, ${toSeconds})`,
        );
      }
      if (
        !Array.isArray(body.blocks) ||
        !body.blocks.every(isPulseBlock) ||
        !Array.isArray(body.swaps) ||
        !body.swaps.every(isPulseEvent)
      ) {
        throw new Error("chain API returned an unrecognised pulse window shape");
      }
      // Optional for compatibility: an API predating the hour's ledger sends no key, carried
      // through as absence rather than as an empty hour (opposite claims). When present it is
      // all-or-nothing like every other array here.
      const ledger = body.ledger;
      if (ledger !== undefined && (!Array.isArray(ledger) || !ledger.every(isPulseLedgerRow))) {
        throw new Error("chain API returned an unrecognised pulse window ledger shape");
      }
      return {
        applied: { fromSeconds, toSeconds },
        blocks: body.blocks,
        swaps: body.swaps,
        ...(body.truncated === true ? { truncated: true as const } : {}),
        ...(ledger === undefined ? {} : { ledger }),
        ...(body.ledgerTruncated === true ? { ledgerTruncated: true as const } : {}),
      };
    },

    /**
     * The three ribbon windows, or `null` while the day views have not been filled.
     *
     * A 503 ("not yet") resolves to null. Any other non-OK throws, including 404: that means
     * the endpoint is not deployed, which must stay loud rather than render as unavailable.
     *
     * Five minutes; the windows are day-grained.
     */
    async getPulseRibbons(): Promise<PulseRibbonsPayload | null> {
      const res = await request(config, "/chain/pulse/ribbons", CACHE_FIVE_MINUTES);
      if (res.status === 503) return null;
      const body = await json<Partial<PulseRibbonsPayload>>(res, "pulse ribbons");
      const windows = body.windows as Record<string, unknown> | undefined;
      if (
        !isFiniteNumber(body.asOf) ||
        !isFiniteNumber(body.height) ||
        typeof windows !== "object" ||
        windows === null ||
        // Every window, by name: two of three drawn under a three-way control would be a toggle
        // that silently does nothing.
        !PULSE_RIBBON_WINDOW_NAMES.every((name) => isPulseRibbonWindow(windows[name]))
      ) {
        throw new Error("chain API returned an unrecognised pulse ribbons shape");
      }
      return {
        asOf: body.asOf,
        height: body.height,
        windows: body.windows as PulseRibbonsPayload["windows"],
      };
    },

    /**
     * The halving schedule. Cached for five minutes: every subsidy is consensus, and the tip
     * the countdown is measured from barely moves; the page states the height it read.
     *
     * `observedIntervalSeconds` may be 0 ("not measured"); the domain then falls back to the
     * consensus target and the page says which it used.
     */
    async getHalvingSchedule(): Promise<HalvingSchedule> {
      const body = await json<Partial<HalvingSchedule>>(
        await request(config, "/chain/network/halving", CACHE_FIVE_MINUTES),
        "halving schedule",
      );
      if (
        typeof body.height !== "number" ||
        typeof body.observedIntervalSeconds !== "number" ||
        typeof body.asOf !== "number" ||
        !Array.isArray(body.events) ||
        body.events.length === 0 ||
        !body.events.every(isHalvingEvent) ||
        !Array.isArray(body.upcoming)
      ) {
        throw new Error("chain API returned an unrecognised halving schedule shape");
      }
      return {
        height: body.height,
        observedIntervalSeconds: body.observedIntervalSeconds,
        events: body.events,
        upcoming: body.upcoming,
        asOf: body.asOf,
      };
    },

    /*
     * `/mining`'s overview. The window is checked, not displayed: an API that ignored
     * `?window=` would answer the default window under a different chip.
     */
    async getMiningOverview(window: MiningWindowKey): Promise<MiningOverview> {
      const body = await json<unknown>(
        await request(config, `/chain/mining?window=${window}`, CACHE_MINUTE),
        "mining overview",
      );
      if (!isMiningOverview(body, window)) {
        throw new Error("chain API returned an unrecognised mining overview shape");
      }
      return body;
    },

    async getMiningTerms(): Promise<MiningTerms> {
      const body = await json<Partial<MiningTerms>>(
        await request(config, "/chain/mining/terms", CACHE_MINUTE),
        "mining terms",
      );
      const solps = body.networkSolps;
      if (
        typeof body.height !== "number" ||
        typeof body.difficulty !== "number" ||
        typeof solps !== "object" ||
        solps === null ||
        typeof solps.value !== "number" ||
        (solps.basis !== "node" && solps.basis !== "estimated") ||
        typeof body.minerSubsidyZat !== "number" ||
        typeof body.subsidyChangesAtHeight !== "number" ||
        typeof body.blockIntervalSeconds !== "number" ||
        !(typeof body.priceUsd === "number" || body.priceUsd === null) ||
        typeof body.asOf !== "number"
      ) {
        throw new Error("chain API returned an unrecognised mining terms shape");
      }
      return {
        height: body.height,
        difficulty: body.difficulty,
        networkSolps: { value: solps.value, basis: solps.basis },
        minerSubsidyZat: body.minerSubsidyZat,
        subsidyChangesAtHeight: body.subsidyChangesAtHeight,
        blockIntervalSeconds: body.blockIntervalSeconds,
        // TAZ has no market: the same null the price everywhere else takes on testnet.
        priceUsd: isTestnet ? null : finiteOrNull(body.priceUsd),
        asOf: body.asOf,
      };
    },

    /*
     * The node map, `/network`: reads off one server-side snapshot plus our own node's peer
     * table. Every body passes `assertNoAddressLiterals` before its shape check — the crawler
     * stores full addresses and the routes publish derived facts only, and this is an
     * independent second layer keeping addresses off rendered pages.
     *
     * Cached a minute; the API's own snapshot is 30 s.
     */
    async getNetworkSummary(): Promise<NetSummary> {
      const body = await json<unknown>(
        await request(config, "/chain/network/summary", CACHE_MINUTE),
        "network summary",
      );
      assertNoAddressLiterals(body, NETMAP_ADDRESS_GUARD);
      if (!isNetSummary(body)) {
        throw new Error("chain API returned an unrecognised network summary shape");
      }
      return body;
    },

    async getNetworkMap(): Promise<NetMap> {
      const body = await json<unknown>(
        await request(config, "/chain/network/map", CACHE_MINUTE),
        "network map",
      );
      assertNoAddressLiterals(body, NETMAP_ADDRESS_GUARD);
      if (!isNetMap(body)) throw new Error("chain API returned an unrecognised network map shape");
      return body;
    },

    /**
     * The scope is echoed and a mismatch refused: an API that ignored `?scope=all` would answer
     * a well-formed hubs-only graph. The sky is fetched after mount through
     * `/api/network/topology`, so this cache is that route handler's.
     */
    async getNetworkTopology(scope: NetTopologyScope): Promise<NetTopology> {
      const path =
        scope === "all" ? "/chain/network/topology?scope=all" : "/chain/network/topology";
      const body = await json<unknown>(
        await request(config, path, CACHE_MINUTE),
        "network topology",
      );
      assertNoAddressLiterals(body, NETMAP_ADDRESS_GUARD);
      if (!isNetTopology(body)) {
        throw new Error("chain API returned an unrecognised network topology shape");
      }
      if (body.scope !== scope) {
        throw new Error(`chain API answered the ${body.scope} topology for a ${scope} request`);
      }
      return body;
    },

    async getNetworkHealth(): Promise<NetHealth> {
      const body = await json<unknown>(
        await request(config, "/chain/network/health", CACHE_MINUTE),
        "network health",
      );
      assertNoAddressLiterals(body, NETMAP_ADDRESS_GUARD);
      if (!isNetHealth(body)) {
        throw new Error("chain API returned an unrecognised network health shape");
      }
      return body;
    },

    /**
     * A null filter is omitted from the URL, so an unfiltered request keeps one cache key. The
     * echo is compared to what was sent: an API one deploy behind would drop `?client=` and
     * answer with every node.
     */
    async listNetworkNodes(query: CursorQuery, filters: NetNodeFilters): Promise<NetNodePage> {
      const params = cursorSearchParams(query);
      if (filters.client !== null) params.set("client", filters.client);
      if (filters.asn !== null) params.set("asn", String(filters.asn));
      const body = await json<unknown>(
        await request(config, `/chain/network/nodes?${params.toString()}`),
        "network nodes",
      );
      assertNoAddressLiterals(body, NETMAP_ADDRESS_GUARD);
      if (!isNetNodePage(body)) {
        throw new Error("chain API returned an unrecognised network nodes shape");
      }
      if (body.applied.client !== filters.client || body.applied.asn !== filters.asn) {
        throw new Error(
          `chain API applied a different node filter (client ${String(body.applied.client)}, ` +
            `asn ${String(body.applied.asn)}) than the one requested`,
        );
      }
      return body;
    },

    async getNetworkCrawls(): Promise<NetCrawlHistory> {
      const body = await json<unknown>(
        await request(config, "/chain/network/crawls", CACHE_MINUTE),
        "network crawls",
      );
      assertNoAddressLiterals(body, NETMAP_ADDRESS_GUARD);
      if (!isNetCrawlHistory(body)) {
        throw new Error("chain API returned an unrecognised network crawls shape");
      }
      return body;
    },

    /**
     * Our node's peer table. A 503 (node unreadable) resolves to `null`, rendered as
     * "not read" — never a count of zero. A 404 means the route is not mounted and throws.
     * Thirty seconds, matching the API's cache of `getpeerinfo`.
     */
    async getNetworkPeers(): Promise<NetPeers | null> {
      const res = await request(config, "/chain/network/peers");
      if (res.status === 503) return null;
      const body = await json<unknown>(res, "network peers");
      assertNoAddressLiterals(body, NETMAP_ADDRESS_GUARD);
      if (!isNetPeers(body)) {
        throw new Error("chain API returned an unrecognised network peers shape");
      }
      return body;
    },

    /**
     * Raw release groups and the daily record. Readiness is decided page-side from
     * `domain/network-upgrade.ts`, so a release that ships support is a frontend change.
     */
    async getNetworkReleases(): Promise<NetReleases> {
      const body = await json<unknown>(
        await request(config, "/chain/network/releases", CACHE_MINUTE),
        "network releases",
      );
      assertNoAddressLiterals(body, NETMAP_ADDRESS_GUARD);
      if (!isNetReleases(body)) {
        throw new Error("chain API returned an unrecognised network releases shape");
      }
      return body;
    },

    async listMempool(page: number, pageSize: number): Promise<Paginated<MempoolEntry>> {
      // The mempool has no immutable form.
      const body = await json<Paginated<MempoolEntry>>(
        await request(config, `/chain/mempool?page=${page}&pageSize=${pageSize}`, 5),
        "mempool",
      );
      if (!Array.isArray(body.items) || !body.items.every(isMempoolEntry)) {
        throw new Error("chain API returned an unrecognised mempool shape");
      }
      return { items: body.items, totalPages: body.totalPages };
    },
  };
}
