import { Hono } from "hono";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { API_GROUPS } from "@/api-catalogue";
import { EXPORTABLE_PATHS } from "@/api-catalogue/exports";
import type { BlockRowsReader } from "../block-list";
import type { ChainIndexStore } from "../chain-index-store";
import { MemoryStorePort } from "../crosschain-store";
import { V1_SERIES_PATHS, v1SeriesRoutes } from "../v1/analytics-series";
import { v1AddressWindowRoutes } from "../v1/address-windows";
import { v1AddressExportRoutes } from "../v1/export/address-route";
import { exportableEndpoints, templateOf } from "../v1/export/describe";
import { EXPORTS } from "../v1/export/registry";
import { col, columnsOf, type ExportSpec } from "../v1/export/spec";
import { exportLayer } from "../v1/export/layer";
import { listRows, tabulate } from "../v1/export/table";
import { v1MinersRoutes } from "../v1/miners";
import { v1Routes } from "../v1/routes";
import { v1TransparentRoutes } from "../v1/transparent-series";
import { windowedAnalyticsRoutes } from "../v1/windowed/routes";
import type { AnalyticsData } from "../v1/windowed/data";

/**
 * `format=csv|json` in front of every `/v1` route: the same answer as a file, the JSON answer
 * untouched without it, and a 400 (never a silent JSON 200) wherever there is no file to give.
 */

const d = (iso: string) =>
  Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;

function seriesPool() {
  let reads = 0;
  const tables: Record<string, Record<string, unknown>[]> = {
    chain_day_rollup: [
      { ts: d("2026-08-30"), top_height: 100, sprout: 1, sapling: 2, orchard: 3, ironwood: 4 },
      { ts: d("2026-09-01"), top_height: 300, sprout: 1, sapling: 2, orchard: 31, ironwood: 41 },
    ],
    chain_day_network: [
      { ts: d("2026-09-01"), blocks: 1000, difficulty: "100", bytes: "2000" },
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
    ],
  };
  const pool = {
    query: async (sql: string) => {
      reads += 1;
      const table = Object.keys(tables).find((t) => sql.includes(`FROM ${t}`));
      if (table) return { rows: tables[table] };
      if (sql.includes("percentile_cont")) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  } as unknown as Pool;
  return { pool, reads: () => reads };
}

const BLOCK = {
  height: 3_500_000,
  hash: "b".repeat(64),
  prevHash: "a".repeat(64),
  timestamp: 1_790_000_000,
  sizeBytes: 2_000,
  txCount: 2,
  difficulty: 123.5,
  composition: {
    transparentTxs: 1,
    mixedTxs: 0,
    shieldedTxs: 1,
    byPool: { ironwood: 1, orchard: 0, sapling: 0, sprout: 0 },
  },
  miner: { kind: "shielded" as const },
  coinbaseTag: '=HYPERLINK("x")',
  fundingStreams: [],
  blockRewardZat: null,
  totalFeeZat: 10_000,
};

function app() {
  const series = seriesPool();
  const blockRows: BlockRowsReader = async () => ({
    items: [BLOCK],
    nextCursor: "MzQ5OTk5OXxi",
    prevCursor: null,
    feesStated: true,
  });
  const v1 = v1Routes({
    store: new MemoryStorePort(),
    enabledProtocols: {},
    chain: {} as never,
    blockRows,
    chainIndex: {} as ChainIndexStore,
    extensions: [
      {
        routes: v1SeriesRoutes({ pool: series.pool, ironwoodActivationHeight: 3_428_143 }),
        endpoints: V1_SERIES_PATHS,
      },
    ],
  });
  return { v1, reads: series.reads };
}

describe("a series as a file", () => {
  it("is the same answer as CSV, from the same memo, with its provenance in headers", async () => {
    const { v1, reads } = app();
    const res = await v1.request(
      "/v1/analytics/pools?interval=day&from=2026-08-01&to=2026-10-01&format=csv",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8; header=present");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="shieldedscan_pool-balances_from-2026-08-01_interval-day_to-2026-10-01.csv"',
    );
    expect(res.headers.get("x-source")).toBe(
      "https://api.shieldedscan.xyz/v1/analytics/pools?interval=day&from=2026-08-01&to=2026-10-01&format=csv",
    );
    expect(res.headers.get("x-data-height")).toBe("300");
    expect(res.headers.get("x-data-through")).toBe("2026-09-01");
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    expect(res.headers.get("etag")).toBeTruthy();
    const text = await res.text();
    expect(text.split("\r\n")[0]).toBe(
      "period_start,closing_day,closing_height,ironwood_zat,orchard_zat,sapling_zat,sprout_zat,total_shielded_zat",
    );
    expect(text).toContain("2026-09-01,2026-09-01,300,41,31,2,1,75\r\n");
    // A second export and the JSON answer cost no further read: the memo serves all three.
    const before = reads();
    await v1.request("/v1/analytics/pools?format=json");
    await v1.request("/v1/analytics/pools");
    expect(reads()).toBe(before);
  });

  it("leaves the answer byte-for-byte unchanged without format", async () => {
    const plain = await (await app().v1.request("/v1/analytics/network")).json();
    expect(plain.data.points[0]).toEqual({
      periodStart: "2026-09-01",
      blocks: 1000,
      avgDifficulty: 100,
      avgBlockBytes: 2000,
    });
    expect(plain.columns).toBeUndefined();
  });

  it("writes a NULL as an empty cell, and the JSON form names why", async () => {
    const { v1 } = app();
    const csv = await (await v1.request("/v1/analytics/network?format=csv")).text();
    expect(csv).toContain("2026-10-01,1100,,\r\n");
    const json = await (await v1.request("/v1/analytics/network?format=json")).json();
    expect(json.rows[1]).toEqual({
      period_start: "2026-10-01",
      blocks: 1100,
      avg_difficulty: null,
      avg_block_bytes: null,
    });
    expect(json.unknowns).toEqual({
      "rows.1.avg_difficulty": "unmeasured",
      "rows.1.avg_block_bytes": "unmeasured",
    });
    expect(json.coverage.status).toBe("partial");
    expect(json.columns.map((c: { name: string }) => c.name)).toEqual([
      "period_start",
      "blocks",
      "avg_difficulty",
      "avg_block_bytes",
    ]);
  });

  it("is long where the answer has a second dimension: a row per period and kind", async () => {
    const csv = await (await app().v1.request("/v1/analytics/fees?format=csv")).text();
    expect(csv).toBe(
      "period_start,kind,median_zat,p25_zat,p75_zat,txs\r\n" +
        "2026-09-01,transparent,,,,\r\n" +
        "2026-09-01,mixed,,,,\r\n" +
        "2026-09-01,fullyShielded,10000,10000,15000,9\r\n",
    );
  });

  it("answers If-None-Match with a 304 on the file's own ETag", async () => {
    const { v1 } = app();
    const first = await v1.request("/v1/analytics/pools?format=csv");
    const tag = first.headers.get("etag")!;
    const again = await v1.request("/v1/analytics/pools?format=csv", {
      headers: { "If-None-Match": tag },
    });
    expect(again.status).toBe(304);
    // The JSON answer is a different representation, so a different tag.
    const json = await v1.request("/v1/analytics/pools");
    expect(json.headers.get("etag")).not.toBe(tag);
  });
});

describe("a list page as a file", () => {
  it("is one page, with the next page's URL in Link", async () => {
    const res = await app().v1.request("/v1/blocks?limit=1&format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("link")).toBe(
      '<https://api.shieldedscan.xyz/v1/blocks?limit=1&format=csv&cursor=MzQ5OTk5OXxi>; rel="next"',
    );
    const [header, row] = (await res.text()).split("\r\n");
    expect(header).not.toContain("coinbase");
    // A shielded coinbase's reward is the Veil, not a gap: empty, with `shielded` in the JSON form.
    expect(row).toContain(",10000,,");
    expect(row).not.toContain("HYPERLINK");
    const json = await (await app().v1.request("/v1/blocks?limit=1&format=json")).json();
    expect(json.unknowns["rows.0.block_reward_zat"]).toBe("shielded");
    expect(json.unknowns["rows.0.miner_address"]).toBe("nonexistent");
    expect(json.nextCursor).toBe("MzQ5OTk5OXxi");
  });
});

describe("what never becomes a file", () => {
  it("refuses format on an endpoint with no table, before the route runs", async () => {
    const res = await app().v1.request("/v1/status?format=csv");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_parameter");
  });

  it("refuses cross-chain data by name, whatever the endpoint", async () => {
    for (const path of ["/v1/crosschain/transfers", "/v1/crosschain/flows"]) {
      const res = await app().v1.request(`${path}?format=csv`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("not_exportable");
      expect(body.error.message).toMatch(/permission/);
    }
    // And the JSON answer is untouched.
    expect((await app().v1.request("/v1/crosschain/flows")).status).not.toBe(400);
  });

  it("exports cross-chain data once the one switch is on and a spec exists", async () => {
    const flows: ExportSpec = {
      dataset: "flows",
      rows: (body) => listRows(body, "items"),
      columns: [col("chain", "text", "chain", "")],
    };
    const make = (crosschainEnabled: boolean) => {
      const a = new Hono();
      a.use(
        "/v1/*",
        exportLayer({ crosschainEnabled, exports: { "/v1/crosschain/flows": flows } }),
      );
      a.get("/v1/crosschain/flows", (c) => c.json({ items: [{ chain: "BTC" }] }));
      return a;
    };
    expect((await make(false).request("/v1/crosschain/flows?format=csv")).status).toBe(400);
    const on = await make(true).request("/v1/crosschain/flows?format=csv");
    expect(on.status).toBe(200);
    expect(await on.text()).toBe("chain\r\nBTC\r\n");
  });

  it("refuses an unknown or repeated format, and fields beside it", async () => {
    const { v1 } = app();
    for (const q of [
      "format=xml",
      "format=",
      "format=csv&format=json",
      "format=csv&fields=blocks",
    ]) {
      const res = await v1.request(`/v1/analytics/network?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });

  it("keeps an unknown path a 404 and the circulating supply's own format", async () => {
    const { v1 } = app();
    expect((await v1.request("/v1/nothing?format=csv")).status).toBe(404);
    // Its own `format=json` reaches the route rather than the export layer's 400.
    expect((await v1.request("/v1/supply/circulating?format=json")).status).not.toBe(400);
  });

  it("keeps errors JSON whatever format asked", async () => {
    const res = await app().v1.request("/v1/analytics/pools?format=csv&interval=week");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("never answers a documented endpoint's format with a JSON 200", async () => {
    const { v1 } = app();
    for (const group of API_GROUPS) {
      for (const e of group.endpoints) {
        const path = e.path.replace(/\{(\w+)\}/g, (_m, name: string) => {
          return e.params.find((p) => p.name === name)?.example ?? "x";
        });
        const res = await v1.request(`${path}?format=csv`);
        if (res.status === 200) {
          expect(res.headers.get("content-type"), e.path).toMatch(/^text\/csv/);
        }
      }
    }
  });
});

describe("the registry", () => {
  /** Every route group, mounted with inert dependencies: only their route tables are read. */
  function allRoutes(): Set<string> {
    const pool = {} as Pool;
    const v1 = v1Routes({
      store: new MemoryStorePort(),
      enabledProtocols: {},
      extensions: [
        { routes: v1SeriesRoutes({ pool, ironwoodActivationHeight: 0 }), endpoints: [] },
        { routes: v1TransparentRoutes({ pool }), endpoints: [] },
        { routes: v1MinersRoutes({ pool }), endpoints: [] },
        { routes: v1AddressWindowRoutes({ pool }), endpoints: [] },
        { routes: v1AddressExportRoutes({ pool, walkPool: pool }), endpoints: [] },
        {
          routes: windowedAnalyticsRoutes({ data: {} as AnalyticsData, log: () => undefined }),
          endpoints: [],
        },
      ],
    });
    return new Set(v1.routes.filter((r) => r.method === "GET").map((r) => r.path));
  }

  it("names only mounted route patterns", () => {
    const mounted = allRoutes();
    for (const pattern of Object.keys(EXPORTS)) expect(mounted, pattern).toContain(pattern);
  });

  it("is what /api-docs documents as exportable", () => {
    const all = Object.keys(EXPORTS).map((p) => `GET ${templateOf(p)}`);
    expect([...exportableEndpoints(all)].sort()).toEqual([...EXPORTABLE_PATHS].sort());
    const documented = API_GROUPS.flatMap((g) => g.endpoints).map((e) => e.path);
    for (const path of EXPORTABLE_PATHS) expect(documented, path).toContain(path);
  });

  it("projects every documented example answer into a table", () => {
    // These two pin a shortened item (no block hash, time or size), so they cannot be a row.
    const abridged = ["/v1/blocks/:id/transactions", "/v1/addresses/:addr/transactions"];
    const examples = new Map(
      API_GROUPS.flatMap((g) => g.endpoints).map((e) => [e.path, e.exampleResponse]),
    );
    for (const [pattern, spec] of Object.entries(EXPORTS)) {
      if (abridged.includes(pattern)) continue;
      const example = examples.get(templateOf(pattern));
      expect(example, pattern).toBeDefined();
      const body: unknown = JSON.parse(example!.replace(/…/g, ""));
      const table = tabulate(columnsOf(spec, body), spec.rows(body));
      expect(table.rows.length, pattern).toBeGreaterThan(0);
    }
  });
});
