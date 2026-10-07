import { describe, expect, it } from "vitest";
import type {
  ChainWindowAggregate,
  ChainWindowBucket,
  CrossChainAggregate,
  CrossChainGroupBy,
  CrossChainNarrowing,
} from "@/domain";
import { matchesCrossChainFilters } from "@/domain";
import type { DailyView, FlowRow, AnalyticsData } from "../v1/windowed/data";
import { coverage, money } from "../v1/windowed/map";
import { ANALYTICS_POOLS, zecTextToZat, zeroPoolCounts } from "../v1/windowed/params";
import { bucketStarts, windowedAnalyticsRoutes } from "../v1/windowed/routes";

/**
 * The windowed analytics' contract at the HTTP boundary: strict parameters, the envelope and
 * coverage — against a stub `AnalyticsData`, so no database is needed. The SQL behind the stub is
 * the existing, separately-tested queries (`chain-window.test.ts`, the store's aggregate tests).
 */

// 2026-10-03 12:00 UTC. September is closed; October 3 is "today".
const NOW_MS = (Date.UTC(2026, 9, 3, 12) / 1000) * 1000;
const SEP_1 = Date.UTC(2026, 8, 1) / 1000;
const OCT_1 = Date.UTC(2026, 9, 1) / 1000;

function bucket(timestamp: number, over: Partial<ChainWindowBucket> = {}): ChainWindowBucket {
  return {
    timestamp,
    daysCovered: 1,
    transparentTxs: 100,
    mixedTxs: 50,
    shieldedTxs: 50,
    shieldingTxs: 30,
    unshieldingTxs: 19,
    indeterminateTxs: 1,
    blocks: 1150,
    shieldedZat: 0,
    unshieldedZat: 0,
    feeZat: 123_456_789,
    blocksCovered: 1150,
    avgDifficulty: null,
    avgBlockBytes: null,
    ...over,
  };
}

function windowAgg(over: Partial<ChainWindowAggregate> = {}): ChainWindowAggregate {
  return {
    totals: bucket(SEP_1),
    groups: [],
    groupBy: "none",
    applied: {},
    firstAt: SEP_1,
    lastAt: OCT_1 - 86_400,
    closingPools: null,
    poolTxCounts: {
      fromHeight: 3_467_591,
      toHeight: 3_501_995,
      sprout: 1,
      sapling: 2,
      orchard: 3,
      ironwood: 4,
      transparentOnly: 5,
      basis: "exact-blocks",
    },
    poolTxCountsUnavailable: null,
    poolMigrations: [],
    ...over,
  };
}

const emptyCross = (): CrossChainAggregate => ({
  groupBy: "none",
  totals: {
    in: { transfers: 2, zecAmountZat: 150_000_000, usdAtSwap: 1234.5, usdCoveredTransfers: 2 },
    out: { transfers: 0, zecAmountZat: 0, usdAtSwap: 0, usdCoveredTransfers: 0 },
  },
  groups: [],
  applied: {},
  firstAt: 0,
  lastAt: 0,
});

function stub(over: Partial<AnalyticsData> = {}) {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const data: AnalyticsData = {
    tip: async () => ({ height: 3_505_000, timestamp: Math.floor(NOW_MS / 1000) - 60 }),
    heights: async (...a) => (record("heights", a), { lo: 3_467_591, hi: 3_501_995 }),
    window: async (...a) => (record("window", a), windowAgg()),
    poolTxByBucket: async () => new Map(),
    flows: async (...a) => (record("flows", a), []),
    migrations: async (...a) => (record("migrations", a), []),
    crosschain: async (f: CrossChainNarrowing, g: CrossChainGroupBy) => (
      record("crosschain", [f, g]),
      emptyCross()
    ),
    dailyThrough: async (v: DailyView) => (record("dailyThrough", [v]), OCT_1 + 86_400),
    currencies: () => ["usd", "eur", "btc"],
    ...over,
  };
  const app = windowedAnalyticsRoutes({ data, now: () => NOW_MS });
  const get = (path: string) => app.request(path);
  return { app, get, calls };
}

const SEPT = "from=2026-09-01&to=2026-10-01";

describe("parameters are strict", () => {
  const cases: [string, RegExp][] = [
    [`/v1/analytics/activity?${SEPT}&bogus=1`, /unknown parameter: bogus/],
    ["/v1/analytics/activity?to=2026-10-01", /from is required/],
    ["/v1/analytics/activity?from=2026-10-01&to=2026-09-01", /later day/],
    ["/v1/analytics/activity?from=2026-02-31&to=2026-03-02", /from is required/],
    ["/v1/analytics/activity?from=2025-01-01&to=2026-06-01&interval=day", /at most 366 days/],
    [`/v1/analytics/activity?${SEPT}&interval=week`, /interval must be one of/],
    [`/v1/analytics/shielding-flow?${SEPT}&pool=orchard,ironwod`, /unknown pool: ironwod/],
    [`/v1/analytics/migrations?${SEPT}&interval=day`, /needs source or destination/],
    [`/v1/analytics/migrations?${SEPT}&currency=xyz`, /currency must be one of/],
    [`/v1/crosschain/aggregate?${SEPT}&groupBy=asset`, /groupBy must be one of/],
    [`/v1/crosschain/aggregate?${SEPT}&minZec=-5`, /positive decimal/],
    [`/v1/crosschain/aggregate?${SEPT}&minZec=1.123456789`, /8 decimal places/],
  ];
  it.each(cases)("%s → 400", async (path, message) => {
    const { get } = stub();
    const res = await get(path);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(message);
  });

  it("refuses a non-usd currency by name while rates are still loading", async () => {
    const { get } = stub({ currencies: () => ["usd"] });
    const res = await get(`/v1/analytics/migrations?${SEPT}&currency=eur`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/still loading/);
  });
});

describe("the envelope", () => {
  it("echoes the query, states the window with heights, and marks a closed window complete", async () => {
    const { get } = stub();
    const body = await (await get(`/v1/analytics/activity?${SEPT}`)).json();
    expect(body.query).toEqual({
      from: "2026-09-01",
      to: "2026-10-01",
      interval: "none",
      minZec: null,
      minFiat: null,
      currency: "usd",
    });
    expect(body.window).toEqual({
      from: "2026-09-01",
      to: "2026-10-01",
      toExclusive: true,
      fromTimestamp: SEP_1,
      toTimestamp: OCT_1,
      fromHeight: 3_467_591,
      toHeight: 3_501_995,
    });
    expect(body.coverage).toEqual({ status: "complete", notes: [] });
    expect(body.indexed.height).toBe(3_505_000);
    expect(body.source.url).toBe("https://shieldedscan.xyz/analytics");
  });

  it("states every ZEC amount as integer zatoshi and an exact decimal string", async () => {
    const { get } = stub();
    const body = await (await get(`/v1/analytics/activity?${SEPT}`)).json();
    expect(body.data.totals.fees).toEqual({
      feeZat: 123_456_789,
      feeZec: "1.23456789",
      blocksCovered: 1150,
      blocks: 1150,
    });
    expect(body.data.totals.transactions.total).toBe(200);
    expect(body.data.totals.fullyShieldedShare).toEqual({
      pct: 25,
      numerator: 50,
      denominator: 200,
    });
  });

  it("marks a window that includes today partial, and says why", async () => {
    const { get } = stub();
    const body = await (await get("/v1/analytics/activity?from=2026-10-01&to=2026-10-04")).json();
    expect(body.coverage.status).toBe("partial");
    expect(body.coverage.notes.join(" ")).toMatch(/includes today/);
  });

  it("marks fees a floor when some blocks have no derivable fee total", async () => {
    const { get } = stub({
      window: async () => windowAgg({ totals: bucket(SEP_1, { blocksCovered: 1000 }) }),
    });
    const body = await (await get(`/v1/analytics/activity?${SEPT}`)).json();
    expect(body.coverage.status).toBe("floor");
    expect(body.coverage.notes[0]).toMatch(/1000 of 1150 blocks/);
  });

  it("publishes transparentOnly as unmeasured — never zero — above the exact-count range", async () => {
    const { get } = stub({
      window: async () =>
        windowAgg({
          poolTxCounts: {
            fromHeight: 1,
            toHeight: 2,
            sprout: 1,
            sapling: 1,
            orchard: 1,
            ironwood: 1,
            transparentOnly: null,
            basis: "whole-days",
          },
        }),
    });
    const body = await (await get(`/v1/analytics/activity?${SEPT}`)).json();
    expect(body.data.totals.transactions.byPool.transparentOnly).toBeNull();
    expect(body.unknowns["data.totals.transactions.byPool.transparentOnly"]).toBe("unmeasured");
  });

  it("caches a closed window: a repeat costs no second read", async () => {
    const { get, calls } = stub();
    await get(`/v1/analytics/activity?${SEPT}`);
    await get(`/v1/analytics/activity?to=2026-10-01&from=2026-09-01`);
    expect(calls.window).toHaveLength(1);
  });
});

describe("shielding flow", () => {
  const row = (bucketTs: number, pool: FlowRow["pool"], over: Partial<FlowRow> = {}): FlowRow => ({
    bucketTs,
    pool,
    shieldedTxs: 0,
    shieldedZat: 0,
    unshieldedTxs: 0,
    unshieldedZat: 0,
    coinbaseTxs: 0,
    coinbaseZat: 0,
    hubTxs: 0,
    hubZat: 0,
    ...over,
  });

  it("gives every day a bucket, every asked pool a measured zero, and the unattributed row apart", async () => {
    const day1 = SEP_1;
    const { get } = stub({
      flows: async () => [
        row(day1, "ironwood", {
          shieldedTxs: 3,
          shieldedZat: 300_000_000,
          unshieldedTxs: 1,
          unshieldedZat: 100_000_000,
        }),
        row(day1, "hub", { hubTxs: 2, hubZat: 50 }),
      ],
    });
    const body = await (
      await get(
        "/v1/analytics/shielding-flow?from=2026-09-01&to=2026-09-03&interval=day&pool=orchard,ironwood",
      )
    ).json();
    expect(body.data.buckets.map((b: { periodStart: string }) => b.periodStart)).toEqual([
      "2026-09-01",
      "2026-09-02",
    ]);
    const first = body.data.buckets[0];
    expect(first.pools.ironwood.netZec).toBe("2.00000000");
    expect(first.pools.orchard.shielded.txs).toBe(0);
    expect(first.pools.sapling).toBeUndefined();
    expect(first.unattributed).toEqual({ txs: 2, magnitudeZat: 50, magnitudeZec: "0.00000050" });
    expect(body.data.totals.pools.ironwood.shielded.txs).toBe(3);
  });
});

describe("migrations", () => {
  it("lists every day, with an empty cell list where nothing migrated", async () => {
    const { get } = stub({
      migrations: async (_f, _t, interval) =>
        interval === "none"
          ? [
              {
                bucketTs: null,
                source: "orchard",
                destination: "ironwood",
                txCount: 2,
                amountZat: 5,
                pricedTxCount: 2,
                value: 1.5,
              },
            ]
          : [
              {
                bucketTs: SEP_1,
                source: "orchard",
                destination: "ironwood",
                txCount: 2,
                amountZat: 5,
                pricedTxCount: 2,
                value: 1.5,
              },
            ],
    });
    const body = await (
      await get(
        "/v1/analytics/migrations?from=2026-09-01&to=2026-09-04&interval=day&destination=ironwood&currency=eur",
      )
    ).json();
    expect(body.data.buckets).toHaveLength(3);
    expect(body.data.buckets[1]).toEqual({ periodStart: "2026-09-02", cells: [] });
    expect(body.data.totals[0].value).toEqual({ currency: "eur", amount: "1.50", pricedTxs: 2 });
  });
});

describe("cross-chain", () => {
  it("counts completed transfers only, maps protocol to the store's axis, and is always a floor", async () => {
    const { get, calls } = stub();
    const body = await (
      await get(`/v1/crosschain/aggregate?${SEPT}&groupBy=protocol&chain=eth,btc&minZec=1.5`)
    ).json();
    const [filters, groupBy] = calls.crosschain?.[0] as [CrossChainNarrowing, CrossChainGroupBy];
    expect(filters.completedOnly).toBe(true);
    expect(filters.counterpartChains).toEqual(["BTC", "ETH"]);
    expect(filters.minZecZat).toBe(150_000_000);
    expect(groupBy).toBe("venue");
    expect(body.coverage.status).toBe("floor");
    expect(body.data.totals.in).toEqual({
      transfers: 2,
      amountZat: 150_000_000,
      amountZec: "1.50000000",
      usdAtSwap: "1234.50",
      usdPricedTransfers: 2,
    });
  });

  it("completedOnly excludes pending and refunded transfers in the shared predicate", () => {
    const t = {
      status: "pending",
      timestamp: 1,
      protocol: "maya",
      direction: "in",
      counterpartChain: "BTC",
      zecAmountZat: 1,
      usdValueAtSwap: null,
    } as never;
    expect(matchesCrossChainFilters(t, {})).toBe(true);
    expect(matchesCrossChainFilters(t, { completedOnly: true })).toBe(false);
  });
});

describe("pure helpers", () => {
  it("lists the pools oldest first, each counted from zero", () => {
    expect(ANALYTICS_POOLS).toEqual(["sprout", "sapling", "orchard", "ironwood"]);
    expect(JSON.stringify(zeroPoolCounts())).toBe(
      JSON.stringify({ sprout: 0, sapling: 0, orchard: 0, ironwood: 0 }),
    );
  });

  it("converts a ZEC decimal to zatoshi without a float multiplication", () => {
    expect(zecTextToZat("0.1")).toBe(10_000_000);
    expect(zecTextToZat("5000")).toBe(500_000_000_000);
    expect(zecTextToZat("0.00000001")).toBe(1);
  });

  it("gives fiat cents and BTC satoshi precision", () => {
    expect(money(1234.5, "usd")).toBe("1234.50");
    expect(money(0.0123456789, "btc")).toBe("0.01234568");
  });

  it("lists month buckets from the window's own month, mid-month start included", () => {
    const w = {
      from: "2026-07-15",
      to: "2026-10-01",
      fromTimestamp: Date.UTC(2026, 6, 15) / 1000,
      toTimestamp: OCT_1,
    };
    expect(
      bucketStarts(w, "month").map((t) => new Date(t * 1000).toISOString().slice(0, 7)),
    ).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("reports daily totals that have not reached the window's last day as partial", () => {
    const c = coverage({
      toTimestamp: OCT_1,
      nowSeconds: OCT_1 + 3600,
      dailyThrough: OCT_1 - 86_400,
      floorNotes: [],
    });
    expect(c.status).toBe("partial");
    expect(c.notes[0]).toMatch(/run through 2026-09-30/);
  });
});
