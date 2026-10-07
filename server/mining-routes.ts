import { Hono } from "hono";
import type { Pool } from "pg";
import {
  MINING_WINDOWS,
  parseMiningWindow,
  type MiningOverview,
  type MiningWindowKey,
} from "@/domain";
import { Cached } from "./cached";
import "./pg-types";
import { loadMiningOverview } from "./mining-overview";

/**
 * `GET /chain/mining?window=7d` — the `/mining` page's overview, from the `block` table's miner
 * columns. Token-gated like every `/chain/*` route; returns the domain type verbatim.
 *
 * The node's own solution rate is requested only where it is cheap: its cost grows with the span
 * (about 15 ms for a day, 52 s for a year), so windows above `NODE_SOLPS_MAX_BLOCKS` carry null
 * and the page shows its labelled estimate.
 */

export const MINING_PATH = "/chain/mining";
export const NODE_SOLPS_MAX_BLOCKS = 10_000;
const CACHE_MS = 60_000;

export interface MiningRoutesDeps {
  pool: Pool;
  solpsOver: (blocks: number, height: number) => Promise<number | null>;
  now?: () => number;
}

export function miningRoutes(deps: MiningRoutesDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const caches = new Map<MiningWindowKey, Cached<MiningOverview | null>>(
    MINING_WINDOWS.map((w) => [w, new Cached<MiningOverview | null>(CACHE_MS)]),
  );
  app.get(MINING_PATH, async (c) => {
    const window = parseMiningWindow(c.req.query("window"));
    const cache = caches.get(window)!;
    const overview = await cache.get(() =>
      loadMiningOverview(deps.pool, window, Math.floor(now() / 1000), (blocks, height) =>
        blocks <= NODE_SOLPS_MAX_BLOCKS ? deps.solpsOver(blocks, height) : Promise.resolve(null),
      ),
    );
    if (overview === null) {
      cache.clear();
      return c.json({ error: "no blocks in the window" }, 503);
    }
    return c.json(overview);
  });
  return app;
}
