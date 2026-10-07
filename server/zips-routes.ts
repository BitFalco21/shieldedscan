import { Hono } from "hono";
import type { ZipIndexTracker } from "./zips";

/**
 * `GET /chain/zips` — the ZIP index snapshot behind `/zips`, as a `ZipIndex` verbatim.
 *
 * Token-gated by the default-deny middleware (it is not in `public-paths.ts`). 503 only until the
 * tracker's first fill; after that a stale snapshot is served with its `asOf`, which the page
 * prints. Not on `/v1`: the canonical machine-readable source is the upstream repository itself.
 */
export const ZIP_INDEX_PATH = "/chain/zips";

export function zipsRoutes(tracker: Pick<ZipIndexTracker, "current">): Hono {
  const app = new Hono();

  app.get(ZIP_INDEX_PATH, (c) => {
    const index = tracker.current();
    if (index === null) {
      return c.json({ error: "zip index unavailable" }, 503);
    }
    return c.json(index);
  });

  return app;
}
