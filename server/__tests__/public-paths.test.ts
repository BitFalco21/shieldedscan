import { describe, expect, it } from "vitest";
import { PUBLIC_PREFIXES, isPublicPath } from "../public-paths";

/**
 * The auth layer is default-deny, and this is the list of public paths it consults (enumerating
 * protected prefixes instead would publish any new route nobody remembered to protect).
 *
 * These pin the two ways it could go wrong: publishing something that should be private, and
 * publishing something whose name merely starts like a public prefix.
 */

describe("isPublicPath", () => {
  it("publishes exactly the five surfaces that are public by design", () => {
    expect([...PUBLIC_PREFIXES].sort()).toEqual([
      "/.well-known",
      "/agent",
      "/health",
      "/mcp",
      "/v1",
    ]);
  });

  it("matches a public prefix itself and anything beneath it", () => {
    expect(isPublicPath("/health")).toBe(true);
    expect(isPublicPath("/v1")).toBe(true);
    expect(isPublicPath("/v1/blocks")).toBe(true);
    expect(isPublicPath("/v1/transactions/abc123")).toBe(true);
    expect(isPublicPath("/agent")).toBe(true);
    expect(isPublicPath("/agent/ask")).toBe(true);
    expect(isPublicPath("/mcp")).toBe(true);
    expect(isPublicPath("/mcpx")).toBe(false);
  });

  it("keeps every private data route private", () => {
    for (const path of [
      "/chain/info",
      "/chain/blocks",
      "/chain/blocks/latest",
      "/chain/transactions/abc",
      "/chain/addresses/t1abc/transactions",
      "/chain/analytics/activity",
      "/chain/analytics/months",
      "/chain/reorgs",
      "/chain/mempool",
      "/crosschain/transfers",
      "/crosschain/flows",
      "/crosschain/volume",
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  /**
   * The boundary case, and why the predicate is not a bare `startsWith`: a future private route
   * whose name began with a public prefix would otherwise be published by accident.
   */
  it("does not publish a path that merely BEGINS with a public prefix", () => {
    for (const path of [
      "/v1secret",
      "/v1-internal/dump",
      "/healthz",
      "/health-internal",
      "/agentic/keys",
      "/agents",
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it("does not publish anything unrecognised — the default is private", () => {
    for (const path of ["/", "/metrics", "/debug", "/admin", "/internal", "/nope", ""]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  /**
   * The predicate takes a PATHNAME. Passing a full URL, or letting a query string in, would let
   * the decision be influenced by something other than the route — so the caller parses first and
   * these assert the predicate does not accidentally accept the looser forms.
   */
  it("is not fooled by a query string or a full URL smuggled in", () => {
    expect(isPublicPath("/chain/info?x=/v1")).toBe(false);
    expect(isPublicPath("https://api.shieldedscan.xyz/chain/info")).toBe(false);
    expect(isPublicPath("/chain/info#/v1")).toBe(false);
  });
});
