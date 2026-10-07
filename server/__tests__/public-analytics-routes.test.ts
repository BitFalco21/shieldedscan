import { describe, expect, it } from "vitest";
import type { ChainWindowAggregate, CrossChainAggregate } from "@/domain";
import type { AnalyticsData } from "../v1/windowed/data";
import { WINDOWED_ANALYTICS_PATHS, windowedAnalyticsRoutes } from "../v1/windowed/routes";
import { MemoryStorePort } from "../crosschain-store";
import { v1Routes } from "../v1/routes";

/**
 * The windowed analytics mounted on the public, keyless `/v1`. The handlers' contract (strict
 * parameters, the envelope, coverage) is pinned in `windowed-analytics.test.ts`; this file pins
 * what `/v1` adds around them.
 */

const NOW_MS = Date.UTC(2026, 9, 3, 12);
const SEP_1 = Date.UTC(2026, 8, 1) / 1000;
const OCT_1 = Date.UTC(2026, 9, 1) / 1000;
const SEPT = "from=2026-09-01&to=2026-10-01";

function windowAgg(): ChainWindowAggregate {
  const totals = {
    timestamp: SEP_1,
    daysCovered: 30,
    transparentTxs: 100,
    mixedTxs: 50,
    shieldedTxs: 50,
    shieldingTxs: 30,
    unshieldingTxs: 19,
    indeterminateTxs: 1,
    blocks: 34_000,
    shieldedZat: 0,
    unshieldedZat: 0,
    feeZat: 123_456_789,
    blocksCovered: 34_000,
    avgDifficulty: null,
    avgBlockBytes: null,
  };
  return {
    totals,
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
  };
}

const cross = (): CrossChainAggregate => ({
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

function stubData() {
  const calls: Record<string, number> = {};
  const hit = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const data: AnalyticsData = {
    tip: async () => ({ height: 3_505_000, timestamp: Math.floor(NOW_MS / 1000) - 60 }),
    heights: async () => ({ lo: 3_467_591, hi: 3_501_995 }),
    window: async () => (hit("window"), windowAgg()),
    poolTxByBucket: async () => new Map(),
    flows: async () => (hit("flows"), []),
    migrations: async () => (hit("migrations"), []),
    crosschain: async () => (hit("crosschain"), cross()),
    dailyThrough: async () => OCT_1 + 86_400,
    currencies: () => ["usd", "eur", "btc"],
  };
  return { data, calls };
}

function mountedOnV1() {
  const { data, calls } = stubData();
  const windowed = windowedAnalyticsRoutes({ data, now: () => NOW_MS });
  const v1 = v1Routes({
    store: new MemoryStorePort(),
    enabledProtocols: {},
    extensions: [{ routes: windowed, endpoints: Object.values(WINDOWED_ANALYTICS_PATHS) }],
  });
  return { v1, calls };
}

describe("public analytics on /v1", () => {
  it("answers without any credential", async () => {
    const { v1 } = mountedOnV1();
    for (const path of Object.values(WINDOWED_ANALYTICS_PATHS)) {
      const res = await v1.request(`${path}?${SEPT}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toMatch(/^public/);
    }
  });

  it("carries /v1's own middleware: CORS for any origin, read-only", async () => {
    const { v1 } = mountedOnV1();
    const res = await v1.request(`/v1/analytics/activity?${SEPT}`, {
      headers: { origin: "https://example.org" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const post = await v1.request(`/v1/analytics/activity?${SEPT}`, { method: "POST" });
    expect(post.status).toBe(405);
  });

  it("keeps the strict parameters: a typo is a 400 naming it, never a silent widening", async () => {
    const { v1 } = mountedOnV1();
    const typo = await v1.request(`/v1/analytics/shielding-flow?${SEPT}&pool=orchad`);
    expect(typo.status).toBe(400);
    expect((await typo.json()).error.message).toMatch(/orchad/);
    const unknown = await v1.request(`/v1/analytics/activity?${SEPT}&cachebust=1`);
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error.code).toBe("unknown_parameter");
    const noWindow = await v1.request("/v1/analytics/migrations");
    expect(noWindow.status).toBe(400);
  });

  it("serves a repeat question from the cache, whichever caller asks", async () => {
    const { v1, calls } = mountedOnV1();
    await v1.request(`/v1/analytics/activity?${SEPT}`);
    await v1.request(`/v1/analytics/activity?${SEPT}`, {
      headers: { "x-forwarded-for": "198.51.100.7" },
    });
    expect(calls.window).toBe(1);
  });

  it("ranks and trims the CACHED answer: a ranked view never re-runs the window query", async () => {
    const { v1, calls } = mountedOnV1();
    const path = `/v1/analytics/shielding-flow?${SEPT}&interval=day`;
    const plain = await (await v1.request(path)).json();
    const ranked = await (
      await v1.request(`${path}&sort=pools.ironwood.shielded.txs&top=1&fields=pools.ironwood`)
    ).json();
    // One read for both: shaping is applied to the cached answer and is not part of its key.
    expect(calls.flows).toBe(1);
    expect(plain.data.buckets).toHaveLength(30);
    expect(plain.data.ranking).toBeUndefined();
    expect(ranked.data.buckets).toHaveLength(1);
    expect(ranked.data.ranking).toMatchObject({
      by: "pools.ironwood.shielded.txs",
      considered: 30,
    });
    // A month of measured zeros: thirty periods tie at the top, so no single day may be named.
    expect(ranked.data.ranking.tiedAtTop).toBe(30);
    expect(Object.keys(ranked.data.buckets[0]).sort()).toEqual(["periodStart", "pools"]);
    expect(Object.keys(ranked.data.buckets[0].pools)).toEqual(["ironwood"]);
  });

  it("serves the cross-chain aggregate at /v1/crosschain/aggregate", async () => {
    const { v1, calls } = mountedOnV1();
    const res = await v1.request(`/v1/crosschain/aggregate?${SEPT}&groupBy=chain`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.coverage.status).toBe("floor");
    expect(calls.crosschain).toBe(1);
  });

  it("lists the four paths in the descriptor only when they are mounted", async () => {
    const { v1 } = mountedOnV1();
    const endpoints: string[] = (await (await v1.request("/v1")).json()).endpoints;
    for (const path of Object.values(WINDOWED_ANALYTICS_PATHS)) {
      expect(endpoints).toContain(`GET ${path}`);
    }
    const bare = v1Routes({ store: new MemoryStorePort(), enabledProtocols: {} });
    const bareEndpoints: string[] = (await (await bare.request("/v1")).json()).endpoints;
    expect(bareEndpoints.some((e) => e.includes("/v1/analytics/activity"))).toBe(false);
    expect((await bare.request(`/v1/analytics/activity?${SEPT}`)).status).toBe(404);
  });
});

describe("the public admission gate", () => {
  /** A data stub whose window query is held open until released, counting the peak in flight. */
  function heldData() {
    const { data } = stubData();
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    let failNext = 0;
    const held: Array<() => void> = [];
    const window: AnalyticsData["window"] = async () => {
      calls += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((r) => held.push(r));
      inFlight -= 1;
      if (failNext > 0) {
        failNext -= 1;
        throw new Error("connection terminated");
      }
      return windowAgg();
    };
    return {
      data: { ...data, window },
      peak: () => peak,
      calls: () => calls,
      /** The next N runs fail after being released, as a dropped database connection would. */
      failNext: (n: number) => {
        failNext = n;
      },
      releaseAll: () => held.splice(0).forEach((r) => r()),
    };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));
  // Distinct windows, so every request is a cache miss.
  const day = (i: number) => `2025-01-${String(i + 1).padStart(2, "0")}`;
  const ask = (app: ReturnType<typeof windowedAnalyticsRoutes>, i: number) =>
    app.request(`/v1/analytics/activity?from=${day(i)}&to=2025-02-01`);

  it("runs at most two uncached window queries at once, and every queued one still answers", async () => {
    const h = heldData();
    const app = windowedAnalyticsRoutes({ data: h.data, now: () => NOW_MS });
    const pending = Array.from({ length: 5 }, (_, i) => ask(app, i));
    for (let round = 0; round < 6; round += 1) {
      await settle();
      h.releaseAll();
    }
    const statuses = (await Promise.all(pending)).map((r) => r.status);
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
    expect(h.peak()).toBe(2);
  });

  it("refuses a request beyond the waiting room at once, with Retry-After, before any query", async () => {
    const h = heldData();
    const app = windowedAnalyticsRoutes({ data: h.data, now: () => NOW_MS });
    const pending = Array.from({ length: 10 }, (_, i) => ask(app, i)); // 2 running + 8 waiting
    await settle();
    const refused = await ask(app, 20);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe("10");
    expect((await refused.json()).error.message).toMatch(/busy/);
    for (let round = 0; round < 12; round += 1) {
      h.releaseAll();
      await settle();
    }
    await Promise.all(pending);
  });

  it("serves a cached window immediately, however busy the gate is", async () => {
    const h = heldData();
    const app = windowedAnalyticsRoutes({ data: h.data, now: () => NOW_MS });
    // Prime one window (a closed one, cached for hours).
    const prime = ask(app, 0);
    await settle();
    h.releaseAll();
    expect((await prime).status).toBe(200);
    // Fill the gate with two held queries, then ask for the primed window again.
    const busy = [ask(app, 1), ask(app, 2)];
    await settle();
    const cached = await ask(app, 0);
    expect(cached.status).toBe(200);
    h.releaseAll();
    await Promise.all(busy);
  });

  it("answers a burst of one window with ONE query, whatever its size", async () => {
    const h = heldData();
    const app = windowedAnalyticsRoutes({ data: h.data, now: () => NOW_MS });
    // Twelve identical asks: more than the gate runs plus its waiting room, so without sharing
    // two would be refused and the rest would each run the same query.
    const pending = Array.from({ length: 12 }, () => ask(app, 0));
    await settle();
    expect(h.calls()).toBe(1);
    h.releaseAll();
    const responses = await Promise.all(pending);
    expect(responses.map((r) => r.status)).toEqual(Array(12).fill(200));
    const bodies = await Promise.all(responses.map((r) => r.json()));
    // Every caller gets the one answer — and it is a real one, so this cannot pass on undefined.
    expect(bodies[0].data.totals.transactions).toBeDefined();
    expect(new Set(bodies.map((b) => JSON.stringify(b.data.totals))).size).toBe(1);
    expect(h.calls()).toBe(1);
  });

  it("does not keep a failed run: everyone who joined it is told, and the next ask runs again", async () => {
    const h = heldData();
    const app = windowedAnalyticsRoutes({ data: h.data, now: () => NOW_MS });
    h.failNext(1);
    const joined = Array.from({ length: 3 }, () => ask(app, 0));
    await settle();
    h.releaseAll();
    expect((await Promise.all(joined)).map((r) => r.status)).toEqual([503, 503, 503]);
    expect(h.calls()).toBe(1);
    const retry = ask(app, 0);
    await settle();
    h.releaseAll();
    expect((await retry).status).toBe(200);
    expect(h.calls()).toBe(2);
  });
});
