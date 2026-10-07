import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Which container answers which path on the API host. The rate-limit tests read the zones; this
 * reads the routing, which nothing else checked: the public surface goes to its own replica
 * (`api-role.ts`), the agent to its own container, and everything else to the primary, whose
 * `/chain/*` the site reads.
 */

const caddyfile = readFileSync("server/Caddyfile", "utf8");

/** One site block's body, by its first host. */
function block(host: string): string {
  const start = caddyfile.indexOf(`\n${host}`);
  expect(start).toBeGreaterThan(-1);
  const open = caddyfile.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < caddyfile.length; i += 1) {
    if (caddyfile[i] === "{") depth += 1;
    if (caddyfile[i] === "}") depth -= 1;
    if (depth === 0) return caddyfile.slice(open + 1, i);
  }
  throw new Error(`unterminated block for ${host}`);
}

/** The block's `reverse_proxy` directives at its top level, in file order. */
function proxies(body: string): Array<{ matcher: string | null; upstream: string }> {
  return [...body.matchAll(/^\treverse_proxy (?:(@\S+) )?(\S+)\s*$/gm)].map((m) => ({
    matcher: m[1] ?? null,
    upstream: m[2]!,
  }));
}

describe("the API host's routing", () => {
  const api = block("api.shieldedscan.xyz");

  it("sends the public surface to its replica, the agent to its own, and the rest to the primary", () => {
    expect(proxies(api)).toEqual([
      { matcher: "@agent", upstream: "explorer-api-agent:8080" },
      { matcher: "@v1", upstream: "explorer-api-public:8080" },
      { matcher: "@mcp", upstream: "explorer-api-public:8080" },
      // Last, so it takes only what nothing above matched: the site's private reads.
      { matcher: null, upstream: "explorer-api:8080" },
    ]);
  });

  it("routes on the same matchers the rate limits key on, each the whole of its surface", () => {
    expect(api).toMatch(/^\t@v1 path \/v1 \/v1\/\*$/m);
    expect(api).toMatch(/^\t@mcp path \/mcp \/mcp\/\*$/m);
    expect(api).not.toMatch(/@partner/);
  });

  it("leaves the testnet host on its own API alone", () => {
    expect(proxies(block("api-testnet.shieldedscan.xyz"))).toEqual([
      { matcher: null, upstream: "explorer-api-testnet:8080" },
    ]);
  });
});
