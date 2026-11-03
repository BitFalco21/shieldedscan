/**
 * Keeps the busiest edge-cached pages warm, so a visitor rarely receives a copy older than one
 * tick.
 *
 * The edge cache (`src/lib/edge-cache.ts`) and Next's Data Cache are both stale-while-revalidate:
 * an expired entry is served as-is and refreshed behind the response, so on a low-traffic site
 * the first visitor after an idle period sees old data. Routes that must be current avoid it with
 * `fetchCache = "force-no-store"` and no stale window; these pages keep their caches (which absorb
 * spikes and keep the site up while the API restarts), so this function triggers the refresh.
 *
 * A plain GET, like a browser's, so the warmed entry is the one readers get. It never
 * throws: a failed warm only means the next reader triggers the refresh. Scheduled functions
 * run only on the published production deploy. `age` in the log is how old the copy served was.
 *
 * No page is rendered at build any more, so a frontend that cannot parse the API (version skew)
 * deploys green and answers 500. A 5xx here is logged as an error so that shows up in the
 * function log within one tick.
 */

/**
 * Edge-cached pages with per-block figures. Each path costs a render per tick, so a page
 * belongs here only if it shows something that changes every block. `/analytics` is
 * day-grain and expensive to render, so it is excluded.
 */
const PATHS = [
  "/",
  "/shielded",
  // The shielded-pools view: the edge proxy serves it from its own route and cache entry.
  "/shielded?view=shielded",
  // Each of these prints the block height its figures were read at.
  "/halving",
  "/stats",
  "/pulse",
];

const warmCache = async () => {
  // Netlify sets URL to the site's primary address on production deploys.
  const base = process.env.URL;
  if (!base) {
    console.warn("warm-cache: no URL in the environment, nothing warmed");
    return;
  }

  await Promise.all(
    PATHS.map(async (path) => {
      try {
        const res = await fetch(`${base}${path}`, {
          headers: { "user-agent": "shieldedscan-cache-warmer" },
          signal: AbortSignal.timeout(20_000),
        });
        // Drain the body: the render is not what we are measuring, but leaving the stream
        // unread can cut the connection before the origin finishes storing the entry.
        await res.arrayBuffer();
        (res.status >= 500 ? console.error : console.log)(
          `warm-cache ${path} ${res.status}`,
          `age=${res.headers.get("age") ?? "?"}`,
          `cache=${res.headers.get("cache-status") ?? "?"}`,
        );
      } catch (err) {
        console.warn(`warm-cache ${path} failed:`, err instanceof Error ? err.message : err);
      }
    }),
  );
};

export default warmCache;

/**
 * Every two minutes: about one or two 75-second blocks of staleness at worst, at half the
 * invocation cost of Netlify's one-minute floor.
 */
export const config = { schedule: "*/2 * * * *" };
