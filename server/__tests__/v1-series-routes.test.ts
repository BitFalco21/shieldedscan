import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { MemoryStorePort } from "../crosschain-store";
import { V1_SERIES_PATHS, v1SeriesRoutes } from "../v1/analytics-series";
import { v1Routes } from "../v1/routes";

/**
 * The published daily series on `/v1`. A fake pool answers by which relation the SQL reads, and
 * counts reads, so the memo and the in-memory slicing are exercised as the routes run them. The
 * SQL itself is simple projections of matviews.
 */

const NOW_MS = Date.UTC(2026, 9, 3, 12);
const d = (iso: string) =>
  Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;

function fakePool() {
  const reads: Record<string, number> = {};
  const tables: Record<string, Record<string, unknown>[]> = {
    chain_day_rollup: [
      { ts: d("2026-08-30"), top_height: 100, sprout: 1, sapling: 2, orchard: 3, ironwood: 4 },
      { ts: d("2026-08-31"), top_height: 200, sprout: 1, sapling: 2, orchard: 30, ironwood: 40 },
      { ts: d("2026-09-01"), top_height: 300, sprout: 1, sapling: 2, orchard: 31, ironwood: 41 },
    ],
    chain_day_network: [
      { ts: d("2026-09-01"), blocks: 1000, difficulty: "100", bytes: "2000" },
      { ts: d("2026-09-02"), blocks: 3000, difficulty: "200", bytes: null },
      { ts: d("2026-10-01"), blocks: 1100, difficulty: null, bytes: null },
    ],
    chain_month_fee_kind: [
      {
        ts: d("2026-09-01"),
        kind: "shielded",
        median_zat: 10000,
        p25_zat: 10000,
        p75_zat: 15000,
        txs: 9,
      },
      {
        ts: d("2026-09-01"),
        kind: "transparent",
        median_zat: 20000,
        p25_zat: 10000,
        p75_zat: 30000,
        txs: 7,
      },
    ],
    chain_day_fee_kind: [
      {
        ts: d("2026-09-01"),
        kind: "mixed",
        median_zat: 15000,
        p25_zat: 10000,
        p75_zat: 20000,
        txs: 3,
      },
    ],
  };
  const pool = {
    query: async (sql: string) => {
      const table = Object.keys(tables).find((t) => sql.includes(`FROM ${t}`));
      if (table) {
        reads[table] = (reads[table] ?? 0) + 1;
        return { rows: tables[table] };
      }
      if (sql.includes("WITH iwtx")) {
        reads.ironwood = (reads.ironwood ?? 0) + 1;
        return {
          rows: [
            {
              balance: "1000",
              orchard: "700",
              sapling: "200",
              sprout: "0",
              transparent: "95",
              mined: "10",
              fees: "5",
              transparent_txs: "12",
              tx_count: "40",
            },
          ],
        };
      }
      if (sql.trim() === "SELECT max(height) AS h FROM block") return { rows: [{ h: 3_505_000 }] };
      if (sql.includes("percentile_cont")) {
        reads.trailing = (reads.trailing ?? 0) + 1;
        return {
          rows: [
            {
              kind: "shielded",
              median_zat: "15000",
              p25_zat: "10000",
              p75_zat: "20000",
              mean_zat: "23069",
              txs: "145801",
            },
          ],
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  } as unknown as Pool;
  return { pool, reads };
}

function app() {
  const { pool, reads } = fakePool();
  return {
    reads,
    app: v1SeriesRoutes({ pool, ironwoodActivationHeight: 3_428_143, now: () => NOW_MS }),
  };
}

const json = async (res: Response) => ({ status: res.status, body: await res.json() });

describe("/v1/analytics/pools", () => {
  it("gives a month its CLOSING day — a balance is a level, never summed", async () => {
    const { app: a } = app();
    const { status, body } = await json(await a.request("/v1/analytics/pools"));
    expect(status).toBe(200);
    const aug = body.data.points.find(
      (p: { periodStart: string }) => p.periodStart === "2026-08-01",
    );
    expect(aug.closing).toEqual({ day: "2026-08-31", height: 200 });
    expect(aug.pools.orchard).toEqual({ zat: 30, zec: "0.00000030" });
    expect(aug.totalShielded.zat).toBe(1 + 2 + 30 + 40);
  });

  it("windows by day with an exclusive `to`, and serves every window from one read", async () => {
    const { app: a, reads } = app();
    const { body } = await json(
      await a.request("/v1/analytics/pools?interval=day&from=2026-08-31&to=2026-09-01"),
    );
    expect(body.data.points.map((p: { periodStart: string }) => p.periodStart)).toEqual([
      "2026-08-31",
    ]);
    await a.request("/v1/analytics/pools?interval=day&from=2026-08-30&to=2026-09-02");
    expect(reads.chain_day_rollup).toBe(1);
  });

  it("is strict about parameters, and bounds a daily payload", async () => {
    const { app: a } = app();
    for (const [query, code] of [
      ["?interval=week", "invalid_parameter"],
      ["?interval=day", "invalid_parameter"],
      ["?from=2026-02-31", "invalid_parameter"],
      ["?from=2026-09-01&to=2026-08-01", "invalid_parameter"],
      ["?cachebust=1", "unknown_parameter"],
    ] as const) {
      const { status, body } = await json(await a.request(`/v1/analytics/pools${query}`));
      expect(status, query).toBe(400);
      expect(body.error.code, query).toBe(code);
    }
  });

  it("marks a window reaching today partial", async () => {
    const { app: a } = app();
    const { body } = await json(await a.request("/v1/analytics/pools?from=2026-09-01"));
    expect(body.coverage.status).toBe("partial");
  });
});

describe("/v1/analytics/network", () => {
  it("weights a month's averages by block, and keeps an unmeasured average null with a reason", async () => {
    const { app: a } = app();
    const { body } = await json(await a.request("/v1/analytics/network"));
    const sep = body.data.points[0];
    // (100×1000 + 200×3000) / 4000 = 175 — an unweighted mean of the two days would say 150.
    expect(sep.avgDifficulty).toBe(175);
    expect(sep.blocks).toBe(4000);
    // Only the day that measured bytes counts toward their average.
    expect(sep.avgBlockBytes).toBe(2000);
    const oct = body.data.points[1];
    expect(oct.avgDifficulty).toBeNull();
    expect(body.unknowns["data.points.1.avgDifficulty"]).toBe("unmeasured");
  });
});

describe("/v1/analytics/fees", () => {
  it("reads monthly medians from the monthly view, never from daily ones", async () => {
    const { app: a, reads } = app();
    const { body } = await json(await a.request("/v1/analytics/fees"));
    expect(reads.chain_month_fee_kind).toBe(1);
    expect(reads.chain_day_fee_kind).toBeUndefined();
    const sep = body.data.points[0];
    expect(sep.byKind.fullyShielded.median.zat).toBe(10000);
    // A kind with no fee-paying transaction that period has no median: null, with its reason.
    expect(sep.byKind.mixed).toBeNull();
    expect(body.unknowns["data.points.0.byKind.mixed"]).toBe("nonexistent");
  });

  it("carries the trailing window as one distribution per kind, with its sample size", async () => {
    const { app: a } = app();
    const { body } = await json(await a.request("/v1/analytics/fees"));
    expect(body.data.trailing.days).toBe(90);
    expect(body.data.trailing.byKind.fullyShielded).toMatchObject({
      median: { zat: 15000 },
      mean: { zat: 23069 },
      txs: 145801,
    });
    expect(body.data.trailing.byKind.transparent).toBeNull();
  });
});

describe("/v1/analytics/ironwood", () => {
  it("publishes every source term and a residual of zero, so the identity is checkable", async () => {
    const { app: a } = app();
    const { status, body } = await json(await a.request("/v1/analytics/ironwood"));
    expect(status).toBe(200);
    const s = body.data.sources;
    expect(
      s.fromOrchard.zat +
        s.fromSapling.zat +
        s.fromSprout.zat +
        s.fromTransparent.zat +
        s.mined.zat -
        s.feesPaid.zat,
    ).toBe(body.data.balance.zat);
    expect(body.data.residual.zat).toBe(0);
    expect(body.data.migrated.zat).toBe(900);
    // Sprout keeps its own field at zero: folding a zero term into a neighbour is how the
    // missing-pool-term bug recurs.
    expect(s.fromSprout).toEqual({ zat: 0, zec: "0.00000000" });
    expect(body.data.readAtHeight).toBe(3_505_000);
    expect((await a.request("/v1/analytics/ironwood?x=1")).status).toBe(400);
  });
});

describe("mounted under /v1", () => {
  it("is listed in the descriptor and carries /v1's middleware", async () => {
    const { pool } = fakePool();
    const v1 = v1Routes({
      store: new MemoryStorePort(),
      enabledProtocols: {},
      extensions: [
        {
          routes: v1SeriesRoutes({ pool, ironwoodActivationHeight: 3_428_143 }),
          endpoints: V1_SERIES_PATHS,
        },
      ],
    });
    const endpoints: string[] = (await (await v1.request("/v1")).json()).endpoints;
    for (const p of V1_SERIES_PATHS) expect(endpoints).toContain(`GET ${p}`);
    const res = await v1.request("/v1/analytics/pools");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("/v1/analytics/records", () => {
  it("withholds a record it cannot read as null with a reason, never a zero", async () => {
    // The fake pool knows no records relation, so both reads fail the way an unpopulated matview
    // does — and the route must say so rather than answer an empty record.
    const { app: a } = app();
    const { status, body } = await json(await a.request("/v1/analytics/records"));
    expect(status).toBe(200);
    expect(body.data.fees).toBeNull();
    expect(body.data.transparentValue).toBeNull();
    expect(body.unknowns["data.fees"]).toBe("unmeasured");
    expect(body.unknowns["data.transparentValue"]).toBe("unmeasured");
    expect(body.data.crossings).toBeNull();
    expect(body.unknowns["data.crossings"]).toBe("unmeasured");
  });
});

describe("/v1/analytics/records crossings", () => {
  const routes = (complete: boolean) =>
    v1SeriesRoutes({
      pool: {
        query: async (sql: string) => {
          if (sql.includes("FROM boundary_daily")) {
            return {
              rows: [
                {
                  last_ts: String(d("2026-10-04")),
                  complete: String(complete),
                  shielding_n: "5",
                  shielding_max: "900",
                  shielding_ties: "3",
                  shielding_txid: "s1",
                  unshielding_n: "2",
                  unshielding_max: "2000",
                  unshielding_ties: "1",
                  unshielding_txid: "u2",
                  migration_n: "3",
                  migration_max: "2990",
                  migration_ties: "1",
                  migration_txid: "m3",
                },
              ],
            };
          }
          if (sql.includes("FROM tx WHERE txid = ANY")) {
            return {
              rows: [
                { txid: "u2", block_height: 10 },
                { txid: "m3", block_height: 11 },
              ],
            };
          }
          throw new Error("relation does not exist");
        },
      } as unknown as Pool,
      ironwoodActivationHeight: 3_428_143,
      now: () => NOW_MS,
    });

  it("names a record only when it is unique, with its block", async () => {
    const { body } = await json(await routes(true).request("/v1/analytics/records"));
    expect(body.data.crossings.shielding).toEqual({
      amount: { zat: 900, zec: "0.00000900" },
      ties: 3,
      txid: null,
      height: null,
      considered: 5,
    });
    expect(body.data.crossings.unshielding).toMatchObject({ txid: "u2", height: 10, ties: 1 });
    expect(body.data.crossings.migration).toMatchObject({ txid: "m3", height: 11 });
    expect(body.data.crossings.coveredThroughDay).toBe("2026-10-04");
    expect(body.unknowns["data.crossings"]).toBeUndefined();
  });

  it("withholds them until the daily table covers the whole chain", async () => {
    const { body } = await json(await routes(false).request("/v1/analytics/records"));
    expect(body.data.crossings).toBeNull();
    expect(body.unknowns["data.crossings"]).toBe("unmeasured");
  });
});
