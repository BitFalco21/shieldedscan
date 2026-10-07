import type { Context, Next } from "hono";
import { cors } from "hono/cors";
import { etag } from "hono/etag";
import { requestId } from "hono/request-id";
import { NodeRpcError } from "../node-rpc";
import type { V1Error } from "./dto";
import { ParamError, acceptedParams } from "./params";

/**
 * The cross-cutting HTTP layer /v1 needs and the private API deliberately lacks.
 *
 * The private routes serve exactly one client that ships in lockstep, so they carry no
 * CORS, no caching headers and a two-word error body. A keyless public surface is the
 * opposite trade on every axis, and this module is that trade in one place.
 */

/**
 * Cache classes. `s-maxage` speaks to whatever shared cache ever fronts this origin;
 * `stale-while-revalidate` is what keeps responses flowing while one box revalidates.
 * Values mirror the revalidate windows the site's own adapter already chose.
 */
const CACHE_CLASSES = {
  /** The endpoint index and other write-once documents. */
  descriptor: "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  /** Tip-coupled state: status, supply. */
  tip: "public, max-age=15, s-maxage=15, stale-while-revalidate=60",
  /** Whole-dataset aggregates over slow-moving data. */
  aggregate: "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  /** Mempool: seconds of validity, honestly stated. */
  mempool: "public, max-age=5, s-maxage=10, stale-while-revalidate=30",
  /** List head pages move with the tip; cursored history is stable. */
  listHead: "public, max-age=10, s-maxage=30, stale-while-revalidate=300",
  listCursored: "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400",
  /** A confirmed transaction still within reorg depth. */
  reorgable: "public, max-age=15, s-maxage=60, stale-while-revalidate=300",
  /** A refused request or an absent identifier: worth a minute, so a retry loop stays cheap. */
  rejection: "public, max-age=60",
  /** A daily series held in a ten-minute memo over hourly matviews. */
  series: "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
  /** The node map's snapshot, itself at most 30 seconds old. */
  nodes: "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
  /** The tip's mining terms, behind a 30-second memo. */
  miningTerms: "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
  /** A window answer that may still change (it touches today or is not computed yet). */
  openWindow: "public, max-age=300, s-maxage=300",
  /** A window answer that can no longer change. */
  settledWindow: "public, max-age=3600, s-maxage=3600",
  /** The windowed analytics; closed windows are held for hours in process, so a minute here is free. */
  windowedAnalytics: "public, max-age=60, s-maxage=60",
} as const;

export type CacheClass = keyof typeof CACHE_CLASSES;

export function setCache(c: Context, cls: CacheClass): void {
  c.header("Cache-Control", CACHE_CLASSES[cls]);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function errorBody(
  c: Context,
  code: V1Error["error"]["code"],
  message: string,
  asOf: number = nowSeconds(),
): V1Error {
  return {
    error: { code, message },
    // The only debugging handle a no-logs service can offer: the caller quotes it, we
    // grep nothing, but they can correlate their own records.
    requestId: c.get("requestId") ?? "unknown",
    asOf,
  };
}

/** A 503 naming the source that is missing or down: an outage must never read as an absence. */
export function upstreamDown(c: Context, what: string): Response {
  return c.json(
    errorBody(c, "upstream_unavailable", `${what} is not available right now — retry later`),
    503,
  );
}

/** A `ParamError` as the 400 that names it, or null for any other error. */
export function paramErrorResponse(err: Error, c: Context, asOf?: number): Response | null {
  if (!(err instanceof ParamError)) return null;
  if (err.cacheClass) setCache(c, err.cacheClass);
  return c.json(errorBody(c, err.code, err.message, asOf), 400);
}

/**
 * The `onError` for the core `/v1` routes. A bad parameter is a 400 naming it. A transient
 * upstream fault is a 503, never a 404, because an outage must not read as an absence; the chain
 * source has already turned the node's own "no such block / transaction" into a 404, so a
 * `NodeRpcError` reaching here is the node failing to answer, and `node busy` is the public node
 * client refusing when its concurrency ceiling is full. Anything else is a 500.
 */
export function coreRouteErrors(err: Error, c: Context): Response {
  const invalid = paramErrorResponse(err, c);
  if (invalid) return invalid;
  const upstream =
    err instanceof NodeRpcError ||
    /timeout|ECONNREFUSED|ECONNRESET|fetch failed|EAI_AGAIN|node busy/i.test(err.message);
  return c.json(
    errorBody(
      c,
      upstream ? "upstream_unavailable" : "internal",
      upstream ? "an upstream source is unavailable — retry later" : "internal error",
    ),
    upstream ? 503 : 500,
  );
}

/**
 * The `onError` for a route group that fails only on a bad parameter or an upstream read: the
 * first is a 400 naming it, the second a 503 with `upstreamMessage`, never a 500.
 */
export function routeGroupErrors(upstreamMessage: string) {
  return (err: Error, c: Context): Response =>
    paramErrorResponse(err, c) ??
    c.json(errorBody(c, "upstream_unavailable", upstreamMessage), 503);
}

/**
 * Reject any query parameter this endpoint does not define.
 *
 * `?cachebust=<random>` would otherwise walk past every cache layer onto the node; rejecting
 * unknown params also keeps cache-key cardinality finite and catches typos (`?diretcion=out`
 * must not silently return unfiltered data).
 *
 * The core routes' form: its 400 is cacheable for a minute and its wording is published. The
 * route groups use `rejectUnknown` in `params.ts`, whose wording differs by one separator.
 */
export function rejectUnknownParams(c: Context, allowed: readonly string[]): void {
  const supplied = Object.keys(c.req.query());
  const unknown = supplied.filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new ParamError(
    "unknown_parameter",
    `unknown parameter${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")} — ` +
      `this endpoint accepts ${acceptedParams(allowed)}`,
    "rejection",
  );
}

/**
 * The cursor a list route should page from, resolving the `cursor` alias.
 *
 * `cursor` is the same as `before`: hand back a response's `nextCursor` to get the next page.
 * It exists because `before`/`after` is easy to get backwards: in a newest-first list this API
 * means "before" in time (older rows), while Relay-style APIs pair the end cursor with `after`.
 * A caller carrying that convention over would silently receive overlapping rows.
 *
 * `before`/`after` remain (a published contract, and a back button needs both directions).
 * Supplying `cursor` alongside either is a 400 rather than a precedence rule: two names for one
 * slot with a silent winner pages somewhere the caller did not ask for.
 */
export function cursorParams(c: Context): { before?: string; after?: string } {
  const { cursor, before, after } = c.req.query();
  if (cursor !== undefined && (before !== undefined || after !== undefined)) {
    throw new ParamError(
      "invalid_parameter",
      "cursor is an alias for before — supply one of cursor, before or after, not several",
      "rejection",
    );
  }
  const forward = cursor ?? before;
  return {
    ...(forward ? { before: forward } : {}),
    ...(after ? { after } : {}),
  };
}

/** Clamped page size: bounded, defaulted, never trusted. Page NUMBERS do not exist here. */
export function limitParam(raw: string | undefined, fallback = 25, max = 100): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(1, Math.floor(parsed)), max);
}

/** Whether a URL carries a control character, raw or percent-encoded. */
function hasControlCharacter(url: string): boolean {
  if (/[\u0000-\u001f\u007f]/.test(url)) return true;
  return /%(?:[01][0-9a-f]|7f)/i.test(url);
}

/**
 * The middleware stack for the whole /v1 subtree, in registration order.
 *
 * CORS is a literal `*` with credentials off — correct precisely BECAUSE the API is
 * keyless: there is nothing for a hostile page to borrow, and reflecting Origin would
 * add `Vary: Origin` and multiply every cache key by the number of origins on the
 * internet. GET/HEAD/OPTIONS only; nothing here writes.
 */
export function v1Middleware() {
  return [
    requestId(),
    cors({
      origin: "*",
      allowMethods: ["GET", "HEAD", "OPTIONS"],
      allowHeaders: ["Accept", "Content-Type", "If-None-Match"],
      exposeHeaders: ["ETag", "Retry-After", "X-Request-Id"],
      maxAge: 86400,
      credentials: false,
    }),
    etag(),
    async (c: Context, next: Next) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
        c.header("Allow", "GET, HEAD, OPTIONS");
        return c.json(errorBody(c, "method_not_allowed", "this API is read-only"), 405);
      }
      // A control character (a NUL above all) is never part of a valid identifier or parameter,
      // and Postgres refuses NUL in a text parameter, turning a bad request into a 500.
      if (hasControlCharacter(c.req.url)) {
        return c.json(
          errorBody(c, "invalid_parameter", "control characters are not allowed in a request"),
          400,
        );
      }
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Referrer-Policy", "no-referrer");
      await next();
    },
  ];
}
