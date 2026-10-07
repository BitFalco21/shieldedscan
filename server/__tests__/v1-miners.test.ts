import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { MinerWindow } from "../mining-daily";
import { MINERS_DEFAULT_LIMIT, V1_MINERS_PATH, v1MinersRoutes } from "../v1/miners";

/**
 * `/v1/analytics/miners` at the HTTP boundary, its loader stubbed: strict parameters, shares over
 * every block, the folded tail, a null figure carrying its reason, coverage that says what is
 * missing, and a cache that keeps a settled window for hours and an open one for minutes.
 */

const DAY = 86_400;
const TODAY = Date.UTC(2026, 9, 5) / 1000;
const NOW_MS = (TODAY + 12 * 3600) * 1000;

const WINDOW: MinerWindow = {
  // August 2026's 31 days, all computed, which is what makes that window settled below.
  daysComputed: 31,
  blocks: 1_000,
  unrecordedBlocks: 0,
  fromHeight: 10,
  toHeight: 1_009,
  transparent: { blocks: 900, addresses: 4 },
  shieldedBlocks: 60,
  noAddressBlocks: 40,
  top: [
    {
      rank: 1,
      address: "t1A",
      blocks: 500,
      rewardZat: 62_500_000_000,
      feeZat: 1_000,
      firstHeight: 10,
      lastHeight: 1_009,
      newestCoinbaseTag: "🦓",
    },
    {
      rank: 2,
      address: "t1B",
      blocks: 300,
      rewardZat: null,
      feeZat: null,
      firstHeight: 11,
      lastHeight: 1_000,
      newestCoinbaseTag: null,
    },
  ],
  topBlocks: { top1: 500, top3: 850, top10: 900 },
  chainFirstDay: Date.UTC(2016, 9, 28) / 1000,
};

function app(over: Partial<MinerWindow> = {}, clock = { ms: NOW_MS }) {
  const calls: [number, number, number][] = [];
  const routes = v1MinersRoutes({
    pool: {} as Pool,
    now: () => clock.ms,
    load: async (_pool, from, to, limit) => {
      calls.push([from, to, limit]);
      return { ...WINDOW, ...over };
    },
  });
  return { routes, calls, clock };
}

const get = async (routes: ReturnType<typeof app>["routes"], query = "") => {
  const res = await routes.request(`${V1_MINERS_PATH}${query}`);
  return { status: res.status, cache: res.headers.get("cache-control"), body: await res.json() };
};

describe("/v1/analytics/miners", () => {
  it("refuses an unknown or malformed parameter by name", async () => {
    const { routes, calls } = app();
    for (const q of [
      "?bogus=1",
      "?limit=0",
      "?limit=101",
      "?limit=1.5",
      "?limit=abc",
      "?from=2026-02-31",
      "?from=2026-09-02&to=2026-09-01",
      "?from=2026-09-01&to=2026-09-01",
    ]) {
      const r = await get(routes, q);
      expect(r.status, q).toBe(400);
      expect(r.body.error.code, q).toMatch(/invalid|unknown/);
    }
    expect(calls).toEqual([]);
  });

  it("covers the whole chain through today by default", async () => {
    const { routes, calls } = app();
    const r = await get(routes);
    expect(r.status).toBe(200);
    expect(calls).toEqual([[0, TODAY + DAY, MINERS_DEFAULT_LIMIT]]);
    expect(r.body.query).toEqual({ from: null, to: null, limit: MINERS_DEFAULT_LIMIT });
  });

  it("states every share over every block, folds the tail, and gives each null its reason", async () => {
    const { routes } = app();
    const { body } = await get(routes, "?from=2026-08-01&to=2026-09-01&limit=2");
    const share = (n: number) => ({
      pct: Number(((n / 1_000) * 100).toFixed(2)),
      numerator: n,
      denominator: 1_000,
    });
    expect(body.data.byKind).toEqual({
      transparent: { blocks: 900, addresses: 4, share: share(900) },
      shieldedCoinbase: { blocks: 60, share: share(60) },
      noAddress: { blocks: 40, share: share(40) },
      unrecorded: { blocks: 0, share: share(0) },
    });
    expect(body.data.concentration).toEqual({
      top1: share(500),
      top3: share(850),
      top10: share(900),
    });
    expect(body.data.miners[0]).toMatchObject({
      rank: 1,
      address: "t1A",
      share: share(500),
      reward: { zat: 62_500_000_000, zec: "625.00000000" },
      fees: { zat: 1_000, zec: "0.00001000" },
      newestBlock: { height: 1_009, coinbaseTag: "🦓" },
    });
    expect(body.data.miners[1]).toMatchObject({ reward: null, fees: null });
    expect(body.unknowns).toEqual({
      "data.miners.1.reward": "unmeasured",
      "data.miners.1.fees": "unmeasured",
    });
    // Two of four addresses listed: the other two and their 100 blocks are folded, never dropped.
    expect(body.data.rest).toEqual({ addresses: 2, blocks: 100, share: share(100) });
    // Every block is accounted for: kinds partition the window.
    const kinds = Object.values(body.data.byKind) as { blocks: number }[];
    expect(kinds.reduce((s, k) => s + k.blocks, 0)).toBe(body.data.blocks);
  });

  it("says what a window does not cover yet", async () => {
    const { routes } = app({ unrecordedBlocks: 5, daysComputed: 10 });
    const { body } = await get(routes);
    expect(body.coverage.status).toBe("partial");
    // The whole chain through today: 2016-10-28 to 2026-10-05 is 3,630 days.
    expect(body.coverage.notes.join(" ")).toMatch(
      /3,620 of the 3,630 days in this window are not computed yet/,
    );
    expect(body.coverage.notes.join(" ")).toMatch(
      /5 block\(s\) in this window have no recorded miner/,
    );
    expect(body.coverage.notes.join(" ")).toMatch(/today's unfinished UTC day/);
  });

  it("an empty window is an answer: zero blocks, and shares that do not exist", async () => {
    const { routes } = app({
      blocks: 0,
      daysComputed: 0,
      fromHeight: null,
      toHeight: null,
      transparent: { blocks: 0, addresses: 0 },
      shieldedBlocks: 0,
      noAddressBlocks: 0,
      top: [],
      topBlocks: { top1: 0, top3: 0, top10: 0 },
    });
    const { status, body } = await get(routes, "?from=2015-01-01&to=2015-02-01");
    expect(status).toBe(200);
    expect(body.data.miners).toEqual([]);
    expect(body.data.rest).toBeNull();
    expect(body.data.concentration.top1).toBeNull();
    expect(body.unknowns["data.concentration.top1"]).toBe("nonexistent");
  });

  it("keeps a settled window for hours and an open one for minutes", async () => {
    const settled = app();
    const q = "?from=2026-08-01&to=2026-09-01";
    expect((await get(settled.routes, q)).cache).toBe("public, max-age=3600, s-maxage=3600");
    settled.clock.ms += 3 * 3600 * 1000;
    await get(settled.routes, q);
    expect(settled.calls).toHaveLength(1);

    // Ends yesterday: its days can still change.
    const open = app();
    const recent = `?from=2026-09-01&to=${new Date((TODAY - DAY) * 1000).toISOString().slice(0, 10)}`;
    expect((await get(open.routes, recent)).cache).toBe("public, max-age=300, s-maxage=300");
    open.clock.ms += 11 * 60 * 1000;
    await get(open.routes, recent);
    expect(open.calls).toHaveLength(2);

    // A settled span with unrecorded blocks is not settled: the repair may still fill it.
    const filling = app({ unrecordedBlocks: 1 });
    expect((await get(filling.routes, q)).cache).toBe("public, max-age=300, s-maxage=300");
  });

  it("never keeps an answer read before the tracker reached its window", async () => {
    // Found on the deploy: September asked for while the first pass was still in 2019 came back
    // empty, and was stored as settled for six hours — "nothing was mined" for a month that was.
    const early = app({
      daysComputed: 0,
      blocks: 0,
      top: [],
      transparent: { blocks: 0, addresses: 0 },
    });
    const q = "?from=2026-08-01&to=2026-09-01";
    const first = await get(early.routes, q);
    expect(first.cache).toBe("public, max-age=300, s-maxage=300");
    expect(first.body.coverage.notes.join(" ")).toMatch(/31 of the 31 days/);
    early.clock.ms += 11 * 60 * 1000;
    await get(early.routes, q);
    expect(early.calls).toHaveLength(2);
  });

  it("answers an outage as a 503 in the envelope, never a short list", async () => {
    const routes = v1MinersRoutes({
      pool: {} as Pool,
      now: () => NOW_MS,
      load: async () => {
        throw new Error("timeout exceeded when trying to connect");
      },
    });
    const res = await routes.request(V1_MINERS_PATH);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("upstream_unavailable");
  });
});
