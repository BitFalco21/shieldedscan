import { describe, expect, it } from "vitest";
import { ExpensiveToolLimiter, forwardedClient } from "../mcp-limits";
import { V1_EXPENSIVE_LIMITS } from "../v1/descriptor";

describe("ExpensiveToolLimiter", () => {
  it("knows which paths are expensive", () => {
    expect(ExpensiveToolLimiter.groupOf("/v1/addresses/t1abc/activity?from=a")).toBe(
      "addressWindows",
    );
    expect(ExpensiveToolLimiter.groupOf("/v1/analytics/activity")).toBe("windowedAnalytics");
    expect(ExpensiveToolLimiter.groupOf("/v1/blocks")).toBe("blockList");
    expect(ExpensiveToolLimiter.groupOf("/v1/blocks/3428150")).toBeNull();
    expect(ExpensiveToolLimiter.groupOf("/v1/transactions")).toBeNull();
  });

  it("refuses past one caller's per-minute allowance, and counts callers apart", () => {
    let t = 1_000_000;
    const limiter = new ExpensiveToolLimiter(() => t);
    const { events } = V1_EXPENSIVE_LIMITS.addressWindows.perIpSustained;
    const path = "/v1/addresses/t1abc/activity";
    for (let i = 0; i < events; i += 1) {
      t += 1_000; // stay under the per-second burst
      expect(limiter.take(path, "a")).toBe(0);
    }
    expect(limiter.take(path, "a")).toBeGreaterThan(0);
    expect(limiter.take(path, "b")).toBe(0);
    expect(limiter.take("/v1/transactions", "a")).toBe(0);
  });

  it("caps everyone together at the global ceiling", () => {
    const t = 5_000_000;
    const limiter = new ExpensiveToolLimiter(() => t);
    const { events } = V1_EXPENSIVE_LIMITS.addressWindows.globalCeiling;
    let refused = 0;
    for (let i = 0; i < events + 5; i += 1) {
      if (limiter.take("/v1/addresses/t1x/extremes", `client-${i}`) > 0) refused += 1;
    }
    expect(refused).toBe(5);
  });

  it("keys on the address Caddy added, not one the client claimed", () => {
    expect(forwardedClient("6.6.6.6, 203.0.113.9")).toBe("203.0.113.9");
    expect(forwardedClient(undefined)).toBe("unknown");
  });
});
