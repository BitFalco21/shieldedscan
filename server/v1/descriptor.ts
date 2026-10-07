import { Hono } from "hono";
import { coreRouteErrors, rejectUnknownParams, setCache } from "./http";

export const V1_VERSION = "1.0.0-beta";

/**
 * The tighter per-endpoint limits Caddy enforces on the costliest public reads, published in the
 * descriptor and applied again inside the MCP server (whose calls reach these endpoints
 * in-process, past Caddy). `v1-routes.test.ts` holds these figures to the Caddyfile.
 */
export const V1_EXPENSIVE_LIMITS = {
  // Tighter, on top of the general /v1 limits, for the endpoints that can scan a window of
  // history rather than read one row. Listed even when those endpoints are not mounted
  // so the shape of this object never depends on deployment configuration.
  windowedAnalytics: {
    appliesTo: [
      "/v1/analytics/activity",
      "/v1/analytics/shielding-flow",
      "/v1/analytics/migrations",
      "/v1/analytics/miners",
      "/v1/crosschain/aggregate",
    ],
    perIpBurst: { events: 3, windowSeconds: 1 },
    perIpSustained: { events: 30, windowSeconds: 60 },
    globalCeiling: { events: 600, windowSeconds: 60 },
  },
  // A block-list page the index cannot state yet is read from the node, one block per row,
  // so these keep one caller's paging from taking the node's public capacity. Pages
  // normally come from the index.
  blockList: {
    appliesTo: ["/v1/blocks"],
    perIpBurst: { events: 5, windowSeconds: 1 },
    perIpSustained: { events: 60, windowSeconds: 60 },
    globalCeiling: { events: 600, windowSeconds: 60 },
  },
  // The tightest, for one address walked over a window — the costliest public reads.
  addressWindows: {
    appliesTo: ["/v1/addresses/{address}/activity", "/v1/addresses/{address}/extremes"],
    perIpBurst: { events: 2, windowSeconds: 1 },
    perIpSustained: { events: 10, windowSeconds: 60 },
    globalCeiling: { events: 120, windowSeconds: 60 },
  },
} as const;

/**
 * `GET /v1`: what the API is, its limits and conventions, every endpoint it serves and the ones it
 * refuses to serve. `extensionEndpoints` are the route groups mounted beside the core, so the list
 * names exactly what is mounted.
 */
export function v1DescriptorRoutes(extensionEndpoints: readonly string[]): Hono {
  const app = new Hono();
  app.onError(coreRouteErrors);
  app.get("/v1", (c) => {
    rejectUnknownParams(c, []);
    setCache(c, "descriptor");
    return c.json({
      name: "shieldedscan public API",
      version: V1_VERSION,
      keyless: true,
      rateLimit: {
        perIpBurst: { events: 20, windowSeconds: 1 },
        perIpSustained: { events: 300, windowSeconds: 60 },
        globalCeiling: { events: 3600, windowSeconds: 60 },
        ...V1_EXPENSIVE_LIMITS,
        perDay: null,
        perDayReason:
          "a daily per-IP counter means remembering an IP for 24 hours; counters live in memory with 60-second windows and no identity is ever stored. The arithmetic bound is ~432,000/day per IP",
        on429: "Retry-After header plus the standard JSON error envelope",
      },
      conventions: {
        amounts: "integer zatoshis in *_Zat fields; 1 ZEC = 100,000,000 zat",
        nulls:
          "nullable keys are always present; ambiguous nulls carry a reason in the sibling `unknowns` map",
        unknownReasons: ["shielded", "unmeasured", "omitted", "nonexistent", "indeterminate"],
        pagination: "opaque keyset cursors (nextCursor/prevCursor); no totals, no page numbers",
        shares: "every percentage is {pct, numerator, denominator}",
      },
      endpoints: [
        "GET /v1",
        "GET /v1/status",
        "GET /v1/supply",
        "GET /v1/supply/circulating",
        "GET /v1/network/fees",
        "GET /v1/network/halving",
        "GET /v1/prices/daily",
        "GET /v1/chain",
        "GET /v1/blocks",
        "GET /v1/blocks/{heightOrHash}",
        "GET /v1/blocks/{heightOrHash}/transactions",
        "GET /v1/addresses/{address}",
        "GET /v1/addresses/{address}/transactions",
        "GET /v1/rich-list",
        "GET /v1/rich-list/distribution",
        "GET /v1/search",
        "GET /v1/transactions",
        "GET /v1/transactions/{txid}",
        "GET /v1/transactions/{txid}/privacy",
        "GET /v1/crosschain/transfers",
        "GET /v1/crosschain/transfers/top",
        "GET /v1/crosschain/transfers/{id}",
        "GET /v1/crosschain/flows",
        "GET /v1/crosschain/destinations",
        "GET /v1/reorgs",
        "GET /v1/reorgs/summary",
        "GET /v1/mempool/summary",
        "GET /v1/analytics/monthly",
        "GET /v1/reference",
        ...extensionEndpoints.map((p) => `GET ${p}`),
      ],
      refused: [
        {
          path: "viewing-key anything",
          reason:
            "a viewing key reveals an entire transaction history; there is no endpoint, no stub, no 501",
        },
        {
          path: "per-address privacy scores or clustering",
          reason: "the payment/change split is a deanonymisation heuristic, not a chain fact",
        },
        {
          path: "POST /v1/tips",
          reason: "unverifiable third-party fork claims would poison an observed log",
        },
        {
          path: "GET /v1/transactions/{txid}/linkability",
          reason:
            "amount-and-timing correlation between shieldings and unshieldings is the deanonymisation technique chain-analysis firms sell; serving it keyless would let anyone run it on anyone. The aggregate view (amount distributions over ALL flows) is planned instead — it informs without pointing at a transaction",
        },
        {
          path: "POST /v1/tx/broadcast",
          reason:
            "a broadcast endpoint makes this box a relay and is a write on a read-only surface",
        },
        {
          path: "totals on keyset pages",
          reason: "a COUNT(*) per page view does not survive a real chain",
        },
      ],
      docs: "https://shieldedscan.xyz/api-docs",
      asOf: Math.floor(Date.now() / 1000),
    });
  });
  return app;
}
