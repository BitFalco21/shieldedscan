import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { PRICE_MAX_AGE_MS, type PriceQuote, type Stats24h } from "../chain-stats";
import {
  LIVE_STATE_PATH,
  RemoteLiveState,
  STATS_MAX_AGE_MS,
  liveStateRoutes,
  parseLiveState,
  primaryProxyRoutes,
} from "../live-state";

/**
 * What a replica reads from the primary. The figures must arrive whole, keep the primary's own
 * staleness rule on the way, and age out when the primary cannot be reached — never be served as
 * live after we can no longer refresh them.
 */

const T0 = 1_780_000_000_000;
const QUOTE: PriceQuote = { usd: 512.25, change24hPct: -1.5, fetchedAt: T0 - 30_000 };
const STATS: Stats24h = { txCount24h: 9_120, fullyShieldedPct24h: 41.2, blocks: 1_151 };
const AUTH = "Bearer test-token";

/** The primary's route, in-process: a replica's fetch lands on it, carrying the header it sent. */
function primary(
  state: { price: PriceQuote | null; stats24h: Stats24h | null },
  now: () => number,
) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (c.req.header("authorization") !== AUTH) return c.json({ error: "unauthorized" }, 401);
    await next();
  });
  app.route(
    "/",
    liveStateRoutes({
      price: { current: () => state.price },
      stats24h: { current: () => state.stats24h },
      now,
    }),
  );
  return app;
}

function replica(app: Hono | null, clock: { now: number }) {
  const logs: string[] = [];
  const remote = new RemoteLiveState({
    url: "http://primary",
    authorization: AUTH,
    now: () => clock.now,
    log: (m) => logs.push(m),
    fetch: (async (input: string, init?: RequestInit) => {
      if (app === null) throw new TypeError("fetch failed");
      return app.request(input.replace("http://primary", ""), init);
    }) as typeof fetch,
  });
  return { remote, logs };
}

describe("the primary's live state, read by a replica", () => {
  it("arrives whole, through the same current() the trackers have", async () => {
    const clock = { now: T0 };
    const { remote } = replica(
      primary({ price: QUOTE, stats24h: STATS }, () => clock.now),
      clock,
    );
    expect(remote.price.current()).toBeNull();
    await remote.refresh();
    expect(remote.price.current()).toEqual(QUOTE);
    expect(remote.stats24h.current()).toEqual(STATS);
  });

  it("withholds the price at the primary's own age, reachable or not", async () => {
    const clock = { now: T0 };
    const { remote } = replica(
      primary({ price: QUOTE, stats24h: STATS }, () => clock.now),
      clock,
    );
    await remote.refresh();
    clock.now = QUOTE.fetchedAt + PRICE_MAX_AGE_MS;
    expect(remote.price.current()).toEqual(QUOTE);
    clock.now = QUOTE.fetchedAt + PRICE_MAX_AGE_MS + 1;
    expect(remote.price.current()).toBeNull();
  });

  it("stops serving the counts once the primary has been unreachable too long", async () => {
    const clock = { now: T0 };
    const state = { price: QUOTE, stats24h: STATS };
    let reachable: Hono | null = primary(state, () => clock.now);
    const logs: string[] = [];
    const remote = new RemoteLiveState({
      url: "http://primary",
      authorization: AUTH,
      now: () => clock.now,
      log: (m) => logs.push(m),
      fetch: (async (input: string, init?: RequestInit) => {
        if (reachable === null) throw new TypeError("fetch failed");
        return reachable.request(input.replace("http://primary", ""), init);
      }) as typeof fetch,
    });
    await remote.refresh();
    reachable = null;
    clock.now = T0 + STATS_MAX_AGE_MS;
    await remote.refresh();
    await remote.refresh();
    // Still within the window: the last good figures stand.
    expect(remote.stats24h.current()).toEqual(STATS);
    clock.now = T0 + STATS_MAX_AGE_MS + 1;
    expect(remote.stats24h.current()).toBeNull();
    // One line for the outage, not one per poll.
    expect(logs.filter((l) => l.includes("could not read the primary"))).toHaveLength(1);
    reachable = primary(state, () => clock.now);
    await remote.refresh();
    expect(remote.stats24h.current()).toEqual(STATS);
    expect(logs.at(-1)).toMatch(/answers again/);
  });

  it("serves the primary's nulls as nulls: a cold tracker there is a cold reading here", async () => {
    const clock = { now: T0 };
    const { remote } = replica(
      primary({ price: null, stats24h: null }, () => clock.now),
      clock,
    );
    await remote.refresh();
    expect(remote.price.current()).toBeNull();
    expect(remote.stats24h.current()).toBeNull();
  });

  it("keeps the last good figures when the primary answers a wrong shape or refuses the token", async () => {
    const clock = { now: T0 };
    let upstream: Hono = primary({ price: QUOTE, stats24h: STATS }, () => clock.now);
    const logs: string[] = [];
    const remote = new RemoteLiveState({
      url: "http://primary",
      authorization: AUTH,
      now: () => clock.now,
      log: (m) => logs.push(m),
      fetch: (async (input: string, init?: RequestInit) =>
        upstream.request(input.replace("http://primary", ""), init)) as typeof fetch,
    });
    await remote.refresh();

    // A primary one deploy apart: a price whose figure is a string. Nothing half-read is served.
    const skewed = new Hono();
    skewed.get(LIVE_STATE_PATH, (c) =>
      c.json({ price: { usd: "512", fetchedAt: T0 }, stats24h: null, asOf: T0 }),
    );
    upstream = skewed;
    await remote.refresh();
    expect(logs.at(-1)).toMatch(/unrecognised live-state shape/);
    expect(remote.price.current()).toEqual(QUOTE);
    expect(remote.stats24h.current()).toEqual(STATS);

    // A token the primary does not accept: refused there, and the replica says so once.
    const refusing = new RemoteLiveState({
      url: "http://primary",
      authorization: "Bearer wrong",
      now: () => clock.now,
      log: (m) => logs.push(m),
      fetch: (async (input: string, init?: RequestInit) =>
        primary({ price: QUOTE, stats24h: STATS }, () => clock.now).request(
          input.replace("http://primary", ""),
          init,
        )) as typeof fetch,
    });
    await refusing.refresh();
    expect(refusing.price.current()).toBeNull();
    expect(logs.at(-1)).toMatch(/HTTP 401/);
  });
});

describe("parseLiveState", () => {
  const good = { price: QUOTE, stats24h: STATS, asOf: T0 };

  it("reads what the route writes", () => {
    expect(parseLiveState(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(parseLiveState({ price: null, stats24h: null, asOf: T0 })).toEqual({
      price: null,
      stats24h: null,
      asOf: T0,
    });
    // A feed that carried no change figure stays null, never a zero move.
    expect(parseLiveState({ ...good, price: { ...QUOTE, change24hPct: null } })?.price).toEqual({
      ...QUOTE,
      change24hPct: null,
    });
  });

  it("refuses anything half-formed, whole", () => {
    for (const bad of [
      null,
      { ...good, asOf: "now" },
      { ...good, price: { usd: Number.NaN, change24hPct: null, fetchedAt: T0 } },
      { ...good, price: { usd: 1, change24hPct: null } },
      { ...good, stats24h: { ...STATS, txCount24h: -1 } },
      { ...good, stats24h: { ...STATS, fullyShieldedPct24h: 140 } },
      { ...good, stats24h: undefined },
    ]) {
      expect(parseLiveState(bad)).toBeNull();
    }
  });
});

describe("primaryProxyRoutes", () => {
  it("answers with the primary's own status and body, and 503 when it cannot be reached", async () => {
    const upstream = new Hono();
    upstream.get("/chain/zips", (c) =>
      c.req.header("authorization") === AUTH ? c.json({ zips: [1] }) : c.json({}, 401),
    );
    upstream.get("/chain/market/assets", (c) => c.json({ error: "market data unavailable" }, 503));
    const app = primaryProxyRoutes(["/chain/zips", "/chain/market/assets"], {
      url: "http://primary",
      authorization: AUTH,
      fetch: (async (input: string, init?: RequestInit) =>
        upstream.request(input.replace("http://primary", ""), init)) as typeof fetch,
    });
    const zips = await app.request("/chain/zips");
    expect(zips.status).toBe(200);
    expect(await zips.json()).toEqual({ zips: [1] });
    const market = await app.request("/chain/market/assets");
    expect(market.status).toBe(503);
    expect(await market.json()).toEqual({ error: "market data unavailable" });

    const down = primaryProxyRoutes(["/chain/zips"], {
      url: "http://primary",
      authorization: AUTH,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    const unreachable = await down.request("/chain/zips");
    expect(unreachable.status).toBe(503);
  });
});
