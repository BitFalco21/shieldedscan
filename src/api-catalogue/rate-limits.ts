import type { ApiRateLimitRow } from "./types";

/** The limits `/api-docs` publishes; a test holds them against the `GET /v1` descriptor. */
export const API_RATE_LIMITS: ApiRateLimitRow[] = [
  {
    scope: "Per IP, burst",
    limit: "20 requests",
    window: "1 second",
    note: "Stops accidental tight loops; a normal page of calls never touches it.",
  },
  {
    scope: "Per IP, sustained",
    limit: "300 requests",
    window: "1 minute",
    note: "5 requests/second continuously — sized for real integrations, not just demos.",
  },
  {
    scope: "Global, all callers",
    limit: "3,600 requests",
    window: "1 minute",
    note: "One box serves this API. The shared ceiling is what keeps it up for everyone; it is keyed on a constant and stores no client identity at all.",
  },
  {
    scope: "Windowed analytics, per IP, burst",
    limit: "3 requests",
    window: "1 second",
    note: "On top of the limits above, for /v1/analytics/activity, shielding-flow, migrations, miners and /v1/crosschain/aggregate — one of these can be a query over years of history rather than a single row.",
  },
  {
    scope: "Windowed analytics, per IP, sustained",
    limit: "30 requests",
    window: "1 minute",
    note: "A window that ended before yesterday cannot change and is answered from cache, so asking again is cheap for both of us; vary the window, not the frequency.",
  },
  {
    scope: "Windowed analytics, all callers",
    limit: "600 requests",
    window: "1 minute",
    note: "A shared ceiling for those five endpoints, keyed on a constant like the global one. When it is busy you get a 503 with a retry hint rather than a long wait.",
  },
  {
    scope: "Block list, per IP, burst",
    limit: "5 requests",
    window: "1 second",
    note: "On top of the limits above, for /v1/blocks: a page the index cannot state yet is read from the node, one read per row, so a 100-row page can be a hundred of them.",
  },
  {
    scope: "Block list, per IP, sustained",
    limit: "60 requests",
    window: "1 minute",
    note: "A page a second still walks a hundred blocks a second. Follow nextCursor rather than re-reading pages.",
  },
  {
    scope: "Block list, all callers",
    limit: "600 requests",
    window: "1 minute",
    note: "Shared by everyone for the block list. When the node is busy a page is refused whole with a 503 and a retry hint, never returned short.",
  },
  {
    scope: "Address windows, per IP, burst",
    limit: "2 requests",
    window: "1 second",
    note: "On top of everything above, for /v1/addresses/{address}/activity and /extremes — each walks one address's history, the most expensive reads this API offers.",
  },
  {
    scope: "Address windows, per IP, sustained",
    limit: "10 requests",
    window: "1 minute",
    note: "A window that ended before yesterday is cached for hours, so asking again costs nothing.",
  },
  {
    scope: "Address windows, all callers",
    limit: "120 requests",
    window: "1 minute",
    note: "Shared by everyone for those two endpoints; when it is busy the answer is a 503 with a retry hint.",
  },
  {
    scope: "MCP, per IP, burst",
    limit: "20 requests",
    window: "1 second",
    note: "For /mcp, which has its own budget because each tool call is one request here. Anthropic's connector addresses have their own limits, below.",
  },
  {
    scope: "MCP, per IP, sustained",
    limit: "300 requests",
    window: "1 minute",
    note: "Expensive tools still answer within the same cost bounds as the endpoints they wrap, so a busy moment can return a 503 with a retry hint.",
  },
  {
    scope: "MCP, Claude connector address, burst",
    limit: "60 requests",
    window: "1 second",
    note: "Requests from Anthropic's published outbound range, 160.79.104.0/21: every Claude user's connector calls arrive through a few addresses there.",
  },
  {
    scope: "MCP, Claude connector address, sustained",
    limit: "900 requests",
    window: "1 minute",
    note: "Per address in that range, still inside the shared ceiling below.",
  },
  {
    scope: "MCP, all callers",
    limit: "1,800 requests",
    window: "1 minute",
    note: "A shared ceiling for /mcp, keyed on a constant.",
  },
  {
    scope: "Per day",
    limit: "none — deliberately",
    window: "—",
    note: "A daily per-IP counter means remembering your IP for 24 hours. Counters live in memory with 60-second windows; the arithmetic bound is ~432,000/day per IP. If you need the whole dataset, ask for a dump instead of polling.",
  },
];
