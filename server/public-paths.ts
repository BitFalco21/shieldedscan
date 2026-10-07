/**
 * Which paths on this service are public, and therefore what the bearer check lets past.
 *
 * The token is required unless a path is on this list (default deny). With the opposite polarity,
 * forgetting to protect a new prefix would silently publish it; this way, forgetting to allowlist a
 * new public prefix makes it answer 401 on the first request, which is noticed immediately.
 *
 * A separate module so it can be tested: `server/index.ts` builds pools and starts pollers at
 * module scope, while a pure predicate can be imported freely.
 */

/**
 * Paths that are public by design:
 *
 * - `/health`: the container healthcheck, which has no credential to offer.
 * - `/v1`: the public API, keyless on purpose. An API key would be an identifier, and storing usage
 *   against an identity is incompatible with keeping no visitor logs.
 * - `/agent`: the AI console's endpoint. Keyless by construction: the console calls it from the
 *   visitor's browser, and a bearer token must never ship to the browser. Rate limiting in
 *   `server/Caddyfile` is its defence.
 * - `/mcp`: the public MCP server, keyless for `/v1`'s reason; every tool is a `/v1` read
 *   dispatched in-process.
 * - `/.well-known`: OAuth discovery for MCP clients. Nothing is served beneath it; it is public so
 *   the answer is a 404 ("no login needed") instead of the gate's 401, which a client could mistake
 *   for "OAuth required".
 *
 * Adding an entry here is a deliberate decision to publish something; a new route without an entry
 * is protected by default.
 */
export const PUBLIC_PREFIXES = ["/health", "/v1", "/agent", "/mcp", "/.well-known"] as const;

/**
 * Whether `pathname` is public.
 *
 * A bare `startsWith("/v1")` would also match `/v1secret`, publishing any private route whose name
 * began with a public prefix. A path is public only when it is a prefix or sits beneath it as a
 * path segment. Takes a pathname, never a full URL, so a query string or host cannot influence the
 * decision.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
