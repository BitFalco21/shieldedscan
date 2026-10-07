import { describe, expect, it } from "vitest";
import { config, isAuthorized } from "../proxy";

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
  ])("still runs on a page: %s", (p) => expect(matches(p)).toBe(true));

  it.each([
    "/_next/static/chunks/x.js",
    "/api/live",
    "/api/stats",
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
