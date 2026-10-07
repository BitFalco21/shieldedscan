import { Hono } from "hono";
import type { Pool } from "pg";
import type {
  AddressInfo,
  Block,
  ChainWindowAggregate,
  CrossChainTransfer,
  CrossChainVolumeSeries,
  FeeDistribution,
  IronwoodInflow,
  MempoolStats,
  ShieldingFlowPoint,
  SupplyBreakdown,
  Transaction,
} from "@/domain";
import { parseChainWindowGroupBy, parseUtcDayStart } from "@/domain";
import type { ChainIndexStore } from "../../chain-index-store";
import { selectWrappedZecPools, type WrappedZecPoolSnapshot } from "@/data/defillama/zec-pools";
import { bearerAuth } from "../../auth";
import { WRAPPED_ZEC_POOLS_PATH } from "../../defillama-routes";
import { ZIP_INDEX_PATH } from "../../zips-routes";
import { getZipIndex } from "@/fixtures/zips";
import { MARKET_ASSETS_PATH } from "../../market-routes";
import { TX_COUNTS_PATH } from "../../analytics-routes";
import { MemoryStorePort } from "../../crosschain-store";
import { crosschainRoutes } from "../../crosschain-routes";
import { type V1ChainPort, v1Routes } from "../../v1/routes";
import { V1_MINERS_PATH, v1MinersRoutes } from "../../v1/miners";
import type { MinerWindow } from "../../mining-daily";
import type { TransparentSeries } from "../../transparent-daily";
import { V1_TRANSPARENT_PATH, v1TransparentRoutes } from "../../v1/transparent-series";
import { INSIGHT_TOPICS, type ChainRequester } from "../tools";
import PUBLISHED from "./__fixtures__/v1-published-series.json";

/**
 * A real /v1 sub-app over faked chain data, shared by the agent's tests and by the eval runner's
 * fixture-world cases. The chain port is faked the way v1-routes.test.ts fakes it; the routing is
 * real, so a renamed /v1 path breaks the agent tests in the same commit.
 *
 * Below it, the same treatment for the private API the aggregate tools dispatch at: a Hono app
 * behind production's own `bearerAuth` middleware, serving domain-typed fixtures at the paths
 * `INSIGHT_TOPICS` names. The real middleware means a dispatch that forgets the bearer header fails
 * here as it would in production, and taking paths from the tool's own table means the harness
 * cannot 404 on a typo. Whether those paths exist on the deployed service needs Postgres;
 * `tools.test.ts` reads the production route tables for that half.
 */

/**
 * The clock the whole fixture world is dated against: 2026-08-03, 10:14:22 UTC. One shared value,
 * because the loop injects the date into the prompt: a case asking about "last month" must resolve
 * against the same month the fixtures are written for.
 */
export const FIXTURE_NOW_MS = Date.UTC(2026, 7, 3, 10, 14, 22);

export const TXID = "ab".repeat(32);

export const TX: Transaction = {
  txid: TXID,
  blockHeight: 3_428_150,
  blockHash: "cd".repeat(32),
  timestamp: 1_785_000_000,
  isCoinbase: false,
  version: 5,
  sizeBytes: 1_000,
  lockTime: 0,
  expiryHeight: null,
  rawHex: null,
  feeZat: 30_000,
  bindingSigValid: null,
  transparentInputs: [],
  transparentOutputs: [],
  sprout: null,
  sapling: null,
  orchard: { actions: 2, valueBalanceZat: -30_000 },
  ironwood: { actions: 4, valueBalanceZat: 0 },
};

export const BLOCK: Block = {
  height: 3_428_150,
  hash: "00".repeat(32),
  prevHash: "22".repeat(32),
  timestamp: 1_785_000_000,
  sizeBytes: 4_000,
  txids: [TXID],
  version: 4,
  difficulty: 60_000_000,
  bits: "1f07ffff",
  nonce: "11".repeat(32),
  merkleRoot: "ef".repeat(32),
  finalSaplingRoot: null,
  finalOrchardRoot: null,
  composition: { transparentTxs: 1, mixedTxs: 0, shieldedTxs: 1 },
  miner: { kind: "transparent", address: "t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf" },
  coinbaseTag: null,
  fundingStreams: [],
  blockRewardZat: null,
  totalFeeZat: null,
};

export const SUPPLY: SupplyBreakdown = {
  height: 3_429_000,
  pools: [
    { pool: "transparent", balanceZat: 1_560_000_000_000_000 },
    { pool: "sprout", balanceZat: 2_994_923_783 },
    { pool: "sapling", balanceZat: 5_900_000_000_000 },
    { pool: "orchard", balanceZat: 36_000_000_000_000 },
    { pool: "ironwood", balanceZat: 1_700_000_000_000 },
    { pool: "lockbox", balanceZat: 800_000_000_000 },
  ],
};

/**
 * The price poller's reading, as `/v1/chain` and `/v1/status` serve it. Without it every
 * `balanceUsd` is null and "a pool total is public, in dollars too" could not be tested. $60 values
 * the fixture's 17,000 ZEC Ironwood balance at exactly $1.02M, a figure no rounding or misplaced
 * factor of ten lands on by accident.
 */
export const PRICE = { usd: 60, change24hPct: 2.5 };

export const MEMPOOL: MempoolStats = {
  pendingCount: 12,
  totalSizeBytes: 34_000,
  medianFeeZat: null,
  medianFeeRateZatPerByte: null,
  composition: null,
};

/**
 * A transparent address with a history, so `lookup_address` has something to drill into. The
 * shielded case is exercised separately: "no listable history" and "an empty history" are different
 * facts with their own corpus cases.
 */
export const ADDRESS_INFO: AddressInfo = {
  address: "t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf",
  kind: "transparent",
  balanceZat: 4_200_000_000,
  totalReceivedZat: 9_000_000_000,
  totalSentZat: 4_800_000_000,
  txids: [TXID],
};

export function chainPort(): V1ChainPort {
  return {
    getChainFacts: async () => ({
      height: 3_429_000,
      bestBlockHash: "00".repeat(32),
      lastBlockTimestamp: 1_785_000_000,
      circulatingSupplyZat: 16_000_000_00000000,
    }),
    getSupplyBreakdown: async () => SUPPLY,
    getTransaction: async (txid: string) => (txid === TXID ? TX : undefined),
    // Non-empty because `chain_activity`'s `recent-blocks` mode reads this route, and an empty page
    // would let a note about "the newest few rows" be graded against no rows.
    getTip: async () => ({ height: BLOCK.height, hash: BLOCK.hash }),
    blocksDescending: async () => [BLOCK],
    getBlock: async (idOrHeight: string) => (idOrHeight === "3428150" ? BLOCK : undefined),
    getBlockTransactions: async () => [TX],
    getAddress: async (address: string) =>
      address === ADDRESS_INFO.address ? ADDRESS_INFO : undefined,
    getMempoolStats: async () => MEMPOOL,
    // The live node's reply at height 3,447,900, stream labels included — "Major Grants" is what it
    // calls the slot ZIP 214 revision 2 directs to the FPF. Kept verbatim so tests exercise the
    // same label discrepancy production has.
    getBlockSubsidy: async () => ({
      miner: 1.25,
      founders: 0,
      fundingstreamstotal: 0.125,
      lockboxtotal: 0.1875,
      totalblocksubsidy: 1.5625,
      fundingstreams: [
        {
          recipient: "Major Grants",
          specification: "https://zips.z.cash/zip-0214",
          value: 0.125,
          valueZat: 12_500_000,
          address: "t3cFfPt1Bcvgez9ZbMBFWeZsskxTkPzGCow",
        },
      ],
      lockboxstreams: [
        {
          recipient: "Lockbox NU6",
          specification: "https://zips.z.cash/zip-0214",
          value: 0.1875,
          valueZat: 18_750_000,
        },
      ],
    }),
  };
}

/**
 * Daily ZEC/USD closes as `zec_price_daily` holds them; every property is deliberate.
 *
 * Eight consecutive days, so a 7-day window is a strict subset of the series. The closes rise from
 * 40.00 to 47.00, so the change over the last seven days (41.00 → 47.00, +$6.00, +14.6%) differs
 * from the change over all eight (+$7.00, +17.5%): a case asserting one figure measures that our
 * window was quoted rather than the model's own subtraction.
 *
 * The newest day is the day before the fixture clock (2026-08-03): a daily close exists only for a
 * day that has ended, so a fixture holding today's close would let a window anchored on today pass
 * here and fall a day short against the real table.
 *
 * Two sources, changing mid-series. Aggregators differ by a median 2.2% on the same day, so a
 * window spanning both must say so rather than averaging them; a single-source fixture could not
 * fail that.
 */
export const DAILY_PRICES: readonly { day: string; usd: number; source: string }[] = [
  { day: "2026-07-26", usd: 40, source: "coincodex" },
  { day: "2026-07-27", usd: 41, source: "coincodex" },
  { day: "2026-07-28", usd: 42, source: "yahoo" },
  { day: "2026-07-29", usd: 43, source: "yahoo" },
  { day: "2026-07-30", usd: 44, source: "yahoo" },
  { day: "2026-07-31", usd: 45, source: "yahoo" },
  { day: "2026-08-01", usd: 46, source: "yahoo" },
  { day: "2026-08-02", usd: 47, source: "yahoo" },
];

/**
 * The reorg log's two rows, as `reorg_event` holds them. Depths 1 and 2, because "depth-1 reorgs
 * are routine" is a framing rule and a single row cannot exercise a deepest-depth figure.
 */
export const REORG_EVENTS: readonly {
  detected_at: number;
  height: number;
  depth: number;
  orphaned_hash: string;
  replaced_by: string;
}[] = [
  {
    detected_at: 1_784_900_000,
    height: 3_428_900,
    depth: 1,
    orphaned_hash: "aa".repeat(32),
    replaced_by: "bb".repeat(32),
  },
  {
    detected_at: 1_784_100_000,
    height: 3_420_100,
    depth: 2,
    orphaned_hash: "cc".repeat(32),
    replaced_by: "dd".repeat(32),
  },
];

/** When this node started watching. Nothing before it is in the log, and it is never backdated. */
export const REORG_OBSERVING_SINCE = 1_783_000_000;

/**
 * Postgres as the agent's `/v1` routes use it: the daily closes and the reorg log. An unrecognised
 * query throws rather than answering `{rows: []}`, so a route cannot quietly serve "no data" from a
 * store never asked the right question. `day` is a `Date` because the price route calls
 * `.toISOString()` on it; a string would pass here and fail in production.
 */
function agentPool(rows: readonly { day: string; usd: number; source: string }[]) {
  return {
    query: async (sql: string, params: unknown[]) => {
      /*
       * The series bounds. This branch must precede the page query below, since both name
       * `zec_price_daily` and the bounds query takes no parameters — falling into the page branch
       * would destructure `undefined` and 500 the route. Answered from the same `rows` as the page,
       * so the fixture can express a capped page whose `firstDay` is years after `availableFrom`.
       */
      // The all-time extremes over the whole series, from the same rows the page is served from, so
      // a narrow page still carries the record. Precedes the page branch for the same reason the
      // bounds do.
      if (sql.includes("AS kind")) {
        const byUsd = [...rows].sort((a, b) => a.usd - b.usd || a.day.localeCompare(b.day));
        const asRow = (kind: string, r: { day: string; usd: number; source: string }) => ({
          kind,
          day: new Date(`${r.day}T00:00:00Z`),
          usd: r.usd,
          source: r.source,
        });
        return {
          rows: byUsd.length === 0 ? [] : [asRow("high", byUsd.at(-1)!), asRow("low", byUsd[0]!)],
        };
      }
      // Block timestamps for the halving events (`loadHalvingEvents`): the real mainnet stamps for
      // Blossom and the two halvings, so `atUtc` renders a real day.
      if (sql.includes("FROM block WHERE height = ANY")) {
        const stamps: Record<number, number> = {
          653_600: 1_576_101_005,
          1_046_400: 1_605_702_856,
          2_726_400: 1_732_359_779,
        };
        const heights = (params as [number[]])[0];
        return {
          rows: heights
            .filter((h) => h in stamps)
            .map((h) => ({ height: h, timestamp: stamps[h]! })),
        };
      }
      if (sql.includes("min(day)")) {
        const days = [...rows].map((r) => r.day).sort();
        return {
          rows: [
            {
              from: days[0] === undefined ? null : new Date(`${days[0]}T00:00:00Z`),
              to: days.at(-1) === undefined ? null : new Date(`${days.at(-1)!}T00:00:00Z`),
            },
          ],
        };
      }
      if (sql.includes("zec_price_daily")) {
        const [from, to, limit] = params as [string | null, string | null, number];
        const inRange = rows.filter(
          (r) => (from === null || r.day >= from) && (to === null || r.day <= to),
        );
        // Newest-first then re-ordered ascending, as the route's own subquery does: the cap must
        // bite on the newest rows, or a truncation test would window the wrong end.
        const kept = inRange.slice(-limit);
        return {
          rows: kept.map((r) => ({
            day: new Date(`${r.day}T00:00:00Z`),
            usd: r.usd,
            source: r.source,
          })),
        };
      }
      /*
       * One address's standing on the rich list, for `/v1/addresses/:addr`. `computed_height` is
       * deliberately below the fixture tip of 3,429,000, because the hourly refresh always ranks as
       * of a height behind the chain; a fixture using the tip would let the "quote rankAsOfHeight,
       * never the tip" rule pass against a payload where the two agree.
       *
       * A non-matching address returns the meta row with a null `matched` — the real shape of a
       * LEFT JOIN miss, and the input that produces `unknowns.rank = "nonexistent"`.
       */
      if (sql.includes("chain_address_balance")) {
        const [address] = params as [string];
        const onList = address === ADDRESS_INFO.address;
        return {
          rows: [
            {
              matched: onList ? address : null,
              rank: onList ? "4127" : null,
              tx_count: onList ? "812" : null,
              computed_height: 3_428_900,
            },
          ],
        };
      }
      if (sql.includes("reorg_observation")) {
        return { rows: [{ observing_since: REORG_OBSERVING_SINCE }] };
      }
      if (sql.includes("reorg_event")) {
        // The summary aggregates and the list selects rows; distinguished by the aggregate's column
        // names rather than by argument count.
        if (/count\(|max\(/i.test(sql)) {
          return {
            rows: [
              {
                observed_count: REORG_EVENTS.length,
                deepest_depth: Math.max(...REORG_EVENTS.map((e) => e.depth)),
                observing_since: REORG_OBSERVING_SINCE,
              },
            ],
          };
        }
        return { rows: [...REORG_EVENTS] };
      }
      throw new Error(`the agent harness's pool does not serve: ${sql}`);
    },
  } as unknown as Pool;
}

/**
 * The chain index, for the list endpoints `/v1` serves from Postgres. A structural stub cast to the
 * class: a real `ChainIndexStore` would need a pool answering its keyset SQL, a second
 * implementation of the thing under test. What the agent tests need is that the routes exist and
 * shape their pages, and that is real.
 */
/**
 * `tx` is the override `makeV1` was given, if any. `/v1` transaction detail reads the index first
 * and falls back to the node only on a miss, so an override reaching only the chain port would be
 * invisible whenever it reuses a txid the index answers.
 */
function chainIndexStub(tx?: Transaction): ChainIndexStore {
  const page = { items: [TX], nextCursor: null, prevCursor: null };
  return {
    listChainTransactions: async (kind: string) => ({
      // A kind the fixture transaction is not: an empty page, which must read as "none recorded"
      // rather than a broken filter. `TX` is Orchard+Ironwood with no transparent side.
      ...page,
      items: kind === "all" || kind === "shielded" ? [TX] : [],
    }),
    listTransactions: async () => page,
    listBlockTransactions: async () => page,
    // An empty index: the block list is served by the chain port, as wherever the index has not
    // stored a page.
    tipHeight: async () => null,
    getTransaction: async (txid: string) =>
      tx !== undefined && txid === tx.txid ? tx : txid === TXID ? TX : undefined,
  } as unknown as ChainIndexStore;
}

/**
 * Overrides exist for the eval corpus's poisoned worlds: a block whose coinbaseTag
 * carries an injection payload, a fully shielded transaction whose nulls must never
 * become numbers, a cross-chain transfer whose venue-supplied chain label does.
 * Tests that need the plain world call it bare.
 */
export function makeV1(
  overrides: Partial<{
    tx: Transaction;
    block: Block;
    /** Served in addition to `ADDRESS_INFO`, e.g. a labelled address. */
    address: AddressInfo;
    transfers: CrossChainTransfer[];
    /**
     * `null` is the price poller cold or failing — the state a pool's USD figure must survive
     * without inventing a zero.
     */
    price: { usd: number; change24hPct: number } | null;
    /** The daily-close table. `[]` is a store with no rows, which must never read as "no price". */
    dailyPrices: readonly { day: string; usd: number; source: string }[];
  }> = {},
) {
  const port = chainPort();
  if (overrides.tx) {
    const tx = overrides.tx;
    port.getTransaction = async (txid: string) => (txid === tx.txid ? tx : undefined);
  }
  if (overrides.address) {
    const extra = overrides.address;
    const base = port.getAddress;
    port.getAddress = async (address: string) =>
      address === extra.address ? extra : base(address);
  }
  if (overrides.block) {
    const block = overrides.block;
    port.getBlock = async (idOrHeight: string) =>
      idOrHeight === String(block.height) || idOrHeight === block.hash ? block : undefined;
  }
  const store = new MemoryStorePort();
  // `upsert` is async by the port's contract but runs synchronously, so the store is populated
  // before this function returns and no caller has to become async to seed a fixture.
  //
  // Seeded with the same rows the private routes serve, so the `crosschain` tool's modes describe
  // one dataset across two surfaces (`transfers` and `destinations` read /v1, `aggregate` reads the
  // private API).
  void store.upsert(overrides.transfers ?? CROSSCHAIN_TRANSFERS);
  return v1Routes({
    chain: port,
    store,
    pool: agentPool(overrides.dailyPrices ?? DAILY_PRICES),
    chainIndex: chainIndexStub(overrides.tx),
    reorgPollSeconds: 5,
    enabledProtocols: { maya: true, "near-intents": true, thorchain: false },
    extras: {
      price: { current: () => (overrides.price === undefined ? PRICE : overrides.price) },
    },
    // The extension the agent's 'miners' mode reads, as the agent container mounts it.
    extensions: [
      {
        routes: v1MinersRoutes({
          pool: {} as Pool,
          now: () => FIXTURE_NOW_MS,
          load: async () => MINER_WINDOW,
        }),
        endpoints: [V1_MINERS_PATH],
      },
      // And the one its 'transparent' mode reads.
      {
        routes: v1TransparentRoutes({
          pool: {} as Pool,
          now: () => FIXTURE_NOW_MS,
          load: async () => ({
            series: TRANSPARENT_SERIES,
            chainFirstDay: TRANSPARENT_SERIES.days[0]!.day,
          }),
        }),
        endpoints: [V1_TRANSPARENT_PATH],
      },
      // The published series the records, mining, nodes and pool facets read.
      { routes: publishedSeriesRoutes(), endpoints: [...PUBLISHED_SERIES_PATHS] },
    ],
  });
}

const PUBLISHED_FIXED_PATHS = [
  "/v1/analytics/records",
  "/v1/network/mining",
  "/v1/nodes",
  "/v1/nodes/geography",
  "/v1/nodes/concentration",
] as const;
const PUBLISHED_SERIES_PATHS = [
  ...PUBLISHED_FIXED_PATHS,
  "/v1/analytics/pool-usage",
  "/v1/analytics/pools",
] as const;

/**
 * The published records, mining terms, node map and pool series, served from payloads captured from
 * the production API rather than re-implemented SQL. These tests exercise the agent's dispatch,
 * notes, trims and echo checks; the routes' own correctness is tested beside the routes. The two
 * series echo the request's window, interval and pool as the real ones do, so the echo check is
 * genuinely exercised.
 */
function publishedSeriesRoutes(): Hono {
  const app = new Hono();
  for (const path of PUBLISHED_FIXED_PATHS) app.get(path, (c) => c.json(PUBLISHED[path]));
  const window = (q: (key: string) => string | undefined) => ({
    from: q("from") ?? null,
    to: q("to") ?? null,
    interval: q("interval") ?? "month",
  });
  app.get("/v1/analytics/pool-usage", (c) => {
    const base = PUBLISHED["/v1/analytics/pool-usage"];
    const pools = c.req.query("pool")?.split(",") ?? ["ironwood", "orchard", "sapling", "sprout"];
    const only = (byPool: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(byPool).filter(([name]) => pools.includes(name)));
    return c.json({
      ...base,
      query: { ...window((k) => c.req.query(k)), pool: pools },
      data: {
        ...base.data,
        totals: only(base.data.totals),
        points: base.data.points.map((point) => ({ ...point, pools: only(point.pools) })),
      },
    });
  });
  app.get("/v1/analytics/pools", (c) =>
    c.json({ ...PUBLISHED["/v1/analytics/pools"], query: window((k) => c.req.query(k)) }),
  );
  return app;
}

/**
 * Transparent activity through the fixture clock: July 2026 whole, August so far, and the trailing
 * windows the stored rows reach (7 and 30 days; 90 would need May). Every field is non-zero
 * somewhere — an unaddressed output, mixed volume on both sides, an unresolved input — so a note
 * describing one cannot pass against a payload without it.
 */
export const TRANSPARENT_SERIES: TransparentSeries = (() => {
  const DAY = 86_400;
  const start = Date.UTC(2026, 6, 1) / 1000;
  const days = Array.from({ length: 33 }, (_, i) => ({
    day: start + i * DAY,
    outputs: 9_000 + i * 10,
    unaddressedOutputs: 3,
    outTransparentZat: 40_000_000_000_000 + i * 100_000_000,
    outMixedZat: 900_000_000_000,
    inputs: 11_000 + i * 10,
    unresolvedInputs: i === 31 ? 1 : 0,
    inTransparentZat: 40_000_100_000_000,
    inMixedZat: 950_000_000_000,
    active: 6_000 + i,
    sending: 4_000,
    receiving: 5_000,
  }));
  const yesterday = start + 32 * DAY;
  return {
    days,
    months: [
      {
        month: start,
        active: 61_000,
        sending: 30_000,
        receiving: 45_000,
        days: 31,
        complete: true,
      },
      {
        month: start + 31 * DAY,
        active: 9_100,
        sending: 6_000,
        receiving: 7_500,
        days: 2,
        complete: false,
      },
    ],
    trailing: [
      { days: 7, lastDay: yesterday, active: 21_000, sending: 12_000, receiving: 16_000 },
      { days: 30, lastDay: yesterday, active: 58_000, sending: 29_000, receiving: 43_000 },
    ],
  };
})();

/**
 * Who mined the fixture's window, in the proportions of a real month (34,405 blocks, the top
 * address near 30%), with every kind present — a shielded coinbase, a bare-key block and an
 * unrecorded one — and a folded tail, so a note describing them has something to fail against.
 */
export const MINER_WINDOW: MinerWindow = {
  daysComputed: 30,
  blocks: 34_405,
  unrecordedBlocks: 2,
  fromHeight: 3_394_000,
  toHeight: 3_429_000,
  transparent: { blocks: 32_840, addresses: 28 },
  shieldedBlocks: 1_562,
  noAddressBlocks: 1,
  top: [
    {
      rank: 1,
      address: "t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7",
      blocks: 10_277,
      rewardZat: 1_287_376_194_246,
      feeZat: 2_751_194_246,
      firstHeight: 3_394_002,
      lastHeight: 3_428_999,
      newestCoinbaseTag: "🌸",
    },
    {
      rank: 2,
      address: "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP",
      blocks: 4_858,
      rewardZat: 608_850_277_380,
      feeZat: null,
      firstHeight: 3_394_005,
      lastHeight: 3_428_990,
      newestCoinbaseTag: "🦓jFoundry Zcash Pool #PrivacyMatters",
    },
  ],
  topBlocks: { top1: 10_277, top3: 20_503, top10: 32_288 },
  chainFirstDay: Date.UTC(2016, 9, 28) / 1000,
};

/** A venue-published transfer, for the cross-chain aggregates. */
export function transfer(overrides: Partial<CrossChainTransfer> = {}): CrossChainTransfer {
  return {
    id: "near-intents:fixture-1",
    direction: "out",
    protocol: "near-intents",
    counterpartChain: "ETH",
    counterpartAsset: "ETH",
    counterpartAmount: 1.5,
    counterpartIsSynthetic: false,
    counterpartTxHash: null,
    counterpartAddress: null,
    counterpartUsdAtSwap: null,
    venueDepositAddress: null,
    zcashTxid: null,
    zcashAddress: null,
    zecAmountZat: 120_000_000_000,
    usdValueAtSwap: null,
    status: "completed",
    timestamp: 1_784_000_000,
    ...overrides,
  };
}

/**
 * The transfers the private cross-chain routes serve. Two chains and two venues so a group
 * breakdown is non-trivial; two months so a window can exclude one; both directions so nothing nets
 * by accident; and a mixture of priced and unpriced legs, since `usdCoveredTransfers` is what makes
 * the dollar figure quotable.
 *
 * The June row sits on the last second of June and the August row on the first instant of August,
 * so a July window including either edge is visibly wrong.
 */
export const CROSSCHAIN_TRANSFERS: CrossChainTransfer[] = [
  transfer({
    id: "maya:june-btc",
    direction: "in",
    protocol: "maya",
    counterpartChain: "BTC",
    counterpartAsset: "BTC",
    zecAmountZat: 100_000_000_000,
    usdValueAtSwap: 4_000,
    timestamp: Math.floor(Date.parse("2026-06-30T23:59:59Z") / 1000),
  }),
  transfer({
    id: "maya:july-btc-in",
    direction: "in",
    protocol: "maya",
    counterpartChain: "BTC",
    counterpartAsset: "BTC",
    zecAmountZat: 900_000_000_000,
    usdValueAtSwap: 36_000,
    timestamp: Math.floor(Date.parse("2026-07-02T00:00:00Z") / 1000),
  }),
  transfer({
    id: "maya:july-btc-in-unpriced",
    direction: "in",
    protocol: "maya",
    counterpartChain: "BTC",
    counterpartAsset: "BTC",
    zecAmountZat: 300_000_000_000,
    // The venue published no price: it still counts as a crossing and adds no dollars, which is
    // what makes the total a floor.
    usdValueAtSwap: null,
    timestamp: Math.floor(Date.parse("2026-07-03T00:00:00Z") / 1000),
  }),
  transfer({
    id: "near-intents:july-eth-out",
    direction: "out",
    protocol: "near-intents",
    counterpartChain: "ETH",
    counterpartAsset: "ETH",
    zecAmountZat: 5_000_000_000_000,
    usdValueAtSwap: 200_000,
    timestamp: Math.floor(Date.parse("2026-07-20T00:00:00Z") / 1000),
  }),
  transfer({
    id: "maya:august-btc-out",
    direction: "out",
    protocol: "maya",
    counterpartChain: "BTC",
    counterpartAsset: "BTC",
    zecAmountZat: 700_000_000_000,
    usdValueAtSwap: 28_000,
    timestamp: Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000),
  }),
];

/**
 * A store for the real routes the harness mounts. Takes the rows rather than closing over the
 * constant, because a venue-supplied chain label is an injection carrier that surfaces in the
 * aggregate's group keys, and an eval case poisoning that label must reach this store.
 */
function crosschainStore(transfers: readonly CrossChainTransfer[]): MemoryStorePort {
  const store = new MemoryStorePort();
  void store.upsert(transfers);
  return store;
}

// ------------------------------------------------------- the private analytics API

/** The harness's bearer token. Only ever compared against itself. */
export const CHAIN_TOKEN = "harness-bearer-token";

/**
 * Ironwood's balance and what accounts for it. The terms reconcile to `balanceZat` exactly, as on
 * the chain — 740,000 from Orchard + 27,000 from Sapling + 57,750 shielded from transparent + 251
 * mined − 1 in fees = 825,000 ZEC — because a fixture that did not close would let an answer that
 * apportions look correct. 57,750 of 825,000 is exactly 7.0%, so `freshShieldingPct` has an
 * unambiguous answer.
 */
export const IRONWOOD_INFLOW: IronwoodInflow = {
  activationHeight: 3_428_143,
  balanceZat: 82_500_000_000_000,
  netFromOrchardZat: 74_000_000_000_000,
  netFromSaplingZat: 2_700_000_000_000,
  netFromSproutZat: 0,
  netFromTransparentZat: 5_775_000_000_000,
  fromTransparentTxCount: 3_412,
  txCount: 9_640,
  minedZat: 25_100_000_000,
  feesPaidZat: 100_000_000,
  balance: [
    { timestamp: 1_785_006_000, ironwoodZat: 80_100_000_000_000 },
    { timestamp: 1_785_009_600, ironwoodZat: 81_400_000_000_000 },
    { timestamp: 1_785_013_200, ironwoodZat: 82_500_000_000_000 },
  ],
  // Every window differs from its neighbours, so an answer quoting the wrong window is
  // distinguishable. The 24h window carries a non-Ironwood destination too, so an "all pairs"
  // question has something outside the turnstile to find, and the dollar strings carry both bases
  // so quoting verbatim is exercised.
  migrations: {
    sinceActivation: {
      txCount: 5_210,
      amountZat: 76_700_000_000_000,
      valueUsdText:
        "≈ $26,120,400.00 — days with a stored close at that close; the 37 transactions on days not yet closed at the current price ($34.00). Not each transfer's moment.",
      // Per-source dollars, on the block total's bases. Sprout is a measured zero and therefore
      // unpriced: null, never "$0.00".
      fromOrchard: {
        txCount: 4_980,
        amountZat: 73_600_000_000_000,
        valueUsdText: "≈ $25,024,000.00",
      },
      fromSapling: { txCount: 214, amountZat: 2_290_000_000_000, valueUsdText: "≈ $778,600.00" },
      fromSprout: { txCount: 0, amountZat: 0, valueUsdText: null },
      multiSource: { txCount: 16, amountZat: 810_000_000_000, valueUsdText: "≈ $275,400.00" },
    },
    last24Hours: {
      fromTimestamp: 1_784_930_400,
      txCount: 40,
      amountZat: 462_000_000_000,
      valueUsdText:
        "≈ $157,080.00 — days with a stored close at that close; the 40 transactions on days not yet closed at the current price ($34.00). Not each transfer's moment.",
      pairs: [
        {
          from: "orchard",
          to: "ironwood",
          txCount: 35,
          amountZat: 400_000_000_000,
          valueUsdText: "≈ $136,000.00",
        },
        {
          from: "sapling",
          to: "ironwood",
          txCount: 2,
          amountZat: 12_000_000_000,
          valueUsdText: "≈ $4,080.00",
        },
        {
          from: "sapling",
          to: "orchard",
          txCount: 3,
          amountZat: 50_000_000_000,
          valueUsdText: "≈ $17,000.00",
        },
      ],
    },
    last7Days: {
      fromTimestamp: 1_784_412_000,
      txCount: 304,
      amountZat: 3_200_000_000_000,
      valueUsdText:
        "≈ $1,088,000.00 — days with a stored close at that close; the 40 transactions on days not yet closed at the current price ($34.00). Not each transfer's moment.",
      pairs: [
        {
          from: "orchard",
          to: "ironwood",
          txCount: 290,
          amountZat: 3_020_000_000_000,
          valueUsdText: "≈ $1,026,800.00",
        },
        {
          from: "sapling",
          to: "ironwood",
          txCount: 10,
          amountZat: 100_000_000_000,
          valueUsdText: "≈ $34,000.00",
        },
        {
          from: "sapling",
          to: "orchard",
          txCount: 3,
          amountZat: 50_000_000_000,
          valueUsdText: "≈ $17,000.00",
        },
        {
          from: "multi",
          to: "ironwood",
          txCount: 1,
          amountZat: 30_000_000_000,
          valueUsdText: "≈ $10,200.00",
        },
      ],
    },
    last30Days: {
      fromTimestamp: 1_782_424_800,
      txCount: 1_208,
      amountZat: 12_460_000_000_000,
      valueUsdText:
        "≈ $4,236,400.00 — days with a stored close at that close; the 40 transactions on days not yet closed at the current price ($34.00). Not each transfer's moment.",
      pairs: [
        {
          from: "orchard",
          to: "ironwood",
          txCount: 1_160,
          amountZat: 11_900_000_000_000,
          valueUsdText: "≈ $4,046,000.00",
        },
        {
          from: "sapling",
          to: "ironwood",
          txCount: 40,
          amountZat: 420_000_000_000,
          valueUsdText: "≈ $142,800.00",
        },
        {
          from: "sapling",
          to: "orchard",
          txCount: 4,
          amountZat: 60_000_000_000,
          valueUsdText: "≈ $20,400.00",
        },
        {
          from: "multi",
          to: "ironwood",
          txCount: 4,
          amountZat: 80_000_000_000,
          valueUsdText: "≈ $27,200.00",
        },
      ],
    },
  },
};

/** The oldest day in both daily fixtures, a UTC midnight. Days run forward from here. */
const DAY_ONE = 1_784_419_200;
const DAY = 86_400;
const day = (index: number) => DAY_ONE + index * DAY;

/**
 * Gross flow in both directions. Day two (index 1) nets to almost nothing over ~19,600 ZEC
 * crossing, the property `insights-shielding-trend` exists for.
 *
 * Eight days, so a trailing 7-day window is a strict subset and the totals `enrichShieldingFlow`
 * supplies are testable against figures the model could only get from us. The net flips sign
 * between the windows (−263 ZEC over the last 7 days, +1,762 ZEC over all 8), so "say which window
 * you are describing" is load-bearing.
 */
export const SHIELDING_FLOW_DAYS: ShieldingFlowPoint[] = [
  { timestamp: day(0), shieldedZat: 411_200_000_000, unshieldedZat: 208_700_000_000 },
  { timestamp: day(1), shieldedZat: 981_700_000_000, unshieldedZat: 981_400_000_000 },
  { timestamp: day(2), shieldedZat: 145_900_000_000, unshieldedZat: 302_500_000_000 },
  { timestamp: day(3), shieldedZat: 220_000_000_000, unshieldedZat: 180_000_000_000 },
  { timestamp: day(4), shieldedZat: 310_000_000_000, unshieldedZat: 260_000_000_000 },
  { timestamp: day(5), shieldedZat: 190_000_000_000, unshieldedZat: 240_000_000_000 },
  { timestamp: day(6), shieldedZat: 260_000_000_000, unshieldedZat: 210_000_000_000 },
  { timestamp: day(7), shieldedZat: 330_000_000_000, unshieldedZat: 290_000_000_000 },
];

/**
 * The measured shape of the real thing: a fully shielded transaction's median fee is half a
 * transparent one's (10,000 against 20,000 zat), each kind with its own sample size, so
 * `shieldedVsTransparentPct` is exactly 50%.
 */
export const FEE_DISTRIBUTION: FeeDistribution = {
  windowDays: 90,
  recent: [
    {
      kind: "transparent",
      medianZat: 20_000,
      avgZat: 42_137,
      p25Zat: 10_000,
      p75Zat: 42_400,
      txs: 412_905,
    },
    {
      kind: "mixed",
      medianZat: 15_000,
      avgZat: 18_220,
      p25Zat: 15_000,
      p75Zat: 25_000,
      txs: 51_770,
    },
    {
      kind: "shielded",
      medianZat: 10_000,
      avgZat: 12_640,
      p25Zat: 10_000,
      p75Zat: 20_000,
      txs: 96_431,
    },
  ],
  monthly: [
    { timestamp: 1_781_913_600, transparentZat: 20_000, mixedZat: 15_000, shieldedZat: 10_000 },
    { timestamp: 1_784_592_000, transparentZat: 20_000, mixedZat: null, shieldedZat: 10_000 },
  ],
  /*
   * The all-time range, shaped as production serves it, with deliberately asymmetric ends. Every
   * minimum is a tie (61,045 transactions and 757,510 blocks at zero, real figures), so no single
   * record can be named and `id` is null; every maximum here is unique, so it can be. A fixture
   * with both ends unique would let an answer naming "the lowest-fee transaction" pass.
   *
   * The block maximum equals the transaction maximum, as on the real chain, where that one
   * fat-fingered transaction is its block's entire fee — so quoting one as the other is not hidden.
   */
  extremes: {
    transaction: {
      lowest: { feeZat: 0, count: 61_045, id: null, height: null },
      highest: {
        feeZat: 98_784_262_808,
        count: 1,
        id: "7a34e0c7bd9a381fa915da188da0a039d32d7d7b9bdec386757f5de2ec35c9d1",
        height: 3_065_135,
        // Pre-formatted "worth at the time": the caveat lives inside the string, so quoting
        // verbatim keeps it. The day and the source are part of the figure.
        usdAtCloseText:
          "≈ $53.2K at that day's close ($53.87, yahoo, 2025-07-08) — a daily close, not the moment's price, and not today's value",
      },
      considered: 14_567_850,
      // The smallest real fee, deliberately a tie, so an answer naming a "cheapest transaction" is
      // measurably wrong; only the figure and the count may be stated. `usdAtCloseText` is null
      // because a tie has no single day.
      lowestNonZero: { feeZat: 1, count: 218, id: null, height: null, usdAtCloseText: null },
    },
    block: {
      lowest: { feeZat: 0, count: 757_510, id: null, height: null },
      highest: {
        feeZat: 98_784_262_808,
        count: 1,
        id: "3065135",
        height: 3_065_135,
        usdAtCloseText:
          "≈ $53.2K at that day's close ($53.87, yahoo, 2025-07-08) — a daily close, not the moment's price, and not today's value",
      },
      considered: 3_451_306,
      // The block floor is unique here — the two scopes differ on purpose, so copying one scope's
      // naming decision onto the other fails.
      lowestNonZero: {
        feeZat: 60,
        count: 1,
        id: "1834007",
        height: 1_834_007,
        usdAtCloseText: null,
      },
    },
  },
  /*
   * The transparent value range, asymmetric on purpose: the minimum is a tie, the maximum unique.
   * `considered` is far below the fee range's 14.5M, since only transactions with a public amount
   * count; matching denominators would let an answer quoting the wrong one pass.
   */
  valueExtremes: {
    lowest: { feeZat: 1, count: 4_412, id: null, height: null },
    highest: {
      feeZat: 4_500_000_000_000,
      count: 1,
      id: "9f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f",
      height: 2_100_400,
      usdAtCloseText:
        "≈ $2.9M at that day's close ($64.11, yahoo, 2024-03-19) — a daily close, not the moment's price, and not today's value",
    },
    considered: 9_812_446,
    coveredThroughHeight: 3_451_200,
  },
};

/**
 * Eight daily points. The last 7 days hold 153 transfers, 1,550 ZEC in and 3,200 ZEC out; all 8
 * hold 160, 1,600 and 3,290. None is derivable by accident, so a case asserting one measures that
 * our total was quoted rather than a hand-summed column.
 *
 * The USD terms are under-covered on four of the eight days (149 of 160 transfers priced; 144 of
 * 153 inside the 7-day window), so a payload that dropped the coverage count would not still look
 * right.
 */
export const CROSSCHAIN_VOLUME: CrossChainVolumeSeries = {
  monthly: [
    {
      timestamp: 1_781_913_600,
      inZat: 410_000_000_000,
      outZat: 2_900_000_000_000,
      transfers: 812,
      inTransfers: 190,
      outTransfers: 622,
      inUsdAtSwap: 510_000,
      outUsdAtSwap: 3_610_000,
      inUsdCoveredTransfers: 88,
      outUsdCoveredTransfers: 612,
    },
    {
      timestamp: 1_784_592_000,
      inZat: 990_000_000_000,
      outZat: 1_260_000_000_000,
      transfers: 431,
      inTransfers: 189,
      outTransfers: 242,
      inUsdAtSwap: 1_010_000,
      outUsdAtSwap: 1_300_000,
      inUsdCoveredTransfers: 189,
      outUsdCoveredTransfers: 242,
    },
  ],
  daily: [
    { timestamp: day(0), inZat: 5_000_000_000, outZat: 9_000_000_000, transfers: 7, inTransfers: 3, outTransfers: 4, inUsdAtSwap: 500, outUsdAtSwap: 900, inUsdCoveredTransfers: 2, outUsdCoveredTransfers: 3 }, // prettier-ignore
    { timestamp: day(1), inZat: 31_000_000_000, outZat: 44_000_000_000, transfers: 19, inTransfers: 8, outTransfers: 11, inUsdAtSwap: 3_100, outUsdAtSwap: 6_000, inUsdCoveredTransfers: 8, outUsdCoveredTransfers: 11 }, // prettier-ignore
    { timestamp: day(2), inZat: 12_000_000_000, outZat: 88_000_000_000, transfers: 24, inTransfers: 9, outTransfers: 15, inUsdAtSwap: 1_200, outUsdAtSwap: 11_100, inUsdCoveredTransfers: 6, outUsdCoveredTransfers: 14 }, // prettier-ignore
    { timestamp: day(3), inZat: 40_000_000_000, outZat: 21_000_000_000, transfers: 31, inTransfers: 15, outTransfers: 16, inUsdAtSwap: 7_800, outUsdAtSwap: 8_000, inUsdCoveredTransfers: 15, outUsdCoveredTransfers: 16 }, // prettier-ignore
    { timestamp: day(4), inZat: 8_000_000_000, outZat: 60_000_000_000, transfers: 12, inTransfers: 4, outTransfers: 8, inUsdAtSwap: 700, outUsdAtSwap: 5_700, inUsdCoveredTransfers: 3, outUsdCoveredTransfers: 6 }, // prettier-ignore
    { timestamp: day(5), inZat: 25_000_000_000, outZat: 33_000_000_000, transfers: 28, inTransfers: 13, outTransfers: 15, inUsdAtSwap: 5_200, outUsdAtSwap: 9_000, inUsdCoveredTransfers: 13, outUsdCoveredTransfers: 15 }, // prettier-ignore
    { timestamp: day(6), inZat: 17_000_000_000, outZat: 19_000_000_000, transfers: 15, inTransfers: 7, outTransfers: 8, inUsdAtSwap: 3_300, outUsdAtSwap: 4_000, inUsdCoveredTransfers: 7, outUsdCoveredTransfers: 8 }, // prettier-ignore
    { timestamp: day(7), inZat: 22_000_000_000, outZat: 55_000_000_000, transfers: 24, inTransfers: 10, outTransfers: 14, inUsdAtSwap: 2_537, outUsdAtSwap: 9_000, inUsdCoveredTransfers: 9, outUsdCoveredTransfers: 13 }, // prettier-ignore
  ],
};

/**
 * DeFiLlama's index as the pool route reads it, in miniature: real rows, trimmed to round numbers
 * so a case can assert a figure only we could supply — the three matching pools total $5.14M.
 * `YZCASH` is the pool a substring search for "zcash" returns and is not Zcash, so a case asserting
 * it is never named tests the filter end to end.
 */
export const WRAPPED_ZEC_POOL_ROWS: readonly Record<string, unknown>[] = [
  { chain: "Solana", project: "orca-dex", symbol: "ZEC-USDC", tvlUsd: 3_350_000, apy: 53.78 },
  { chain: "BSC", project: "uniswap-v3", symbol: "ZEC-USDT", tvlUsd: 1_250_000, apy: 36.06 },
  // An upstream row naming no protocol at all, which does occur and can hold ZEC.
  { chain: "Solana", project: "project-0", symbol: "ZEC", tvlUsd: 540_000, apy: 14.1 },
  { chain: "Ethereum", project: "yuzu-money", symbol: "YZCASH", tvlUsd: 7_523_199, apy: 9.4 },
];

/**
 * The snapshot, built by running the real parser over those rows. A hand-written payload would be a
 * second definition of the route's shape, free to drift; building it means a parser change fails a
 * test.
 */
export function wrappedZecPools(
  rows: readonly Record<string, unknown>[] = WRAPPED_ZEC_POOL_ROWS,
): WrappedZecPoolSnapshot {
  const snapshot = selectWrappedZecPools(
    { status: "success", data: rows },
    { asOf: 1_785_000_000, sourceApi: "yields.llama.fi" },
  );
  if (snapshot === null) {
    throw new Error("the fixture rows no longer parse — fix the fixture, not the parser");
  }
  return snapshot;
}

/** The override key `chainApp` reads the wrapped-pool payload from. */
export const WRAPPED_ZEC_POOLS_KEY = "wrapped-zec-pools";
export const ZIP_INDEX_KEY = "zip-index";

/** The override key for the market snapshot, so a case can replace or empty it. */
export const MARKET_SNAPSHOT_KEY = "market-snapshot";

/**
 * All-time counts by kind, plus the two directions inside `mixed`. `shielding + unshielding` equals
 * `mixed` here, the real relationship, so the rule that directions are a subset of mixed (not
 * siblings) can fail. `all` excludes the directions, since adding them would double-count the mixed
 * set.
 */
export const TX_COUNTS_FIXTURE = {
  transparent: 12_000_000,
  mixed: 4_000_000,
  shielded: 1_410_990,
  coinbase: 3_431_540,
  shielding: 2_600_000,
  unshielding: 1_400_000,
  all: 20_842_530,
};
export const TX_COUNTS_KEY = "tx-counts";

export const ADDRESS_ACTIVITY_KEY = "address-activity";

/**
 * One address's activity over a period, shaped as `/chain/addresses/:address/activity` serves it.
 * 412 transactions against a lifetime 9,120, so a windowed count without its denominator is visibly
 * a different claim; received and sent are large and far apart, so a net-only answer hides ~1,300
 * ZEC of movement; `complete` is true, so the capped path is exercised by an override. The echo is
 * built through the real parser.
 */
export const ADDRESS_ACTIVITY_FIXTURE = {
  address: "t1FixtureAddress0000000000000000000",
  fromHeight: 3_400_000,
  toHeight: 3_434_000,
  txCount: 412,
  receivedZat: 84_000_000_000,
  sentZat: 46_500_000_000,
  netZat: 37_500_000_000,
  firstHeight: 3_400_119,
  lastHeight: 3_433_902,
  complete: true,
  coversFromHeight: 3_400_119,
  lifetimeTxCount: 9_120,
  applied: {
    fromTimestamp: parseUtcDayStart("2026-07-01"),
    toTimestamp: parseUtcDayStart("2026-08-01"),
  },
};

export const ADDRESS_EXTREMES_KEY = "address-value-extremes";

/**
 * One address's value extrema, shaped as `/chain/addresses/:address/value-extremes` serves it.
 * Deliberately an incomplete window (`complete: false`, `considered` < `txCount`) with one nameable
 * record and one tie, so the note's window rule and naming rule each have a payload that can
 * contradict them.
 */
export const ADDRESS_VALUE_EXTREMES_FIXTURE = {
  address: "t1KrG29yWzoi7Bs2pvsgXozZYPvGG4D3sGi",
  txCount: 18_204,
  considered: 9_876,
  complete: false,
  fromHeight: 2_140_000,
  largestReceived: {
    netChangeZat: 512_000_000_000,
    count: 1,
    txid: "e".repeat(64),
    blockHeight: 3_100_000,
    publicValueZat: 780_000_000_000,
  },
  largestSent: {
    netChangeZat: -35_000_000_000,
    count: 3,
    txid: null,
    blockHeight: null,
    publicValueZat: null,
  },
};

/**
 * The market snapshot, shaped as `/chain/market/assets` serves it. Zcash sits at rank 15 with a
 * $1.10B cap, and the set contains one of each case `eligibleAssets` decides:
 *
 *  - two assets larger than Zcash, so order can be checked (Bitcoin 1,200x, Ethereum 300x — round
 *    and far apart);
 *  - a stablecoin larger than Zcash (`tether`), which must be excluded;
 *  - `figure-heloc`, the one id in `NOT_A_VALUATION`, also larger and excluded;
 *  - an asset smaller than Zcash (`monero`), because "the privacy comparison is below us and
 *    therefore absent" is a real state the note covers.
 *
 * Five candidates reduce to exactly two comparisons, so a broken filter changes the count rather
 * than merely reordering rows.
 */
export const MARKET_SNAPSHOT = {
  asOf: 1_785_000_000,
  zec: {
    id: "zcash",
    symbol: "ZEC",
    name: "Zcash",
    marketCapUsd: 1_100_000_000,
    priceUsd: 65,
    circulatingSupply: 16_900_000,
    rank: 15,
    isStablecoin: false,
  },
  assets: [
    {
      id: "ethereum",
      symbol: "ETH",
      name: "Ethereum",
      marketCapUsd: 330_000_000_000,
      priceUsd: 2_740,
      circulatingSupply: 120_000_000,
      rank: 2,
      isStablecoin: false,
    },
    {
      id: "bitcoin",
      symbol: "BTC",
      name: "Bitcoin",
      marketCapUsd: 1_320_000_000_000,
      priceUsd: 66_500,
      circulatingSupply: 19_800_000,
      rank: 1,
      isStablecoin: false,
    },
    {
      id: "tether",
      symbol: "USDT",
      name: "Tether",
      marketCapUsd: 140_000_000_000,
      priceUsd: 1,
      circulatingSupply: 140_000_000_000,
      rank: 3,
      isStablecoin: true,
    },
    {
      id: "figure-heloc",
      symbol: "FIGR_HELOC",
      name: "Figure Heloc",
      marketCapUsd: 12_000_000_000,
      priceUsd: 1.038,
      circulatingSupply: 11_560_000_000,
      rank: 9,
      isStablecoin: false,
    },
    {
      id: "monero",
      symbol: "XMR",
      name: "Monero",
      marketCapUsd: 900_000_000,
      priceUsd: 49,
      circulatingSupply: 18_400_000,
      rank: 16,
      isStablecoin: false,
    },
  ],
};

/** The override key for the chain window, so a case can replace it with an empty one. */
export const CHAIN_WINDOW_KEY = "chain-window";

/** The private path the `chain_activity` window mode reads. */
export const CHAIN_WINDOW_PATH = "/chain/analytics/window";

/**
 * One bucket of the chain window, with figures not derivable by accident: 4,000 transparent + 1,200
 * mixed + 800 shielded = 6,000 transactions, so a shielded share is unambiguous; the fee total
 * covers 34,900 of 35,000 blocks, so it is a floor; and both shielding directions are large and
 * close (1,000 vs 940 ZEC), so a net-only answer visibly hides ~1,940 ZEC of movement.
 */
export function chainWindowBucket(
  timestamp: number,
  over: Partial<ChainWindowAggregate["totals"]> = {},
) {
  return {
    timestamp,
    daysCovered: 31,
    transparentTxs: 4_000,
    mixedTxs: 1_200,
    shieldedTxs: 800,
    // The three partition `mixedTxs` exactly, as on the real chain, so the test asserting that can
    // fail.
    shieldingTxs: 500,
    unshieldingTxs: 690,
    indeterminateTxs: 10,
    blocks: 35_000,
    shieldedZat: 100_000_000_000,
    unshieldedZat: 94_000_000_000,
    feeZat: 700_000_000,
    blocksCovered: 34_900,
    avgDifficulty: 61_500_000,
    avgBlockBytes: 4_200,
    ...over,
  };
}

/**
 * The chain window, echoing the narrowing it was asked for, parsed with the real domain parsers. A
 * canned aggregate rather than the production route, because the route is SQL over four matviews
 * and a fake pool would be a second implementation. `chain-window.test.ts` runs the real SQL
 * against Postgres, and the tool's refusal path is tested against deliberately wrong echoes; this
 * fixture proves a correct echo is accepted, building it through `parseUtcDayStart`.
 */
function chainWindowFor(query: Record<string, string>): ChainWindowAggregate {
  const fromTimestamp = parseUtcDayStart(query.from);
  const toTimestamp = parseUtcDayStart(query.to);
  const groupBy = parseChainWindowGroupBy(query.groupBy);
  // The migration pair filter, mirroring the real route: echoed, narrowing the matrix, and — when
  // grouped — attaching each bucket's cells. The first bucket gets the filtered cells and every
  // later one an empty list, so presence and the measured-zero shape are both expressible.
  const migrationSource = query.migrationSource ?? null;
  const migrationDestination = query.migrationDestination ?? null;
  const migrationFiltered = migrationSource !== null || migrationDestination !== null;
  const start = fromTimestamp ?? 1_782_000_000;
  const day = 86_400;
  /*
   * Five buckets, each there to make a ranking rule fail if broken (a single bucket passes every
   * ordering assertion trivially):
   *
   *   +0 the base bucket, unchanged, so existing totals-based assertions still hold
   *   +1 the unique busiest day (9,000 transactions) — nameable, `tiedAtTop` 1
   *   +2 fees tied with +3, and `avgDifficulty` null — the unmeasured rule's only exercise
   *   +3 the other half of the fee tie, so ranking by fees must refuse to name a winner
   *   +4 the quietest day (2,000), so `order: "lowest"` has a distinct answer
   */
  /*
   * The direction split per day, chosen so ranking by shielding lands on a day busiest by nothing
   * else: `+3` carries 900 shielding against `+1`'s 700, while `+1` is busiest for transactions,
   * fully shielded transactions and unshielding. Reading the wrong column answers with the wrong
   * day, not merely a wrong figure. Every triple sums to that day's `mixedTxs`.
   */
  const groups = [
    chainWindowBucket(start),
    chainWindowBucket(start + day, {
      transparentTxs: 6_000,
      mixedTxs: 2_000,
      shieldedTxs: 1_000,
      shieldingTxs: 700,
      unshieldingTxs: 1_295,
      indeterminateTxs: 5,
      feeZat: 400_000_000,
      avgDifficulty: 62_000_000,
    }),
    chainWindowBucket(start + 2 * day, {
      transparentTxs: 2_000,
      mixedTxs: 600,
      shieldedTxs: 400,
      shieldingTxs: 200,
      unshieldingTxs: 397,
      indeterminateTxs: 3,
      feeZat: 900_000_000,
      avgDifficulty: null,
    }),
    chainWindowBucket(start + 3 * day, {
      transparentTxs: 3_400,
      mixedTxs: 1_000,
      shieldedTxs: 600,
      shieldingTxs: 900,
      unshieldingTxs: 98,
      indeterminateTxs: 2,
      feeZat: 900_000_000,
      avgDifficulty: 60_000_000,
    }),
    chainWindowBucket(start + 4 * day, {
      transparentTxs: 1_400,
      mixedTxs: 400,
      shieldedTxs: 200,
      shieldingTxs: 100,
      unshieldingTxs: 299,
      indeterminateTxs: 1,
      feeZat: 100_000_000,
      avgDifficulty: 59_000_000,
    }),
  ];
  const allMigrations = [
    {
      source: "orchard",
      destination: "ironwood",
      txCount: 412,
      amountZat: 91_200_000_000,
      pricedTxCount: 412,
      valueText: "$54,720.00",
    },
    {
      source: "multi",
      destination: "ironwood",
      txCount: 3,
      amountZat: 150_000_000,
      pricedTxCount: 3,
      valueText: "$90.00",
    },
  ];
  const matchedMigrations = allMigrations.filter(
    (c) =>
      (migrationSource === null || c.source === migrationSource) &&
      (migrationDestination === null || c.destination === migrationDestination),
  );

  return {
    totals: chainWindowBucket(start),
    groups: (groupBy === "none" ? [] : groups).map((g, i) =>
      migrationFiltered ? { ...g, migrations: i === 0 ? matchedMigrations : [] } : g,
    ),
    groupBy,
    applied: {
      ...(fromTimestamp === null ? {} : { fromTimestamp }),
      ...(toTimestamp === null ? {} : { toTimestamp }),
      ...(migrationSource === null ? {} : { migrationSource }),
      ...(migrationDestination === null ? {} : { migrationDestination }),
    },
    firstAt: start,
    lastAt: start + 30 * 86_400,
    closingPools: {
      topHeight: 3_429_000,
      sproutZat: 2_994_923_783,
      saplingZat: 5_900_000_000_000,
      orchardZat: 36_000_000_000_000,
      ironwoodZat: 82_500_000_000_000,
    },
    /*
     * Both rules a consumer can get wrong are exercised. The base bucket has 2,000 transactions
     * carrying a shielded bundle (of 6,000), and the pool counts add to 2,600 — more than 2,000 and
     * nowhere near 6,000 — so any answer that sums them is wrong by construction. Sprout sits at 0,
     * so "a pool at zero is a measurement, not missing data" has something to fail on.
     */
    poolTxCounts: {
      fromHeight: 3_394_000,
      toHeight: 3_429_000,
      sprout: 0,
      sapling: 700,
      orchard: 1_500,
      ironwood: 400,
      transparentOnly: 4_000,
      // The fixture takes the exact path: its window is 35,000 blocks, well under the cap.
      basis: "exact-blocks" as const,
    },
    poolTxCountsUnavailable: null,
    /*
     * A migration pair the fixture can be asked about. It exercises `multi` beside a named source,
     * so a test asserting that a two-source migration is filed rather than split has something to
     * fail on.
     */
    poolMigrations: matchedMigrations,
  };
}

/**
 * The private API as the agent's aggregate tools see it: production's bearer middleware over the
 * insight paths plus the wrapped-ZEC pool path. Bare, it serves the fixtures above; `overrides`
 * replaces one payload, which is how "an empty series is an outage, not a fact" is exercised.
 */
export function chainApp(
  overrides: Partial<Record<string, unknown>> = {},
  transfers: readonly CrossChainTransfer[] = CROSSCHAIN_TRANSFERS,
): Hono {
  const auth = bearerAuth(CHAIN_TOKEN);
  const app = new Hono();
  app.use("/chain/*", auth.requireToken);
  app.use("/crosschain/*", auth.requireToken);
  const payloads: Record<string, unknown> = {
    "ironwood-inflow": IRONWOOD_INFLOW,
    "shielding-flow": SHIELDING_FLOW_DAYS,
    "transaction-costs": FEE_DISTRIBUTION,
    "crosschain-volume": CROSSCHAIN_VOLUME,
    "holder-distribution": RICH_LIST_SUMMARY,
    "/chain/rich-list?limit=10": RICH_LIST_TOP,
    // The rank seek, a different page from the top-10 above: if both keys served the same rows, a
    // dispatch that ignored `fromRank` would pass every assertion about it.
    "/chain/rich-list?limit=2&fromRank=500": RICH_LIST_AT_RANK_500,
    [WRAPPED_ZEC_POOLS_KEY]: wrappedZecPools(),
    [ZIP_INDEX_KEY]: getZipIndex(),
    [MARKET_SNAPSHOT_KEY]: MARKET_SNAPSHOT,
    [TX_COUNTS_KEY]: TX_COUNTS_FIXTURE,
    [ADDRESS_EXTREMES_KEY]: ADDRESS_VALUE_EXTREMES_FIXTURE,
    [ADDRESS_ACTIVITY_KEY]: ADDRESS_ACTIVITY_FIXTURE,
    ...overrides,
  };
  // The per-address extrema drill-down `lookup_address` fetches behind its flag.
  app.get("/chain/addresses/:address/value-extremes", (c) =>
    c.json(payloads[ADDRESS_EXTREMES_KEY] as never),
  );
  // The per-address period drill-down. Serves the fixture regardless of the days asked for, so the
  // tool's refusal path is testable by asking for a different window.
  app.get("/chain/addresses/:address/activity", (c) =>
    c.json(payloads[ADDRESS_ACTIVITY_KEY] as never),
  );
  for (const [topic, spec] of Object.entries(INSIGHT_TOPICS)) {
    app.get(spec.path, (c) => c.json(payloads[topic] as never));
    // A topic's further reads, registered from the spec so a new one is served as soon as it is
    // declared. Hono matches on the path, so the handler picks the payload by the full request (or
    // a parameter like `fromRank` would be invisible to every test), falling back to the declared
    // path.
    if ("alsoRead" in spec) {
      for (const also of spec.alsoRead) {
        const [pathOnly] = also.path.split("?");
        app.get(pathOnly!, (c) => {
          const query = new URL(c.req.url).search;
          const asked = `${pathOnly}${query}`;
          const body = asked in payloads ? payloads[asked] : payloads[also.path];
          return c.json(body as never);
        });
      }
    }
  }
  // Mounted from the route module's own exported constant, so a renamed path breaks the agent's
  // tests in the same commit.
  app.get(WRAPPED_ZEC_POOLS_PATH, (c) => c.json(payloads[WRAPPED_ZEC_POOLS_KEY] as never));
  // The ZIP index, from the same fixture the /zips page renders, mounted from the route's own
  // constant.
  app.get(ZIP_INDEX_PATH, (c) => c.json(payloads[ZIP_INDEX_KEY] as never));
  // The tx-count and market routes are mounted from their route modules' own constants, so a rename
  // breaks these tests. A 503 stands in for the cold market tracker and for testnet, where it never
  // starts.
  app.get(TX_COUNTS_PATH, (c) => c.json(payloads[TX_COUNTS_KEY] as never));
  app.get(MARKET_ASSETS_PATH, (c) => {
    const snapshot = payloads[MARKET_SNAPSHOT_KEY];
    if (snapshot === null) return c.json({ error: "market data unavailable" }, 503);
    return c.json(snapshot as never);
  });
  // The chain window echoes the query it was given, unless a test overrode the payload outright.
  app.get(CHAIN_WINDOW_PATH, (c) =>
    c.json((payloads[CHAIN_WINDOW_KEY] ?? chainWindowFor(c.req.query())) as never),
  );
  /*
   * The real private cross-chain routes, over a real store seeded with `CROSSCHAIN_TRANSFERS`. This
   * part must not be a stub: the `crosschain` tool verifies the narrowing the server echoes and
   * refuses a payload that answers a wider question, so a fake route echoing whatever it was given
   * would test only the mock.
   *
   * Mounted last on purpose: Hono serves the first matching route, so the insight payloads above
   * keep their canned fixtures (`crosschain-volume` reads `/crosschain/volume-series`, which this
   * module also declares) and only unclaimed paths fall through to the real implementation.
   */
  app.route("/", crosschainRoutes(crosschainStore(transfers)));
  return app;
}

/** The same app, wrapped the way `server/index.ts` wraps the real one. */
export function makeChain(
  overrides: Partial<Record<string, unknown>> = {},
  transfers?: readonly CrossChainTransfer[],
): ChainRequester {
  const app = chainApp(overrides, transfers);
  const header = bearerAuth(CHAIN_TOKEN).header();
  return { request: (path) => app.request(path, { headers: { authorization: header } }) };
}

/**
 * The rich-list summary, shaped as `/chain/rich-list/summary` serves it. `height` is below the
 * fixture tip because the hourly refresh always computes balances at a height behind the chain;
 * hiding that would leave the agent's note about it untested.
 */
/**
 * A page starting at rank 500, what `fromRank` seeks to. Different addresses, far smaller balances
 * and ranks that could not come from the top, so a dispatch that dropped `fromRank` would fail.
 */
export const RICH_LIST_AT_RANK_500 = {
  items: [
    {
      rank: 500,
      address: "t1RankFiveHundredFixtureAddress00001",
      balanceZat: 4_210_000_000,
      receivedZat: 9_900_000_000,
      firstHeight: 1_100_000,
      lastHeight: 3_400_000,
      txCount: 212,
    },
    {
      rank: 501,
      address: "t1RankFiveHundredOneFixtureAddr00002",
      balanceZat: 4_205_500_000,
      receivedZat: 8_100_000_000,
      firstHeight: 1_250_000,
      lastHeight: 3_390_000,
      txCount: 87,
    },
  ],
  nextCursor: null,
  prevCursor: null,
};

/**
 * The head of the ranking, shaped as `/chain/rich-list` serves it — a `CursorPage`, cursors
 * included, because the enrichment strips them. The third entry has a null `txCount`, which the
 * column allows and which means not yet counted rather than "none" (an address holding a balance
 * has been in at least one transaction).
 */
export const RICH_LIST_TOP = {
  items: [
    {
      rank: 1,
      // A real labelled address: `labelFor` resolves names from `ADDRESS_LABELS` by address, so
      // invented addresses would exercise only the unlabelled branch. Rank 2 below stays unlabelled
      // so both sides are covered.
      address: "t3aPMe94jMKyrgkbH5SSukimvdMFJ59EFhP",
      balanceZat: 21_000_000_000_000,
      receivedZat: 44_000_000_000_000,
      firstHeight: 419_200,
      lastHeight: 3_428_090,
      txCount: 18_204,
    },
    {
      rank: 2,
      address: "t1Mv595nLBUxJxKAfAZAG9RjhibExEErmMf",
      balanceZat: 17_500_000_000_000,
      receivedZat: 30_100_000_000_000,
      firstHeight: 512_004,
      lastHeight: 3_427_990,
      txCount: 9_512,
    },
    {
      rank: 3,
      address: "t1XWk29dExampleFixtureAddress000003",
      balanceZat: 12_250_000_000_000,
      receivedZat: 12_250_000_000_000,
      firstHeight: 1_004_311,
      lastHeight: 3_400_000,
      txCount: null,
    },
  ],
  nextCursor: "cursor-next",
  prevCursor: null,
};

export const RICH_LIST_SUMMARY = {
  height: 3_428_100,
  addressCount: 843_211,
  totalZat: 1_243_734_078_005_401,
  unattributedZat: 4_120_000_000,
  bands: [
    { fromZat: 0, addresses: 512_004, totalZat: 900_000_000_000 },
    { fromZat: 100_000_000, addresses: 240_000, totalZat: 40_000_000_000_000 },
    { fromZat: 1_000_000_000, addresses: 80_000, totalZat: 200_000_000_000_000 },
    { fromZat: 10_000_000_000, addresses: 10_000, totalZat: 500_000_000_000_000 },
    { fromZat: 1_000_000_000_000, addresses: 1_207, totalZat: 502_834_078_005_401 },
  ],
  topShares: [
    { count: 10, totalZat: 180_000_000_000_000 },
    { count: 100, totalZat: 430_000_000_000_000 },
    { count: 1_000, totalZat: 700_000_000_000_000 },
  ],
  asOf: 1_785_000_000,
};
