import { DAY_MS, utcDayFromMs } from "@/domain/time";
import { createStaleMemo } from "@/lib/stale-memo";

/**
 * Every daily close since launch, as "YYYY-MM-DD" -> usd.
 *
 * `/v1/prices/daily` caps its row count, but its consumers need the whole history (a fee is
 * priced at the date its transaction was mined), so this walks pages backwards by `to=`. The
 * loop stops on a short page, and `MAX_PAGES` stops a server that ignored `to`.
 *
 * Memoised in module scope because its callers (`/blocks`, `/txs`) are `force-no-store`, where
 * neither `next.revalidate` nor `unstable_cache` would cache it. A past close never changes, so
 * serving an old map through an outage costs nothing; the callers drop the dollar column
 * rather than render an invented empty history when there is no map at all.
 */
const MAX_PAGES = 30;
/** Four seconds a page: the endpoint answers in well under a second and is optional. */
const PAGE_TIMEOUT_MS = 4_000;

const memo = createStaleMemo<Record<string, number>>({
  ttlMs: 3_600_000,
  failureCooldownMs: 60_000,
  unavailableMessage: "daily price history is temporarily unavailable",
});

export function dailyPriceMap(baseUrl: string): Promise<Record<string, number>> {
  return memo.get(() => walkDailyPrices(baseUrl));
}

async function walkDailyPrices(baseUrl: string): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${baseUrl}/v1/prices/daily`);
    if (before) url.searchParams.set("to", before);
    const res = await fetch(url, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`chain API returned ${res.status} for daily prices`);
    const body = (await res.json()) as {
      items?: { day: string; usd: number }[];
      truncated?: boolean;
    };
    if (!Array.isArray(body.items)) {
      throw new Error("chain API returned an unrecognised daily prices shape");
    }
    for (const r of body.items) if (Number.isFinite(r.usd)) map[r.day] = r.usd;
    const oldest = body.items[0]?.day;
    if (!body.truncated || oldest === undefined || oldest === before) break;
    // Step strictly past the oldest day of this page, or the next request repeats it.
    before = utcDayFromMs(Date.parse(`${oldest}T00:00:00Z`) - DAY_MS);
  }
  return map;
}
