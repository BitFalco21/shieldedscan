import {
  DAY_SECONDS,
  parseUtcDayStart,
  PLOT_EPOCH_DAY,
  utcDayFromSeconds,
  type PlotPoint,
} from "@/domain";
import type { SourceRows } from "./chart-sources";
import { asRecord } from "./json";
import { PRICE_HISTORY_PATH } from "./specs";

/**
 * The daily ZEC closes for all of history, read once and sliced per chart. Always the same pages
 * from the same start, so every chart shares one read; the windows a model asks for never reach
 * the price store.
 */

/** One page of `/v1/prices/daily`: its closes, and whether newer ones were cut off. */
export function readPricePage(body: unknown): { points: PlotPoint[]; truncated: boolean } | null {
  const r = asRecord(body);
  if (r === null || !Array.isArray(r.items) || typeof r.truncated !== "boolean") return null;
  const points: PlotPoint[] = [];
  for (const item of r.items) {
    const i = asRecord(item);
    const t = typeof i?.day === "string" ? parseUtcDayStart(i.day) : null;
    if (i === null || t === null || typeof i.usd !== "number" || !Number.isFinite(i.usd)) {
      return null;
    }
    points.push({ t, v: i.usd });
  }
  return { points: points.sort((a, b) => a.t - b.t), truncated: r.truncated };
}

/** The route's row cap per page. */
const PAGE_DAYS = 1_000;

/**
 * Every close since launch, paged back from today by `to` as `daily-price-map.ts` does (the route
 * keeps the newest rows of a capped window). The page budget follows the history's length, with
 * room for two more, so it never silently stops short; a history it cannot read whole is a failed
 * read, never a part drawn as the whole.
 */
export async function readPriceHistory(
  read: (path: string) => Promise<{ status: number; body: string }>,
  todayStart: number,
): Promise<SourceRows | null> {
  const from = PLOT_EPOCH_DAY;
  const epoch = parseUtcDayStart(from)!;
  const budget = Math.ceil((todayStart - epoch) / DAY_SECONDS / PAGE_DAYS) + 2;
  let to = utcDayFromSeconds(todayStart - DAY_SECONDS);
  const points: PlotPoint[] = [];
  for (let page = 0; page < budget; page++) {
    const res = await read(`${PRICE_HISTORY_PATH}?from=${from}&to=${to}`);
    if (res.status < 200 || res.status >= 300) return null;
    let body: unknown;
    try {
      body = JSON.parse(res.body) as unknown;
    } catch {
      return null;
    }
    const parsed = readPricePage(body);
    if (parsed === null) return null;
    points.unshift(...parsed.points);
    const oldest = parsed.points[0];
    if (!parsed.truncated || oldest === undefined) return { close: points };
    to = utcDayFromSeconds(oldest.t - DAY_SECONDS);
  }
  return null;
}
