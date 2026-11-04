import { Hono } from "hono";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { exportLayer } from "../../v1/export/layer";
import { v1PriceRoutes } from "../../v1/prices";
import { AgentTools, ExportPreviewCache, type V1Requester } from "../tools";
import { ADDRESS_INFO, FIXTURE_NOW_MS, makeChain, makeV1 } from "../testing/fixture-world";

/**
 * A crowd asking Zeno for files costs the API what one ask costs: every in-process read goes
 * through one per-process cache, single-flight, so concurrent asks for one file share one read and
 * the routes' own memos and gates are reached once, never fifty times.
 */

const PRICE_ASK = JSON.stringify({ family: "price", range: "30d" });

/** The fixture `/v1`, counting every in-process request by path. */
function counting(v1: V1Requester = makeV1()) {
  const reads = new Map<string, number>();
  const requester: V1Requester = {
    request: (path) => {
      reads.set(path, (reads.get(path) ?? 0) + 1);
      return v1.request(path);
    },
  };
  return { requester, reads, total: () => [...reads.values()].reduce((a, b) => a + b, 0) };
}

const tools = (v1: V1Requester) => new AgentTools(v1, makeChain(), () => FIXTURE_NOW_MS);

describe("fifty asks at once", () => {
  it("read one file once", async () => {
    const { requester, reads } = counting();
    const agent = tools(requester);
    const results = await Promise.all(
      Array.from({ length: 50 }, () => agent.dispatch("export_data", PRICE_ASK)),
    );
    expect(results.every((r) => r.export !== undefined)).toBe(true);
    expect([...reads.values()]).toEqual([1]);
    // Every caller got the same card.
    const cards = new Set(results.map((r) => JSON.stringify(r.export)));
    expect(cards.size).toBe(1);
  });

  it("read each distinct file once", async () => {
    const { requester, reads } = counting();
    const agent = tools(requester);
    const asks = [
      PRICE_ASK,
      JSON.stringify({ family: "blocks" }),
      JSON.stringify({ family: "supply-by-pool" }),
      JSON.stringify({ family: "pool", pool: "orchard", metric: "balance", range: "1y" }),
      JSON.stringify({ family: "miners", range: "30d" }),
    ];
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => agent.dispatch("export_data", asks[i % asks.length]!)),
    );
    expect(reads.size).toBe(asks.length);
    expect([...reads.values()].every((n) => n === 1)).toBe(true);
  });

  it("look one address up once", async () => {
    const { requester, reads } = counting({
      request: () =>
        new Response(
          JSON.stringify({ kind: "transparent", address: ADDRESS_INFO.address, txCount: 12 }),
        ),
    });
    const agent = tools(requester);
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        agent.dispatch(
          "export_data",
          JSON.stringify({ family: "address-history", address: ADDRESS_INFO.address }),
          ADDRESS_INFO.address,
        ),
      ),
    );
    expect(results.every((r) => r.export?.rows === 12)).toBe(true);
    expect([...reads.entries()]).toEqual([[`/v1/addresses/${ADDRESS_INFO.address}`, 1]]);
  });

  it("run the route's database queries once", async () => {
    // The real price route and export layer over a pool that counts its statements.
    let statements = 0;
    const pool = {
      query: async (sql: string) => {
        statements += 1;
        if (sql.includes("LIMIT $3")) {
          return {
            rows: [
              { day: new Date("2026-07-30T00:00:00Z"), usd: 40, source: "coincodex" },
              { day: new Date("2026-07-31T00:00:00Z"), usd: 41, source: "coincodex" },
            ],
          };
        }
        return { rows: [] };
      },
    } as unknown as Pool;
    const app = new Hono();
    app.use("/v1/*", exportLayer());
    app.route("/", v1PriceRoutes(pool));
    const one = new AgentTools(app, makeChain(), () => FIXTURE_NOW_MS);
    await one.dispatch("export_data", PRICE_ASK);
    const perAsk = statements;
    expect(perAsk).toBeGreaterThan(0);

    statements = 0;
    const crowd = new AgentTools(app, makeChain(), () => FIXTURE_NOW_MS);
    await Promise.all(Array.from({ length: 50 }, () => crowd.dispatch("export_data", PRICE_ASK)));
    expect(statements).toBe(perAsk);
  });
});

describe("the cache", () => {
  const clocked = () => {
    let now = 0;
    return { clock: () => now, advance: (ms: number) => (now += ms) };
  };

  it("reads again once an entry expires", async () => {
    const t = clocked();
    const cache = new ExportPreviewCache<{ n: number }>({ clock: t.clock });
    let loads = 0;
    const load = async () => ({ n: ++loads });
    expect(await cache.get("k", 1_000, load)).toEqual({ n: 1 });
    expect(await cache.get("k", 1_000, load)).toEqual({ n: 1 });
    t.advance(1_001);
    expect(await cache.get("k", 1_000, load)).toEqual({ n: 2 });
  });

  it("never serves a failure as data, and retries it after a short rest", async () => {
    const t = clocked();
    const cache = new ExportPreviewCache<{ n: number }>({ clock: t.clock, failMs: 10_000 });
    let loads = 0;
    const failing = async () => {
      loads += 1;
      throw new Error("503");
    };
    expect(await cache.get("k", 60_000, failing)).toBeNull();
    expect(await cache.get("k", 60_000, failing)).toBeNull();
    expect(loads).toBe(1);
    t.advance(10_001);
    expect(await cache.get("k", 60_000, async () => ({ n: 7 }))).toEqual({ n: 7 });
  });

  it("answers unavailable at the timeout, and lets the read finish for the next caller", async () => {
    const cache = new ExportPreviewCache<{ n: number }>({ timeoutMs: 20 });
    let release: (v: { n: number }) => void = () => {};
    const slow = () => new Promise<{ n: number }>((resolve) => (release = resolve));
    expect(await cache.get("k", 60_000, slow)).toBeNull();
    release({ n: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(await cache.get("k", 60_000, slow)).toEqual({ n: 1 });
  });

  it("spares the callers behind a hung read the same wait", async () => {
    const cache = new ExportPreviewCache<{ n: number }>({ timeoutMs: 20, failMs: 10_000 });
    const hung = () => new Promise<{ n: number }>(() => {});
    expect(await cache.get("k", 60_000, hung)).toBeNull();
    const started = Date.now();
    expect(await cache.get("k", 60_000, hung)).toBeNull();
    expect(Date.now() - started).toBeLessThan(15);
  });

  it("holds at most its bound, oldest out first", async () => {
    const cache = new ExportPreviewCache<{ k: string }>({ maxEntries: 3 });
    let loads = 0;
    const load = (k: string) => async () => {
      loads += 1;
      return { k };
    };
    for (const k of ["a", "b", "c", "d"]) await cache.get(k, 60_000, load(k));
    expect(loads).toBe(4);
    await cache.get("d", 60_000, load("d"));
    expect(loads).toBe(4);
    await cache.get("a", 60_000, load("a"));
    expect(loads).toBe(5);
  });

  it("keeps a timed-out export from taking the answer down", async () => {
    const hung: V1Requester = { request: () => new Promise<Response>(() => {}) };
    const agent = new AgentTools(hung, makeChain(), () => FIXTURE_NOW_MS, undefined, {
      exportCaches: {
        previews: new ExportPreviewCache({ timeoutMs: 20 }),
        addresses: new ExportPreviewCache({ timeoutMs: 20 }),
      },
    });
    const result = await agent.dispatch("export_data", PRICE_ASK);
    expect(result.export).toBeUndefined();
    expect(result.content).toMatch(/reason="unavailable"/);
  });
});
