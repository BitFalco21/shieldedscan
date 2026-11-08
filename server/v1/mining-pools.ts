import { Hono, type Context } from "hono";
import {
  MINERS_OPEN_WINDOWS,
  MINING_POOLS,
  minersWindowDays,
  type MinersWindowKey,
  type MiningPoolId,
} from "@/domain";
import { INT4_SORT_KEY_MAX, decodeCursorForColumn, encodeCursor } from "@/data/cursor";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";
import type { MinersReader } from "../miners-routes";
import { POOL_BLOCKS } from "../miners-overview";
import { errorBody, routeGroupErrors, setCache } from "./http";
import { createKeyedCache } from "./keyed-cache";
import {
  MINING_SERIES_GROUP_IDS,
  toMiningPool,
  toMiningPoolSeries,
  toMiningPools,
  toNsm,
} from "./map";
import { ParamError, rejectUnknown } from "./params";

/**
 * The `/miners` page on the public API: who mined the last 7, 30 or 90 days by reviewed mining pool,
 * one pool's addresses and newest blocks, each pool's share per day or month, and the NSM.
 *
 * Every read goes through `MinersReader` (`server/miners-routes.ts`), the same memoised queries the
 * page reads, so the two cannot disagree and a crowd costs the database one query per window per
 * ten minutes. The one read a caller can vary without bound is a pool's older blocks by cursor:
 * each page is a bounded walk of at most 31 payout days and 20 primary-key-ranged blocks, held
 * in a small response cache. So these ride `/v1`'s ordinary limits.
 *
 * The windows are exactly the page's: 1y and all of history wait for one stored block's miner to be
 * repaired (`MINERS_OPEN_WINDOWS`), and are refused by name rather than silently narrowed.
 *
 * Pool names are published: each is this explorer's reviewed label on specific payout addresses,
 * which `/v1/labels` already lists. Nothing else is grouped: an unlabelled address stays its own
 * row inside `unattributed`.
 */

export const V1_MINING_POOLS_PATH = "/v1/analytics/mining-pools";
export const V1_MINING_POOL_SERIES_PATH = "/v1/analytics/mining-pools/series";
export const V1_MINING_POOL_PATH = "/v1/analytics/mining-pools/{pool}";
export const V1_NSM_PATH = "/v1/analytics/nsm";

/** Every path this group serves, as the descriptor lists them. */
export const V1_MINING_POOL_PATHS = [
  V1_MINING_POOLS_PATH,
  V1_MINING_POOL_SERIES_PATH,
  V1_MINING_POOL_PATH,
  V1_NSM_PATH,
];

const PAGE_CACHE_MS = 10 * 60_000;
const PAGE_CACHE_MAX = 200;

export interface V1MiningPoolsDeps {
  reader: MinersReader;
  /** The live ZEC price, for today's unfinished day; absent or null, today's reward is unvalued. */
  price?: { current(): { usd: number } | null } | null;
  now?: () => number;
}

const WINDOW_LIST = MINERS_OPEN_WINDOWS.join(", ");

/** `window`: one the page serves, 30d by default; 1y, all and anything else are a 400 naming why. */
function parseWindow(raw: string | undefined): MinersWindowKey {
  if (raw === undefined || raw === "") return "30d";
  const found = MINERS_OPEN_WINDOWS.find((w) => w === raw);
  if (found) return found;
  throw new ParamError(
    "invalid_parameter",
    raw === "1y" || raw === "all"
      ? `window ${raw} is not served yet: one stored block's miner (height 3,146,400) awaits repair, so only ${WINDOW_LIST} are`
      : `window must be one of ${WINDOW_LIST}`,
  );
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return POOL_BLOCKS;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > POOL_BLOCKS) {
    throw new ParamError("invalid_parameter", `limit must be an integer from 1 to ${POOL_BLOCKS}`);
  }
  return n;
}

/** A cursor this endpoint issued (a block height), or a 400: a bad one never reads as page one. */
function parseCursor(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const decoded = decodeCursorForColumn(raw, INT4_SORT_KEY_MAX);
  if (decoded === null || decoded.sortKey < 1 || String(decoded.sortKey) !== decoded.id) {
    throw new ParamError("invalid_parameter", "cursor is not one this endpoint issued");
  }
  return decoded.sortKey;
}

const isPoolId = (id: string): id is MiningPoolId => Object.hasOwn(MINING_POOLS, id);

export function v1MiningPoolRoutes(deps: V1MiningPoolsDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const asOf = () => Math.floor(now() / 1000);
  const live = () => deps.price?.current()?.usd ?? null;
  const pages = createKeyedCache({ now, max: PAGE_CACHE_MAX });

  app.onError(routeGroupErrors("the mining index could not answer just now; retry shortly"));

  app.get(V1_MINING_POOLS_PATH, async (c: Context) => {
    const q = c.req.query();
    rejectUnknown(q, ["window"]);
    const overview = await deps.reader.overview(parseWindow(q.window));
    setCache(c, "openWindow");
    return c.json(toMiningPools(overview, live(), SITE, asOf()));
  });

  // Before `{id}`: "series" is a path, never a pool.
  app.get(V1_MINING_POOL_SERIES_PATH, async (c: Context) => {
    const q = c.req.query();
    rejectUnknown(q, ["interval", "pool"]);
    const interval = q.interval ?? "month";
    if (interval !== "month" && interval !== "day") {
      throw new ParamError("invalid_parameter", "interval must be month or day");
    }
    const group = q.pool === undefined || q.pool === "" ? null : q.pool;
    if (group !== null && !MINING_SERIES_GROUP_IDS.includes(group)) {
      throw new ParamError(
        "invalid_parameter",
        `pool must be one of ${MINING_SERIES_GROUP_IDS.join(", ")}`,
      );
    }
    // Every group for every day of a year is thousands of cells: one group per daily request.
    if (interval === "day" && group === null) {
      throw new ParamError(
        "invalid_parameter",
        "interval=day needs pool: one group per daily series",
      );
    }
    const series = await deps.reader.series(interval);
    setCache(c, "series");
    return c.json(toMiningPoolSeries(series, group, SITE, asOf()));
  });

  app.get("/v1/analytics/mining-pools/:pool", async (c: Context) => {
    const q = c.req.query();
    rejectUnknown(q, ["window", "limit", "cursor"]);
    const id = c.req.param("pool")!;
    if (!isPoolId(id)) {
      setCache(c, "rejection");
      return c.json(
        errorBody(c, "not_found", `no reviewed mining pool ${id}; see ${V1_MINING_POOLS_PATH}`),
        404,
      );
    }
    const window = parseWindow(q.window);
    const limit = parseLimit(q.limit);
    const beforeHeight = parseCursor(q.cursor);
    const [overview, blocks] = await Promise.all([
      deps.reader.overview(window),
      beforeHeight === undefined && limit === POOL_BLOCKS
        ? deps.reader.poolBlocks(id)
        : pages(`${id}:${beforeHeight ?? ""}:${limit}`, PAGE_CACHE_MS, () =>
            deps.reader.poolBlocks(id, { ...(beforeHeight ? { beforeHeight } : {}), limit }),
          ),
    ]);
    const last = blocks.at(-1);
    const nextCursor =
      blocks.length === limit && last !== undefined
        ? encodeCursor(last.height, String(last.height))
        : null;
    setCache(c, beforeHeight === undefined ? "openWindow" : "listCursored");
    return c.json(
      toMiningPool(
        MINING_POOLS[id],
        overview,
        blocks,
        { limit, cursor: q.cursor ?? null, nextCursor },
        live(),
        SITE,
        asOf(),
      ),
    );
  });

  app.get(V1_NSM_PATH, async (c: Context) => {
    const q = c.req.query();
    rejectUnknown(q, ["window"]);
    const window = parseWindow(q.window);
    const nsm = await deps.reader.nsm();
    setCache(c, "openWindow");
    return c.json(toNsm(nsm, window, minersWindowDays(window, asOf()), live(), SITE, asOf()));
  });

  return app;
}
