import { Hono } from "hono";
import type { Pool } from "pg";
import {
  MINING_POOL_LABELS,
  MINING_POOLS,
  MINERS_OPEN_WINDOWS,
  nsmBalanceZat,
  parseMinersWindow,
  type MinerSeries,
  type MinersOverview,
  type MinersWindowKey,
  type MiningPoolBlock,
  type MiningPoolId,
  type NsmBalance,
  type NsmOverview,
} from "@/domain";
import { Cached } from "./cached";
import { loadNsmDays, loadNsmPrefix, nsmCarriedInZat, type NsmPrefix } from "./miners-nsm";
import {
  loadMinerSeries,
  loadMiningPoolBlocks,
  loadMinersOverview,
  POOL_BLOCKS,
} from "./miners-overview";

/**
 * The `/miners` page's reads, memoised, and the private routes that serve them, token-gated like
 * every `/chain/*` route and answering in domain types. The public `/v1/analytics/mining-pools`
 * and `/v1/analytics/nsm` build the same reader (`server/v1/mining-pools.ts`), so the page and the
 * API read one set of queries; each holds its own memo, so they can differ by one memo window.
 *
 * Each read is memoised 10 minutes per key: every window holds today, which moves, and the reads
 * are small (`miners-overview.ts`). A window that is not open answers the default and says so in
 * `window`, the way the page parses it.
 *
 * The NSM read pairs the index's daily series with the node's balance, read per request (the chain
 * source memoises it for a second). A node that does not answer costs the balance only; an index
 * that cannot account for the balance block by block costs only what it carried in.
 */

export const MINERS_PATH = "/chain/miners";
export const MINERS_SERIES_PATH = "/chain/miners/series";
export const MINING_POOL_BLOCKS_PATH = "/chain/miners/pools/:id/blocks";
export const MINERS_NSM_PATH = "/chain/miners/nsm";
const CACHE_MS = 10 * 60_000;

export interface MinersRoutesDeps {
  pool: Pool;
  /** The node's NSM balance and the tip it was read at; absent, the balance is null. */
  nsmAtTip?: () => Promise<{ height: number; hash: string; nsmZat: number | null }>;
  now?: () => number;
  log?: (message: string) => void;
}

/** The `/miners` reads, each memoised. Injectable, so routes are testable without a database. */
export interface MinersReader {
  overview(window: MinersWindowKey): Promise<MinersOverview>;
  series(interval: "month" | "day"): Promise<MinerSeries>;
  /**
   * A pool's newest blocks, newest first, below `beforeHeight` when given. The first page is
   * memoised; a cursored page is a bounded read of its own (`loadMiningPoolBlocks`).
   */
  poolBlocks(
    id: MiningPoolId,
    page?: { beforeHeight?: number; limit?: number },
  ): Promise<MiningPoolBlock[]>;
  nsm(): Promise<NsmOverview>;
}

/** Waits for the index to reach the node's block before `carriedInZat` reads null. */
const CARRIED_IN_RETRIES = 2;
const CARRIED_IN_RETRY_MS = 1_500;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Every reviewed payout address of one pool, in the label table's order. */
export function miningPoolAddresses(id: MiningPoolId): string[] {
  return Object.keys(MINING_POOL_LABELS).filter((a) => MINING_POOL_LABELS[a]!.miningPool === id);
}

export function createMinersReader(deps: MinersRoutesDeps): MinersReader {
  const nowSec = () => Math.floor((deps.now ?? Date.now)() / 1000);
  const overviews = new Map<MinersWindowKey, Cached<MinersOverview>>(
    MINERS_OPEN_WINDOWS.map((w) => [w, new Cached<MinersOverview>(CACHE_MS)]),
  );
  const series = {
    month: new Cached<MinerSeries>(CACHE_MS),
    day: new Cached<MinerSeries>(CACHE_MS),
  };
  const poolBlocks = new Map<string, Cached<MiningPoolBlock[]>>();
  const nsmDays = new Cached<Omit<NsmOverview, "balance">>(CACHE_MS);
  const nsmPrefix = new Cached<NsmPrefix>(CACHE_MS);

  const nsmBalance = async (): Promise<NsmBalance | null> => {
    if (deps.nsmAtTip === undefined) return null;
    let tip;
    try {
      tip = await deps.nsmAtTip();
    } catch (error) {
      deps.log?.(`miners nsm: balance unavailable (${(error as Error).message})`);
      return null;
    }
    const zat = nsmBalanceZat({ pools: [], height: tip.height, nsmZat: tip.nsmZat }, "mainnet");
    let carriedInZat: number | null = null;
    try {
      const prefix = await nsmPrefix.get(() => loadNsmPrefix(deps.pool));
      // The index trails the node by a block for a few seconds after each one; the figure needs
      // both at the same block, so a short wait lets the index catch up before giving up. An
      // unknown balance or a known gap in the prefix cannot heal by waiting: no retry then.
      const retries = zat === null || prefix.nsmZat === null ? 0 : CARRIED_IN_RETRIES;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (attempt > 0) await sleep(CARRIED_IN_RETRY_MS);
        carriedInZat = await nsmCarriedInZat(deps.pool, prefix, { ...tip, nsmZat: zat });
        if (carriedInZat !== null) break;
      }
    } catch (error) {
      deps.log?.(`miners nsm: carried-in unavailable (${(error as Error).message})`);
    }
    return { height: tip.height, zat, carriedInZat };
  };

  return {
    overview: (window) =>
      overviews.get(window)!.get(() => loadMinersOverview(deps.pool, window, nowSec())),
    series: (interval) =>
      series[interval].get(() => loadMinerSeries(deps.pool, interval, nowSec())),
    poolBlocks: async (id, page = {}) => {
      const addresses = miningPoolAddresses(id);
      const limit = page.limit ?? POOL_BLOCKS;
      if (page.beforeHeight !== undefined || limit !== POOL_BLOCKS) {
        return loadMiningPoolBlocks(deps.pool, addresses, { ...page, limit });
      }
      let cache = poolBlocks.get(id);
      if (cache === undefined) {
        cache = new Cached<MiningPoolBlock[]>(CACHE_MS);
        poolBlocks.set(id, cache);
      }
      return cache.get(() => loadMiningPoolBlocks(deps.pool, addresses));
    },
    nsm: async () => {
      const [days, balance] = await Promise.all([
        nsmDays.get(() => loadNsmDays(deps.pool, nowSec())),
        nsmBalance(),
      ]);
      return { ...days, balance };
    },
  };
}

export function minersRoutes(deps: MinersRoutesDeps, reader = createMinersReader(deps)): Hono {
  const app = new Hono();

  app.get(MINERS_PATH, async (c) => {
    const window = parseMinersWindow(c.req.query("window"));
    return c.json(await reader.overview(window));
  });

  app.get(MINERS_SERIES_PATH, async (c) => {
    const interval = c.req.query("interval");
    if (interval !== "month" && interval !== "day") {
      return c.json({ error: "interval must be month or day" }, 400);
    }
    return c.json(await reader.series(interval));
  });

  app.get(MINERS_NSM_PATH, async (c) => {
    const body: NsmOverview = await reader.nsm();
    return c.json(body);
  });

  app.get(MINING_POOL_BLOCKS_PATH, async (c) => {
    const id = c.req.param("id");
    if (!Object.hasOwn(MINING_POOLS, id)) return c.json({ error: "no such mining pool" }, 404);
    const blocks = await reader.poolBlocks(id as MiningPoolId);
    return c.json({ miningPool: id, blocks });
  });

  return app;
}
