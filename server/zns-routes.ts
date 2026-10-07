import { Hono } from "hono";
import { parseZnsName } from "@/domain";
import type { ZnsTracker } from "./zns";

/**
 * `GET /chain/zns/name/:name` — a Zcash Name System name (bare or `.zcash`, any case) to its
 * registration, answered from the tracker's in-memory snapshot. Never forwarded, so a visitor's
 * query never leaves this box.
 *
 * Returns a `ZnsLookup` with the normalised name echoed so the adapter can refuse an answer to a
 * different question. "No such name" is an answer (`registrations: []`), never a 404; a 404 means
 * the route is not deployed. 503 until the first snapshot; 400 for a string that cannot be a name.
 *
 * Forward only (see `ZnsTracker.lookupName` for why there is no by-address route). Token-gated by
 * the default-deny middleware and not on `/v1`.
 */
export const ZNS_NAME_PATH = "/chain/zns/name";

export function znsRoutes(tracker: Pick<ZnsTracker, "lookupName">): Hono {
  const app = new Hono();

  app.get(`${ZNS_NAME_PATH}/:name`, (c) => {
    const raw = c.req.param("name");
    if (parseZnsName(raw) === null) return c.json({ error: "not a ZNS name" }, 400);
    const lookup = tracker.lookupName(raw);
    if (lookup === null) return c.json({ error: "name registry unavailable" }, 503);
    return c.json(lookup);
  });

  return app;
}
