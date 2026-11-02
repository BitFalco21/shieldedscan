import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, isAuthorized, proxy, viewRewritePath } from "../proxy";

const PASSWORD = "correct horse battery staple";
const header = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`;

describe("isAuthorized", () => {
  it("accepts the right password under any username", () => {
    // A preview gate, not an identity system — only the password is checked.
    expect(isAuthorized(header("anyone", PASSWORD), PASSWORD)).toBe(true);
    expect(isAuthorized(header("", PASSWORD), PASSWORD)).toBe(true);
  });

  it("rejects the wrong password", () => {
    expect(isAuthorized(header("admin", "wrong"), PASSWORD)).toBe(false);
    expect(isAuthorized(header("admin", `${PASSWORD} `), PASSWORD)).toBe(false);
    expect(isAuthorized(header("admin", PASSWORD.toUpperCase()), PASSWORD)).toBe(false);
  });

  it("keeps a password containing colons intact", () => {
    // Splitting on every colon instead of the first would truncate it and let a
    // shorter prefix through.
    const withColons = "a:b:c";
    expect(isAuthorized(header("u", withColons), withColons)).toBe(true);
    expect(isAuthorized(header("u", "a"), withColons)).toBe(false);
  });

  it("rejects a missing, empty or non-Basic header", () => {
    expect(isAuthorized(null, PASSWORD)).toBe(false);
    expect(isAuthorized("", PASSWORD)).toBe(false);
    expect(isAuthorized(`Bearer ${PASSWORD}`, PASSWORD)).toBe(false);
    expect(isAuthorized(`basic ${btoa(`u:${PASSWORD}`)}`, PASSWORD)).toBe(false);
  });

  it("treats malformed base64 as a failed attempt, not an error", () => {
    expect(() => isAuthorized("Basic !!!!not-base64!!!!", PASSWORD)).not.toThrow();
    expect(isAuthorized("Basic !!!!not-base64!!!!", PASSWORD)).toBe(false);
  });

  it("rejects a credential with no colon at all", () => {
    expect(isAuthorized(`Basic ${btoa(PASSWORD)}`, PASSWORD)).toBe(false);
  });

  it("handles non-ASCII passwords the way a browser actually sends them", () => {
    // RFC 7617 charset="UTF-8": the credential arrives as UTF-8 bytes. Decoding the
    // atob output as latin1 rejects a correct password containing any accent.
    const unicode = "pässwörd–✓";
    const utf8 = new TextEncoder().encode(`user:${unicode}`);
    const asBinaryString = String.fromCharCode(...utf8);
    expect(isAuthorized(`Basic ${btoa(asBinaryString)}`, unicode)).toBe(true);
  });
});

/**
 * The matcher decides which requests pay an edge invocation before the CDN can answer.
 * Static assets and the CDN-keyed polls (`/api/live`, `/api/stats`, `/api/pulse/*`) are
 * excluded: the crawl guard's expensive-path rule matches none of them and the password gate
 * is inert in production. `/api/resolve` stays matched: it is a real function per distinct
 * query and the agent block is the only thing in front of it.
 */
describe("matcher", () => {
  // Next compiles a `/((?!a|b).*)` matcher to a regex over the pathname; mirror that here.
  const matches = (pathname: string): boolean => {
    const source = config.matcher[0]!.replace(/^\/\(/, "^/(").replace(/\)$/, ")$");
    return new RegExp(source).test(pathname);
  };

  it.each([
    "/",
    "/blocks",
    "/tx/abcdef",
    "/address/t1abc",
    "/ai-agent",
    "/api/resolve",
    "/network/nodes",
    // The view rewrite lives here, so the page must stay matched.
    "/shielded",
  ])("still runs on a page: %s", (p) => expect(matches(p)).toBe(true));

  it.each([
    "/_next/static/chunks/x.js",
    "/api/live",
    "/api/stats",
    "/api/supply",
    "/api/pulse/live",
    "/api/pulse/window",
    "/api/network/topology",
    "/hero-city/city-2560.webp",
    "/fonts/JetBrainsMono-Regular.woff2",
    "/brand/avatar.png",
    "/og.png",
    "/icon.png",
    "/icon-512.png",
    "/apple-icon.png",
    "/donate-qr.svg",
    "/robots.txt",
    "/sitemap.xml",
  ])("skips a static asset or a CDN-keyed poll: %s", (p) => expect(matches(p)).toBe(false));
});

/**
 * `/shielded?view=shielded` is served by its own prerendered route. The CDN keys on the path the
 * proxy hands on, so the rewrite is what keeps the two views from sharing one cache entry.
 */
describe("view rewrite", () => {
  afterEach(() => vi.unstubAllEnvs());

  const params = (search: string) => new URLSearchParams(search);

  it("sends ?view=shielded to the shielded-pools route, whatever else rides along", () => {
    expect(viewRewritePath("/shielded", params("view=shielded"))).toBe("/shielded/pools");
    expect(viewRewritePath("/shielded", params("utm_source=x&view=shielded"))).toBe(
      "/shielded/pools",
    );
  });

  it("serves the default (all-pools) view for anything else", () => {
    expect(viewRewritePath("/shielded", params(""))).toBeNull();
    expect(viewRewritePath("/shielded", params("view=all"))).toBeNull();
    expect(viewRewritePath("/shielded", params("view=SHIELDED"))).toBeNull();
    expect(viewRewritePath("/shielded", params("view=nonsense"))).toBeNull();
    expect(viewRewritePath("/shielded/pools", params("view=shielded"))).toBeNull();
    expect(viewRewritePath("/blocks", params("view=shielded"))).toBeNull();
  });

  it("keeps the whole query on the rewrite, so a flight request keeps its own key", () => {
    vi.stubEnv("SITE_PASSWORD", "");
    const res = proxy(new NextRequest("http://localhost/shielded?view=shielded&_rsc=abc"));
    const target = new URL(res.headers.get("x-middleware-rewrite") ?? "", "http://localhost");
    expect(target.pathname).toBe("/shielded/pools");
    expect(target.searchParams.get("_rsc")).toBe("abc");
    expect(target.searchParams.get("view")).toBe("shielded");
  });

  it("rewrites nothing behind the password gate until the password is given", () => {
    vi.stubEnv("SITE_PASSWORD", "secret");
    const res = proxy(new NextRequest("http://localhost/shielded?view=shielded"));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
