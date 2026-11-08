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
  type NsmBalance,
  type NsmOverview,
} from "@/domain";
import { Cached } from "./cached";
import { loadNsmDays, loadNsmPrefix, nsmCarriedInZat, type NsmPrefix } from "./miners-nsm";
import { loadMinerSeries, loadMiningPoolBlocks, loadMinersOverview } from "./miners-overview";

/**
 * The `/miners` page's private routes, token-gated like every `/chain/*` route, answering in
 * domain types. Each is memoised 10 minutes per key: every window holds today, which moves, and
 * the reads are small (`miners-overview.ts`). A window that is not open answers the default and
 * says so in `window`, the way the page parses it.
 *
 * The NSM route pairs the index's daily series with the node's balance, read per request (the
 * chain source memoises it for a second). A node that does not answer costs the balance only; an
 * index that cannot account for the balance block by block costs only what it carried in.
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

export function minersRoutes(deps: MinersRoutesDeps): Hono {
  const app = new Hono();
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
      carriedInZat = await nsmCarriedInZat(deps.pool, prefix, { ...tip, nsmZat: zat });
    } catch (error) {
      deps.log?.(`miners nsm: carried-in unavailable (${(error as Error).message})`);
    }
    return { height: tip.height, zat, carriedInZat };
  };

  app.get(MINERS_PATH, async (c) => {
    const window = parseMinersWindow(c.req.query("window"));
    return c.json(
      await overviews.get(window)!.get(() => loadMinersOverview(deps.pool, window, nowSec())),
    );
  });

  app.get(MINERS_SERIES_PATH, async (c) => {
    const interval = c.req.query("interval");
    if (interval !== "month" && interval !== "day") {
      return c.json({ error: "interval must be month or day" }, 400);
    }
    return c.json(await series[interval].get(() => loadMinerSeries(deps.pool, interval, nowSec())));
  });

  app.get(MINERS_NSM_PATH, async (c) => {
    const [days, balance] = await Promise.all([
      nsmDays.get(() => loadNsmDays(deps.pool, nowSec())),
      nsmBalance(),
    ]);
    const body: NsmOverview = { ...days, balance };
    return c.json(body);
  });

  app.get(MINING_POOL_BLOCKS_PATH, async (c) => {
    const id = c.req.param("id");
    if (!Object.hasOwn(MINING_POOLS, id)) return c.json({ error: "no such mining pool" }, 404);
    const addresses = Object.keys(MINING_POOL_LABELS).filter(
      (a) => MINING_POOL_LABELS[a]!.miningPool === id,
    );
    let cache = poolBlocks.get(id);
    if (cache === undefined) {
      cache = new Cached<MiningPoolBlock[]>(CACHE_MS);
      poolBlocks.set(id, cache);
    }
    const blocks = await cache.get(() => loadMiningPoolBlocks(deps.pool, addresses));
    return c.json({ miningPool: id, blocks });
  });

  return app;
}
