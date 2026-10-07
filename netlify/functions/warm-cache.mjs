/**
 * Keeps the prerendered pages warm, so a visitor is never the request that receives a stale
 * copy.
 *
 * Next's caches are stale-while-revalidate: an expired entry is served as-is and refreshed
 * behind the response, so on a low-traffic site the first visitor after an idle period sees
 * old data. The revalidate window does not bound that; it only decides when a background
 * refresh fires. Dynamic routes avoid it with `fetchCache = "force-no-store"`; these pages
 * stay prerendered and CDN-cached (which absorbs spikes and keeps the site up while the API
 * restarts), so this function triggers the refresh instead.
 *
 * A plain GET, like a browser's, so the warmed entry is the one readers get. It never
 * throws: a failed warm only means the next reader triggers the refresh. Scheduled functions
 * run only on the published production deploy. `x-nextjs-date` in the log is when the page
 * was last rendered and should stay within one interval.
 */

/**
 * Prerendered pages with per-block figures. Each path costs a render per tick, so a page
 * belongs here only if it shows something that changes every block. `/analytics` is
 * day-grain and expensive to render, so it is excluded.
 */
const PATHS = [
  "/",
  "/shielded",
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
        console.log(
          `warm-cache ${path} ${res.status}`,
          `rendered=${res.headers.get("x-nextjs-date") ?? "?"}`,
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
