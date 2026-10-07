import { Hono, type Context } from "hono";
import { AdmissionGate } from "../../admission-gate";
import type { ChainWindowGroupBy, CrossChainGroupBy } from "@/domain";
import type { DailyView, AnalyticsData } from "./data";
import type {
  ActivityData,
  ActivityQuery,
  CrossChainData,
  CrossChainQuery,
  MigrationsData,
  MigrationsQuery,
  AnalyticsEnvelope,
  ShieldingFlowData,
  ShieldingFlowQuery,
} from "./dto";
import {
  activityBucket,
  coverage,
  crossSide,
  flowBucket,
  iso,
  migrationCell,
  sumFlowRows,
} from "./map";
import {
  CROSSCHAIN_PROTOCOLS,
  MIGRATION_SOURCES,
  ANALYTICS_POOLS,
  zeroPoolCounts,
  parseAmount,
  parseChains,
  parseGroupBy,
  parseInterval,
  parseOneOf,
  parsePools,
  parseWindow,
  zecTextToZat,
  type ParsedWindow,
} from "./params";
import { SHAPE_PARAMS, applyShape, parseShape } from "../series-shape";
import { createKeyedCache } from "../keyed-cache";
import { errorBody, paramErrorResponse, setCache } from "../http";
import type { V1Error } from "../dto";
import { MAX_DAY_BUCKETS, ParamError, rejectUnknown } from "../params";
import { DAY_SECONDS, utcDayFromSeconds } from "@/domain/time";
import { MAINNET_SITE_URL as SITE } from "@/lib/network";

/**
 * The windowed analytics on the public `/v1`: activity, shielding flow, pool migrations and the
 * cross-chain aggregate over any window. Two properties set them apart from the private routes:
 *
 *  - Strict parameters: the private routes coerce bad input to "all" for their one lockstep
 *    caller; a stranger's client cannot see that, so every malformed value here is a 400 that
 *    names it (`./params.ts`).
 *  - Coverage in the payload: each response says whether it is complete, partial or a lower bound,
 *    and why (`map.coverage`).
 *
 * Every figure comes from a query this service already runs; see `./data.ts`. The shapes are
 * `./dto.ts`.
 */

/** Closed windows (ending before yesterday) cannot change; everything else is cached briefly. */
const CLOSED_TTL_MS = 6 * 60 * 60 * 1000;
const OPEN_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

/**
 * The start (unix seconds) of every UTC day or month the window touches, oldest first; empty for
 * `none`. Months start at the window's own month even when `from` is mid-month, matching how the
 * day matviews' `date_trunc('month', …)` keys them.
 */
export function bucketStarts(w: ParsedWindow, interval: string): number[] {
  if (interval === "day") {
    const out: number[] = [];
    for (let ts = w.fromTimestamp; ts < w.toTimestamp; ts += DAY_SECONDS) out.push(ts);
    return out;
  }
  if (interval === "month") {
    const out: number[] = [];
    const d = new Date(w.fromTimestamp * 1000);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    for (;;) {
      const ts = Date.UTC(y, m, 1) / 1000;
      if (ts >= w.toTimestamp) break;
      out.push(ts);
      m += 1;
      if (m === 12) {
        m = 0;
        y += 1;
      }
    }
    return out;
  }
  return [];
}

export interface WindowedAnalyticsDeps {
  data: AnalyticsData;
  now?: () => number;
  log?: (m: string) => void;
}

/** The admission gate was full: a 503 with Retry-After, never reported as a failure of ours. */
class AnalyticsBusyError extends Error {
  constructor() {
    super("too many window queries are running right now");
    this.name = "AnalyticsBusyError";
  }
}

/** The four endpoints, by the name the cache keys them on. */
type AnalyticsEndpoint = "activity" | "shielding-flow" | "migrations" | "crosschain";

/**
 * The four endpoints. The cross-chain aggregate is `/v1/crosschain/aggregate`, because
 * `/v1/crosschain/*` already names transfers and per-chain flows and a bare `crosschain` would read
 * as the subtree.
 */
export const WINDOWED_ANALYTICS_PATHS = {
  activity: "/v1/analytics/activity",
  "shielding-flow": "/v1/analytics/shielding-flow",
  migrations: "/v1/analytics/migrations",
  crosschain: "/v1/crosschain/aggregate",
} as const satisfies Record<AnalyticsEndpoint, string>;

/**
 * How many uncached window queries run at once, and how long a request waits for a turn. An
 * all-history window costs several seconds and runs sub-queries in parallel, so rationing by
 * connection starves every request under load. Admitting whole requests bounds the database at
 * this many heavy queries and refuses the rest before they touch it.
 */
const MAX_CONCURRENT = 2;
const MAX_WAITING = 8;
const MAX_WAIT_MS = 10_000;

/**
 * The windowed analytics, mounted inside `v1Routes` so `/v1`'s own middleware (CORS, ETag, request
 * id, read-only methods) and its 404 apply unchanged; this sub-app adds the routes, a public cache
 * header and the strict-parameter error mapping.
 */
export function windowedAnalyticsRoutes(deps: WindowedAnalyticsDeps): Hono {
  const { data } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const nowSeconds = () => Math.floor(now() / 1000);
  const errorBodyNow = (c: Context, code: V1Error["error"]["code"], message: string) =>
    errorBody(c, code, message, nowSeconds());

  const gate = new AdmissionGate(MAX_CONCURRENT, MAX_WAITING, MAX_WAIT_MS);
  /** Admission around the database work only (a cache miss), so a cached answer is never queued. */
  const admit = async <T>(work: () => Promise<T>): Promise<T> => {
    if ((await gate.acquire()) !== "admitted") throw new AnalyticsBusyError();
    try {
      return await work();
    } finally {
      gate.release();
    }
  };

  const onError = (err: Error, c: Context) => {
    const invalid = paramErrorResponse(err, c, nowSeconds());
    if (invalid) return invalid;
    if (err instanceof AnalyticsBusyError) {
      c.header("Retry-After", "10");
      return c.json(
        errorBodyNow(
          c,
          "upstream_unavailable",
          "busy: other window queries are running; retry in a few seconds (an identical window is answered from cache)",
        ),
        503,
      );
    }
    log(`analytics api: ${c.req.path} failed — ${String(err)}`);
    return c.json(
      errorBodyNow(
        c,
        "upstream_unavailable",
        "the chain index could not answer just now; retry shortly",
      ),
      503,
    );
  };

  /**
   * Keyed on the endpoint and the normalised query, never on the caller: the answer does not depend
   * on who asked. Concurrent askers of one window share its run (one query, one turn at the gate);
   * closed windows are kept for hours, anything touching today for a minute.
   */
  const keyed = createKeyedCache({ now, max: CACHE_MAX_ENTRIES });
  const cached = <T>(key: string, toTimestamp: number, load: () => Promise<T>): Promise<T> =>
    keyed(
      key,
      () => {
        const todayStart = Math.floor(nowSeconds() / DAY_SECONDS) * DAY_SECONDS;
        return toTimestamp <= todayStart - DAY_SECONDS ? CLOSED_TTL_MS : OPEN_TTL_MS;
      },
      () => admit(load),
    );

  /** The envelope's chain-facing parts, read once per response. */
  async function frame(w: ParsedWindow, view: DailyView | null, floorNotes: readonly string[]) {
    const [tip, heights, dailyThrough] = await Promise.all([
      data.tip(),
      data.heights(w.fromTimestamp, w.toTimestamp),
      view === null ? Promise.resolve(null) : data.dailyThrough(view),
    ]);
    return {
      window: {
        from: w.from,
        to: w.to,
        toExclusive: true as const,
        fromTimestamp: w.fromTimestamp,
        toTimestamp: w.toTimestamp,
        fromHeight: heights.lo,
        toHeight: heights.hi,
      },
      indexed: { height: tip.height, timestamp: tip.timestamp, time: iso(tip.timestamp) },
      coverage: coverage({
        toTimestamp: w.toTimestamp,
        nowSeconds: nowSeconds(),
        dailyThrough,
        floorNotes,
      }),
      asOf: nowSeconds(),
    };
  }

  function currencyParam(raw: string | undefined): string {
    const currency = (raw ?? "usd").trim().toLowerCase();
    const offered = data.currencies();
    if (offered.includes(currency)) return currency;
    if (offered.length <= 1 && /^[a-z]{3}$/.test(currency)) {
      throw new ParamError(
        "invalid_parameter",
        `currency rates are still loading; only usd is available right now`,
      );
    }
    throw new ParamError("invalid_parameter", `currency must be one of ${offered.join(", ")}`);
  }

  // Ranking and field selection are applied to the cached answer, never part of what is cached:
  // a ranked view of a window must not re-run the window's query.
  const cacheKey = (endpoint: AnalyticsEndpoint, c: Context) => {
    const q = c.req.query();
    const sorted = Object.keys(q)
      .filter((k) => !(SHAPE_PARAMS as readonly string[]).includes(k))
      .sort()
      .map((k) => `${k}=${q[k]}`)
      .join("&");
    return `${endpoint}?${sorted}`;
  };

  // --------------------------------------------------------------------------- /activity
  const activity = async (c: Context) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "interval", "minZec", "minFiat", "currency", ...SHAPE_PARAMS]);
    const shape = parseShape(q);
    const w = parseWindow(q);
    const interval = parseInterval(q.interval, w);
    const minZec = parseAmount("minZec", q.minZec);
    const minFiat = parseAmount("minFiat", q.minFiat);
    const currency = currencyParam(q.currency);
    const query: ActivityQuery = {
      from: w.from,
      to: w.to,
      interval,
      minZec: minZec?.text ?? null,
      minFiat: minFiat?.text ?? null,
      currency,
    };

    const body = await cached(cacheKey("activity", c), w.toTimestamp, async () => {
      const groupBy = interval as ChainWindowGroupBy;
      const [win, perBucket] = await Promise.all([
        data.window(
          {
            fromTimestamp: w.fromTimestamp,
            toTimestamp: w.toTimestamp,
            ...(minZec === null ? {} : { minCrossingZat: zecTextToZat(minZec.text) }),
            ...(minFiat === null
              ? {}
              : { minCrossingValue: minFiat.value, crossingCurrency: currency }),
          },
          groupBy,
          currency,
        ),
        interval === "none"
          ? Promise.resolve(new Map())
          : data.poolTxByBucket(w.fromTimestamp, w.toTimestamp, groupBy),
      ]);

      const unknowns: AnalyticsEnvelope<ActivityQuery, ActivityData>["unknowns"] = {};
      const pc = win.poolTxCounts;
      // `transparentOnly` exists only on the exact block-range count. Above that range the
      // per-pool figures come from day totals, which hold one row per pool, so a transaction
      // using no pool has nowhere to be counted — unmeasured, never zero.
      // A window holding no block at all is a measured zero.
      const transparentOnly =
        pc !== null ? pc.transparentOnly : win.poolTxCountsUnavailable === "no-blocks" ? 0 : null;
      if (transparentOnly === null)
        unknowns["data.totals.transactions.byPool.transparentOnly"] = "unmeasured";
      const totals = activityBucket(
        win.totals,
        {
          sprout: pc?.sprout ?? 0,
          sapling: pc?.sapling ?? 0,
          orchard: pc?.orchard ?? 0,
          ironwood: pc?.ironwood ?? 0,
          transparentOnly,
        },
        null,
      );
      const buckets = win.groups.map((g) =>
        activityBucket(
          g,
          perBucket.get(g.timestamp) ?? zeroPoolCounts(),
          utcDayFromSeconds(g.timestamp),
        ),
      );

      const floorNotes: string[] = [];
      if (win.totals.blocksCovered < win.totals.blocks) {
        floorNotes.push(
          `Fees are a lower bound: ${win.totals.blocksCovered} of ${win.totals.blocks} blocks have a derivable fee total.`,
        );
      }
      const t = win.totals;
      if (
        t.pricedCrossings !== undefined &&
        t.consideredCrossings !== undefined &&
        t.pricedCrossings < t.consideredCrossings
      ) {
        floorNotes.push(
          `overFloor counts are a lower bound: ${t.pricedCrossings} of ${t.consideredCrossings} crossings fell on a day with a known price.`,
        );
      }
      return {
        query,
        ...(await frame(w, "chain_day_rollup", floorNotes)),
        source: { name: "ShieldedScan" as const, url: `${SITE}/analytics` },
        data: { interval, totals, buckets },
        unknowns,
      } satisfies AnalyticsEnvelope<ActivityQuery, ActivityData>;
    });
    return c.json(applyShape(body, shape));
  };

  // ---------------------------------------------------------------------- /shielding-flow
  const shieldingFlow = async (c: Context) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "interval", "pool", ...SHAPE_PARAMS]);
    const shape = parseShape(q);
    const w = parseWindow(q);
    const interval = parseInterval(q.interval, w);
    const pools = parsePools(q.pool);
    const query: ShieldingFlowQuery = { from: w.from, to: w.to, interval, pool: pools };

    const body = await cached(cacheKey("shielding-flow", c), w.toTimestamp, async () => {
      const rows = await data.flows(w.fromTimestamp, w.toTimestamp, interval as ChainWindowGroupBy);
      const byBucket = new Map<number, typeof rows>();
      for (const r of rows) byBucket.set(r.bucketTs, [...(byBucket.get(r.bucketTs) ?? []), r]);
      // Every period in the window gets a bucket: a period with no rows moved nothing, which is
      // a measured zero rather than a gap.
      const buckets = bucketStarts(w, interval).map((ts) =>
        flowBucket(byBucket.get(ts) ?? [], pools, utcDayFromSeconds(ts)),
      );
      return {
        query,
        ...(await frame(w, "chain_day_pool_boundary", [])),
        source: { name: "ShieldedScan" as const, url: `${SITE}/shielded` },
        data: { interval, totals: flowBucket(sumFlowRows(rows), pools, null), buckets },
        unknowns: {},
      } satisfies AnalyticsEnvelope<ShieldingFlowQuery, ShieldingFlowData>;
    });
    return c.json(applyShape(body, shape));
  };

  // -------------------------------------------------------------------------- /migrations
  const migrations = async (c: Context) => {
    const q = c.req.query();
    rejectUnknown(q, ["from", "to", "interval", "source", "destination", "currency"]);
    const w = parseWindow(q);
    const interval = parseInterval(q.interval, w);
    const source = parseOneOf("source", q.source, MIGRATION_SOURCES);
    const destination = parseOneOf("destination", q.destination, ANALYTICS_POOLS);
    const currency = currencyParam(q.currency);
    if (interval !== "none" && source === null && destination === null) {
      throw new ParamError(
        "invalid_parameter",
        "interval=day or month needs source or destination, which keeps a per-period matrix small; use interval=none for the full matrix",
      );
    }
    const query: MigrationsQuery = {
      from: w.from,
      to: w.to,
      interval,
      source,
      destination,
      currency,
    };

    const body = await cached(cacheKey("migrations", c), w.toTimestamp, async () => {
      const [totalRows, bucketRows] = await Promise.all([
        data.migrations(w.fromTimestamp, w.toTimestamp, "none", currency, source, destination),
        interval === "none"
          ? Promise.resolve([])
          : data.migrations(
              w.fromTimestamp,
              w.toTimestamp,
              interval as ChainWindowGroupBy,
              currency,
              source,
              destination,
            ),
      ]);
      const byBucket = new Map<number, typeof bucketRows>();
      for (const r of bucketRows) {
        const ts = r.bucketTs ?? 0;
        byBucket.set(ts, [...(byBucket.get(ts) ?? []), r]);
      }
      const unpriced = totalRows.reduce((s, r) => s + (r.txCount - r.pricedTxCount), 0);
      const floorNotes =
        unpriced > 0
          ? [
              `${unpriced} migrations fell on a day with no known ${currency} close, so their value is not included.`,
            ]
          : [];
      return {
        query,
        ...(await frame(w, "chain_day_pool_migration", floorNotes)),
        source: { name: "ShieldedScan" as const, url: `${SITE}/charts/pool-migrations` },
        data: {
          interval,
          totals: totalRows.map((r) => migrationCell(r, currency)),
          // Every period in the window, so an empty `cells` list is a measured "none that
          // period" rather than a period that silently went missing.
          buckets: bucketStarts(w, interval).map((ts) => ({
            periodStart: utcDayFromSeconds(ts),
            cells: (byBucket.get(ts) ?? []).map((r) => migrationCell(r, currency)),
          })),
        },
        unknowns: {},
      } satisfies AnalyticsEnvelope<MigrationsQuery, MigrationsData>;
    });
    return c.json(body);
  };

  // -------------------------------------------------------------------------- /crosschain
  const crosschain = async (c: Context) => {
    const q = c.req.query();
    rejectUnknown(q, [
      "from",
      "to",
      "groupBy",
      "direction",
      "chain",
      "protocol",
      "minZec",
      "minUsd",
      ...SHAPE_PARAMS,
    ]);
    const shape = parseShape(q);
    const w = parseWindow(q);
    const groupBy = parseGroupBy(q.groupBy);
    if (groupBy === "day" && (w.toTimestamp - w.fromTimestamp) / DAY_SECONDS > MAX_DAY_BUCKETS) {
      throw new ParamError(
        "invalid_parameter",
        `groupBy=day covers at most ${MAX_DAY_BUCKETS} days per request`,
      );
    }
    const direction = parseOneOf("direction", q.direction, ["in", "out"] as const);
    const protocol = parseOneOf("protocol", q.protocol, CROSSCHAIN_PROTOCOLS);
    const chain = parseChains(q.chain);
    const minZec = parseAmount("minZec", q.minZec);
    const minUsd = parseAmount("minUsd", q.minUsd);
    const query: CrossChainQuery = {
      from: w.from,
      to: w.to,
      groupBy,
      direction,
      chain,
      protocol,
      minZec: minZec?.text ?? null,
      minUsd: minUsd?.text ?? null,
    };

    const body = await cached(cacheKey("crosschain", c), w.toTimestamp, async () => {
      const agg = await data.crosschain(
        {
          fromTimestamp: w.fromTimestamp,
          toTimestamp: w.toTimestamp,
          completedOnly: true,
          ...(direction === null ? {} : { direction }),
          ...(protocol === null ? {} : { protocol }),
          ...(chain.length === 0 ? {} : { counterpartChains: chain }),
          ...(minZec === null ? {} : { minZecZat: zecTextToZat(minZec.text) }),
          ...(minUsd === null ? {} : { minUsdAtSwap: minUsd.value }),
        },
        (groupBy === "protocol" ? "venue" : groupBy) as CrossChainGroupBy,
      );
      const floorNotes = [
        "Public swap protocols only (NEAR Intents, Maya, THORChain), completed transfers only. Exchange withdrawals and aggregators are not included, so every total is a lower bound.",
      ];
      if (minUsd !== null) {
        floorNotes.push(
          "A transfer with no published dollar value is excluded by minUsd rather than assumed to clear it.",
        );
      }
      return {
        query,
        ...(await frame(w, null, floorNotes)),
        source: { name: "ShieldedScan" as const, url: `${SITE}/cross-chain/flows` },
        data: {
          groupBy,
          totals: { in: crossSide(agg.totals.in), out: crossSide(agg.totals.out) },
          groups: agg.groups.map((g) => ({
            key: g.key,
            in: crossSide(g.in),
            out: crossSide(g.out),
          })),
        },
        unknowns: {},
      } satisfies AnalyticsEnvelope<CrossChainQuery, CrossChainData>;
    });
    return c.json(applyShape(body, shape));
  };

  // A minute at the browser and a shared cache alike: closed windows are cached for hours in
  // process, so a short public lifetime costs nothing and keeps a window touching today honest.
  const publicCache = async (c: Context, next: () => Promise<void>) => {
    await next();
    if (c.res.status === 200) setCache(c, "windowedAnalytics");
  };
  const app = new Hono();
  app.onError(onError);
  for (const path of Object.values(WINDOWED_ANALYTICS_PATHS)) app.use(path, publicCache);
  app.get(WINDOWED_ANALYTICS_PATHS.activity, activity);
  app.get(WINDOWED_ANALYTICS_PATHS["shielding-flow"], shieldingFlow);
  app.get(WINDOWED_ANALYTICS_PATHS.migrations, migrations);
  app.get(WINDOWED_ANALYTICS_PATHS.crosschain, crosschain);
  return app;
}
