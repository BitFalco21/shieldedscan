import { Hono } from "hono";
import type { MarketCapTracker } from "./market-caps";

/**
 * `GET /chain/market/assets` — the market-cap snapshot behind `/compare`, as a `MarketSnapshot`.
 *
 * Mounted independently of the node routes: this is a third party's aggregate, so a node outage
 * must not take the page down, and a deployment without `NODE_RPC_URL` can still serve it.
 *
 * 503, never an empty snapshot, when the tracker has nothing recent: an empty asset list would
 * claim that no asset is larger than Zcash. Not on `/v1`: these are someone else's figures, and
 * `/compare` attributes them on the page.
 *
 * The path is exported so the agent dispatches against this route's own name; the `/v1` facets
 * beside it stay literals because they are a published contract.
 */
export const MARKET_ASSETS_PATH = "/chain/market/assets";

export function marketRoutes(tracker: MarketCapTracker): Hono {
  const app = new Hono();

  app.get(MARKET_ASSETS_PATH, (c) => {
    const snapshot = tracker.current();
    if (snapshot === null) {
      return c.json({ error: "market data unavailable" }, 503);
    }
    return c.json(snapshot);
  });

  return app;
}
