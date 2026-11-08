import { describe, expect, it } from "vitest";
import { MINING_POOL_LABELS } from "@/domain";
import type { MinersReader } from "../miners-routes";
import { decodeCursor, encodeCursor } from "@/data/cursor";
import { getNsmOverview } from "@/fixtures/nsm";
import { fixtureMinersReader, MINERS_FIXTURE_NOW_MS } from "../agent/testing/miners-reader";
import { v1MiningPoolRoutes } from "../v1/mining-pools";
import type { V1MiningPool, V1MiningPools, V1MiningPoolSeries, V1Nsm } from "../v1/dto";

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
    expect(d.historyFrom).toBe("2025-12-01");
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

  it("refuses the closed windows by name and any other parameter", async () => {
    const closed = await get<{ error: { message: string } }>(
      "/v1/analytics/mining-pools?window=1y",
    );
    expect(closed.status).toBe(400);
    expect(closed.body.error.message).toMatch(/3,146,400/);
    expect((await get("/v1/analytics/mining-pools?window=24h")).status).toBe(400);
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
    const i = body.data.groups.findIndex((g) => g.id === "shielded");
    expect(body.data.groups[i]!.kind).toBe("shielded-coinbase");
    expect(p.groups[i]).toMatchObject({ reward: null, fees: null });
    expect(body.unknowns[`data.periods.0.groups.${i}.reward`]).toBe("shielded");
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
