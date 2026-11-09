import { describe, expect, it } from "vitest";
import { MINING_POOL_LABELS } from "@/domain";
import type { MinersReader } from "../miners-routes";
import { decodeCursor, encodeCursor } from "@/data/cursor";
import { getNsmOverview } from "@/fixtures/nsm";
import { fixtureMinersReader, MINERS_FIXTURE_NOW_MS } from "../agent/testing/miners-reader";
import { v1MiningPoolRoutes } from "../v1/mining-pools";
import type {
  V1BlockArrival,
  V1MiningPool,
  V1MiningPools,
  V1MiningPoolSeries,
  V1Nsm,
} from "../v1/dto";

/**
 * The `/miners` page on `/v1`, its reads stubbed with the fixture chain: strict parameters (the
 * closed windows refused by name), every share of every block, pools kept to their reviewed
 * addresses, a shielded coinbase never valued, a keyset page by height, and the NSM's balance
 * split into what it carried in and what fees added.
 */

function app(reader: MinersReader = fixtureMinersReader(), price: number | null = 560) {
  return v1MiningPoolRoutes({
    reader,
    price: { current: () => (price === null ? null : { usd: price }) },
    now: () => MINERS_FIXTURE_NOW_MS,
  });
}

const get = async <T>(path: string, a = app()) => {
  const res = await a.request(path);
  return { status: res.status, body: (await res.json()) as T, res };
};

describe("/v1/analytics/mining-pools", () => {
  it("groups every reviewed pool and keeps the rest unattributed", async () => {
    const { status, body } = await get<V1MiningPools>("/v1/analytics/mining-pools");
    expect(status).toBe(200);
    expect(body.query.window).toBe("30d");
    const d = body.data;
    expect(d.pools[0]!.id).toBe("viabtc");
    // ViaBTC is two reviewed addresses in the fixture, summed.
    expect(d.pools[0]!.addresses.map((a) => a.address).sort()).toEqual(
      ["t1MKn34KBa8Xh4g8qU8psibBXvURafphVn7", "t1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv"].sort(),
    );
    expect(d.pools[0]!.blocks).toBe(d.pools[0]!.addresses.reduce((s, a) => s + a.blocks, 0));
    for (const p of d.pools) {
      for (const a of p.addresses) expect(MINING_POOL_LABELS[a.address]?.miningPool).toBe(p.id);
      // Every share is of every block, not of the transparent ones.
      expect(p.share!.denominator).toBe(d.blocks);
    }
    for (const r of d.unattributed.largest) expect(MINING_POOL_LABELS[r.address]).toBeUndefined();
    // The partition: pools, unattributed, shielded, no address and unrecorded make every block.
    const pooled = d.pools.reduce((s, p) => s + p.blocks, 0);
    expect(
      pooled +
        d.unattributed.blocks +
        d.byKind.shieldedCoinbase.blocks +
        d.byKind.noAddress.blocks +
        d.byKind.unrecorded.blocks,
    ).toBe(d.blocks);
    expect(d.historyFrom).toBe("2016-10-28");
    expect(body.basis).toMatch(/never add/);
  });

  it("values a reward at each day's close and today at the live price, or says it cannot", async () => {
    const priced = await get<V1MiningPools>("/v1/analytics/mining-pools?window=7d");
    expect(priced.body.data.pools[0]!.valueUsd).toMatchObject({ floor: false });
    expect(priced.body.data.pools[0]!.valueUsd!.usd).toBeGreaterThan(0);
    const cold = await get<V1MiningPools>(
      "/v1/analytics/mining-pools?window=7d",
      app(undefined, null),
    );
    expect(cold.body.data.pools[0]!.valueUsd).toBeNull();
    expect(cold.body.unknowns["data.pools.0.valueUsd"]).toBe("unmeasured");
  });

  it("serves 1y and all, and refuses any other window or parameter", async () => {
    expect((await get("/v1/analytics/mining-pools?window=1y")).status).toBe(200);
    expect((await get("/v1/analytics/mining-pools?window=all")).status).toBe(200);
    const other = await get<{ error: { message: string } }>(
      "/v1/analytics/mining-pools?window=24h",
    );
    expect(other.status).toBe(400);
    expect(other.body.error.message).toMatch(/7d, 30d, 90d, 1y, all/);
    expect((await get("/v1/analytics/mining-pools?limit=3")).status).toBe(400);
  });

  it("answers an outage with a 503, never an absence", async () => {
    const broken = { ...fixtureMinersReader(), overview: () => Promise.reject(new Error("down")) };
    const res = await app(broken).request("/v1/analytics/mining-pools");
    expect(res.status).toBe(503);
  });
});

describe("/v1/analytics/mining-pools/{id}", () => {
  it("lists the pool's reviewed addresses, its window and its newest blocks", async () => {
    const { status, body } = await get<V1MiningPool>("/v1/analytics/mining-pools/foundry?limit=5");
    expect(status).toBe(200);
    expect(body.data.pool).toEqual({ id: "foundry", name: "Foundry USA" });
    expect(body.data.reviewedAddresses).toEqual([
      { address: "t1SqwRAAdSig6dE4EBPLonAait219VmkUjP", basis: "coinbase-tag" },
    ]);
    expect(body.data.blocks.items).toHaveLength(5);
    expect(body.data.blocks.items[0]!.time).toMatch(/Z$/);
    const heights = body.data.blocks.items.map((b) => b.height);
    expect([...heights].sort((a, b) => b - a)).toEqual(heights);
    const cursor = body.data.blocks.nextCursor!;
    expect(decodeCursor(cursor)?.sortKey).toBe(String(heights.at(-1)));

    const next = await get<V1MiningPool>(
      `/v1/analytics/mining-pools/foundry?limit=5&cursor=${cursor}`,
    );
    expect(next.body.data.blocks.items[0]!.height).toBeLessThan(heights.at(-1)!);
  });

  it("states a pool that mined nothing in the window as zero, and 404s an unknown one", async () => {
    // Zec Mining Pool is reviewed but absent from the fixture's window.
    const { body } = await get<V1MiningPool>("/v1/analytics/mining-pools/zec-mining-pool");
    expect(body.data.totals.blocks).toBe(0);
    expect(body.data.totals.reward).toEqual({ zat: 0, zec: "0.00000000" });
    const missing = await get<{ error: { code: string } }>("/v1/analytics/mining-pools/nobody");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");
  });

  it("rejects a cursor it did not issue, and a limit out of range", async () => {
    expect((await get("/v1/analytics/mining-pools/viabtc?cursor=nonsense")).status).toBe(400);
    const forged = encodeCursor(5, "6");
    expect((await get(`/v1/analytics/mining-pools/viabtc?cursor=${forged}`)).status).toBe(400);
    expect((await get("/v1/analytics/mining-pools/viabtc?limit=21")).status).toBe(400);
  });
});

describe("/v1/analytics/mining-pools/series", () => {
  it("shares each period's blocks among the groups, and never values a shielded coinbase", async () => {
    const { body } = await get<V1MiningPoolSeries>("/v1/analytics/mining-pools/series");
    expect(body.data.interval).toBe("month");
    const p = body.data.periods[0]!;
    expect(p.groups.reduce((s, g) => s + g.blocks, 0)).toBe(p.blocks);
    expect(body.data.groups.find((g) => g.id === "shielded")!.kind).toBe("shielded-coinbase");
    // Cells name their group: a period lists only the groups that mined in it, so position is
    // not a group's index in `groups`.
    const i = p.groups.findIndex((g) => g.group === "shielded");
    expect(p.groups[i]).toMatchObject({ reward: null, fees: null });
    expect(body.unknowns[`data.periods.0.groups.${i}.reward`]).toBe("shielded");
  });

  it("lists only the groups that mined in each period, never a zero-block cell", async () => {
    const { body } = await get<V1MiningPoolSeries>("/v1/analytics/mining-pools/series");
    const cells = body.data.periods.flatMap((p) => p.groups);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => c.blocks > 0)).toBe(true);
    for (const p of body.data.periods) {
      const listed = p.groups.reduce((sum, c) => sum + c.blocks, 0);
      expect(listed).toBeLessThanOrEqual(p.blocks);
    }
    expect(body.basis).toMatch(/only the groups that mined in it/);
  });

  it("counts the reviewed pools that mined 51% of each period, every block in the denominator", async () => {
    const { body } = await get<V1MiningPoolSeries>("/v1/analytics/mining-pools/series");
    const periods = body.data.periods;
    // The fixture's oldest month is mostly unattributed: no count of reviewed pools reaches 51%.
    const short = periods[0]!;
    expect(short.majority.pools).toBeNull();
    expect(body.unknowns["data.periods.0.majority.pools"]).toBe("indeterminate");
    expect(100 * short.majority.reviewedBlocks).toBeLessThan(51 * short.blocks);
    expect(short.majority.poolsBlocks).toBe(short.majority.reviewedBlocks);
    const m = periods[1]!.majority;
    expect(m.pools).not.toBeNull();
    const pools = periods[1]!.groups
      .filter((g) => !["unattributed", "shielded", "no-address"].includes(g.group))
      .map((g) => g.blocks)
      .sort((a, b) => b - a);
    const first = pools.slice(0, m.pools!).reduce((s, b) => s + b, 0);
    expect(m.poolsBlocks).toBe(first);
    expect(100 * first).toBeGreaterThanOrEqual(51 * periods[1]!.blocks);
    // One pool fewer falls short: the count is the least that reaches a majority.
    expect(100 * (first - pools[m.pools! - 1]!)).toBeLessThan(51 * periods[1]!.blocks);
    expect(m.top1Blocks).toBe(pools[0]);
    expect(m.top3Blocks).toBe(pools.slice(0, 3).reduce((s, b) => s + b, 0));
    expect(body.unknowns["data.periods.1.majority.pools"]).toBeUndefined();
    expect(body.basis).toMatch(/majority\.pools/);
  });

  it("reads the majority from every group, whichever one the request narrows to", async () => {
    const all = await get<V1MiningPoolSeries>("/v1/analytics/mining-pools/series");
    const one = await get<V1MiningPoolSeries>("/v1/analytics/mining-pools/series?pool=luxor");
    expect(one.body.data.periods.map((p) => p.majority)).toEqual(
      all.body.data.periods.map((p) => p.majority),
    );
  });

  it("narrows to one group, and needs one for a daily series", async () => {
    const one = await get<V1MiningPoolSeries>(
      "/v1/analytics/mining-pools/series?interval=day&pool=viabtc",
    );
    expect(one.body.data.groups.map((g) => g.id)).toEqual(["viabtc"]);
    expect(one.body.data.periods.every((p) => p.groups.length === 1)).toBe(true);
    expect((await get("/v1/analytics/mining-pools/series?interval=day")).status).toBe(400);
    expect((await get("/v1/analytics/mining-pools/series?pool=nobody")).status).toBe(400);
    expect((await get("/v1/analytics/mining-pools/series?interval=week")).status).toBe(400);
  });
});

describe("/v1/analytics/nsm", () => {
  it("splits the balance into what it carried in and what fees added", async () => {
    const { body } = await get<V1Nsm>("/v1/analytics/nsm?window=7d");
    const o = getNsmOverview();
    const b = body.data.balance!;
    expect(b.amount!.zat).toBe(o.balance!.zat);
    expect(b.carriedIn!.zat).toBe(o.balance!.carriedInZat);
    expect(b.fromFees!.zat).toBe(o.balance!.zat! - o.balance!.carriedInZat!);
    expect(body.data.feeSplitPct).toEqual({ nsm: 60, miners: 40 });
    // The fixture's activation sits inside the week: the window is summed from it, and says so.
    expect(body.data.window!.sinceActivation).toBe(true);
    const days = body.data.days;
    expect(body.data.window!.toNsm!.zat).toBe(days.reduce((s, d) => s + d.toNsm!.zat, 0));
    expect(days.at(-1)!.partial).toBe(true);
    expect(body.unknowns[`data.days.${days.length - 1}.usdClose`]).toBe("nonexistent");
  });

  it("withholds the balance when the node cannot be read, never a zero", async () => {
    const reader = {
      ...fixtureMinersReader(),
      nsm: async () => ({ ...getNsmOverview(), balance: null }),
    };
    const { body } = await get<V1Nsm>("/v1/analytics/nsm", app(reader));
    expect(body.data.balance).toBeNull();
    expect(body.unknowns["data.balance"]).toBe("unmeasured");
    expect(body.coverage.status).toBe("partial");
  });
});

describe("/v1/analytics/mining-pools/arrival", () => {
  it("answers the window asked for, and is never read as a pool called arrival", async () => {
    const { status, body } = await get<V1BlockArrival>(
      "/v1/analytics/mining-pools/arrival?window=7d",
    );
    expect(status).toBe(200);
    expect(body.query.window).toBe("7d");
    expect(body.data.window!.key).toBe("7d");
    expect(body.data.days).toHaveLength(7);
    expect(body.data.days.at(-1)!.partial).toBe(true);
    const all = body.data.window!.groups[0]!;
    expect(all.group).toBe("all");
    expect(all.blocks).toBe(all.measured + all.late + all.unstamped);
    expect(body.basis).toMatch(/not|less any error/);
  });

  it("keeps a negative median, and gives a null percentile its reason", async () => {
    const { body } = await get<V1BlockArrival>("/v1/analytics/mining-pools/arrival?window=7d");
    const kupool = body.data.window!.groups.find((g) => g.group === "kupool")!;
    expect(kupool.p50Seconds).toBeLessThan(0);
    const day = body.data.days.findIndex((d) =>
      d.groups.some((g) => g.group === "nicehash" && g.p50Seconds === null),
    );
    expect(day).toBeGreaterThanOrEqual(0);
    const j = body.data.days[day]!.groups.findIndex((g) => g.group === "nicehash");
    expect(body.unknowns![`data.days.${day}.groups.${j}.p50Seconds`]).toBe("unmeasured");
  });

  it("refuses a window it does not compute, and an unknown parameter", async () => {
    expect((await get("/v1/analytics/mining-pools/arrival?window=1y")).status).toBe(400);
    expect((await get("/v1/analytics/mining-pools/arrival?pool=foundry")).status).toBe(400);
  });
});
